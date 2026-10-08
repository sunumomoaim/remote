import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server.js";
import { loadConfig } from "./config.js";
import { Db } from "./db.js";
import { createFetcher } from "./yahoo/fetch.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3100);
const dataDir = process.env.DATA_DIR ?? path.join(root, "data");

const config = loadConfig(process.env.CONFIG_DIR ?? path.join(root, "config"));
const db = new Db(path.join(dataDir, "junk-risk.sqlite"));
const fetcher = createFetcher({ minIntervalMs: Number(process.env.FETCH_INTERVAL_MS ?? 1000) });

const app = createApp({
  fetcher,
  db,
  config,
  maxListingPages: Number(process.env.MAX_LISTING_PAGES ?? 2),
  maxRatingPages: Number(process.env.MAX_RATING_PAGES ?? 2),
  sellerCacheMs: Number(process.env.SELLER_CACHE_HOURS ?? 24) * 60 * 60 * 1000,
});
app.use("/*", serveStatic({ root: path.relative(process.cwd(), path.join(root, "public")) || "public" }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`junk-risk-checker: http://localhost:${info.port}  (data: ${dataDir})`);
});
