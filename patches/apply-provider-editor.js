// provider 编辑增强（幂等）：
//   1. dsh-credentials-local：file 优先于 env + 允许覆盖 env 继承的 key（原设计 env 只读优先）
//   2. dsh-host-apiproxy：credentials.describe 返回 key 明文（供"眼睛"回显）
//   3. dsh-client-ui-settings-models：眼睛按钮 + key 回显 + 解锁 + 字段默认展开
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
const MARK = "// [dsh-desktop] provider-editor";

/**
 * 解析目标路径：优先全局 harness node_modules（Electron 加载路径），
 * 回退到项目 node_modules（test-boot 测试用）。
 * 与 apply-session-rewind.js 的 resolveTarget 策略保持一致。
 */
function resolveProviderTarget(relPath) {
  const candidates = [];
  // 全局 harness node_modules（Electron 壳实际加载位置）
  const homes = [homedir(), process.env.USERPROFILE];
  for (const home of homes) {
    if (!home) continue;
    try {
      const dshNm = realpathSync(join(home, ".dsh", "node_modules"));
      candidates.push(join(dshNm, "@deepseek-ai", relPath));
    } catch {}
  }
  // 项目 node_modules（test-boot fallback）
  candidates.push(join(APP, "node_modules", "@deepseek-ai", relPath));
  candidates.push(join(APP, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", relPath));
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`[provider-editor] 找不到 ${relPath}`);
}

function patchFile(relPath, replacements, label) {
  const target = resolveProviderTarget(relPath);
  let src = readFileSync(target, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (src.includes(to)) continue; // 该处已 patch，跳过（增量幂等）
    if (!src.includes(from)) throw new Error(`[provider-editor] ${label} 锚点缺失: ${JSON.stringify(from.slice(0, 70))}`);
    src = src.replace(from, to);
    changed = true;
  }
  if (changed) writeFileSync(target, src, "utf8");
  return { target, label, changed };
}

// 1. credentials-local：file 优先 + 允许覆盖 env
function applyCredentialsLocal() {
  return patchFile("dsh-credentials-local/lib/index.js", [
    // resolve：file 优先于 env
    [
      '\t\tconst inherited = this.inherited(ref);\n\t\tif (inherited !== void 0) return Promise.resolve({\n\t\t\tvalue: inherited,\n\t\t\tsource: "env"\n\t\t});\n\t\tconst stored = this.values.get(ref);\n\t\tif (stored !== void 0) return Promise.resolve({\n\t\t\tvalue: stored,\n\t\t\tsource: "file"\n\t\t});',
      '\t\tconst stored = this.values.get(ref);\n\t\tif (stored !== void 0) return Promise.resolve({\n\t\t\tvalue: stored,\n\t\t\tsource: "file"\n\t\t});\n\t\tconst inherited = this.inherited(ref);\n\t\tif (inherited !== void 0) return Promise.resolve({\n\t\t\tvalue: inherited,\n\t\t\tsource: "env"\n\t\t});'
    ],
    // describe：file 优先 + env 也 writable
    [
      '\tdescribe(ref) {\n\t\tif (this.inherited(ref) !== void 0) return Promise.resolve({\n\t\t\tconfigured: true,\n\t\t\tsource: "env",\n\t\t\twritable: false\n\t\t});\n\t\tif (this.values.get(ref) !== void 0) return Promise.resolve({\n\t\t\tconfigured: true,\n\t\t\tsource: "file",\n\t\t\twritable: true\n\t\t});',
      '\tdescribe(ref) {\n\t\tif (this.values.get(ref) !== void 0) return Promise.resolve({\n\t\t\tconfigured: true,\n\t\t\tsource: "file",\n\t\t\twritable: true\n\t\t});\n\t\tif (this.inherited(ref) !== void 0) return Promise.resolve({\n\t\t\tconfigured: true,\n\t\t\tsource: "env",\n\t\t\twritable: true\n\t\t});'
    ],
    // assertUnshadowed → no-op（允许写入覆盖 env）
    [
      '\tassertUnshadowed(ref, verb) {\n\t\tif (this.inherited(ref) !== void 0) throw new Error(`credentials-local: "${ref}" is supplied read-only by the launching environment, so ${verb} would be shadowed; unset it in the shell you start dsh from instead`);\n\t}',
      '\tassertUnshadowed(ref, verb) {\n\t\t// [dsh-desktop] allow overriding env-inherited credentials\n\t}'
    ],
  ], "credentials-local");
}

// 2. apiproxy：describe 返回 value 明文
function applyApiproxy() {
  return patchFile("dsh-host-apiproxy/lib/index.js", [
    [
      '\t\t\t\t\tconst info = await credentials.describe(credentialRef(ref));\n\t\t\t\t\treturn [ref, {\n\t\t\t\t\t\tconfigured: info.configured,\n\t\t\t\t\t\t...info.source === void 0 ? {} : { source: info.source },\n\t\t\t\t\t\twritable: info.writable\n\t\t\t\t\t}];',
      '\t\t\t\t\tconst info = await credentials.describe(credentialRef(ref));\n\t\t\t\t\tlet value;\n\t\t\t\t\ttry { value = (await credentials.resolve(credentialRef(ref)))?.value; } catch {}\n\t\t\t\t\treturn [ref, {\n\t\t\t\t\t\tconfigured: info.configured,\n\t\t\t\t\t\t...info.source === void 0 ? {} : { source: info.source },\n\t\t\t\t\t\twritable: info.writable,\n\t\t\t\t\t\t...value === void 0 ? {} : { value }\n\t\t\t\t\t}];'
    ],
    // CredentialView schema 加 value 字段（否则 zod 校验剥离明文）
    [
      'const credentialViewSchema = z$1.object({\n\tconfigured: z$1.boolean(),\n\tsource: z$1.string().optional(),\n\twritable: z$1.boolean()\n});',
      'const credentialViewSchema = z$1.object({\n\tconfigured: z$1.boolean(),\n\tsource: z$1.string().optional(),\n\twritable: z$1.boolean(),\n\tvalue: z$1.string().optional()\n});'
    ],
  ], "apiproxy");
}

// 3. settings-models：眼睛按钮 + 回显 + 解锁 + 展开
function applySettingsModels() {
  return patchFile("dsh-client-ui-settings-models/lib/client.js", [
    // showKey state（keyState 唯一标识 ProviderEditor）
    [
      '\t\t\tconst [keyDraft, setKeyDraft] = (0, react.useState)("");\n\t\t\tconst [keyState, setKeyState] = (0, react.useState)(void 0);',
      '\t\t\tconst [keyDraft, setKeyDraft] = (0, react.useState)("");\n\t\t\tconst [keyState, setKeyState] = (0, react.useState)(void 0);\n\t\t\tconst [showKey, setShowKey] = (0, react.useState)(false);'
    ],
    // useEffect 回显已存 key
    [
      '\t\t\t\t\tsetKeyState(response.result.value.credentials[keyRef]);',
      '\t\t\t\t\tconst _cred = response.result.value.credentials[keyRef];\n\t\t\t\t\tsetKeyState(_cred);\n\t\t\t\t\tif (_cred !== void 0 && _cred.value !== void 0) setKeyDraft((_cur) => _cur === "" ? _cred.value : _cur);'
    ],
    // type 切换 + 解锁（keyLocked 唯一标识 ProviderEditor 的 key 输入框）
    [
      '\t\t\t\t\t\t\ttype: "password",\n\t\t\t\t\t\t\tautoComplete: "off",\n\t\t\t\t\t\t\tvalue: keyDraft,\n\t\t\t\t\t\t\tplaceholder: keyPlaceholder,\n\t\t\t\t\t\t\t"aria-label": t("keyInput"),\n\t\t\t\t\t\t\t"aria-invalid": shownKeyFailure !== void 0,\n\t\t\t\t\t\t\trequired: props.credentialRequired === true,\n\t\t\t\t\t\t\tautoFocus: props.autoFocusCredential === true,\n\t\t\t\t\t\t\tdisabled: disabled || keyLocked,',
      '\t\t\t\t\t\t\ttype: showKey ? "text" : "password",\n\t\t\t\t\t\t\tautoComplete: "off",\n\t\t\t\t\t\t\tvalue: keyDraft,\n\t\t\t\t\t\t\tplaceholder: keyPlaceholder,\n\t\t\t\t\t\t\t"aria-label": t("keyInput"),\n\t\t\t\t\t\t\t"aria-invalid": shownKeyFailure !== void 0,\n\t\t\t\t\t\t\trequired: props.credentialRequired === true,\n\t\t\t\t\t\t\tautoFocus: props.autoFocusCredential === true,\n\t\t\t\t\t\t\tdisabled: disabled,'
    ],
    // 眼睛按钮（shownKeyFailure 唯一标识 ProviderEditor 的 key 区块）
    [
      '\t\t\t\t\t\tshownKeyFailure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {',
      '\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", { type: "button", className: ModelsSection_module_css_default["secondaryButton"], onClick: () => setShowKey((v) => !v), children: showKey ? "隐藏" : "显示" }),\n\t\t\t\t\t\tshownKeyFailure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {'
    ],
    // details 默认展开
    [
      '\t\t\t\t}), props.credentialOnly === true ? null : (0, react_jsx_runtime.jsxs)("details", {\n\t\t\t\t\tclassName: ModelsSection_module_css_default["customized"],',
      '\t\t\t\t}), props.credentialOnly === true ? null : (0, react_jsx_runtime.jsxs)("details", {\n\t\t\t\t\topen: true,\n\t\t\t\t\tclassName: ModelsSection_module_css_default["customized"],'
    ],
  ], "settings-models");
}

// 4. client-connection：client 侧 credentials schema 加 value（否则校验剥离明文）
function applyClientConnection() {
  return patchFile("dsh-client-connection/lib/client.js", [
    [
      '\t\tconst credentialViewSchema = object({\n\t\t\tconfigured: boolean(),\n\t\t\tsource: string().optional(),\n\t\t\twritable: boolean()\n\t\t});',
      '\t\tconst credentialViewSchema = object({\n\t\t\tconfigured: boolean(),\n\t\t\tsource: string().optional(),\n\t\t\twritable: boolean(),\n\t\t\tvalue: string().optional()\n\t\t});'
    ],
  ], "client-connection");
}

// 独立入口
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let failed = false;
  for (const apply of [applyCredentialsLocal, applyApiproxy, applySettingsModels, applyClientConnection]) {
    try {
      const r = apply();
      console.log(`[provider-editor] ${r.label}: ${r.changed ? "已打补丁" : "已是最新（跳过）"}`);
    } catch (e) {
      failed = true;
      console.error("[provider-editor] " + e.message);
    }
  }
  process.exit(failed ? 1 : 0);
}

export { applyCredentialsLocal, applyApiproxy, applySettingsModels, applyClientConnection };
