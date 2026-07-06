// concurrency-test.js — needs the DB running. Proves Phase 2 guarantees.
const { createAccount, deposit, withdraw, getBalance } = require("../src/ledger");
const { pool } = require("../src/db");

async function main() {
  // ---- Test A: overdraft under concurrency ----
  const acc = await createAccount("RaceAccount");
  await deposit(acc.id, 500, { description: "seed" }); // can cover exactly 5 x 100

  // Fire 10 withdrawals of 100 AT THE SAME TIME.
  const attempts = Array.from({ length: 10 }, () =>
    withdraw(acc.id, 100).then(() => "ok").catch((e) => e.code || "err")
  );
  const results = await Promise.all(attempts);
  const ok = results.filter((r) => r === "ok").length;
  const rejected = results.filter((r) => r === "INSUFFICIENT_FUNDS").length;
  const bal = await getBalance(acc.id);

  console.log(`Test A (overdraft): ${ok} succeeded, ${rejected} rejected, final balance = ${bal}`);
  console.log(`  expected: 5 succeeded, 5 rejected, balance 0, never negative -> ${ok === 5 && rejected === 5 && bal === 0n ? "PASS" : "FAIL"}`);

  // ---- Test B: idempotency under concurrency ----
  const acc2 = await createAccount("IdemAccount");
  const key = "deposit-req-" + Date.now();
  // Same request sent 5 times concurrently (like a client retrying on timeout).
  const dep = Array.from({ length: 5 }, () =>
    deposit(acc2.id, 1000, { idempotencyKey: key }).then((r) => r.transactionId)
  );
  const ids = await Promise.all(dep);
  const uniqueTx = new Set(ids.map(String)).size;
  const bal2 = await getBalance(acc2.id);
  console.log(`\nTest B (idempotency): 5 identical requests -> ${uniqueTx} transaction(s), balance = ${bal2}`);
  console.log(`  expected: 1 transaction, balance 1000 (posted once) -> ${uniqueTx === 1 && bal2 === 1000n ? "PASS" : "FAIL"}`);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
