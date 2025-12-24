import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DB_PATH || "pubkeys.db";

// Create directory if it doesn't exist
const dir = dirname(DB_PATH);
if (dir !== "." && !existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS pubkeys (
    pubkey TEXT PRIMARY KEY,
    first_created_at INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL
  )
`);

export interface PubkeyRecord {
  pubkey: string;
  first_created_at: number;
  first_seen_at: number;
}

/**
 * Get a pubkey record from cache
 */
export function getPubkey(pubkey: string): PubkeyRecord | undefined {
  return db.prepare("SELECT * FROM pubkeys WHERE pubkey = ?").get(pubkey) as PubkeyRecord | undefined;
}

/**
 * Add a pubkey to cache
 */
export function cachePubkey(pubkey: string, firstCreatedAt: number, firstSeenAt: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO pubkeys (pubkey, first_created_at, first_seen_at) VALUES (?, ?, ?)"
  ).run(pubkey, firstCreatedAt, firstSeenAt);
}

/**
 * Get cache size
 */
export function getCacheSize(): number {
  const result = db.prepare("SELECT COUNT(*) as count FROM pubkeys").get() as { count: number };
  return result.count;
}
