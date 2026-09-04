// 首跑自装：
//   1. 写 home 级 cordis.patch.yml（注入 session-rewind host 插件）
//   2. 创建 ~/.dsh/node_modules junction → 项目 node_modules（让 agent-preset 插件能解析依赖）
//
// heal 只建 profiles/<profile>/node_modules 的 junction，不建 ~/.dsh/node_modules。
// 但 agent-preset 插件（如 describe-image.js）从 ~/.dsh/.agent-presets/<preset>/ 加载，
// Node ESM 解析往上走找 node_modules，走到 ~/.dsh/node_modules 时如果不存在就报
// "Cannot find package '@deepseek-ai/schemastery'"。junction 解决这个问题。
import { existsSync, readFileSync, writeFileSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dshHome = () => process.env.DSH_HOME || join(homedir(), ".dsh");

export function ensureInstalled(appRoot) {
  let changed = false;

  // ── 1. cordis.patch.yml ──
  const homePatch = join(dshHome(), "cordis.patch.yml");
  const entry = "- insert:\n    - id: session-rewind\n      name: '@deepseek-ai/dsh-session-rewind'";
  if (existsSync(homePatch)) {
    const content = readFileSync(homePatch, "utf8");
    const trimmed = content.trim();
    if (/^\[[\s]*\]$/.test(trimmed) || trimmed === "") {
      writeFileSync(homePatch, entry + "\n", "utf8");
      changed = true;
    } else if (!content.includes("session-rewind")) {
      writeFileSync(homePatch, content.trimEnd() + "\n" + entry + "\n", "utf8");
      changed = true;
    }
  } else {
    writeFileSync(homePatch, entry + "\n", "utf8");
    changed = true;
  }

  // ── 2. ~/.dsh/node_modules junction ──
  // agent-preset 插件（describe-image.js 等）的 import 依赖标准 Node 解析，
  // 需要 ~/.dsh/node_modules 存在。用 junction 指向项目 node_modules，零拷贝。
  if (appRoot) {
    const dshNmLink = join(dshHome(), "node_modules");
    const targetNm = join(appRoot, "node_modules");
    if (existsSync(targetNm)) {
      let linkExists = false;
      try { lstatSync(dshNmLink); linkExists = true; } catch {}
      if (!linkExists) {
        try {
          symlinkSync(targetNm, dshNmLink, "junction");
          changed = true;
        } catch {}
      }
    }
  }

  return { changed };
}
