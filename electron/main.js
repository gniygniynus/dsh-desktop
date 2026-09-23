// Electron 主进程：窗口 + 内嵌 harness + IPC 路由
import { app, BrowserWindow, ipcMain, dialog, session, shell } from "electron";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, statSync, renameSync, rmSync } from "node:fs";
import { applyUaPatch } from "../patches/apply.js";
import { startHarness, harnessPort, harnessUrl } from "./harness-lifecycle.js";
import { ensureInstalled } from "./ensure-installed.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

async function seedHarnessCookie(port, url) {
  // dsh 0.1.5 web UI 用 token→cookie 认证。webview 从 file:// 加载 http://127.0.0.1 属跨站，
  // SameSite=Strict 的 cookie 不会在 webview 里自动保留 → 黑屏/认证提示。
  // 这里用 node:http 访问带 token 的 URL，把 Set-Cookie 预种进 webview 的固定分区
  // （persist:dsh-harness），webview 后续请求就能带上 cookie。
  try {
    const { request } = await import("node:http");
    const raw = await new Promise((resolve, reject) => {
      const req = request(url, { method: "GET" }, (res) => {
        const setCookies = res.headers["set-cookie"] ?? [];
        res.resume(); // 丢弃响应体
        resolve(setCookies);
      });
      req.on("error", reject);
      req.end();
    });
    if (raw.length === 0) {
      // 既无 Set-Cookie 也无认证要求（token 直接生效），无需预种
      log("[auth] 未收到 Set-Cookie，跳过预种");
      return;
    }
    const harnessSession = session.fromPartition("persist:dsh-harness");
    for (const header of raw) {
      const [pair, ...rest] = header.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const attrs = [];
      for (const s of rest) {
        const [k, ...v] = s.trim().split("=");
        attrs.push([k.toLowerCase(), v.join("=")]);
      }
      const get = (k) => attrs.find(([key]) => key === k)?.[1];
      await harnessSession.cookies.set({
        url: `http://127.0.0.1:${port}`,
        name,
        value,
        httpOnly: true,
        secure: false,
        sameSite: get("samesite") === "lax" ? "lax" : get("samesite") === "none" ? "no_restriction" : "unspecified",
        expirationDate: get("max-age") ? Math.floor(Date.now() / 1000) + Number(get("max-age")) : undefined,
      });
    }
    log(`[auth] 已预种 ${raw.length} 个认证 cookie → ${port}`);
  } catch (e) {
    log("[auth] 预种 cookie 失败: " + (e?.message || String(e)));
  }
}

async function createWindow(port, url) {
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
  // 在主进程里预种认证 cookie 到 webview 分区（token→cookie）
  await seedHarnessCookie(port, url);
  await win.loadFile(resolve(__dirname, "..", "renderer", "index.html"), { query: { port: String(port) } });
  // 兜底：即使 renderer 先于 IPC 初始化，也可主动推一次授权 URL（幂等）
  if (win && !win.isDestroyed()) win.webContents.send("app:set-url", { port, url });
}

app.whenReady().then(async () => {
  try {
    // 首跑自装 host 插件 + cordis.patch.yml（幂等，失败不阻断启动，下次启动可重试）
    try {
      const r = ensureInstalled(join(__dirname, ".."));
      log("[install] 自装 " + (r.changed ? "完成（插件已就位）" : r.missing ? "跳过（插件源码未打包）" : "已是最新"));
    } catch (e) {
      log("[install] 自装失败（忽略，继续启动）: " + (e.message || String(e)));
    }
    // 清 webview 缓存：dsh-client-modules 的 /plugins bundle 会被磁盘缓存，导致 client 补丁不生效
    await session.defaultSession.clearCache();
    log("[app] webview 缓存已清");
    applyUaPatch();
    log("[app] UA 补丁已就绪");
    const { port, url } = await startHarness("web");
    log("[app] harness 就绪 @ " + port);
    await createWindow(port, url);
    log("[app] 窗口已创建");
    // 启动后 5 秒检查更新（不阻断启动）
    setTimeout(() => checkForUpdates(), 5000);
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
ipcMain.handle("app:get-url", () => ({ port: harnessPort(), url: harnessUrl() }));
// 渲染层诊断：把 renderer/webview 事件写进 desktop.log
ipcMain.on("renderer:log", (_e, msg) => log("[renderer] " + msg));

app.on("window-all-closed", () => app.quit());

// ---- 自动更新检测（启动后 5 秒，静默检查 GitHub Releases）----
const CURRENT_VERSION = app.getVersion();
const GITHUB_RELEASES_API = "https://api.github.com/repos/gniygniynus/dsh-desktop/releases/latest";

function checkForUpdates() {
  const https = require("node:https");
  const req = https.get(
    GITHUB_RELEASES_API,
    { headers: { "User-Agent": "dsh-desktop/" + CURRENT_VERSION } },
    (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const release = JSON.parse(data);
          const latestTag = release.tag_name?.replace(/^v/, "") ?? "";
          if (latestTag && latestTag !== CURRENT_VERSION && compareVersions(latestTag, CURRENT_VERSION) > 0) {
            log(`[updater] 发现新版本 ${latestTag}（当前 ${CURRENT_VERSION}），提示用户`);
            if (win && !win.isDestroyed()) {
              dialog.showMessageBox(win, {
                type: "info",
                title: "发现新版本",
                message: `dsh-desktop ${latestTag} 已发布`,
                detail: `当前版本：${CURRENT_VERSION}\n\n${release.body?.slice(0, 400) ?? ""}`,
                buttons: ["前往下载", "稍后再说"],
                defaultId: 0,
                cancelId: 1,
              }).then(({ response }) => {
                if (response === 0) {
                  const downloadUrl = release.html_url ?? "https://github.com/gniygniynus/dsh-desktop/releases";
                  shell.openExternal(downloadUrl);
                }
              });
            }
          } else {
            log(`[updater] 已是最新版本（${CURRENT_VERSION}）`);
          }
        } catch (e) {
          log("[updater] 解析响应失败: " + String(e));
        }
      });
    }
  );
  req.on("error", (e) => log("[updater] 检查更新失败: " + String(e)));
  req.setTimeout(10000, () => { req.destroy(); log("[updater] 检查更新超时"); });
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/), pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] ?? "0", 10), nb = parseInt(pb[i] ?? "0", 10);
    if (isNaN(na) || isNaN(nb)) continue;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}
