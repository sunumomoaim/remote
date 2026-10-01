import { test } from "node:test";
import assert from "node:assert/strict";
import { Driver } from "../src/core/driver.js";
import { MemoryStore } from "../src/core/store.js";
import { EchoRunner } from "../src/runners/echo.js";
import type { ChatAdapter, HistoryMessage, InboundMessage, OutboundMessage, Runner } from "../src/core/types.js";

class FakeAdapter implements ChatAdapter {
  readonly name = "fake";
  sent: OutboundMessage[] = [];
  async start() {}
  async stop() {}
  async send(msg: OutboundMessage) {
    this.sent.push(msg);
    return { messageId: `m${this.sent.length}` };
  }
}

class RecordingRunner implements Runner {
  calls: HistoryMessage[][] = [];
  async run(history: HistoryMessage[]) {
    this.calls.push(structuredClone(history));
    const reply = `reply#${this.calls.length}`;
    return { text: reply, assistantContent: [{ type: "text" as const, text: reply }] };
  }
}

const silent = { info() {}, warn() {}, error() {} };

function setup(runner: Runner = new RecordingRunner()) {
  const adapter = new FakeAdapter();
  const store = new MemoryStore();
  const driver = new Driver({ store, runner, adapters: new Map([[adapter.name, adapter]]), logger: silent });
  return { adapter, store, driver };
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

test("addressed message starts a conversation and posts the answer to the thread", async () => {
  const runner = new RecordingRunner();
  const { adapter, driver } = setup(runner);
  await driver.handle(msg({ addressed: true, text: "最初の質問" }));
  assert.equal(adapter.sent.length, 1);
  assert.deepEqual(adapter.sent[0], {
    channelId: "C1",
    threadId: "T1",
    text: "reply#1",
    inReplyTo: { userId: "U1", messageId: adapter.sent[0].inReplyTo?.messageId, text: "最初の質問" },
  });
  assert.equal(runner.calls[0].length, 1);
});

test("a plain reply in a known thread drives the AI again with the full history", async () => {
  const runner = new RecordingRunner();
  const { adapter, driver } = setup(runner);
  await driver.handle(msg({ addressed: true, text: "Q1" }));
  await driver.handle(msg({ addressed: false, text: "Q2 (返信)" }));
  assert.equal(adapter.sent.length, 2);
  assert.equal(adapter.sent[1].text, "reply#2");
  const history = runner.calls[1];
  assert.equal(history.length, 3); // user, assistant, user
  assert.equal(history[0].role, "user");
  assert.equal(history[1].role, "assistant");
  assert.equal(history[2].content, "Q2 (返信)");
});

test("a plain message in an unknown thread is ignored", async () => {
  const runner = new RecordingRunner();
  const { adapter, driver } = setup(runner);
  await driver.handle(msg({ addressed: false, threadId: "unknown" }));
  assert.equal(adapter.sent.length, 0);
  assert.equal(runner.calls.length, 0);
});

test("duplicate deliveries of the same message are processed once", async () => {
  const runner = new RecordingRunner();
  const { adapter, driver } = setup(runner);
  const m = msg({ addressed: true, messageId: "same" });
  await driver.handle(m);
  await driver.handle(m);
  assert.equal(adapter.sent.length, 1);
});

test("different threads are independent conversations", async () => {
  const runner = new RecordingRunner();
  const { driver } = setup(runner);
  await driver.handle(msg({ addressed: true, threadId: "A" }));
  await driver.handle(msg({ addressed: true, threadId: "B" }));
  await driver.handle(msg({ addressed: false, threadId: "A", text: "follow-up" }));
  assert.equal(runner.calls[2].length, 3);
  assert.equal(runner.calls[1].length, 1);
});

test("reset command clears the history", async () => {
  const runner = new RecordingRunner();
  const { adapter, driver, store } = setup(runner);
  await driver.handle(msg({ addressed: true }));
  await driver.handle(msg({ text: "!reset" }));
  assert.equal(await store.get("fake:C1:T1"), undefined);
  assert.match(adapter.sent[1].text, /リセット/);
  await driver.handle(msg({ addressed: false, text: "after reset" }));
  assert.equal(adapter.sent.length, 2); // 未知スレッド扱いなので無視
});

test("runner failure is reported to the thread and the failed turn is not kept", async () => {
  const failing: Runner = {
    async run() {
      throw new Error("boom");
    },
  };
  const { adapter, driver, store } = setup(failing);
  await driver.handle(msg({ addressed: true }));
  assert.equal(adapter.sent.length, 1);
  assert.match(adapter.sent[0].text, /失敗/);
  assert.equal((await store.get("fake:C1:T1"))?.history.length, 0);
});

test("concurrent replies to the same thread are serialized", async () => {
  let active = 0;
  let maxActive = 0;
  const slow: Runner = {
    async run() {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { text: "ok", assistantContent: [{ type: "text", text: "ok" }] };
    },
  };
  const { driver } = setup(slow);
  await Promise.all([
    driver.handle(msg({ addressed: true, text: "1" })),
    driver.handle(msg({ addressed: true, text: "2" })),
    driver.handle(msg({ addressed: true, text: "3" })),
  ]);
  assert.equal(maxActive, 1);
});

test("echo runner works end to end", async () => {
  const { adapter, driver } = setup(new EchoRunner());
  await driver.handle(msg({ addressed: true, text: "ping" }));
  assert.equal(adapter.sent[0].text, "(echo #1) ping");
});
