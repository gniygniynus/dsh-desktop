// 把插件源码 plugins/dsh-session-rewind 同步（物理复制）到 node_modules，
// 供 harness 加载。因为 Windows node 无法访问 WSL 的 ln 创建的 symlink（EACCES），
// 故用物理复制而非 symlink。
// 用法：node scripts/sync-plugin.mjs [node_modules路径]
//   默认目标：<项目>/node_modules/@deepseek-ai/dsh-session-rewind（配合项目内 dsh 测试）
//   部署到全局 harness 时传全局 dsh 的 node_modules 路径。
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..");
const SRC = join(APP, "plugins", "dsh-session-rewind");

const targetArg = process.argv[2];
const DEST = targetArg
  ? join(targetArg, "@deepseek-ai", "dsh-session-rewind")
  : join(APP, "node_modules", "@deepseek-ai", "dsh-session-rewind");

if (!existsSync(join(SRC, "package.json"))) {
  console.error("[sync-plugin] 找不到插件源码 package.json:", SRC);
  process.exit(1);
}

mkdirSync(dirname(DEST), { recursive: true });
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

cpSync(join(SRC, "package.json"), join(DEST, "package.json"));
cpSync(join(SRC, "lib"), join(DEST, "lib"), { recursive: true });

console.log("[sync-plugin] 已同步 →", DEST);
