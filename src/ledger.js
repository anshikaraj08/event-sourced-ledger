// ledger.js — Phase 2 engine.
// New powers: idempotency keys, row-level locking, and overdraft protection.
// The append-only + double-entry core from Phase 1 is unchanged.

const { pool, withTransaction } = require("./db");
const { DEBIT, CREDIT, assertBalanced, computeBalance } = require("./invariants");

const EXTERNAL_ACCOUNT_ID = 1;

async function createAccount(name, currency = "INR") {
  const { rows } = await pool.query(
    `INSERT INTO accounts (name, type, currency) VALUES ($1, 'user', $2) RETURNING *`,
    [name, currency]
  );
  return rows[0];
}

async function computeBalanceTx(client, accountId) {
  const { rows } = await client.query(
    `SELECT COALESCE(
        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0
     ) AS balance
     FROM entries WHERE account_id = $1`,
    [accountId]
  );
  return BigInt(rows[0].balance);
}

async function recordTransaction({
  description,
  idempotencyKey = null,
  entries,
  lockAccountIds = [],
  preventOverdraftFor = [],
}) {
  assertBalanced(entries);

  return withTransaction(async (client) => {
    if (idempotencyKey) {
      const seen = await client.query(
        `SELECT id, created_at FROM transactions WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      if (seen.rows.length) {
        return { transactionId: seen.rows[0].id, createdAt: seen.rows[0].created_at, idempotentReplay: true };
      }
    }

    const toLock = [...new Set(lockAccountIds.map(Number))].sort((a, b) => a - b);
    for (const id of toLock) {
      await client.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [id]);
    }

    for (const id of preventOverdraftFor) {
      const current = await computeBalanceTx(client, id);
      let delta = 0n;
      for (const e of entries) {
        if (Number(e.accountId) === Number(id)) {
          delta += e.direction === CREDIT ? BigInt(e.amount) : -BigInt(e.amount);
        }
      }
      if (current + delta < 0n) {
        const err = new Error(`INSUFFICIENT_FUNDS: account ${id} has ${current}, cannot apply ${delta}`);
        err.code = "INSUFFICIENT_FUNDS";
        throw err;
      }
    }

    const txRes = await client.query(
      `INSERT INTO transactions (description, idempotency_key)
       VALUES ($1, $2)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, created_at`,
      [description, idempotencyKey]
    );
    if (txRes.rows.length === 0) {
      const existing = await client.query(
        `SELECT id, created_at FROM transactions WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      return { transactionId: existing.rows[0].id, createdAt: existing.rows[0].created_at, idempotentReplay: true };
    }
    const txId = txRes.rows[0].id;

    for (const e of entries) {
      await client.query(
        `INSERT INTO entries (transaction_id, account_id, direction, amount)
         VALUES ($1, $2, $3, $4)`,
        [txId, e.accountId, e.direction, e.amount]
      );
    }
    return { transactionId: txId, createdAt: txRes.rows[0].created_at };
  });
}

async function getBalance(accountId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0
     ) AS balance
     FROM entries WHERE account_id = $1`,
    [accountId]
  );
  return BigInt(rows[0].balance);
}

async function deposit(accountId, amount, opts = {}) {
  return recordTransaction({
    description: opts.description || "deposit",
    idempotencyKey: opts.idempotencyKey || null,
    entries: [
      { accountId, direction: CREDIT, amount },
      { accountId: EXTERNAL_ACCOUNT_ID, direction: DEBIT, amount },
    ],
  });
}

async function withdraw(accountId, amount, opts = {}) {
  return recordTransaction({
    description: opts.description || "withdraw",
    idempotencyKey: opts.idempotencyKey || null,
    entries: [
      { accountId, direction: DEBIT, amount },
      { accountId: EXTERNAL_ACCOUNT_ID, direction: CREDIT, amount },
    ],
    lockAccountIds: [accountId],
    preventOverdraftFor: [accountId],
  });
}

async function transfer(fromId, toId, amount, opts = {}) {
  return recordTransaction({
    description: opts.description || "transfer",
    idempotencyKey: opts.idempotencyKey || null,
    entries: [
      { accountId: fromId, direction: DEBIT, amount },
      { accountId: toId, direction: CREDIT, amount },
    ],
    lockAccountIds: [fromId, toId],
    preventOverdraftFor: [fromId],
  });
}

async function getStatement(accountId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.direction, e.amount, e.created_at, t.description
     FROM entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1 ORDER BY e.id`,
    [accountId]
  );
  return rows;
}

module.exports = {
  createAccount, recordTransaction, getBalance,
  deposit, withdraw, transfer, getStatement, computeBalance,
};
