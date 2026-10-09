/** 共有テキストやクリップボードの中からヤフオク商品 URL を 1 つ取り出す。 */
export function extractAuctionUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const re = /https?:\/\/(?:page\.auctions|auctions)\.yahoo\.co\.jp\/[^\s"'<>]*?\/auction\/([a-z]?\d{6,})/gi;
  const m = re.exec(text);
  if (m) return `https://auctions.yahoo.co.jp/jp/auction/${m[1]}`;
  // 短縮形（アプリ共有）: https://auctions.yahoo.co.jp/jp/auction/x123 以外の形式にも備える
  const m2 = /\b([a-z]\d{9,11})\b/.exec(text);
  if (m2 && /yahoo/i.test(text)) return `https://auctions.yahoo.co.jp/jp/auction/${m2[1]}`;
  return null;
}

export function auctionIdFromUrl(url: string): string | null {
  const m = /\/auction\/([a-z]?\d{6,})/i.exec(url);
  return m ? m[1] : null;
}

export function sellerListUrl(sellerId: string, offset = 0, perPage = 50): string {
  return `https://auctions.yahoo.co.jp/seller/${encodeURIComponent(sellerId)}?b=${offset + 1}&n=${perPage}`;
}

export function sellerRatingUrl(sellerId: string, page = 1): string {
  const base = `https://auctions.yahoo.co.jp/jp/show/rating?auc_user_id=${encodeURIComponent(sellerId)}&role=seller`;
  return page > 1 ? `${base}&apg=${page}` : base;
}
