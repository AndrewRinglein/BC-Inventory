// Box lifecycle state machine — mirror of the database guard in 001_bc_schema.sql.
// The DB enforces it too; this copy gives instant feedback and powers demo mode.
//
//   on_order -> in_inventory -> opened -> sold_out
//                                      -> closed_unsold   (retired with tickets left)
//   missing: ordered but never arrived
//
// A remainder is NOT a state: the box stays `opened` and its tickets-left count is
// logged (box_counts) so it carries into the next session.

export const STATES = ['on_order', 'in_inventory', 'opened', 'sold_out', 'closed_unsold', 'missing'];

const ALLOWED = {
  on_order:      ['in_inventory', 'missing'],
  in_inventory:  ['opened', 'missing', 'on_order'],     // on_order = undo of a receive
  opened:        ['sold_out', 'closed_unsold', 'in_inventory'],   // in_inventory = undo of open
  sold_out:      ['opened'],                            // undo only
  closed_unsold: ['opened'],                            // undo only
  missing:       ['in_inventory', 'on_order'],          // late arrival / undo
};

export const canTransition = (from, to) => from === to || (ALLOWED[from] || []).includes(to);

export const isClosed = (b) => b?.state === 'sold_out' || b?.state === 'closed_unsold';

/** When a closed box closed — sold out or retired unsold. */
export const closedAt = (b) => (b?.state === 'sold_out' ? b.sold_out_at : b?.state === 'closed_unsold' ? b.closed_at : null);

/** Apply a transition, stamping the appropriate timestamp. Throws on illegal moves. */
export function transition(box, to, now = new Date().toISOString()) {
  if (!canTransition(box.state, to)) {
    throw new Error(`illegal box state transition: ${box.state} -> ${to}`);
  }
  const b = { ...box, state: to };
  if (to === 'in_inventory' && !b.received_at) b.received_at = now;
  if (to === 'opened') b.opened_at = b.opened_at || now;
  if (to === 'sold_out') b.sold_out_at = b.sold_out_at || now;
  if (to === 'closed_unsold') b.closed_at = b.closed_at || now;
  // undo clears the stamp it is undoing, so a re-close records the real time
  if (box.state === 'sold_out' && to === 'opened') b.sold_out_at = null;
  if (box.state === 'closed_unsold' && to === 'opened') b.closed_at = null;
  if (box.state === 'opened' && to === 'in_inventory') { b.opened_at = null; b.opened_on = null; }
  return b;
}

/**
 * Per-product counts.
 *
 *   inv      in_inventory      sealed, in stock
 *   open     opened            on the floor, selling
 *   owned    inv + open        what accounting counts as stock
 */
export function countByProduct(boxes) {
  const out = {};
  for (const b of boxes) {
    const c = (out[b.product_id] ||= {
      inv: 0, open: 0, onorder: 0, sold: 0, closed: 0, missing: 0, owned: 0,
    });
    if (b.state === 'in_inventory') { c.inv++; c.owned++; }
    else if (b.state === 'opened') { c.open++; c.owned++; }
    else if (b.state === 'on_order') c.onorder++;
    else if (b.state === 'sold_out') c.sold++;
    else if (b.state === 'closed_unsold') c.closed++;
    else if (b.state === 'missing') c.missing++;
  }
  return out;
}
