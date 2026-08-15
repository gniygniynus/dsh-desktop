// 粘贴识别：解析 NewAPI/CCSwitch 通道连接串 → 加供应商字段。
// 纯函数、无 node 依赖，最终会嵌入 settings-models 的 CustomProviderCard 前端补丁。
// 之前 provider-import.js 报「无法解析」的根因：没认 `_type:"newapi_channel_conn"` 形状。

const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function normalizeBaseURL(url) {
  let u = String(url).replace(/\/+$/, "");
  if (!/\/v\d+$/.test(u)) u += "/v1";
  return u;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ""; }
}

function routeFromURL(url) {
  const host = hostOf(url);
  const route = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  if (route && ROUTE_PATTERN.test(route)) return route;
  return "newapi";
}

export function parseProviderPaste(text) {
  const s = String(text ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  let obj;
  try { obj = JSON.parse(s); } catch { return { ok: false, reason: "not-json" }; }

  if (obj && typeof obj === "object" && !Array.isArray(obj) && obj._type === "newapi_channel_conn") {
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    const key = typeof obj.key === "string" ? obj.key.trim() : "";
    if (!url) return { ok: false, reason: "no-url" };
    if (!key) return { ok: false, reason: "no-key" };
    return {
      ok: true,
      route: routeFromURL(url),
      displayName: hostOf(url) || "NewAPI",
      baseURL: normalizeBaseURL(url),
      protocol: "openai-completions",
      apiKey: key,
    };
  }
  return { ok: false, reason: "unknown-type" };
}
