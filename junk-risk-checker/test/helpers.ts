import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import type { Fetcher } from "../src/yahoo/fetch.js";

export const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const fixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");
export const config = loadConfig();

/** URL のパターンごとに固定の HTML を返す Fetcher。呼ばれた URL を記録する。 */
export function fakeFetcher(map: Record<string, string | (() => string)>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    for (const [pattern, body] of Object.entries(map)) {
      if (url.includes(pattern)) return typeof body === "function" ? body() : body;
    }
    throw new Error("unexpected fetch: " + url);
  }) as Fetcher & { calls: string[] };
  f.calls = calls;
  return f;
}
