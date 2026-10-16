<p align="center">
  <img src="packages/app/assets/images/icon.png" width="64" height="64" alt="Gravity logo">
</p>

<h1 align="center">Gravity</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/gravity-code-hq/gravity/stargazers">
    <img src="https://img.shields.io/github/stars/gravity-code-hq/gravity?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/gravity-code-hq/gravity/releases">
    <img src="https://img.shields.io/github/v/release/gravity-code-hq/gravity?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode 和 Pi agents 的统一界面。</p>

<p align="center">
  <img src=".github/assets/gravity-workspace.png" width="900" alt="Gravity 工作区">
</p>

---

在你自己的机器上并行运行 agents。无论在手机上还是桌前，都能推进交付。

- **自托管：** Agents 在你的机器上运行，使用完整的本地开发环境、工具、配置和技能。
- **多提供商：** 通过同一个界面使用 Claude Code、Codex、Copilot、OpenCode 和 Pi。为每个任务选择合适的模型。
- **语音控制：** 在语音模式下口述任务或讨论问题。需要免手操作时很方便。
- **跨设备：** 支持 iOS、Android、桌面端、Web 和 CLI。在桌前开始工作，用手机查看进度，也可以从终端脚本化操作。
- **隐私优先：** Gravity 没有遥测、追踪，也不会强制登录。

## 快速开始

Gravity 会运行一个名为 daemon 的本地服务，用来管理你的 coding agents。桌面 app、移动 app、Web app 和 CLI 等客户端都会连接到它。

### 前置条件

你至少需要安装一个 agent CLI，并用你的凭据完成配置：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### 桌面 app（推荐）

从 [github.com/gravity-code-hq/gravity/download](https://github.com/gravity-code-hq/gravity/download) 或 [GitHub releases 页面](https://github.com/gravity-code-hq/gravity/releases)下载。打开 app 后 daemon 会自动启动，不需要再安装其他东西。

如果要从手机连接，在 Settings 中扫描显示的二维码。

### CLI / 无头模式

安装 CLI 并启动 Gravity：

```bash
npm install -g @gravity/cli
gravity
```

终端中会显示一个二维码。你可以从任意客户端连接。这个方式适合服务器和远程机器。

完整安装和配置见：

- [文档](https://github.com/gravity-code-hq/gravity/docs)
- [配置参考](https://github.com/gravity-code-hq/gravity/docs/configuration)

## CLI

你能在 app 中完成的事情，也都可以在终端中完成。

```bash
gravity run --provider claude/opus-4.6 "implement user authentication"
gravity run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

gravity ls                           # 列出正在运行的 agents
gravity attach abc123                # 实时流式查看输出
gravity send abc123 "also add tests" # 发送后续任务

# 在远程 daemon 上运行
gravity --host workstation.local:6767 run "run the full test suite"
```

更多内容见[完整 CLI 参考](https://github.com/gravity-code-hq/gravity/docs/cli)。

## Skills

Skills 会教你的 agent 使用 Gravity 来编排其他 agents。

```bash
npx skills add gravity-code-hq/gravity
```

然后在任意 agent 对话中使用：

- `/gravity-handoff` — 在 agents 之间交接工作。我会用它先和 Claude 规划，再交给 Codex 实现。
- `/gravity-advisor` — 启动单个 agent 作为 advisor，提供第二意见，但不把工作委托出去。
- `/gravity-committee` — 组建两个风格互补的 agents，让它们后退一步做根因分析并产出计划。

## 开发

Monorepo 包结构速览：

- `packages/server`：Gravity daemon（agent 进程编排、WebSocket API、MCP server）
- `packages/app`：Expo 客户端（iOS、Android、Web）
- `packages/cli`：用于 daemon 和 agent 工作流的 `gravity` CLI
- `packages/desktop`：Electron 桌面 app
- `packages/relay`：用于远程连接的 relay 包
- `packages/gravity-website`：营销站点和下载页面

常用命令：

```bash
# 运行所有本地开发服务
npm run dev

# 单独运行某个界面
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# 构建 server stack
npm run build:server

# 全仓库检查
npm run typecheck
```

## License

Gravity 采用 [MIT License](LICENSE) 许可证。

Gravity 包含来自另一个采用 [Apache License 2.0](LICENSES/Apache-2.0.txt) 许可的项目的代码，这部分代码仍采用 Apache 2.0。署名信息见 [NOTICE](NOTICE)。第三方组件保留各自的许可证。
