import type { Interceptor } from "../core/types.js";

/**
 * ヤフオクの商品 URL が貼られたら、junk-risk-checker（同じリポジトリの junk-risk-checker/）に
 * 判定を頼んで結果を返す。スマホの共有シートから Slack に URL を送るだけで使える。
 */
export interface JunkCheckOptions {
  /** junk-risk-checker の URL（例: http://localhost:3100） */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface CheckResponse {
  id?: number;
  item: { title: string; url: string; price: number | null; buyNowPrice: number | null; sellerName: string; sellerId: string };
  verdict: { score: number; rank: "low" | "mid" | "high"; hits: Array<{ score: number; reason: string }> };
  metrics: {
    total: number;
    camera_count: number;
    camera_junk_ratio: number | null;
    camera_working_ratio: number | null;
    same_model_working_count: number;
    same_model_junk_count: number;
    price_ratio: number | null;
    market_working_median_price: number | null;
    market_junk_median_price: number | null;
  };
  sellerError: string | null;
}

const RANK = { low: "🟢 低", mid: "🟡 中", high: "🔴 高" } as const;

/** 共有テキストから商品 URL を 1 つ取り出す（Slack の <url|label> 形式にも対応） */
export function findAuctionUrl(text: string): string | null {
  const m = /https?:\/\/(?:page\.auctions|auctions)\.yahoo\.co\.jp\/[^\s"'<>|]*?\/auction\/([a-z]?\d{6,})/i.exec(text);
  return m ? `https://auctions.yahoo.co.jp/jp/auction/${m[1]}` : null;
}

export function formatVerdict(r: CheckResponse, baseUrl: string): string {
  const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
  const m = r.metrics;
  const lines = [
    `*${RANK[r.verdict.rank]} 危険度 ${r.verdict.score}*  ${r.item.title}`,
    `現在 ${r.item.price ?? "-"} 円${r.item.buyNowPrice ? ` / 即決 ${r.item.buyNowPrice} 円` : ""} ・ 出品者 ${r.item.sellerName || r.item.sellerId}`,
  ];
  if (r.verdict.hits.length) {
    lines.push(...r.verdict.hits.map((h) => `• ${h.score >= 0 ? "+" : ""}${h.score} ${h.reason}`));
  } else {
    lines.push("• 該当するルールなし");
  }
  if (r.sellerError) lines.push(`⚠️ ${r.sellerError}`);
  else {
    lines.push(
      `出品者: カメラ ${m.camera_count} 件（ジャンク率 ${pct(m.camera_junk_ratio)} / 完動品率 ${pct(m.camera_working_ratio)}）、同型番 完動 ${m.same_model_working_count} / ジャンク ${m.same_model_junk_count}`,
    );
  }
  if (m.price_ratio !== null) lines.push(`価格比（対 完動品）: ${pct(m.price_ratio)}`);
  if (m.market_working_median_price !== null || m.market_junk_median_price !== null) {
    lines.push(`落札相場: 完動 ${m.market_working_median_price ?? "-"} 円 / ジャンク ${m.market_junk_median_price ?? "-"} 円`);
  }
  if (r.id !== undefined) lines.push(`詳細・結果の記録: ${baseUrl.replace(/\/$/, "")}/checks/${r.id}`);
  return lines.join("\n");
}

export function createJunkCheckInterceptor(opts: JunkCheckOptions): Interceptor {
  const base = opts.baseUrl.replace(/\/$/, "");
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60000;
  return async (_msg, text) => {
    const url = findAuctionUrl(text);
    if (!url) return undefined;
    try {
      const res = await f(`${base}/check?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(timeoutMs) });
      const body = (await res.json()) as CheckResponse | { error: string };
      if (!res.ok || "error" in body) return `⚠️ 判定できませんでした: ${"error" in body ? body.error : `HTTP ${res.status}`}`;
      return formatVerdict(body, base);
    } catch (err) {
      return `⚠️ ジャンク危険度チェッカーに接続できませんでした（${base}）: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
