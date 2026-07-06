// test-invariants.js — runs WITHOUT a database. Fast confidence check.
const assert = require("assert");
const { DEBIT, CREDIT, assertBalanced, computeBalance } = require("../src/invariants");

// balanced transactions pass
assertBalanced([
  { direction: CREDIT, amount: 500 },
  { direction: DEBIT, amount: 500 },
]);

// unbalanced throws
assert.throws(() =>
  assertBalanced([
    { direction: CREDIT, amount: 100 },
    { direction: DEBIT, amount: 99 },
  ])
);

// non-positive amount throws
assert.throws(() =>
  assertBalanced([
    { direction: CREDIT, amount: 0 },
    { direction: DEBIT, amount: 0 },
  ])
);

// balance replay: +500 then -100 => 400
const bal = computeBalance([
  { direction: CREDIT, amount: 500 },
  { direction: DEBIT, amount: 100 },
]);
assert.strictEqual(bal, 400n);

console.log("All invariant tests passed ✔");
