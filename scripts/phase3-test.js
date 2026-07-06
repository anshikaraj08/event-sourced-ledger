// phase3-test.js — point-in-time (by time AND by event id) + audit + integrity.
const { createAccount, deposit, withdraw, getBalance } = require("../src/ledger");
const {
  getBalanceAsOf, getBalanceAsOfEntry, getStatementWithRunningBalance,
  getTransaction, verifyIntegrity,
} = require("../src/audit");
const { pool } = require("../src/db");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const acc = await createAccount("TimeTraveller");

  const d = await deposit(acc.id, 1000, { description: "salary" });
  await sleep(20);
  const t1 = new Date();              // a moment AFTER the deposit, BEFORE the withdraw
  await sleep(20);
  await withdraw(acc.id, 300, { description: "rent" });
  await sleep(20);
  const t2 = new Date();              // a moment AFTER the withdraw

  const asOf1 = await getBalanceAsOf(acc.id, t1);   // expect 1000
  const asOf2 = await getBalanceAsOf(acc.id, t2);   // expect 700
  const now = await getBalance(acc.id);             // expect 700

  console.log("Point-in-time by TIME:");
  console.log(`  as of t1 = ${asOf1}  (expect 1000) -> ${asOf1 === 1000n ? "PASS" : "FAIL"}`);
  console.log(`  as of t2 = ${asOf2}  (expect 700)  -> ${asOf2 === 700n ? "PASS" : "FAIL"}`);
  console.log(`  current  = ${now}  (expect 700)  -> ${now === 700n ? "PASS" : "FAIL"}`);

  // Exact replay using the deposit transaction's own event id (first entry).
  const depAudit = await getTransaction(d.transactionId);
  const depEntryId = depAudit.entries[0].id;         // the credit-to-account leg id
  const exact = await getBalanceAsOfEntry(acc.id, depEntryId);  // expect 1000
  console.log(`\nPoint-in-time by EVENT ID (id<=${depEntryId}) = ${exact} (expect 1000) -> ${exact === 1000n ? "PASS" : "FAIL"}`);

  console.log("\nPassbook (running balance):");
  for (const r of await getStatementWithRunningBalance(acc.id)) {
    console.log(`  #${r.id} ${r.direction.padEnd(6)} ${r.amount}  bal=${r.running_balance}  (${r.description})`);
  }

  console.log(`\nAudit of transaction #${d.transactionId}: ${depAudit.entries.length} legs, balanced=${depAudit.balanced} -> ${depAudit.balanced ? "PASS" : "FAIL"}`);

  const health = await verifyIntegrity();
  console.log(`Ledger integrity: total=${health.ledgerTotal}, healthy=${health.healthy} -> ${health.healthy ? "PASS" : "FAIL"}`);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
