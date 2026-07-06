// invariants.js
// Pure functions — no database here. These encode the RULES of a ledger.
// Keeping them pure means we can unit-test the "money math" without Postgres.

const DEBIT = "debit";
const CREDIT = "credit";

/**
 * The double-entry rule:
 *   For ONE transaction, total debits MUST equal total credits.
 *   (Money never appears or vanishes — it only moves.)
 *
 * We also refuse:
 *   - a transaction with fewer than 2 entries (it wouldn't be "double")
 *   - any non-positive amount (amounts are always positive; direction carries the sign)
 *
 * Amounts are integers in the smallest currency unit (paise), never floats.
 */
function assertBalanced(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error("A transaction needs at least 2 entries (double-entry).");
  }

  let debits = 0n;
  let credits = 0n;

  for (const e of entries) {
    const amount = BigInt(e.amount);
    if (amount <= 0n) {
      throw new Error(`Amount must be a positive integer, got ${e.amount}`);
    }
    if (e.direction === DEBIT) debits += amount;
    else if (e.direction === CREDIT) credits += amount;
    else throw new Error(`Unknown direction: ${e.direction}`);
  }

  if (debits !== credits) {
    throw new Error(
      `Unbalanced transaction: debits=${debits} but credits=${credits}. They must be equal.`
    );
  }
}

/**
 * Balance = REPLAY of every entry for an account.
 *   credit increases the balance, debit decreases it.
 * We never store a "balance" column — we always derive it from the events.
 */
function computeBalance(entries) {
  let balance = 0n;
  for (const e of entries) {
    const amount = BigInt(e.amount);
    balance += e.direction === CREDIT ? amount : -amount;
  }
  return balance;
}

module.exports = { DEBIT, CREDIT, assertBalanced, computeBalance };
