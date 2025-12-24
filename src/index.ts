import "dotenv/config";
import WebSocket from "ws";
import { useWebSocketImplementation, SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { getPubkey, insertPubkey, updateFirstCreatedAt, getUnpublishedPubkeys, markPublished } from "./db.js";

useWebSocketImplementation(WebSocket);

// Load config from environment
const NSEC = process.env.NSEC;
const RELAYS = process.env.RELAYS?.split(",") || [];
const PUBLISH_RELAYS = process.env.PUBLISH_RELAY?.split(",") || [];
const KINDS = process.env.KINDS?.split(",").map(k => parseInt(k.trim(), 10)) || [0];

if (!NSEC) {
  console.error("NSEC is required in .env");
  process.exit(1);
}

if (RELAYS.length === 0) {
  console.error("RELAYS is required in .env");
  process.exit(1);
}

if (PUBLISH_RELAYS.length === 0) {
  console.error("PUBLISH_RELAY is required in .env");
  process.exit(1);
}

// Decode the secret key
let secretKey: Uint8Array;
if (NSEC.startsWith("nsec")) {
  const decoded = nip19.decode(NSEC);
  if (decoded.type !== "nsec") {
    console.error("Invalid NSEC format");
    process.exit(1);
  }
  secretKey = decoded.data;
} else {
  // Assume hex format
  secretKey = Uint8Array.from(Buffer.from(NSEC, "hex"));
}

const pool = new SimplePool();

console.log(`Connecting to ${RELAYS.length} relays...`);
console.log(`Will publish to ${PUBLISH_RELAYS.length} relays...`);
console.log(`Monitoring event kinds: ${KINDS.join(", ")}`);

/**
 * Handle incoming events - track pubkey first seen times
 */
function handleEvent(event: { pubkey: string; created_at: number }) {
  const now = Math.floor(Date.now() / 1000);
  const existing = getPubkey(event.pubkey);

  if (!existing) {
    // First time seeing this pubkey
    insertPubkey(event.pubkey, event.created_at, now);
    console.log(`New pubkey: ${event.pubkey.slice(0, 8)}... first_created_at=${event.created_at}`);
  } else if (event.created_at < existing.first_created_at) {
    // Found an older event from this pubkey
    updateFirstCreatedAt(event.pubkey, event.created_at);
    console.log(`Updated pubkey: ${event.pubkey.slice(0, 8)}... first_created_at=${event.created_at}`);
  }
}

/**
 * Publish NIP-85 assertion events for unpublished pubkeys
 */
async function publishAssertions() {
  const unpublished = getUnpublishedPubkeys(100);

  if (unpublished.length === 0) {
    return;
  }

  console.log(`Publishing ${unpublished.length} assertions...`);

  for (const record of unpublished) {
    const event = finalizeEvent(
      {
        kind: 30382,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", record.pubkey],
          ["first_created_at", record.first_created_at.toString()],
          ["first_seen_at", record.first_seen_at.toString()],
        ],
        content: "",
      },
      secretKey
    );

    try {
      await Promise.allSettled(pool.publish(PUBLISH_RELAYS, event));
      markPublished(record.pubkey, Math.floor(Date.now() / 1000));
      console.log(`Published assertion for ${record.pubkey.slice(0, 8)}...`);
    } catch (error) {
      console.error(`Failed to publish assertion for ${record.pubkey.slice(0, 8)}:`, error);
    }
  }
}

// Subscribe to configured event kinds (since: now = only new events, no history)
const now = Math.floor(Date.now() / 1000);

const sub = pool.subscribe(
  RELAYS,
  {
    kinds: KINDS,
    since: now,
  },
  {
    onevent(event: { pubkey: string; created_at: number }) {
      handleEvent(event);
    },
  }
);

// Publish assertions periodically
const PUBLISH_INTERVAL = 60_000; // 1 minute
setInterval(publishAssertions, PUBLISH_INTERVAL);

console.log("Service started. Listening for events...");
console.log(`Will publish assertions every ${PUBLISH_INTERVAL / 1000} seconds`);

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  sub.close();
  pool.close(RELAYS);
  process.exit(0);
});
