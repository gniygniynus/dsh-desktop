# dsh-desktop

DeepSeek Harness 桌面增强：删除会话、撤回消息、重新回答、粘贴识别加供应商。

> 本项目基于官方 **DeepSeek Harness**（`@deepseek-ai/dsh`，MIT License）二次开发，是**非官方**的第三方桌面壳增强，与 DeepSeek 无隶属、赞助或背书关系。详见下方「声明」。

## 功能

| 功能 | 落点 | 行为 |
|------|------|------|
| 删除会话 | 会话列表 `⋯` → 删除会话 | 硬删进 `~/.dsh/storages/trash` + 列表刷新 |
| 撤回消息 | 用户消息下「撤回」 | fork 到该消息之前 + 删母 + 自动切到子会话 |
| 重新回答 | AI 回复下「重新回答」 | fork + followup 原用户消息重跑 + 删母 + 自动切换 |
| 粘贴识别 | 设置 → 模型 → 添加自定义提供方 →「粘贴识别」 | 解析 NewAPI 通道连接串，自动填字段 + 拉模型 |

## 开发安装

```powershell
cd dsh-desktop
npm install
node scripts\install.mjs     # 打 client 补丁 + 装 host 插件 + 注入 ~/.dsh/cordis.patch.yml
npx electron .
```

`install.mjs` 做三件事（幂等，可重复跑）：
1. 复制 host 插件到 harness node_modules
2. 应用 client 编译产物补丁（remote 挂载 + 删除/撤回/重新回答/粘贴识别按钮）
3. 注入 `~/.dsh/cordis.patch.yml`（home 级 patch，让 harness 加载 host 插件）

## 打包分发（零依赖，下载即用）

```powershell
npm run dist    # = node scripts/prepack.mjs && electron-builder --win nsis
```

- `prepack.mjs`：打包前把 4 个 client 补丁打进 node_modules（否则补丁只作用于编译产物，运行期拿不到）。
- `asar: false`：**关键开关**。harness 的 `healProfilesModuleFallback` 用 junction 管理插件加载，junction 必须指向真实文件系统路径，`app.asar` 虚拟路径会失效，故禁用 asar 让 dsh 及依赖落在真实目录。
- 用户下载安装 exe 后，**首次启动自动**：把 host 插件拷进 `~/.dsh/profiles/node_modules` + 写 `~/.dsh/cordis.patch.yml` + 写版本标记（`electron/ensure-installed.js`，幂等）。**无需全局安装 `@deepseek-ai/dsh`、无需手动跑 install.mjs。**

## 图标

已从 harness 自带官方 `favicon.svg` 生成 `build/icon.ico`（DeepSeek 蓝鲸鱼，16–256 多尺寸、透明背景）。重新生成或换色：`node scripts\make-icon.mjs [颜色hex]`。商标提醒见 `build/README.md`。

## 架构

- `plugins/dsh-session-rewind/` — host 插件（手写 typert，`delete` / `rewind` / `regenerate` RPC）
- `patches/apply-session-rewind.js` — client 补丁（幂等，4 个模块：api-remotes / workspace / conversation / settings-models）
- `scripts/install.mjs` — 开发态一键安装
- `scripts/prepack.mjs` — 打包前补丁
- `scripts/paste-parse.mjs` — 粘贴解析纯函数（NewAPI 通道连接串）

## 声明

- **基于官方 DeepSeek Harness**（`@deepseek-ai/dsh`，MIT License，Copyright (c) 2026 DeepSeek）。本项目未修改 harness 核心代码：client 补丁作用于编译产物、host 插件是独立插件包。
- **非官方**：本项目与 DeepSeek（深度求索）无隶属、赞助或背书关系。
- 名称与图标如涉及 DeepSeek 商标，请自行确认符合其品牌使用规范。

## 说明

- harness 升级会破坏 client 编译产物补丁（client.js 是打包产物），重新跑 `node scripts\install.mjs`（开发态）或升级本项目版本号触发首跑自装即可恢复。
- host 插件依赖 harness 内部机制（`ctx.sessions.store` / `detachEntered`、`apiProxy.sessions.fork` 等），harness 大版本升级可能需要适配。
