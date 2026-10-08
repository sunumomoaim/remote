import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { Db } from "../src/db.js";
import { config, fakeFetcher, fixture } from "./helpers.js";

const ITEM_URL = "https://page.auctions.yahoo.co.jp/jp/auction/b1247390897";

function setup() {
  const fetcher = fakeFetcher({ "/auction/": fixture("item_b1247390897.html"), "/seller/": fixture("seller_1item.html"), "show/rating": fixture("rating_seller_p1.html") });
  const db = new Db(":memory:");
  return { app: createApp({ fetcher, db, config, maxRatingPages: 1 }), db, fetcher };
}

test("GET /check は判定して結果ページへリダイレクトし、結果ページに危険度と理由が出る", async () => {
  const { app } = setup();
  const res = await app.request(`/check?url=${encodeURIComponent(ITEM_URL)}`);
  assert.equal(res.status, 302);
  const loc = res.headers.get("location")!;
  assert.match(loc, /^\/checks\/\d+$/);
  const page = await (await app.request(loc)).text();
  assert.match(page, /危険度 \d+/);
  assert.match(page, /詳しくない/);
  assert.match(page, /買った/);
});

test("GET /check?format=json&debug=1 は JSON と各ルールの判定を返す", async () => {
  const { app } = setup();
  const res = await app.request(`/check?url=${encodeURIComponent(ITEM_URL)}&format=json&debug=1`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.item.auctionId, "b1247390897");
  assert.ok(Array.isArray(body.debug));
  assert.ok(body.debug.some((d: any) => d.id === "claims_not_expert" && d.hit === true));
});

test("GET /share は共有テキストから URL を抜いて /check へ送る", async () => {
  const { app } = setup();
  const res = await app.request(`/share?text=${encodeURIComponent("見て " + ITEM_URL + " #ヤフオク")}&title=Canon`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/check?url=${encodeURIComponent("https://auctions.yahoo.co.jp/jp/auction/b1247390897")}`);
  const bad = await app.request(`/share?text=hello`);
  assert.equal(bad.status, 400);
});

test("不正な URL は 400、取得失敗は 502", async () => {
  const { app } = setup();
  assert.equal((await app.request(`/check?url=mercari&format=json`)).status, 400);
  const broken = createApp({ fetcher: fakeFetcher({}), db: new Db(":memory:"), config });
  assert.equal((await broken.request(`/check?url=${encodeURIComponent(ITEM_URL)}&format=json`)).status, 502);
});

test("POST /checks/:id/outcome で「買った」と結果を記録し、履歴に出る", async () => {
  const { app, db } = setup();
  const loc = (await app.request(`/check?url=${encodeURIComponent(ITEM_URL)}`)).headers.get("location")!;
  const id = Number(loc.split("/").pop());
  const post = (body: Record<string, string>) =>
    app.request(`/checks/${id}/outcome`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  assert.equal((await post({ action: "bought" })).status, 302);
  assert.equal(db.getCheck(id)?.action, "bought");
  assert.equal((await post({ action: "bought", outcome: "minor" })).status, 302);
  assert.equal(db.getCheck(id)?.outcome, "minor");
  assert.equal((await post({ action: "skipped" })).status, 302);
  assert.equal(db.getCheck(id)?.outcome, null, "見送りに変えたら結果は消える");
  assert.equal((await post({ action: "nope" })).status, 400);
  assert.equal((await post({ action: "bought" })).status, 302);
  const history = await (await app.request("/history")).text();
  assert.match(history, /買った/);
  assert.equal((await app.request("/checks/9999")).status, 404);
});
