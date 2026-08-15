// 渲染层：会话管理面板 + webview + 遮罩
const $ = (s) => document.querySelector(s);
const bridge = window.dshDesktop;

const webview = $("#harness");
const overlayEl = $("#overlay");
let currentPort = Number(new URLSearchParams(location.search).get("port") || 0);
let selectedId = null;
let providersDialogOpen = false;

function setWebview(port) {
  currentPort = port || currentPort;
  if (!currentPort) return;
  webview.src = `http://127.0.0.1:${currentPort}/`;
}

function toast(msg, ms = 3500) {
  const el = $("#msg");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), ms);
}

async function refreshSessions() {
  const list = await bridge.listSessions();
  const box = $("#sessions");
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = '<div class="empty">还没有会话</div>'; return; }
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "sess";
    row.dataset.id = s.id;
    const title = document.createElement("span");
    title.className = "t";
    title.textContent = s.title;
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = s.projectKey.replace(/^--|--$/g, "");
    row.append(title, ts);
    row.onclick = () => { selectedId = s.id; document.querySelectorAll(".sess").forEach((r) => r.classList.toggle("active", r === row)); };
    box.append(row);
  }
}

function requireSession() {
  if (!selectedId) { toast("先在左侧点选一个会话"); return null; }
  return selectedId;
}

// ---- 删除 ----
$("#btnDelete").onclick = async () => {
  const id = requireSession();
  if (!id) return;
  if (!confirm("确定删除该会话？会移入回收站 trash（可手动恢复）。")) return;
  const r = await bridge.deleteSession(id);
  if (r.ok) { toast(`已删除 ${r.deletedIds.length} 个会话 → 回收站`); selectedId = null; await refreshSessions(); toPortReload(); }
  else toast("删除失败: " + (r.reason || r));
};

// ---- 撤回 ----
$("#btnRollback").onclick = async () => {
  const id = requireSession();
  if (!id) return;
  const pv = await bridge.previewRollback(id, 5);
  if (!pv.ok) { toast("取撤回点失败: " + (pv.reason || "")); return; }
  if (!pv.turns.length) { toast("该会话没有可撤回的用户消息"); return; }
  $("#turnsList").innerHTML = "";
  let chosen = null;
  for (const t of pv.turns) {
    const lab = document.createElement("label");
    lab.className = "opt";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "turn";
    r.onchange = () => (chosen = t.eventIndex);
    const txt = document.createElement("span");
    txt.textContent = (t.text || "(空消息)").slice(0, 80) + `  ·  #${t.seq}`;
    lab.append(r, txt);
    $("#turnsList").append(lab);
  }
  $("#dlgTurns").showModal();
  chosen = await new Promise((res) => {
    $("#btnTurnsOk").onclick = () => res(chosen);
    $("#btnTurnsCancel").onclick = () => res(null);
  });
  $("#dlgTurns").close();
  if (chosen == null) return;
  if (!confirm("将删掉从该条之后的所有对话（历史进回收站），然后重启会话。继续？")) return;
  const r = await bridge.rollback(id, chosen);
  if (r.ok) { toast(`已撤回：保留 ${r.keptEvents} 条，移除 ${r.removedEvents} 条`); await refreshSessions(); toPortReload(); }
  else toast("撤回失败: " + (r.reason || r));
};

// ---- 加供应商 ----
$("#btnAddProvider").onclick = () => {
  $("#providerText").value = "";
  $("#dlgProvider").showModal();
};
$("#btnProviderCancel").onclick = () => $("#dlgProvider").close();
$("#btnProviderOk").onclick = async () => {
  const text = $("#providerText").value;
  const auto = $("#providerAuto").checked;
  $("#dlgProvider").close();
  if (!text.trim()) { toast("请粘贴内容"); return; }
  const r = await bridge.importProvider(text, auto);
  if (r.ok) { toast(`已添加供应商「${r.provider}」（${r.models ?? 0} 个模型），设置已热生效`); setTimeout(() => toPortReload(), 400); }
  else toast("添加失败: " + (r.detail || r.reason || "无法解析"));
};

// ---- 刷新 / 端口变化 ----
$("#btnRefresh").onclick = async () => { await refreshSessions(); toPortReload(); };
function toPortReload() { if (currentPort) webview.reload(); }

bridge.onOverlay((v) => {
  overlayEl.textContent = v === "show" ? "正在处理…请稍候" : "处理中…";
  overlayEl.classList.toggle("show", v === "show");
});
bridge.onHarnessRestarted((port) => { setWebview(port); setTimeout(() => toPortReload(), 600); });
bridge.onProviderImported(() => setTimeout(() => toPortReload(), 400));

setWebview(currentPort);
webview.addEventListener("did-finish-load", setOverlayHidden);
function setOverlayHidden() { overlayEl.classList.toggle("show", false); }
refreshSessions();