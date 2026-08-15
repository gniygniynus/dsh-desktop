// F3 撤回（原地截断重发）：预览最近 N 轮 → 截到某条用户消息之前重建
// ⚠️ 只在 harness 停止 / 目标会话未 live 时调用（main 负责协调）。
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { findSession, storagePath, readJsonFile, atomicWriteJson, ensureTrash, trashRoot } from "./session-db.js";
import { sessionFileToText, buildZstdFile } from "./zstd.js";

/** 解析会话文件 → { headerLine, events:[{line, obj, seq}] } */
export function parseSession(path) {
  const txt = sessionFileToText(path);
  const lines = txt.split("\n");
  const headerLine = lines[0];
  const events = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.length) continue;
    try {
      const obj = JSON.parse(line);
      events.push({ line, obj, seq: obj.seq });
    } catch {}
  }
  return { headerLine, events };
}

const isUserMessage = (o) =>
  o?.type === "user/message" || o?.event?.kind === "user/message" || o?.event?.type === "user/message";

function userText(o) {
  const c = o?.data?.content ?? o?.event?.data?.content;
  if (Array.isArray(c)) return c.filter((x) => x?.type === "text").map((x) => x.text).join("");
  return "";
}

/** 撤回选点：最近 N 条用户消息。 */
export function rollbackPreview(id, n = 5) {
  const s = findSession(id);
  if (!s) return { ok: false, reason: "not-found" };
  const { events } = parseSession(s.path);
  const turns = [];
  for (let i = 0; i < events.length; i++) {
    if (isUserMessage(events[i].obj)) {
      turns.push({
        eventIndex: i,
        seq: events[i].seq,
        text: userText(events[i].obj).slice(0, 60),
      });
    }
  }
  return { ok: true, id, totalTurns: turns.length, turns: turns.slice(-n) };
}

/**
 * 撤回：保留 events[0..eventIndex)（删掉所选用户消息及其后一切），重建文件。
 */
export function rollbackSession(id, eventIndex) {
  const s = findSession(id);
  if (!s) return { ok: false, reason: "not-found" };
  const { headerLine, events } = parseSession(s.path);
  if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex > events.length)
    return { ok: false, reason: "bad-cut", eventIndex, max: events.length };

  const kept = events.slice(0, eventIndex);
  const removed = events.slice(eventIndex);

  // 备份被裁尾到 trash
  ensureTrash();
  const backup = join(trashRoot(), `rollback-${id}-${Date.now()}.jsonl.txt`);
  writeFileSync(backup, removed.map((e) => e.line).join("\n"));

  // 重建（head 帧 + 事件帧），写同目录 .tmp → fsync 兜底 → 原子 rename
  const keptText = kept.map((e) => e.line).join("\n") + (kept.length ? "\n" : "");
  const bytes = buildZstdFile(headerLine, keptText);
  const tmp = s.path + ".tmp";
  writeFileSync(tmp, bytes);
  renameSync(tmp, s.path);

  // 清 projcache（侧栏标题/统计在 resume 时重算）
  const pf = storagePath("session_projcache.json");
  const p = readJsonFile(pf);
  if (p && p.tables?.sessions?.[id]) {
    delete p.tables.sessions[id];
    atomicWriteJson(pf, p);
  }

  return { ok: true, id, keptEvents: kept.length, removedEvents: removed.length, backup };
}