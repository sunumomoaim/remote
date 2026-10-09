import type { Item } from "../types.js";
import { readNextData, toNumber } from "./nextdata.js";

/** 商品ページ HTML → Item。`initialState.item.detail.item` を読む。 */
export function parseItemPage(html: string, url: string): Item {
  const data = readNextData(html);
  const it = data?.props?.pageProps?.initialState?.item?.detail?.item;
  if (!it || !it.auctionId) throw new Error("商品情報が見つかりません（終了・削除された商品か、ページ構造が変わった可能性）");

  // description（配列）は冒頭だけのプレビューで末尾が "..." になるので、全文を持つ descriptionHtml を優先する
  const descLines: string[] = Array.isArray(it.description) ? it.description.map((l: unknown) => String(l ?? "")) : [];
  const fromHtml = stripHtml(String(it.descriptionHtml ?? ""));
  const description = fromHtml.trim().length > 0 ? fromHtml : descLines.join("\n");

  return {
    auctionId: String(it.auctionId),
    url: String(it.auctionItemUrl ?? url),
    title: String(it.title ?? "").trim(),
    description: description.trim(),
    price: toNumber(it.price),
    buyNowPrice: toNumber(it.bidorbuy ?? it.buyNowPrice ?? it.taxinBidorbuy),
    sellerId: String(it.seller?.aucUserId ?? ""),
    sellerName: String(it.seller?.displayName ?? ""),
    images: Array.isArray(it.img) ? it.img.map((i: any) => String(i?.image ?? "")).filter(Boolean) : [],
    categoryPath: Array.isArray(it.category?.path) ? it.category.path.map((p: any) => String(p?.name ?? "")).filter(Boolean) : [],
    endTime: it.endTime ? String(it.endTime) : null,
    status: String(it.status ?? ""),
    conditionName: String(it.conditionName ?? ""),
  };
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
