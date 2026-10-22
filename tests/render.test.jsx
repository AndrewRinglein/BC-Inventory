// Render smoke test.
//
// Every screen gets rendered to a string against a mock context. It proves they
// run: `x is not defined` compiles fine and only explodes when React evaluates the
// tree, so a green `vite build` says nothing about whether a screen still opens.
// A few checks on top make sure the BC screens show what the floor relies on.
//
// Run with:  npm test

import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppCtx } from '../src/App.jsx';

import Dashboard from '../src/components/Dashboard.jsx';
import Purchase from '../src/components/Purchase.jsx';
import Review from '../src/components/Review.jsx';
import Receive from '../src/components/Receive.jsx';
import Open from '../src/components/Open.jsx';
import Reports from '../src/components/Reports.jsx';
import Inventory from '../src/components/Inventory.jsx';
import Orders from '../src/components/Orders.jsx';
import Accounting from '../src/components/Accounting.jsx';
import Games from '../src/components/Games.jsx';
import History from '../src/components/History.jsx';
import Adjust from '../src/components/Adjust.jsx';
import SettingsScreen from '../src/components/SettingsScreen.jsx';
import Sidebar from '../src/components/Sidebar.jsx';
import AddGameModal from '../src/components/AddGameModal.jsx';
import UpdateGame from '../src/components/UpdateGame.jsx';
import { localYmd } from '../src/lib/logic/bc.js';

const today = localYmd();
const now = new Date().toISOString();
const vendors = [
  { id: 'lib', name: 'Liberty Gaming', email: 'a@b.com', contact_name: '', tax_rate: 0 },
  { id: 'clk', name: 'Clarko', email: '', contact_name: '', tax_rate: 0 },
];
const products = [
  { id: 'G1', name: '4 Corner - $500', form_number: 'CR3', vendor_id: 'lib', cost: '0', tickets: 945, price_per_ticket: 1,
    ideal_gross_receipts: '945', ideal_cash_prize: '665', ideal_profit: '280', non_cash_prize_value: '0',
    net_profit: '280', progressive_amount: '0', active: true },
  { id: 'G2', name: 'Jackpot Derby', form_number: '52266', vendor_id: 'clk', cost: '470.00', tickets: 1806, price_per_ticket: 1,
    ideal_gross_receipts: '1806', ideal_cash_prize: '1400', ideal_profit: '406', non_cash_prize_value: '0',
    net_profit: '406', progressive_amount: '300', active: true },
];
const boxes = [
  { id: 'b1', hall_id: 'bc', product_id: 'G1', state: 'in_inventory', serial: '0012345', cost: '0', received_on: today },
  { id: 'b2', hall_id: 'bc', product_id: 'G2', state: 'opened', serial: '777', cost: '470.00', opened_on: today,
    opened_at: now, tickets_remaining: 125, shipment_id: 's1' },
  { id: 'b3', hall_id: 'bc', product_id: 'G2', state: 'sold_out', serial: '778', cost: '470.00', opened_at: now, sold_out_at: now, shipment_id: 's1' },
  { id: 'b4', hall_id: 'bc', product_id: 'G1', state: 'closed_unsold', serial: '0012346', cost: '0', opened_at: now, closed_at: now, tickets_remaining: 88 },
  { id: 'b5', hall_id: 'bc', product_id: 'G1', state: 'on_order', serial: '', cost: '0', po_id: 'po1', source: 'po' },
];
const boxCounts = [{ id: 'c1', box_id: 'b2', hall_id: 'bc', tickets_left: 125, session_date: today, counted_at: now, kind: 'remainder' }];
const pos = [{
  id: 'po1', num: 'BC-26-10-22-LIB-001', hall_id: 'bc', vendor_id: 'lib', status: 'sent',
  subtotal: '0', tax: '0', total: '0', sent_at: now, created_at: now, archived_at: null, recorded_only: false, vendor_ref: null,
}];

const store = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'isDemo') return true;
    return async () => ({
      getPoLines: [], getEmails: [], getEvents: [], getAdjustments: [], getArrivals: [], getReceiptDetail: [],
      getShipments: [{ id: 's1', hall_id: 'bc', invoice_no: '55102', received_on: today }],
    }[k] ?? []);
  },
});

const ctx = {
  hall: 'bc', hallName: 'BC', screen: 'dashboard', setScreen: () => {},
  vendors, products, boxes, pos, allPos: pos, payments: [], orderQty: { G1: 2 }, boxCounts,
  settings: { email: {}, sender: {}, halls_config: {}, po_email: {}, po_sequence: {}, report: { businessName: 'BC Test' } },
  store, reloadHall: async () => {}, reloadCatalog: async () => {}, reloadSettings: async () => {},
  setToast: () => {}, requirePin: async () => true, can: () => true, flashFor: () => {},
  scanHandlerRef: { current: null }, receivingPo: null, setReceivingPo: () => {},
  productName: (pid) => products.find((p) => p.id === pid)?.name || pid, today: () => today,
  role: 'admin', roleLabel: 'Admin', IS_DEMO: true, IS_SANDBOX: false,
};

const SCREENS = {
  Dashboard, Purchase, Review, Receive, Open, Inventory, Orders, Accounting,
  Games, History, SettingsScreen, Sidebar,
  Reports: (p) => <Reports initialShipments={[{ id: 's1', hall_id: 'bc', invoice_no: '55102', received_on: today }]} {...p} />,
  Adjust: (p) => <Adjust onClose={() => {}} {...p} />,
  AddGameModal: (p) => <AddGameModal form="XYZ1" serial="991" onClose={() => {}} {...p} />,
  UpdateGame: (p) => <UpdateGame product={products[1]} onClose={() => {}} {...p} />,
};

const render = (Comp, c = ctx) => renderToString(<AppCtx.Provider value={c}><Comp /></AppCtx.Provider>);
let failed = 0;
for (const [name, Comp] of Object.entries(SCREENS)) {
  try {
    render(Comp);
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

const check = (label, cond) => {
  if (cond) console.log(`  ok    ${label}`);
  else { failed++; console.log(`  FAIL  ${label}`); }
};
console.log('');
const strip = (html) => html.replace(/<!-- -->/g, '');
{
  const open = strip(render(Open));
  check('Open lists the open box with its serial', open.includes('Jackpot Derby') && open.includes('777'));
  check('Open shows the carried remainder', />125</.test(open));
  check('Open offers Sold out, Remainder and Close unsold', open.includes('Sold out') && open.includes('Remainder') && open.includes('Close unsold'));
  check('Open lists today\'s closes, sold out and unsold', open.includes('sold out') && open.includes('closed unsold'));

  const rep = strip(render(SCREENS.Reports));
  check('Reports lists the sold-out and closed-unsold boxes', rep.includes('778') && rep.includes('0012346'));
  check('Reports leaves out boxes that are still open from the closed list', !/<td[^>]*>777<\/td>/.test(rep.split('Boxes closed')[1] || ''));
  check('Reports carries the invoice number from the receipt', rep.includes('55102'));
  check('Reports prints the business name in the header', rep.includes('BC Test'));
  check('Reports shows the ticket sheet attributes', rep.includes('Ideal gross receipts') && rep.includes('Amount to progressive'));

  const rec = strip(render(Receive));
  check('Receive offers the open PO in the dropdown', rec.includes('BC-26-10-22-LIB-001'));
  check('Receive has a scan box that accepts scanner input', /data-scan-target="1"/.test(rec));

  const inv = strip(render(Inventory));
  check('Inventory counts sealed and open boxes', inv.includes('1 sealed') && inv.includes('1 open'));

  const purch = strip(render(Purchase));
  check('Purchase shows a ? for a game with no cost', purch.includes('>?<'));
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall screens render');
if (failed) process.exit(1);
