// audit.js — Phase 3. The PAYOFF of event sourcing.
// Because we never delete or update entries, we can answer questions about the
// PAST for free — just by filtering the same events by time.

const { pool } = require("./db");

/**
 * Point-in-time balance: "what was this account's balance as of <asOf>?"
 * Same SUM as a normal balance, but only over entries that existed by then.
 * Note: all entries of one transaction share the same created_at (Postgres now()
 * is the transaction-start time), so a point-in-time cut never splits a
 * transaction in half — you always see whole, balanced transactions.
 */
async function getBalanceAsOf(accountId, asOf) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0
     ) AS balance
     FROM entries
     WHERE account_id = $1 AND created_at <= $2`,
    [accountId, asOf]
  );
  return BigInt(rows[0].balance);
}

/**
 * Statement WITH a running balance after each line — like a real passbook.
 * The window function recomputes the balance step by step from the events.
 */
async function getStatementWithRunningBalance(accountId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.direction, e.amount, e.created_at, t.description,
        SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END)
          OVER (ORDER BY e.id) AS running_balance
     FROM entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1
     ORDER BY e.id`,
    [accountId]
  );
  return rows;
}

/**
 * Audit one transaction: return it with BOTH legs, and confirm it balances.
 * This is what an auditor drills into: "show me every line of transaction 42."
 */
async function getTransaction(txId) {
  const txRes = await pool.query(`SELECT * FROM transactions WHERE id = $1`, [txId]);
  if (!txRes.rows.length) return null;
  const entriesRes = await pool.query(
    `SELECT id, account_id, direction, amount FROM entries
     WHERE transaction_id = $1 ORDER BY id`,
    [txId]
  );
  let debits = 0n, credits = 0n;
  for (const e of entriesRes.rows) {
    if (e.direction === "credit") credits += BigInt(e.amount);
    else debits += BigInt(e.amount);
  }
  return { transaction: txRes.rows[0], entries: entriesRes.rows, balanced: debits === credits };
}

/**
 * Whole-ledger integrity check — the global safety net.
 *   (1) every credit has a matching debit, so ALL entries must sum to 0.
 *   (2) each individual transaction must also sum to 0.
 * If either is violated, there is a bug. This is a huge trust signal.
 */
async function verifyIntegrity() {
  const totalRes = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS total
     FROM entries`
  );
  const ledgerTotal = BigInt(totalRes.rows[0].total);

  const badRes = await pool.query(
    `SELECT transaction_id,
        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS net
     FROM entries
     GROUP BY transaction_id
     HAVING SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) <> 0`
  );

  return {
    ledgerTotal,
    healthy: ledgerTotal === 0n && badRes.rows.length === 0,
    unbalancedTransactions: badRes.rows,
  };
}


/**
 * EXACT point-in-time using the event sequence id instead of wall-clock time.
 * Two events can share the same millisecond, so for precise "replay up to event N"
 * the monotonic entry id is the reliable ordering — not the timestamp.
 */
async function getBalanceAsOfEntry(accountId, entryId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0
     ) AS balance
     FROM entries
     WHERE account_id = $1 AND id <= $2`,
    [accountId, entryId]
  );
  return BigInt(rows[0].balance);
}

module.exports = {
  getBalanceAsOf, getBalanceAsOfEntry, getStatementWithRunningBalance, getTransaction, verifyIntegrity,
};
