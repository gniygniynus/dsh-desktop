// 验证 session-rewind host 插件被 harness 加载。
// 用法：node scripts/test-plugin-boot.mjs
// DSH_HOME 固定 .dev-dsh；插件经 .dev-dsh/cordis.patch.yml 注入。
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
process.env.DSH_HOME = join(APP, ".dev-dsh");
console.log("[plugin-boot] DSH_HOME =", process.env.DSH_HOME);

const lib = join(APP, "node_modules", "@deepseek-ai", "dsh", "lib");
let runProfile = null;
for (const f of readdirSync(lib)) {
  if (!f.startsWith("profile-boot-") || !f.endsWith(".js")) continue;
  try {
    const m = await import(pathToFileURL(join(lib, f)).href);
    if (typeof m.runProfile === "function") { runProfile = m.runProfile; break; }
  } catch {}
}
if (!runProfile) { console.error("找不到 runProfile"); process.exit(2); }

const { loadLayeredEnv } = await import(pathToFileURL(join(APP, "node_modules/@deepseek-ai/dsh-app-boot/lib/index.js")).href);
const environment = await loadLayeredEnv("dsh");

const timeout = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms));

let resumed;
try {
  resumed = await Promise.race([
    runProfile({ environment, profile: "web", patchFiles: [], args: ["--port", "0"] }),
    timeout(90000, "runProfile boot"),
  ]);
} catch (e) {
  console.error("[plugin-boot] FAIL runProfile:", e.message);
  const seen = new Set();
  const walk = (x, d) => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    console.log("  ".repeat(d) + "• " + (x.message || String(x)));
    if (Array.isArray(x.errors)) x.errors.forEach((q) => walk(q, d + 1));
    if (x.cause) walk(x.cause, d + 1);
  };
  walk(e, 0);
  process.exit(3);
}
const { ctx, shutdown } = resumed;
console.log("[plugin-boot] harness booted ✔");

// 1. 服务实例是否被 cordis 实例化
let svc = null;
try { svc = ctx.get("sessionRewind"); } catch (e) { console.log("  ctx.get('sessionRewind') 抛错:", e.message); }
console.log("[plugin-boot] ctx.get('sessionRewind') =", svc ? "存在 ✔" : "缺失 ✘");

// 2. typert 注册表里是否有 sessionRewind（gateway 是否能发现）
try {
  const typert = ctx.get("typert");
  const reg = typert?.registry ?? typert?.list ?? typert;
  console.log("[plugin-boot] typert 服务 =", typert ? "存在" : "缺失");
  if (typert) console.log("[plugin-boot] typert keys =", Object.keys(typert));
} catch (e) {
  console.log("[plugin-boot] typert 检查失败:", e.message);
}

// 3. webServer 是否起来（确认 boot 完整）
let port = 0;
for (let i = 0; i < 30 && !port; i++) {
  const ws = ctx.get("webServer");
  if (ws?.port) { port = ws.port; break; }
  await new Promise((r) => setTimeout(r, 500));
}
console.log("[plugin-boot] webServer port =", port || "未就绪");

await Promise.race([
  typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()),
  new Promise((r) => setTimeout(r, 20000)),
]);
console.log("[plugin-boot] done");
process.exit(0);
