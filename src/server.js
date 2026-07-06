// server.js — Phase 5. A thin REST layer over the ledger engine.
// The HTTP layer does NO business logic; it just validates input and calls the
// same functions our tests use. All the money rules live in the engine.

const express = require("express");
const ledger = require("./ledger");
const audit = require("./audit");
const snapshot = require("./snapshot");

const app = express();
app.use(express.json());
app.use(express.static(require("path").join(__dirname, "..", "public")));

// JSON can't serialize BigInt, so balances go out as strings. Amounts are in
// the smallest currency unit (paise) — integers only, never floats.
const s = (v) => (typeof v === "bigint" ? v.toString() : v);

// Async error funnel: turn known errors into clean HTTP status codes.
const h = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    if (err.code === "INSUFFICIENT_FUNDS")
      return res.status(422).json({ error: "INSUFFICIENT_FUNDS", message: err.message });
    if (/at least 2 entries|positive integer|Unbalanced|Unknown direction/.test(err.message))
      return res.status(400).json({ error: "BAD_REQUEST", message: err.message });
    console.error(err);
    res.status(500).json({ error: "INTERNAL", message: err.message });
  });

function requireAmount(body) {
  const a = body.amount;
  if (!Number.isInteger(a) || a <= 0) {
    throw new Error("amount must be a positive integer (paise)");
  }
  return a;
}

app.get("/health", (req, res) => res.json({ ok: true }));

// Create an account
app.post("/accounts", h(async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: "BAD_REQUEST", message: "name required" });
  const acc = await ledger.createAccount(req.body.name, req.body.currency);
  res.status(201).json(acc);
}));

// Current balance (uses snapshot fast-path) OR point-in-time via ?asOf=ISO_DATE
app.get("/accounts/:id/balance", h(async (req, res) => {
  const { id } = req.params;
  if (req.query.asOf) {
    const bal = await audit.getBalanceAsOf(id, req.query.asOf);
    return res.json({ accountId: id, asOf: req.query.asOf, balance: s(bal) });
  }
  const bal = await snapshot.getBalanceFast(id);
  res.json({ accountId: id, balance: s(bal) });
}));

// Passbook with running balance
app.get("/accounts/:id/statement", h(async (req, res) => {
  const rows = await audit.getStatementWithRunningBalance(req.params.id);
  res.json(rows.map((r) => ({ ...r, amount: s(r.amount), running_balance: s(r.running_balance) })));
}));

// Deposit / Withdraw. Idempotency-Key header makes retries safe.
app.post("/accounts/:id/deposit", h(async (req, res) => {
  const amount = requireAmount(req.body);
  const idempotencyKey = req.get("Idempotency-Key") || null;
  const r = await ledger.deposit(req.params.id, amount, { idempotencyKey });
  res.status(201).json({ transactionId: s(r.transactionId), idempotentReplay: !!r.idempotentReplay });
}));

app.post("/accounts/:id/withdraw", h(async (req, res) => {
  const amount = requireAmount(req.body);
  const idempotencyKey = req.get("Idempotency-Key") || null;
  const r = await ledger.withdraw(req.params.id, amount, { idempotencyKey });
  res.status(201).json({ transactionId: s(r.transactionId), idempotentReplay: !!r.idempotentReplay });
}));

// Transfer between two accounts
app.post("/transfers", h(async (req, res) => {
  const { fromId, toId } = req.body;
  const amount = requireAmount(req.body);
  if (!fromId || !toId) return res.status(400).json({ error: "BAD_REQUEST", message: "fromId and toId required" });
  const idempotencyKey = req.get("Idempotency-Key") || null;
  const r = await ledger.transfer(fromId, toId, amount, { idempotencyKey });
  res.status(201).json({ transactionId: s(r.transactionId), idempotentReplay: !!r.idempotentReplay });
}));

// Audit a single transaction (both legs + balanced check)
app.get("/transactions/:id", h(async (req, res) => {
  const t = await audit.getTransaction(req.params.id);
  if (!t) return res.status(404).json({ error: "NOT_FOUND" });
  res.json({
    transaction: t.transaction,
    balanced: t.balanced,
    entries: t.entries.map((e) => ({ ...e, amount: s(e.amount) })),
  });
}));

// Take a snapshot for an account
app.post("/accounts/:id/snapshot", h(async (req, res) => {
  const snap = await snapshot.createSnapshot(req.params.id);
  res.status(201).json({ snapshotId: s(snap.snapshotId), balance: s(snap.balance), lastEntryId: s(snap.lastEntryId) });
}));

// Whole-ledger integrity check
app.get("/admin/integrity", h(async (req, res) => {
  const health = await audit.verifyIntegrity();
  res.json({ ledgerTotal: s(health.ledgerTotal), healthy: health.healthy, unbalancedTransactions: health.unbalancedTransactions });
}));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Ledger API listening on :${PORT}`));
}

module.exports = app;
