// harness 生命周期：在 Electron 主进程内嵌启动/停止/重启 web profile
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = join(__dirname, "..");

let _runProfilePromise;
async function getRunProfile() {
  if (!_runProfilePromise) _runProfilePromise = (async () => {
    const dshLib = join(APP_ROOT, "node_modules", "@deepseek-ai", "dsh", "lib");
    if (!existsSync(dshLib)) throw new Error("[harness] 找不到 @deepseek-ai/dsh（未安装依赖？）: " + dshLib);
    for (const f of readdirSync(dshLib)) {
      if (!f.startsWith("profile-boot-") || !f.endsWith(".js")) continue;
      try {
        const mod = await import(pathToFileURL(join(dshLib, f)).href);
        if (typeof mod.runProfile === "function") return mod.runProfile;
      } catch {}
    }
    throw new Error("[harness] lib 里没有 runProfile 导出");
  })();
  return _runProfilePromise;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { ctx: null, shutdown: null, port: 0, booting: null };

export function harnessPort() { return state.port; }

export async function startHarness(profile = "web") {
  if (state.booting) return state.booting;
  state.booting = (async () => {
    // UA 补丁（幂等）
    const { applyUaPatch } = await import("../patches/apply.js");
    applyUaPatch();

    process.env.DSH_HOME ||= join(os.homedir(), ".dsh");

    const { loadLayeredEnv } = await import("@deepseek-ai/dsh-app-boot");
    const environment = await loadLayeredEnv("dsh");
    const runProfile = await getRunProfile();

    // 允许 DSH_DESKTOP_PORT 覆盖默认 3080
    const portArg = process.env.DSH_DESKTOP_PORT ? ["--port", String(process.env.DSH_DESKTOP_PORT)] : [];
    const { ctx, shutdown } = await runProfile({ environment, profile, patchFiles: [], args: [...portArg] });
    state.ctx = ctx;
    state.shutdown = shutdown;

    // 等 webServer 端口
    let port = 0;
    for (let i = 0; i < 40 && !port; i++) {
      const ws = ctx.get("webServer");
      if (ws?.port) port = ws.port;
      else await sleep(500);
    }
    if (!port) throw new Error("[harness] webServer 端口未就绪");
    state.port = port;
    return port;
  })().finally(() => { state.booting = null; });
  return state.booting;
}

export async function stopHarness() {
  if (state.shutdown) {
    try {
      // runProfile 返回的 shutdown 是控制器 { shutdown(), interrupt() }；优雅退出不强制 process.exit
      const ctl = state.shutdown;
      const call = typeof ctl === "function" ? ctl : ctl?.shutdown ? ctl.shutdown.bind(ctl) : ctl;
      await Promise.race([call(), new Promise((r) => setTimeout(r, 20000))]);
    } catch {}
  }
  state.ctx = null; state.shutdown = null; state.port = 0;
}

/** 静默重启：stop → start，返回新端口。 */
export async function restartHarness(profile = "web") {
  await stopHarness();
  return startHarness(profile);
}