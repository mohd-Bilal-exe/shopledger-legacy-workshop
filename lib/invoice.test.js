const assert = require('node:assert/strict');
const { test } = require('node:test');
const invoice = require('./invoice');
const pricing = require('./pricing');
const reports = require('./reports');

function billedOrder(items, coupon = '') {
  const { subtotal, discount, tax, total } = pricing.computeTotals(items, coupon);
  return { id: 1001, date: '24/11/2026', items, coupon, subtotal, discount, tax, total };
}

test('invoice shows the GST breakdown and total charged at checkout', () => {
  const order = billedOrder([
    { id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 1 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 100, qty: 1 }
  ]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual({ tax: order.tax, total: order.total }, { tax: 17, total: 217 });
  assert.deepEqual(
    { tax: figures.tax, cgst: figures.cgst, sgst: figures.sgst, total: figures.total },
    { tax: 17, cgst: 8.5, sgst: 8.5, total: 217 }
  );
  assert.deepEqual(figures.rows.map(({ hsn, gstPercent, lineTax }) => (
    { hsn, gstPercent, lineTax }
  )), [
    { hsn: '1006', gstPercent: 5, lineTax: 5 },
    { hsn: '0405', gstPercent: 12, lineTax: 12 }
  ]);
  const html = invoice.render(order);
  assert.match(html, /Total GST\)<\/td><td class="r">₹17\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹217\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);

  const reconciliation = reports.getGstReconciliation({ orders: [order] });
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.equal(reconciliation.rows[0].matched, true);
});

test('invoice matches checkout at the default GST rate without a coupon', () => {
  const order = billedOrder([{ name: 'Tea', price: 100, qty: 2 }]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.total, 236);
  assert.equal(figures.total, 236);
  assert.equal(figures.tax, 36);
  assert.equal(figures.rows[0].gstPercent, 18);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice uses the checkout discount cap and calculates GST after discount', () => {
  const order = billedOrder([{ name: 'Tea', price: 2000, qty: 1 }], 'SAVE10');
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    { discount: order.discount, tax: order.tax, total: order.total },
    { discount: 150, tax: 333, total: 2183 }
  );
  assert.deepEqual(
    { discount: figures.discount, tax: figures.tax, total: figures.total },
    { discount: 150, tax: 333, total: 2183 }
  );
  assert.equal(figures.rows[0].lineTax, 333);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice handles decimal GST rates the same way as checkout', () => {
  const order = billedOrder([{ name: 'Rice', price: 100, qty: 1, gstRate: 0.05 }]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 5);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 5);
  assert.equal(figures.total, 105);
});

test('invoice adds rounded line taxes using checkout rounding', () => {
  const order = billedOrder([
    { name: 'First item', price: 0.03, qty: 1 },
    { name: 'Second item', price: 0.03, qty: 1 }
  ]);
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(figures.rows.map(({ lineTax }) => lineTax), [0.01, 0.01]);
  assert.equal(order.tax, 0.02);
  assert.equal(order.total, 0.08);
  assert.equal(figures.tax, 0.02);
  assert.equal(figures.cgst, 0.01);
  assert.equal(figures.sgst, 0.01);
  assert.equal(figures.total, 0.08);
});

test('invoice and reconciliation still flag a difference from the stored order', () => {
  const order = billedOrder([{ name: 'Tea', price: 100, qty: 1 }]);
  order.tax = 17;
  order.total = 117;

  assert.match(invoice.render(order), /recorded total \(₹117\.00\) by \+₹1\.00/);
  const reconciliation = reports.getGstReconciliation({ orders: [order] });
  assert.equal(reconciliation.mismatchCount, 1);
  assert.equal(reconciliation.totalDelta, 1);
  assert.equal(reconciliation.rows[0].matched, false);
});
