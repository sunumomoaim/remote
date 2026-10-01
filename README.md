# chat-reply-driver

AI の回答をチャットのスレッドに投稿し、**その回答にユーザーが返信すると AI が再び駆動される**仕組みです。
返信 → 回答 → 返信 → 回答 … とスレッド単位で会話が続きます。

```
ユーザー                    Driver                         Claude
  │  @bot 質問                │                               │
  ├──────────────────────────►│ スレッド鍵 = platform:channel:thread
  │                           │ 履歴に user を追加            │
  │                           ├──────────────────────────────►│
  │                           │◄──────────────────────────────┤ 回答
  │  ◄── スレッドに回答を投稿 ─┤ 履歴に assistant を追加・保存  │
  │                           │                               │
  │  （回答に返信）            │                               │
  ├──────────────────────────►│ 既知のスレッド → 履歴ごと再駆動 │
  │                           ├──────────────────────────────►│
  │  ◄── 同じスレッドに回答 ───┤◄──────────────────────────────┤
```

## 構成

| パス | 役割 |
|---|---|
| `src/core/driver.ts` | 中核。スレッドを鍵に会話を引き、返信で AI を再駆動し、回答を同じスレッドへ投稿する |
| `src/core/store.ts` | 会話履歴の保存。`FileStore`（JSON ファイル、再起動後も継続）と `MemoryStore` |
| `src/runners/claude-code.ts` | **既定。** ローカルの Claude Code（`claude -p`）で回答を生成する Runner。Pro / Max の契約枠で動き、従量課金なし |
| `src/runners/claude.ts` | Claude Messages API（API キー・従量課金）で回答を生成する Runner |
| `src/runners/echo.ts` | API を呼ばない動作確認用 Runner |
| `src/adapters/slack.ts` | Slack アダプタ（Socket Mode、公開 URL 不要） |
| `src/adapters/http.ts` | 汎用 HTTP アダプタ。curl や他チャットからの橋渡し用 |
| `src/index.ts` | 環境変数から組み立てて起動 |

`Runner` と `ChatAdapter` はインターフェースなので、Discord / LINE / Teams 用のアダプタや別の AI バックエンドを足せます。

## 駆動ルール

- **@メンション / DM** → 新しい会話を開始し、その発言を根本とするスレッドに回答を投稿
- **既知のスレッドへの返信（メンション不要）** → 履歴を引き継いで AI を再駆動し、同じスレッドに回答
- **知らないスレッドの返信** → 無視（他人の雑談に割り込まない）
- `!reset` / `/reset` / `リセット` と返信 → そのスレッドの履歴を消去
- 同じスレッドの返信は直列処理。別スレッドは並行処理
- 同じメッセージの重複配送は 1 回だけ処理
- 回答生成に失敗したらスレッドにその旨を投稿し、失敗した発言は履歴に残さない（再送で再試行できる）

## 回答エンジンの選び方（料金）

| RUNNER | 何で動くか | 料金 | 必要なもの |
|---|---|---|---|
| `claude-code`（既定） | PC にインストールした Claude Code の `claude` コマンド | **追加料金なし**（Claude Pro / Max の利用上限内） | Claude Code をインストールしてログイン済みであること |
| `api` | Anthropic API | 従量課金 | `ANTHROPIC_API_KEY` |
| `echo` | 何も呼ばない | 無料 | なし（配線の確認用） |

`ANTHROPIC_API_KEY` が設定されていなければ自動的に `claude-code` が選ばれます。
`claude-code` はスレッドごとに Claude Code のセッションを 1 つ持ち、返信のたびに `--resume` で続きを話します。

## セットアップ

```bash
npm install
cp .env.example .env   # 値を埋める
```

### 無料で動かす（claude-code 方式）

1. ボットを動かす PC に Claude Code を入れてログインしておく（`claude` と打って対話できれば OK）
2. `.env` に Slack の 2 つのトークンだけを書く（`ANTHROPIC_API_KEY` は不要）
3. `npm run dev`

### Slack

1. https://api.slack.com/apps → **Create New App → From a manifest** で `slack-manifest.yml` を貼り付ける
2. **Basic Information → App-Level Tokens** で `connections:write` スコープのトークンを作る → `SLACK_APP_TOKEN`（`xapp-...`）
3. **Install to Workspace** → `SLACK_BOT_TOKEN`（`xoxb-...`）
4. `ANTHROPIC_API_KEY` を設定して起動

```bash
set -a; source .env; set +a
npm run dev
```

チャンネルでボットをメンションするか DM すると回答が返ります。回答にスレッドで返信すると会話が続きます。

### HTTP（curl / 他チャットからの橋渡し）

```bash
RUNNER=echo ADAPTERS=http npm run dev
```

```bash
# 新規会話（threadId 無し）→ threadId が返る
curl -s localhost:3000/messages -H 'content-type: application/json' \
  -d '{"text":"こんにちは"}'
# => {"threadId":"6f2c...","reply":"(echo #1) こんにちは"}

# 返信（同じ threadId）→ 履歴を引き継いで再駆動
curl -s localhost:3000/messages -H 'content-type: application/json' \
  -d '{"text":"続きをお願い","threadId":"6f2c..."}'
```

`OUTBOUND_WEBHOOK` を設定すると、AI の返信を外部 URL へ POST で転送します。
Slack 以外のチャットは「受信 Webhook → `/messages` へ POST」「`OUTBOUND_WEBHOOK` → そのチャットへ投稿」の 2 本で接続できます。

## 本番向け

```bash
npm run build
npm start
```

## テスト

```bash
npm test          # Driver の駆動ルールと HTTP アダプタのテスト
npm run typecheck
```

## 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `RUNNER` | API キーがあれば `api`、なければ `claude-code` | `claude-code` / `api` / `echo` |
| `CLAUDE_COMMAND` | `claude` | claude-code 方式で使うコマンドのパス |
| `ANTHROPIC_API_KEY` | – | api 方式のときだけ必要 |
| `CLAUDE_MODEL` | claude-code: Claude Code の既定 / api: `claude-opus-5-5` | 使用モデル |
| `CLAUDE_EFFORT` | `medium` | api 方式の思考の深さ `low`〜`max` |
| `SYSTEM_PROMPT` | 内蔵のチャット向けプロンプト | システムプロンプトの差し替え |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | – | Slack 用 |
| `ADAPTERS` | Slack トークンがあれば `slack`、なければ `http` | `slack,http` で併用可 |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP アダプタ |
| `OUTBOUND_WEBHOOK` | – | AI の返信を転送する URL |
| `DATA_DIR` | `data/conversations` | 会話履歴の保存先 |
