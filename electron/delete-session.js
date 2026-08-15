// F2 删除会话：目录进回收站 + 联动 GC 子代理 + 清两个账本
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findSession, listSessions, storagePath, readJsonFile, atomicWriteJson, moveToTrash } from "./session-db.js";

/** 删除一个会话（含其子代理会话）；返回 { ok, trash, deletedIds }。 */
export function deleteSession(id) {
  const target = findSession(id);
  if (!target) return { ok: false, reason: "not-found" };

  const moved = [];
  const trashTarget = moveToTrash(target.dir, `del-${target.id}`);
  moved.push(target.id);

  // 联动 GC：同项目目录、header.parentSession===该 id 的子代理会话
  for (const s of listSessions()) {
    if (s.projectKey === target.projectKey && s.header?.parentSession === target.id && existsSync(s.dir)) {
      moveToTrash(s.dir, `sub-${s.id}`);
      moved.push(s.id);
    }
  }

  // 账本
  const wf = storagePath("workspace.json");
  const w = readJsonFile(wf);
  if (w) {
    if (Array.isArray(w.global?.archivedSessionIds))
      w.global.archivedSessionIds = w.global.archivedSessionIds.filter((x) => !moved.includes(x));
    for (const ws of Object.values(w.tables?.workspaces ?? {}))
      if (Array.isArray(ws.sessionIds)) ws.sessionIds = ws.sessionIds.filter((x) => !moved.includes(x));
    atomicWriteJson(wf, w);
  }
  const pf = storagePath("session_projcache.json");
  const p = readJsonFile(pf);
  if (p && p.tables?.sessions) {
    let changed = false;
    for (const m of moved) if (p.tables.sessions[m]) { delete p.tables.sessions[m]; changed = true; }
    if (changed) atomicWriteJson(pf, p);
  }

  return { ok: true, trash: trashTarget, deletedIds: moved };
}