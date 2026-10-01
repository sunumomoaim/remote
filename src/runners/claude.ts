import Anthropic from "@anthropic-ai/sdk";
import type { HistoryMessage, Runner, RunResult } from "../core/types.js";

export interface ClaudeRunnerOptions {
  client?: Anthropic;
  model?: string;
  systemPrompt?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

const DEFAULT_SYSTEM = [
  "あなたはチャットツール上で動くアシスタントです。",
  "ユーザーはあなたの回答に対してスレッドで返信し、会話を続けます。",
  "返信はチャットで読みやすいように簡潔に。長い説明は箇条書きにしてください。",
  "Markdown の見出し(#)は使わず、強調は *太字* 程度にとどめてください。",
].join("\n");

/** Claude Messages API で履歴から次の回答を生成する Runner。 */
export class ClaudeRunner implements Runner {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly system: string;
  private readonly effort: ClaudeRunnerOptions["effort"];
  private readonly maxTokens: number;

  constructor(opts: ClaudeRunnerOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? "claude-opus-5-5";
    this.system = opts.systemPrompt ?? DEFAULT_SYSTEM;
    this.effort = opts.effort ?? "medium";
    this.maxTokens = opts.maxTokens ?? 16000;
  }

  async run(history: HistoryMessage[]): Promise<RunResult> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
      messages: history,
      output_config: { effort: this.effort },
      // 安全分類器による拒否時は Anthropic 推奨のモデルへサーバー側で自動フォールバック
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category ?? "unspecified";
      return {
        text: `この依頼には回答できませんでした（理由カテゴリ: ${category}）。言い換えて再度返信してください。`,
        assistantContent: [{ type: "text", text: "(refused)" }],
      };
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // 同じモデルで会話を続けるため、thinking block を含む content をそのまま履歴に残す
    const assistantContent = message.content as unknown as Anthropic.Beta.BetaContentBlockParam[];

    return {
      text: text || "(空の回答)",
      assistantContent,
    };
  }
}
