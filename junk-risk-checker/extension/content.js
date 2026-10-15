// ヤフオクの商品ページ右下にパネルを出し、ローカルの junk-risk-checker に判定を頼む。
(() => {
  const DEFAULT_SERVER = "http://localhost:3100";
  const RANK = { low: ["🟢", "低", "#15803d"], mid: ["🟡", "中", "#b45309"], high: ["🔴", "高", "#b91c1c"] };

  const panel = document.createElement("div");
  panel.id = "junk-risk-panel";
  Object.assign(panel.style, {
    position: "fixed", right: "12px", bottom: "12px", zIndex: "2147483647", width: "320px", maxHeight: "70vh", overflow: "auto",
    background: "#fff", color: "#111", border: "1px solid #ccc", borderRadius: "10px", boxShadow: "0 4px 16px rgba(0,0,0,.2)",
    font: "13px/1.5 -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', sans-serif", padding: "10px 12px",
  });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pct = (x) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);

  const render = (html) => { panel.innerHTML = html; };
  const header = (extra = "") =>
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b>ジャンク危険度</b><span>${extra}<button id="jr-close" style="border:0;background:none;font-size:16px;cursor:pointer">×</button></span></div>`;

  async function serverUrl() {
    try {
      const v = await chrome.storage.sync.get({ server: DEFAULT_SERVER });
      return String(v.server || DEFAULT_SERVER).replace(/\/$/, "");
    } catch {
      return DEFAULT_SERVER;
    }
  }

  async function run() {
    const base = await serverUrl();
    render(header() + `<div>判定中…（出品者情報を取得しています）</div>`);
    try {
      const res = await fetch(`${base}/check?url=${encodeURIComponent(location.href)}&format=json`, { signal: AbortSignal.timeout(60000) });
      const r = await res.json();
      if (!res.ok || r.error) throw new Error(r.error || `HTTP ${res.status}`);
      const [icon, label, color] = RANK[r.verdict.rank] || RANK.mid;
      const m = r.metrics;
      const hits = r.verdict.hits.length
        ? r.verdict.hits.map((h) => `<li><span style="color:${h.score >= 0 ? "#b91c1c" : "#15803d"}">${h.score >= 0 ? "+" : ""}${h.score}</span> ${esc(h.reason)}</li>`).join("")
        : "<li>該当するルールなし</li>";
      render(
        header(`<a href="${base}/checks/${r.id}" target="_blank" rel="noopener" style="margin-right:8px">詳細</a>`) +
          `<div style="font-size:22px;font-weight:700;color:${color}">${icon} 危険度 ${r.verdict.score}（${label}）</div>` +
          `<ul style="padding-left:18px;margin:6px 0">${hits}</ul>` +
          (r.sellerError ? `<div style="color:#b91c1c">${esc(r.sellerError)}</div>` : "") +
          `<div style="color:#666;font-size:12px">出品者: カメラ ${m.camera_count} 件、ジャンク率 ${pct(m.camera_junk_ratio)}、完動品率 ${pct(m.camera_working_ratio)}、同型番 完動 ${m.same_model_working_count} / ジャンク ${m.same_model_junk_count}` +
          (m.price_ratio !== null ? `、価格比 ${pct(m.price_ratio)}` : "") +
          (m.market_junk_median_price !== null ? `、ジャンク相場 ${m.market_junk_median_price} 円` : "") +
          `</div>` +
          `<div style="margin-top:8px"><button id="jr-again" style="font-size:12px">再判定</button></div>`,
      );
    } catch (e) {
      render(header() + `<div style="color:#b91c1c">判定できませんでした: ${esc(e.message)}</div><div style="color:#666;font-size:12px;margin-top:6px">junk-risk-checker が ${esc(base)} で起動しているか確認してください（拡張機能のオプションでサーバー URL を変えられます）。</div><div style="margin-top:8px"><button id="jr-again" style="font-size:12px">再試行</button></div>`);
    }
  }

  panel.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.id === "jr-close") panel.remove();
    if (t.id === "jr-run" || t.id === "jr-again") run();
  });

  render(header() + `<button id="jr-run" style="font-size:13px;padding:6px 12px;cursor:pointer">この出品を判定する</button><div style="color:#666;font-size:12px;margin-top:6px">出品者の出品一覧と評価、落札相場を見て危険度を出します（数秒）。</div>`);
  document.body.appendChild(panel);
})();
