// 隔离复现 HMR 报错 / 验证"禁用 hmr+client-hmr"patch 是否让 web profile 正常 boot。
// 用法：node scripts/test-boot-hmr.mjs [patched|bare]
// DSH_HOME 固定指向 .dev-dsh（绝不碰真实 .dsh）。
import { readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
const MODE = process.argv[2] || "bare";
process.env.DSH_HOME = join(APP, ".dev-dsh");

console.log("[hmr-test] DSH_HOME =", process.env.DSH_HOME, "| mode =", MODE);

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

// patch 文件：禁用 host hmr 与其触发的 client-hmr
const patchFile = join(APP, ".scratch-test", "disable-hmr.yml");
if (MODE === "patched") {
  mkdirSync(dirname(patchFile), { recursive: true });
  writeFileSync(patchFile, "[\n  { id: hmr, disabled: true },\n  { id: client-hmr, disabled: true }\n]\n", "utf8");
}

const timeout = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms));

let resumed;
try {
  resumed = await Promise.race([
    runProfile({ environment, profile: "web", patchFiles: MODE === "patched" ? [patchFile] : [], args: ["--port", "0"] }),
    timeout(90000, "runProfile boot"),
  ]);
} catch (e) {
  console.error("[hmr-test] FAIL runProfile:", e.message);
  const seen = new Set();
  const walk = (x, d) => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    console.log("  ".repeat(d) + "• " + (x.message || String(x)));
    if (Array.isArray(x.errors)) x.errors.forEach((q) => walk(q, d + 1));
    if (x.cause) walk(x.cause, d + 1);
  };
  walk(e, 0);
  console.log("[hmr-test] 结果 =", e.message.includes("expose-internals") ? "HMR错误复现（bare 预期）" : "FAILED");
  process.exit(3);
}
const { ctx, shutdown } = resumed;
console.log("[hmr-test] harness booted ✔");

let port = 0;
for (let i = 0; i < 30 && !port; i++) {
  const ws = ctx.get("webServer");
  if (ws?.port) { port = ws.port; break; }
  await new Promise((r) => setTimeout(r, 500));
}
console.log("[hmr-test] webServer port =", port || "未就绪");
if (port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    console.log("[hmr-test] /health ->", res.status);
  } catch (e) { console.log("[hmr-test] /health fecth err:", e.message); }
}
await Promise.race([typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || shutdown?.(), Promise.resolve()),
  new Promise((r) => setTimeout(r, 20000))]);
console.log("[hmr-test] done (模式 " + MODE + ")");
process.exit(0);