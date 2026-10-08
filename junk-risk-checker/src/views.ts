import type { CheckRow } from "./db.js";
import type { CheckResult, Rank } from "./types.js";
import { formatModel } from "./model.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const RANK_LABEL: Record<Rank, string> = { low: "低", mid: "中", high: "高" };
const RANK_ICON: Record<Rank, string> = { low: "🟢", mid: "🟡", high: "🔴" };

export function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1f2937">
<title>${esc(title)}</title>
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>
  :root { color-scheme: light dark; --fg:#111; --bg:#fff; --muted:#666; --line:#ddd; --card:#f6f6f6; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --bg:#111; --muted:#aaa; --line:#333; --card:#1c1c1c; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; color:var(--fg); background:var(--bg); line-height:1.5; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.2rem; margin: 0 0 12px; }
  h2 { font-size: 1rem; margin: 20px 0 8px; color: var(--muted); }
  a { color: inherit; }
  .card { background: var(--card); border-radius: 10px; padding: 14px; margin: 10px 0; }
  .score { font-size: 2rem; font-weight: 700; }
  .rank-low { color:#15803d; } .rank-mid { color:#b45309; } .rank-high { color:#b91c1c; }
  .muted { color: var(--muted); font-size: .9rem; }
  ul { padding-left: 1.2em; margin: 6px 0; } li { margin: 4px 0; }
  table { width:100%; border-collapse: collapse; font-size:.92rem; } td, th { padding:6px 4px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  input[type=text], textarea { width:100%; font-size:1rem; padding:10px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }
  button { font-size:1rem; padding:10px 16px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; }
  button.primary { background:#2563eb; color:#fff; border-color:#2563eb; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
  .plus { color:#b91c1c; } .minus { color:#15803d; }
  nav { display:flex; gap:14px; margin-bottom:14px; font-size:.95rem; }
  pre { white-space: pre-wrap; word-break: break-all; font-size:.85rem; }
  .err { background:#fee2e2; color:#7f1d1d; padding:10px; border-radius:8px; }
</style>
</head>
<body><main>
<nav><a href="/">判定</a><a href="/history">履歴</a></nav>
${body}
</main>
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});</script>
</body></html>`;
}

export function homePage(recent: CheckRow[], error?: string): string {
  return layout(
    "ジャンク危険度チェッカー",
    `<h1>ジャンク危険度チェッカー</h1>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="get" action="/check" class="card">
  <label class="muted">ヤフオクの商品 URL（共有テキストをそのまま貼ってもOK）</label>
  <textarea name="url" rows="3" placeholder="https://page.auctions.yahoo.co.jp/jp/auction/..." required></textarea>
  <div class="row"><button class="primary" type="submit">判定する</button></div>
</form>
<p class="muted">スマホの共有シートから開く設定は <a href="/about">使い方</a> を参照。</p>
${recent.length ? `<h2>最近の判定</h2>${historyTable(recent)}` : ""}`,
  );
}

export function resultPage(r: CheckResult, row?: CheckRow | null): string {
  const v = r.verdict;
  const m = r.metrics;
  const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
  const hits = v.hits
    .map(
      (h) =>
        `<li><span class="${h.score >= 0 ? "plus" : "minus"}">${h.score >= 0 ? "+" : ""}${h.score}</span> ${esc(h.reason)}</li>`,
    )
    .join("");
  const models = r.itemModels.map(formatModel).join(", ") || "（型番を特定できず）";
  const same = r.sameModelListings
    .slice(0, 20)
    .map(
      (l) =>
        `<tr><td>${l.kind === "working" ? "完動系" : l.kind === "junk" ? "ジャンク系" : "不明"}</td><td><a href="https://auctions.yahoo.co.jp/jp/auction/${esc(l.auctionId)}" target="_blank" rel="noopener">${esc(l.title)}</a></td><td>${l.buyNowPrice ?? l.price ?? "-"}</td><td>${l.source === "sold" ? "落札済" : "出品中"}</td></tr>`,
    )
    .join("");
  const outcome = row
    ? `<div class="card">
  <div class="muted">この判定の結果を記録（あとで重み調整に使う）</div>
  <form method="post" action="/checks/${row.id}/outcome" class="row">
    <button name="action" value="bought" ${row.action === "bought" ? 'class="primary"' : ""}>買った</button>
    <button name="action" value="skipped" ${row.action === "skipped" ? 'class="primary"' : ""}>見送った</button>
  </form>
  ${
    row.action === "bought"
      ? `<form method="post" action="/checks/${row.id}/outcome" class="row">
    <input type="hidden" name="action" value="bought">
    <button name="outcome" value="working" ${row.outcome === "working" ? 'class="primary"' : ""}>完動だった</button>
    <button name="outcome" value="minor" ${row.outcome === "minor" ? 'class="primary"' : ""}>軽症（モルト・清掃程度）</button>
    <button name="outcome" value="major" ${row.outcome === "major" ? 'class="primary"' : ""}>重故障</button>
  </form>`
      : ""
  }
</div>`
    : "";

  return layout(
    `危険度 ${v.score} - ${r.item.title}`,
    `<h1><a href="${esc(r.item.url)}" target="_blank" rel="noopener">${esc(r.item.title)}</a></h1>
<div class="muted">現在価格 ${r.item.price ?? "-"} 円${r.item.buyNowPrice ? ` / 即決 ${r.item.buyNowPrice} 円` : ""} ・ 出品者 ${esc(r.item.sellerName || r.item.sellerId)} ・ 型番: ${esc(models)}</div>
<div class="card">
  <div class="score rank-${v.rank}">${RANK_ICON[v.rank]} 危険度 ${v.score}（${RANK_LABEL[v.rank]}）</div>
  <div class="muted">選別済み・検品済みの「危険なジャンク」である可能性。高いほど避けた方がよい。</div>
  <h2>理由</h2>
  <ul>${hits || "<li>該当するルールなし（基準値のまま）</li>"}</ul>
  ${r.sellerError ? `<p class="err">${esc(r.sellerError)}</p>` : ""}
</div>
${outcome}
<h2>出品者の傾向</h2>
<div class="card">
<table>
<tr><th>見た件数</th><td>${m.total}（出品中 ${m.listing_count} / 落札済 ${m.sold_count}）${r.seller ? `<span class="muted"> 出品中計 ${r.seller.totalListings} ・ 出品者評価計 ${r.seller.totalRatings}</span>` : ""}</td></tr>
<tr><th>ジャンク率</th><td>${pct(m.junk_ratio)}（${m.junk_count} 件）</td></tr>
<tr><th>完動品率</th><td>${pct(m.working_ratio)}（${m.working_count} 件）</td></tr>
<tr><th>カメラ関連率</th><td>${pct(m.camera_ratio)}</td></tr>
<tr><th>修理語彙率</th><td>${pct(m.repair_vocab_ratio)}</td></tr>
<tr><th>同型番 完動 / ジャンク</th><td>${m.same_model_working_count} / ${m.same_model_junk_count}</td></tr>
<tr><th>価格比（対 同型番完動品中央値）</th><td>${m.price_ratio === null ? "-（同型番の完動品価格なし）" : `${pct(m.price_ratio)}（中央値 ${m.same_model_working_median_price} 円）`}</td></tr>
</table>
</div>
${same ? `<h2>同型番の出品</h2><div class="card"><table><tr><th>種別</th><th>タイトル</th><th>価格</th><th></th></tr>${same}</table></div>` : ""}
<h2>商品説明</h2>
<div class="card"><pre>${esc(r.item.description)}</pre></div>
<p class="muted"><a href="/check?url=${encodeURIComponent(r.item.url)}&format=json&debug=1">JSON / debug</a></p>`,
  );
}

export function historyPage(rows: CheckRow[]): string {
  return layout("判定履歴", `<h1>判定履歴</h1>${rows.length ? historyTable(rows) : '<p class="muted">まだ判定がありません。</p>'}`);
}

function historyTable(rows: CheckRow[]): string {
  const act = (r: CheckRow) =>
    r.action === "bought"
      ? `買った${r.outcome ? `・${{ working: "完動", minor: "軽症", major: "重故障" }[r.outcome]}` : ""}`
      : r.action === "skipped"
        ? "見送り"
        : "";
  return `<table>
<tr><th>危険度</th><th>商品</th><th>結果</th></tr>
${rows
  .map(
    (r) =>
      `<tr><td class="rank-${r.rank}">${RANK_ICON[r.rank as Rank] ?? ""} ${r.score}</td><td><a href="/checks/${r.id}">${esc(r.title)}</a><div class="muted">${esc(r.created_at.slice(0, 16).replace("T", " "))} ・ ${r.price ?? "-"} 円</div></td><td>${act(r)}</td></tr>`,
  )
  .join("")}
</table>`;
}

export function aboutPage(origin: string): string {
  return layout(
    "使い方",
    `<h1>使い方</h1>
<h2>Android</h2>
<ol>
<li>Chrome でこのページを開き、メニューから「ホーム画面に追加」（アプリとしてインストール）</li>
<li>ヤフオクアプリで商品の「共有」→ 「ジャンク危険度」を選ぶ</li>
</ol>
<h2>iPhone</h2>
<ol>
<li>「ショートカット」アプリで新規ショートカットを作る</li>
<li>詳細（i）で「共有シートに表示」をオン、受け取る種類は「URL」と「テキスト」</li>
<li>アクション「URL」を追加し、次の文字列を入れる: <code>${esc(origin)}/share?text=</code> の直後に変数「ショートカットの入力」を置く</li>
<li>アクション「URL を開く」を追加</li>
<li>ヤフオクアプリの共有シートからこのショートカットを選ぶ</li>
</ol>
<h2>PC</h2>
<p>URL を貼って「判定する」。</p>
<h2>注意</h2>
<ul>
<li>出品者 1 人あたり最大 5 ページ、1 秒以上の間隔でヤフオクにアクセスします。個人利用の前提です。</li>
<li>出品者情報は 24 時間キャッシュします。</li>
<li>「買った / 結果」の記録が 100 件程度たまってから <code>config/rules.json</code> の重みを調整してください。</li>
</ul>`,
  );
}

export function errorPage(message: string): string {
  return layout("エラー", `<h1>判定できませんでした</h1><p class="err">${esc(message)}</p><p><a href="/">戻る</a></p>`);
}
