// The compliance report, as pure functions — so the rows a regulator sees are
// unit-tested rather than living only inside a screen.

import { gameOf, ticketsIn, localYmd } from './bc.js';
import { closedAt } from './boxes.js';

export const dayOf = (iso) => (iso ? localYmd(new Date(iso)) : null);

/** { from, to } (inclusive YYYY-MM-DD) for a YYYY-MM month. */
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

/** Did this timestamp happen on a day inside the period, in local time? */
export const inPeriod = (iso, period) => {
  const d = dayOf(iso);
  return !!d && d >= period.from && d <= period.to;
};

/** One report row for a box: its game as received, its receipt, open and close. */
export function reportRow(b, { pmap, vmap, smap }) {
  const p = pmap[b.product_id];
  const g = gameOf(b, p);
  const sh = b.shipment_id ? smap[b.shipment_id] : null;
  return {
    b, g,
    vendor: vmap[g.vendor_id || p?.vendor_id] || g.vendor_id || p?.vendor_id || '',
    invoiceNo: sh?.invoice_no || '',
    invoiceDate: sh?.received_on || b.received_on || '',
    closedAt: closedAt(b),
    status: b.state === 'sold_out' ? 'Sold out' : b.state === 'closed_unsold' ? 'Closed unsold' : b.state === 'opened' ? 'Open' : b.state,
    left: b.state === 'closed_unsold' ? Number(b.tickets_remaining || 0)
      : b.state === 'opened' && b.tickets_remaining != null ? Number(b.tickets_remaining) : null,
    tickets: ticketsIn(b, p),
    cost: Number(b.cost) || 0,
  };
}

/**
 * The rows for a period.
 *   closed: boxes sold out or closed unsold during the period (by close time)
 *   opened: boxes opened during the period (by open time), whatever happened after
 * Plus the summary figures the report prints.
 */
export function buildReport({ boxes, products, vendors, shipments, period }) {
  const pmap = Object.fromEntries((products || []).map((p) => [p.id, p]));
  const vmap = Object.fromEntries((vendors || []).map((v) => [v.id, v.name]));
  const smap = Object.fromEntries((shipments || []).map((s) => [s.id, s]));
  const ctx = { pmap, vmap, smap };
  const closed = (boxes || [])
    .filter((b) => (b.state === 'sold_out' || b.state === 'closed_unsold') && inPeriod(closedAt(b), period))
    .map((b) => reportRow(b, ctx));
  const opened = (boxes || []).filter((b) => b.opened_at && inPeriod(b.opened_at, period)).map((b) => reportRow(b, ctx));

  // still open at the end of the last day of the period
  const [y, m, d] = period.to.split('-').map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
  const stillOpen = (boxes || []).filter((b) => b.opened_at && b.opened_at <= end
    && (!closedAt(b) || closedAt(b) > end)).length;

  const sold = closed.filter((r) => r.b.state === 'sold_out');
  const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + (Number(r.g[k]) || 0), 0) * 100) / 100;
  return {
    closed, opened,
    summary: {
      opened: opened.length,
      soldOut: sold.length,
      closedUnsold: closed.length - sold.length,
      stillOpen,
      idealGross: sum(sold, 'ideal_gross_receipts'),
      idealCashPrize: sum(sold, 'ideal_cash_prize'),
      idealProfit: sum(sold, 'ideal_profit'),
      netProfit: sum(sold, 'net_profit'),
      progressive: sum(sold, 'progressive_amount'),
      costClosed: Math.round(closed.reduce((a, r) => a + r.cost, 0) * 100) / 100,
    },
  };
}
