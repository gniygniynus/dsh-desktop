// Electron 主进程：窗口 + 内嵌 harness + IPC 路由
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyUaPatch } from "../patches/apply.js";
import { startHarness, stopHarness, harnessPort } from "./harness-lifecycle.js";
import { listSessions } from "./session-db.js";
import { deleteSession } from "./delete-session.js";
import { rollbackPreview, rollbackSession } from "./rollback.js";
import { importProvider } from "./provider-import.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
let win;

/** 手术类 IPC 统一：停 harness → 手术 → 重启 → 回新端口（静默，renderer 负责遮罩） */
async function withHarnessRestart(operation) {
  const overlay = win?.webContents; // 让 renderer 先弹遮罩
  if (overlay && !overlay.isDestroyed()) overlay.send("overlay", "show");
  try {
    await stopHarness();
    const result = await operation();
    const port = await startHarness("web");
    if (win && !win.isDestroyed()) win.webContents.send("harness:restarted", { port });
    return { ok: true, ...result, port };
  } finally {
    if (overlay && !overlay.isDestroyed()) overlay.send("overlay", "hide");
  }
}

async function createWindow(port) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "dsh-desktop",
    backgroundColor: "#14161a",
    webPreferences: {
      preload: resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  await win.loadFile(resolve(__dirname, "..", "renderer", "index.html"), { query: { port: String(port) } });
}

app.whenReady().then(async () => {
  try {
    applyUaPatch();
    console.log("[app] UA 补丁已就绪");
    const port = await startHarness("web");
    console.log("[app] harness 就绪 @ " + port);
    await createWindow(port);
    console.log("[app] 窗口已创建");
  } catch (e) {
    console.error("[app] 启动失败:", e);
    dialog.showErrorBox("dsh-desktop 启动失败", (e && (e.stack || e.message)) || String(e));
    app.exit(1);
  }
});

ipcMain.handle("sessions:list", () =>
  listSessions()
    .map(({ id, projectKey, header }) => ({ id, projectKey, title: header?.title || id }))
    .sort((a, b) => (a.title < b.title ? 1 : -1))
);

ipcMain.handle("sessions:preview", (_e, id, n) => rollbackPreview(id, n ?? 5));

ipcMain.handle("sessions:rollback", (e, { id, eventIndex }) =>
  withHarnessRestart(() => rollbackSession(id, eventIndex))
);

ipcMain.handle("sessions:delete", (e, id) =>
  withHarnessRestart(() => deleteSession(id))
);

ipcMain.handle("provider:import", (_e, pasted, auto) =>
  importProvider(pasted, { autoDiscover: !!auto }).then((r) => {
    if (win && !win.isDestroyed() && r.ok) win.webContents.send("provider:imported", r);
    return r;
  })
);

ipcMain.handle("app:get-port", () => harnessPort());

app.on("window-all-closed", () => app.quit());