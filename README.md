# NIP-85 Service Provider: first_created_at

A Nostr service provider that monitors relays for new pubkeys and publishes NIP-85 Trusted Assertion events with `first_created_at` timestamps.

## What it does

1. Connects to configured relays and listens for all events
2. Tracks when each pubkey is **first observed** by the service
3. Publishes kind `30382` (User Assertion) events with `first_created_at` and `first_seen_at` tags

## Why both tags?

Users can backdate their event's `created_at` timestamp to appear older. We track both values:

| Tag | Value | Trustworthy? |
|-----|-------|--------------|
| `first_created_at` | Earliest `created_at` from user's events | No - can be backdated |
| `first_seen_at` | When our service first observed this pubkey | Yes - independent observation |

Clients can compare both values to detect suspicious accounts.

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

## Usage

```bash
# Development
npm run dev

# Production
npm run build
npm start
```
