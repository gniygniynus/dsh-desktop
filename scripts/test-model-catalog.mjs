// 诊断：主页模型 catalog 为什么没 bbying-me。用 clean-home 的配置 boot。
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
process.env.DSH_HOME = join(APP, ".scratch-test", "clean-home");

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
const { ctx, shutdown } = await Promise.race([
  runProfile({ environment, profile: "web", patchFiles: [], args: ["--port", "0"] }),
  timeout(90000, "runProfile boot"),
]);

const providers = ctx.llm.listProviders();
console.log("[model-diag] listProviders =", providers.map((p) => p.id + "(" + p.name + ")"));

for (const p of providers) {
  try {
    const models = await ctx.llm.listModels(p.id);
    console.log(`[model-diag] listModels(${p.id}) =`, models.map((m) => m.id));
    for (const m of models) {
      try {
        const info = await ctx.llm.resolveModelInfo(p.id, m.id);
        console.log(`  resolveModelInfo(${p.id}, ${m.id}) ok`);
      } catch (e) {
        console.log(`  resolveModelInfo(${p.id}, ${m.id}) FAIL:`, e.message);
      }
    }
  } catch (e) {
    console.log(`[model-diag] listModels(${p.id}) FAIL:`, e.message);
  }
}

// 也查 settings 里的 llm-pi-ai 原始值
try {
  const settings = ctx.get("settings");
  const sec = settings.section?.("llm-pi-ai") ?? settings.describe({}).find((d) => d.ns === "llm-pi-ai")?.value;
  console.log("[model-diag] llm-pi-ai value =", JSON.stringify(sec?.providers ? Object.keys(sec.providers) : sec));
} catch (e) {
  console.log("[model-diag] settings 查询失败:", e.message);
}

await Promise.race([typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()), new Promise((r) => setTimeout(r, 20000))]);
process.exit(0);
