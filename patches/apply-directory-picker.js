// 目录选择器 Electron 桥接（幂等）：
// harness 的 Windows 目录选择器用 koffi 起子进程弹 COM 对话框，子进程靠 process.execPath（node.exe）启动；
// 在 Electron 壳里 process.execPath 是 dsh-desktop.exe，子进程起不来 → 对话框弹不出。
// 这里在 Electron 环境改用 Electron 原生 dialog.showOpenDialog（主进程内可用）。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

function applyDirectoryPicker() {
  const target = join(APP, "node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/index.js");
  const src = readFileSync(target, "utf8");
  const from = '\tif (platform === "win32") return await (internals.pickWin32Dialog ?? pickWin32Directory)(signal);';
  const to = '\tif (platform === "win32") {\n' +
    '\t\tif (process.versions.electron !== void 0) {\n' +
    '\t\t\ttry {\n' +
    '\t\t\t\tconst { dialog } = await import("electron");\n' +
    '\t\t\t\tconst result = await dialog.showOpenDialog({ title: DIALOG_TITLE, properties: ["openDirectory"] });\n' +
    '\t\t\t\treturn result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];\n' +
    '\t\t\t} catch {}\n' +
    '\t\t}\n' +
    '\t\treturn await (internals.pickWin32Dialog ?? pickWin32Directory)(signal);\n' +
    '\t}';
  if (src.includes(to)) return { target, changed: false };
  if (!src.includes(from)) throw new Error("[directory-picker] 锚点缺失");
  writeFileSync(target, src.replace(from, to), "utf8");
  return { target, changed: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = applyDirectoryPicker();
  console.log(`[directory-picker] ${r.changed ? "已打补丁" : "已是最新（跳过）"}`);
}

export { applyDirectoryPicker };
