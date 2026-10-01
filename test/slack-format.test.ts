import { test } from "node:test";
import assert from "node:assert/strict";
import { formatQuote } from "../src/adapters/slack.js";

test("formatQuote collapses whitespace and truncates long text", () => {
  assert.equal(formatQuote("  こんにちは、\n自己紹介して  "), "こんにちは、 自己紹介して");
  const long = "あ".repeat(100);
  const q = formatQuote(long);
  assert.equal(q.length, 81);
  assert.ok(q.endsWith("…"));
});
