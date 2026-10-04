# The Ledger — an event-sourced, double-entry bank core

> A banking ledger that **never stores a balance**. It stores every money movement as an immutable event, and derives balances by replaying them — so it's fully auditable, supports point-in-time queries, and can prove its own correctness.

**Stack:** Node.js · PostgreSQL · Docker · Express

![stack](https://img.shields.io/badge/Node.js-18+-3c873a) ![db](https://img.shields.io/badge/PostgreSQL-16-336791) ![docker](https://img.shields.io/badge/Docker-Compose-2496ed)

**Created by Anshika Raj** · Git username: `anshikaraj08`

---

## Why this design

Most apps keep a `balance` column and mutate it (`balance = balance - 100`). That overwrites history: once a value is gone, you can't audit it or recover from a bug. This project takes the opposite approach used by real banking and fintech systems — **event sourcing** with **double-entry** accounting:

- **Append-only events.** Money movements are inserted, never updated or deleted.
- **Double-entry.** Every transaction has matching debits and credits, so the entire ledger always sums to zero — a built-in correctness check.
- **Balance by replay.** A balance is a `SUM` over events, not a stored number. History is always reconstructable.

The whole model is three tables, and **there is no balance column anywhere**:

| table | role |
|---|---|
| `accounts` | who — users plus one special `EXTERNAL_WORLD` account |
| `transactions` | one financial event; groups the lines that must balance |
| `entries` | the immutable events (append-only); balance = `SUM` over these |
| `account_snapshots` | disposable balance checkpoints (a read optimization) |

Every deposit and withdrawal has its other leg on `EXTERNAL_WORLD`, so money is never created from nothing and the ledger always nets to zero.

---

## Live dashboard

A browser dashboard (`public/index.html`, served by the API) lets you watch balances rebuild from events in real time — deposits append to an event tape, the balance recomputes, overdrafts are blocked, and retries don't double-count.

<!-- Add your own screenshot here: -->
<!-- ![dashboard](docs/dashboard.png) -->

Open `http://localhost:3000` after starting the server.

---

## Quickstart

Requirements: Docker and Node.js 18+.

```bash
# 1. Start PostgreSQL (published on host port 5433 to avoid clashing with a local Postgres)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Load the schema into the container
docker compose exec -T db psql -U ledger -d ledger < db/schema.sql

# 4. Start the API + dashboard
npm start
```

Create a `.env` in the project root (see `.env.example`):

```
PGHOST=localhost
PGPORT=5433
PGUSER=ledger
PGPASSWORD=ledger
PGDATABASE=ledger
```

Then visit **http://localhost:3000** for the dashboard, or use the API directly:

```bash
curl -X POST localhost:3000/accounts -H 'Content-Type: application/json' -d '{"name":"Riya"}'
curl -X POST localhost:3000/accounts/2/deposit -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: dep-1' -d '{"amount":1000}'
curl localhost:3000/accounts/2/balance
```

> Amounts are integers in the smallest currency unit (**paise**) — never floats, so money never loses precision.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/accounts` | Create an account |
| `POST` | `/accounts/:id/deposit` | Deposit (send an `Idempotency-Key` header for safe retries) |
| `POST` | `/accounts/:id/withdraw` | Withdraw (overdraft-protected) |
| `POST` | `/transfers` | Transfer between two accounts |
| `GET` | `/accounts/:id/balance` | Current balance (snapshot fast-path) |
| `GET` | `/accounts/:id/balance?asOf=<ISO>` | Point-in-time balance |
| `GET` | `/accounts/:id/statement` | Passbook with running balance |
| `GET` | `/transactions/:id` | Audit a transaction (both legs + balanced check) |
| `POST` | `/accounts/:id/snapshot` | Take a balance snapshot |
| `GET` | `/admin/integrity` | Whole-ledger zero-sum health check |

Errors map to status codes: `422` insufficient funds, `400` bad input, `404` not found.

---

## Design decisions

- **Append-only events, not a stored balance** — history is never lost; balance is derived and always reconstructable.
- **Double-entry invariant** — debits equal credits per transaction, so the ledger sums to zero; corruption is detectable in one query (`GET /admin/integrity`).
- **Money as `BIGINT` paise** — integers avoid floating-point rounding errors.
- **ACID writes** — a transaction and all its entries commit together or not at all.
- **Row-level locking (`SELECT … FOR UPDATE`) with the overdraft check inside the lock** — prevents the lost-update race, so concurrent withdrawals can't overdraw an account.
- **Deadlock avoidance** — multi-account locks are always acquired in sorted account-id order.
- **Idempotency keys** — a `UNIQUE` database constraint (not app logic) guarantees retried requests never double-post.
- **Point-in-time queries** — by timestamp for humans, by monotonic event id for exact replay (timestamps can collide).
- **Snapshotting** — periodic checkpoints bound replay cost; snapshots are a disposable cache, rebuildable from events.

---

## Testing

```bash
npm test               # pure double-entry / balance math (no database needed)
npm run demo           # end-to-end deposit + transfer
npm run test:concurrency  # 10 racing withdrawals: exactly 5 succeed, none overdraw
npm run test:pit       # point-in-time queries + audit + integrity
npm run test:snapshot  # snapshot balance equals a full replay
```

The concurrency test is the highlight: it fires 10 simultaneous withdrawals at an account that can only cover 5, and verifies exactly 5 succeed, 5 are rejected, and the balance never goes negative.

---

## Project structure

```
src/
  db.js          shared connection pool + withTransaction() ACID helper
  invariants.js  pure double-entry rules (unit-tested, no DB)
  ledger.js      engine: accounts, transactions, locking, idempotency, overdraft
  audit.js       point-in-time, running balance, transaction audit, integrity
  snapshot.js    checkpoints + fast balance
  server.js      Express REST layer + serves the dashboard
public/
  index.html     live dashboard
db/
  schema.sql     tables, indexes, seed EXTERNAL account
scripts/         demo + test scripts
```

---

## Notes

Concepts drawn from Greg Young's event-sourcing talks, Martin Fowler's writing on CQRS/event sourcing, and standard double-entry ledger design. Built as a study of how financial systems stay correct, auditable, and safe under concurrency.
