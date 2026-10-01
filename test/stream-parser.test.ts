import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamParser, describeToolUse } from "../src/runners/claude-code.js";
import type { Progress } from "../src/core/types.js";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;

test("StreamParser builds live text, activity and the final result from stream-json", () => {
  const seen: Progress[] = [];
  const p = new StreamParser((x) => seen.push(x));
  p.feed(line({ type: "system", subtype: "init" }));
  p.feed(line({ type: "stream_event", event: { type: "message_start" } }));
  p.feed(line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Bash" } } }));
  p.feed(line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } }));
  p.feed(line({ type: "system", subtype: "permission_denied" }));
  p.feed(line({ type: "user", message: { content: [{ type: "tool_result" }] } }));
  // 途中で切れた行も扱える
  const partial = line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "テストは" } } });
  p.feed(partial.slice(0, 20));
  p.feed(partial.slice(20));
  p.feed(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "通りました" } } }));
  p.feed(line({ type: "assistant", message: { content: [{ type: "text", text: "テストは通りました" }] } }));
  p.feed(line({ type: "result", subtype: "success", result: "テストは通りました", session_id: "sid-1", is_error: false }));

  assert.deepEqual(p.activity, ["🔧 Bash: `npm test`", "⛔ 許可されていない操作をスキップしました"]);
  assert.equal(p.result?.result, "テストは通りました");
  assert.equal(p.result?.session_id, "sid-1");
  assert.ok(seen.some((s) => s.text === "テストは"));
  assert.equal(seen[seen.length - 1].text, "テストは通りました");
});

test("describeToolUse summarizes common tools", () => {
  assert.equal(describeToolUse("Bash", { command: "ls   -la" }), "🔧 Bash: `ls -la`");
  assert.equal(describeToolUse("Edit", { file_path: "src/a.ts" }), "📝 Edit: src/a.ts");
  assert.equal(describeToolUse("Grep", { pattern: "foo" }), "🔍 Grep: foo");
  assert.equal(describeToolUse("Weird", { x: 1 }), "🔧 Weird: 1");
  assert.equal(describeToolUse("Bash", { command: "x".repeat(200) }).length, "🔧 Bash: `".length + 101 + 1);
});
