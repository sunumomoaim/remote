import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, evaluateRules, rankOf } from "../src/rules.js";
import type { Metrics } from "../src/types.js";
import { config } from "./helpers.js";

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    seller_available: 1,
    total: 40,
    listing_count: 20,
    sold_count: 20,
    junk_count: 10,
    working_count: 10,
    junk_ratio: 0.25,
    working_ratio: 0.25,
    camera_ratio: 0.5,
    camera_count: 20,
    camera_junk_ratio: 0.5,
    camera_working_ratio: 0.5,
    repair_vocab_ratio: 0,
    same_model_working_count: 0,
    same_model_junk_count: 0,
    same_model_working_median_price: null,
    price_ratio: null,
    ...over,
  };
}

const rules = config.rules;
const run = (m: Partial<Metrics>, description = "", title = "") => evaluateRules(rules, { metrics: metrics(m), description, title });

test("条件: 指標が null の条件は false、文字列条件は正規化して照合", () => {
  assert.equal(evaluateCondition({ metric: "price_ratio", op: "<", value: 0.15 }, { metrics: metrics(), description: "", title: "" }), false);
  assert.equal(evaluateCondition({ metric: "junk_ratio", op: ">=", value: 0.2 }, { metrics: metrics(), description: "", title: "" }), true);
  assert.equal(evaluateCondition({ text: "description", includes_any: ["詳しくない"] }, { metrics: metrics(), description: "カメラに詳しくないです", title: "" }), true);
  assert.equal(evaluateCondition({ not: { metric: "total", op: ">=", value: 100 } }, { metrics: metrics(), description: "", title: "" }), true);
});

test("同型番の完動品がある出品者は危険度が上がる", () => {
  const base = run({});
  const withSame = run({ same_model_working_count: 2 });
  assert.ok(withSame.score > base.score);
  assert.ok(withSame.hits.some((h) => h.id === "same_model_working_exists"));
  assert.match(withSame.hits.find((h) => h.id === "same_model_working_exists")!.reason, /2 件/);
});

test("同型番の完動品があっても、価格が相場に対して非常に安ければ危険度は下がる（正直に検品して安く出す業者の扱い）", () => {
  const honestCheap = run({ same_model_working_count: 2, price_ratio: 0.1 });
  const sameNoPrice = run({ same_model_working_count: 2, price_ratio: null });
  const sameHigh = run({ same_model_working_count: 2, price_ratio: 0.5 });
  assert.ok(honestCheap.score < sameNoPrice.score);
  assert.ok(sameHigh.score > sameNoPrice.score);
  assert.ok(honestCheap.hits.some((h) => h.id === "price_very_low"));
  assert.ok(sameHigh.hits.some((h) => h.id === "price_high_for_junk"));
});

test("カメラ関連が全品ジャンク系の出品者は危険度が下がる。バッグや服の「良品」で薄まっても変わらない", () => {
  const r = run({ camera_junk_ratio: 0.96, camera_working_ratio: 0, camera_count: 30, junk_ratio: 0.6, working_ratio: 0.3, total: 50 });
  assert.ok(r.hits.some((h) => h.id === "all_junk_seller"));
  assert.ok(!r.hits.some((h) => h.id === "mixed_seller"));
  assert.ok(r.score < rules.base);
});

test("カメラを完動品とジャンクで使い分ける出品者は危険度が上がる", () => {
  const r = run({ camera_junk_ratio: 0.4, camera_working_ratio: 0.5, camera_count: 30 });
  assert.ok(r.hits.some((h) => h.id === "mixed_seller"));
});

test("「詳しくない」と書くカメラ専門出品者は、記載だけの場合より高くなる", () => {
  const plain = run({ camera_ratio: 0.3 }, "カメラは詳しくないです");
  const specialist = run({ camera_ratio: 0.95 }, "カメラは詳しくないです");
  assert.ok(specialist.score > plain.score);
  assert.ok(specialist.hits.some((h) => h.id === "not_expert_but_specialist"));
});

test("出品者情報が取れないときは理由に明示され、指標ベースのルールは当たらない", () => {
  const r = run({ seller_available: 0, total: 0, junk_ratio: null, working_ratio: null, camera_ratio: null, camera_count: 0, camera_junk_ratio: null, camera_working_ratio: null, repair_vocab_ratio: null }, "詳しくないです");
  assert.ok(r.hits.some((h) => h.id === "seller_unavailable"));
  assert.ok(r.hits.some((h) => h.id === "claims_not_expert"));
  assert.ok(!r.hits.some((h) => h.id === "camera_specialist"));
});

test("危険度は 0〜100 に収まり、ランクは閾値に従う", () => {
  const high = run({ same_model_working_count: 3, repair_vocab_ratio: 0.5, price_ratio: 0.6 }, "詳しくないです。シャッター切れました。モルト");
  assert.equal(high.score, 100);
  assert.equal(high.rank, "high");
  assert.equal(rankOf(0, rules), "low");
  assert.equal(rankOf(30, rules), "low");
  assert.equal(rankOf(31, rules), "mid");
  assert.equal(rankOf(61, rules), "high");
});
