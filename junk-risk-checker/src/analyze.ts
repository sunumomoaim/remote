import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { CheckResult, Listing, SellerProfile } from "./types.js";
import { auctionIdFromUrl, extractAuctionUrl, sellerListUrl, sellerRatingUrl } from "./url.js";
import type { Fetcher } from "./yahoo/fetch.js";
import { parseItemPage } from "./yahoo/item.js";
import { parseRatingPage } from "./yahoo/rating.js";
import { parseSellerPage } from "./yahoo/seller.js";
import { computeMetrics } from "./metrics.js";
import { evaluateRules } from "./rules.js";

export interface AnalyzeDeps {
  fetcher: Fetcher;
  db: Db;
  config: AppConfig;
  /** 出品者 1 人あたりの出品一覧ページ数の上限（1 ページ 50 件） */
  maxListingPages?: number;
  /** 出品者 1 人あたりの評価ページ数の上限（1 ページ 25 件） */
  maxRatingPages?: number;
  /** 出品者キャッシュの有効期間 */
  sellerCacheMs?: number;
  now?: () => Date;
}

export class AnalyzeError extends Error {}

/** 共有された URL → 判定結果。結果は DB に保存し、id を付けて返す。 */
export async function analyze(input: string, deps: AnalyzeDeps): Promise<CheckResult> {
  const url = extractAuctionUrl(input);
  if (!url || !auctionIdFromUrl(url)) throw new AnalyzeError("ヤフオクの商品 URL が見つかりません");
  const now = deps.now ?? (() => new Date());

  const item = parseItemPage(await deps.fetcher(url), url);

  let seller: SellerProfile | null = null;
  let sellerError: string | null = null;
  if (item.sellerId) {
    try {
      seller = await loadSeller(item.sellerId, deps, now);
    } catch (e) {
      sellerError = e instanceof Error ? e.message : String(e);
    }
  } else {
    sellerError = "出品者 ID を取得できませんでした";
  }

  const { metrics, itemModels, sameModelListings } = computeMetrics(item, seller, deps.config);
  const verdict = evaluateRules(deps.config.rules, { metrics, description: item.description, title: item.title });

  const result: CheckResult = {
    checkedAt: now().toISOString(),
    item,
    itemModels,
    seller,
    sellerError,
    metrics,
    verdict: { score: verdict.score, rank: verdict.rank, hits: verdict.hits },
    sameModelListings,
  };
  result.id = deps.db.insertCheck(result);
  return result;
}

/** キャッシュがあればそれを、無ければ出品一覧と評価ページを上限内で取得して保存する。 */
export async function loadSeller(sellerId: string, deps: AnalyzeDeps, now: () => Date): Promise<SellerProfile> {
  const cacheMs = deps.sellerCacheMs ?? 24 * 60 * 60 * 1000;
  const cached = deps.db.getSeller(sellerId, cacheMs, now().getTime());
  if (cached) return cached;

  const maxListing = deps.maxListingPages ?? 2;
  const maxRating = deps.maxRatingPages ?? 2;
  const listings: Listing[] = [];
  let fetchedPages = 0;

  // 出品中
  let totalListings = 0;
  for (let page = 0; page < maxListing; page++) {
    const html = await deps.fetcher(sellerListUrl(sellerId, page * 50, 50));
    fetchedPages++;
    const parsed = parseSellerPage(html);
    totalListings = parsed.total;
    listings.push(...parsed.items);
    if (parsed.items.length < 50 || listings.length >= parsed.total) break;
  }

  // 落札済み（出品者としての評価）
  let totalRatings = 0;
  for (let page = 1; page <= maxRating; page++) {
    const html = await deps.fetcher(sellerRatingUrl(sellerId, page));
    fetchedPages++;
    const parsed = parseRatingPage(html);
    totalRatings = parsed.total;
    listings.push(...parsed.items);
    if (parsed.entries < 25 || page * 25 >= parsed.total) break;
  }

  const profile: SellerProfile = {
    sellerId,
    fetchedAt: now().toISOString(),
    listings: dedupeListings(listings),
    totalListings,
    totalRatings,
    fetchedPages,
  };
  deps.db.putSeller(profile);
  return profile;
}

function dedupeListings(xs: Listing[]): Listing[] {
  const seen = new Set<string>();
  return xs.filter((l) => {
    if (!l.auctionId || seen.has(l.auctionId)) return false;
    seen.add(l.auctionId);
    return true;
  });
}
