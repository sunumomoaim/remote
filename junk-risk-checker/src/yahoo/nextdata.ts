import * as cheerio from "cheerio";

/** ヤフオクの商品ページ・出品一覧ページは Next.js で、必要な情報は `__NEXT_DATA__` の JSON に全部入っている。 */
export function readNextData(html: string): any {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").first().text();
  if (!raw) throw new Error("__NEXT_DATA__ が見つかりません（ページ構造が変わったか、別のページです）");
  return JSON.parse(raw);
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,円]/g, ""));
  return Number.isFinite(n) ? n : null;
}
