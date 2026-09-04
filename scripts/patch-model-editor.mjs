// 模型高级设置改造（幂等）：把 contextWindow/maxTokens 两个输入框换成「1M 上下文」+「思考等级」两个勾选。
// 思考等级勾选 → reasoningEfforts: { off: "", high: "high", max: "max" }；1M 勾选 → contextWindow: 1000000；输出(maxTokens)跟随官方、不再暴露。
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");

function resolveModelEditorTarget() {
  const relPath = "dsh-client-ui-settings-models/lib/client.js";
  const candidates = [];
  const homes = [homedir(), process.env.USERPROFILE];
  for (const home of homes) {
    if (!home) continue;
    try {
      const dshNm = realpathSync(join(home, ".dsh", "node_modules"));
      candidates.push(join(dshNm, "@deepseek-ai", relPath));
    } catch {}
  }
  candidates.push(join(APP, "node_modules", "@deepseek-ai", relPath));
  candidates.push(join(APP, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", relPath));
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`[model-editor] 找不到 ${relPath}`);
}
const T7 = "\t\t\t\t\t\t\t";
const T8 = "\t\t\t\t\t\t\t\t";
const T9 = "\t\t\t\t\t\t\t\t\t";
const T10 = "\t\t\t\t\t\t\t\t\t\t";

const from = [
  T7 + 'children: [(0, react_jsx_runtime.jsxs)("label", {',
  T8 + 'className: ModelsSection_module_css_default["modelField"],',
  T8 + 'children: [(0, react_jsx_runtime.jsx)("span", {',
  T9 + 'className: ModelsSection_module_css_default["modelFieldLabel"],',
  T9 + 'children: t("modelContextWindow")',
  T8 + '}), (0, react_jsx_runtime.jsx)("input", {',
  T9 + 'className: ModelsSection_module_css_default["input"],',
  T9 + 'type: "text",',
  T9 + 'inputMode: "numeric",',
  T9 + 'value: capacityText(model, index, "contextWindow"),',
  T9 + 'placeholder: CAPACITY_HINT.contextWindow,',
  T9 + '"aria-label": `${t("modelContextWindow")} ${index + 1}`,',
  T9 + 'disabled,',
  T9 + 'onChange: (event) => {',
  T10 + 'editCapacity(index, "contextWindow", event.target.value);',
  T9 + '}',
  T8 + '})]',
  T7 + '}), (0, react_jsx_runtime.jsxs)("label", {',
  T8 + 'className: ModelsSection_module_css_default["modelField"],',
  T8 + 'children: [(0, react_jsx_runtime.jsx)("span", {',
  T9 + 'className: ModelsSection_module_css_default["modelFieldLabel"],',
  T9 + 'children: t("modelMaxTokens")',
  T8 + '}), (0, react_jsx_runtime.jsx)("input", {',
  T9 + 'className: ModelsSection_module_css_default["input"],',
  T9 + 'type: "text",',
  T9 + 'inputMode: "numeric",',
  T9 + 'value: capacityText(model, index, "maxTokens"),',
  T9 + 'placeholder: CAPACITY_HINT.maxTokens,',
  T9 + '"aria-label": `${t("modelMaxTokens")} ${index + 1}`,',
  T9 + 'disabled,',
  T9 + 'onChange: (event) => {',
  T10 + 'editCapacity(index, "maxTokens", event.target.value);',
  T9 + '}',
  T8 + '})]',
  T7 + '})]',
].join("\n");

const to = [
  T7 + 'children: [(0, react_jsx_runtime.jsxs)("label", {',
  T8 + 'className: ModelsSection_module_css_default["modelField"],',
  T8 + 'style: { display: "flex", flexDirection: "row", gap: 6 },',
  T8 + 'children: [(0, react_jsx_runtime.jsx)("input", {',
  T9 + 'type: "checkbox",',
  T9 + 'checked: model.contextWindow === 1000000,',
  T9 + 'disabled,',
  T9 + 'onChange: (event) => {',
  T10 + 'patch(index, { contextWindow: event.target.checked ? 1000000 : void 0 });',
  T9 + '}',
  T8 + '}), (0, react_jsx_runtime.jsx)("span", { children: "1M 上下文" })]',
  T7 + '}), (0, react_jsx_runtime.jsxs)("label", {',
  T8 + 'className: ModelsSection_module_css_default["modelField"],',
  T8 + 'style: { display: "flex", flexDirection: "row", gap: 6 },',
  T8 + 'children: [(0, react_jsx_runtime.jsx)("input", {',
  T9 + 'type: "checkbox",',
  T9 + 'checked: model.reasoningEfforts !== void 0 && model.reasoningEfforts !== false,',
  T9 + 'disabled,',
  T9 + 'onChange: (event) => {',
  T10 + 'patch(index, { reasoningEfforts: event.target.checked ? { off: null, high: "high", max: "max" } : void 0 });',
  T9 + '}',
  T8 + '}), (0, react_jsx_runtime.jsx)("span", { children: "思考等级" })]',
  T7 + '})]',
].join("\n");

export function applyModelEditor() {
  const target = resolveModelEditorTarget();
  const src = readFileSync(target, "utf8");
  if (src.includes(to)) return { target, label: "model-editor", changed: false };
  if (!src.includes(from)) return { target, label: "model-editor", changed: false }; // 版本变动或已手动改过，静默跳过
  writeFileSync(target, src.replace(from, to), "utf8");
  return { target, label: "model-editor", changed: true };
}
