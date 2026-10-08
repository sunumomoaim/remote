import * as cheerio from "cheerio";
import type { Listing } from "../types.js";

export interface RatingPage {
  /** 出品者として受けた評価の合計（ページ上部の「合計：」） */
  total: number;
  /** 評価に紐づく落札品。出品者側の評価のみ（role=seller で取得する前提だが、念のため本文でも判定） */
  items: Listing[];
  /** ページ内の評価エントリ数（落札者側も含む） */
  entries: number;
}

/**
 * 評価ページ HTML → 過去に落札された商品の一覧。
 * 旧式のテーブル構造で、各評価は
 *   <tr>評価：非常に良い 出品者です。 / 評価者：...</tr>
 *   <tr><a href=".../auction/ID">商品タイトル</a></tr>
 *   <tr>コメント</tr>
 * の並び。商品リンクの行から 1 つ前の行を見て、出品者側の評価かを判定する。
 */
export function parseRatingPage(html: string): RatingPage {
  const $ = cheerio.load(html);
  const items: Listing[] = [];
  let entries = 0;
  const seen = new Set<string>();

  $('a[href*="/jp/auction/"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = /\/auction\/([a-z]?\d+)/i.exec(href);
    if (!m) return;
    const row = $(a).closest("tr");
    const info = row.prev("tr").text().replace(/\s+/g, " ");
    if (!/評価：/.test(info)) return; // 商品リンクでも評価エントリでないもの（おすすめ等）は除外
    entries++;
    if (!/出品者です/.test(info)) return; // 落札者としての評価は対象外
    const id = m[1];
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      auctionId: id,
      title: $(a).text().trim(),
      price: null,
      buyNowPrice: null,
      endTime: null,
      source: "sold",
    });
  });

  const totalText = $("body").text();
  const tm = /合計：\s*(\d[\d,]*)/.exec(totalText);
  const total = tm ? Number(tm[1].replace(/,/g, "")) : items.length;
  return { total, items, entries };
}
