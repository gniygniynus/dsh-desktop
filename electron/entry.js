// Electron 入口引导：确保 Node internals（--expose-internals）在真实 Electron 里可用。
//
// 原因：内嵌 harness 的 cordis-plugin-hmr 需要读 internal/modules/esm/loader（用于热更/真读配置文件），
// 而该能力只有进程启动时带 --expose-internals 才会真的开放——纯 `process.execArgv.push()` 不够，
// Electron 里 node-addon-require-builtin 的那条替代路又失效（Elecron 的 Node 内部结构读不到）。
// 所以：首启若检测到 internals 未暴露 → 用带 --expose-internals 的新进程重启自己（环境变量标记防死循环）。
// 开发（npx electron .）和打包后的 exe 都走同一个入口，无需用户设任何环境变量。
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
let exposed = false;
try { require("internal/modules/esm/loader"); exposed = true; } catch {}

if (!exposed && !process.env.DSH_DESKTOP_EXPOSED) {
  // flag 必须放在应用路径之前，Electron 才会消费它并把 internals 交给 Node。
  const child = spawnSync(
    process.execPath,
    ["--expose-internals", ...process.argv.slice(1)],
    { stdio: "inherit", env: { ...process.env, DSH_DESKTOP_EXPOSED: "1" } },
  );
  process.exit(child.status ?? 0);
}

// 让 harness 的 loader 判定走「直接 require internal」这条路（绕开 Electron 失效的原生 addon）。
if (!process.execArgv.includes("--expose-internals")) process.execArgv.push("--expose-internals");

await import("./main.js");