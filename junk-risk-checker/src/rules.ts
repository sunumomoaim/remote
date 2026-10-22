import type { Rule, RuleCondition, RulesConfig } from "./config.js";
import type { Metrics, Rank, RuleHit, Verdict } from "./types.js";
import { includesAny } from "./classify.js";

export interface RuleInput {
  metrics: Metrics;
  description: string;
  title: string;
}

/** 条件を評価する。指標が null（算出不能）の条件は常に false。 */
export function evaluateCondition(cond: RuleCondition, input: RuleInput): boolean {
  if (cond.all) return cond.all.every((c) => evaluateCondition(c, input));
  if (cond.any) return cond.any.some((c) => evaluateCondition(c, input));
  if (cond.not) return !evaluateCondition(cond.not, input);
  if (cond.text) {
    const text = cond.text === "title" ? input.title : input.description;
    return includesAny(text, cond.includes_any ?? []).length > 0;
  }
  if (cond.metric) {
    const v = (input.metrics as unknown as Record<string, number | null>)[cond.metric];
    if (v === null || v === undefined) return false;
    const x = cond.value ?? 0;
    switch (cond.op ?? ">=") {
      case "<": return v < x;
      case "<=": return v <= x;
      case ">": return v > x;
      case ">=": return v >= x;
      case "==": return v === x;
      case "!=": return v !== x;
    }
  }
  return false;
}

/** 全ルールを評価して危険度を出す。各ルールの判定結果も返す（debug 用）。 */
export function evaluateRules(config: RulesConfig, input: RuleInput): Verdict & { evaluations: Array<{ id: string; hit: boolean; score: number }> } {
  const hits: RuleHit[] = [];
  const evaluations: Array<{ id: string; hit: boolean; score: number }> = [];
  for (const rule of config.rules) {
    const hit = evaluateCondition(rule.when, input);
    evaluations.push({ id: rule.id, hit, score: rule.score });
    if (hit) hits.push({ id: rule.id, score: rule.score, reason: fillReason(rule, input.metrics) });
  }
  const raw = config.base + hits.reduce((s, h) => s + h.score, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, rank: rankOf(score, config), hits, evaluations };
}

export function rankOf(score: number, config: RulesConfig): Rank {
  for (const rank of ["low", "mid", "high"] as const) {
    const [lo, hi] = config.ranks[rank];
    if (score >= lo && score <= hi) return rank;
  }
  return score > 60 ? "high" : "low";
}

/** 理由文の `{metric}` / `{metric_pct}` を実際の値に置き換える。 */
function fillReason(rule: Rule, metrics: Metrics): string {
  return rule.reason.replace(/\{([a-z_]+?)(_pct)?\}/g, (_, key: string, pct?: string) => {
    const v = (metrics as unknown as Record<string, number | null>)[key];
    if (v === null || v === undefined) return "?";
    return pct ? String(Math.round(v * 100)) : String(v);
  });
}
