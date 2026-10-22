// BC rules shared by both stores and the screens.

/** The game attributes the compliance report prints, copied onto a box when it is
 *  received — so editing a game later never changes a report that was already true. */
export const SNAPSHOT_FIELDS = [
  'name', 'form_number', 'vendor_id', 'tickets', 'ideal_gross_receipts', 'ideal_cash_prize',
  'ideal_profit', 'non_cash_prize_value', 'net_profit', 'progressive_amount', 'progressive_note',
];

export function gameSnapshot(product) {
  const out = {};
  for (const k of SNAPSHOT_FIELDS) out[k] = product?.[k] ?? null;
  return out;
}

/** A box's game attributes: its own snapshot first, then the live catalog. */
export function gameOf(box, product) {
  const snap = box?.game_snapshot || {};
  const out = { ...(product || {}) };
  for (const k of SNAPSHOT_FIELDS) if (snap[k] != null) out[k] = snap[k];
  return out;
}

/** Tickets in a full box. $1 a ticket, so this is also the ideal gross receipts. */
export function ticketsIn(box, product) {
  const g = gameOf(box, product);
  return Number(g.tickets) || Number(g.ideal_gross_receipts) || 0;
}

/** Validate a tickets-left count against the box. Throws a readable error. */
export function checkCount(value, box, products) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error('Enter how many tickets are left as a whole number.');
  const product = (products || []).find((p) => p.id === box?.product_id);
  const max = ticketsIn(box, product);
  if (max && n > max) throw new Error(`That box only holds ${max.toLocaleString()} tickets.`);
  return n;
}

/** Today's date where the person is, as YYYY-MM-DD. (toISOString gives the UTC date,
 *  which is already tomorrow on a Pacific-time evening session.) */
export function localYmd(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A timestamp for something that happened on a picked date. If the date is today,
 * it is now; a past date (a delivery entered late) is pinned to local noon so it
 * files under the day the person picked, in every time zone.
 */
export function atLocalNoonIso(ymd, nowIfToday = true) {
  if (!ymd) return new Date().toISOString();
  if (nowIfToday && ymd === localYmd()) return new Date().toISOString();
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/** "Oct 20, 6:42 PM" */
export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Oct 20, 2026" from a YYYY-MM-DD, without the UTC-shift trap. */
export function fmtYmd(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
