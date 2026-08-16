// 打包前准备（幂等，可重复跑），由 `npm run dist` 在 electron-builder 前调用：
// 1. 4 个 client 编译产物补丁（打进 node_modules，运行时只读改不了）
// 2. 禁用 profile-boot 里的 HMR——cordis-plugin-hmr 需要 --expose-internals，打包后 Electron 不提供该 flag，
//    会导致启动 fatal；HMR 只是热重载，生产打包不需要。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyApiRemotesPatch, applyWorkspaceDeletePatch, applyConversationRewindPatch, applySettingsModelsPatch } from "../patches/apply-session-rewind.js";
import { applyCredentialsLocal, applyApiproxy, applySettingsModels, applyClientConnection } from "../patches/apply-provider-editor.js";
import { applyDirectoryPicker } from "../patches/apply-directory-picker.js";
import { applyModelEditor } from "./patch-model-editor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

function applyHmrPatch() {
  const libDir = join(APP, "node_modules", "@deepseek-ai", "dsh", "lib");
  const files = readdirSync(libDir).filter((f) => f.startsWith("profile-boot-") && f.endsWith(".js"));
  const MARK = "// [dsh-desktop] HMR disabled";
  const ANCHOR = '\tif (!signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {';
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

let failed = false;
for (const [label, apply] of [
  ["api-remotes", applyApiRemotesPatch],
  ["workspace", applyWorkspaceDeletePatch],
  ["conversation", applyConversationRewindPatch],
  ["settings-models", applySettingsModelsPatch],
  ["hmr-disable", applyHmrPatch],
  ["credentials-local", applyCredentialsLocal],
  ["apiproxy-cred", applyApiproxy],
  ["settings-provider", applySettingsModels],
  ["client-connection-cred", applyClientConnection],
  ["directory-picker", applyDirectoryPicker],
  ["model-editor", applyModelEditor],
]) {
  try {
    const r = apply();
    console.log(`[prepack] ${label}: ${r.changed ? "已打补丁" : "已是最新（跳过）"}`);
  } catch (e) {
    failed = true;
    console.error(`[prepack] ${label} 失败: ` + (e.message || String(e)));
  }
}
process.exit(failed ? 1 : 0);
