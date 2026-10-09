import { Hono } from "hono";
import type { AnalyzeDeps } from "./analyze.js";
import { analyze, AnalyzeError } from "./analyze.js";
import type { Action, Outcome } from "./db.js";
import type { CheckResult } from "./types.js";
import { extractAuctionUrl } from "./url.js";
import { aboutPage, errorPage, historyPage, homePage, resultPage } from "./views.js";
import { evaluateRules } from "./rules.js";
import { FetchError } from "./yahoo/fetch.js";

export function createApp(deps: AnalyzeDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(homePage(deps.db.listChecks(10))));
  app.get("/about", (c) => c.html(aboutPage(new URL(c.req.url).origin)));
  app.get("/history", (c) => c.html(historyPage(deps.db.listChecks(200))));

  /** 共有シート（Android PWA / iOS ショートカット）の受け口。URL 以外の文字が混ざっていてもよい。 */
  app.get("/share", (c) => {
    const q = c.req.query();
    const url = extractAuctionUrl([q.url, q.text, q.title].filter(Boolean).join("\n"));
    if (!url) return c.html(errorPage("共有された内容にヤフオクの商品 URL が見つかりません"), 400);
    return c.redirect(`/check?url=${encodeURIComponent(url)}`);
  });

  app.get("/check", async (c) => {
    const input = c.req.query("url") ?? "";
    const wantJson = c.req.query("format") === "json" || (c.req.header("accept") ?? "").startsWith("application/json");
    const debug = c.req.query("debug") === "1";
    let result: CheckResult;
    try {
      result = await analyze(input, deps);
    } catch (e) {
      const msg = describeError(e);
      const status = e instanceof AnalyzeError ? 400 : 502;
      return wantJson ? c.json({ error: msg }, status) : c.html(errorPage(msg), status);
    }
    if (wantJson) {
      const body: Record<string, unknown> = { ...result };
      if (debug) {
        body.debug = evaluateRules(deps.config.rules, {
          metrics: result.metrics,
          description: result.item.description,
          title: result.item.title,
        }).evaluations;
      }
      return c.json(body);
    }
    return c.redirect(`/checks/${result.id}`);
  });

  app.get("/checks/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = Number.isInteger(id) ? deps.db.getCheck(id) : null;
    if (!row) return c.html(errorPage("その判定は見つかりません"), 404);
    const result = JSON.parse(row.result_json) as CheckResult;
    return c.html(resultPage(result, row));
  });

  app.post("/checks/:id/outcome", async (c) => {
    const id = Number(c.req.param("id"));
    const form = await c.req.parseBody();
    const action = pick(form.action, ["bought", "skipped"]) as Action | null;
    const outcome = pick(form.outcome, ["working", "minor", "major"]) as Outcome | null;
    if (!action) return c.text("action は bought か skipped", 400);
    const ok = deps.db.setOutcome(id, action, action === "bought" ? outcome : null);
    if (!ok) return c.text("not found", 404);
    return c.redirect(`/checks/${id}`);
  });

  return app;
}

function pick(v: unknown, allowed: string[]): string | null {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}

function describeError(e: unknown): string {
  if (e instanceof FetchError) return `ヤフオクからページを取得できませんでした（HTTP ${e.status}）`;
  if (e instanceof Error) return e.message;
  return String(e);
}
