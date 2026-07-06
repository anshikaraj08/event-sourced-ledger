// phase4-test.js — proves snapshot balance == full-replay balance, and that a
// snapshot only needs to replay the events that came after it.
const { createAccount, deposit, withdraw, getBalance } = require("../src/ledger");
const { createSnapshot, getBalanceFast } = require("../src/snapshot");
const { pool } = require("../src/db");

async function main() {
  const acc = await createAccount("SnapAccount");
  await deposit(acc.id, 1000);
  await withdraw(acc.id, 200);          // balance now 800

  const snap = await createSnapshot(acc.id);
  console.log(`Snapshot taken: balance=${snap.balance}, covers up to entry id ${snap.lastEntryId}`);

  // more activity happens AFTER the snapshot
  await deposit(acc.id, 500);           // balance now 1300
  await withdraw(acc.id, 100);          // balance now 1200

  const fast = await getBalanceFast(acc.id);   // snapshot 800 + delta (500-100)=400
  const full = await getBalance(acc.id);       // full replay from scratch
  console.log(`Fast balance (snapshot + delta) = ${fast}`);
  console.log(`Full replay balance             = ${full}`);
  console.log(`Match & correct (expect 1200)   -> ${fast === full && fast === 1200n ? "PASS" : "FAIL"}`);

  // second snapshot should now cover everything; delta replay becomes empty
  const snap2 = await createSnapshot(acc.id);
  const fast2 = await getBalanceFast(acc.id);
  console.log(`After 2nd snapshot: balance=${snap2.balance}, fast=${fast2} -> ${fast2 === 1200n ? "PASS" : "FAIL"}`);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
