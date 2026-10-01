import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { HistoryMessage, RunContext, Runner, RunResult } from "../core/types.js";

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
}

const DEFAULT_SYSTEM = [
  "あなたはチャットツール上で動くアシスタントです。",
  "ユーザーはあなたの回答に対してスレッドで返信し、会話を続けます。",
  "返信はチャットで読みやすいように簡潔に。長い説明は箇条書きにしてください。",
  "Markdown の見出し(#)は使わず、強調は *太字* 程度にとどめてください。",
].join("\n");

const STATE_KEY = "claudeCodeSessionId";

/**
 * ローカルの Claude Code CLI（`claude -p`）で回答を生成する Runner。
 *
 * Claude Pro / Max の契約に含まれる利用枠で動くため、API の従量課金が発生しない。
 * スレッドごとに Claude Code のセッションを 1 つ持ち、2 回目以降は `--resume` で続きを話す。
 * そのため履歴は Claude Code 側が保持し、この Runner は最後のユーザー発言だけを渡す。
 */
export class ClaudeCodeRunner implements Runner {
  private readonly command: string;
  private readonly model: string | undefined;
  private readonly system: string;
  private readonly timeoutMs: number;
  private readonly cwd: string | undefined;

  constructor(opts: ClaudeCodeRunnerOptions = {}) {
    this.command = opts.command ?? "claude";
    this.model = opts.model;
    this.system = opts.systemPrompt ?? DEFAULT_SYSTEM;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    this.cwd = opts.cwd;
  }

  async run(history: HistoryMessage[], ctx: RunContext): Promise<RunResult> {
    const last = history[history.length - 1];
    if (!last || last.role !== "user") throw new Error("history must end with a user message");
    const prompt = typeof last.content === "string" ? last.content : JSON.stringify(last.content);

    const args = ["-p", "--output-format", "json", "--tools", "", "--append-system-prompt", this.system];
    if (this.model) args.push("--model", this.model);

    const existing = ctx.state[STATE_KEY];
    const sessionId = existing ?? randomUUID();
    args.push(existing ? "--resume" : "--session-id", sessionId);

    const stdout = await this.exec(args, prompt);
    let parsed: { result?: string; session_id?: string; is_error?: boolean; subtype?: string };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`claude returned non-JSON output: ${stdout.slice(0, 200)}`);
    }
    if (parsed.is_error) throw new Error(`claude reported an error (${parsed.subtype ?? "unknown"})`);

    ctx.state[STATE_KEY] = parsed.session_id ?? sessionId;
    const text = (parsed.result ?? "").trim() || "(空の回答)";
    return { text, assistantContent: [{ type: "text", text }] };
  }

  private exec(args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.command,
        args,
        { cwd: this.cwd, timeout: this.timeoutMs, maxBuffer: 16 * 1024 * 1024, env: process.env },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`claude failed: ${err.message}\n${String(stderr).slice(0, 500)}`));
            return;
          }
          resolve(String(stdout));
        },
      );
      child.stdin?.end(stdin);
    });
  }
}
