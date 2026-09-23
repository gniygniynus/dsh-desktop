// Electron 渲染层：全窗口承载原版 harness web UI
const bridge = window.dshDesktop;
if (!bridge) {
  console.error("[renderer] window.dshDesktop 未挂载，preload 可能未正常加载");
  throw new Error("dshDesktop bridge missing");
}
const webview = document.querySelector("#harness");
let currentPort = Number(new URLSearchParams(location.search).get("port") || 0);
let currentUrl = "";
let hostDomReady = false;
let webviewDomReady = false;
let loadedUrl = "";

// 诊断：把 renderer 错误与 webview 装载事件写进 desktop.log
const wvlog = (m) => { try { bridge.log(m); } catch {} };
window.addEventListener("error", (e) => wvlog("RENDERER-ERROR " + e.message + " @" + (e.filename || "") + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => wvlog("RENDERER-PROMISE " + String(e.reason)));
wvlog("init port=" + currentPort);

function setWebview(target) {
  if (typeof target === "object" && target !== null) {
    if (target.port) currentPort = Number(target.port);
    if (typeof target.url === "string" && target.url) currentUrl = target.url;
  } else if (typeof target === "string" && target) {
    currentUrl = target;
  } else if (target) {
    currentPort = Number(target);
  }
  if (!currentUrl && currentPort) currentUrl = `http://127.0.0.1:${currentPort}/`;
  if (!currentUrl || !hostDomReady) return;
  if (loadedUrl === currentUrl) return;
  try {
    webview.setAttribute("src", currentUrl);
    loadedUrl = currentUrl;
    wvlog("WV src " + String(currentUrl).replace(/token=[^&]+/, "token=***"));
  } catch (e) {
    wvlog("setWebview err: " + (e.message || String(e)));
  }
}

bridge.onSetPort((p) => setWebview(p));
if (typeof bridge.onSetUrl === "function") bridge.onSetUrl((payload) => setWebview(payload));
if (typeof bridge.getUrl === "function") {
  bridge.getUrl().then((payload) => setWebview(payload)).catch(() => {});
}

// 只在宿主文档已经附着 WebView 后设置 src，避免 Electron 的时序异常。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    hostDomReady = true;
    setWebview(currentPort);
  }, { once: true });
} else {
  hostDomReady = true;
  setWebview(currentPort);
}

webview.addEventListener("dom-ready", () => {
  webviewDomReady = true;
  wvlog("WV dom-ready");
});
webview.addEventListener("console-message", (e) => wvlog("WV-CONSOLE [" + e.level + "] " + (e.message || "")));
webview.addEventListener("did-start-loading", () => wvlog("WV start"));
webview.addEventListener("did-fail-load", (e) => wvlog("WV FAIL code=" + e.errorCode + " desc=" + e.errorDescription + " url=" + e.validatedURL));
webview.addEventListener("did-finish-load", () => {
  let url = "";
  try { url = webview.getURL(); } catch {}
  wvlog("WV loaded " + url);
  if (!webviewDomReady) return;
  webview.executeJavaScript("JSON.stringify((window.__DSH_BOOT__?.entries||[]).map(e => e.id + '@' + e.rev))")
    .then((r) => wvlog("BOOT entries: " + r))
    .catch((e) => wvlog("BOOT inspect failed: " + String(e)));
});
