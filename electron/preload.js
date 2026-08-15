// 预加载：把主进程能力安全暴露给渲染层
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("dshDesktop", {
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  previewRollback: (id, n) => ipcRenderer.invoke("sessions:preview", id, n),
  rollback: (id, eventIndex) => ipcRenderer.invoke("sessions:rollback", { id, eventIndex }),
  deleteSession: (id) => ipcRenderer.invoke("sessions:delete", id),
  importProvider: (text, auto) => ipcRenderer.invoke("provider:import", text, auto),
  getPort: () => ipcRenderer.invoke("app:get-port"),
  onOverlay: (cb) => ipcRenderer.on("overlay", (_e, v) => cb(v)),
  onHarnessRestarted: (cb) => ipcRenderer.on("harness:restarted", (_e, { port }) => cb(port)),
  onProviderImported: (cb) => ipcRenderer.on("provider:imported", (_e, r) => cb(r)),
});