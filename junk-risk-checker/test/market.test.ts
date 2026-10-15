import { test } from "node:test";
import assert from "node:assert/strict";
import { marketQuery, summarizeMarket } from "../src/market.js";
import type { Listing } from "../src/types.js";
import { config } from "./helpers.js";

const l = (id: string, title: string, price: number | null): Listing => ({ auctionId: id, title, price, buyNowPrice: null, endTime: null, source: "sold" });

test("検索語はメーカー + 型番。メーカー不明なら型番だけ", () => {
  assert.equal(marketQuery({ maker: "nikon", model: "f3" }), "nikon f3");
  assert.equal(marketQuery({ maker: null, model: "ce-4" }), "ce-4");
});

test("相場集計: まとめ売り・複数台・価格なしを除き、完動品とジャンクの中央値を出す", () => {
  const items = [
    l("1", "Nikon F3 完動品", 30000),
    l("2", "Nikon F3 美品 動作確認済", 40000),
    l("3", "Nikon F3 ジャンク", 5000),
    l("4", "Nikon F3 動作未確認", 7000),
    l("5", "Nikon F3 現状品", 6000),
    l("6", "Nikon F3 F2 FM2 3台まとめ 完動", 90000),
    l("7", "Nikon F3 ボディ レンズ セット 完動品", 80000),
    l("8", "Nikon F3", 15000),
    l("9", "Nikon F3 完動品", null),
  ];
  const s = summarizeMarket("nikon f3", items, 123, config, "2026-10-15T00:00:00Z");
  assert.equal(s.total, 123);
  assert.equal(s.sampleSize, 6);
  assert.equal(s.workingCount, 2);
  assert.equal(s.workingMedianPrice, 35000);
  assert.equal(s.junkCount, 3);
  assert.equal(s.junkMedianPrice, 6000);
});

test("該当なしなら中央値は null", () => {
  const s = summarizeMarket("x", [], 0, config, "t");
  assert.equal(s.workingMedianPrice, null);
  assert.equal(s.junkMedianPrice, null);
});
