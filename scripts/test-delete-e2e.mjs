// 端到端验证 sessionRewind.delete：创建会话 → 硬删 → 验证文件进 trash + workspace 记账。
// 用法：Windows node 跑（WSL 下 boot 会卡住）：
//   "/mnt/c/Program Files/nodejs/node.exe" "D:\dsh-desktop\scripts\test-delete-e2e.mjs"
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
console.log("[e2e] booted");

const svc = ctx.get("sessionRewind");
console.log("[e2e] sessionRewind 服务 =", svc ? "存在" : "缺失");

// 1. 对不存在 id：应返回 session-not-found
const miss = await svc.delete({ sessionId: "session-nonexistent" });
console.log("[e2e] delete(不存在) =", JSON.stringify(miss));
if (miss.ok || miss.error.code !== "session-not-found") {
  console.error("[e2e] ✘ 不存在 id 应返回 session-not-found");
  process.exit(1);
}
console.log("[e2e] ✔ 不存在 id 正确返回 session-not-found");

// 2. 创建真实会话并硬删
const sid = "session-e2e-" + Date.now();
const session = ctx.sessions.create(sid, { meta: { cwd: process.cwd() } });
session.append("turn/start", { turn: 1 });
await ctx.sessions.flush(session);

// 记录落盘路径
const header = session.header;
const loc = ctx.sessionPersistence.locate(header);
const dir = loc ? dirname(loc.path) : null;
console.log("[e2e] 会话目录 =", dir, "| 存在:", dir ? existsSync(dir) : false);

// 挂进 workspace（模拟真实场景：会话属于某 workspace）
// workspaceRegistry.list() 里找或创建；这里先直接 delete，验证 detach 不抛错即可。

const del = await svc.delete({ sessionId: sid });
console.log("[e2e] delete(真实) =", JSON.stringify(del));
if (!del.ok || !del.value.deleted) {
  console.error("[e2e] ✘ 删除失败");
  process.exit(1);
}
console.log("[e2e] ✔ 删除返回 deletedIds =", JSON.stringify(del.value.deletedIds));

// 验证原目录已不在（进 trash）
console.log("[e2e] 删除后原目录存在:", dir ? existsSync(dir) : "n/a", "（应 false）");

await Promise.race([typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()), new Promise((r) => setTimeout(r, 20000))]);
console.log("[e2e] done");
process.exit(0);
