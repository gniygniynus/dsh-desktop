// F4 粘贴加供应商：CCSwitch 复制 → 自动解析 → 写 settings.yaml + .credentials.yaml
// 支持：JSON env 块 / KEY=VALUE 行 / settings.json env 对象；自动探测 baseURL 是否需要补 /v1；
// PROXY_MANAGED 拦截；模型可从 ANTHROPIC_DEFAULT_*_MODEL 或 /v1/models 自动发现。
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import { dshHome, readJsonFile } from "./session-db.js";

const settingsPath = () => join(dshHome(), "settings.yaml");
const credentialsPath = () => join(dshHome(), ".credentials.yaml");

// ---------- 解析 ----------
function sniff(pasted) {
  const t = pasted.trim();
  if (t.startsWith("{")) {
    let obj;
    try { obj = JSON.parse(t); } catch { return { form: "invalid-json" }; }
    const env = obj.env && typeof obj.env === "object" ? obj.env : obj; // A: {env,apiFormat} / C: 裸 env 对象
    const keys = Object.keys(env).filter((k) => /^ANTHROPIC_/.test(k)).length;
    if (keys) return { form: "json", env, apiFormat: obj.apiFormat };
    return { form: "invalid-json" };
  }
  // B: KEY=VALUE 或空格分隔（支持一行多个 K=V）
  const pairs = {};
  const tokens = t.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) { i++; continue; }
    if (tok.includes("=")) {
      const eq = tok.indexOf("=");
      pairs[tok.slice(0, eq)] = tok.slice(eq + 1).replace(/^["']|["']$/g, "");
      i++;
    } else {
      const v = tokens[i + 1];
      if (v !== undefined) { pairs[tok] = v.replace(/^["']|["']$/g, ""); i += 2; }
      else i++;
    }
  }
  if (Object.keys(pairs).length && Object.keys(pairs).some((k) => /ANTHROPIC_/.test(k)))
    return { form: "kv", env: pairs, apiFormat: undefined };
  return { form: "unknown" };
}

function parse(parsed) {
  const { env } = parsed;
  const key = env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = env.ANTHROPIC_BASE_URL;
  if (key === "PROXY_MANAGED")
    return { ok: false, reason: "proxy-managed", detail: "检测到 PROXY_MANAGED：这是 CC Switch 代理托管配置（真实 key 由 15722 运行时注入）。请回到 CC Switch 复制该账号的『完整配置/JSON』再粘贴。" };
  if (!key || !baseUrl)
    return { ok: false, reason: "missing", detail: "缺少 ANTHROPIC_BASE_URL 或 key。请复制包含 BASE_URL + key 的账号配置。" };

  const api = parsed.apiFormat === "anthropic" ? "anthropic-messages" : "openai-completions";
  const headers = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith("HEADER_")) headers[k.slice(7).toLowerCase()] = String(v);
  if (env.USER_AGENT) headers["user-agent"] = String(env.USER_AGENT);

  // 模型：CCSwitch 默认模型映射（剥 [1M] 后缀）
  const modelIds = [];
  const seen = new Set();
  for (const key of ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "ANTHROPIC_MODEL", "ANTHROPIC_REASONING_MODEL"]) {
    const v = env[key];
    if (!v) continue;
    const id = String(v).replace(/\[1[Mm]\]|\[\d+\]/, "").trim();
    if (id && !seen.has(id)) { seen.add(id); if (env[key + "_NAME"]) modelIds.push({ id, name: String(env[key + "_NAME"]) }); else modelIds.push({ id }); }
  }
  return { ok: true, baseUrl, key, api, headers, models: modelIds };
}

/** 探测 baseURL 是否自带头（用 /v1 与不带 /v1 各试 /models）。 */
async function probe(url) {
  const tries = [url, url.endsWith("/v1") ? url.slice(0, -3) : url + "/v1"].filter(Boolean);
  for (const u of tries) {
    try {
      const r = await fetch(u + "/models", { method: "GET", headers: { authorization: "Bearer probe" } });
      if (r.status === 401 || r.status === 403 || r.status === 200) return { baseURL: u, reachable: true, status: r.status };
    } catch {}
  }
  return { baseURL: url, reachable: false };
}

function slugify(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return (host || "provider").toUpperCase().replace(/[^A-Z0-9_]/g, "");
  } catch { return "PROVIDER"; }
}

async function pickEnvRef(baseUrl, cred) {
  const base = slugify(baseUrl);
  let ref = base + "_API_KEY";
  let i = 2;
  while (Object.prototype.hasOwnProperty.call(cred, ref)) ref = `${base}_API_KEY_${i++}`;
  return ref;
}

function readCredentials() {
  const p = credentialsPath();
  if (!existsSync(p)) return {};
  const t = readFileSync(p, "utf8");
  const out = {};
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
function writeCredentials(cred) {
  const body = Object.entries(cred).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n";
  const p = credentialsPath();
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p)) copyFileSync(p, p + ".bak");
  const tmp = p + ".tmp";
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, p);
}

function atomicWriteYaml(path, doc) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, path + ".bak");
  const tmp = path + ".tmp";
  writeFileSync(tmp, yaml.dump(doc), "utf8");
  renameSync(tmp, path);
}

export function developProvider(pid) {
  const p = settingsPath();
  let doc = {};
  if (existsSync(p)) {
    try { doc = yaml.load(readFileSync(p, "utf8")) || {}; } catch {}
  }
  const pi = doc["llm-pi-ai"] || (doc["llm-pi-ai"] = { providers: {} });
  if (!pi.providers) pi.providers = {};
  return { doc, providers: pi.providers, pid };
}

/**
 * 导入：入参 = CCSwitch 粘贴文本。返回 { ok, provider, apiKeyEnv, discoveredModels? }
 */
export async function importProvider(pasted, { autoDiscover = false } = {}) {
  const parsed = sniff(pasted);
  if (parsed.form === "invalid-json") return { ok: false, reason: "invalid-json", detail: "无法解析为 JSON" };
  if (parsed.form === "unknown") return { ok: false, reason: "unknown", detail: "没认出这是 CC Switch 账号格式。请从 CC Switch 复制账号的 JSON 配置再粘贴。" };

  const p = parse(parsed);
  if (!p.ok) return p;

  // 探测 baseURL
  const probed = await probe(p.baseUrl);

  // 模型自动发现（若开了且探测可用）
  let discovered = [];
  if (autoDiscover && probed.reachable) {
    try {
      const r = await fetch(probed.baseURL + "/models", { headers: { authorization: `Bearer ${p.key}` } });
      if (r.ok) {
        const body = await r.json();
        discovered = (body.data || []).map((m) => ({ id: m.id }));
      }
    } catch {}
  }
  const models = (discovered.length ? discovered : p.models).map((m, i) => ({ id: m.id, name: m.name || m.id }));

  const cred = readCredentials();
  const apiKeyEnv = await pickEnvRef(probed.baseURL, cred);
  cred[apiKeyEnv] = p.key;
  writeCredentials(cred);

  const pid = (await pickEnvRef(probed.baseURL, {})).replace(/_API_KEY.*$/, "").toLowerCase().replace(/_/g, "-") || "provider";
  const { doc, providers } = developProvider(pid);
  providers[pid] = {
    displayName: pid,
    apiKeyEnv,
    api: p.api,
    baseURL: probed.baseURL,
    ...(Object.keys(p.headers).length ? { headers: p.headers } : {}),
    models: models.length ? models : [{ id: "请配置模型" }],
  };
  atomicWriteYaml(settingsPath(), doc);

  return { ok: true, provider: pid, apiKeyEnv, baseURL: probed.baseURL, models: models.length };
}