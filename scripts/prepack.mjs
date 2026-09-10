// 打包前准备（幂等，可重复跑），由 `npm run dist` 在 electron-builder 前调用：
// 1. 4 个 client 编译产物补丁（打进 node_modules，运行时只读改不了）
// 2. 禁用 profile-boot 里的 HMR——cordis-plugin-hmr 需要 --expose-internals，打包后 Electron 不提供该 flag，
//    会导致启动 fatal；HMR 只是热重载，生产打包不需要。
import { readdirSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyApiRemotesPatch, applyWorkspaceDeletePatch, applyChatRewindPatch, applySettingsModelsPatch } from "../patches/apply-session-rewind.js";
import { applyCredentialsLocal, applyApiproxy, applySettingsModels, applyClientConnection } from "../patches/apply-provider-editor.js";
import { applyDirectoryPicker } from "../patches/apply-directory-picker.js";
import { applyModelEditor } from "./patch-model-editor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

function applyHmrPatch() {
  const libDir = join(APP, "node_modules", "@deepseek-ai", "dsh", "lib");
  const files = readdirSync(libDir).filter((f) => f.startsWith("profile-boot-") && f.endsWith(".js"));
  const MARK = "// [dsh-desktop] HMR disabled";
  const ANCHOR = '\tif (composed.profile.patchReload === "live" && !signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {';
  // profile-boot-* 可能有多个文件（stub + 真实现），只 patch 含 HMR 块的那个
  let target = null;
  for (const f of files) {
    const p = join(libDir, f);
    const src = readFileSync(p, "utf8");
    if (src.includes(MARK)) return { target: p, changed: false };
    if (src.includes(ANCHOR)) { target = p; break; }
  }
  if (target === null) throw new Error("未找到 HMR 块锚点，版本可能已变动");
  const src = readFileSync(target, "utf8");
  writeFileSync(target, src.replace(ANCHOR, '\tif (false) try { ' + MARK), "utf8");
  return { target, changed: true };
}

// 把 host 插件同步到项目 node_modules，打包后随 app 进入安装目录的 node_modules。
// 这样 cordis-plugin-loader 能从它自己的位置 parent-walk 解析到插件（放 ~/.dsh/profiles/node_modules 不行）。
function applyPluginSync() {
  const src = join(APP, "plugins", "dsh-session-rewind");
  const dest = join(APP, "node_modules", "@deepseek-ai", "dsh-session-rewind");
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, "package.json"), join(dest, "package.json"));
  cpSync(join(src, "lib"), join(dest, "lib"), { recursive: true });
  return { changed: true };
}

let failed = false;
// optional 标记的补丁失败时只警告不退出（新版可能改变了接口）
for (const [label, apply, optional] of [
  ["api-remotes", applyApiRemotesPatch],
  ["workspace", applyWorkspaceDeletePatch],
  ["conversation", applyChatRewindPatch],
  ["settings-models", applySettingsModelsPatch],
  ["hmr-disable", applyHmrPatch],
  ["credentials-local", applyCredentialsLocal],
  ["apiproxy-cred", applyApiproxy, true],       // dsh-host-apiproxy 在新版已移除
  ["settings-provider", applySettingsModels, true], // ProviderEditor 接口已变
  ["client-connection-cred", applyClientConnection, true], // 接口已变
  ["directory-picker", applyDirectoryPicker],
  ["model-editor", applyModelEditor],
  ["plugin-sync", applyPluginSync],
]) {
  try {
    const r = apply();
    console.log(`[prepack] ${label}: ${r.changed ? "已打补丁" : "已是最新（跳过）"}`);
  } catch (e) {
    if (optional) {
      console.warn(`[prepack] ${label} 跳过（接口已变，不影响主功能）: ` + (e.message || String(e)).slice(0, 120));
    } else {
      failed = true;
      console.error(`[prepack] ${label} 失败: ` + (e.message || String(e)));
    }
  }
}
process.exit(failed ? 1 : 0);
