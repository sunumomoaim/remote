import type { HistoryMessage, Runner, RunResult } from "../core/types.js";

/** API キーなしで動作確認するためのダミー Runner。 */
export class EchoRunner implements Runner {
  async run(history: HistoryMessage[]): Promise<RunResult> {
    const last = history[history.length - 1];
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    const turn = history.filter((m) => m.role === "user").length;
    const reply = `(echo #${turn}) ${text}`;
    return { text: reply, assistantContent: [{ type: "text", text: reply }] };
  }
}
