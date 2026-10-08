import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CheckResult, SellerProfile } from "./types.js";

export type Action = "bought" | "skipped";
export type Outcome = "working" | "minor" | "major";

export interface CheckRow {
  id: number;
  created_at: string;
  url: string;
  auction_id: string;
  seller_id: string;
  title: string;
  price: number | null;
  score: number;
  rank: string;
  result_json: string;
  action: Action | null;
  outcome: Outcome | null;
  outcome_at: string | null;
}

/** SQLite 1 ファイル。出品者キャッシュと判定履歴（＋買った結果）を持つ。 */
export class Db {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS seller_cache (
        seller_id TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        profile_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        url TEXT NOT NULL,
        auction_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        title TEXT NOT NULL,
        price INTEGER,
        score INTEGER NOT NULL,
        rank TEXT NOT NULL,
        result_json TEXT NOT NULL,
        action TEXT,
        outcome TEXT,
        outcome_at TEXT
      );
      CREATE INDEX IF NOT EXISTS checks_created ON checks(created_at DESC);
    `);
  }

  getSeller(sellerId: string, maxAgeMs: number, now = Date.now()): SellerProfile | null {
    const row = this.db.prepare("SELECT fetched_at, profile_json FROM seller_cache WHERE seller_id = ?").get(sellerId) as
      | { fetched_at: string; profile_json: string }
      | undefined;
    if (!row) return null;
    if (now - Date.parse(row.fetched_at) > maxAgeMs) return null;
    return JSON.parse(row.profile_json) as SellerProfile;
  }

  putSeller(profile: SellerProfile): void {
    this.db
      .prepare("INSERT OR REPLACE INTO seller_cache (seller_id, fetched_at, profile_json) VALUES (?, ?, ?)")
      .run(profile.sellerId, profile.fetchedAt, JSON.stringify(profile));
  }

  insertCheck(result: CheckResult): number {
    const r = this.db
      .prepare(
        `INSERT INTO checks (created_at, url, auction_id, seller_id, title, price, score, rank, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.checkedAt,
        result.item.url,
        result.item.auctionId,
        result.item.sellerId,
        result.item.title,
        result.item.price,
        result.verdict.score,
        result.verdict.rank,
        JSON.stringify(result),
      );
    return Number(r.lastInsertRowid);
  }

  getCheck(id: number): CheckRow | null {
    return (this.db.prepare("SELECT * FROM checks WHERE id = ?").get(id) as CheckRow | undefined) ?? null;
  }

  listChecks(limit = 50): CheckRow[] {
    return this.db.prepare("SELECT * FROM checks ORDER BY id DESC LIMIT ?").all(limit) as unknown as CheckRow[];
  }

  setOutcome(id: number, action: Action | null, outcome: Outcome | null, at = new Date().toISOString()): boolean {
    const r = this.db.prepare("UPDATE checks SET action = ?, outcome = ?, outcome_at = ? WHERE id = ?").run(action, outcome, at, id);
    return Number(r.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
