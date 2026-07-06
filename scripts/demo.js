// demo.js — run this after `docker compose up -d` and loading the schema.
// It proves the whole idea end to end.
const {
  createAccount, deposit, transfer, getBalance, getStatement,
} = require("../src/ledger");
const { pool } = require("../src/db");

async function main() {
  const alice = await createAccount("Alice");
  const bob = await createAccount("Bob");

  await deposit(alice.id, 500, "Alice adds money");  // Alice +500
  await transfer(alice.id, bob.id, 100, "Alice pays Bob"); // Alice -100, Bob +100

  console.log("Alice balance:", (await getBalance(alice.id)).toString()); // 400
  console.log("Bob balance:  ", (await getBalance(bob.id)).toString());   // 100

  console.log("\nAlice statement (the audit trail — how her balance was built):");
  for (const row of await getStatement(alice.id)) {
    console.log(`  #${row.id} ${row.direction.padEnd(6)} ${row.amount}  (${row.description})`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
