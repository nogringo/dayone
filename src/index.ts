import "dotenv/config";
import WebSocket from "ws";
import { useWebSocketImplementation, SimplePool } from "nostr-tools/pool";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { getPubkey, cachePubkey, getCacheSize } from "./db.js";

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

// Get our public key for querying our own assertions
const ourPubkey = getPublicKey(secretKey);

const pool = new SimplePool();

console.log(`Connecting to ${RELAYS.length} relays...`);
console.log(`Will publish to ${PUBLISH_RELAYS.length} relays...`);
console.log(`Monitoring event kinds: ${KINDS.join(", ")}`);
console.log(`Our pubkey: ${ourPubkey.slice(0, 8)}...`);

/**
 * Check if we have an assertion for this pubkey on relays
 */
async function fetchAssertionFromRelay(pubkey: string): Promise<{ first_created_at: number; first_seen_at: number } | null> {
  try {
    const event = await pool.get(
      PUBLISH_RELAYS,
      {
        kinds: [30382],
        authors: [ourPubkey],
        "#d": [pubkey],
      }
    );

    if (event) {
      const firstCreatedAtTag = event.tags.find(t => t[0] === "first_created_at");
      const firstSeenAtTag = event.tags.find(t => t[0] === "first_seen_at");

      if (firstCreatedAtTag && firstSeenAtTag) {
        return {
          first_created_at: parseInt(firstCreatedAtTag[1], 10),
          first_seen_at: parseInt(firstSeenAtTag[1], 10),
        };
      }
    }
  } catch (error) {
    console.error(`Failed to fetch assertion for ${pubkey.slice(0, 8)}:`, error);
  }

  return null;
}

/**
 * Publish NIP-85 assertion for a pubkey
 */
async function publishAssertion(pubkey: string, firstCreatedAt: number, firstSeenAt: number) {
  const event = finalizeEvent(
    {
      kind: 30382,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", pubkey],
        ["first_created_at", firstCreatedAt.toString()],
        ["first_seen_at", firstSeenAt.toString()],
      ],
      content: "",
    },
    secretKey
  );

  try {
    await Promise.allSettled(pool.publish(PUBLISH_RELAYS, event));
    console.log(`Published assertion for ${pubkey.slice(0, 8)}...`);
  } catch (error) {
    console.error(`Failed to publish assertion for ${pubkey.slice(0, 8)}:`, error);
  }
}

/**
 * Handle incoming events - cache-through pattern
 */
async function handleEvent(event: { pubkey: string; created_at: number }) {
  const { pubkey } = event;
  const now = Math.floor(Date.now() / 1000);

  // 1. Check local cache
  const cached = getPubkey(pubkey);
  if (cached) {
    return; // Already known
  }

  // 2. Cache miss - check relays for existing assertion
  const existing = await fetchAssertionFromRelay(pubkey);

  if (existing) {
    // 3. Found on relay - add to cache, don't republish
    cachePubkey(pubkey, existing.first_created_at, existing.first_seen_at);
    console.log(`Cached from relay: ${pubkey.slice(0, 8)}... (cache: ${getCacheSize()})`);
  } else {
    // 4. Not on relay - publish new assertion and cache
    cachePubkey(pubkey, event.created_at, now);
    await publishAssertion(pubkey, event.created_at, now);
    console.log(`New pubkey: ${pubkey.slice(0, 8)}... (cache: ${getCacheSize()})`);
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

console.log("Service started. Listening for events...");

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  sub.close();
  pool.close(RELAYS);
  process.exit(0);
});
