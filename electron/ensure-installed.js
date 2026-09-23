// 首跑自装 + 每次启动修复：
//   1. 写 home 级 cordis.patch.yml（注入 session-rewind host 插件）
//   2. 创建 ~/.dsh/node_modules junction → 项目 node_modules
//   3. 桌面快捷方式（幂等）
//   4. HMR 补丁（每次启动检查，防止 npm install 还原）
import { existsSync, readFileSync, writeFileSync, symlinkSync, lstatSync, readdirSync, realpathSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const dshHome = () => process.env.DSH_HOME || join(homedir(), ".dsh");

function syncPlugin(appRoot, dest) {
  const src = join(appRoot, "plugins", "dsh-session-rewind");
  const srcIndex = join(src, "lib", "index.js");
  const destIndex = join(dest, "lib", "index.js");
  if (!existsSync(srcIndex)) return false;

  let current = "";
  try { current = readFileSync(destIndex, "utf8"); } catch {}
  const next = readFileSync(srcIndex, "utf8");
  if (current === next && existsSync(join(dest, "package.json"))) return false;

  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, "package.json"), join(dest, "package.json"));
  cpSync(join(src, "lib"), join(dest, "lib"), { recursive: true });
  return true;
}

export function ensureInstalled(appRoot) {
  let changed = false;

  // ── 1. cordis.patch.yml ──
  const homePatch = join(dshHome(), "cordis.patch.yml");
  const entry = "- insert:\n    - id: session-rewind\n      name: '@deepseek-ai/dsh-session-rewind'";
  if (existsSync(homePatch)) {
    const content = readFileSync(homePatch, "utf8");
    const trimmed = content.trim();
    if (/^\[\s*\]$/.test(trimmed) || trimmed === "") {
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
  if (appRoot) {
    const dshNmLink = join(dshHome(), "node_modules");
    const targetNm = join(appRoot, "node_modules");
    if (existsSync(targetNm)) {
      const resolvedTarget = realpathSync(targetNm);
      let needRelink = false;
      let canRelink = true;
      try {
        const stat = lstatSync(dshNmLink);
        const current = realpathSync(dshNmLink);
        if (current !== resolvedTarget) {
          if (stat.isSymbolicLink()) {
            needRelink = true;
          } else {
            canRelink = false;
          }
        }
      } catch {
        needRelink = true;
      }
      if (needRelink && canRelink) {
        try { rmSync(dshNmLink, { force: true }); } catch {}
        try {
          symlinkSync(targetNm, dshNmLink, "junction");
          changed = true;
        } catch {}
      }
    }

    // 覆盖两个插件加载位置：
    // 1. app/node_modules：当前安装版由 cordis-plugin-loader parent-walk 加载
    // 2. ~/.dsh/profiles/node_modules：旧版本遗留位置，若不覆盖会抢先加载旧 apiProxy 版
    for (const dest of [
      join(targetNm, "@deepseek-ai", "dsh-session-rewind"),
      join(dshHome(), "profiles", "node_modules", "@deepseek-ai", "dsh-session-rewind"),
    ]) {
      try {
        if (syncPlugin(appRoot, dest)) changed = true;
      } catch {}
    }
  }

  // ── 3. 桌面快捷方式 ──
  if (process.platform === "win32" && appRoot) {
    try {
      const exePath = join(appRoot, "..", "..", "dsh-desktop.exe");
      const desktop = join(homedir(), "Desktop", "dsh-desktop.lnk");
      if (!existsSync(desktop) && existsSync(exePath)) {
        const ps = [
          `$s=(New-Object -COM WScript.Shell).CreateShortcut('${desktop}')`,
          `$s.TargetPath='${exePath}'`,
          `$s.WorkingDirectory='${join(appRoot, "..", "..")}'`,
          `$s.Description='dsh-desktop'`,
          `$s.Save()`
        ].join(";");
        execFileSync("powershell", ["-NoProfile", "-Command", ps], { timeout: 5000 });
        changed = true;
      }
    } catch {}
  }

  // ── 4. HMR 补丁（每次启动检查） ──
  // cordis-plugin-hmr 需要 --expose-internals，Electron 不提供，必须禁用。
  // prepack.mjs 打包时打过，但安装后 npm install 可能还原，所以每次启动都检查。
  if (appRoot) {
    try {
      const libDir = join(appRoot, "node_modules", "@deepseek-ai", "dsh", "lib");
      if (existsSync(libDir)) {
        const MARK = "// [dsh-desktop] HMR disabled";
        const ANCHORS = [
          '\tif (composed.profile.patchReload === "live" && !signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {',
          '\tif (!signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) try {'
        ];
        for (const f of readdirSync(libDir)) {
          if (!f.startsWith("profile-boot-") || !f.endsWith(".js")) continue;
          const p = join(libDir, f);
          const src = readFileSync(p, "utf8");
          if (src.includes(MARK)) continue; // 已打
          for (const anchor of ANCHORS) {
            if (src.includes(anchor)) {
              writeFileSync(p, src.replace(anchor, '\tif (false) try { ' + MARK), "utf8");
              changed = true;
              break;
            }
          }
        }
      }
    } catch {}
  }

  return { changed };
}
