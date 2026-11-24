const assert = require('node:assert/strict');
const { test } = require('node:test');
const ledger = require('./ledger');

function meeraLedger() {
  return {
    customers: [{ id: 1, name: 'Meera Joshi', totalBilled: 2432.01, totalSettled: 1200 }],
    settlements: [],
    nextSettlementId: 501
  };
}

test('recording the string amount 500 updates Meera Joshi’s ledger numerically', () => {
  const db = meeraLedger();
  const [before] = ledger.listCustomers(db);
  assert.equal(before.totalSettled, 1200);
  assert.equal(before.balance, 1232.01);

  const result = ledger.recordSettlement(db, '1', '500', 'upi', 'Counter payment');
  assert.equal(result.ok, true);
  assert.equal(result.settlement.amount, 500);
  assert.equal(result.customer.totalSettled, 1700);
  assert.equal(result.customer.balance, 732.01);

  const [after] = ledger.listCustomers(db);
  assert.equal(after.totalSettled, 1700);
  assert.equal(after.balance, 732.01);
});

test('consecutive string settlements add numerically to Total Settled', () => {
  const db = meeraLedger();

  const first = ledger.recordSettlement(db, '1', '500');
  assert.equal(first.ok, true);
  assert.equal(first.customer.totalSettled, 1700);

  const second = ledger.recordSettlement(db, '1', '25');
  assert.equal(second.ok, true);
  assert.equal(second.customer.totalSettled, 1725);
  assert.equal(second.customer.balance, 707.01);
  assert.deepEqual(db.settlements.map(({ id, amount }) => ({ id, amount })), [
    { id: 502, amount: 25 },
    { id: 501, amount: 500 }
  ]);
});

test('fractional settlements keep the settled total, amount, and balance at currency precision', () => {
  const db = meeraLedger();
  db.customers[0].totalSettled = 0.1;

  assert.equal(ledger.recordSettlement(db, '1', 0.2).ok, true);
  assert.equal(db.customers[0].totalSettled, 0.3);
  const result = ledger.recordSettlement(db, '1', '0.105');

  assert.equal(result.ok, true);
  assert.equal(result.settlement.amount, 0.11);
  assert.equal(result.customer.totalSettled, 0.41);
  assert.equal(result.customer.balance, 2431.60);
});

test('consecutive numeric settlements add to a numeric Total Settled', () => {
  const db = meeraLedger();

  assert.equal(ledger.recordSettlement(db, '1', 500).ok, true);
  assert.equal(ledger.recordSettlement(db, '1', 25).ok, true);

  const [customer] = ledger.listCustomers(db);
  assert.equal(customer.totalSettled, 1725);
  assert.equal(customer.balance, 707.01);
});
