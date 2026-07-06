// db.js — one shared Postgres connection pool for the whole app.
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "ledger",
  password: process.env.PGPASSWORD || "ledger",
  database: process.env.PGDATABASE || "ledger",
});

// Helper: run a set of queries inside ONE database transaction (ACID).
// If anything throws, we ROLLBACK — so a half-written transaction can never exist.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
