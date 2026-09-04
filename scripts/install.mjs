// 一键安装：把 dsh-session-rewind 插件 + client 补丁装进真实环境。
// 用法（在 Windows 上跑，os.homedir() 才指向 C:\Users\Lenovo）：
//   node scripts/install.mjs
// 三件事：
//   1. 复制插件源码到全局 harness node_modules（Electron 壳 loader 从 ~/.dsh/node_modules 解析，插件必须在那）
//   2. 应用 client 编译产物补丁（remote 挂载 + 删除/撤回/重新回答/粘贴识别）
//   3. 创建/追加 ~/.dsh/cordis.patch.yml（home 级 patch，注入 host 插件）
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { applyApiRemotesPatch, applyWorkspaceDeletePatch, applyConversationRewindPatch, applySettingsModelsPatch } from "../patches/apply-session-rewind.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
const SRC = join(APP, "plugins", "dsh-session-rewind");

// 全局 harness node_modules（通过 ~/.dsh/node_modules symlink 解析到真实位置）。
// Electron 壳用真实 ~/.dsh，loader 从 ~/.dsh/profiles/web 解析，经 ~/.dsh/node_modules 找到插件，
// 所以插件必须放在全局 harness 的 node_modules 里，不能放项目 node_modules（不在解析链）。
function resolveDshNodeModules() {
  const link = join(homedir(), ".dsh", "node_modules");
  try {
    return realpathSync(link);
  } catch {
    // fallback：npm 全局安装位置（Windows）
    return join(homedir(), "AppData", "Roaming", "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules");
  }
}
const DEST = join(resolveDshNodeModules(), "@deepseek-ai", "dsh-session-rewind");

// 1. 复制插件到全局 harness node_modules
if (!existsSync(join(SRC, "package.json"))) {
  console.error("[install] 找不到插件源码:", SRC);
  process.exit(1);
}
mkdirSync(dirname(DEST), { recursive: true });
// 注意：若 Electron app 正在运行，Windows 文件锁可能导致删除/写入失败。
// 安装前请先退出 dsh-desktop。
try {
  rmSync(DEST, { recursive: true, force: true });
} catch (e) {
  console.error("[install] 无法删除旧插件（可能有进程正在使用），请先退出 dsh-desktop 再重试：", String(e));
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });
cpSync(join(SRC, "package.json"), join(DEST, "package.json"));
cpSync(join(SRC, "lib"), join(DEST, "lib"), { recursive: true });
console.log("[install] 插件已复制 →", DEST);

// 2. 应用 client 补丁
let patchFailed = false;
for (const apply of [applyApiRemotesPatch, applyWorkspaceDeletePatch, applyConversationRewindPatch, applySettingsModelsPatch]) {
  try {
    const r = apply();
    console.log(`[install] ${r.label}: ${r.changed ? "已打补丁" : "已是最新（跳过）"}`);
  } catch (e) {
    patchFailed = true;
    console.error("[install] " + e.message);
  }
}
if (patchFailed) {
  console.error("[install] 部分补丁失败，安装未完成。");
  process.exit(1);
}

// 3. 创建/追加 ~/.dsh/cordis.patch.yml（home 级 patch，注入 host 插件）
const homePatch = join(homedir(), ".dsh", "cordis.patch.yml");
const entry = "- insert:\n    - id: session-rewind\n      name: '@deepseek-ai/dsh-session-rewind'";
if (existsSync(homePatch)) {
  const content = readFileSync(homePatch, "utf8");
  const trimmed = content.trim();
  // 空数组 `[]` 或空文件：直接覆盖成 entry（否则追加会造成两个顶层 YAML 数组，非法）
  if (/^\[[\s]*\]$/.test(trimmed) || trimmed === "") {
    writeFileSync(homePatch, entry + "\n", "utf8");
    console.log("[install] 已写入", homePatch);
  } else if (content.includes("session-rewind")) {
    console.log("[install] ~/.dsh/cordis.patch.yml 已含 session-rewind，跳过");
  } else {
    writeFileSync(homePatch, content.trimEnd() + "\n" + entry + "\n", "utf8");
    console.log("[install] 已追加 session-rewind 到", homePatch);
  }
} else {
  writeFileSync(homePatch, entry + "\n", "utf8");
  console.log("[install] 已创建", homePatch);
}

console.log("[install] 完成。重启 npx electron . 生效。");
