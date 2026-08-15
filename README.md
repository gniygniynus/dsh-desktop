# dsh-desktop

DeepSeek Harness 桌面增强：删除会话、撤回消息、重新回答、粘贴识别加供应商。

> ⚠️ 前提：本机已全局安装 `@deepseek-ai/dsh`（npm i -g @deepseek-ai/dsh），Electron 壳内嵌的项目 dsh 与真实 `~/.dsh` 配合使用。

## 功能

| 功能 | 落点 | 行为 |
|------|------|------|
| 删除会话 | 会话列表 `⋯` → 删除会话 | 硬删进 `~/.dsh/storages/trash` + 列表刷新 |
| 撤回消息 | 用户消息下「撤回」 | fork 到该消息之前 + 删母 + 自动切到子会话 |
| 重新回答 | AI 回复下「重新回答」 | fork + followup 原用户消息重跑 + 删母 + 自动切换 |
| 粘贴识别 | 设置 → 模型 → 添加自定义提供方 →「粘贴识别」 | 解析 NewAPI 通道连接串，自动填字段 + 拉模型 |

## 安装

```powershell
cd dsh-desktop
npm install
node scripts\install.mjs     # 复制插件 + 打 client 补丁 + 注入 ~/.dsh/cordis.patch.yml
npx electron .
```

`install.mjs` 做三件事（幂等，可重复跑）：
1. 复制 host 插件到全局 harness node_modules（`~/.dsh/node_modules/@deepseek-ai/dsh-session-rewind`）
2. 应用 client 编译产物补丁到项目 node_modules（remote 挂载 + 删除/撤回/重新回答/粘贴识别按钮）
3. 注入 `~/.dsh/cordis.patch.yml`（home 级 patch，让 harness 加载 host 插件）

## 架构

- `plugins/dsh-session-rewind/` — host 插件（手写 typert，`delete`/`rewind`/`regenerate` RPC）
- `patches/apply-session-rewind.js` — client 补丁（幂等，4 个模块：api-remotes / workspace / conversation / settings-models）
- `scripts/install.mjs` — 一键安装
- `scripts/paste-parse.mjs` — 粘贴解析纯函数（NewAPI 通道连接串）

## 说明

- harness 升级会破坏 client 编译产物补丁（client.js 是打包产物），重新跑 `node scripts\install.mjs` 即可恢复。
- host 插件依赖 harness 内部机制（`ctx.sessions.store`/`detachEntered`、`apiProxy.sessions.fork` 等），harness 大版本升级可能需要适配。
