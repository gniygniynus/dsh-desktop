// 诊断：真实 ~/.dsh 的模型目录（listProviders/listModels/resolveModelInfo）。
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
process.env.DSH_HOME = join("C:", "Users", "Lenovo", ".dsh");

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
console.log("[real-model] listProviders =", providers.map((p) => p.id));
for (const p of providers) {
  try {
    const models = await ctx.llm.listModels(p.id);
    console.log(`[real-model] listModels(${p.id}) =`, models.map((m) => m.id));
    for (const m of models) {
      try {
        await ctx.llm.resolveModelInfo(p.id, m.id);
        console.log(`  resolveModelInfo(${p.id}, ${m.id}) ok`);
      } catch (e) {
        console.log(`  resolveModelInfo(${p.id}, ${m.id}) FAIL:`, e.message);
      }
    }
  } catch (e) {
    console.log(`[real-model] listModels(${p.id}) FAIL:`, e.message);
  }
}

await Promise.race([typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()), new Promise((r) => setTimeout(r, 20000))]);
process.exit(0);
