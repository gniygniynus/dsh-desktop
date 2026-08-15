// 诊断 host 插件在真实 ~/.dsh 下的加载 + delete/rewind 调用。
// 用法（Windows node）："/mnt/c/Program Files/nodejs/node.exe" "D:\dsh-desktop\scripts\test-host-check.mjs"
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
// 用真实 ~/.dsh（Electron 壳同款）
process.env.DSH_HOME = join("C:", "Users", "Lenovo", ".dsh");
console.log("[host-check] DSH_HOME =", process.env.DSH_HOME);

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
const { ctx } = resumed;
console.log("[host-check] booted");

// 等待 typert effect 注册完成
await new Promise((r) => setTimeout(r, 3000));

// 1. host 服务是否实例化
let svc = null;
try { svc = ctx.get("sessionRewind"); } catch (e) { console.log("  ctx.get('sessionRewind') 抛错:", e.message); }
console.log("[host-check] ctx.get('sessionRewind') =", svc ? "存在" : "缺失");

// 1b. baseUrl + loader entries（诊断 typert-loader 为何没发现插件）
console.log("[host-check] ctx.baseUrl =", ctx.baseUrl);
try {
  const loader = ctx.get("loader");
  for (const e of loader.entries()) {
    if (e.options.name.includes("session-rewind") || e.options.name.includes("message-feedback") || e.options.name.includes("dsh-goal")) {
      console.log(`[host-check] entry ${e.options.name}: fiber=${e.fiber !== void 0}, disabled=${e.disabled}`);
    }
  }
} catch (e) { console.log("[host-check] loader 检查失败:", e.message); }

// 2. typert 注册表里有没有 sessionRewind
try {
  const typert = ctx.get("typert");
  console.log("[host-check] typert 存在:", !!typert);
  if (typert) {
    console.log("[host-check] typert.schemas:", JSON.stringify(typert.schemas)?.slice(0, 400));
    console.log("[host-check] typert.remoteStore keys:", typert.remoteStore ? Object.keys(typert.remoteStore) : "无");
    console.log("[host-check] remoteStore.packages:", JSON.stringify(typert.remoteStore?.packages));
    console.log("[host-check] remoteStore.descriptors:", JSON.stringify(typert.remoteStore?.descriptors)?.slice(0, 800));
    console.log("[host-check] typert.register 类型:", typeof typert.register);
    // 手动 register 验证 typert.register 是否工作
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(ctx.baseUrl);
      const pkg = req.resolve("@deepseek-ai/dsh-session-rewind/package.json");
      const hostMod = await import("file:///" + pkg.replace(/package\.json$/, "lib/typert.host.js"));
      const disposer = typert.register(hostMod.TYPERT);
      await new Promise((r) => setTimeout(r, 1000));
      console.log("[host-check] 手动 register 后 packages:", JSON.stringify(typert.remoteStore?.packages ? [...typert.remoteStore.packages.keys()] : "无"));
    } catch (e2) { console.log("[host-check] 手动 register 失败:", e2.message); }
    console.log("[host-check] typert.localStore keys:", typert.localStore ? Object.keys(typert.localStore) : "无");
    console.log("[host-check] typert.packages:", JSON.stringify(typert.packages));
  }
} catch (e) {
  console.log("[host-check] typert 检查失败:", e.message);
}

// 3. 直接调 delete（不存在的 id）
if (svc) {
  try {
    const r = await svc.delete({ sessionId: "session-nonexistent" });
    console.log("[host-check] delete(不存在) =", JSON.stringify(r));
  } catch (e) {
    console.log("[host-check] delete 抛错:", e.message);
  }
}

// 4. 检查 apiProxy 的 sessions.fork 可用性（rewind 依赖）
try {
  const apiProxy = ctx.get("apiProxy");
  console.log("[host-check] apiProxy 存在:", !!apiProxy, "| sessions.fork:", typeof apiProxy?.sessions?.fork);
} catch (e) {
  console.log("[host-check] apiProxy 检查失败:", e.message);
}

// 5. 检查 clientModules 的 graph（rev 是否对应最新 client.js）
try {
  const cm = ctx.get("clientModules");
  const entries = cm?.graph?.()?.entries?.map((e) => e.id + "@" + e.rev);
  console.log("[host-check] clientModules workspace rev:", entries?.find((e) => e.includes("workspace")));
  console.log("[host-check] clientModules conversation rev:", entries?.find((e) => e.includes("conversation")));
  console.log("[host-check] clientModules api-remotes rev:", entries?.find((e) => e.includes("api-remotes")));
} catch (e) {
  console.log("[host-check] clientModules 检查失败:", e.message);
}

process.exit(0);
