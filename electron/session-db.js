// 会话与账本工具：路径定位、列表、原子写（.bak + tmp + rename）
import { existsSync, readFileSync, copyFileSync, writeFileSync, renameSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { sessionFileToText } from "./zstd.js";

export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), ".dsh");
}
export function sessionsRoot() {
  return join(dshHome(), "sessions");
}
export function storagePath(name) {
  return join(dshHome(), "storages", name);
}
export function trashRoot() {
  return join(dshHome(), "storages", "trash");
}

/** harness projectKey：把 cwd 的盘符/分隔符转 `-`，再包 `--…--`。 */
export function projectKey(cwd) {
  return `--${String(cwd).replace(/[\\/:]/g, "-").replace(/^-+|-+$/g, "")}--`;
}

/** 读会话 head 帧（第一行 JSON）→ meta；坏了返回 null。 */
export function readHeader(path) {
  try {
    const first = sessionFileToText(path).split("\n")[0];
    return JSON.parse(first);
  } catch {
    return null;
  }
}

/** 列出所有会话：sessions/<projkey>/<id>/session.jsonl.zstd */
export function listSessions() {
  const out = [];
  const root = sessionsRoot();
  if (!existsSync(root)) return out;
  for (const proj of readdirSync(root)) {
    const pdir = join(root, proj);
    if (!existsSync(pdir)) continue;
    for (const id of readdirSync(pdir)) {
      const f = join(pdir, id, "session.jsonl.zstd");
      if (!existsSync(f)) continue;
      out.push({ id, projectKey: proj, dir: join(pdir, id), path: f, header: readHeader(f) });
    }
  }
  return out;
}

/** find by id */
export function findSession(id) {
  const s = listSessions().find((x) => x.id === id);
  if (s) return s;
  // 容忍顶层 id 带/不带 session- 前缀
  const bare = id.startsWith("session-") ? id.slice("session-".length) : "session-" + id;
  return listSessions().find((x) => x.id === bare);
}

export function readJsonFile(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** 原子写 JSON：旧文件的 .bak + 写 .tmp + rename。 */
export function atomicWriteJson(p, obj) {
  if (existsSync(p)) copyFileSync(p, p + ".bak");
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  renameSync(tmp, p);
}

export function ensureTrash() {
  mkdirSync(trashRoot(), { recursive: true });
}

export function moveToTrash(src, suffix) {
  ensureTrash();
  const dest = join(trashRoot(), `${suffix}-${Date.now()}`);
  renameSync(src, dest);
  return dest;
}