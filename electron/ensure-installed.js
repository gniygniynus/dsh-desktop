// 首跑：写 home 级 cordis.patch.yml（注入 session-rewind host 插件）。
// 插件本身由 scripts/prepack.mjs 同步到项目 node_modules，打包后随 app 进入安装目录的 node_modules，
// 这样 cordis-plugin-loader 能从它自己的位置 parent-walk 解析到插件（放 ~/.dsh/profiles/node_modules 不行，
// 因为 ESM import 从 cordis-plugin-loader 的真实路径向上走，到不了 ~/.dsh）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const dshHome = () => process.env.DSH_HOME || join(homedir(), ".dsh");

export function ensureInstalled(_appRoot, _version) {
  const homePatch = join(dshHome(), "cordis.patch.yml");
  const entry = "- insert:\n    - id: session-rewind\n      name: '@deepseek-ai/dsh-session-rewind'";
  let changed = false;
  if (existsSync(homePatch)) {
    const content = readFileSync(homePatch, "utf8");
    const trimmed = content.trim();
    if (trimmed === "[]" || trimmed === "") {
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
  return { changed };
}
