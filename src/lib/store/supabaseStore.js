// Supabase-backed store — same interface as DemoStore.
// Activated automatically when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set in .env.

import { createClient } from '@supabase/supabase-js';
import { senderFor } from '../logic/emails.js';
import { perBoxValue } from '../logic/pricing.js';
import { round2 } from '../logic/po.js';
import { gameSnapshot, checkCount, atLocalNoonIso, localYmd } from '../logic/bc.js';
import { transition } from '../logic/boxes.js';

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/** "Swapped 1 Lucky Puppy for 1 Best Friends" */
function adjustmentLabel(hallId, reason, lines, prods) {
  const nm = (l) => prods[l.product_id]?.name || l.product_id;
  const out = lines.filter((l) => Number(l.delta) < 0);
  const inn = lines.filter((l) => Number(l.delta) > 0);
  const list = (xs) => xs.map((l) => `${Math.abs(Number(l.delta))} ${nm(l)}`).join(' and ');
  if (reason === 'swap' && out.length && inn.length) {
    return `Swapped ${list(out)} for ${list(inn)}`;
  }
  const word = { damaged: 'wrote off', miscount: 'recounted', found: 'found',
                 returned: 'returned to the distributor' }[reason] || 'adjusted';
  const all = [...out, ...inn];
  return `${word[0].toUpperCase()}${word.slice(1)} ${list(all)}`;
}

// PostgREST caps every response at 1000 rows and gives no warning when it truncates —
// a hall with more than 1000 boxes would silently show wrong counts and values.
// Page through until a short page comes back.
const PAGE = 1000;
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = ok(await build().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export class SupabaseStore {
  isDemo = false;

  constructor(url, key) {
    this.sb = createClient(url, key);
  }
  async init() { /* nothing to preload; session restored by supabase-js */ }

  // ---- auth ----
  async signIn(email, pass) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password: pass });
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  async signOut() { await this.sb.auth.signOut(); }
  async getSession() {
    const { data } = await this.sb.auth.getSession();
    return data.session ? { email: data.session.user.email } : null;
  }

  // ---- catalog ----
  async getVendors() { return ok(await this.sb.from('vendors').select('*').order('name')); }
  async getProducts() { return fetchAll(() => this.sb.from('products').select('*').order('name')); }
  /**
   * Update a product — and never let a rename cost us a match.
   *
   * Session sheets are typed by hand and say what they have always said. The
   * matcher tries the name first, then the aliases, so renaming a game in the
   * catalogue silently stops its sheet lines matching: every one drops into the
   * unmatched pile for somebody to key in by hand, and nothing warns you. Renaming
   * "In Laws" to "In Laws - Strip" is enough to do it.
   *
   * So the old name is kept as an alias automatically, every time. The rename is
   * still a rename — screens, POs and emails all show the new name — but the old
   * spelling goes on matching for as long as the sheets keep using it.
   */
  async updateProduct(id, fields) {
    const patch = { ...fields };
    if (patch.name != null) {
      const cur = ok(await this.sb.from('products').select('name,aliases').eq('id', id).maybeSingle());
      const old = (cur?.name || '').trim();
      const next = String(patch.name).trim();
      if (old && old !== next) {
        const have = cur?.aliases || [];
        // case-insensitive, so re-casing a name does not pile up near-duplicates
        const key = (v) => v.trim().toLowerCase();
        if (!have.some((a) => key(a) === key(old))) patch.aliases = [...have, old];
      }
    }
    return ok(await this.sb.from('products').update(patch).eq('id', id).select().single());
  }
  async addProduct(p) {
    const row = { id: 'C' + Date.now(), ...p };
    return ok(await this.sb.from('products').insert(row).select().single());
  }
  async addVendor(v) {
    return ok(await this.sb.from('vendors').insert({ id: v.id, name: v.name, email: v.email || '' }).select().single());
  }
  async updateVendor(id, fields) {
    return ok(await this.sb.from('vendors').update(fields).eq('id', id).select().single());
  }

  // ---- order builder quantities ----
  async getOrderQty(hallId) {
    const rows = await fetchAll(() => this.sb.from('order_qty').select('*').eq('hall_id', hallId));
    return Object.fromEntries(rows.map((r) => [r.product_id, r.qty]));
  }
  async setOrderQty(hallId, productId, qty) {
    if (qty > 0) {
      ok(await this.sb.from('order_qty').upsert({ hall_id: hallId, product_id: productId, qty }));
    } else {
      ok(await this.sb.from('order_qty').delete().match({ hall_id: hallId, product_id: productId }));
    }
  }
  async clearOrderQty(hallId) { ok(await this.sb.from('order_qty').delete().eq('hall_id', hallId)); }

  // ---- purchase orders ----
  /**
   * Create the POs for an order.
   *
   * opts.recordedOnly marks an order that was placed outside this system — no
   * email will follow. opts.placedAt backdates it, which is the whole point of
   * recording one: an order phoned in two weeks ago has to sit in the record on
   * the day it was actually placed, or the month's spend and the age of what's
   * on order both read wrong. The boxes are backdated with it.
   */
  async createSentPos(hallId, _drafts, numbered, opts = {}) {
    const { recordedOnly = false, placedAt = null, vendorRef = '' } = opts;
    const when = placedAt || new Date().toISOString();
    const created = [];
    for (const d of numbered) {
      const po = ok(await this.sb.from('purchase_orders').insert({
        num: d.num, hall_id: hallId, vendor_id: d.vendor_id, status: 'sent',
        subtotal: d.subtotal, tax: d.tax, total: d.total,
        price_tbd_lines: d.lines.filter((l) => l.price_tbd).length,
        sent_at: when, created_at: when,
        recorded_only: recordedOnly, vendor_ref: vendorRef || null,
      }).select().single());
      // per_box_cost is derived at receiving time; the price parts are kept so this
      // PO can be reprinted years later exactly as the vendor received it
      ok(await this.sb.from('po_lines').insert(
        d.lines.map(({ per_box_cost, ...l }) => ({ po_id: po.id, ...l }))));
      // fee lines (packing charges) are not physical goods — no boxes for them.
      // One ordered unit can become several inventory boxes (a case of totes), each
      // carrying its share of the landed cost.
      const boxes = d.lines.filter((l) => l.kind !== 'fee' && l.product_id).flatMap((l) =>
        Array.from({ length: l.qty * (l.split_boxes || 1) }, () => ({
          hall_id: hallId, product_id: l.product_id, po_id: po.id,
          cost: l.per_box_cost ?? l.cost, price_tbd: !!l.price_tbd, state: 'on_order',
          ordered_at: when, source: 'po',
        })));
      if (boxes.length) ok(await this.sb.from('boxes').insert(boxes));
      if (recordedOnly) {
        await this.logEvent('po.record', 'purchase_orders', po.num, {
          label: `Recorded PO ${po.num} (no email sent)`,
          total: po.total, vendor_id: po.vendor_id, placed_at: when, vendor_ref: vendorRef || null,
        });
      }
      created.push(po);
    }
    return created;
  }
  async getPos(hallId) { return fetchAll(() => this.sb.from('purchase_orders').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }
  async getPoLines(poId) { return fetchAll(() => this.sb.from('po_lines').select('*').eq('po_id', poId)); }

  /**
   * Lines for several orders at once, grouped by po_id.
   *
   * Accounting needs "ordered" and "short" on EVERY row, not just an expanded
   * one, so fetching per order would be a request per line of the table. Chunked
   * because a URL carrying every id has a length limit and PostgREST caps a page
   * at 1000 rows.
   */
  async getPoLinesFor(poIds = []) {
    const ids = [...new Set(poIds.filter(Boolean))];
    const out = {};
    for (let i = 0; i < ids.length; i += 100) {
      const rows = await fetchAll(() => this.sb.from('po_lines').select('*')
        .in('po_id', ids.slice(i, i + 100)));
      for (const l of rows) (out[l.po_id] ||= []).push(l);
    }
    for (const id of ids) out[id] ||= [];      // an order with no lines is empty, not absent
    return out;
  }
  async setPoStatus(poId, status) { ok(await this.sb.from('purchase_orders').update({ status }).eq('id', poId)); }

  /** Write re-quoted lines and totals back onto an existing PO, keeping its number. */
  async repricePo(poId, lines, totals) {
    for (const l of lines) {
      ok(await this.sb.from('po_lines').update({
        cost: l.cost, base_cost: l.base_cost, pack_units: l.pack_units,
        packing_each: l.packing_each, price_tbd: !!l.price_tbd,
      }).eq('id', l.id));
    }
    const po = ok(await this.sb.from('purchase_orders').update({
      subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
      price_tbd_lines: lines.filter((l) => l.price_tbd).length,
    }).eq('id', poId).select().single());
    // boxes still on order carry the old price; bring them along
    for (const l of lines) {
      if (!l.product_id || l.kind === 'fee') continue;
      const per = l.split_boxes > 1 ? Math.round((l.cost / l.split_boxes) * 100) / 100 : l.cost;
      ok(await this.sb.from('boxes').update({ cost: per, price_tbd: !!l.price_tbd })
        .eq('po_id', poId).eq('product_id', l.product_id).eq('state', 'on_order'));
    }
    await this.logEvent('po.reprice', 'purchase_orders', po.num, {
      label: `Repriced PO ${po.num} to ${totals.total}`,
      total: po.total,
    });
    return po;
  }

  /** Archive (or restore) a PO. Nothing is destroyed — it just leaves the working views. */
  async setPoArchived(poId, archived) {
    const po = ok(await this.sb.from('purchase_orders')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', poId).select().single());
    await this.logEvent(archived ? 'po.archive' : 'po.restore', 'purchase_orders', po.num, {
      label: `${archived ? 'Archived' : 'Restored'} PO ${po.num}`,
    });
    return po;
  }

  /**
   * Delete a purchase order outright — for one entered by mistake.
   *
   * Refuses once anything on it has been received: those boxes are real stock on a
   * real shelf, and dropping the PO would either delete them or orphan them from the
   * invoice they were paid against. Close it short instead. The PO number is not
   * recycled, so a vendor holding the old email can still be matched to the record
   * in the activity log.
   */
  async deletePo(poId) {
    const po = ok(await this.sb.from('purchase_orders').select('*').eq('id', poId).single());
    const boxes = await fetchAll(() => this.sb.from('boxes').select('id,state').eq('po_id', poId));
    const received = boxes.filter((b) => b.state !== 'on_order');
    if (received.length) {
      throw new Error(`${received.length} box(es) on ${po.num} have already been received. Use "Close short" instead — deleting would remove stock that's on the shelf.`);
    }
    ok(await this.sb.from('boxes').delete().eq('po_id', poId));
    ok(await this.sb.from('payments').delete().eq('po_num', po.num).eq('hall_id', po.hall_id));
    ok(await this.sb.from('po_lines').delete().eq('po_id', poId));       // FK cascade also covers this
    ok(await this.sb.from('purchase_orders').delete().eq('id', poId));
    await this.logEvent('po.delete', 'purchase_orders', po.num, {
      label: `Deleted PO ${po.num}`,
      total: po.total, vendor_id: po.vendor_id, boxes: boxes.length,
    });
    return po;
  }

  // ---- boxes ----
  async getBoxes(hallId) { return fetchAll(() => this.sb.from('boxes').select('*').eq('hall_id', hallId).order('id')); }
  async updateBox(id, fields) { return ok(await this.sb.from('boxes').update(fields).eq('id', id).select().single()); }
  async transitionBox(id, toState) {
    // the DB trigger stamps timestamps + rejects illegal transitions
    return ok(await this.sb.from('boxes').update({ state: toState }).eq('id', id).select().single());
  }
  async createBoxes(list) { return ok(await this.sb.from('boxes').insert(list).select()); }

  /**
   * Hand-correct the count for one product. A positive delta adds boxes straight
   * into stock (a count that came up short in the system); a negative delta marks
   * boxes missing. Never silently deletes — every adjustment leaves an event with
   * the note attached, so the count can be explained later.
   */
  async adjustStock({ hallId, product, delta, note, label }) {
    const n = Math.abs(delta);
    if (!n) return;
    if (delta > 0) {
      const rows = Array.from({ length: n }, () => ({
        hall_id: hallId, product_id: product.id, state: 'in_inventory', source: 'adjust',
        cost: perBoxValue(product), serial: '', received_at: new Date().toISOString(),
      }));
      ok(await this.sb.from('boxes').insert(rows));
    } else {
      const pool = ok(await this.sb.from('boxes').select('id')
        .eq('hall_id', hallId).eq('product_id', product.id).eq('state', 'in_inventory').limit(n));
      const ids = pool.map((b) => b.id);
      // Do not silently under-apply: logging delta -5 after taking two off would
      // make the history claim something that did not happen.
      if (!ids.length) throw new Error('No boxes in stock to remove');
      if (ids.length < n) throw new Error(`Only ${ids.length} in stock — cannot take ${n} off.`);
      ok(await this.sb.from('boxes').update({ state: 'missing' }).in('id', ids));
    }
    await this.logEvent('adjust', 'products', product.id, { label, note, delta, hall: hallId });
  }

  // ---- adjustments with a reason ----
  //
  // The shape that matters is the SWAP: a distributor is out of one game and
  // hands over another. Recorded as two separate adjustments those rows only
  // connect in the head of whoever typed both, and reversing one leaves the
  // other lying. So an adjustment is a header with a reason and a note, plus one
  // line per product — a swap is one line out and one line in, a transfer is the
  // same with a different hall on each line.
  //
  // Counts are deliberately not required to balance. Distributors hand over two
  // of something for one of something else all the time, and a rule that forces
  // a match just teaches people to enter numbers that aren't true.
  async addAdjustment({ hallId, reason, note, lines, actor = 'app' }) {
    const clean = (lines || []).filter((l) => l.product_id && Number(l.delta));
    if (!clean.length) throw new Error('An adjustment needs at least one game and a count');
    if (!String(note || '').trim()) throw new Error('An adjustment needs a note saying why');

    const ids = [...new Set(clean.map((l) => l.product_id))];
    const prods = Object.fromEntries(
      (ok(await this.sb.from('products').select('*').in('id', ids))).map((p) => [p.id, p]));

    const head = ok(await this.sb.from('stock_adjustments').insert({
      hall_id: hallId, reason, note: String(note).trim(), actor,
    }).select().single());

    try {
      for (const l of clean) {
        const p = prods[l.product_id];
        if (!p) throw new Error('Unknown game on an adjustment line');
        const lineHall = l.hall_id || hallId;
        const each = perBoxValue(p);
        const n = Math.abs(Number(l.delta));
        ok(await this.sb.from('stock_adjustment_lines').insert({
          adjustment_id: head.id, hall_id: lineHall, product_id: p.id,
          delta: Number(l.delta), each_value: each,
        }).select('id'));

        if (Number(l.delta) > 0) {
          ok(await this.sb.from('boxes').insert(Array.from({ length: n }, () => ({
            hall_id: lineHall, product_id: p.id, state: 'in_inventory', cost: each,
            serial: '', received_at: new Date().toISOString(), adjustment_id: head.id, source: 'adjust',
          }))).select('id'));
        } else {
          const free = ok(await this.sb.from('boxes').select('id')
            .eq('hall_id', lineHall).eq('product_id', p.id).eq('state', 'in_inventory').limit(n));
          const pick = free.map((b) => b.id);
          if (pick.length < n) {
            throw new Error(`Only ${pick.length} ${p.name} in stock — cannot take ${n} off`);
          }
          ok(await this.sb.from('boxes').update({ state: 'missing', adjustment_id: head.id })
            .in('id', pick));
        }
      }
    } catch (e) {
      // a half-written adjustment is worse than none: undo the header and its
      // lines (boxes created so far cascade off nothing, so clear them first)
      ok(await this.sb.from('boxes').delete().eq('adjustment_id', head.id).eq('state', 'in_inventory'));
      ok(await this.sb.from('boxes').update({ state: 'in_inventory', adjustment_id: null })
        .eq('adjustment_id', head.id).eq('state', 'missing'));
      ok(await this.sb.from('stock_adjustments').delete().eq('id', head.id));
      throw e;
    }

    await this.logEvent('adjust', 'stock_adjustments', head.id, {
      label: adjustmentLabel(hallId, reason, clean, prods),
      note: String(note).trim(), reason,
      lines: clean.map((l) => ({ product: prods[l.product_id]?.name, delta: Number(l.delta) })),
      hall: hallId,
    });
    return head;
  }

  async getAdjustments(hallId, limit = 300) {
    return fetchAll(() => this.sb.from('adjustment_history').select('*')
      .eq('hall_id', hallId).order('at', { ascending: false }).limit(limit));
  }


  // ---- arrivals: every delivery received, newest first ----
  async getArrivals(hallId, limit = 60) {
    const ships = ok(await this.sb.from('shipments')
      .select('id,po_id,invoice_no,received_on,received_at,confirmed, purchase_orders(num,vendor_id)')
      .eq('hall_id', hallId).order('received_at', { ascending: false }).limit(limit));
    if (!ships.length) return [];
    const counts = {};
    const boxes = await fetchAll(() => this.sb.from('boxes').select('shipment_id')
      .in('shipment_id', ships.map((s) => s.id)));
    for (const b of boxes) counts[b.shipment_id] = (counts[b.shipment_id] || 0) + 1;
    return ships.map((s) => ({
      id: s.id, hall_id: hallId, received_at: s.received_on || String(s.received_at).slice(0, 10),
      received_ts: s.received_at, vendor_id: s.purchase_orders?.vendor_id || null,
      po_id: s.po_id, po_ref: s.purchase_orders?.num || null, invoice_no: s.invoice_no || null,
      confirmed: !!s.confirmed, boxes: counts[s.id] || 0,
    }));
  }

  // ---- BC box actions ----
  //
  // Every action writes the moment it happens: a scan on Receive puts the box in
  // stock, a scan on Open puts it on the floor. Nothing waits for a confirm button,
  // because the floor record IS the compliance record. The database trigger
  // (guard_box_state) rejects illegal moves and stamps opened_at / sold_out_at /
  // closed_at, so the time recorded is the server's, not the PC's clock.

  async _box(id) { return ok(await this.sb.from('boxes').select('*').eq('id', id).single()); }
  async _name(box) {
    const p = (ok(await this.sb.from('products').select('name').eq('id', box.product_id).limit(1)))[0];
    return `${p?.name || box.product_id}${box.serial ? ' #' + box.serial : ''}`;
  }

  /** Receive one scanned box: claim a PO placeholder for this game, or create a box. */
  async receiveBox({ hallId, shipmentId = null, poId = null, product, serial, receivedOn }) {
    const s = String(serial).trim();
    const dup = ok(await this.sb.from('boxes').select('id').eq('product_id', product.id)
      .eq('serial', s).neq('state', 'on_order').limit(1));
    if (dup.length) throw new Error(`${product.name} #${s} was already received.`);
    const when = receivedOn ? atLocalNoonIso(receivedOn, true) : new Date().toISOString();
    const fields = {
      serial: s, shipment_id: shipmentId, received_on: receivedOn || localYmd(),
      received_at: when, game_snapshot: gameSnapshot(product),
    };
    let box = null;
    if (poId) {
      const ph = ok(await this.sb.from('boxes').select('id').eq('po_id', poId)
        .eq('product_id', product.id).eq('state', 'on_order').order('id').limit(1));
      if (ph.length) {
        box = ok(await this.sb.from('boxes').update({ ...fields, state: 'in_inventory' })
          .eq('id', ph[0].id).eq('state', 'on_order').select().single());
      }
    }
    if (!box) {
      box = ok(await this.sb.from('boxes').insert({
        hall_id: hallId, product_id: product.id, po_id: poId, source: 'receive',
        cost: Number(product.cost) || 0, price_tbd: !(Number(product.cost) > 0),
        state: 'in_inventory', ...fields,
      }).select().single());
    }
    await this.logEvent('box.receive', 'boxes', box.id, {
      label: `Received ${product.name} #${s}`, product: product.id, serial: s, shipment_id: shipmentId,
    });
    return box;
  }

  /** Undo a receive: a claimed placeholder goes back on order, a created box is removed. */
  async undoReceiveBox(boxId) {
    const b = await this._box(boxId);
    if (b.state !== 'in_inventory') throw new Error('That box has already moved on — it can\'t be un-received.');
    if (b.source === 'po') {
      ok(await this.sb.from('boxes').update({
        state: 'on_order', serial: '', shipment_id: null, received_at: null, received_on: null, game_snapshot: null,
      }).eq('id', boxId));
    } else {
      ok(await this.sb.from('boxes').delete().eq('id', boxId));
    }
    await this.logEvent('box.unreceive', 'boxes', boxId, { label: 'Receive undone' });
  }

  async openBox(boxId, { openedOn } = {}) {
    // only a SEALED box opens. Without the state filter, a box another PC already
    // sold out would be reopened through the trigger's undo path, keeping its old
    // close stamp and landing on the wrong day of the report.
    const rows = ok(await this.sb.from('boxes').update({ state: 'opened', opened_on: openedOn || localYmd() })
      .eq('id', boxId).eq('state', 'in_inventory').select());
    if (!rows.length) {
      const cur = await this._box(boxId);
      throw new Error(`That box is already ${cur.state === 'opened' ? 'open' : cur.state.replace('_', ' ')}.`);
    }
    const box = rows[0];
    await this.logEvent('box.open', 'boxes', boxId, { label: `Opened ${await this._name(box)}`, opened_on: box.opened_on });
    return box;
  }
  async undoOpen(boxId) {
    const box = ok(await this.sb.from('boxes').update({ state: 'in_inventory', opened_at: null, opened_on: null, tickets_remaining: null })
      .eq('id', boxId).select().single());
    await this.logEvent('box.unopen', 'boxes', boxId, { label: `Open undone — ${await this._name(box)}` });
  }

  /** Tickets left at the end of a session. The box stays open; every count is kept. */
  async recordRemainder(boxId, ticketsLeft, { sessionDate } = {}) {
    const b = await this._box(boxId);
    if (b.state !== 'opened') throw new Error('Only an open box can have a remainder.');
    const prods = ok(await this.sb.from('products').select('*').eq('id', b.product_id));
    const n = checkCount(ticketsLeft, b, prods);
    const row = ok(await this.sb.from('box_counts').insert({
      box_id: boxId, hall_id: b.hall_id, tickets_left: n, kind: 'remainder',
      session_date: sessionDate || localYmd(),
    }).select().single());
    ok(await this.sb.from('boxes').update({ tickets_remaining: n }).eq('id', boxId));
    await this.logEvent('box.remainder', 'boxes', boxId, { label: `Remainder ${n} tickets — ${await this._name(b)}`, tickets_left: n });
    return row;
  }
  async undoRemainder(countId) {
    const row = ok(await this.sb.from('box_counts').select('*').eq('id', countId).maybeSingle());
    if (!row) return;
    ok(await this.sb.from('box_counts').delete().eq('id', countId));
    const prev = ok(await this.sb.from('box_counts').select('tickets_left').eq('box_id', row.box_id)
      .order('counted_at', { ascending: false }).limit(1));
    ok(await this.sb.from('boxes').update({ tickets_remaining: prev[0]?.tickets_left ?? null }).eq('id', row.box_id));
  }

  async soldOut(boxId, { sessionDate } = {}) {
    const box = ok(await this.sb.from('boxes').update({ state: 'sold_out', tickets_remaining: 0, closed_on: sessionDate || localYmd() })
      .eq('id', boxId).select().single());
    await this.logEvent('box.soldout', 'boxes', boxId, { label: `Sold out — ${await this._name(box)}` });
    return box;
  }

  /** Retire an open box that will not sell out, recording what was left in it. */
  async closeUnsold(boxId, ticketsLeft, { sessionDate } = {}) {
    const b = await this._box(boxId);
    transition(b, 'closed_unsold');                       // readable error before the DB's
    const prods = ok(await this.sb.from('products').select('*').eq('id', b.product_id));
    const n = checkCount(ticketsLeft, b, prods);
    const box = ok(await this.sb.from('boxes').update({ state: 'closed_unsold', tickets_remaining: n, closed_on: sessionDate || localYmd() })
      .eq('id', boxId).select().single());
    ok(await this.sb.from('box_counts').insert({
      box_id: boxId, hall_id: b.hall_id, tickets_left: n, kind: 'close', session_date: sessionDate || localYmd(),
    }));
    await this.logEvent('box.close_unsold', 'boxes', boxId, { label: `Closed unsold, ${n} tickets left — ${await this._name(box)}`, tickets_left: n });
    return box;
  }

  /** Undo a sold out or close-unsold: back to open. */
  async reopenBox(boxId) {
    const b = await this._box(boxId);
    if (b.state === 'closed_unsold') {
      const last = ok(await this.sb.from('box_counts').select('id').eq('box_id', boxId).eq('kind', 'close')
        .order('counted_at', { ascending: false }).limit(1));
      if (last.length) ok(await this.sb.from('box_counts').delete().eq('id', last[0].id));
    }
    const prev = ok(await this.sb.from('box_counts').select('tickets_left').eq('box_id', boxId)
      .order('counted_at', { ascending: false }).limit(1));
    const box = ok(await this.sb.from('boxes').update({
      state: 'opened', sold_out_at: null, closed_at: null, closed_on: null, tickets_remaining: prev[0]?.tickets_left ?? null,
    }).eq('id', boxId).select().single());
    await this.logEvent('box.reopen', 'boxes', boxId, { label: `Reopened — ${await this._name(box)}` });
    return box;
  }

  async getBoxCounts(hallId) {
    return fetchAll(() => this.sb.from('box_counts').select('*').eq('hall_id', hallId).order('counted_at'));
  }


  // ---- receiving ----
  async createShipment(s) { return ok(await this.sb.from('shipments').insert(s).select().single()); }
  /**
   * Mark a shipment received, and put it on the history.
   *
   * Receiving used to write boxes and nothing else, so a confirmed delivery left
   * no trace on the history at all — the only way to see what had actually turned
   * up against an order was to query the boxes table. `summary` is the human part
   * (which PO, which invoice, how many short); the line detail is never snapshotted
   * here because the boxes themselves are the record — see getReceiptDetail.
   */
  async confirmShipment(id, summary = {}) {
    const patch = { confirmed: true };
    if (summary.invoice_no) patch.invoice_no = summary.invoice_no;
    const row = ok(await this.sb.from('shipments').update(patch).eq('id', id).select().single());
    const po = row.po_id
      ? ok(await this.sb.from('purchase_orders').select('num,hall_id,vendor_id').eq('id', row.po_id).single())
      : null;
    await this.logEvent('shipment.receive', 'shipments', id, {
      label: `${po?.num || 'Delivery'} received`
        + (summary.invoice_no ? ` — invoice ${summary.invoice_no}` : '')
        + (summary.boxes != null ? ` — ${summary.boxes} box(es)` : '')
        + (summary.missing ? `, ${summary.missing} short` : ''),
      po_id: row.po_id, po_num: po?.num, hall: po?.hall_id, vendor_id: po?.vendor_id,
      invoice_no: summary.invoice_no || null, boxes: summary.boxes ?? null,
      missing: summary.missing || 0, amount: summary.amount ?? null,
    });
    return row;
  }

  /**
   * What actually arrived on one shipment, by game.
   *
   * Read from the boxes, not from a snapshot taken at confirm time. A box can be
   * adjusted, marked missing or swapped afterwards, and the question "what did
   * this delivery bring us" should answer with the boxes that exist, including
   * anything that turned up which was never on the order.
   */
  async getReceiptDetail(shipmentId) {
    const rows = await fetchAll(() => this.sb.from('boxes')
      .select('id,product_id,cost,state,serial,po_id').eq('shipment_id', shipmentId));
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((b) => b.product_id).filter(Boolean))];
    const prods = Object.fromEntries((ok(await this.sb.from('products').select('id,name').in('id', ids)))
      .map((p) => [p.id, p.name]));
    const byProduct = {};
    for (const b of rows) {
      const g = (byProduct[b.product_id] ||= {
        product_id: b.product_id, name: prods[b.product_id] || b.product_id,
        boxes: 0, value: 0, serials: [], states: {},
      });
      g.boxes += 1;
      g.value = round2(g.value + (Number(b.cost) || 0));
      if (b.serial) g.serials.push(b.serial);
      g.states[b.state] = (g.states[b.state] || 0) + 1;
    }
    return Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getShipments(hallId) {
    return fetchAll(() => this.sb.from('shipments').select('*').eq('hall_id', hallId));
  }
  async uploadInvoicePhoto(file) {
    const path = `invoices/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
    const { error } = await this.sb.storage.from('invoices').upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }
  getPhotoUrl(path) {
    const { data } = this.sb.storage.from('invoices').getPublicUrl(path);
    return data.publicUrl;
  }

  // ---- payments ----
  async getPayments(hallId) { return fetchAll(() => this.sb.from('payments').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }
  async addPayment(p) { return ok(await this.sb.from('payments').insert(p).select().single()); }
  async setPaymentStatus(id, status) { ok(await this.sb.from('payments').update({ status }).eq('id', id)); }

  // ---- emails: real sending via the send-email edge function ----
  async sendEmails(list, hallId) {
    const [settings, allSenders] = await Promise.all([this.getSetting('email'), this.getSetting('sender')]);
    const sender = senderFor(allSenders, hallId);
    const { data, error } = await this.sb.functions.invoke('send-email', {
      body: { emails: list, hall_id: hallId, settings, sender },
    });
    if (error) throw new Error('send-email failed: ' + error.message);
    // The function reports per-email status and used to be ignored, so a bounced
    // address produced a cheerful "delivered to vendors" and a logged email the
    // vendor never got. Surface the failures; the caller decides what to say.
    const logs = data.logs || [];
    const failed = logs.filter((l) => l && l.status !== 'sent');
    if (failed.length) {
      const why = failed.map((l) => `${l.to_addr || 'no address'}: ${l.error || 'failed'}`).join('; ');
      const err = new Error(`${failed.length} of ${logs.length} email(s) did not send — ${why}`);
      err.partial = { logs, failed };     // some may have gone: don't let the caller resend blindly
      throw err;
    }
    return logs;
  }
  async getEmails(hallId) { return fetchAll(() => this.sb.from('emails').select('*').eq('hall_id', hallId).order('created_at', { ascending: false })); }

  // ---- settings / events ----
  async getSetting(key) {
    const rows = ok(await this.sb.from('settings').select('value').eq('key', key));
    return rows[0]?.value;
  }
  async setSetting(key, value) { ok(await this.sb.from('settings').upsert({ key, value })); }
  /**
   * Activity, as a person would describe it.
   *
   * There is a row-level audit trigger writing an event for every insert, update
   * and delete — thousands of them, none carrying a label. Those are forensics,
   * not activity: loading one invoice writes 300 of them and pushes everything
   * legible off the end of a 12-row panel. Recording the five August deliveries
   * buried the whole feed under 615 unlabelled rows in a single afternoon.
   *
   * So this returns the events the app deliberately logged. Pass raw:true for the
   * audit trail.
   */
  async getEvents(limit = 200, { raw = false } = {}) {
    let qy = this.sb.from('events').select('*');
    if (!raw) qy = qy.not('kind', 'in', '("insert","update","delete")');
    return ok(await qy.order('at', { ascending: false }).limit(limit));
  }
  async logEvent(kind, entity, entity_id, detail = {}) {
    ok(await this.sb.from('events').insert({ kind, entity, entity_id, detail, actor: 'app' }));
  }

  // ---- AI invoice/label reading via edge function ----
  async readInvoicePhoto(path) {
    const { data, error } = await this.sb.functions.invoke('read-invoice', { body: { path } });
    if (error) throw new Error('read-invoice failed: ' + error.message);
    return data;
  }
}
