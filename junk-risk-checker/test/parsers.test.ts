import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItemPage } from "../src/yahoo/item.js";
import { parseSellerPage } from "../src/yahoo/seller.js";
import { parseRatingPage } from "../src/yahoo/rating.js";
import { fixture } from "./helpers.js";

test("商品ページ: __NEXT_DATA__ からタイトル・説明・出品者 ID・価格・カテゴリを取る", () => {
  const item = parseItemPage(fixture("item_b1247390897.html"), "https://auctions.yahoo.co.jp/jp/auction/b1247390897");
  assert.equal(item.auctionId, "b1247390897");
  assert.match(item.title, /^Canon AE-1 AE-1 Program/);
  assert.equal(item.sellerId, "6rYAGL1xCjaUK7mBgfAoYr62xZRAK");
  assert.equal(item.sellerName, "2hour");
  assert.equal(item.price, 14033);
  assert.equal(item.buyNowPrice, null);
  assert.match(item.description, /カメラの素人です/);
  assert.match(item.description, /空シャッターがきれるかどうかのみ確認/);
  assert.deepEqual(item.categoryPath.slice(0, 3), ["オークション", "家電、AV、カメラ", "カメラ、光学機器"]);
  assert.equal(item.images.length, 10);
  assert.equal(item.status, "open");
  assert.equal(item.endTime, "2026-10-11T21:08:29+09:00");
});

test("商品ページ: JSON が無ければ分かりやすいエラー", () => {
  assert.throws(() => parseItemPage("<html><body>nothing</body></html>", "x"), /__NEXT_DATA__/);
});

test("出品一覧ページ: 1 件のみの出品者", () => {
  const page = parseSellerPage(fixture("seller_1item.html"));
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].auctionId, "b1247390897");
  assert.equal(page.items[0].price, 14033);
  assert.equal(page.items[0].source, "listing");
});

test("出品一覧ページ: 50 件/ページ、2 ページ目は別の商品", () => {
  const p1 = parseSellerPage(fixture("seller_316items_p1.html"));
  const p2 = parseSellerPage(fixture("seller_316items_p2.html"));
  assert.equal(p1.total, 316);
  assert.equal(p1.items.length, 50);
  assert.equal(p2.items.length, 50);
  const ids1 = new Set(p1.items.map((i) => i.auctionId));
  assert.ok(p2.items.every((i) => !ids1.has(i.auctionId)), "2 ページ目に 1 ページ目と同じ商品が無い");
  assert.ok(p1.items.every((i) => i.title.length > 0));
});

test("評価ページ: 出品者としての評価 25 件から落札品タイトルを取り、合計件数も読む", () => {
  const page = parseRatingPage(fixture("rating_seller_p1.html"));
  assert.equal(page.entries, 25);
  assert.equal(page.items.length, 25);
  assert.equal(page.total, 93);
  assert.equal(page.items[0].auctionId, "g1245161630");
  assert.match(page.items[0].title, /OLYMPUS OM2/);
  assert.ok(page.items.every((i) => i.source === "sold" && i.price === null));
  // 文字なし ID（旧形式）も拾う
  assert.ok(page.items.some((i) => /^\d+$/.test(i.auctionId)));
});

test("評価ページ: 落札者としての評価は対象外", () => {
  const html = `<table>
    <tr><td>評価： <b>非常に良い 落札者です。</b></td></tr>
    <tr><td><a href="https://auctions.yahoo.co.jp/jp/auction/x111111111">買った物</a></td></tr>
    <tr><td>評価： <b>良い 出品者です。</b></td></tr>
    <tr><td><a href="https://auctions.yahoo.co.jp/jp/auction/y222222222">売った物</a></td></tr>
  </table>合計：<b>2</b>`;
  const page = parseRatingPage(html);
  assert.equal(page.entries, 2);
  assert.deepEqual(page.items.map((i) => i.auctionId), ["y222222222"]);
  assert.equal(page.total, 2);
});
