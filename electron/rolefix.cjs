// 角色兼容 + 请求观测补丁：
// 1) developer -> system（dashscope/opencode 等不认 developer）。
// 2) 记录每个请求的 URL/model/messages 里 assistant 是否带 reasoning_content，
//    以及 body 大小 / 工具数量 / 系统提示大小（用于对比 Claude Code 上下文差异）。
// 日志：C:\Users\Lenovo\.dsh\fix\req.log；设 DSH_ROLEFIX_DEBUG=1 打更多。
const https = require("https");
const fs = require("fs");
const path = require("path");
const DEBUG = !!process.env.DSH_ROLEFIX_DEBUG;
const LOGDIR = path.join(require("os").homedir(), ".dsh", "fix");
const REQLOG = path.join(LOGDIR, "req.log");
try { fs.mkdirSync(LOGDIR, { recursive: true }); } catch (e) {}

function logReq(bodyStr, url) {
  try {
    const parsed = JSON.parse(bodyStr);
    if (!parsed || !Array.isArray(parsed.messages)) return;
    const model = parsed.model || "-";
    const bytes = bodyStr.length;
    const msgs = parsed.messages.length;
    const tools = parsed.tools;
    const toolsInfo = tools === undefined ? "无" : (Array.isArray(tools) ? tools.length + "个" : "有(非数组)");
    const m0 = parsed.messages[0];
    const sysLen = m0 && typeof m0.content === "string" ? m0.content.length : "-";
    const toolsBytes = parsed.tools !== undefined ? JSON.stringify(parsed.tools).length : 0;
    const msgsBytes = JSON.stringify(parsed.messages).length;
    const lines = ["=== " + new Date().toISOString() + " " + String(url).slice(0, 80) + " model=" + model + " body=" + bytes + "B tools=" + toolsInfo + " toolsB=" + toolsBytes + " msgsB=" + msgsBytes + " sys0=" + sysLen];
    for (const m of parsed.messages) {
      if (m.role === "assistant") {
        const rc = typeof m.reasoning_content === "string" ? m.reasoning_content.length : "-";
        const c = typeof m.content === "string" ? m.content.slice(0, 22) : "";
        lines.push(`  [assistant] rc=${rc} c=${c}`);
      } else {
        lines.push(`  [${m.role}]`);
      }
    }
    fs.appendFileSync(REQLOG, lines.join("\n") + "\n");
    if (parsed.tools && parsed.tools.length) { try { fs.writeFileSync(path.join(LOGDIR, "lastbody.json"), bodyStr); } catch (e) {} }
  } catch (e) { /* ignore */ }
}

function trans(bodyStr) {
  try {
    const parsed = JSON.parse(bodyStr);
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    let changed = false;
    for (const m of parsed.messages) {
      if (m.role === "developer") { m.role = "system"; changed = true; }
    }
    if (changed && DEBUG) console.error("[rolefix] developer->system");
    return changed ? JSON.stringify(parsed) : null;
  } catch (e) { return null; }
}

const origReq = https.request;
https.request = function (...args) {
  const req = origReq.apply(this, args);
  const origWrite = req.write.bind(req);
  req.write = function (chunk, enc, cb) {
    let data = chunk;
    const url = (req.host || "") + (req.path || "");
    if (Buffer.isBuffer(chunk) || typeof chunk === "string") {
      const orig = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      logReq(orig, url);
      const fixed = trans(orig, url);
      if (fixed) data = Buffer.from(fixed);
    }
    if (enc === undefined) return origWrite(data, cb);
    return origWrite(data, enc, cb);
  };
  return req;
};

if (typeof globalThis.fetch === "function") {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    let opts = args[1] || {};
    if (opts && typeof opts.body === "string") {
      logReq(opts.body, url);
      const fixed = trans(opts.body, url);
      if (fixed) opts = Object.assign({}, opts, { body: fixed });
    }
    return origFetch.call(this, args[0], opts);
  };
}