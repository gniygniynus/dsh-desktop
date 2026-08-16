// 首跑自装：把 host 插件(dsh-session-rewind)物理拷进 ~/.dsh/profiles/node_modules（零依赖，不要求全局 dsh）
// + 写 home 级 cordis.patch.yml + 版本标记。
//
// 为什么放 profiles/node_modules：harness 的 healProfilesModuleFallback 只对"启动它的那份 dsh 的依赖闭包"
// 建 symlink，out-of-tree 插件不在闭包里；但 Node 的 parent-walk 会从 profile 目录向上找到
// ~/.dsh/profiles/node_modules（heal 维护的 fallback 目录）。heal 只 ensureSymlink 闭包内的包、不删除
// 非闭包的真实目录，所以把插件作为真实目录放这里既能被 resolve，又不会被 heal 清掉，也不依赖全局 dsh。
// 对比 scripts/install.mjs（开发态）用 ~/.dsh/node_modules（指向全局 dsh），那是开发环境特有。
//
// 不打 client 补丁——client 补丁在打包前由 scripts/prepack.mjs 打进 node_modules，运行时不用动。
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const VERSION_FILE = ".dsh-desktop-version";
const PLUGIN_DIR = "dsh-session-rewind";

// 与 harness-lifecycle.js 一致：尊重 DSH_HOME 环境变量，测试/模拟可用隔离 home，不动真实 ~/.dsh
const dshHome = () => process.env.DSH_HOME || join(homedir(), ".dsh");

export function ensureInstalled(appRoot, version) {
  const src = join(appRoot, "plugins", PLUGIN_DIR);
  const dest = join(dshHome(), "profiles", "node_modules", "@deepseek-ai", "dsh-session-rewind");

  // 版本已匹配且插件已就位 → 跳过
  let installed = "";
  try { installed = readFileSync(join(dshHome(), VERSION_FILE), "utf8").trim(); } catch {}
  if (installed === version && existsSync(join(dest, "package.json"))) {
    return { changed: false };
  }

  if (!existsSync(join(src, "package.json"))) {
    return { changed: false, missing: true }; // 插件源码未打包（忽略，不阻断启动）
  }

  // 1. 物理复制插件（真实目录，非 symlink；Windows node 不认 WSL 建的 symlink，故用复制）
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, "package.json"), join(dest, "package.json"));
  cpSync(join(src, "lib"), join(dest, "lib"), { recursive: true });

  // 2. 写 home 级 cordis.patch.yml（注入 host 插件，幂等）
  const homePatch = join(dshHome(), "cordis.patch.yml");
  const entry = "- insert:\n    - id: session-rewind\n      name: '@deepseek-ai/dsh-session-rewind'";
  if (existsSync(homePatch)) {
    const content = readFileSync(homePatch, "utf8");
    const trimmed = content.trim();
    if (trimmed === "[]" || trimmed === "") {
      writeFileSync(homePatch, entry + "\n", "utf8");
    } else if (!content.includes("session-rewind")) {
      writeFileSync(homePatch, content.trimEnd() + "\n" + entry + "\n", "utf8");
    }
  } else {
    writeFileSync(homePatch, entry + "\n", "utf8");
  }

  // 3. 写版本标记
  try {
    mkdirSync(dshHome(), { recursive: true });
    writeFileSync(join(dshHome(), VERSION_FILE), version + "\n", "utf8");
  } catch {}

  return { changed: true, dest };
}
