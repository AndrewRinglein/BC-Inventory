// BC Inventory — logic and store tests. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

// the demo store keeps its data in localStorage
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { poTotals, nextPoNum, buildDrafts, lineName, fmtMoney } = await import('../src/lib/logic/po.js');
const { canTransition, transition, countByProduct, closedAt } = await import('../src/lib/logic/boxes.js');
const { parseScan, gameForForm, resolveReceiveScan, resolveOpenScan, normCode } = await import('../src/lib/logic/scan.js');
const { checkCount, ticketsIn, gameSnapshot, gameOf, atLocalNoonIso, localYmd } = await import('../src/lib/logic/bc.js');
const { needsCost, needsTickets, needsForm, needsVendor, needsAnyUpdate } = await import('../src/lib/logic/setup.js');
const { buildReport, monthBounds, inPeriod } = await import('../src/lib/logic/report.js');
const { buildDeliveredEmail, buildShortageEmail } = await import('../src/lib/logic/emails.js');
const { receivedLine, missingLine } = await import('../src/lib/logic/receiving.js');
const { CATALOG } = await import('../src/data/catalog.js');
const { DemoStore } = await import('../src/lib/store/demoStore.js');

const G = (over = {}) => ({
  id: 'G1', name: '4 Corner - $500', form_number: 'CR3', vendor_id: 'lib', cost: 0, tickets: 945,
  price_per_ticket: 1, ideal_gross_receipts: 945, ideal_cash_prize: 665, ideal_profit: 280,
  non_cash_prize_value: 0, net_profit: 280, progressive_amount: 0, active: true, ...over,
});
const G2 = G({ id: 'G2', name: 'Jackpot Derby', form_number: '52266', vendor_id: 'clk', cost: 470, tickets: 1806,
  ideal_gross_receipts: 1806, ideal_cash_prize: 1400, ideal_profit: 406, net_profit: 406, progressive_amount: 300 });
const vendors = [{ id: 'lib', name: 'Liberty Gaming', email: 'l@x.com', tax_rate: 0 }, { id: 'clk', name: 'Clarko', email: 'c@x.com', tax_rate: 0 }];

// ---------------------------------------------------------------- catalog seed
test('the seed has all 38 games from the sheet, one per form number', () => {
  assert.equal(CATALOG.products.length, 38);
  const forms = CATALOG.products.map((p) => normCode(p.form));
  assert.equal(new Set(forms).size, 38);
});
test('ticket count equals ideal gross receipts ($1 per ticket)', () => {
  for (const p of CATALOG.products) assert.equal(p.tickets, p.igr, p.name);
});
test('"Libery Gaming" is merged into Liberty Gaming', () => {
  assert.equal(CATALOG.vendors.length, 4);
  assert.equal(CATALOG.products.filter((p) => p.vendor === 'lib').length, 19);
});
test('the colour-split progressive is stored as its total with the breakdown kept', () => {
  const f = CATALOG.products.find((p) => p.name === 'Freedom Flashboard');
  assert.equal(f.prog, 350);
  assert.equal(f.progNote, 'Red: 200, White: 100, Blue: 50');
});
test('numeric form numbers are stored as text', () => {
  assert.equal(CATALOG.products.find((p) => p.name === 'Jackpot Derby').form, '52266');
});

// ---------------------------------------------------------------- scanning
test('a scan splits into form number and serial on the last space', () => {
  assert.deepEqual(parseScan('CR3 0012345'), { form: 'CR3', serial: '0012345' });
  assert.deepEqual(parseScan('  bp52634   991 '), { form: 'BP52634', serial: '991' });
  assert.deepEqual(parseScan('52266\t000777'), { form: '52266', serial: '000777' });
});
test('a scan with no space is not a box barcode', () => {
  assert.equal(parseScan('CR30012345'), null);
  assert.equal(parseScan(''), null);
});
test('serials keep their leading zeros', () => {
  assert.equal(parseScan('CR3 000001').serial, '000001');
});
test('serials match ignoring case, like the Bingo Vision verifier', () => {
  assert.equal(parseScan('bp52634 pack-a1').serial, 'PACK-A1');
  const boxes = [{ id: 'b', product_id: 'G1', serial: 'pack-a1', state: 'in_inventory' }];
  assert.equal(resolveOpenScan('CR3 PACK-A1', { products: [G()], boxes }).ok, true);
  assert.equal(resolveReceiveScan('CR3 Pack-A1', { products: [G()], boxes }).reason, 'duplicate');
});
test('form numbers match case-insensitively, then by the alternate code', () => {
  const ps = [G(), G2, G({ id: 'G3', form_number: 'XCR2', vendor_sku: 'ALT-9' })];
  assert.equal(gameForForm(ps, 'cr3').id, 'G1');
  assert.equal(gameForForm(ps, '52266').id, 'G2');
  assert.equal(gameForForm(ps, 'alt-9').id, 'G3');
  assert.equal(gameForForm(ps, 'NOPE'), null);
});

test('receive: an unknown form number asks for the game to be added', () => {
  const r = resolveReceiveScan('ZZ9 1', { products: [G()], boxes: [] });
  assert.equal(r.reason, 'unknown_game');
  assert.equal(r.form, 'ZZ9');
  assert.equal(r.serial, '1');
});
test('receive: a known game with a new serial is received', () => {
  const r = resolveReceiveScan('CR3 100', { products: [G()], boxes: [] });
  assert.equal(r.ok, true);
  assert.equal(r.product.id, 'G1');
  assert.equal(r.placeholder, null);
});
test('receive: the same game + serial twice is a duplicate', () => {
  const boxes = [{ id: 'b', product_id: 'G1', serial: '100', state: 'in_inventory' }];
  assert.equal(resolveReceiveScan('CR3 100', { products: [G()], boxes }).reason, 'duplicate');
});
test('receive: the same serial on a DIFFERENT game is not a duplicate', () => {
  const boxes = [{ id: 'b', product_id: 'G2', serial: '100', state: 'in_inventory' }];
  assert.equal(resolveReceiveScan('CR3 100', { products: [G(), G2], boxes }).ok, true);
});
test('receive: with a PO, the scan claims that PO\'s placeholder for the game', () => {
  const boxes = [
    { id: 'p1', product_id: 'G1', po_id: 'po1', state: 'on_order', serial: '' },
    { id: 'p2', product_id: 'G1', po_id: 'po2', state: 'on_order', serial: '' },
  ];
  assert.equal(resolveReceiveScan('CR3 5', { products: [G()], boxes, poId: 'po2' }).placeholder.id, 'p2');
  assert.equal(resolveReceiveScan('CR3 5', { products: [G()], boxes, poId: null }).placeholder, null);
});

test('open: a sealed box opens', () => {
  const boxes = [{ id: 'b', product_id: 'G1', serial: '100', state: 'in_inventory' }];
  const r = resolveOpenScan('CR3 100', { products: [G()], boxes });
  assert.equal(r.ok, true);
  assert.equal(r.box.id, 'b');
});
test('open: an open box is not opened twice', () => {
  const boxes = [{ id: 'b', product_id: 'G1', serial: '100', state: 'opened', opened_at: new Date().toISOString() }];
  assert.equal(resolveOpenScan('CR3 100', { products: [G()], boxes }).reason, 'already_open');
});
test('open: a closed box cannot be reopened by scanning', () => {
  for (const state of ['sold_out', 'closed_unsold']) {
    const boxes = [{ id: 'b', product_id: 'G1', serial: '100', state }];
    assert.equal(resolveOpenScan('CR3 100', { products: [G()], boxes }).reason, 'closed');
  }
});
test('open: a box never received is offered receive-and-open', () => {
  const r = resolveOpenScan('CR3 999', { products: [G()], boxes: [] });
  assert.equal(r.reason, 'not_received');
  assert.equal(r.serial, '999');
});

// ---------------------------------------------------------------- box states
test('the floor lifecycle passes; illegal jumps throw', () => {
  let b = { state: 'on_order' };
  b = transition(b, 'in_inventory'); assert.ok(b.received_at);
  b = transition(b, 'opened'); assert.ok(b.opened_at);
  const sold = transition(b, 'sold_out'); assert.ok(sold.sold_out_at);
  const unsold = transition(b, 'closed_unsold'); assert.ok(unsold.closed_at);
  assert.throws(() => transition({ state: 'in_inventory' }, 'sold_out'));
  assert.throws(() => transition({ state: 'sold_out' }, 'closed_unsold'));
  assert.throws(() => transition({ state: 'on_order' }, 'opened'));
});
test('undo paths go one step back and clear the stamp they undo', () => {
  assert.ok(canTransition('opened', 'in_inventory'));
  assert.ok(canTransition('sold_out', 'opened'));
  assert.ok(canTransition('closed_unsold', 'opened'));
  assert.ok(canTransition('in_inventory', 'on_order'));
  const back = transition({ state: 'sold_out', sold_out_at: 'x', opened_at: 'y' }, 'opened');
  assert.equal(back.sold_out_at, null);
  assert.equal(back.opened_at, 'y');
});
test('closedAt reads the right stamp for each kind of close', () => {
  assert.equal(closedAt({ state: 'sold_out', sold_out_at: 'a' }), 'a');
  assert.equal(closedAt({ state: 'closed_unsold', closed_at: 'b' }), 'b');
  assert.equal(closedAt({ state: 'opened' }), null);
});
test('countByProduct tallies every state', () => {
  const c = countByProduct([
    { product_id: 'G1', state: 'in_inventory' }, { product_id: 'G1', state: 'opened' },
    { product_id: 'G1', state: 'sold_out' }, { product_id: 'G1', state: 'closed_unsold' },
    { product_id: 'G1', state: 'on_order' },
  ]).G1;
  assert.deepEqual([c.inv, c.open, c.sold, c.closed, c.onorder, c.owned], [1, 1, 1, 1, 1, 2]);
});

// ---------------------------------------------------------------- tickets
test('a remainder must be a whole number no bigger than the box', () => {
  const box = { product_id: 'G1' };
  assert.equal(checkCount('125', box, [G()]), 125);
  assert.equal(checkCount(0, box, [G()]), 0);
  assert.throws(() => checkCount(946, box, [G()]), /945/);
  assert.throws(() => checkCount(-1, box, [G()]));
  assert.throws(() => checkCount(1.5, box, [G()]));
});
test('tickets in a box come from the snapshot taken when it was received', () => {
  const snap = gameSnapshot(G());
  const edited = G({ tickets: 2000, ideal_gross_receipts: 2000 });
  assert.equal(ticketsIn({ game_snapshot: snap }, edited), 945);
  assert.equal(ticketsIn({}, edited), 2000);
  assert.equal(gameOf({ game_snapshot: snap }, edited).ideal_gross_receipts, 945);
});
test('a past date is pinned to local noon; today is now', () => {
  const past = new Date(atLocalNoonIso('2026-10-01'));
  assert.equal(past.getHours(), 12);
  assert.equal(localYmd(past), '2026-10-01');
  const t = new Date(atLocalNoonIso(localYmd()));
  assert.ok(Math.abs(t - Date.now()) < 5000);
});

// ---------------------------------------------------------------- catalog gaps
test('a blank cost asks for an update but does not block ordering', () => {
  assert.ok(needsCost(G()));
  assert.ok(needsAnyUpdate(G()));
  assert.ok(!needsVendor(G()));
  assert.ok(!needsCost(G2));
});
test('a game with no form number or ticket count is flagged', () => {
  assert.ok(needsForm(G({ form_number: '' })));
  assert.ok(needsTickets(G({ tickets: null })));
});

// ---------------------------------------------------------------- purchase orders
test('PO numbers carry BC, the date and a distributor code, and increment', () => {
  const d = new Date(2026, 9, 22);
  let r = nextPoNum({}, 'bc', 'lib', d);
  assert.equal(r.num, 'BC-26-10-22-LIB-001');
  r = nextPoNum(r.seq, 'bc', 'lib', d);
  assert.equal(r.num, 'BC-26-10-22-LIB-002');
  assert.equal(nextPoNum(r.seq, 'bc', 'clk', d).num, 'BC-26-10-22-CLK-001');
});
test('a PO line names the game, its form number and ticket count', () => {
  assert.equal(lineName(G()), '4 Corner - $500 (form CR3, 945/$1)');
});
test('drafts group by distributor; a blank cost goes out as "?"', () => {
  const drafts = buildDrafts({ G1: 2, G2: 1 }, [G(), G2], vendors);
  assert.equal(drafts.length, 2);
  const lib = drafts.find((d) => d.vendor_id === 'lib');
  assert.equal(lib.lines[0].price_tbd, true);
  assert.equal(lib.partial, true);
  const clk = drafts.find((d) => d.vendor_id === 'clk');
  assert.equal(clk.total, 470);
  assert.equal(clk.lines[0].split_boxes, 1);
  assert.equal(clk.lines[0].packing_each, 0);
});
test('totals count priced lines only and tax at the distributor rate', () => {
  const t = poTotals([{ qty: 2, cost: 100 }, { qty: 1, cost: 0, price_tbd: true }], 0.1);
  assert.equal(t.subtotal, 200);
  assert.equal(t.tax, 20);
  assert.equal(t.tbd, 1);
});
test('money formats even when Postgres sends a string', () => {
  assert.equal(fmtMoney('1806'), '$1,806.00');
});
test('the delivered email asks accounting to pay for what arrived, not the PO', () => {
  const po = { num: 'BC-1', total: 940 };
  const line = { name_snapshot: 'Jackpot Derby', qty: 2, cost: 470, packing_each: 0, split_boxes: 1 };
  const got = [receivedLine(line, G2, 1, 470)];
  const miss = [missingLine(line, G2, 1, 470)];
  const e = buildDeliveredEmail(po, vendors[1], 'BC', 'INV-1', got, miss, {}, '');
  assert.equal(e.amount, 470);
  assert.match(e.subject, /short delivery/);
  assert.match(buildShortageEmail(po, vendors[1], 'BC', miss).body, /\$470\.00/);
});

// ---------------------------------------------------------------- the report
const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const reportBoxes = [
  { id: 'a', product_id: 'G1', serial: '1', state: 'sold_out', opened_at: at(2026, 10, 1), sold_out_at: at(2026, 10, 2), shipment_id: 's1', cost: 0 },
  { id: 'b', product_id: 'G2', serial: '2', state: 'closed_unsold', opened_at: at(2026, 10, 2), closed_at: at(2026, 10, 2, 23), tickets_remaining: 88, cost: 470 },
  { id: 'c', product_id: 'G2', serial: '3', state: 'opened', opened_at: at(2026, 10, 2), tickets_remaining: 125 },
  { id: 'd', product_id: 'G1', serial: '4', state: 'sold_out', opened_at: at(2026, 9, 28), sold_out_at: at(2026, 10, 3), cost: 0 },
  { id: 'e', product_id: 'G1', serial: '5', state: 'in_inventory' },
];
const rep = (from, to) => buildReport({
  boxes: reportBoxes, products: [G(), G2], vendors,
  shipments: [{ id: 's1', invoice_no: '55102', received_on: '2026-09-30' }], period: { from, to },
});
test('closed in a day lists every sold-out and closed-unsold box, not open ones', () => {
  const r = rep('2026-10-02', '2026-10-02');
  assert.deepEqual(r.closed.map((x) => x.b.id).sort(), ['a', 'b']);
  assert.equal(r.summary.soldOut, 1);
  assert.equal(r.summary.closedUnsold, 1);
});
test('a box opened last month and sold out this month is in this month\'s closed list', () => {
  const r = rep(...Object.values(monthBounds('2026-10')));
  assert.ok(r.closed.some((x) => x.b.id === 'd'));
  assert.ok(!r.opened.some((x) => x.b.id === 'd'));
});
test('opened in period lists boxes by the day they were opened', () => {
  assert.deepEqual(rep('2026-10-02', '2026-10-02').opened.map((x) => x.b.id).sort(), ['b', 'c']);
});
test('still open counts boxes open at the end of the last day', () => {
  assert.equal(rep('2026-10-02', '2026-10-02').summary.stillOpen, 2);   // c, and d (closes the 3rd)
  assert.equal(rep('2026-10-03', '2026-10-03').summary.stillOpen, 1);   // c
});
test('a row carries the receipt\'s invoice, the open/close times and the game attributes', () => {
  const row = rep('2026-10-02', '2026-10-02').closed.find((x) => x.b.id === 'a');
  assert.equal(row.invoiceNo, '55102');
  assert.equal(row.invoiceDate, '2026-09-30');
  assert.equal(row.status, 'Sold out');
  assert.equal(row.g.form_number, 'CR3');
  assert.equal(row.vendor, 'Liberty Gaming');
  assert.ok(row.b.opened_at && row.closedAt);
});
test('a closed-unsold row shows its tickets left', () => {
  assert.equal(rep('2026-10-02', '2026-10-02').closed.find((x) => x.b.id === 'b').left, 88);
});
test('summary money counts sold-out boxes only', () => {
  const s = rep('2026-10-02', '2026-10-02').summary;
  assert.equal(s.idealGross, 945);
  assert.equal(s.idealCashPrize, 665);
  assert.equal(s.costClosed, 470);
});
test('period edges are local calendar days', () => {
  assert.ok(inPeriod(at(2026, 10, 2, 23), { from: '2026-10-02', to: '2026-10-02' }));
  assert.ok(!inPeriod(at(2026, 10, 3, 0), { from: '2026-10-02', to: '2026-10-02' }));
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
});

// ---------------------------------------------------------------- the store, end to end
async function freshStore() {
  mem.clear();
  const s = new DemoStore(false);
  await s.init();
  return s;
}
const prod = async (s, form) => (await s.getProducts()).find((p) => p.form_number === form);

test('sending a PO puts placeholder boxes on order', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const drafts = buildDrafts({ [g.id]: 3 }, await s.getProducts(), await s.getVendors());
  const [po] = await s.createSentPos('bc', drafts, drafts.map((d) => ({ ...d, num: 'BC-T-1' })));
  const boxes = (await s.getBoxes('bc')).filter((b) => b.po_id === po.id);
  assert.equal(boxes.length, 3);
  assert.ok(boxes.every((b) => b.state === 'on_order' && b.source === 'po' && !b.serial));
});

test('receiving against a PO claims placeholders, then creates boxes past the order', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const drafts = buildDrafts({ [g.id]: 1 }, await s.getProducts(), await s.getVendors());
  const [po] = await s.createSentPos('bc', drafts, drafts.map((d) => ({ ...d, num: 'BC-T-2' })));
  const sh = await s.createShipment({ hall_id: 'bc', po_id: po.id, invoice_no: 'I-1', received_on: '2026-10-20' });
  const a = await s.receiveBox({ hallId: 'bc', shipmentId: sh.id, poId: po.id, product: g, serial: '100', receivedOn: '2026-10-20' });
  const b = await s.receiveBox({ hallId: 'bc', shipmentId: sh.id, poId: po.id, product: g, serial: '101', receivedOn: '2026-10-20' });
  assert.equal(a.source, 'po');
  assert.equal(b.source, 'receive');
  const mine = (await s.getBoxes('bc')).filter((x) => x.shipment_id === sh.id);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((x) => x.state === 'in_inventory' && x.received_on === '2026-10-20' && x.game_snapshot?.form_number === 'CR3'));
  await assert.rejects(() => s.receiveBox({ hallId: 'bc', product: g, serial: '100' }), /already received/);
});

test('undoing a receive puts a placeholder back on order and removes a created box', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const drafts = buildDrafts({ [g.id]: 1 }, await s.getProducts(), await s.getVendors());
  const [po] = await s.createSentPos('bc', drafts, drafts.map((d) => ({ ...d, num: 'BC-T-3' })));
  const a = await s.receiveBox({ hallId: 'bc', poId: po.id, product: g, serial: '1' });
  const b = await s.receiveBox({ hallId: 'bc', product: g, serial: '2' });
  await s.undoReceiveBox(a.id);
  await s.undoReceiveBox(b.id);
  const all = await s.getBoxes('bc');
  assert.equal(all.find((x) => x.id === a.id).state, 'on_order');
  assert.equal(all.find((x) => x.id === a.id).serial, '');
  assert.equal(all.find((x) => x.id === b.id), undefined);
});

test('open → remainder → remainder → sold out keeps every count', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '9' });
  const opened = await s.openBox(box.id, { openedOn: '2026-10-20' });
  assert.equal(opened.opened_on, '2026-10-20');
  assert.ok(opened.opened_at);
  await s.recordRemainder(box.id, 400, { sessionDate: '2026-10-20' });
  await s.recordRemainder(box.id, 125, { sessionDate: '2026-10-21' });
  let b = (await s.getBoxes('bc')).find((x) => x.id === box.id);
  assert.equal(b.state, 'opened');
  assert.equal(b.tickets_remaining, 125);
  assert.deepEqual((await s.getBoxCounts('bc')).filter((c) => c.box_id === box.id).map((c) => c.tickets_left), [400, 125]);
  await assert.rejects(() => s.recordRemainder(box.id, 2000), /945/);
  await s.soldOut(box.id);
  b = (await s.getBoxes('bc')).find((x) => x.id === box.id);
  assert.equal(b.state, 'sold_out');
  assert.equal(b.tickets_remaining, 0);
  assert.ok(b.sold_out_at);
});

test('close unsold records the tickets left; reopening restores the last remainder', async () => {
  const s = await freshStore();
  const g = await prod(s, '52266');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '77' });
  await s.openBox(box.id);
  await s.recordRemainder(box.id, 300);
  await s.closeUnsold(box.id, 88);
  let b = (await s.getBoxes('bc')).find((x) => x.id === box.id);
  assert.equal(b.state, 'closed_unsold');
  assert.equal(b.tickets_remaining, 88);
  assert.ok(b.closed_at);
  await s.reopenBox(box.id);
  b = (await s.getBoxes('bc')).find((x) => x.id === box.id);
  assert.equal(b.state, 'opened');
  assert.equal(b.closed_at, null);
  assert.equal(b.tickets_remaining, 300);
});

test('a remainder can only be logged on an open box', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '5' });
  await assert.rejects(() => s.recordRemainder(box.id, 10), /open box/);
});

test('every action leaves a labelled line in History', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '6' });
  await s.openBox(box.id);
  await s.recordRemainder(box.id, 50);
  await s.soldOut(box.id);
  const kinds = (await s.getEvents(20)).map((e) => e.kind);
  for (const k of ['box.receive', 'box.open', 'box.remainder', 'box.soldout']) assert.ok(kinds.includes(k), k);
});

test('the training sandbox has boxes at every stage, each closed box with its times', async () => {
  mem.clear();
  const s = new DemoStore(true);
  await s.init();
  const boxes = await s.getBoxes('bc');
  for (const st of ['on_order', 'in_inventory', 'opened', 'sold_out', 'closed_unsold', 'missing']) {
    assert.ok(boxes.some((b) => b.state === st), st);
  }
  for (const b of boxes.filter((x) => x.state === 'sold_out' || x.state === 'closed_unsold')) {
    assert.ok(b.opened_at && closedAt(b) && b.opened_at <= closedAt(b), b.serial);
  }
  assert.ok(boxes.some((b) => b.state === 'opened' && b.tickets_remaining != null));
});

// ---------------------------------------------------------------- from the independent review
test('a closed box cannot be put back on the floor by opening it', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '31' });
  await s.openBox(box.id);
  await assert.rejects(() => s.openBox(box.id), /already open/);
  await s.soldOut(box.id);
  await assert.rejects(() => s.openBox(box.id), /already sold out/);
});
test('closes carry the session date picked on Open', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '32' });
  await s.openBox(box.id, { openedOn: '2026-10-16' });
  await s.soldOut(box.id, { sessionDate: '2026-10-16' });
  const b = (await s.getBoxes('bc')).find((x) => x.id === box.id);
  assert.equal(b.closed_on, '2026-10-16');
  await s.reopenBox(box.id);
  assert.equal((await s.getBoxes('bc')).find((x) => x.id === box.id).closed_on, null);
});
test('the report files a box by its session dates, not the scan clock', () => {
  // Friday's session entered on Saturday morning
  const b = { id: 'z', product_id: 'G1', serial: '9', state: 'sold_out',
    opened_on: '2026-10-16', opened_at: at(2026, 10, 17, 9), closed_on: '2026-10-16', sold_out_at: at(2026, 10, 17, 9) };
  const fri = buildReport({ boxes: [b], products: [G()], vendors, shipments: [], period: { from: '2026-10-16', to: '2026-10-16' } });
  const sat = buildReport({ boxes: [b], products: [G()], vendors, shipments: [], period: { from: '2026-10-17', to: '2026-10-17' } });
  assert.equal(fri.closed.length, 1);
  assert.equal(fri.opened.length, 1);
  assert.equal(sat.closed.length + sat.opened.length, 0);
});
test('undoing an open clears any remainder on the box', async () => {
  const s = await freshStore();
  const g = await prod(s, 'CR3');
  const box = await s.receiveBox({ hallId: 'bc', product: g, serial: '33' });
  await s.openBox(box.id);
  await s.recordRemainder(box.id, 300);
  await s.undoOpen(box.id);
  assert.equal((await s.getBoxes('bc')).find((x) => x.id === box.id).tickets_remaining, null);
});

// ---------------------------------------------------------------- real field barcodes (Frontier flash catalog)
const { readScan } = await import('../src/lib/logic/scan.js');
const CANDY = G({ id: 'G11', name: 'Candy Pack', form_number: '6747U', tickets: 250 });
const UNICORN = G({ id: 'G30', name: 'Wild Unicorn', form_number: '6303W', tickets: 1060 });
const SR = G({ id: 'G2b', name: 'Shamrocks', form_number: 'SR3' });
const field = [CANDY, UNICORN, SR, G()];
test('a game barcode with a maker prefix finds the game by its form number', () => {
  assert.equal(gameForForm(field, 'AI6747U').id, 'G11');   // Candy Pack, as in the Frontier catalog
  assert.equal(gameForForm(field, 'AN6303W').id, 'G30');   // Wild Unicorn
  assert.equal(gameForForm(field, 'SR3').id, 'G2b');       // a bare form number still works
});
test('a suffix letter is never ignored — AN6303WR is a different box', () => {
  assert.equal(gameForForm(field, 'AN6303WR'), null);
});
test('two scans: game barcode, then serial', () => {
  const boxes = [];
  const first = resolveReceiveScan('AI6747U', { products: field, boxes });
  assert.equal(first.action, 'pick');
  assert.equal(first.product.id, 'G11');
  const second = resolveReceiveScan('0012345', { products: field, boxes, pending: first.product });
  assert.equal(second.ok, true);
  assert.equal(second.product.id, 'G11');
  assert.equal(second.serial, '0012345');
});
test('one combined scan with a maker prefix also works', () => {
  const r = resolveReceiveScan('AI6747U 0012345', { products: field, boxes: [] });
  assert.equal(r.ok, true);
  assert.equal(r.product.id, 'G11');
});
test('with a game picked, the next scan is its serial even if it looks like a code', () => {
  const r = readScan('SR3', { products: field, pending: CANDY });
  assert.equal(r.type, 'box');
  assert.equal(r.product.id, 'G11');
  assert.equal(r.serial, 'SR3');
});
test('an unknown lone code offers Add game, with the serial still to come', () => {
  const r = resolveReceiveScan('AN9999Z', { products: field, boxes: [] });
  assert.equal(r.reason, 'unknown_game');
  assert.equal(r.form, 'AN9999Z');
  assert.equal(r.serial, null);
});
test('Open takes the same two scans', () => {
  const boxes = [{ id: 'b', product_id: 'G30', serial: '77', state: 'in_inventory' }];
  const pick = resolveOpenScan('AN6303W', { products: field, boxes });
  assert.equal(pick.action, 'pick');
  assert.equal(resolveOpenScan('77', { products: field, boxes, pending: pick.product }).box.id, 'b');
});
test('a typed game name picks the game, as the admin scanner allows', () => {
  assert.equal(resolveReceiveScan('candy', { products: field, boxes: [] }).product.id, 'G11');
  assert.equal(resolveReceiveScan('Wild Unicorn', { products: field, boxes: [] }).product.id, 'G30');
});
test('a name that matches several games asks which one', () => {
  const two = [...field, G({ id: 'G31', name: 'Wild Unicorn Deluxe', form_number: '6303X' })];
  const r = resolveReceiveScan('unicorn', { products: two, boxes: [] });
  assert.equal(r.reason, 'choose');
  assert.equal(r.matches.length, 2);
});
test('one trigger pull with a space still works when a game is waiting', () => {
  const r = resolveReceiveScan('AN6303W 0099009', { products: field, boxes: [], pending: CANDY });
  assert.equal(r.product.id, 'G30');   // the combined scan names its own game
});

// ---- progressive jackpots ----
import { parseSplit, defaultProgressives, currentAmount, hit as hitProg } from '../src/lib/logic/progressive.js';
test('progressive: colour split becomes one jackpot per colour', () => {
  assert.deepEqual(parseSplit('Red: 200, White: 100, Blue: 50').map((x) => x.amount), [200, 100, 50]);
  const ps = defaultProgressives([{ id: 'G033', name: 'Freedom', progressive_amount: 350, progressive_note: 'Red: 200, White: 100, Blue: 50' },
    { id: 'G1', name: 'Plain', progressive_amount: 25 }, { id: 'G2', name: 'None', progressive_amount: 0 }]);
  assert.deepEqual(ps.map((p) => [p.name, p.per_box]), [['Freedom Red', 200], ['Freedom White', 100], ['Freedom Blue', 50], ['Plain', 25]]);
});
test('progressive: grows per sold-out box, resets on a hit', () => {
  const p = { id: 'x', seed: 100, per_box: 50, adjust: 5, game_ids: ['G1'], reset_at: null };
  const bx = [
    { product_id: 'G1', state: 'sold_out', sold_out_at: '2026-10-01T10:00:00Z' },
    { product_id: 'G1', state: 'opened' },
    { product_id: 'G2', state: 'sold_out', sold_out_at: '2026-10-01T10:00:00Z' },
  ];
  assert.equal(currentAmount(p, bx), 155);
  const after = hitProg(p, bx, '2026-10-02T00:00:00Z');
  assert.equal(after.hits[0].amount, 155);
  assert.equal(currentAmount(after, bx), 100);
  bx.push({ product_id: 'G1', state: 'sold_out', sold_out_at: '2026-10-03T00:00:00Z' });
  assert.equal(currentAmount(after, bx), 150);
});
