import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTitle, hasRepairVocab, includesAny, isCameraRelated, normalize } from "../src/classify.js";
import { extractModels, sameModel, shareModel } from "../src/model.js";
import { config } from "./helpers.js";

const v = config.vocab;

test("タイトル分類: ジャンク / 完動 / 不明。両方あればジャンク優先", () => {
  assert.equal(classifyTitle("Nikon F3 ジャンク", v), "junk");
  assert.equal(classifyTitle("Nikon F3 動作未確認 現状渡し", v), "junk");
  assert.equal(classifyTitle("Nikon F3 完動品 美品", v), "working");
  assert.equal(classifyTitle("Nikon F3 動作確認済み", v), "working");
  assert.equal(classifyTitle("Nikon F3 美品 ジャンク扱い", v), "junk");
  assert.equal(classifyTitle("Nikon F3", v), "unknown");
  assert.equal(classifyTitle("ＪＵＮＫ ＮＩＫＯＮ", v), "junk", "全角も正規化して照合");
});

test("カメラ関連・修理語彙", () => {
  assert.equal(isCameraRelated("Canon FD 50mm F1.4", v), true);
  assert.equal(isCameraRelated("ユニクロ Tシャツ L", v), false);
  assert.equal(hasRepairVocab("OM-1 モルト交換済み", v), true);
  assert.equal(hasRepairVocab("OM-1 ジャンク", v), false);
  assert.deepEqual(includesAny("カメラの素人です。詳しくないため", v.notExpert), ["詳しくない", "素人"]);
  assert.equal(normalize("ＡＥ－１ Ｐｒｏｇｒａｍ"), "ae-1 program");
});

test("型番抽出: 辞書型番は長いものから当て、まとめ売りは複数返す", () => {
  assert.deepEqual(extractModels("キヤノン AE-1 PROGRAM ジャンク", config.models), [{ maker: "canon", model: "ae-1 program" }]);
  assert.deepEqual(extractModels("Canon AE-1 AE-1 Program FDレンズなど", config.models), [
    { maker: "canon", model: "ae-1 program" },
    { maker: "canon", model: "ae-1" },
  ]);
  assert.deepEqual(extractModels("OLYMPUS OM-1 OM-2N まとめて", config.models), [
    { maker: "olympus", model: "om-2n" },
    { maker: "olympus", model: "om-1" },
  ]);
  assert.deepEqual(extractModels("ニコン F3 HP", config.models), [{ maker: "nikon", model: "f3" }]);
  assert.deepEqual(extractModels("Leica M3 ダブルストローク", config.models), [{ maker: "leica", model: "m3" }]);
});

test("型番抽出: 単語境界を守る（F3 は F30 に当たらない）、レンズの焦点距離は型番にしない", () => {
  assert.deepEqual(extractModels("Nikon F30", config.models), []);
  assert.deepEqual(extractModels("Canon FD 50mm F1.4 S.S.C.", config.models), []);
  assert.deepEqual(extractModels("ミノルタ X-700 MD 50mm f1.7", config.models), [{ maker: "minolta", model: "x-700" }]);
});

test("型番抽出: 辞書に無い型番は英字+数字のトークンで拾う", () => {
  assert.deepEqual(extractModels("Konica Autoreflex TC-X ジャンク", config.models), [{ maker: "konica", model: "tc-x" }]);
  assert.deepEqual(extractModels("Chinon CE-4 ボディ", config.models), [{ maker: null, model: "ce-4" }]);
});

test("同型番判定: メーカー不明なら型番だけで一致", () => {
  assert.equal(sameModel({ maker: "nikon", model: "f3" }, { maker: "nikon", model: "f3" }), true);
  assert.equal(sameModel({ maker: "nikon", model: "f3" }, { maker: "canon", model: "f3" }), false);
  assert.equal(sameModel({ maker: null, model: "f3" }, { maker: "nikon", model: "f3" }), true);
  assert.equal(shareModel([{ maker: "canon", model: "ae-1" }], [{ maker: "canon", model: "a-1" }, { maker: "canon", model: "ae-1" }]), true);
});
