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
  isStore: boolean;
  /** 出品者の総合評価数 */
  sellerRatingCount: number | null;
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
  /** 出品者として受けた評価の総数（= 売った回数の目安） */
  totalRatings: number;
  /** 落札者として受けた評価の総数（= 買った回数の目安。仕入れ量）。取れなければ null */
  totalBought: number | null;
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
  /** まとめ売り・複数台の出品なら 1。価格比較は 1 台の相場と合わないので価格ルールの対象外にする */
  is_bundle: number;
  /** 商品ページの写真枚数 */
  image_count: number;
  /** 出品者が落札者として受けた評価数（仕入れ量）。不明なら null */
  bought_total: number | null;
  /** 出品者として受けた評価数（販売量） */
  sold_total: number | null;
  /** 仕入れ量 ÷ 販売量。大きいほど「買って選別して売る」業者らしい */
  buy_sell_ratio: number | null;
  /** ストア出品者なら 1 */
  is_store: number;
  /** 出品者の総合評価数 */
  seller_rating_count: number | null;
  /** 価格比。出品者の同型番完動品があればそれ、無ければ落札相場の完動品中央値に対する比 */
  price_ratio: number | null;
  market_sample_size: number;
  market_working_median_price: number | null;
  market_junk_median_price: number | null;
  /** 今回の価格 ÷ 落札相場のジャンク中央値 */
  market_junk_price_ratio: number | null;
}

/** 同型番の落札相場（終了したオークションの検索結果から） */
export interface MarketStats {
  /** 検索に使った文字列 */
  query: string;
  fetchedAt: string;
  /** 検索結果の総数 */
  total: number;
  /** 集計に使った件数（まとめ売り等を除いた後） */
  sampleSize: number;
  workingCount: number;
  workingMedianPrice: number | null;
  junkCount: number;
  junkMedianPrice: number | null;
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
  market: MarketStats | null;
  marketError: string | null;
  /** price_ratio の出どころ */
  priceRatioSource: "seller" | "market" | null;
  metrics: Metrics;
  verdict: Verdict;
  /** 同型番の出品（理由の裏付け表示用） */
  sameModelListings: Array<Listing & { kind: Kind }>;
}
