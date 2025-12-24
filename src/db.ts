import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "pubkeys.db";
const db = new Database(DB_PATH);

// Initialize the database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS pubkeys (
    pubkey TEXT PRIMARY KEY,
    first_created_at INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    published_at INTEGER
  )
`);

export interface PubkeyRecord {
  pubkey: string;
  first_created_at: number;
  first_seen_at: number;
  published_at: number | null;
}

/**
 * Get a pubkey record from the database
 */
export function getPubkey(pubkey: string): PubkeyRecord | undefined {
  return db.prepare("SELECT * FROM pubkeys WHERE pubkey = ?").get(pubkey) as PubkeyRecord | undefined;
}

/**
 * Insert a new pubkey record (first time we see this pubkey)
 */
export function insertPubkey(pubkey: string, firstCreatedAt: number, firstSeenAt: number): void {
  db.prepare(
    "INSERT INTO pubkeys (pubkey, first_created_at, first_seen_at) VALUES (?, ?, ?)"
  ).run(pubkey, firstCreatedAt, firstSeenAt);
}

/**
 * Update the first_created_at if we find an older event
 */
export function updateFirstCreatedAt(pubkey: string, firstCreatedAt: number): void {
  db.prepare(
    "UPDATE pubkeys SET first_created_at = ? WHERE pubkey = ? AND first_created_at > ?"
  ).run(firstCreatedAt, pubkey, firstCreatedAt);
}

/**
 * Mark a pubkey as published
 */
export function markPublished(pubkey: string, publishedAt: number): void {
  db.prepare("UPDATE pubkeys SET published_at = ? WHERE pubkey = ?").run(publishedAt, pubkey);
}

/**
 * Get pubkeys that need to be published (never published or updated since last publish)
 */
export function getUnpublishedPubkeys(limit = 100): PubkeyRecord[] {
  return db.prepare(
    "SELECT * FROM pubkeys WHERE published_at IS NULL LIMIT ?"
  ).all(limit) as PubkeyRecord[];
}

export default db;
