import { test } from "node:test";
import assert from "node:assert/strict";
import { createJunkCheckInterceptor, findAuctionUrl, formatVerdict } from "../src/integrations/junk-check.js";
import { Driver } from "../src/core/driver.js";
import { MemoryStore } from "../src/core/store.js";
import type { ChatAdapter, HistoryMessage, InboundMessage, OutboundMessage, Runner } from "../src/core/types.js";

const sample = {
  id: 7,
  item: { title: "Canon AE-1 ジャンク", url: "https://auctions.yahoo.co.jp/jp/auction/b1", price: 3000, buyNowPrice: null, sellerName: "店", sellerId: "s" },
  verdict: { score: 60, rank: "mid" as const, hits: [{ score: 20, reason: "カメラ専門の出品者です" }, { score: -30, reason: "全品ジャンク" }] },
  metrics: {
    total: 40, camera_count: 30, camera_junk_ratio: 1, camera_working_ratio: 0, same_model_working_count: 0, same_model_junk_count: 5,
    price_ratio: 0.12, market_working_median_price: 25000, market_junk_median_price: 4000,
  },
  sellerError: null,
};

test("Slack の <url|label> 形式や前後の文字からヤフオク URL を取り出す", () => {
  assert.equal(findAuctionUrl("<https://page.auctions.yahoo.co.jp/jp/auction/b1247390897|Canon AE-1>"), "https://auctions.yahoo.co.jp/jp/auction/b1247390897");
  assert.equal(findAuctionUrl("これどう？ https://auctions.yahoo.co.jp/jp/auction/1246909144"), "https://auctions.yahoo.co.jp/jp/auction/1246909144");
  assert.equal(findAuctionUrl("https://jp.mercari.com/item/m1"), null);
  assert.equal(findAuctionUrl("こんにちは"), null);
});

test("判定結果を Slack 向けの文面にする", () => {
  const text = formatVerdict(sample, "http://localhost:3100/");
  assert.match(text, /🟡 中 危険度 60/);
  assert.match(text, /Canon AE-1 ジャンク/);
  assert.match(text, /• \+20 カメラ専門の出品者です/);
  assert.match(text, /• -30 全品ジャンク/);
  assert.match(text, /ジャンク率 100% \/ 完動品率 0%/);
  assert.match(text, /価格比（対 完動品）: 12%/);
  assert.match(text, /落札相場: 完動 25000 円 \/ ジャンク 4000 円/);
  assert.match(text, /http:\/\/localhost:3100\/checks\/7$/);
});

function fakeFetch(handler: (url: string) => { status: number; body: unknown }): typeof fetch {
  return (async (input: string | URL | Request) => {
    const r = handler(String(input));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const msg = (text: string, over: Partial<InboundMessage> = {}): InboundMessage => ({
  platform: "fake", channelId: "C1", threadId: "T1", messageId: `id-${Math.random()}`, userId: "U1", text, addressed: false, inThread: false, ...over,
});

test("URL を含まない発言は横取りしない。含めばチェッカーを呼んで文面を返す", async () => {
  const calls: string[] = [];
  const intercept = createJunkCheckInterceptor({ baseUrl: "http://localhost:3100", fetch: fakeFetch((u) => (calls.push(u), { status: 200, body: sample })) });
  assert.equal(await intercept(msg("hello"), "hello"), undefined);
  const out = await intercept(msg("x"), "見て https://page.auctions.yahoo.co.jp/jp/auction/b1247390897");
  assert.match(out!, /危険度 60/);
  assert.equal(calls[0], "http://localhost:3100/check?url=https%3A%2F%2Fauctions.yahoo.co.jp%2Fjp%2Fauction%2Fb1247390897&format=json");
});

test("チェッカーがエラーや停止中でも、AI に回さず短い案内を返す", async () => {
  const errorIntercept = createJunkCheckInterceptor({ baseUrl: "http://localhost:3100", fetch: fakeFetch(() => ({ status: 400, body: { error: "ヤフオクの商品 URL が見つかりません" } })) });
  assert.match((await errorIntercept(msg("x"), "https://auctions.yahoo.co.jp/jp/auction/b1247390897"))!, /判定できませんでした: ヤフオクの商品 URL が見つかりません/);
  const down = createJunkCheckInterceptor({ baseUrl: "http://localhost:3100", fetch: (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch });
  assert.match((await down(msg("x"), "https://auctions.yahoo.co.jp/jp/auction/b1247390897"))!, /接続できませんでした.*ECONNREFUSED/);
});

class FakeAdapter implements ChatAdapter {
  readonly name = "fake";
  sent: OutboundMessage[] = [];
  async start() {}
  async stop() {}
  async send(m: OutboundMessage) { this.sent.push(m); return { messageId: `m${this.sent.length}` }; }
}
class CountingRunner implements Runner {
  calls = 0;
  async run(_h: HistoryMessage[]) { this.calls++; return { text: "ai", assistantContent: [{ type: "text" as const, text: "ai" }] }; }
}

test("Driver: 横取りが文字列を返したらそれを投稿し AI は呼ばない。メンション無しでも動く。返さなければ通常処理", async () => {
  const adapter = new FakeAdapter();
  const runner = new CountingRunner();
  const intercept = createJunkCheckInterceptor({ baseUrl: "http://x", fetch: fakeFetch(() => ({ status: 200, body: sample })) });
  const driver = new Driver({ store: new MemoryStore(), runner, adapters: new Map([[adapter.name, adapter]]), interceptors: [intercept], logger: { info() {}, warn() {}, error() {} } });

  await driver.handle(msg("https://auctions.yahoo.co.jp/jp/auction/b1247390897", { addressed: false }));
  assert.equal(adapter.sent.length, 1);
  assert.match(adapter.sent[0].text, /危険度 60/);
  assert.equal(adapter.sent[0].threadId, "T1");
  assert.equal(runner.calls, 0);

  await driver.handle(msg("普通の質問", { addressed: true }));
  assert.equal(runner.calls, 1);
  assert.equal(adapter.sent[1].text, "ai");
});
