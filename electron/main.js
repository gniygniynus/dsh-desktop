// Electron 主进程：窗口 + 内嵌 harness + IPC 路由
import { app, BrowserWindow, ipcMain, dialog, session } from "electron";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, statSync, renameSync, rmSync } from "node:fs";
import { applyUaPatch } from "../patches/apply.js";
import { startHarness, harnessPort } from "./harness-lifecycle.js";
import { ensureInstalled } from "./ensure-installed.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
let win;

// ---- 启动日志：所有报错都落盘 desktop.log（诊断用，不打印敏感信息）----
const LOG_FILE = join(__dirname, "..", "desktop.log");
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 超过 5MB 轮转一次，避免日志无限增长
function rotateLogIfNeeded() {
  try {
    if (statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      rmSync(LOG_FILE + ".1", { force: true });
      renameSync(LOG_FILE, LOG_FILE + ".1");
    }
  } catch {}
}
rotateLogIfNeeded();
function log(...msgs) {
  const line = `[${new Date().toISOString()}] ${msgs.join(" ")}`;
  try { appendFileSync(LOG_FILE, line + "\n", "utf8"); } catch {}
  console.log(line);
}
// 把 harness boot 的 stdout/stderr 也 tee 进日志（它们通常是诊断关键）
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, enc, cb) => {
    try { appendFileSync(LOG_FILE, String(chunk), "utf8"); } catch {}
    return write(chunk, enc, cb);
  };
}

/** 把 AggregatedError/cause 链展平成便于阅读的行（保留最内层 code） */
function flattenError(e) {
  const out = [];
  const seen = new Set();
  const walk = (x, d) => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push("  ".repeat(d) + (x.message || String(x)) + (x.code ? ` [${x.code}]` : ""));
    if (Array.isArray(x.errors)) x.errors.forEach((q) => walk(q, d + 1));
    if (x.cause) walk(x.cause, d + 1);
  };
  walk(e, 0);
  return out;
}

async function createWindow(port) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "dsh-desktop",
    backgroundColor: "#14161a",
    show: false, // 静默：等渲染就绪再显示，避免白屏闪现
    autoHideMenuBar: true, // 像正常 app：隐藏菜单栏（Alt 可唤出）
    webPreferences: {
      preload: resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false, // 必须关：默认沙箱不允许 ESM 形式的 preload，否则 window.dshDesktop 挂不上
    },
  });
  win.once("ready-to-show", () => win.show());
  await win.loadFile(resolve(__dirname, "..", "renderer", "index.html"), { query: { port: String(port) } });
  // 兜底：即使 query 没传成功，也主动把端口推给渲染层（幂等）
  if (win && !win.isDestroyed()) win.webContents.send("app:set-port", port);
}

app.whenReady().then(async () => {
  try {
    // 首跑自装 host 插件 + cordis.patch.yml（幂等，失败不阻断启动，下次启动可重试）
    try {
      const r = ensureInstalled();
      log("[install] 自装 " + (r.changed ? "完成（插件已就位）" : r.missing ? "跳过（插件源码未打包）" : "已是最新"));
    } catch (e) {
      log("[install] 自装失败（忽略，继续启动）: " + (e.message || String(e)));
    }
    // 清 webview 缓存：dsh-client-modules 的 /plugins bundle 会被磁盘缓存，导致 client 补丁不生效
    await session.defaultSession.clearCache();
    log("[app] webview 缓存已清");
    applyUaPatch();
    log("[app] UA 补丁已就绪");
    const port = await startHarness("web");
    log("[app] harness 就绪 @ " + port);
    await createWindow(port);
    log("[app] 窗口已创建");
  } catch (e) {
    log("[fatal] 启动失败 ========================================");
    for (const line of flattenError(e)) log(line);
    log("[fatal] Stack:");
    log((e && (e.stack || e.message)) || String(e));
    dialog.showErrorBox("dsh-desktop 启动失败", [(e && (e.message || e.stack)) || String(e), ...flattenError(e).slice(1, 12)].join("\n"));
    app.exit(1);
  }
});

ipcMain.handle("app:get-port", () => harnessPort());
// 渲染层诊断：把 renderer/webview 事件写进 desktop.log
ipcMain.on("renderer:log", (_e, msg) => log("[renderer] " + msg));

app.on("window-all-closed", () => app.quit());
