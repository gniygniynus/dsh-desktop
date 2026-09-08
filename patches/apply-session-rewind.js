// session-rewind client 侧补丁应用器（幂等）：把 client 侧 remote + 删除按钮注入编译产物。
// 两部分：
//   1. dsh-api-remotes/client.js —— 内联 sessionRewind 的 TYPERT_REMOTE 并 $mount（复用其内联 zod）
//   2. dsh-client-ui-workspace/client.js —— 会话条目菜单加「删除」（调 remote.sessionRewind.delete）
// 用法：node patches/apply-session-rewind.js
// 说明：client.js 是编译产物，harness 升级会碎；本补丁靠精确字符串匹配 + 幂等探测。
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");

const MARK = "// [dsh-desktop] session-rewind patch";

function resolveTarget(relPath) {
  const candidates = [];
  // 项目 node_modules 优先：Electron 壳用项目 dsh，其 heal 的 fallback 把 ~/.dsh/profiles/node_modules
  // 指向项目 node_modules，故 dsh-client-modules 从项目 node_modules 加载 client.js。
  candidates.push(join(APP_ROOT, "node_modules", "@deepseek-ai", relPath));
  candidates.push(join(APP_ROOT, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", relPath));
  // 全局 harness node_modules（全局 `dsh web` 加载 client.js 的位置，作为 fallback）
  const homes = [homedir(), process.env.USERPROFILE];
  for (const home of homes) {
    if (!home) continue;
    try {
      const dshNm = realpathSync(join(home, ".dsh", "node_modules"));
      candidates.push(join(dshNm, "@deepseek-ai", relPath));
    } catch {}
  }
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`[session-rewind] 找不到 ${relPath}`);
}

function patchFile(target, replacements, label) {
  let src = readFileSync(target, "utf8");
  if (src.startsWith(MARK + "\n")) {
    return { target, label, applied: true, changed: false };
  }
  let changed = false;
  for (const entry of replacements) {
    const [from, to, global = false] = entry;
    // 「to」已存在 → 该处已 patch（无论有无 MARK），跳过
    if (src.includes(to)) continue;
    if (!src.includes(from)) {
      throw new Error(`[session-rewind] ${label} 未找到锚点，无法打补丁（版本可能已变动）。锚点片段：${from.slice(0, 80)}`);
    }
    src = global ? src.split(from).join(to) : src.replace(from, to);
    changed = true;
  }
  if (changed) writeFileSync(target, MARK + "\n" + src, "utf8");
  return { target, label, applied: true, changed };
}

// ===== 1. dsh-api-remotes：内联 sessionRewind TYPERT_REMOTE =====
const API_REMOTES_ANCHOR = "\t\tconst inject = [\"remote\"];";

const SESSION_REWIND_REMOTE = `\t\tconst inject = ["remote"];

\t\t// [dsh-desktop] sessionRewind Remote（delete + rewind）
\t\tconst TYPERT_REMOTE_SESSION_REWIND = {
\t\t\tpackage: "@deepseek-ai/dsh-session-rewind",
\t\t\tdescriptors: [{
\t\t\t\tid: "@deepseek-ai/dsh-session-rewind#sessionRewind/delete",
\t\t\t\tservice: "sessionRewind",
\t\t\t\tnamespace: "sessionRewind",
\t\t\t\tmethod: "delete",
\t\t\t\tinvocation: { kind: "direct" },
\t\t\t\tparameters: [{ name: "request", wire: "request", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-session-rewind/types#SessionRewindDeleteRequest", schema: object({ "sessionId": string() }) } }],
\t\t\t\tresult: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-session-rewind/types#SessionRewindDeleteResult", schema: union([object({ "ok": literal(true), "value": object({ "deleted": literal(true), "deletedIds": array(string()) }) }), object({ "ok": literal(false), "error": union([object({ "code": literal("session-not-found"), "sessionId": string() }), object({ "code": literal("delete-failed"), "sessionId": string(), "message": string() })]) })]) }
\t\t\t}, {
\t\t\t\tid: "@deepseek-ai/dsh-session-rewind#sessionRewind/rewind",
\t\t\t\tservice: "sessionRewind",
\t\t\t\tnamespace: "sessionRewind",
\t\t\t\tmethod: "rewind",
\t\t\t\tinvocation: { kind: "direct" },
\t\t\t\tparameters: [{ name: "request", wire: "request", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-session-rewind/types#SessionRewindRequest", schema: object({ "sessionId": string(), "atSeq": number() }) } }],
\t\t\t\tresult: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-session-rewind/types#SessionRewindResult", schema: union([object({ "ok": literal(true), "value": object({ "sessionId": union([string(), literal(null)]) }) }), object({ "ok": literal(false), "error": union([object({ "code": literal("session-not-found"), "sessionId": string() }), object({ "code": literal("no-prior-turn"), "sessionId": string() }), object({ "code": literal("fork-failed"), "sessionId": string(), "message": string() })]) })]) }
\t\t\t}, {
\t\t\t\tid: "@deepseek-ai/dsh-session-rewind#sessionRewind/regenerate",
\t\t\t\tservice: "sessionRewind",
\t\t\t\tnamespace: "sessionRewind",
\t\t\t\tmethod: "regenerate",
\t\t\t\tinvocation: { kind: "direct" },
\t\t\t\tparameters: [{ name: "request", wire: "request", source: "json", codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-session-rewind/types#SessionRewindRegenerateRequest", schema: object({ "sessionId": string(), "atSeq": number() }) } }],
\t\t\t\tresult: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-session-rewind/types#SessionRewindRegenerateResult", schema: union([object({ "ok": literal(true), "value": object({ "sessionId": string() }) }), object({ "ok": literal(false), "error": union([object({ "code": literal("session-not-found"), "sessionId": string() }), object({ "code": literal("no-prior-turn"), "sessionId": string() }), object({ "code": literal("no-user-message"), "sessionId": string() }), object({ "code": literal("fork-failed"), "sessionId": string(), "message": string() })]) })]) }
\t\t\t}]
\t\t};`;

const API_REMOTES_CONTRIBUTION = "\t\t\t\t\tTYPERT_REMOTE\n\t\t\t\t])";
const API_REMOTES_CONTRIBUTION_PATCHED = "\t\t\t\t\tTYPERT_REMOTE,\n\t\t\t\t\tTYPERT_REMOTE_SESSION_REWIND\n\t\t\t\t])";

function applyApiRemotesPatch() {
  const target = resolveTarget(join("dsh-api-remotes", "lib", "client.js"));
  return patchFile(target, [
    [API_REMOTES_ANCHOR, SESSION_REWIND_REMOTE],
    [API_REMOTES_CONTRIBUTION, API_REMOTES_CONTRIBUTION_PATCHED],
  ], "dsh-api-remotes");
}

// ===== 2. dsh-client-ui-workspace：会话条目菜单加删除 =====
function applyWorkspaceDeletePatch() {
  const target = resolveTarget(join("dsh-client-ui-workspace", "lib", "client.js"));

  const replacements = [
    // inject 加 remote + remote.sessionRewind
    ["\t\t\t\"locale\"\n\t\t];",
     "\t\t\t\"locale\",\n\t\t\t\"remote\",\n\t\t\t\"remote.sessionRewind\"\n\t\t];"],

    // SessionNodeItem 签名加 onDelete
    ["onFork, onArchive, drag, flat = false, t }) {",
     "onFork, onArchive, onDelete, drag, flat = false, t }) {"],

    // menu 加 delete 项
    ["id: \"archive\",\n\t\t\t\t\tlabel: t(\"menu.archiveSession\"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}\n\t\t\t];",
     "id: \"archive\",\n\t\t\t\t\tlabel: t(\"menu.archiveSession\"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: \"delete\",\n\t\t\t\t\tlabel: t(\"menu.deleteSession\"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\t\tdanger: true\n\t\t\t\t}\n\t\t\t];"],

    // onSelect 加 delete
    ["if (id === \"archive\") onArchive(node.id);",
     "if (id === \"archive\") onArchive(node.id);\n\t\t\t\t\t\t\t\t\tif (id === \"delete\") onDelete(node.id);"],

    // browserInjected 加 deleteSession（访问 ctx.remote）
    ["archiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},",
     "archiveSession: async (sessionId) => {\n\t\t\t\t\tawait ctx.workspaces.archiveSession(sessionId);\n\t\t\t\t},\n\t\t\t\tdeleteSession: (sessionId) => {\n\t\t\t\t\tif (!confirm('确定要永久删除此会话？此操作无法撤销。')) return Promise.resolve();\n\t\t\t\t\treturn ctx.remote.sessionRewind.delete({ sessionId }).then((r) => {\n\t\t\t\t\t\tif (r.ok && r.value && r.value.ok) { ctx.sessions.refresh().catch(() => {}); }\n\t\t\t\t\t\telse { const code = r?.value?.error?.code ?? r?.error?.code ?? 'unknown'; alert('删除会话失败：' + code); }\n\t\t\t\t\t}).catch((e) => {\n\t\t\t\t\t\talert('删除会话出错：' + String(e));\n\t\t\t\t\t});\n\t\t\t\t},"],

    // WorkspaceBrowser 签名加 deleteSession
    ["archiveSession, insertSessionBefore, createWorkspace",
     "archiveSession, deleteSession, insertSessionBefore, createWorkspace"],

    // onSessionArchive 后加 onSessionDelete（调 deleteSession prop）
    ["\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn(\"session archive rejected:\", reason);\n\t\t\t\t});\n\t\t\t};",
     "\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn(\"session archive rejected:\", reason);\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst onSessionDelete = (sessionId) => {\n\t\t\t\tdeleteSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn(\"session delete rejected:\", reason);\n\t\t\t\t});\n\t\t\t};"],

    // SessionTree 签名加 onSessionDelete
    ["onSessionRename, onSessionArchive, insertWorkspaceBefore",
     "onSessionRename, onSessionArchive, onSessionDelete, insertWorkspaceBefore"],

    // FlatList 签名加 onSessionDelete
    ["onSessionRename, onSessionArchive, archivedSessionIds",
     "onSessionRename, onSessionArchive, onSessionDelete, archivedSessionIds"],

    // FlatList 调用加 onSessionDelete
    ["\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tarchivedSessionIds,",
     "\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tarchivedSessionIds,"],

    // SessionTree 调用加 onSessionDelete
    ["\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tforkSession,",
     "\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tforkSession,"],

    // SessionTree 传 SessionNodeItem 加 onDelete
    ["\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\tdrag: {",
     "\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\tonDelete: onSessionDelete,\n\t\t\t\t\t\t\t\t\t\t\tdrag: {"],

    // FlatList 传 SessionNodeItem 加 onDelete
    ["\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tflat: true,",
     "\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tonDelete: onSessionDelete,\n\t\t\t\t\t\t\tflat: true,"],

    // 字典 zh/en 加 menu.deleteSession
    ["\"menu.archiveSession\": \"归档会话\",",
     "\"menu.archiveSession\": \"归档会话\",\n\t\t\t\"menu.deleteSession\": \"删除会话\","],
    ["\"menu.archiveSession\": \"Archive session\",",
     "\"menu.archiveSession\": \"Archive session\",\n\t\t\t\"menu.deleteSession\": \"Delete session\","],
  ];

  return patchFile(target, replacements, "dsh-client-ui-workspace");
}

// ===== 3. dsh-client-ui-conversation：用户消息下加撤回按钮 =====
function applyConversationRewindPatch() {
  const target = resolveTarget(join("dsh-client-ui-conversation", "lib", "client.js"));

  const replacements = [
    // inject 加 remote.sessionRewind（conversation 已有 "remote"，补子命名空间）
    ["\t\t\t\"remote\",\n\t\t\t\"settingsScope\",",
     "\t\t\t\"remote\",\n\t\t\t\"remote.sessionRewind\",\n\t\t\t\"settingsScope\","],

    // ChatNodeSeat 签名加 rewindAt
    ["function ChatNodeSeat({ nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt, loadImage, fileMentions, useSession, renderSlot, t }) {",
     "function ChatNodeSeat({ nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt, rewindAt, loadImage, fileMentions, useSession, renderSlot, t }) {"],

    // ChatNodeSeat owner 对象加 rewindAt
    ["\t\t\t\tforkAt,\n\t\t\t\tloadImage,\n\t\t\t\tfileMentions\n\t\t\t}, [",
     "\t\t\t\tforkAt,\n\t\t\t\trewindAt,\n\t\t\t\tloadImage,\n\t\t\t\tfileMentions\n\t\t\t}, ["],

    // ChatView 签名加 rewindAt
    ["chatScroll, forkAt, fileMentions, t }) {",
     "chatScroll, forkAt, rewindAt, fileMentions, t }) {"],

    // ChatNodeSeat 渲染加 rewindAt
    ["\t\t\t\t\t\t\t\tforkAt,\n\t\t\t\t\t\t\t\tloadImage,",
     "\t\t\t\t\t\t\t\tforkAt,\n\t\t\t\t\t\t\t\trewindAt,\n\t\t\t\t\t\t\t\tloadImage,"],

    // UserMessageNodeView 签名加 rewindAt
    ["function UserMessageNodeView({ node, loadImage, t }) {",
     "function UserMessageNodeView({ node, loadImage, rewindAt, t }) {"],

    // UserMessageNodeView 加撤回按钮（onBranch 调 rewindAt）+ branchLabel 文案
    ["\t\t\t\tactions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {\n\t\t\t\t\ttext,\n\t\t\t\t\ttime: data.time,\n\t\t\t\t\tclock: \"start\",\n\t\t\t\t\tclassName: MessageItem_module_css_default.actions,\n\t\t\t\t\tt\n\t\t\t\t})",
     "\t\t\t\tactions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {\n\t\t\t\t\ttext,\n\t\t\t\t\ttime: data.time,\n\t\t\t\t\tclock: \"start\",\n\t\t\t\t\tclassName: MessageItem_module_css_default.actions,\n\t\t\t\t\tonBranch: rewindAt === void 0 ? void 0 : () => rewindAt(data.seq),\n\t\t\t\t\tbranchLabel: t(\"menu.rewind\"),\n\t\t\t\t\tt\n\t\t\t\t})"],

    // MessageIconActions 支持 branchLabel（撤回按钮文案，不影响 AI 回复下的分支）
    ["function MessageIconActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, className, extraActions, t }) {",
     "function MessageIconActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, className, extraActions, branchLabel, t }) {"],
    ["label: branchUnavailable ? t(\"message.branchUnavailable\") : t(\"message.branch\"),",
     "label: branchUnavailable ? t(\"message.branchUnavailable\") : (branchLabel ?? t(\"message.branch\")),"],
    ["\"aria-label\": t(\"message.branch\"),",
     "\"aria-label\": branchLabel ?? t(\"message.branch\"),"],

    // 字典 zh/en 加 menu.rewind
    ["\"message.branch\": \"在新对话中分支\",",
     "\"message.branch\": \"在新对话中分支\",\n\t\t\t\"menu.rewind\": \"撤回\","],
    ["\"message.branch\": \"Branch into a new conversation\",",
     "\"message.branch\": \"Branch into a new conversation\",\n\t\t\t\"menu.rewind\": \"Rewind\","],

    // rewindAt 定义（forkAt 后）
    ["\t\t\t\t\t\tforkAt: (seq) => {\n\t\t\t\t\t\t\tsessions.fork({\n\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\tatSeq: seq,\n\t\t\t\t\t\t\t\tincreaseTitle: true\n\t\t\t\t\t\t\t}).then((childId) => {\n\t\t\t\t\t\t\t\tsessions.open(childId);\n\t\t\t\t\t\t\t}).catch(() => {});\n\t\t\t\t\t\t}",
     "\t\t\t\t\t\tforkAt: (seq) => {\n\t\t\t\t\t\t\tsessions.fork({\n\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\tatSeq: seq,\n\t\t\t\t\t\t\t\tincreaseTitle: true\n\t\t\t\t\t\t\t}).then((childId) => {\n\t\t\t\t\t\t\t\tsessions.open(childId);\n\t\t\t\t\t\t\t}).catch(() => {});\n\t\t\t\t\t\t},\n\t\t\t\t\t\trewindAt: (seq) => {\n\t\t\t\t\t\t\tctx.remote.sessionRewind.rewind({\n\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\tatSeq: seq\n\t\t\t\t\t\t\t}).then((r) => {\n\t\t\t\t\t\t\t\t// typert 网关返回双层 {ok, value:{ok, value:{sessionId}}}（transport 层 + 业务层）\n\t\t\t\t\t\t\t\tconst biz = r.ok ? r.value : null;\n\t\t\t\t\t\t\t\tif (biz && biz.ok) { const childId = biz.value.sessionId; if (childId) ctx.sessions.refresh().then(() => sessions.open(childId)).catch(() => {}); else ctx.sessions.refresh().catch(() => {}); }\n\t\t\t\t\t\t\t\telse { const code = biz?.error?.code ?? r?.error?.code ?? 'unknown'; alert('撤回失败：' + code); }\n\t\t\t\t\t\t\t}).catch((e) => {\n\t\t\t\t\t\t\t\talert('撤回出错：' + String(e));\n\t\t\t\t\t\t\t});\n\t\t\t\t\t\t},\n\t\t\t\t\t\tregenerateAt: (seq) => {\n\t\t\t\t\t\t\tctx.remote.sessionRewind.regenerate({ sessionId, atSeq: seq }).then((r) => {\n\t\t\t\t\t\t\t\t// typert 网关返回双层 {ok, value:{ok, value:{sessionId}}}（transport 层 + 业务层）\n\t\t\t\t\t\t\t\tconst biz = r.ok ? r.value : null;\n\t\t\t\t\t\t\t\tif (biz && biz.ok) {\n\t\t\t\t\t\t\t\t\tconst childId = biz.value.sessionId;\n\t\t\t\t\t\t\t\t\tif (childId) ctx.sessions.refresh().then(() => sessions.open(childId)).catch(() => {});\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\telse { const code = biz?.error?.code ?? r?.error?.code ?? 'unknown'; alert('重新回答失败：' + code); }\n\t\t\t\t\t\t\t}).catch((e) => {\n\t\t\t\t\t\t\t\talert('重新回答出错：' + String(e));\n\t\t\t\t\t\t\t});\n\t\t\t\t\t\t}"],
    // ChatNodeSeat 签名加 regenerateAt
    ["inspectCall, forkAt, rewindAt, loadImage, fileMentions, useSession, renderSlot, t }) {",
     "inspectCall, forkAt, rewindAt, regenerateAt, loadImage, fileMentions, useSession, renderSlot, t }) {"],

    // ChatNodeSeat owner + deps 加 regenerateAt
    ["\t\t\t\tforkAt,\n\t\t\t\trewindAt,\n\t\t\t\tloadImage",
     "\t\t\t\tforkAt,\n\t\t\t\trewindAt,\n\t\t\t\tregenerateAt,\n\t\t\t\tloadImage", true],

    // ChatView 签名加 regenerateAt
    ["chatScroll, forkAt, rewindAt, fileMentions, t }) {",
     "chatScroll, forkAt, rewindAt, regenerateAt, fileMentions, t }) {"],

    // ChatNodeSeat 渲染加 regenerateAt
    ["\t\t\t\t\t\t\t\tforkAt,\n\t\t\t\t\t\t\t\trewindAt,\n\t\t\t\t\t\t\t\tloadImage,",
     "\t\t\t\t\t\t\t\tforkAt,\n\t\t\t\t\t\t\t\trewindAt,\n\t\t\t\t\t\t\t\tregenerateAt,\n\t\t\t\t\t\t\t\tloadImage,"],

    // TurnTailNodeView 签名加 regenerateAt
    ["function TurnTailNodeView({ node, openFile, forkAt, renderSlot",
     "function TurnTailNodeView({ node, openFile, forkAt, regenerateAt, renderSlot"],

    // TurnTailNodeView 加「重新回答」按钮（MessageIconActions 前）
    ["\t\t\t\tchildren: [tail, (0, react_jsx_runtime.jsx)(MessageIconActions, {",
     "\t\t\t\tchildren: [tail, regenerateAt !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, { label: t(\"message.regenerate\"), side: \"bottom\", children: (0, react_jsx_runtime.jsx)(\"button\", { type: \"button\", className: MessageIconActions_module_css_default.action, onClick: () => regenerateAt(closing.finalNode.seq), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}) }) }), (0, react_jsx_runtime.jsx)(MessageIconActions, {"],

    // TurnTailNodeView closing null 分支加「重新回答」按钮
    ["\t\t\tif (closing === null) return tail === null ? null : (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\tclassName: TurnTailNodeView_module_css_default.root,\n\t\t\t\tchildren: tail\n\t\t\t});",
     "\t\t\tif (closing === null) {\n\t\t\t\tconst redo = regenerateAt !== void 0 && (0, react_jsx_runtime.jsx)(\"button\", { type: \"button\", className: MessageIconActions_module_css_default.action, onClick: () => regenerateAt(data.seq), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}) });\n\t\t\t\tif (tail === null && !redo) return null;\n\t\t\t\treturn (0, react_jsx_runtime.jsx)(\"div\", { className: TurnTailNodeView_module_css_default.root, children: [tail, redo] });\n\t\t\t}"],

    // 字典 zh/en 加 message.regenerate
    ["\"menu.rewind\": \"撤回\",",
     "\"menu.rewind\": \"撤回\",\n\t\t\t\"message.regenerate\": \"重新回答\","],
    ["\"menu.rewind\": \"Rewind\",",
     "\"menu.rewind\": \"Rewind\",\n\t\t\t\"message.regenerate\": \"Regenerate\","],
  ];

  return patchFile(target, replacements, "dsh-client-ui-conversation");
}

// ===== 4. dsh-client-ui-settings-models：加供应商表单加「粘贴识别」按钮 =====
function applySettingsModelsPatch() {
  const target = resolveTarget(join("dsh-client-ui-settings-models", "lib", "client.js"));

  const pasteFuncs = `var ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
function parseProviderPaste(text) {
  var s = String(text ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  var obj;
  try { obj = JSON.parse(s); } catch { return { ok: false, reason: "not-json" }; }
  if (obj && typeof obj === "object" && !Array.isArray(obj) && obj._type === "newapi_channel_conn") {
    var url = typeof obj.url === "string" ? obj.url.trim() : "";
    var key = typeof obj.key === "string" ? obj.key.trim() : "";
    if (!url) return { ok: false, reason: "no-url" };
    if (!key) return { ok: false, reason: "no-key" };
    var baseURL = url.replace(/\\/+$/, "");
    if (!/\\/v\\d+$/.test(baseURL)) baseURL += "/v1";
    var host = "";
    try { host = new URL(url).host; } catch {}
    var route = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    if (!route || !ROUTE_PATTERN.test(route)) route = "newapi";
    return { ok: true, route: route, displayName: host || "NewAPI", baseURL: baseURL, protocol: "openai-completions", apiKey: key };
  }
  return { ok: false, reason: "unknown-type" };
}
function adoptPasteModel(candidate) {
  return {
    id: candidate.id,
    ...candidate.name === void 0 ? {} : { name: candidate.name },
    ...candidate.contextWindow === void 0 ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === void 0 ? {} : { maxTokens: candidate.maxTokens }
  };
}
\t\tfunction CustomProviderCard(props) {`;

  const onPaste = `\t\t\t/** 粘贴识别：解析 NewAPI 通道连接串，填充表单并自动拉模型。 */
\t\t\tconst onPasteRecognize = async () => {
\t\t\t\ttry {
\t\t\t\t\tconst text = await navigator.clipboard.readText();
\t\t\t\t\tconst parsed = parseProviderPaste(text);
\t\t\t\t\tif (!parsed.ok) { setFailure("无法识别该粘贴内容，请确认是 NewAPI 通道连接串"); return; }
\t\t\t\t\tsetRoute(parsed.route);
\t\t\t\t\tsetDisplayName(parsed.displayName);
\t\t\t\t\tsetBaseURL(parsed.baseURL);
\t\t\t\t\tsetProtocol(parsed.protocol);
\t\t\t\t\tsetKeyDraft(parsed.apiKey);
\t\t\t\t\tsetBusy(true);
\t\t\t\t\ttry {
\t\t\t\t\t\tconst response = await api.llm.discoverModels({ settingsNs: NS$1, baseURL: parsed.baseURL, api: parsed.protocol, apiKey: parsed.apiKey });
\t\t\t\t\t\tif (response.result.ok && response.result.value.models.length > 0) {
\t\t\t\t\t\t\tsetModels(response.result.value.models.map(adoptPasteModel));
\t\t\t\t\t\t}
\t\t\t\t\t} catch (e) {}
\t\t\t\t\tsetBusy(false);
\t\t\t\t} catch (e) {
\t\t\t\t\tsetFailure("读取粘贴板失败，请确认已复制连接串并授权粘贴板访问");
\t\t\t\t}
\t\t\t};
\t\t\t/** Perform the create, returning a failure message or undefined. */`;

  const headerFrom = `\t\t\t\tclassName: ModelsSection_module_css_default["editor"],
\t\t\t\tchildren: [
\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: ModelsSection_module_css_default["editorHeader"],
\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["editorTitle"],
\t\t\t\t\t\t\tchildren: t("customTitle")
\t\t\t\t\t\t})
\t\t\t\t\t})`;
  const headerNew = `\t\t\t\tclassName: ModelsSection_module_css_default["editor"],
\t\t\t\tchildren: [
\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: ModelsSection_module_css_default["editorHeader"],
\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
\t\t\t\t\t\t\tchildren: [
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["editorTitle"], children: t("customTitle") }),
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", { type: "button", className: ModelsSection_module_css_default["secondaryButton"], onClick: onPasteRecognize, children: "粘贴识别" })
\t\t\t\t\t\t\t]
\t\t\t\t\t\t})
\t\t\t\t\t})`;

  return patchFile(target, [
    ["\t\tfunction CustomProviderCard(props) {", pasteFuncs],
    ["\t\t\t/** Perform the create, returning a failure message or undefined. */", onPaste],
    [headerFrom, headerNew],
  ], "dsh-client-ui-settings-models");
}

// 独立入口
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let failed = false;
  for (const apply of [applyApiRemotesPatch, applyWorkspaceDeletePatch, applyConversationRewindPatch, applySettingsModelsPatch]) {
    try {
      const r = apply();
      console.log(`[session-rewind] ${r.label}: ${r.changed ? "已打补丁" : "已是最新（跳过）"} → ${r.target}`);
    } catch (e) {
      failed = true;
      console.error("[session-rewind] " + e.message);
    }
  }
  process.exit(failed ? 1 : 0);
}

export { applyApiRemotesPatch, applyWorkspaceDeletePatch, applyConversationRewindPatch, applySettingsModelsPatch };
