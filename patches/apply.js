// UA 补丁应用器（幂等）：让 settings.yaml 里 provider 显式配置的 user-agent 能覆盖
// harness 自带的 attribution UA（修复 zen/OpenCode 免费模型 429）。原样对应本地已验证的修改。
// 用法：import { applyUaPatch } from "./apply.js"；也可命令行直接跑 node patches/apply.js
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");

// 目标文件（npm 装的 dsh-llm-pi-ai）
function resolveTarget() {
  const candidates = [
    join(APP_ROOT, "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "lib", "index.js"),
    join(APP_ROOT, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "lib", "index.js"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("[ua-patch] 找不到 dsh-llm-pi-ai/lib/index.js");
}

const MARK = "// [dsh-desktop] UA-override patch applied";
// 已补丁的判据
const PATCH_PROBE = 'name.toLowerCase() === "user-agent"';
// 原始 requestHeaders（npm 原版）
const ORIGINAL = `function requestHeaders(headers) {
	const attribution = attributionHeaders();
	const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
	return {
		...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
		...attribution
	};
}`;
// 补丁后
const PATCHED = `function requestHeaders(headers) {
	const attribution = attributionHeaders();
	const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
	const provided = Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()) || name.toLowerCase() === "user-agent"));
	return {
		...attribution,
		...provided
	};
}`;

export function uaPatchStatus() {
  const target = resolveTarget();
  const src = readFileSync(target, "utf8");
  return { target, applied: src.includes(PATCH_PROBE) };
}

export function applyUaPatch() {
  const { target, applied } = uaPatchStatus();
  if (applied) return { target, applied: true, changed: false };
  const src = readFileSync(target, "utf8");
  if (!src.includes(ORIGINAL)) {
    throw new Error("[ua-patch] 未找到原始 requestHeaders 代码块，无法自动打补丁（版本可能已变动）。请人工核对。target=" + target);
  }
  if (!src.startsWith(MARK + "\n")) {
    writeFileSync(target, MARK + "\n" + src, "utf8");
  }
  const next = readFileSync(target, "utf8").replace(ORIGINAL, PATCHED);
  writeFileSync(target, next, "utf8");
  return { target, applied: true, changed: true };
}

// 独立入口
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const r = applyUaPatch();
    console.log("[ua-patch]", r.changed ? "已打补丁" : "已是最新（跳过）", "→", r.target);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}