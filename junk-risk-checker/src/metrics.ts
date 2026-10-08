import type { AppConfig } from "./config.js";
import type { Item, Kind, Listing, Metrics, ModelRef, SellerProfile } from "./types.js";
import { classifyTitle, hasRepairVocab, isCameraRelated } from "./classify.js";
import { extractModels, shareModel } from "./model.js";

export interface MetricsResult {
  metrics: Metrics;
  itemModels: ModelRef[];
  sameModelListings: Array<Listing & { kind: Kind }>;
}

/** 出品者履歴と商品から、ルール判定に使う指標を計算する。 */
export function computeMetrics(item: Item, seller: SellerProfile | null, config: AppConfig): MetricsResult {
  const { vocab, models } = config;
  const itemModels = extractModels(item.title, models);

  if (!seller) {
    return {
      itemModels,
      sameModelListings: [],
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
        repair_vocab_ratio: null,
        same_model_working_count: 0,
        same_model_junk_count: 0,
        same_model_working_median_price: null,
        price_ratio: null,
      },
    };
  }

  // 判定対象の商品自身は履歴から除く
  const others = seller.listings.filter((l) => l.auctionId !== item.auctionId);
  const classified = others.map((l) => ({ ...l, kind: classifyTitle(l.title, vocab) }));
  const total = classified.length;
  const junk = classified.filter((l) => l.kind === "junk").length;
  const working = classified.filter((l) => l.kind === "working").length;
  const camera = classified.filter((l) => isCameraRelated(l.title, vocab)).length;
  const repair = classified.filter((l) => hasRepairVocab(l.title, vocab)).length;

  const sameModel = itemModels.length === 0 ? [] : classified.filter((l) => shareModel(itemModels, extractModels(l.title, models)));
  const sameWorking = sameModel.filter((l) => l.kind === "working");
  const sameJunk = sameModel.filter((l) => l.kind === "junk");
  const prices = sameWorking.map((l) => l.buyNowPrice ?? l.price).filter((p): p is number => p !== null && p > 0);
  const medianPrice = median(prices);
  const itemPrice = item.buyNowPrice ?? item.price;
  const priceRatio = medianPrice !== null && itemPrice !== null && medianPrice > 0 ? round(itemPrice / medianPrice, 3) : null;

  const ratio = (n: number) => (total > 0 ? round(n / total, 3) : null);
  return {
    itemModels,
    sameModelListings: sameModel,
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
      repair_vocab_ratio: ratio(repair),
      same_model_working_count: sameWorking.length,
      same_model_junk_count: sameJunk.length,
      same_model_working_median_price: medianPrice,
      price_ratio: priceRatio,
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
