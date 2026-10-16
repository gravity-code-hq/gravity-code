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
  <a href="https://github.com/gravity-code-hq/gravity-code/stargazers">
    <img src="https://img.shields.io/github/stars/gravity-code-hq/gravity-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/gravity-code-hq/gravity-code/releases">
    <img src="https://img.shields.io/github/v/release/gravity-code-hq/gravity-code?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode、Pi のエージェントを、ひとつのインターフェースで。</p>

<p align="center">
  <img src=".github/assets/gravity-workspace.png" width="900" alt="Gravity ワークスペース">
</p>

---

自分のマシンでエージェントを並列実行。スマートフォンからでもデスクからでも、開発を進めてリリースできます。

- **セルフホスト:** エージェントはあなたのマシン上で動作し、完全な開発環境を使用します。自分のツール・設定・スキルをそのまま活用できます。
- **マルチプロバイダー:** Claude Code、Codex、Copilot、OpenCode、Pi を同一のインターフェースで利用。タスクに合ったモデルを選べます。
- **音声コントロール:** 音声モードでタスクを口述したり問題を話し合ったりできます。ハンズフリーが必要なときに便利です。
- **クロスデバイス:** iOS、Android、デスクトップ、Web、CLI に対応。机で作業を始め、スマートフォンで確認し、ターミナルから自動化できます。
- **プライバシー優先:** Gravity にはテレメトリー・トラッキング・強制ログインは一切ありません。

## はじめかた

Gravity はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。デスクトップアプリ・モバイルアプリ・Web アプリ・CLI などのクライアントがこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### デスクトップアプリ（推奨）

[github.com/gravity-code-hq/gravity-code/download](https://github.com/gravity-code-hq/gravity-code/download) または [GitHub のリリースページ](https://github.com/gravity-code-hq/gravity-code/releases)からダウンロードしてください。アプリを開くとデーモンが自動的に起動します。追加のインストールは不要です。

スマートフォンから接続するには、Settings 画面に表示される QR コードをスキャンしてください。

### CLI / ヘッドレス

CLI をインストールして Gravity を起動します。

```bash
npm install -g @gravity/cli
gravity
```

ターミナルに QR コードが表示されます。どのクライアントからでも接続できます。サーバーやリモートマシンでの利用に適しています。

詳しいセットアップと設定については以下を参照してください。

- [ドキュメント](https://github.com/gravity-code-hq/gravity-code/docs)
- [設定リファレンス](https://github.com/gravity-code-hq/gravity-code/docs/configuration)

## CLI

アプリでできることはすべてターミナルからも実行できます。

```bash
gravity run --provider claude/opus-4.6 "implement user authentication"
gravity run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

gravity ls                           # 実行中のエージェントを一覧表示
gravity attach abc123                # ライブ出力をストリーミング
gravity send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行
gravity --host workstation.local:6767 run "run the full test suite"
```

詳細は[完全な CLI リファレンス](https://github.com/gravity-code-hq/gravity-code/docs/cli)を参照してください。

## スキル

スキルはエージェントに Gravity を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add gravity-code-hq/gravity-code
```

どのエージェントとの会話でも使用できます。

- `/gravity-handoff` — エージェント間で作業を引き継ぎます。私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。
- `/gravity-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/gravity-committee` — 対照的な2つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: Gravity デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: Expo クライアント（iOS、Android、Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `gravity` CLI
- `packages/desktop`: Electron デスクトップアプリ
- `packages/relay`: リモート接続用リレーパッケージ
- `packages/gravity-website`: マーケティングサイトとダウンロードページ

よく使うコマンド：

```bash
# すべてのローカル開発サービスを起動
npm run dev

# 個別のサービスを起動
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# サーバースタックをビルド
npm run build:server

# リポジトリ全体のチェック
npm run typecheck
```

## ライセンス

Gravity は [MIT License](LICENSE) のもとで提供されています。

Gravity には [Apache License 2.0](LICENSES/Apache-2.0.txt) でライセンスされた別プロジェクトのコードが含まれています。そのコードには引き続き Apache 2.0 が適用されます。帰属表示については [NOTICE](NOTICE) を参照してください。サードパーティのコンポーネントには、それぞれのライセンスが適用されます。
