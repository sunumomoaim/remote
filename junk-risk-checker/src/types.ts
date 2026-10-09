/** 出品 1 件（出品中、または評価ページから取れた過去の落札品） */
export interface Listing {
  auctionId: string;
  title: string;
  /** 現在価格（評価ページ由来のものは不明なので null） */
  price: number | null;
  /** 即決価格 */
  buyNowPrice: number | null;
  endTime: string | null;
  source: "listing" | "sold";
}

/** 共有された商品ページから取れる情報 */
export interface Item {
  auctionId: string;
  url: string;
  title: string;
  description: string;
  price: number | null;
  buyNowPrice: number | null;
  sellerId: string;
  sellerName: string;
  images: string[];
  categoryPath: string[];
  endTime: string | null;
  status: string;
  conditionName: string;
}

/** 出品者の出品履歴（キャッシュ単位） */
export interface SellerProfile {
  sellerId: string;
  fetchedAt: string;
  /** 出品中 + 落札済み（評価ページ由来） */
  listings: Listing[];
  /** 出品中の総数（ページ送りで取り切れていない分を含む） */
  totalListings: number;
  /** 出品者として受けた評価の総数 */
  totalRatings: number;
  fetchedPages: number;
}

export type Kind = "working" | "junk" | "unknown";

export interface ModelRef {
  maker: string | null;
  model: string;
}

/** ルール判定に渡す指標。null は「算出できなかった」 */
export interface Metrics {
  seller_available: number;
  total: number;
  listing_count: number;
  sold_count: number;
  junk_count: number;
  working_count: number;
  /** 全出品に対する比率 */
  junk_ratio: number | null;
  working_ratio: number | null;
  camera_ratio: number | null;
  /** カメラ関連の出品だけで見た件数と比率。バッグや服などの出品に薄められない */
  camera_count: number;
  camera_junk_ratio: number | null;
  camera_working_ratio: number | null;
  repair_vocab_ratio: number | null;
  same_model_working_count: number;
  same_model_junk_count: number;
  same_model_working_median_price: number | null;
  price_ratio: number | null;
}

export interface RuleHit {
  id: string;
  score: number;
  reason: string;
}

export type Rank = "low" | "mid" | "high";

export interface Verdict {
  score: number;
  rank: Rank;
  hits: RuleHit[];
}

export interface CheckResult {
  id?: number;
  checkedAt: string;
  item: Item;
  itemModels: ModelRef[];
  seller: SellerProfile | null;
  sellerError: string | null;
  metrics: Metrics;
  verdict: Verdict;
  /** 同型番の出品（理由の裏付け表示用） */
  sameModelListings: Array<Listing & { kind: Kind }>;
}
