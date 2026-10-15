import type { AppConfig } from "./config.js";
import type { Item, Kind, Listing, MarketStats, Metrics, ModelRef, SellerProfile } from "./types.js";
import { classifyTitle, hasRepairVocab, isCameraRelated } from "./classify.js";
import { extractModels, shareModel } from "./model.js";

export interface MetricsResult {
  metrics: Metrics;
  itemModels: ModelRef[];
  sameModelListings: Array<Listing & { kind: Kind }>;
  priceRatioSource: "seller" | "market" | null;
}

/** まとめ売り・複数台の出品。1 台の相場と比べても意味が無いので価格ルールから外す */
export const BUNDLE_TITLE = /まとめ|セット|[2-9２-９]\s*台|\d+\s*本|大量/;

/** 出品者履歴・落札相場・商品から、ルール判定に使う指標を計算する。 */
export function computeMetrics(item: Item, seller: SellerProfile | null, config: AppConfig, market: MarketStats | null = null): MetricsResult {
  const { vocab, models } = config;
  const itemModels = extractModels(item.title, models);
  const itemPrice = item.buyNowPrice ?? item.price;
  const is_bundle = BUNDLE_TITLE.test(item.title) ? 1 : 0;
  const marketWorking = market?.workingMedianPrice ?? null;
  const marketJunk = market?.junkMedianPrice ?? null;
  const marketRatio = (base: number | null) => (base !== null && base > 0 && itemPrice !== null ? round(itemPrice / base, 3) : null);
  const marketMetrics = {
    market_sample_size: market?.sampleSize ?? 0,
    market_working_median_price: marketWorking,
    market_junk_median_price: marketJunk,
    market_junk_price_ratio: marketRatio(marketJunk),
  };

  if (!seller) {
    const price_ratio = marketRatio(marketWorking);
    return {
      itemModels,
      sameModelListings: [],
      priceRatioSource: price_ratio === null ? null : "market",
      metrics: {
        seller_available: 0,
        total: 0,
        listing_count: 0,
        sold_count: 0,
        junk_count: 0,
        working_count: 0,
        junk_ratio: null,
        working_ratio: null,
        camera_ratio: null,
        camera_count: 0,
        camera_junk_ratio: null,
        camera_working_ratio: null,
        repair_vocab_ratio: null,
        same_model_working_count: 0,
        same_model_junk_count: 0,
        same_model_working_median_price: null,
        is_bundle,
        price_ratio,
        ...marketMetrics,
      },
    };
  }

  // 判定対象の商品自身は履歴から除く
  const others = seller.listings.filter((l) => l.auctionId !== item.auctionId);
  const classified = others.map((l) => ({ ...l, kind: classifyTitle(l.title, vocab) }));
  const total = classified.length;
  const junk = classified.filter((l) => l.kind === "junk").length;
  const working = classified.filter((l) => l.kind === "working").length;
  const cameraItems = classified.filter((l) => isCameraRelated(l.title, vocab));
  const camera = cameraItems.length;
  const cameraJunk = cameraItems.filter((l) => l.kind === "junk").length;
  const cameraWorking = cameraItems.filter((l) => l.kind === "working").length;
  const repair = classified.filter((l) => hasRepairVocab(l.title, vocab)).length;

  const sameModel = itemModels.length === 0 ? [] : classified.filter((l) => shareModel(itemModels, extractModels(l.title, models)));
  const sameWorking = sameModel.filter((l) => l.kind === "working");
  const sameJunk = sameModel.filter((l) => l.kind === "junk");
  const prices = sameWorking.map((l) => l.buyNowPrice ?? l.price).filter((p): p is number => p !== null && p > 0);
  const medianPrice = median(prices);
  const sellerRatio = medianPrice !== null && itemPrice !== null && medianPrice > 0 ? round(itemPrice / medianPrice, 3) : null;
  // 出品者自身に同型番の完動品があればそれが一番近い基準。無ければ落札相場で代用する
  const priceRatio = sellerRatio ?? marketRatio(marketWorking);
  const priceRatioSource: MetricsResult["priceRatioSource"] = sellerRatio !== null ? "seller" : priceRatio !== null ? "market" : null;

  const ratio = (n: number) => (total > 0 ? round(n / total, 3) : null);
  const cameraRatio = (n: number) => (camera > 0 ? round(n / camera, 3) : null);
  return {
    itemModels,
    sameModelListings: sameModel,
    priceRatioSource,
    metrics: {
      seller_available: 1,
      total,
      listing_count: classified.filter((l) => l.source === "listing").length,
      sold_count: classified.filter((l) => l.source === "sold").length,
      junk_count: junk,
      working_count: working,
      junk_ratio: ratio(junk),
      working_ratio: ratio(working),
      camera_ratio: ratio(camera),
      camera_count: camera,
      camera_junk_ratio: cameraRatio(cameraJunk),
      camera_working_ratio: cameraRatio(cameraWorking),
      repair_vocab_ratio: ratio(repair),
      same_model_working_count: sameWorking.length,
      same_model_junk_count: sameJunk.length,
      same_model_working_median_price: medianPrice,
      is_bundle,
      price_ratio: priceRatio,
      ...marketMetrics,
    },
  };
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
