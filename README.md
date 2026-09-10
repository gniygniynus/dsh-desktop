# dsh-desktop

DeepSeek Harness 桌面增强：删除会话、撤回消息、重新回答、粘贴识别加供应商、**启动自动检测更新**。

> 本项目基于官方 **DeepSeek Harness**（`@deepseek-ai/dsh`，MIT License）二次开发，当前适配版本 **0.1.5-rc.1**，是**非官方**的第三方桌面壳增强，与 DeepSeek 无隶属、赞助或背书关系。

---

## 下载安装

**[👉 点击前往 Releases 下载最新版 .exe](https://github.com/gniygniynus/dsh-desktop/releases/latest)**

下载 `dsh-desktop Setup x.x.x.exe`，双击安装，首次启动会自动完成初始化（无需额外操作）。

---

## 功能

| 功能 | 位置 | 行为 |
|------|------|------|
| 删除会话 | 会话列表 `⋯` → 删除会话 | 永久删除 + 列表刷新 |
| 撤回消息 | 用户消息下「撤回」按钮 | fork 到该消息前 + 归档母会话 + 自动切换 |
| 重新回答 | AI 回复下「重新回答」按钮 | fork + 重跑 + 归档母会话 + 自动切换 |
| 粘贴识别 | 设置 → 模型 → 添加自定义提供方 →「粘贴识别」 | 解析 NewAPI 通道连接串，自动填字段 + 拉模型列表 |
| 自动更新检测 | 启动后 5 秒 | 检查 GitHub Releases，有新版弹窗提示并提供下载链接 |

---

## 升级 / 卸载说明

### 从旧版升级到新版

1. **不需要卸载旧版**，直接下载新版安装包（`.exe`）覆盖安装即可
2. 或在旧版运行时等待启动提示：**「发现新版本」弹窗**出现后点击「前往下载」，下载新版安装包后双击覆盖安装
3. 安装完成后重新启动即生效，配置、会话数据均保留

### 卸载

**方法一：通过控制面板**

1. 打开「设置」→「应用」→「已安装的应用」
2. 搜索 **dsh-desktop**，点击「卸载」

**方法二：通过安装目录**

1. 找到安装目录（默认 `C:\Program Files\dsh-desktop` 或安装时自选路径）
2. 运行其中的 `Uninstall dsh-desktop.exe`

**卸载后清理（可选）**

卸载程序只移除应用本体，以下数据目录需手动删除（**含全部会话记录，请确认后再删**）：

```
%USERPROFILE%\.dsh\
```

---

## 开发 & 构建

```powershell
cd dsh-desktop
npm install
node scripts\install.mjs     # 打 client 补丁 + 装 host 插件
npx electron .               # 开发运行
npm run dist                 # 打包 → dist\dsh-desktop Setup x.x.x.exe
```

---

## 架构

- `plugins/dsh-session-rewind/` — host 插件（typert RPC：delete / rewind / regenerate）
- `patches/apply-session-rewind.js` — client 补丁（幂等，适配 4 个模块）
- `electron/main.js` — Electron 主进程 + 自动更新检测
- `scripts/prepack.mjs` — 打包前补丁（electron-builder 前自动调用）

---

## 声明

- 基于官方 **DeepSeek Harness**（`@deepseek-ai/dsh`，MIT License，Copyright (c) 2026 DeepSeek）。client 补丁作用于编译产物，host 插件是独立插件包，均未修改 harness 核心代码。
- **非官方**：本项目与 DeepSeek（深度求索）无隶属、赞助或背书关系。
- 名称与图标如涉及 DeepSeek 商标，请自行确认符合其品牌使用规范。
