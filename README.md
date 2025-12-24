# NIP-85 Service Provider: first_created_at

A Nostr service provider that monitors relays for new pubkeys and publishes NIP-85 Trusted Assertion events with `first_created_at` timestamps.

## What it does

1. Connects to configured relays and listens for kind 0 (profile) events
2. When a new pubkey is detected:
   - Check local cache (SQLite)
   - On cache miss → query publish relays for existing assertion
   - If found → cache locally
   - If not found → publish new assertion + cache
3. Publishes kind `30382` (User Assertion) events with `first_created_at` and `first_seen_at` tags

## Why both tags?

Users can backdate their event's `created_at` timestamp to appear older. We track both values:

| Tag | Value | Trustworthy? |
|-----|-------|--------------|
| `first_created_at` | Earliest `created_at` from user's events | No - can be backdated |
| `first_seen_at` | When our service first observed this pubkey | Yes - independent observation |

Clients can compare both values to detect suspicious accounts.

## NIP-85 Event Structure

```json
{
  "kind": 30382,
  "tags": [
    ["d", "<pubkey>"],
    ["first_created_at", "<unix_timestamp>"],
    ["first_seen_at", "<unix_timestamp>"]
  ],
  "content": "",
  "pubkey": "<service_provider_pubkey>"
}
```

## Setup

```bash
# Install dependencies
npm i

# Copy environment file and configure
cp .env.example .env

# Edit .env with your values
```

## Configuration

| Variable | Description |
|----------|-------------|
| `NSEC` | Private key for signing assertions (nsec or hex) |
| `RELAYS` | Comma-separated list of relays to monitor |
| `PUBLISH_RELAY` | Comma-separated list of relays to publish assertions to |
| `KINDS` | Event kinds to monitor (default: 0) |
| `DB_PATH` | SQLite database path (default: pubkeys.db) |

## Usage

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Docker

```bash
# Build and run locally
docker compose up -d

# Or use pre-built image from GHCR
docker compose -f docker-compose.ghcr.yml up -d

# View logs
docker compose logs -f
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Listen Relays  │────▶│    Service      │
└─────────────────┘     │                 │
                        │  1. Check cache │
                        │  2. Query relay │
                        │  3. Publish     │
                        └────────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  SQLite  │ │  Publish │ │  Publish │
              │  Cache   │ │  Relay 1 │ │  Relay 2 │
              └──────────┘ └──────────┘ └──────────┘
```

## How clients use this data

Clients can query this provider's assertions to determine account age:

```javascript
const filter = {
  kinds: [30382],
  authors: ["<provider_pubkey>"],
  "#d": ["<target_pubkey>"]
};
```

Then compare `first_created_at` vs `first_seen_at` to detect cheaters.
