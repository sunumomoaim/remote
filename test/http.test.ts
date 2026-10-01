import { test } from "node:test";
import assert from "node:assert/strict";
import { Driver } from "../src/core/driver.js";
import { MemoryStore } from "../src/core/store.js";
import { EchoRunner } from "../src/runners/echo.js";
import { HttpAdapter } from "../src/adapters/http.js";

const silent = { info() {}, warn() {}, error() {} };

test("http adapter: first POST starts a thread, second POST with threadId continues it", async () => {
  const adapter = new HttpAdapter({ port: 0, logger: silent });
  const driver = new Driver({
    store: new MemoryStore(),
    runner: new EchoRunner(),
    adapters: new Map([[adapter.name, adapter]]),
    logger: silent,
  });
  await adapter.start(driver.handle);
  const { port } = adapter.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const r1 = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "こんにちは" }),
    });
    const j1 = (await r1.json()) as { threadId: string; reply: string };
    assert.equal(r1.status, 200);
    assert.equal(j1.reply, "(echo #1) こんにちは");

    const r2 = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "続き", threadId: j1.threadId }),
    });
    const j2 = (await r2.json()) as { threadId: string; reply: string };
    assert.equal(j2.threadId, j1.threadId);
    assert.equal(j2.reply, "(echo #2) 続き");

    const r3 = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "知らないスレッド", threadId: "nope" }),
    });
    assert.equal(r3.status, 202);
  } finally {
    await adapter.stop();
  }
});
