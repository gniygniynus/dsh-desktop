// session-rewind client 侧补丁应用器（幂等，适配 dsh@0.1.5-rc.1）
// 功能：
//   1. dsh-api-remotes/client.js —— 注入 sessionRewind TYPERT_REMOTE（delete/rewind/regenerate）
//   2. dsh-client-ui-workspace/client.js —— 会话条目菜单加「删除」
//   3. dsh-client-ui-chat/client.js —— 加撤回/重新回答按钮（新版 conversation 已迁移到 chat 包）
//   4. dsh-client-ui-settings-models/client.js —— 加供应商表单「粘贴识别」按钮
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");

const MARK = "// [dsh-desktop] session-rewind patch";

function resolveTarget(relPath) {
  const candidates = [];
  candidates.push(join(APP_ROOT, "node_modules", "@deepseek-ai", relPath));
  candidates.push(join(APP_ROOT, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", relPath));
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
    // 「to」已存在 → 该处已 patch，跳过
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

// ===== 1. dsh-api-remotes：注入 sessionRewind TYPERT_REMOTE =====
// 新版 api-remotes 使用 TYPERT_REMOTE$N 序号命名，最后一个是 TYPERT_REMOTE
// 我们在 TYPERT_REMOTE 后面注入，并在 apply 函数数组末尾添加

const API_REMOTES_ANCHOR = `\t\tconst inject = ["remote"];`;

const SESSION_REWIND_REMOTE = `\t\tconst inject = ["remote"];

\t\t// [dsh-desktop] sessionRewind Remote（delete + rewind + regenerate）
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

// 新版的 contributions 数组结尾是 TYPERT_REMOTE（无序号）后跟 ]) disposers...
const API_REMOTES_CONTRIBUTION = `\t\t\t\t\tTYPERT_REMOTE
\t\t\t\t]) disposers.push(await ctx.remote.$mount(contribution));`;
const API_REMOTES_CONTRIBUTION_PATCHED = `\t\t\t\t\tTYPERT_REMOTE,
\t\t\t\t\tTYPERT_REMOTE_SESSION_REWIND
\t\t\t\t]) disposers.push(await ctx.remote.$mount(contribution));`;

function applyApiRemotesPatch() {
  const target = resolveTarget(join("dsh-api-remotes", "lib", "client.js"));
  return patchFile(target, [
    [API_REMOTES_ANCHOR, SESSION_REWIND_REMOTE],
    [API_REMOTES_CONTRIBUTION, API_REMOTES_CONTRIBUTION_PATCHED],
  ], "dsh-api-remotes");
}

// ===== 2. dsh-client-ui-workspace：会话条目菜单加删除 =====
// 新版 SessionNodeItem 签名：{ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t }
// 没有 onDelete 参数，需要直接通过 remote 调用
function applyWorkspaceDeletePatch() {
  const target = resolveTarget(join("dsh-client-ui-workspace", "lib", "client.js"));

  const replacements = [
    // 注入 remote.sessionRewind（inject 里已有 "remote"，只加子命名空间）
    [
      `\t\t\t"remote",\n\t\t\t"remote.directoryPicker",`,
      `\t\t\t"remote",\n\t\t\t"remote.directoryPicker",\n\t\t\t"remote.sessionRewind",`
    ],

    // SessionNodeItem 签名加 onDelete
    [
      `function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t }) {`,
      `function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, onDelete, drag, flat = false, t }) {`
    ],

    // sessionMenuItems 加 delete 项（在 archive 后）
    [
      `\t\t\t\t{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}\n\t\t\t];`,
      `\t\t\t\t{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "delete",\n\t\t\t\t\tlabel: t("menu.deleteSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),\n\t\t\t\t\tdanger: true\n\t\t\t\t}\n\t\t\t];`
    ],

    // onSelect 加 delete 处理
    [
      `\t\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\t\t},`,
      `\t\t\t\t\t\t\t\t\tif (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\t\t\tif (id === "delete") onDelete && onDelete(node.id);\n\t\t\t\t\t\t\t\t},`
    ],

    // browserInjected 里加 deleteSession（在 archiveSession 后）
    [
      `\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait uiWorkspace.archiveSession(sessionId);\n\t\t\t\t},\n\t\t\t\t`,
      `\t\t\t\tarchiveSession: async (sessionId) => {\n\t\t\t\t\tawait uiWorkspace.archiveSession(sessionId);\n\t\t\t\t},\n\t\t\t\tdeleteSession: (sessionId) => {\n\t\t\t\t\tif (!confirm('确定要永久删除此会话？此操作无法撤销。')) return Promise.resolve();\n\t\t\t\t\treturn ctx.remote.sessionRewind.delete({ sessionId }).then((r) => {\n\t\t\t\t\t\tconst biz = r.ok ? r.value : null;\n\t\t\t\t\t\tif (biz && biz.ok) { ctx.sessions.refresh?.().catch(() => {}); }\n\t\t\t\t\t\telse { const code = biz?.error?.code ?? r?.error?.code ?? 'unknown'; alert('删除会话失败：' + code); }\n\t\t\t\t\t}).catch((e) => { alert('删除会话出错：' + String(e)); });\n\t\t\t\t},\n\t\t\t\t`
    ],

    // WorkspaceBrowser 签名加 deleteSession
    [
      `function WorkspaceBrowser({ wide, usePanelInfo, expandSidebar, useSessions, useSessionPendingInteraction, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostInfo, renderSlot, t }) {`,
      `function WorkspaceBrowser({ wide, usePanelInfo, expandSidebar, useSessions, useSessionPendingInteraction, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, deleteSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostInfo, renderSlot, t }) {`
    ],

    // onSessionArchive 后加 onSessionDelete
    [
      `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};`,
      `\t\t\tconst onSessionArchive = (sessionId) => {\n\t\t\t\tarchiveSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session archive rejected:", reason);\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst onSessionDelete = (sessionId) => {\n\t\t\t\tif (deleteSession) deleteSession(sessionId).catch((reason) => {\n\t\t\t\t\tconsole.warn("session delete rejected:", reason);\n\t\t\t\t});\n\t\t\t};`
    ],

    // FlatList 签名加 onSessionDelete
    [
      `function FlatList({ useSessions, useSessionPendingInteraction, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, usePanelInfo, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, revealSessionId, onSessionRevealed, t }) {`,
      `function FlatList({ useSessions, useSessionPendingInteraction, open, forkSession, onSessionRename, onSessionArchive, onSessionDelete, archivedSessionIds, usePanelInfo, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, revealSessionId, onSessionRevealed, t }) {`
    ],

    // SessionTree 里 SessionNodeItem 加 onDelete（SessionTree 用 onSessionArchive，对应 FlatList）
    [
      `\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\tonReveal: node.id === revealSessionId`,
      `\t\t\t\t\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\t\t\t\t\tonDelete: onSessionDelete,\n\t\t\t\t\t\t\t\t\t\t\tonReveal: node.id === revealSessionId`
    ],

    // FlatList 里的 SessionNodeItem 渲染加 onDelete（6-tab onArchive 是 FlatList）
    [
      `\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tonReveal: node.id === revealSessionId`,
      `\t\t\t\t\t\t\tonArchive: onSessionArchive,\n\t\t\t\t\t\t\tonDelete: onSessionDelete,\n\t\t\t\t\t\t\tonReveal: node.id === revealSessionId`
    ],

    // FlatList 调用处加 onSessionDelete（在 onSessionArchive 后）
    [
      `\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tarchivedSessionIds,`,
      `\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tarchivedSessionIds,`
    ],

    // SessionTree 调用处加 onSessionDelete（在 onSessionArchive 后）
    [
      `\t\t\t\t\t\t\tonSessionRename,\n\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tforkSession,\n\t\t\t\t\t\t\tworkspaces,`,
      `\t\t\t\t\t\t\tonSessionRename,\n\t\t\t\t\t\t\tonSessionArchive,\n\t\t\t\t\t\t\tonSessionDelete,\n\t\t\t\t\t\t\tforkSession,\n\t\t\t\t\t\t\tworkspaces,`
    ],

    // 字典 zh 加 menu.deleteSession
    [
      `"menu.archiveSession": "归档会话",`,
      `"menu.archiveSession": "归档会话",\n\t\t\t"menu.deleteSession": "删除会话",`
    ],
    // 字典 en 加 menu.deleteSession
    [
      `"menu.archiveSession": "Archive session",`,
      `"menu.archiveSession": "Archive session",\n\t\t\t"menu.deleteSession": "Delete session",`
    ],
  ];

  return patchFile(target, replacements, "dsh-client-ui-workspace");
}

// ===== 3. dsh-client-ui-chat：加撤回/重新回答按钮 =====
// 注意：新版 dsh@0.1.5-rc.1 把 conversation UI 拆出到 dsh-client-ui-chat
// UserMessageNodeView、TurnTailNodeView、MessageIconActions 都在这里
function applyChatRewindPatch() {
  const target = resolveTarget(join("dsh-client-ui-chat", "lib", "client.js"));

  const replacements = [
    // inject 加 remote.sessionRewind
    [
      `\t\t\t"remote",\n\t\t\t"remote.session",\n\t\t\t"sidebarRight"`,
      `\t\t\t"remote",\n\t\t\t"remote.session",\n\t\t\t"remote.sessionRewind",\n\t\t\t"sidebarRight"`
    ],

    // UserMessageNodeView 签名加 rewindAt
    [
      `function UserMessageNodeView({ node, renderMessageImages, t }) {`,
      `function UserMessageNodeView({ node, renderMessageImages, rewindAt, t }) {`
    ],

    // UserMessageNodeView 的 actions prop 加 onBranch + branchLabel（撤回）
    [
      `\t\t\t\tactions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {\n\t\t\t\t\ttext,\n\t\t\t\t\ttime: data.time,\n\t\t\t\t\tclock: "start",\n\t\t\t\t\tclassName: MessageItem_module_css_default.actions,\n\t\t\t\t\tt\n\t\t\t\t})`,
      `\t\t\t\tactions: (text) => (0, react_jsx_runtime.jsx)(MessageIconActions, {\n\t\t\t\t\ttext,\n\t\t\t\t\ttime: data.time,\n\t\t\t\t\tclock: "start",\n\t\t\t\t\tclassName: MessageItem_module_css_default.actions,\n\t\t\t\t\tonBranch: rewindAt === void 0 ? void 0 : () => rewindAt(data.seq),\n\t\t\t\t\tbranchLabel: t("menu.rewind"),\n\t\t\t\t\tt\n\t\t\t\t})`
    ],

    // MessageIconActions 加 branchLabel 参数
    [
      `function MessageIconActions({ text, time, clock, onBranch, branchUnavailable = false, className, extraActions, usageAction, t }) {`,
      `function MessageIconActions({ text, time, clock, onBranch, branchUnavailable = false, className, extraActions, usageAction, branchLabel, t }) {`
    ],

    // MessageIconActions 里用 branchLabel 替换 t("message.branch")（Tooltip label）
    [
      `label: branchUnavailable ? t("message.branchUnavailable") : t("message.branch"),`,
      `label: branchUnavailable ? t("message.branchUnavailable") : (branchLabel ?? t("message.branch")),`
    ],

    // MessageIconActions 里的 aria-label
    [
      `"aria-label": t("message.branch"),`,
      `"aria-label": branchLabel ?? t("message.branch"),`
    ],

    // ChatNodeSeat owner 加 rewindAt（在 forkAt 后），useMemo 依赖数组也加
    [
      `\t\t\t\tforkAt,\n\t\t\t\tloadImage,\n\t\t\t\trenderMessageImages,\n\t\t\t\tfileMentions,\n\t\t\t\tturnProcess\n\t\t\t}, [\n\t\t\t\tnode,\n\t\t\t\tcwd,\n\t\t\t\topenFile,\n\t\t\t\tinspectCall,\n\t\t\t\tforkAt,`,
      `\t\t\t\tforkAt,\n\t\t\t\trewindAt,\n\t\t\t\tregenerateAt,\n\t\t\t\tloadImage,\n\t\t\t\trenderMessageImages,\n\t\t\t\tfileMentions,\n\t\t\t\tturnProcess\n\t\t\t}, [\n\t\t\t\tnode,\n\t\t\t\tcwd,\n\t\t\t\topenFile,\n\t\t\t\tinspectCall,\n\t\t\t\tforkAt,`
    ],

    // ChatNodeSeat deps 数组补全 rewindAt, regenerateAt
    [
      `\t\t\t\tforkAt,\n\t\t\t\tloadImage,\n\t\t\t\trenderMessageImages,\n\t\t\t\tfileMentions,\n\t\t\t\tturnProcess\n\t\t\t]);`,
      `\t\t\t\tforkAt,\n\t\t\t\trewindAt,\n\t\t\t\tregenerateAt,\n\t\t\t\tloadImage,\n\t\t\t\trenderMessageImages,\n\t\t\t\tfileMentions,\n\t\t\t\tturnProcess\n\t\t\t]);`
    ],

    // ChatNodeSeat 签名加 rewindAt, regenerateAt
    [
      `function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, historyIncomplete, compactTranscript, cwd, openFile, inspectCall, forkAt, loadImage, renderMessageImages, fileMentions, useStore, actions, renderSlot, t }) {`,
      `function ChatNodeSeat({ nodeKey, useChatNode, useChatNodeProcess, historyIncomplete, compactTranscript, cwd, openFile, inspectCall, forkAt, rewindAt, regenerateAt, loadImage, renderMessageImages, fileMentions, useStore, actions, renderSlot, t }) {`
    ],

    // ChatView 签名加 rewindAt, regenerateAt
    [
      `function ChatView({ useSession, useChat, useChatNode, useChatNodeProcess, useSessions, useStore, actions, renderSlot, sessionId, openFile, loadOlder, loadThrough, loadImage, openView, chatScroll, forkAt, fileMentions, useTranscriptView, useProjection, t }) {`,
      `function ChatView({ useSession, useChat, useChatNode, useChatNodeProcess, useSessions, useStore, actions, renderSlot, sessionId, openFile, loadOlder, loadThrough, loadImage, openView, chatScroll, forkAt, rewindAt, regenerateAt, fileMentions, useTranscriptView, useProjection, t }) {`
    ],

    // ChatView 传 ChatNodeSeat 加 rewindAt, regenerateAt（forkAt 后）
    [
      `\t\t\t\t\t\t\t\t\tforkAt,\n\t\t\t\t\t\t\t\t\tloadImage,\n\t\t\t\t\t\t\t\t\trenderMessageImages,\n\t\t\t\t\t\t\t\t\tfileMentions,\n\t\t\t\t\t\t\t\t\trenderSlot,`,
      `\t\t\t\t\t\t\t\t\tforkAt,\n\t\t\t\t\t\t\t\t\trewindAt,\n\t\t\t\t\t\t\t\t\tregenerateAt,\n\t\t\t\t\t\t\t\t\tloadImage,\n\t\t\t\t\t\t\t\t\trenderMessageImages,\n\t\t\t\t\t\t\t\t\tfileMentions,\n\t\t\t\t\t\t\t\t\trenderSlot,`
    ],

    // TurnTailNodeView 签名加 regenerateAt
    [
      `const TurnTailNodeView = (0, react.memo)(function TurnTailNodeView({ node, openFile, forkAt, renderSlot, renderSlotChain, t, useChat }) {`,
      `const TurnTailNodeView = (0, react.memo)(function TurnTailNodeView({ node, openFile, forkAt, regenerateAt, renderSlot, renderSlotChain, t, useChat }) {`
    ],

    // TurnTailNodeView 加「重新回答」按钮（在 tail 和 MessageIconActions 之间）
    [
      `\t\t\t\tchildren: [tail, (0, react_jsx_runtime.jsx)(MessageIconActions, {`,
      `\t\t\t\tchildren: [tail, regenerateAt !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, { label: t("message.regenerate"), side: "bottom", children: (0, react_jsx_runtime.jsx)("button", { type: "button", className: TurnTailNodeView_module_css_default.actions, onClick: () => regenerateAt(closing.finalNode.seq), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}) }) }), (0, react_jsx_runtime.jsx)(MessageIconActions, {`
    ],

    // forkAt 后面加 rewindAt 和 regenerateAt（apply 函数里）
    [
      `\t\t\t\t\t\t\tforkAt: (seq) => {\n\t\t\t\t\t\t\t\tctx.sessions.fork({\n\t\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\t\tatSeq: seq,\n\t\t\t\t\t\t\t\t\tincreaseTitle: true\n\t\t\t\t\t\t\t\t}).then((childId) => {\n\t\t\t\t\t\t\t\t\tctx.sessions.open(childId);\n\t\t\t\t\t\t\t\t}).catch(() => {});\n\t\t\t\t\t\t\t}`,
      `\t\t\t\t\t\t\tforkAt: (seq) => {\n\t\t\t\t\t\t\t\tctx.sessions.fork({\n\t\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\t\tatSeq: seq,\n\t\t\t\t\t\t\t\t\tincreaseTitle: true\n\t\t\t\t\t\t\t\t}).then((childId) => {\n\t\t\t\t\t\t\t\t\tctx.sessions.open(childId);\n\t\t\t\t\t\t\t\t}).catch(() => {});\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\trewindAt: (seq) => {\n\t\t\t\t\t\t\t\tctx.remote.sessionRewind.rewind({ sessionId, atSeq: seq }).then((r) => {\n\t\t\t\t\t\t\t\t\t// typert 网关返回双层 {ok, value:{ok, value:{sessionId}}}\n\t\t\t\t\t\t\t\t\tconst biz = r.ok ? r.value : null;\n\t\t\t\t\t\t\t\t\tif (biz && biz.ok) { const childId = biz.value.sessionId; if (childId) ctx.sessions.refresh().then(() => ctx.sessions.open(childId)).catch(() => {}); else ctx.sessions.refresh().catch(() => {}); }\n\t\t\t\t\t\t\t\t\telse { const code = biz?.error?.code ?? r?.error?.code ?? 'unknown'; alert('撤回失败：' + code); }\n\t\t\t\t\t\t\t\t}).catch((e) => { alert('撤回出错：' + String(e)); });\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tregenerateAt: (seq) => {\n\t\t\t\t\t\t\t\tctx.remote.sessionRewind.regenerate({ sessionId, atSeq: seq }).then((r) => {\n\t\t\t\t\t\t\t\t\tconst biz = r.ok ? r.value : null;\n\t\t\t\t\t\t\t\t\tif (biz && biz.ok) { const childId = biz.value.sessionId; if (childId) ctx.sessions.refresh().then(() => ctx.sessions.open(childId)).catch(() => {}); }\n\t\t\t\t\t\t\t\t\telse { const code = biz?.error?.code ?? r?.error?.code ?? 'unknown'; alert('重新回答失败：' + code); }\n\t\t\t\t\t\t\t\t}).catch((e) => { alert('重新回答出错：' + String(e)); });\n\t\t\t\t\t\t\t}`
    ],

    // 字典 zh 加 menu.rewind 和 message.regenerate
    [
      `"message.branch": "在新对话中分支",`,
      `"message.branch": "在新对话中分支",\n\t\t\t"menu.rewind": "撤回",\n\t\t\t"message.regenerate": "重新回答",`
    ],
    // 字典 en
    [
      `"message.branch": "Branch into a new conversation",`,
      `"message.branch": "Branch into a new conversation",\n\t\t\t"menu.rewind": "Rewind",\n\t\t\t"message.regenerate": "Regenerate",`
    ],
  ];

  return patchFile(target, replacements, "dsh-client-ui-chat");
}

// ===== 4. dsh-client-ui-settings-models：加「粘贴识别」按钮 =====
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
\t\t\t\t\t}),`;
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
\t\t\t\t\t}),`;

  return patchFile(target, [
    ["\t\tfunction CustomProviderCard(props) {", pasteFuncs],
    ["\t\t\t/** Perform the create, returning a failure message or undefined. */", onPaste],
    [headerFrom, headerNew],
  ], "dsh-client-ui-settings-models");
}

// 独立入口
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let failed = false;
  for (const apply of [applyApiRemotesPatch, applyWorkspaceDeletePatch, applyChatRewindPatch, applySettingsModelsPatch]) {
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

export { applyApiRemotesPatch, applyWorkspaceDeletePatch, applyChatRewindPatch, applySettingsModelsPatch };
