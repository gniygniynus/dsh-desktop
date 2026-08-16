// 渲染层：全窗口承载原版 harness web UI
const bridge = window.dshDesktop;
const webview = document.querySelector("#harness");
let currentPort = Number(new URLSearchParams(location.search).get("port") || 0);

// 诊断：把 renderer 错误与 webview 装载事件写进 desktop.log
const wvlog = (m) => { try { bridge.log(m); } catch {} };
window.addEventListener("error", (e) => wvlog("RENDERER-ERROR " + e.message + " @" + (e.filename || "") + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => wvlog("RENDERER-PROMISE " + String(e.reason)));
wvlog("init port=" + currentPort + " search=" + location.search);

// 设 src 用 try/catch：webview 未 dom-ready 时设置会抛 "must be attached"，
// 但属性赋值仍会生效；吞掉错误，靠 dom-ready/onSetPort 多触发点兜底确保最终加载。
function setWebview(port) {
  if (port) currentPort = port;
  if (!currentPort) return;
  const url = `http://127.0.0.1:${currentPort}/`;
  try {
    if (webview.getAttribute("src") !== url) webview.setAttribute("src", url);
  } catch (e) {
    wvlog("setWebview err: " + (e.message || String(e)));
  }
}

bridge.onSetPort((p) => setWebview(p));

setWebview(currentPort); // 立即尝试（不等 dom-ready）

webview.addEventListener("dom-ready", () => {
  wvlog("WV dom-ready");
  setWebview(currentPort);
});
webview.addEventListener("console-message", (e) => wvlog("WV-CONSOLE [" + e.level + "] " + (e.message || "")));
webview.addEventListener("did-start-loading", () => wvlog("WV start " + webview.getURL()));
webview.addEventListener("did-fail-load", (e) => wvlog("WV FAIL code=" + e.errorCode + " desc=" + e.errorDescription + " url=" + e.validatedURL));
webview.addEventListener("did-finish-load", () => wvlog("WV loaded " + webview.getURL()));
webview.addEventListener("did-finish-load", () => {
  webview.executeJavaScript("JSON.stringify((window.__DSH_BOOT__?.entries||[]).map(e => e.id + '@' + e.rev))").then((r) => wvlog("BOOT entries: " + r)).catch(() => {});
});
