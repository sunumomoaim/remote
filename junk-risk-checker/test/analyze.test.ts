import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, AnalyzeError } from "../src/analyze.js";
import { Db } from "../src/db.js";
import { computeMetrics } from "../src/metrics.js";
import type { Item, SellerProfile } from "../src/types.js";
import { config, fakeFetcher, fixture } from "./helpers.js";

const ITEM_URL = "https://page.auctions.yahoo.co.jp/jp/auction/b1247390897";

test("URL → 商品 → 出品者（出品一覧 + 評価）→ 判定。結果は DB に保存される", async () => {
  const fetcher = fakeFetcher({ "/auction/": fixture("item_b1247390897.html"), "/seller/": fixture("seller_1item.html"), "show/rating": fixture("rating_seller_p1.html") });
  const db = new Db(":memory:");
  const r = await analyze(`共有: ${ITEM_URL}`, { fetcher, db, config, maxRatingPages: 1 });
  assert.equal(r.item.auctionId, "b1247390897");
  assert.equal(r.seller?.sellerId, "6rYAGL1xCjaUK7mBgfAoYr62xZRAK");
  assert.equal(r.seller?.totalRatings, 93);
  assert.equal(r.seller?.fetchedPages, 2, "出品一覧 1 ページ（1 件しかない）+ 評価 1 ページ");
  assert.equal(r.metrics.total, 25, "判定対象の商品自身は履歴から除く");
  assert.equal(r.metrics.sold_count, 25);
  assert.ok(r.metrics.junk_ratio! > 0.9);
  assert.ok(r.metrics.same_model_junk_count > 0, "AE-1 のジャンクまとめ売りが過去にある");
  assert.equal(r.metrics.same_model_working_count, 0);
  assert.ok(r.verdict.hits.some((h) => h.id === "claims_not_expert"));
  assert.ok(r.verdict.hits.some((h) => h.id === "all_junk_seller"));
  assert.ok(typeof r.id === "number");
  const row = db.getCheck(r.id!);
  assert.equal(row?.score, r.verdict.score);
  assert.equal(JSON.parse(row!.result_json).item.title, r.item.title);
});

test("評価が 25 件を超えるなら 2 ページ目まで取る。ページ上限を守る", async () => {
  const fetcher = fakeFetcher({
    "/auction/": fixture("item_b1247390897.html"),
    "/seller/": fixture("seller_1item.html"),
    "apg=2": fixture("rating_seller_p2.html"),
    "show/rating": fixture("rating_seller_p1.html"),
  });
  const db = new Db(":memory:");
  const r = await analyze(ITEM_URL, { fetcher, db, config, maxRatingPages: 2 });
  assert.equal(r.seller?.fetchedPages, 3);
  assert.equal(fetcher.calls.filter((u) => u.includes("show/rating")).length, 2);
  assert.ok(fetcher.calls.some((u) => u.includes("role=seller&apg=2")));
  assert.equal(r.seller?.listings.length, 46, "出品中 1 + 落札 25 + 落札 20");
});

test("同じページが 2 回返っても重複して数えない", async () => {
  const fetcher = fakeFetcher({ "/auction/": fixture("item_b1247390897.html"), "/seller/": fixture("seller_1item.html"), "show/rating": fixture("rating_seller_p1.html") });
  const db = new Db(":memory:");
  const r = await analyze(ITEM_URL, { fetcher, db, config, maxRatingPages: 2 });
  assert.equal(r.seller?.listings.length, 26);
});

test("バッグや服の落札品があっても、カメラ関連だけで見たジャンク率で「全品ジャンク系」と判定する", async () => {
  const fetcher = fakeFetcher({
    "/auction/": fixture("item_b1247390897.html"),
    "/seller/": fixture("seller_1item.html"),
    "apg=2": fixture("rating_seller_p2.html"),
    "show/rating": fixture("rating_seller_p1.html"),
  });
  const db = new Db(":memory:");
  const r = await analyze(ITEM_URL, { fetcher, db, config, maxRatingPages: 2 });
  assert.ok(r.metrics.camera_count < r.metrics.total, "2 ページ目にはカメラ以外の落札品がある");
  assert.ok(r.metrics.junk_ratio! < 0.9, "全体のジャンク率は薄まる");
  assert.ok(r.metrics.camera_junk_ratio! >= 0.9, "カメラ関連だけなら全品ジャンク");
  assert.equal(r.metrics.camera_working_ratio, 0);
  assert.ok(r.verdict.hits.some((h) => h.id === "all_junk_seller"));
  assert.ok(!r.verdict.hits.some((h) => h.id === "mixed_seller"));
});

test("出品一覧が 50 件を超えるなら b=51 で 2 ページ目を取る。上限で止まる", async () => {
  const fetcher = fakeFetcher({
    "/auction/": fixture("item_b1247390897.html"),
    "b=51": fixture("seller_316items_p2.html"),
    "/seller/": fixture("seller_316items_p1.html"),
    "show/rating": fixture("rating_seller_p1.html"),
  });
  const db = new Db(":memory:");
  const r = await analyze(ITEM_URL, { fetcher, db, config, maxListingPages: 2, maxRatingPages: 1 });
  assert.equal(r.seller?.totalListings, 316);
  assert.equal(r.seller?.listings.filter((l) => l.source === "listing").length, 100);
  assert.equal(fetcher.calls.filter((u) => u.includes("/seller/")).length, 2);
});

test("2 回目は出品者キャッシュを使い、ヤフオクへは商品ページしか取りに行かない", async () => {
  const fetcher = fakeFetcher({ "/auction/": fixture("item_b1247390897.html"), "/seller/": fixture("seller_1item.html"), "show/rating": fixture("rating_seller_p1.html") });
  const db = new Db(":memory:");
  let t = Date.parse("2026-10-08T00:00:00Z");
  const now = () => new Date(t);
  await analyze(ITEM_URL, { fetcher, db, config, maxRatingPages: 1, now });
  const before = fetcher.calls.length;
  t += 60 * 60 * 1000;
  await analyze(ITEM_URL, { fetcher, db, config, maxRatingPages: 1, now });
  assert.equal(fetcher.calls.length - before, 1);
  t += 25 * 60 * 60 * 1000;
  await analyze(ITEM_URL, { fetcher, db, config, maxRatingPages: 1, now });
  assert.ok(fetcher.calls.length - before > 2, "24 時間を過ぎたら取り直す");
});

test("出品者ページが取れなくても、商品説明だけで判定して返す", async () => {
  const fetcher = fakeFetcher({ "/auction/": fixture("item_b1247390897.html") });
  const db = new Db(":memory:");
  const r = await analyze(ITEM_URL, { fetcher, db, config });
  assert.equal(r.seller, null);
  assert.match(r.sellerError!, /unexpected fetch/);
  assert.equal(r.metrics.seller_available, 0);
  assert.ok(r.verdict.hits.some((h) => h.id === "seller_unavailable"));
  assert.ok(r.verdict.hits.some((h) => h.id === "claims_not_expert"));
});

test("ヤフオクの URL でなければ AnalyzeError", async () => {
  const db = new Db(":memory:");
  await assert.rejects(analyze("https://jp.mercari.com/item/m1", { fetcher: fakeFetcher({}), db, config }), AnalyzeError);
});

test("指標: 同型番の完動品価格の中央値と価格比", () => {
  const item: Item = {
    auctionId: "a1", url: "u", title: "Nikon F3 ジャンク", description: "", price: 5000, buyNowPrice: null, sellerId: "s", sellerName: "", images: [], categoryPath: [], endTime: null, status: "open", conditionName: "",
  };
  const seller: SellerProfile = {
    sellerId: "s", fetchedAt: "", totalListings: 4, totalRatings: 0, fetchedPages: 1,
    listings: [
      { auctionId: "a1", title: "Nikon F3 ジャンク", price: 5000, buyNowPrice: null, endTime: null, source: "listing" },
      { auctionId: "a2", title: "Nikon F3 完動品", price: 30000, buyNowPrice: null, endTime: null, source: "listing" },
      { auctionId: "a3", title: "Nikon F3 HP 動作確認済み", price: 20000, buyNowPrice: 50000, endTime: null, source: "listing" },
      { auctionId: "a4", title: "Nikon F2 完動品", price: 40000, buyNowPrice: null, endTime: null, source: "listing" },
      { auctionId: "a5", title: "Nikon F3 完動品", price: null, buyNowPrice: null, endTime: null, source: "sold" },
    ],
  };
  const { metrics, sameModelListings } = computeMetrics(item, seller, config);
  assert.equal(metrics.total, 4);
  assert.equal(metrics.same_model_working_count, 3);
  assert.equal(metrics.same_model_working_median_price, 40000, "即決があれば即決を使う。落札済みは価格不明なので除く");
  assert.equal(metrics.price_ratio, 0.125);
  assert.equal(metrics.working_ratio, 1);
  assert.equal(sameModelListings.length, 3);
});
