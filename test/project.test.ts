import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Driver } from "../src/core/driver.js";
import { ProjectRegistry } from "../src/core/projects.js";
import { MemoryStore } from "../src/core/store.js";
import { listLocalSessions, projectDirName } from "../src/core/sessions.js";
import { EchoRunner } from "../src/runners/echo.js";
import type { ChatAdapter, HistoryMessage, InboundMessage, OutboundMessage, ReplyTarget, RunContext, Runner } from "../src/core/types.js";

const silent = { info() {}, warn() {}, error() {} };

/** update() に対応した偽アダプタ。投稿と書き換えを記録する。 */
class LiveAdapter implements ChatAdapter {
  readonly name = "fake";
  sent: OutboundMessage[] = [];
  updates: Array<{ messageId: string; text: string; inReplyTo?: ReplyTarget }> = [];
  async start() {}
  async stop() {}
  async send(msg: OutboundMessage) {
    this.sent.push(msg);
    return { messageId: `m${this.sent.length}` };
  }
  async update(_channelId: string, messageId: string, text: string, inReplyTo?: ReplyTarget) {
    this.updates.push({ messageId, text, inReplyTo });
  }
}

/** 途中経過を流してから答える偽 Runner。cwd ごとに生成されたことも記録する。 */
class StreamingRunner implements Runner {
  static created: string[] = [];
  calls: Array<{ history: HistoryMessage[]; state: Record<string, string> }> = [];
  constructor(readonly cwd: string) {
    StreamingRunner.created.push(cwd);
  }
  async run(history: HistoryMessage[], ctx: RunContext) {
    this.calls.push({ history: structuredClone(history), state: ctx.state });
    ctx.onProgress?.({ text: "", activity: ["🔧 Bash: `ls`"] });
    await new Promise((r) => setTimeout(r, 5));
    ctx.onProgress?.({ text: "途中まで", activity: ["🔧 Bash: `ls`", "📖 Read: a.ts"] });
    await new Promise((r) => setTimeout(r, 5));
    if (ctx.signal?.aborted) throw new Error("aborted");
    ctx.state.claudeCodeSessionId ??= "11111111-2222-4333-8444-555555555555";
    return { text: `done in ${this.cwd}`, assistantContent: [{ type: "text" as const, text: "done" }], activity: ["🔧 Bash: `ls`", "📖 Read: a.ts"] };
  }
}

function msg(over: Partial<InboundMessage>): InboundMessage {
  return {
    platform: "fake",
    channelId: "C1",
    threadId: "T1",
    messageId: `id-${Math.random()}`,
    userId: "U1",
    text: "hello",
    addressed: false,
    inThread: false,
    ...over,
  };
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "proj-"));
  const projectDir = path.join(dir, "myproj");
  await mkdir(projectDir);
  const adapter = new LiveAdapter();
  const projects = new ProjectRegistry(path.join(dir, "projects.json"));
  const runners: StreamingRunner[] = [];
  const driver = new Driver({
    store: new MemoryStore(),
    runner: new EchoRunner(),
    adapters: new Map([[adapter.name, adapter]]),
    projects,
    projectRunner: (cwd) => {
      const r = new StreamingRunner(cwd);
      runners.push(r);
      return r;
    },
    updateIntervalMs: 1,
    home: dir,
    logger: silent,
  });
  return { dir, projectDir, adapter, projects, driver, runners };
}

test("!project binds the channel; later messages run in that folder with live updates", async () => {
  const { projectDir, adapter, driver, runners } = await setup();

  await driver.handle(msg({ text: `!project ${projectDir}`, messageId: "a" }));
  assert.match(adapter.sent[0].text, /紐づけました/);

  await driver.handle(msg({ text: "テストを実行して", messageId: "b", threadId: "b" }));
  // 「考え中」→ 書き換え → 最終回答
  assert.equal(adapter.sent[1].text, "⏳ 考え中…");
  assert.equal(adapter.sent[1].threadId, undefined); // チャンネル直下に返す
  assert.ok(adapter.updates.length >= 1);
  const final = adapter.updates[adapter.updates.length - 1];
  assert.equal(final.messageId, "m2");
  assert.match(final.text, /done in .*myproj/);
  assert.match(final.text, /作業ログ（2 件）/);
  assert.equal(final.inReplyTo?.text, "テストを実行して");

  assert.equal(runners.length, 1);
  assert.equal(runners[0].cwd, projectDir);
  assert.equal(runners[0].calls[0].history.length, 1);
});

test("project session id persists across turns and !new clears it", async () => {
  const { projectDir, adapter, driver, projects, runners } = await setup();
  await driver.handle(msg({ text: `!project ${projectDir}`, messageId: "a" }));
  await driver.handle(msg({ text: "1", messageId: "b", threadId: "b" }));
  await driver.handle(msg({ text: "2", messageId: "c", threadId: "c" }));
  const binding = await projects.get("fake:C1");
  assert.equal(binding?.state.claudeCodeSessionId, "11111111-2222-4333-8444-555555555555");
  assert.equal(runners[0].calls[1].state.claudeCodeSessionId, "11111111-2222-4333-8444-555555555555");

  await driver.handle(msg({ text: "!new", messageId: "d" }));
  assert.equal((await projects.get("fake:C1"))?.state.claudeCodeSessionId, undefined);
  assert.match(adapter.sent[adapter.sent.length - 1].text, /新しいセッション/);
});

test("!resume sets the session id and !sessions lists local sessions", async () => {
  const { dir, projectDir, adapter, driver, projects } = await setup();
  await driver.handle(msg({ text: `!project ${projectDir}`, messageId: "a" }));

  // PC 上のセッションファイルを偽装
  const sdir = path.join(dir, ".claude", "projects", projectDirName(projectDir));
  await mkdir(sdir, { recursive: true });
  await writeFile(
    path.join(sdir, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl"),
    `${JSON.stringify({ type: "queue-operation" })}\n${JSON.stringify({ type: "user", message: { role: "user", content: "ログイン画面を作って" } })}\n`,
  );
  await driver.handle(msg({ text: "!sessions", messageId: "b" }));
  const listing = adapter.sent[adapter.sent.length - 1].text;
  assert.match(listing, /aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/);
  assert.match(listing, /ログイン画面を作って/);

  await driver.handle(msg({ text: "!resume aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", messageId: "c" }));
  assert.equal((await projects.get("fake:C1"))?.state.claudeCodeSessionId, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");

  await driver.handle(msg({ text: "!resume nope", messageId: "d" }));
  assert.match(adapter.sent[adapter.sent.length - 1].text, /セッション ID を指定/);
});

test("!project with a missing folder is rejected and !unproject removes the binding", async () => {
  const { dir, adapter, driver, projects } = await setup();
  await driver.handle(msg({ text: `!project ${path.join(dir, "nope")}`, messageId: "a" }));
  assert.match(adapter.sent[0].text, /見つかりません/);
  assert.equal(await projects.get("fake:C1"), undefined);

  await driver.handle(msg({ text: "!unproject", messageId: "b" }));
  assert.match(adapter.sent[1].text, /紐づいていません/);
});

test("!stop aborts a running project turn", async () => {
  const { projectDir, adapter, driver } = await setup();
  await driver.handle(msg({ text: `!project ${projectDir}`, messageId: "a" }));
  const running = driver.handle(msg({ text: "長い作業", messageId: "b", threadId: "b" }));
  await new Promise((r) => setTimeout(r, 2));
  await driver.handle(msg({ text: "!stop", messageId: "c" }));
  await running;
  assert.ok(adapter.sent.some((m) => m.text === "中断しました。"));
  const final = adapter.updates[adapter.updates.length - 1];
  assert.equal(final.text, "⏹ 中断しました。");
});

test("thread mode also streams when the adapter supports update", async () => {
  const { adapter, driver } = await setup();
  await driver.handle(msg({ text: "質問", addressed: true, messageId: "a" }));
  assert.equal(adapter.sent[0].text, "⏳ 考え中…");
  assert.equal(adapter.sent[0].threadId, "T1");
  assert.equal(adapter.updates[adapter.updates.length - 1].text, "(echo #1) 質問");
});

test("unbound channel chatter is still ignored", async () => {
  const { adapter, driver } = await setup();
  await driver.handle(msg({ text: "雑談", messageId: "a" }));
  assert.equal(adapter.sent.length, 0);
});

test("listLocalSessions returns [] when the folder has no sessions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nosess-"));
  assert.deepEqual(await listLocalSessions("/no/such/dir", 10, dir), []);
});
