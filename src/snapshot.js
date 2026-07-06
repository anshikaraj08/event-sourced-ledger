// snapshot.js — Phase 4. An OPTIMIZATION, not a new source of truth.
// Replaying every event forever gets slow. So we periodically save a checkpoint
// (balance + the last event id it covers). Then balance = snapshot + only the
// events that happened AFTER it. Snapshots are disposable: if one is wrong or
// deleted, we can always rebuild it by replaying the events.

const { pool, withTransaction } = require("./db");

/**
 * Take a snapshot for an account: its balance up to the latest event, plus the
 * id of that latest event. Done in one transaction so no event can sneak in
 * between "what's the max id" and "what's the sum up to it".
 */
async function createSnapshot(accountId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(id), 0) AS last_entry_id,
              COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM entries WHERE account_id = $1`,
      [accountId]
    );
    const lastEntryId = rows[0].last_entry_id;
    const balance = rows[0].balance;
    const ins = await client.query(
      `INSERT INTO account_snapshots (account_id, balance, last_entry_id)
       VALUES ($1, $2, $3) RETURNING id, created_at`,
      [accountId, balance, lastEntryId]
    );
    return {
      snapshotId: ins.rows[0].id,
      balance: BigInt(balance),
      lastEntryId: BigInt(lastEntryId),
    };
  });
}

/**
 * Fast balance: start from the newest snapshot, then replay ONLY the events
 * after it. If there's no snapshot yet, fall back to a full replay.
 */
async function getBalanceFast(accountId) {
  const snap = await pool.query(
    `SELECT balance, last_entry_id FROM account_snapshots
     WHERE account_id = $1 ORDER BY last_entry_id DESC LIMIT 1`,
    [accountId]
  );

  if (snap.rows.length === 0) {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM entries WHERE account_id = $1`,
      [accountId]
    );
    return BigInt(rows[0].balance);
  }

  const base = BigInt(snap.rows[0].balance);
  const lastId = snap.rows[0].last_entry_id;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS delta
     FROM entries WHERE account_id = $1 AND id > $2`,
    [accountId, lastId]
  );
  return base + BigInt(rows[0].delta);
}

module.exports = { createSnapshot, getBalanceFast };
