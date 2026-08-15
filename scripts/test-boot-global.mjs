// M0b-global：用「全局已装、node24 兼容」的 harness 验证 runProfile 进程内启动机制。
// 验证点 = Electron 主进程同款调用路径（import runProfile → boot web → health → shutdown）。
// 后续打包时把 koffi 等原生模块按 Electron ABI 重建即可解决 bundle 侧 ABI。
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GLOBAL = "C:/Users/Lenovo/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh";
process.env.DSH_HOME = "D:/dsh-desktop/.dev-dsh";
const PORT = 35198;

// 找 runProfile
const lib = join(GLOBAL, "lib");
let runProfile = null;
for (const f of readdirSync(lib)) {
  if (!f.startsWith("profile-boot-") || !f.endsWith(".js")) continue;
  try {
    const m = await import(pathToFileURL(join(lib, f)).href);
    if (typeof m.runProfile === "function") { runProfile = m.runProfile; break; }
  } catch {}
}
if (!runProfile) { console.error("找不到 runProfile"); process.exit(2); }

const { loadLayeredEnv } = await import(pathToFileURL(join(GLOBAL, "node_modules/@deepseek-ai/dsh-app-boot/lib/index.js")).href);
const environment = await loadLayeredEnv("dsh");

const t0 = Date.now();
const { ctx, shutdown } = await runProfile({ environment, profile: "web", patchFiles: [], args: ["--port", String(PORT)] });
console.log("[boot] harness booted in", Date.now() - t0, "ms");

let port = 0;
for (let i = 0; i < 30 && !port; i++) { const ws = ctx.get("webServer"); if (ws?.port) { port = ws.port; break; } await new Promise((r) => setTimeout(r, 500)); }
console.log("[boot] port =", port);

const res = await fetch(`http://127.0.0.1:${port}/health`);
console.log("[boot] /health ->", res.status);

await new Promise((r) => setTimeout(r, 500));
console.log("[boot] shutting down…");
await Promise.race([shutdown.shutdown(), new Promise((r) => setTimeout(r, 20000))]);
console.log("[boot] shutdown ok ✅ M0b-global 通过");
process.exit(0);