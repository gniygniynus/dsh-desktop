// M0b 验证：在普通 node 进程内用 runProfile 把 harness web profile 跑起来（Electron 主进程同款路径）
// 用法：DSH_HOME=<你的dsh目录> node scripts/test-boot.mjs
// 说明：不依赖任何 GUI，验证「进程内嵌 harness」可行。
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadLayeredEnv } from "@deepseek-ai/dsh-app-boot";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

async function loadRunProfile() {
  const libDir = join(APP, "node_modules", "@deepseek-ai", "dsh", "lib");
  for (const file of readdirSync(libDir)) {
    if (!file.startsWith("profile-boot-") || !file.endsWith(".js")) continue;
    const fullPath = join(libDir, file);
    const src = readFileSync(fullPath, "utf8");
    if (!src.includes("runProfile")) continue;
    const mod = await import(pathToFileURL(fullPath).href);
    if (typeof mod.runProfile === "function") return mod.runProfile;
  }
  throw new Error("无法找到 @deepseek-ai/dsh/lib/profile-boot-*.js 中的 runProfile 导出");
}

// 允许环境变量覆盖，否则走默认
const DSH_HOME = process.env.DSH_HOME || resolveDshHome();
process.env.DSH_HOME = DSH_HOME;
console.log("[boot-test] DSH_HOME =", DSH_HOME);

const timeout = (ms, what) =>
  new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: " + what)), ms));

const environment = await loadLayeredEnv("dsh");
const runProfile = await loadRunProfile();

let resumed;
try {
  resumed = await Promise.race([
    runProfile({ environment, profile: "web", patchFiles: [], args: ["--port", "0", "--no-open"] }),
    timeout(60000, "runProfile boot"),
  ]);
} catch (e) {
  console.error("[boot-test] FAIL runProfile:", e.message);
  // 展开 AggregatedError 与 cause 链
  const stack = [];
  const seen = new Set();
  const walk = (x, d) => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    try { stack.push("  ".repeat(d) + "• " + (x.message || String(x)) + (x.code ? " [" + x.code + "]" : "")); } catch {}
    if (Array.isArray(x.errors)) x.errors.forEach((q) => walk(q, d + 1));
    if (x.cause) walk(x.cause, d + 1);
  };
  walk(e, 0);
  console.error(stack.slice(0, 24).join("\n"));
  process.exit(2);
}
const { ctx, shutdown } = resumed;
console.log("[boot-test] harness booted ✔");

// 等 webServer 起来并拿端口
let port;
for (let i = 0; i < 20; i++) {
  const ws = ctx.get("webServer");
  if (ws?.port) { port = ws.port; break; }
  await new Promise((r) => setTimeout(r, 500));
}
if (!port) { console.error("[boot-test] FAIL webServer port 未就绪"); await shutdown(); process.exit(3); }
console.log("[boot-test] webServer on 127.0.0.1:" + port);

const connection = ctx.get("connection");
const url = typeof connection?.authenticatedUrl === "function"
  ? connection.authenticatedUrl(`http://127.0.0.1:${port}`)
  : `http://127.0.0.1:${port}/`;
const res = await Promise.race([
  fetch(url, { redirect: "manual" }),
  timeout(10000, "authenticated root fetch"),
]);
console.log("[boot-test] authenticated / ->", res.status);
if (![200, 302, 303, 307, 308].includes(res.status)) {
  console.error("[boot-test] FAIL authenticated root returned", res.status);
  process.exit(4);
}

console.log("[boot-test] 关闭 harness…");
const stop = typeof shutdown === "function" ? shutdown : shutdown?.shutdown?.bind(shutdown);
if (typeof stop !== "function") {
  console.error("[boot-test] FAIL shutdown handle invalid");
  process.exit(5);
}
await Promise.race([stop(), timeout(20000, "shutdown")]);
console.log("[boot-test] shutdown ok ✔ M0b 通过");
process.exit(0);
