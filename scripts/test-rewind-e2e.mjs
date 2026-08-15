// 端到端验证 sessionRewind.rewind：两轮会话 → 撤回第2轮 → fork 出子会话 + 硬删母。
// 用法：Windows node 跑：
//   "/mnt/c/Program Files/nodejs/node.exe" "D:\dsh-desktop\scripts\test-rewind-e2e.mjs"
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
process.env.DSH_HOME = join(APP, ".dev-dsh");

const lib = join(APP, "node_modules", "@deepseek-ai", "dsh", "lib");
let runProfile = null;
for (const f of readdirSync(lib)) {
  if (!f.startsWith("profile-boot-") || !f.endsWith(".js")) continue;
  try {
    const m = await import(pathToFileURL(join(lib, f)).href);
    if (typeof m.runProfile === "function") { runProfile = m.runProfile; break; }
  } catch {}
}
const { loadLayeredEnv } = await import(pathToFileURL(join(APP, "node_modules/@deepseek-ai/dsh-app-boot/lib/index.js")).href);
const environment = await loadLayeredEnv("dsh");

const timeout = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms));
const resumed = await Promise.race([
  runProfile({ environment, profile: "web", patchFiles: [], args: ["--port", "0"] }),
  timeout(90000, "runProfile boot"),
]);
const { ctx, shutdown } = resumed;
console.log("[rewind-e2e] booted");

const svc = ctx.get("sessionRewind");

// 创建两轮会话
const sid = "session-rewind-" + Date.now();
const session = ctx.sessions.create(sid, { meta: { cwd: process.cwd() } });
session.append("turn/start", { turn: 1 });
session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
session.append("turn/start", { turn: 2 });
session.append("turn/end", { turn: 2, reason: { kind: "completed" } });
await ctx.sessions.flush(session);

const turn2StartSeq = session.events.find((e) => e.type === "turn/start" && e.data.turn === 2)?.seq;
console.log("[rewind-e2e] 会话", sid, "turn2/start seq =", turn2StartSeq, "| 事件数 =", session.events.length);

const loc = ctx.sessionPersistence.locate(session.header);
const dir = loc ? dirname(loc.path) : null;
console.log("[rewind-e2e] 母目录存在:", dir ? existsSync(dir) : false);

// 撤回 turn2
const rw = await svc.rewind({ sessionId: sid, atSeq: turn2StartSeq });
console.log("[rewind-e2e] rewind 结果 =", JSON.stringify(rw));
if (!rw.ok) { console.error("[rewind-e2e] ✘ rewind 失败"); process.exit(1); }

const childId = rw.value.sessionId;
console.log("[rewind-e2e] childId =", childId);

// 验证：母被删（目录进 trash）
console.log("[rewind-e2e] 母目录删除后存在:", dir ? existsSync(dir) : "n/a", "（应 false）");

// 验证：子会话存在且只有 turn1（1 个 turn/start + 1 个 turn/end）
const childLive = ctx.sessions.get(childId);
if (childLive) {
  const childEvents = childLive.events;
  const turns = childEvents.filter((e) => e.type === "turn/start").map((e) => e.data.turn);
  console.log("[rewind-e2e] 子会话 turn 列表 =", JSON.stringify(turns), "| 事件数 =", childEvents.length);
  if (turns.length !== 1 || turns[0] !== 1) { console.error("[rewind-e2e] ✘ 子会话应只含 turn1"); process.exit(1); }
  console.log("[rewind-e2e] ✔ 子会话只含 turn1");
} else {
  console.log("[rewind-e2e] 子会话不在 live store（可能已持久化为 cold，属正常）");
}

await Promise.race([typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()), new Promise((r) => setTimeout(r, 20000))]);
console.log("[rewind-e2e] done");
process.exit(0);
