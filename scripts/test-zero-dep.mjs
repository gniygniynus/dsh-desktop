// 验证零依赖方案：插件放 ~/.dsh/profiles/node_modules（而非全局 dsh 的 node_modules）能否被 harness 加载。
// 用干净隔离的 DSH_HOME 模拟"没装全局 dsh 的新机器"，并模拟 ensureInstalled 的落盘行为。
// 用法（Windows）：node scripts\test-zero-dep.mjs
//   （WSL 下需用 Windows node.exe："/mnt/c/Program Files/nodejs/node.exe" "D:\dsh-desktop\scripts\test-zero-dep.mjs"）
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

// 干净隔离的 DSH_HOME（.scratch-test 已 gitignore），模拟一台全新机器
const HOME = join(APP, ".scratch-test", "zero-dep-home");
process.env.DSH_HOME = HOME;
rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
console.log("[zero-dep] DSH_HOME =", HOME);

// 模拟 ensureInstalled：把插件物理拷进 profiles/node_modules + 写 cordis.patch.yml
const SRC = join(APP, "plugins", "dsh-session-rewind");
const DEST = join(HOME, "profiles", "node_modules", "@deepseek-ai", "dsh-session-rewind");
mkdirSync(dirname(DEST), { recursive: true });
cpSync(join(SRC, "package.json"), join(DEST, "package.json"));
cpSync(join(SRC, "lib"), join(DEST, "lib"), { recursive: true });
writeFileSync(join(HOME, "cordis.patch.yml"), "- insert:\n    - id: session-rewind\n      name: '@deepseek-ai/dsh-session-rewind'\n", "utf8");
console.log("[zero-dep] 已模拟 ensureInstalled →", DEST);

const lib = join(APP, "node_modules", "@deepseek-ai", "dsh", "lib");
let runProfile = null;
for (const f of readdirSync(lib)) {
  if (!f.startsWith("profile-boot-") || !f.endsWith(".js")) continue;
  try {
    const m = await import(pathToFileURL(join(lib, f)).href);
    if (typeof m.runProfile === "function") { runProfile = m.runProfile; break; }
  } catch {}
}
if (!runProfile) { console.error("[zero-dep] 找不到 runProfile"); process.exit(2); }

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
  console.error("[zero-dep] FAIL boot:", e.message);
  process.exit(3);
}
const { ctx, shutdown } = resumed;
console.log("[zero-dep] harness booted ✔");

// 等 typert effect 注册
await new Promise((r) => setTimeout(r, 3000));

// 1. host 插件服务是否被实例化（零依赖核心判定）
let svc = null;
try { svc = ctx.get("sessionRewind"); } catch (e) { console.log("[zero-dep] ctx.get('sessionRewind') 抛错:", e.message); }
console.log("[zero-dep] ctx.get('sessionRewind') =", svc ? "存在 ✔ 零依赖成功" : "缺失 ✘");

// 2. 插件目录是否被 heal 清掉（heal 只重建闭包内 symlink，不应删非闭包的真实目录）
console.log("[zero-dep] 插件目录仍在 =", existsSync(join(DEST, "package.json")) ? "✔" : "✘（被 heal 清掉）");

// 3. 诊断：loader entry + typert 注册表（若缺失，看这里定位）
try {
  const loader = ctx.get("loader");
  for (const e of loader.entries()) {
    if (e.options.name.includes("session-rewind")) {
      console.log(`[zero-dep] loader entry ${e.options.name}: fiber=${e.fiber !== void 0}, disabled=${e.disabled}`);
    }
  }
} catch (e) { console.log("[zero-dep] loader 检查失败:", e.message); }

await Promise.race([
  typeof shutdown === "function" ? shutdown() : (shutdown?.shutdown?.() || Promise.resolve()),
  new Promise((r) => setTimeout(r, 20000)),
]);
console.log("[zero-dep] done");
process.exit(svc ? 0 : 1);
