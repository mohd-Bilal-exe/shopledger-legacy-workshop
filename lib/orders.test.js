const assert = require('node:assert/strict');
const { test } = require('node:test');
const orders = require('./orders');

function listedIds(rows, filters) {
  const db = { orders: rows.map(([id, date]) => ({ id, date })) };
  return orders.list(db, filters).map(({ id }) => id);
}

test('history sorts newest first across days, months, and years', () => {
  assert.deepEqual(listedIds([
    [1008, '15/03/2022'],
    [1001, '28/12/2021'],
    [1009, '15/03/2023'],
    [1004, '30/01/2022'],
    [1010, '16/03/2022']
  ]), [1009, 1010, 1008, 1004, 1001]);
});

test('date range includes both boundaries and excludes adjacent dates within a month', () => {
  assert.deepEqual(listedIds([
    [1, '09/03/2022'],
    [2, '10/03/2022'],
    [3, '12/03/2022'],
    [4, '15/03/2022'],
    [5, '16/03/2022']
  ], { from: '2022-03-10', to: '2022-03-15' }), [4, 3, 2]);
});

test('a cross-year date range returns only in-range orders and includes both boundaries', () => {
  assert.deepEqual(listedIds([
    [1000, '27/12/2021'],
    [1001, '28/12/2021'],
    [1002, '05/01/2022'],
    [1004, '30/01/2022'],
    [1005, '31/01/2022'],
    [1008, '29/03/2022']
  ], { from: '2021-12-28', to: '2022-01-30' }), [1004, 1002, 1001]);
});

test('history shows the most recently appended order first for the same date', () => {
  assert.deepEqual(listedIds([
    [1001, '01/02/2022'],
    [1002, '02/02/2022'],
    [1003, '01/02/2022']
  ]), [1002, 1003, 1001]);
});
