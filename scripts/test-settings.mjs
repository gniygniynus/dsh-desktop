// 诊断 settings 服务的 writable 与 describe（零依赖隔离 home）。
// 用法（Windows）：node scripts\test-settings.mjs
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, rmSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
process.env.DSH_HOME = join(APP, ".scratch-test", "settings-diag-home");
rmSync(process.env.DSH_HOME, { recursive: true, force: true });
mkdirSync(process.env.DSH_HOME, { recursive: true });

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
console.log("[settings-diag] booted");

const settings = ctx.get("settings");
console.log("[settings-diag] settings 存在:", !!settings);
console.log("[settings-diag] settings.writable =", settings?.writable);
console.log("[settings-diag] settings.documentPath =", settings?.documentPath);
console.log("[settings-diag] settings 构造器名 =", settings?.constructor?.name);
console.log("[settings-diag] settings keys =", settings ? Object.keys(settings).slice(0, 30) : "无");
try {
  const desc = settings.describe({ redactSecrets: true });
  console.log("[settings-diag] namespaces =", desc.map((d) => d.ns));
} catch (e) {
  console.log("[settings-diag] describe 抛错:", e.message);
}

await Promise.race([typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()), new Promise((r) => setTimeout(r, 20000))]);
process.exit(0);
