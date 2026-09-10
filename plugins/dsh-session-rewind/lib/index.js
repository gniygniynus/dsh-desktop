// sessionRewind host 服务：硬删会话（delete）+ 撤回（rewind=fork+归档母）+ 重新回答（regenerate=fork+followup+归档母）。
// 适配 dsh 0.1.5-rc.1：去掉 apiProxy 依赖，直接用 sessions.fork/create。
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

function success(value) {
  return Object.freeze({ ok: true, value });
}

function rejected(error) {
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

/**
 * 手动触发 Typert 的 Remote 方法装饰器（Node 22 无原生 ES 装饰器语法）。
 * 等价于 `@Remote(name)`：把 method marker 写到 ServiceClass.prototype。
 */
function markRemoteMethod(ServiceClass, methodName) {
  const prototype = ServiceClass.prototype;
  Remote(methodName)(undefined, {
    kind: "method",
    name: methodName,
    static: false,
    private: false,
    addInitializer(fn) {
      fn.call(Object.create(prototype));
    },
  });
}

class SessionRewindService extends TypertRemoteService {
  // 0.1.5: apiProxy 已移除，直接用 sessions（SessionStore）+ workspaceRegistry + agents
  static inject = ["sessionPersistence", "workspaceRegistry", "sessions", "agents"];

  constructor(ctx) {
    super(ctx, "sessionRewind");
  }

  async _resolveHeader(sessionId) {
    const live = this.ctx.sessions.get(sessionId);
    if (live !== void 0) return live.header;
    const snaps = await this.ctx.sessionPersistence.listSnapshots();
    return snaps.find((s) => s.header.id === sessionId)?.header;
  }

  async _readEvents(sessionId) {
    const live = this.ctx.sessions.get(sessionId);
    if (live !== void 0) return [...live.events];
    const inspected = await this.ctx.sessionPersistence.inspect(sessionId);
    return [...inspected.events];
  }

  _moveToTrash(dir) {
    if (!existsSync(dir)) return;
    const trashRoot = dshHomePath("storages", "trash");
    mkdirSync(trashRoot, { recursive: true });
    renameSync(dir, join(trashRoot, `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`));
  }

  /** 归档母会话（从列表消失但不删文件，可靠且不需 hack 私有 API）。 */
  async _archiveMother(sessionId) {
    try {
      const ws = this.ctx.workspaceRegistry.list().find((w) => w.sessionIds.includes(sessionId));
      if (ws !== void 0) await ws.archiveSession(sessionId);
    } catch {}
  }

  /** 硬删本体 + 其子代理；返回被删 id 列表。会话不存在抛错。 */
  async _hardDelete(sessionId) {
    const header = await this._resolveHeader(sessionId);
    if (header === void 0) throw new Error("session-not-found");
    const deletedIds = [sessionId];
    let snaps;
    try {
      snaps = await this.ctx.sessionPersistence.listSnapshots();
      for (const s of snaps) if (s.header.parentSession === sessionId) deletedIds.push(s.header.id);
    } catch {
      snaps = [];
    }
    for (const id of deletedIds) {
      let ws;
      try {
        ws = this.ctx.workspaceRegistry.list().find((w) => w.sessionIds.includes(id));
      } catch {}
      if (ws !== void 0) await ws.detachSession(id);
    }
    for (const id of deletedIds) {
      const h = id === sessionId ? header : snaps.find((s) => s.header.id === id)?.header;
      if (h === void 0) continue;
      const loc = this.ctx.sessionPersistence.locate(h);
      if (loc === void 0) continue;
      this._moveToTrash(dirname(loc.path));
    }
    // 从 live store 移除，避免 session.list 仍返回已删会话
    for (const id of deletedIds) this._detachLive(id);
    return { deletedIds };
  }

  /**
   * 算「撤回消息 atSeq」的 fork 边界：atSeq 所在轮次的上一轮 turn/end 的 seq。
   * atSeq 在第一轮（无上一轮）时返回 undefined。
   */
  _computePrevEndSeq(events, atSeq) {
    let turnStartSeq = -1;
    for (const e of events) {
      if (e.seq <= atSeq && e.type === "turn/start") turnStartSeq = e.seq;
    }
    if (turnStartSeq === -1) return undefined;
    let prevEndSeq;
    for (const e of events) {
      if (e.seq < turnStartSeq && e.type === "turn/end") prevEndSeq = e.seq;
    }
    return prevEndSeq;
  }

  async delete(request) {
    const { sessionId } = request;
    try {
      const { deletedIds } = await this._hardDelete(sessionId);
      return success({ deleted: true, deletedIds });
    } catch (error) {
      if (error.message === "session-not-found") return rejected({ code: "session-not-found", sessionId });
      return rejected({ code: "delete-failed", sessionId, message: String(error) });
    }
  }

  async rewind(request) {
    const { sessionId, atSeq } = request;
    const header = await this._resolveHeader(sessionId);
    if (header === void 0) return rejected({ code: "session-not-found", sessionId });

    const events = await this._readEvents(sessionId);
    const prevEndSeq = this._computePrevEndSeq(events, atSeq);
    if (prevEndSeq === undefined) {
      // 撤回第一条消息（无上一轮）＝ 创建空会话＋归档母
      try {
        const child = this.ctx.sessions.create(undefined, {
          meta: { cwd: header.cwd ?? "" }
        });
        const newId = child.id;
        await this._archiveMother(sessionId);
        return success({ sessionId: newId });
      } catch (error) {
        return rejected({ code: "fork-failed", sessionId, message: String(error) });
      }
    }

    let childId;
    try {
      const child = this.ctx.sessions.fork(sessionId, prevEndSeq);
      childId = child.id;
    } catch (error) {
      return rejected({ code: "fork-failed", sessionId, message: String(error) });
    }

    // 归档母会话
    await this._archiveMother(sessionId);

    return success({ sessionId: childId });
  }

  /** 找 atSeq 所在轮次内（<=atSeq）的用户消息内容（UserMessage）。 */
  _findUserMessage(events, atSeq) {
    let turnStartSeq = -1;
    for (const e of events) if (e.seq <= atSeq && e.type === "turn/start") turnStartSeq = e.seq;
    if (turnStartSeq === -1) return undefined;
    for (const e of events) {
      if (e.seq >= turnStartSeq && e.seq <= atSeq && e.type === "user/message") return e.data;
    }
    return undefined;
  }

  /** 重新回答：fork 到 atSeq 所在轮次的上一轮，followup 原用户消息重跑，归档母，返回子会话 id。 */
  async regenerate(request) {
    const { sessionId, atSeq } = request;
    const header = await this._resolveHeader(sessionId);
    if (header === void 0) return rejected({ code: "session-not-found", sessionId });

    const events = await this._readEvents(sessionId);
    const userMsg = this._findUserMessage(events, atSeq);
    if (userMsg === void 0) return rejected({ code: "no-user-message", sessionId });
    const prevEndSeq = this._computePrevEndSeq(events, atSeq);
    if (prevEndSeq === undefined) {
      // 重新回答第一轮的 AI 回复：建空会话 + followup 用户消息重跑 + 归档母
      try {
        const child = this.ctx.sessions.create(undefined, {
          meta: { cwd: header.cwd ?? "" }
        });
        const newId = child.id;
        try {
          const agent = this.ctx.agents?.get(newId);
          if (agent?.followup !== void 0) agent.followup(userMsg);
        } catch {}
        await this._archiveMother(sessionId);
        return success({ sessionId: newId });
      } catch (error) {
        return rejected({ code: "fork-failed", sessionId, message: String(error) });
      }
    }

    let childId;
    try {
      const child = this.ctx.sessions.fork(sessionId, prevEndSeq);
      childId = child.id;
    } catch (error) {
      return rejected({ code: "fork-failed", sessionId, message: String(error) });
    }

    // followup 原用户消息重跑
    try {
      const agent = this.ctx.agents?.get(childId);
      if (agent?.followup !== void 0) agent.followup(userMsg);
    } catch {}

    // 归档母会话
    await this._archiveMother(sessionId);

    return success({ sessionId: childId });
  }
}

markRemoteMethod(SessionRewindService, "delete");
markRemoteMethod(SessionRewindService, "rewind");
markRemoteMethod(SessionRewindService, "regenerate");

export { SessionRewindService, SessionRewindService as default };
