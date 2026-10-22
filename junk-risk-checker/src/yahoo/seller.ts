import type { Listing } from "../types.js";
import { readNextData, toNumber } from "./nextdata.js";

export interface SellerPage {
  total: number;
  items: Listing[];
}

/** 出品者の出品一覧ページ HTML → 出品中の一覧。`initialState.search.items.listing` を読む。 */
export function parseSellerPage(html: string): SellerPage {
  return parseListingPage(html, "listing");
}

/** 落札相場（closedsearch）ページも同じ構造なので共用する。 */
export function parseClosedSearchPage(html: string): SellerPage {
  return parseListingPage(html, "sold");
}

function parseListingPage(html: string, source: Listing["source"]): SellerPage {
  const data = readNextData(html);
  const listing = data?.props?.pageProps?.initialState?.search?.items?.listing;
  if (!listing) throw new Error("出品一覧が見つかりません（ページ構造が変わった可能性）");
  const items: Listing[] = (Array.isArray(listing.items) ? listing.items : []).map((x: any) => ({
    auctionId: String(x.auctionId ?? ""),
    title: String(x.title ?? "").trim(),
    price: toNumber(x.price),
    buyNowPrice: toNumber(x.buyNowPrice),
    endTime: x.endTime ? String(x.endTime) : null,
    source,
  }));
  return { total: toNumber(listing.totalResultsAvailable) ?? items.length, items };
}
