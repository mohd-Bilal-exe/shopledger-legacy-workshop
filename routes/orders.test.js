const assert = require('node:assert/strict');
const { test } = require('node:test');
const inventory = require('../lib/inventory');
const store = require('../lib/store');
const router = require('./orders');

function post(path, body, params = {}) {
  const route = router.stack.find(({ route }) => route?.path === path && route.methods.post).route;
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
    }
  };
  route.stack[0].handle({ body, params }, response);
  return response;
}

function useInMemoryStore(t, product) {
  const db = { products: [product], orders: [], nextOrderId: 1001 };
  t.mock.method(store, 'read', () => db);
  const write = t.mock.method(store, 'write', () => {});
  return { db, write };
}

function stockLevels(product) {
  return {
    physical: product.stock,
    reserved: product.reserved,
    sellable: inventory.getSellableStock(product)
  };
}

function assertSaleAccepted(t, product, qty) {
  const { db, write } = useInMemoryStore(t, product);
  const before = stockLevels(product);
  assert.equal(before.sellable, qty);

  const result = post('/orders', { items: [{ id: product.id, qty }] });

  assert.equal(result.statusCode, 201);
  assert.equal(db.orders.length, 1);
  assert.equal(result.body.items[0].qty, qty);
  assert.deepEqual(stockLevels(product), {
    physical: before.reserved, reserved: before.reserved, sellable: 0
  });
  assert.equal(write.mock.callCount(), 1);
}

function assertSaleRejected(t, product, qty, sellable) {
  const { db, write } = useInMemoryStore(t, product);
  const before = stockLevels(product);
  assert.equal(before.sellable, sellable);

  const result = post('/orders', { items: [{ id: product.id, qty }] });

  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.body, {
    error: product.name + ' is out of stock (' + sellable + ' sellable available)'
  });
  assert.deepEqual(db.orders, []);
  assert.deepEqual(stockLevels(product), before);
  assert.equal(write.mock.callCount(), 0);
}

test('buying the last sellable unit of DRY-001 succeeds', (t) => {
  assertSaleAccepted(t, {
    id: 1, sku: 'DRY-001', name: 'A2 Gir Cow Ghee 500ml',
    price: 100, stock: 1, reserved: 0
  }, 1);
});

test('buying the last sellable unit of SPC-001 leaves the 3 reserved units intact', (t) => {
  assertSaleAccepted(t, {
    id: 2, sku: 'SPC-001', name: 'Byadgi Chilli Powder',
    price: 100, stock: 4, reserved: 3
  }, 1);
});

test('buying the exact remaining sellable quantity succeeds', (t) => {
  assertSaleAccepted(t, {
    id: 3, sku: 'TEST-003', name: 'Test item', price: 100, stock: 7, reserved: 2
  }, 5);
});

test('buying more than the sellable quantity is rejected without changing inventory', (t) => {
  assertSaleRejected(t, {
    id: 3, sku: 'TEST-003', name: 'Test item', price: 100, stock: 7, reserved: 2
  }, 6, 5);
});

test('cancelling a pending order restores physical and sellable stock while preserving reservations', (t) => {
  const product = {
    id: 3, sku: 'TEST-003', name: 'Test item', price: 100, stock: 7, reserved: 2
  };
  const { db, write } = useInMemoryStore(t, product);
  assert.deepEqual(stockLevels(product), { physical: 7, reserved: 2, sellable: 5 });

  const placed = post('/orders', { status: 'pending', items: [{ id: product.id, qty: 2 }] });
  assert.equal(placed.statusCode, 201);
  assert.equal(placed.body.status, 'pending');
  assert.deepEqual(stockLevels(product), { physical: 5, reserved: 2, sellable: 3 });

  const cancelled = post('/orders/:id/cancel', { reason: 'Customer request' }, {
    id: String(placed.body.id)
  });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(db.orders[0].status, 'cancelled');
  assert.deepEqual(stockLevels(product), { physical: 7, reserved: 2, sellable: 5 });
  assert.equal(write.mock.callCount(), 2);
});

test('buying more than the sellable quantity across duplicate SKU lines is rejected', (t) => {
  const product = {
    id: 3, sku: 'TEST-003', name: 'Test item', price: 100, stock: 5, reserved: 2
  };
  const { db, write } = useInMemoryStore(t, product);

  const result = post('/orders', { items: [{ id: 3, qty: 2 }, { id: '3', qty: 2 }] });

  assert.equal(result.statusCode, 409);
  assert.deepEqual(db.orders, []);
  assert.deepEqual(stockLevels(product), { physical: 5, reserved: 2, sellable: 3 });
  assert.equal(write.mock.callCount(), 0);
});

test('repeated cancellation restores stock only once', (t) => {
  const product = {
    id: 3, sku: 'TEST-003', name: 'Test item', price: 100, stock: 7, reserved: 2
  };
  const { write } = useInMemoryStore(t, product);
  const placed = post('/orders', { status: 'pending', items: [{ id: product.id, qty: 2 }] });
  assert.equal(placed.statusCode, 201);
  const params = { id: String(placed.body.id) };

  const first = post('/orders/:id/cancel', {}, params);
  const afterFirst = stockLevels(product);
  const second = post('/orders/:id/cancel', {}, params);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 400);
  assert.match(second.body.error, /already cancelled/);
  assert.deepEqual(stockLevels(product), afterFirst);
  assert.deepEqual(afterFirst, { physical: 7, reserved: 2, sellable: 5 });
  assert.equal(write.mock.callCount(), 2);
});

test('cancelling a legacy reservation still releases reserved units without adding physical stock', (t) => {
  const product = { id: 3, sku: 'TEST-003', stock: 7, reserved: 2 };
  const { db } = useInMemoryStore(t, product);
  db.orders.push({ id: 1007, status: 'pending', items: [{ productId: 3, qty: 1 }] });

  const result = post('/orders/:id/cancel', {}, { id: '1007' });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(stockLevels(product), { physical: 7, reserved: 1, sellable: 6 });
});
