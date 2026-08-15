// 预加载：把主进程能力安全暴露给渲染层
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("dshDesktop", {
  getPort: () => ipcRenderer.invoke("app:get-port"),
  log: (msg) => ipcRenderer.send("renderer:log", msg),
  onSetPort: (cb) => ipcRenderer.on("app:set-port", (_e, p) => cb(p)),
});
