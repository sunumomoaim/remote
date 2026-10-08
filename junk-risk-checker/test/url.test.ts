import { test } from "node:test";
import assert from "node:assert/strict";
import { auctionIdFromUrl, extractAuctionUrl, sellerListUrl, sellerRatingUrl } from "../src/url.js";

test("PC 版・アプリ共有・前後に文字が混ざった URL から商品 URL を取り出す", () => {
  const want = "https://auctions.yahoo.co.jp/jp/auction/b1247390897";
  assert.equal(extractAuctionUrl("https://page.auctions.yahoo.co.jp/jp/auction/b1247390897"), want);
  assert.equal(extractAuctionUrl("https://auctions.yahoo.co.jp/jp/auction/b1247390897?x=1"), want);
  assert.equal(extractAuctionUrl("Canon AE-1 ジャンク https://page.auctions.yahoo.co.jp/jp/auction/b1247390897 #ヤフオク"), want);
  assert.equal(extractAuctionUrl("https://auctions.yahoo.co.jp/jp/auction/1246909144"), "https://auctions.yahoo.co.jp/jp/auction/1246909144");
});

test("ヤフオク以外や空文字は null", () => {
  assert.equal(extractAuctionUrl(""), null);
  assert.equal(extractAuctionUrl(null), null);
  assert.equal(extractAuctionUrl("https://jp.mercari.com/item/m12345678901"), null);
});

test("ID と出品者ページ URL", () => {
  assert.equal(auctionIdFromUrl("https://auctions.yahoo.co.jp/jp/auction/b1247390897"), "b1247390897");
  assert.equal(sellerListUrl("abc", 50), "https://auctions.yahoo.co.jp/seller/abc?b=51&n=50");
  assert.equal(sellerRatingUrl("abc"), "https://auctions.yahoo.co.jp/jp/show/rating?auc_user_id=abc&role=seller");
  assert.equal(sellerRatingUrl("abc", 2), "https://auctions.yahoo.co.jp/jp/show/rating?auc_user_id=abc&role=seller&apg=2");
});
