import type { ModelDict } from "./config.js";
import type { ModelRef } from "./types.js";
import { normalize } from "./classify.js";

/**
 * タイトルから「メーカー + 型番」を取り出す。まとめ売りなら複数返す。
 * 1. タイトル中のメーカー別名を全部見つける
 * 2. 見つかったメーカーの既知型番を長い順に照合する
 * 3. 既知型番が 1 つも当たらなければ、英字+数字の型番らしいトークンを正規表現で拾う
 */
export function extractModels(title: string, dict: ModelDict): ModelRef[] {
  const t = normalize(title);
  const makers = Object.entries(dict.makers)
    .filter(([, aliases]) => aliases.some((a) => t.includes(normalize(a))))
    .map(([maker]) => maker);

  const found: ModelRef[] = [];
  let consumed = t;
  for (const maker of makers) {
    const models = [...(dict.models[maker] ?? [])].sort((a, b) => b.length - a.length);
    for (const model of models) {
      const nm = normalize(model);
      const idx = findToken(consumed, nm);
      if (idx < 0) continue;
      found.push({ maker, model: nm });
      // 同じ文字列を短い型番で二重に拾わないよう、当たった部分を潰す
      consumed = consumed.slice(0, idx) + " ".repeat(nm.length) + consumed.slice(idx + nm.length);
    }
  }
  if (found.length > 0) return dedupe(found);

  // 辞書に無い型番: 英字 1〜4 + 区切り + 数字 1〜4 (+英字) 。焦点距離 (50mm) や F 値 (f1.4) は除外。
  const generic: ModelRef[] = [];
  const re = /(?<![a-z0-9])([a-z]{1,4}-?\d{1,4}[a-z]{0,2}|[a-z]{1,2}-[a-z]\d{0,2})(?![a-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const tok = m[1];
    if (/^(f|mm|iso|no)\d/.test(tok) || /^\d/.test(tok) || /mm$/.test(tok)) continue;
    generic.push({ maker: makers[0] ?? null, model: tok });
  }
  return dedupe(generic);
}

/** 単語境界を意識した部分一致。"f3" が "f30" に当たらないようにする。 */
function findToken(text: string, token: string): number {
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(token, from);
    if (i < 0) return -1;
    const before = i === 0 ? " " : text[i - 1];
    const after = i + token.length >= text.length ? " " : text[i + token.length];
    const okBefore = !/[a-z0-9]/.test(before);
    const okAfter = !/[a-z0-9]/.test(after);
    if (okBefore && okAfter) return i;
    from = i + 1;
  }
  return -1;
}

function dedupe(refs: ModelRef[]): ModelRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.maker ?? "?"}:${r.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 片方のメーカーが不明なら型番だけで一致とみなす。 */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  if (a.model !== b.model) return false;
  if (a.maker === null || b.maker === null) return true;
  return a.maker === b.maker;
}

export function shareModel(xs: ModelRef[], ys: ModelRef[]): boolean {
  return xs.some((x) => ys.some((y) => sameModel(x, y)));
}

export function formatModel(r: ModelRef): string {
  return r.maker ? `${r.maker} ${r.model}` : r.model;
}
