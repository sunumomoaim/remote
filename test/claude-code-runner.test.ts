import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ClaudeCodeRunner } from "../src/runners/claude-code.js";

/** 偽の `claude` コマンド。受け取った引数と stdin を記録し、JSON を返す。 */
async function fakeClaude() {
  const dir = await mkdtemp(path.join(tmpdir(), "fake-claude-"));
  const log = path.join(dir, "calls.jsonl");
  const bin = path.join(dir, "claude");
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin }) + "\\n");
const i = Math.max(args.indexOf("--session-id"), args.indexOf("--resume"));
const sid = i >= 0 ? args[i + 1] : "none";
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "answer to: " + stdin.trim(), session_id: sid }));
`,
  );
  await chmod(bin, 0o755);
  return {
    bin,
    calls: async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { args: string[]; stdin: string }),
  };
}

test("first turn starts a session with --session-id, later turns use --resume with the same id", async () => {
  const fake = await fakeClaude();
  const runner = new ClaudeCodeRunner({ command: fake.bin, systemPrompt: "SYS" });
  const state: Record<string, string> = {};

  const r1 = await runner.run([{ role: "user", content: "最初" }], { conversationKey: "k", state });
  assert.equal(r1.text, "answer to: 最初");
  const sid = state.claudeCodeSessionId;
  assert.match(sid, /^[0-9a-f-]{36}$/);

  const r2 = await runner.run(
    [
      { role: "user", content: "最初" },
      { role: "assistant", content: r1.assistantContent },
      { role: "user", content: "続き" },
    ],
    { conversationKey: "k", state },
  );
  assert.equal(r2.text, "answer to: 続き");
  assert.equal(state.claudeCodeSessionId, sid);

  const calls = await fake.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(0, 5), ["-p", "--output-format", "json", "--tools", ""]);
  assert.ok(calls[0].args.includes("--append-system-prompt"));
  assert.equal(calls[0].args[calls[0].args.indexOf("--append-system-prompt") + 1], "SYS");
  assert.equal(calls[0].args[calls[0].args.indexOf("--session-id") + 1], sid);
  assert.equal(calls[1].args[calls[1].args.indexOf("--resume") + 1], sid);
  assert.ok(!calls[1].args.includes("--session-id"));
  assert.equal(calls[0].stdin, "最初");
  assert.equal(calls[1].stdin, "続き");
});

test("a non-zero exit is surfaced as an error", async () => {
  const runner = new ClaudeCodeRunner({ command: "/nonexistent/claude" });
  await assert.rejects(runner.run([{ role: "user", content: "x" }], { conversationKey: "k", state: {} }), /claude failed/);
});
