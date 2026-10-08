import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Vocab {
  junk: string[];
  working: string[];
  camera: string[];
  repair: string[];
  notExpert: string[];
  partialCheck: string[];
  estate: string[];
}

export interface ModelDict {
  makers: Record<string, string[]>;
  models: Record<string, string[]>;
}

export interface RuleCondition {
  metric?: string;
  op?: "<" | "<=" | ">" | ">=" | "==" | "!=";
  value?: number;
  text?: "description" | "title";
  includes_any?: string[];
  all?: RuleCondition[];
  any?: RuleCondition[];
  not?: RuleCondition;
}

export interface Rule {
  id: string;
  when: RuleCondition;
  score: number;
  reason: string;
}

export interface RulesConfig {
  base: number;
  ranks: { low: [number, number]; mid: [number, number]; high: [number, number] };
  rules: Rule[];
}

export interface AppConfig {
  vocab: Vocab;
  models: ModelDict;
  rules: RulesConfig;
}

export const defaultConfigDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config");

export function loadConfig(dir = defaultConfigDir): AppConfig {
  const read = (name: string) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  return { vocab: read("vocab.json"), models: read("models.json"), rules: read("rules.json") };
}
