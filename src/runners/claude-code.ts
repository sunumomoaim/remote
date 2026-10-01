import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { HistoryMessage, Progress, RunContext, Runner, RunResult } from "../core/types.js";

export interface ClaudeCodeRunnerOptions {
  /** `claude` コマンドのパス（省略時は PATH から探す） */
  command?: string;
  /** `--model` に渡す値（省略時は Claude Code の既定） */
  model?: string;
  systemPrompt?: string;
  /** 1 回の回答生成の上限時間（ms） */
  timeoutMs?: number;
  /** claude を実行する作業ディレクトリ */
  cwd?: string;
  /** `--tools` に渡す値。"" で全ツール無効（純粋なチャット）、"default" で全ツール */
  tools?: string;
  /** `--permission-mode` に渡す値（acceptEdits / dontAsk / bypassPermissions など） */
  permissionMode?: string;
  /** `--allowedTools` に渡す値（例: "Bash(npm *) Bash(git *)"） */
  allowedTools?: string;
}

const DEFAULT_SYSTEM = [
  "あなたはチャットツール上で動くアシスタントです。",
  "ユーザーはあなたの回答に対してスレッドで返信し、会話を続けます。",
  "返信はチャットで読みやすいように簡潔に。長い説明は箇条書きにしてください。",
  "Markdown の見出し(#)は使わず、強調は *太字* 程度にとどめてください。",
].join("\n");

export const STATE_KEY = "claudeCodeSessionId";

/** ツール呼び出しを 1 行の作業ログにする。 */
export function describeToolUse(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown, max = 100) => {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  switch (name) {
    case "Bash":
      return `🔧 Bash: \`${s(input.command)}\``;
    case "Read":
      return `📖 Read: ${s(input.file_path)}`;
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return `📝 ${name}: ${s(input.file_path ?? input.notebook_path)}`;
    case "Glob":
    case "Grep":
      return `🔍 ${name}: ${s(input.pattern)}`;
    case "WebFetch":
    case "WebSearch":
      return `🌐 ${name}: ${s(input.url ?? input.query)}`;
    case "Agent":
      return `🤖 Agent: ${s(input.description ?? input.prompt, 60)}`;
    default: {
      const first = Object.values(input)[0];
      return `🔧 ${name}${first !== undefined ? `: ${s(first, 60)}` : ""}`;
    }
  }
}

/**
 * ローカルの Claude Code CLI（`claude -p`）で回答を生成する Runner。
 *
 * Claude Pro / Max の契約に含まれる利用枠で動くため、API の従量課金が発生しない。
 * スレッド（またはプロジェクト）ごとに Claude Code のセッションを 1 つ持ち、
 * 2 回目以降は `--resume` で続きを話す。履歴は Claude Code 側が保持するので、
 * この Runner は最後のユーザー発言だけを渡す。
 *
 * ctx.onProgress があれば stream-json で実行し、途中経過（本文とツール実行）を流す。
 */
export class ClaudeCodeRunner implements Runner {
  private readonly command: string;
  private readonly model: string | undefined;
  private readonly system: string;
  private readonly timeoutMs: number;
  private readonly cwd: string | undefined;
  private readonly tools: string;
  private readonly permissionMode: string | undefined;
  private readonly allowedTools: string | undefined;

  constructor(opts: ClaudeCodeRunnerOptions = {}) {
    this.command = opts.command ?? "claude";
    this.model = opts.model;
    this.system = opts.systemPrompt ?? DEFAULT_SYSTEM;
    this.timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
    this.cwd = opts.cwd;
    this.tools = opts.tools ?? "";
    this.permissionMode = opts.permissionMode;
    this.allowedTools = opts.allowedTools;
  }

  async run(history: HistoryMessage[], ctx: RunContext): Promise<RunResult> {
    const last = history[history.length - 1];
    if (!last || last.role !== "user") throw new Error("history must end with a user message");
    const prompt = typeof last.content === "string" ? last.content : JSON.stringify(last.content);

    const streaming = !!ctx.onProgress;
    const args = ["-p", "--output-format", streaming ? "stream-json" : "json", "--tools", this.tools];
    if (streaming) args.push("--verbose", "--include-partial-messages");
    args.push("--append-system-prompt", this.system);
    if (this.model) args.push("--model", this.model);
    if (this.permissionMode) args.push("--permission-mode", this.permissionMode);
    if (this.allowedTools) args.push("--allowedTools", this.allowedTools);

    const existing = ctx.state[STATE_KEY];
    const sessionId = existing ?? randomUUID();
    args.push(existing ? "--resume" : "--session-id", sessionId);

    const { result, activity } = await this.exec(args, prompt, ctx);
    if (result.is_error) throw new Error(`claude reported an error (${result.subtype ?? "unknown"}): ${(result.result ?? "").slice(0, 200)}`);

    ctx.state[STATE_KEY] = result.session_id ?? sessionId;
    const text = (result.result ?? "").trim() || "(空の回答)";
    return { text, assistantContent: [{ type: "text", text }], activity };
  }

  private exec(
    args: string[],
    stdin: string,
    ctx: RunContext,
  ): Promise<{ result: ResultEvent; activity: string[] }> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.CLAUDE_CODE_SESSION_ID; // 親の Claude Code セッションを引き継がない
      const child = spawn(this.command, args, { cwd: this.cwd, env, stdio: ["pipe", "pipe", "pipe"] });

      const parser = new StreamParser(ctx.onProgress);
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () => {
        child.kill("SIGTERM");
        finish(() => reject(new Error("aborted")));
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new Error(`claude timed out after ${this.timeoutMs}ms`)));
      }, this.timeoutMs);
      if (ctx.signal?.aborted) return onAbort();
      ctx.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (ctx.onProgress) parser.feed(chunk);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (err) => finish(() => reject(new Error(`claude failed to start: ${err.message}`))));
      child.on("close", (code) => {
        finish(() => {
          if (code !== 0) {
            reject(new Error(`claude exited with code ${code}\n${stderr.slice(0, 500)}`));
            return;
          }
          const result = ctx.onProgress ? parser.result : parseSingleJson(stdout);
          if (!result) {
            reject(new Error(`claude returned no result: ${stdout.slice(0, 200)}`));
            return;
          }
          resolve({ result, activity: parser.activity });
        });
      });
      child.stdin.end(stdin);
    });
  }
}

interface ResultEvent {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

function parseSingleJson(stdout: string): ResultEvent | undefined {
  try {
    return JSON.parse(stdout) as ResultEvent;
  } catch {
    return undefined;
  }
}

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; name?: string; input?: Record<string, unknown> }
  | { type: string };

/** stream-json（1 行 1 イベント）を読み、本文と作業ログを組み立てる。 */
export class StreamParser {
  result: ResultEvent | undefined;
  readonly activity: string[] = [];
  private text = "";
  private partial = "";
  private buffer = "";

  constructor(private readonly onProgress?: (p: Progress) => void) {}

  feed(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.handleLine(line);
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (ev.type) {
      case "stream_event": {
        const e = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
        if (e?.type === "message_start") this.partial = "";
        if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
          this.partial += e.delta.text ?? "";
          this.emit(this.partial);
        }
        break;
      }
      case "assistant": {
        const msg = ev.message as { content?: ContentBlock[] } | undefined;
        const blocks = msg?.content ?? [];
        const texts = blocks.filter((b): b is { type: "text"; text?: string } => b.type === "text").map((b) => b.text ?? "");
        for (const b of blocks) {
          if (b.type === "tool_use") {
            const t = b as { name?: string; input?: Record<string, unknown> };
            this.activity.push(describeToolUse(t.name ?? "tool", t.input ?? {}));
          }
        }
        if (texts.length) this.text = texts.join("\n");
        this.emit(this.text || this.partial);
        break;
      }
      case "system": {
        if (ev.subtype === "permission_denied") {
          this.activity.push("⛔ 許可されていない操作をスキップしました");
          this.emit(this.text || this.partial);
        }
        break;
      }
      case "result":
        this.result = ev as unknown as ResultEvent;
        break;
      default:
        break;
    }
  }

  private emit(text: string) {
    this.onProgress?.({ text, activity: [...this.activity] });
  }
}
