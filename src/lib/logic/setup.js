// Fields a person still has to fill in on a game. Every one shows "update" in its
// own cell, so the gap is visible right where it gets fixed.
//
// A blank cost does NOT block ordering: the PO prints "?" and the distributor fills
// it in on their invoice. A missing distributor does, because there is nobody to
// send the order to.

export const UNKNOWN_VENDOR = 'unknown';

/** Nobody has confirmed who supplies this. */
export const needsVendor = (p) => !p || !p.vendor_id || p.vendor_id === UNKNOWN_VENDOR;

/** No cost per box yet. */
export const needsCost = (p) => !p || !(Number(p.cost) > 0);

/** No ticket count — which is also the ideal gross receipts at $1 a ticket. */
export const needsTickets = (p) => !!p && !(Number(p.tickets) > 0);

/** No form number, so a scan can never find this game. */
export const needsForm = (p) => !!p && !String(p.form_number || '').trim();

/** Hard gate: can this product be put on a PO at all? */
export const needsSetup = (p) => needsVendor(p);

/** Any field still waiting on a person. */
export const needsAnyUpdate = (p) => needsVendor(p) || needsCost(p) || needsTickets(p) || needsForm(p);

export const setupReason = (p) => {
  const gaps = [];
  if (needsVendor(p)) gaps.push('distributor');
  if (needsForm(p)) gaps.push('form number');
  if (needsCost(p)) gaps.push('cost');
  if (needsTickets(p)) gaps.push('ticket count');
  return gaps.length ? `Needs ${gaps.join(', ')}` : '';
};

/** Products that cannot be put on any order yet, alphabetical. */
export function productsNeedingSetup(products) {
  return (products || []).filter(needsSetup).sort((a, b) => a.name.localeCompare(b.name));
}

/** Products with any blank field, alphabetical. */
export function productsNeedingUpdate(products) {
  return (products || []).filter(needsAnyUpdate).sort((a, b) => a.name.localeCompare(b.name));
}
