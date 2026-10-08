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
| `src/core/projects.ts` | チャンネルとプロジェクトフォルダの紐づけ（`data/projects.json`） |
| `src/core/sessions.ts` | PC 上の Claude Code セッション一覧の読み取り（`~/.claude/projects`） |
| `src/runners/claude-code.ts` | **既定。** ローカルの Claude Code（`claude -p`）で回答を生成する Runner。Pro / Max の契約枠で動き、従量課金なし |
| `src/runners/claude.ts` | Claude Messages API（API キー・従量課金）で回答を生成する Runner |
| `src/runners/echo.ts` | API を呼ばない動作確認用 Runner |
| `src/adapters/slack.ts` | Slack アダプタ（Socket Mode、公開 URL 不要） |
| `src/adapters/http.ts` | 汎用 HTTP アダプタ。curl や他チャットからの橋渡し用 |
| `src/index.ts` | 環境変数から組み立てて起動 |

`Runner` と `ChatAdapter` はインターフェースなので、Discord / LINE / Teams 用のアダプタや別の AI バックエンドを足せます。

## プロジェクトモード（チャンネル = PC 上のフォルダ）

チャンネルを PC 上のプロジェクトフォルダに紐づけると、**メンションなしで書いた発言がそのまま Claude Code への指示**になり、
そのフォルダで実行されます。Claude と直接話しているように、進捗がリアルタイムで流れます。

```
#lunchscope チャンネルで:
  !project ~/dev/lunchscope      ← 紐づけ（1 回だけ）
  テストを全部通して               ← 以後はこれだけで Claude Code が動く
```

回答メッセージは実行中に数秒ごとに書き換わり、使っているツール（🔧 Bash、📝 Edit、📖 Read …）と途中の文章が見えます。
終わると最終回答と作業ログに置き換わります。

| コマンド | 動き |
|---|---|
| `!project /path/to/dir` | このチャンネルをそのフォルダに紐づける（`~` 可） |
| `!project` / `!unproject` | 紐づけの表示 / 解除 |
| `!sessions` | そのフォルダにある PC 上の Claude Code セッション一覧（新しい順、▶ が現在） |
| `!resume <セッションID>` | そのセッションの続きから話す（ターミナルで進めていた作業を Slack から引き継げる） |
| `!new` | 新しいセッションで始める |
| `!stop` | 実行中の処理を中断 |
| `!help` | 使い方 |

プロジェクトモードは `claude-code` 方式のときだけ有効です。ツールの権限は環境変数で決めます。

| 変数 | 既定 | 説明 |
|---|---|---|
| `PROJECT_PERMISSION_MODE` | `acceptEdits` | ファイル編集は自動許可。`bypassPermissions` にすると全操作を自動許可（信頼できるフォルダだけで） |
| `PROJECT_ALLOWED_TOOLS` | – | 自動許可するツール。例 `Bash(npm *) Bash(git *)` |
| `PROJECT_TOOLS` | `default` | 使えるツール。`""` でチャットのみ |
| `PROJECT_SYSTEM_PROMPT` | 内蔵 | プロジェクト用システムプロンプト |
| `PROJECTS_FILE` | `data/projects.json` | 紐づけの保存先 |
| `STREAM_UPDATE_MS` | `1500` | リアルタイム表示の更新間隔 |

許可されていない操作（例: 許可リストにない Bash コマンド）は自動的にスキップされ、作業ログに「⛔」と出ます。

## 駆動ルール

- **@メンション / DM** → 新しい会話を開始し、その発言を根本とするスレッドに回答を投稿
- **既知のスレッドへの返信（メンション不要）** → 履歴を引き継いで AI を再駆動し、同じスレッドに回答
- **知らないスレッドの返信** → 無視（他人の雑談に割り込まない）
- 回答は「⏳ 考え中…」を先に投稿し、途中経過で書き換え、最後に回答に置き換える（Slack）
- 回答の先頭に「@発言者 > 元の発言（先頭 80 文字）」を付け、どの発言への返信かを明示（`SLACK_QUOTE_ORIGINAL=false` で無効）
- `SLACK_REPLY_BROADCAST=true` でスレッド返信をチャンネルにも表示
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

## 家の PC で常時動かして、外からスマホの Slack で指示する

家の PC でボットを常駐させておけば、外出先の Slack から PC 上のプロジェクトに指示が出せます。

### 1. 初回セットアップ（PC で 1 回だけ）

```bash
git clone https://github.com/sunumomoaim/remote.git
cd remote
npm install
cp .env.example .env        # SLACK_BOT_TOKEN / SLACK_APP_TOKEN と、必要なら PROJECT_ALLOWED_TOOLS を書く
claude                      # Claude Code にログイン済みか確認（対話できれば OK。/exit で抜ける）
```

### 2. 常駐させる（pm2）

```bash
set -a; source .env; set +a
npm run daemon              # ビルドして常駐開始。落ちても自動で再起動する
npm run daemon:status       # 状態
npm run daemon:logs         # ログ
npm run daemon:restart      # コードを更新したとき（git pull のあと）
npm run daemon:stop         # 止める
```

### 3. PC を再起動しても自動で立ち上がるようにする

```bash
npx pm2 startup             # 表示されたコマンドをそのままコピーして実行する（macOS / Linux）
npx pm2 save
```

Windows は `npm i -g pm2-windows-startup && pm2-startup install` のあと `npx pm2 save` です。

### 4. PC がスリープしないようにする

- macOS: システム設定 → ディスプレイ → 詳細設定 → 「電源アダプタ接続時はディスプレイがオフのときに自動でスリープさせない」をオン。ノート PC はふたを閉じると止まるので、電源につないで開いたままにするか `caffeinate -s` を使う
- Windows: 設定 → システム → 電源 → 「スリープ」を「なし」

### 5. 使い方

1. Slack でプロジェクトごとにチャンネルを作り `/invite @reply_driver`
2. そのチャンネルで `!project ~/dev/そのプロジェクト`
3. `!sessions` → `!resume <ID>` で PC で進めていた作業の続きから、または `!new` で新規
4. あとは普通に「テストを通して」「〇〇を直して」と書くだけ。進捗がリアルタイムで流れます

### pm2 を使わない場合

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
| `SLACK_QUOTE_ORIGINAL` | `true` | 回答の先頭に発言者メンションと元の発言の引用を付ける |
| `SLACK_REPLY_BROADCAST` | `false` | スレッド返信をチャンネルにも表示する |
| `ADAPTERS` | Slack トークンがあれば `slack`、なければ `http` | `slack,http` で併用可 |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP アダプタ |
| `OUTBOUND_WEBHOOK` | – | AI の返信を転送する URL |
| `DATA_DIR` | `data/conversations` | 会話履歴の保存先 |

## 同居プロジェクト

| パス | 内容 |
|---|---|
| `junk-risk-checker/` | ヤフオクの中古カメラ「ジャンク出品」を出品者の行動から危険度判定する Web アプリ。独立した package.json を持つ。詳細は [junk-risk-checker/README.md](junk-risk-checker/README.md) |
