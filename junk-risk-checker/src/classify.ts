import type { Vocab } from "./config.js";
import type { Kind } from "./types.js";

/** 全角半角・大文字小文字を揃える。語彙照合はすべてこの正規化後に行う。 */
export function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

export function includesAny(text: string, words: string[]): string[] {
  const t = normalize(text);
  return words.filter((w) => w && t.includes(normalize(w)));
}

/**
 * タイトルを 完動品系 / ジャンク系 / 不明 に分ける。
 * 「ジャンク」と「美品」が同居する場合はジャンク扱い（売り手が明示したジャンク表記を優先）。
 */
export function classifyTitle(title: string, vocab: Vocab): Kind {
  if (includesAny(title, vocab.junk).length > 0) return "junk";
  if (includesAny(title, vocab.working).length > 0) return "working";
  return "unknown";
}

export function isCameraRelated(title: string, vocab: Vocab): boolean {
  return includesAny(title, vocab.camera).length > 0;
}

export function hasRepairVocab(text: string, vocab: Vocab): boolean {
  return includesAny(text, vocab.repair).length > 0;
}
