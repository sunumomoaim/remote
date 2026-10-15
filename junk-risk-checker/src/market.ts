import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { Listing, MarketStats, ModelRef } from "./types.js";
import { classifyTitle } from "./classify.js";
import { formatModel } from "./model.js";
import { median } from "./metrics.js";
import { closedSearchUrl } from "./url.js";
import type { Fetcher } from "./yahoo/fetch.js";
import { parseClosedSearchPage } from "./yahoo/seller.js";

export interface MarketDeps {
  fetcher: Fetcher;
  db: Db;
  config: AppConfig;
  /** 相場キャッシュの有効期間 */
  marketCacheMs?: number;
  now?: () => Date;
}

import { BUNDLE_TITLE as BUNDLE } from "./metrics.js";

/** 型番を検索語にする。メーカーは表示用に先頭だけ大文字に */
export function marketQuery(model: ModelRef): string {
  return formatModel(model);
}

/** 落札相場ページ 1 枚（50 件）から、完動品とジャンクの価格中央値を出す。 */
export function summarizeMarket(query: string, items: Listing[], total: number, config: AppConfig, fetchedAt: string): MarketStats {
  const usable = items.filter((l) => !BUNDLE.test(l.title) && (l.price ?? 0) > 0);
  const kinds = usable.map((l) => ({ l, kind: classifyTitle(l.title, config.vocab) }));
  const working = kinds.filter((k) => k.kind === "working").map((k) => k.l.price as number);
  const junk = kinds.filter((k) => k.kind === "junk").map((k) => k.l.price as number);
  return {
    query,
    fetchedAt,
    total,
    sampleSize: usable.length,
    workingCount: working.length,
    workingMedianPrice: median(working),
    junkCount: junk.length,
    junkMedianPrice: median(junk),
  };
}

/** キャッシュがあればそれを、無ければ落札相場を 1 ページ取って集計・保存する。 */
export async function loadMarket(model: ModelRef, deps: MarketDeps): Promise<MarketStats> {
  const now = deps.now ?? (() => new Date());
  const cacheMs = deps.marketCacheMs ?? 7 * 24 * 60 * 60 * 1000;
  const query = marketQuery(model);
  const cached = deps.db.getMarket(query, cacheMs, now().getTime());
  if (cached) return cached;
  const page = parseClosedSearchPage(await deps.fetcher(closedSearchUrl(query)));
  const stats = summarizeMarket(query, page.items, page.total, deps.config, now().toISOString());
  deps.db.putMarket(stats);
  return stats;
}
