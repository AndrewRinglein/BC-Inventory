// Demo store: full app behavior with data in this browser's localStorage.
// Lets the app run before Supabase is set up, and doubles as the training/demo sandbox.

import { CATALOG } from '../../data/catalog.js';
import { perBoxValue } from '../logic/pricing.js';
import { transition } from '../logic/boxes.js';
import { gameSnapshot, checkCount, atLocalNoonIso, localYmd } from '../logic/bc.js';
import { normSerial } from '../logic/scan.js';

const uid = () => 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class DemoStore {
  isDemo = true;

  constructor(staged = false) {
    this.staged = staged;                                  // staged sandbox (?demo) vs plain local mode
    this.lsKey = staged ? 'bc_inv_sandbox_v1' : 'bc_inv_v1';
  }

  async init() {
    const raw = localStorage.getItem(this.lsKey);
    if (raw) {
      try { this.db = JSON.parse(raw); } catch { this.db = null; }
    }
    if (!this.db || !this.db.products) this.db = this.staged ? stagedSeed() : seed();
    this._save();
  }
  async resetDemo() {                                      // "Reset demo data" button
    this.db = this.staged ? stagedSeed() : seed();
    this._save();
  }
  _save() { try { localStorage.setItem(this.lsKey, JSON.stringify(this.db)); } catch {} }
  _event(kind, entity, entity_id, detail = {}) {
    this.db.events.unshift({ at: new Date().toISOString(), actor: 'demo', kind, entity, entity_id, detail });
    this.db.events = this.db.events.slice(0, 2000);
  }

  // ---- auth (demo: single password stored in settings) ----
  async signIn(_email, pass) {
    const ok = pass === (this.db.settings.demo_password || 'boxes');
    if (ok) {
      this.session = { email: 'demo@bc.local' };
      try { localStorage.setItem(this.lsKey + '_session', '1'); } catch {}
      return { ok: true };
    }
    return { ok: false, error: 'Wrong password (demo default: boxes)' };
  }
  async signOut() {
    this.session = null;
    try { localStorage.removeItem(this.lsKey + '_session'); } catch {}
  }
  async getSession() {
    if (!this.session) {
      try { if (localStorage.getItem(this.lsKey + '_session')) this.session = { email: 'demo@bc.local' }; } catch {}
    }
    return this.session || null;
  }

  // ---- catalog ----
  async getVendors() { return [...this.db.vendors]; }
  async getProducts() { return [...this.db.products]; }
  // mirrors SupabaseStore.updateProduct — a rename keeps the old name as an alias
  // so hand-typed session sheets go on matching
  async updateProduct(id, fields) {
    const p = this.db.products.find((x) => x.id === id);
    if (!p) throw new Error('product not found');
    const patch = { ...fields };
    if (patch.name != null) {
      const old = (p.name || '').trim();
      const next = String(patch.name).trim();
      const key = (v) => v.trim().toLowerCase();
      if (old && old !== next) {
        const have = p.aliases || [];
        if (!have.some((a) => key(a) === key(old))) patch.aliases = [...have, old];
      }
    }
    Object.assign(p, patch);
    this._event('update', 'products', id, { fields: patch });
    this._save();
    return { ...p };
  }
  async addProduct(p) {
    const row = { id: 'C' + Date.now(), active: true, ...p };
    this.db.products.push(row);
    this._event('insert', 'products', row.id, {});
    this._save();
    return row;
  }
  async addVendor(v) {
    const row = { id: v.id, name: v.name, email: v.email || '', contact_name: '', tax_rate: 0, active: true };
    if (this.db.vendors.some((x) => x.id === row.id)) throw new Error('That distributor already exists');
    this.db.vendors.push(row); this._save(); return { ...row };
  }
  async updateVendor(id, fields) {
    const v = this.db.vendors.find((x) => x.id === id);
    Object.assign(v, fields); this._save(); return { ...v };
  }

  // ---- order builder quantities ----
  async getOrderQty(hallId) { return { ...(this.db.order_qty[hallId] || {}) }; }
  async setOrderQty(hallId, productId, qty) {
    const h = (this.db.order_qty[hallId] ||= {});
    if (qty > 0) h[productId] = qty; else delete h[productId];
    this._save();
  }
  async clearOrderQty(hallId) { this.db.order_qty[hallId] = {}; this._save(); }

  // ---- purchase orders ----
  async createSentPos(hallId, drafts, numbered, opts = {}) {
    // numbered: [{...draft, num}] — numbering handled by caller via settings po_sequence
    // opts.recordedOnly: placed outside this system, no email follows.
    // opts.placedAt: backdate it (and its boxes) to the day it was really placed.
    const { recordedOnly = false, placedAt = null, vendorRef = '' } = opts;
    const when = placedAt || new Date().toISOString();
    const created = [];
    for (const d of numbered) {
      const po = {
        id: uid(), num: d.num, hall_id: hallId, vendor_id: d.vendor_id, status: 'sent',
        subtotal: d.subtotal, tax: d.tax, total: d.total,
        price_tbd_lines: d.lines.filter((l) => l.price_tbd).length,
        sent_at: when, created_at: when,
        recorded_only: recordedOnly, vendor_ref: vendorRef || null,
      };
      this.db.purchase_orders.push(po);
      for (const l of d.lines) {
        const { per_box_cost, ...rec } = l;
        const split_boxes = l.split_boxes;
        this.db.po_lines.push({ id: uid(), po_id: po.id, ...rec });
        if (l.kind === 'fee' || !l.product_id) continue;   // packing charge: no boxes
        for (let i = 0; i < l.qty * (split_boxes || 1); i++) {
          this.db.boxes.push({
            id: uid(), hall_id: hallId, product_id: l.product_id, po_id: po.id,
            shipment_id: null, serial: '', cost: per_box_cost ?? l.cost, price_tbd: !!l.price_tbd, state: 'on_order',
            source: 'po', ordered_at: when,
            received_at: null, opened_at: null, sold_out_at: null,
          });
        }
      }
      this._event(recordedOnly ? 'po.record' : 'insert', 'purchase_orders', po.num,
        recordedOnly ? { label: `Recorded PO ${po.num} (no email sent)`, placed_at: when, vendor_ref: vendorRef || null } : {});
      created.push(po);
    }
    this._save();
    return created;
  }
  async getPos(hallId) { return this.db.purchase_orders.filter((p) => p.hall_id === hallId); }
  async getPoLines(poId) { return this.db.po_lines.filter((l) => l.po_id === poId); }

  // mirrors SupabaseStore.getPoLinesFor — lines for several orders, grouped by po_id
  async getPoLinesFor(poIds = []) {
    const ids = [...new Set(poIds.filter(Boolean))];
    const out = {};
    for (const id of ids) out[id] = [];
    for (const l of this.db.po_lines || []) {
      if (out[l.po_id]) out[l.po_id].push(l);
    }
    return out;
  }
  async setPoStatus(poId, status) {
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    po.status = status;
    this._event('update', 'purchase_orders', po.num, { status });
    this._save();
  }

  async repricePo(poId, lines, totals) {
    for (const l of lines) {
      const row = this.db.po_lines.find((x) => x.id === l.id);
      if (row) Object.assign(row, {
        cost: l.cost, base_cost: l.base_cost, pack_units: l.pack_units,
        packing_each: l.packing_each, price_tbd: !!l.price_tbd,
      });
    }
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    Object.assign(po, {
      subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
      price_tbd_lines: lines.filter((l) => l.price_tbd).length,
    });
    for (const l of lines) {
      if (!l.product_id || l.kind === 'fee') continue;
      const per = l.split_boxes > 1 ? Math.round((l.cost / l.split_boxes) * 100) / 100 : l.cost;
      for (const b of this.db.boxes) {
        if (b.po_id === poId && b.product_id === l.product_id && b.state === 'on_order') {
          b.cost = per; b.price_tbd = !!l.price_tbd;
        }
      }
    }
    this._event('po.reprice', 'purchase_orders', po.num, { label: `Repriced PO ${po.num}`, total: po.total });
    this._save();
    return po;
  }

  async setPoArchived(poId, archived) {
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    if (!po) throw new Error('That order is gone');
    po.archived_at = archived ? new Date().toISOString() : null;
    this._event(archived ? 'po.archive' : 'po.restore', 'purchase_orders', po.num, {
      label: `${archived ? 'Archived' : 'Restored'} PO ${po.num}`,
    });
    this._save();
    return po;
  }

  async deletePo(poId) {
    const po = this.db.purchase_orders.find((p) => p.id === poId);
    if (!po) throw new Error('That order is already gone');
    const mine = this.db.boxes.filter((b) => b.po_id === poId);
    const received = mine.filter((b) => b.state !== 'on_order');
    if (received.length) {
      throw new Error(`${received.length} box(es) on ${po.num} have already been received. Use "Close short" instead — deleting would remove stock that's on the shelf.`);
    }
    this.db.boxes = this.db.boxes.filter((b) => b.po_id !== poId);
    this.db.po_lines = this.db.po_lines.filter((l) => l.po_id !== poId);
    this.db.payments = this.db.payments.filter((x) => x.po_num !== po.num);
    this.db.purchase_orders = this.db.purchase_orders.filter((p) => p.id !== poId);
    this._event('po.delete', 'purchase_orders', po.num, {
      label: `Deleted PO ${po.num}`,
      total: po.total, vendor_id: po.vendor_id, boxes: mine.length,
    });
    this._save();
    return po;
  }

  // ---- boxes ----
  async getBoxes(hallId) { return this.db.boxes.filter((b) => b.hall_id === hallId); }
  async updateBox(id, fields) {
    const b = this.db.boxes.find((x) => x.id === id);
    Object.assign(b, fields); this._save(); return { ...b };
  }
  async transitionBox(id, toState) {
    const i = this.db.boxes.findIndex((x) => x.id === id);
    const next = transition(this.db.boxes[i], toState);   // throws on illegal move
    this.db.boxes[i] = next;
    this._event('box.state', 'boxes', id, { to: toState, product: next.product_id });
    this._save();
    return { ...next };
  }
  async createBoxes(list) {
    const rows = list.map((b) => ({ id: uid(), ...b }));
    this.db.boxes.push(...rows); this._save(); return rows;
  }

  async adjustStock({ hallId, product, delta, note, label }) {
    const n = Math.abs(delta);
    if (!n) return;
    if (delta > 0) {
      for (let i = 0; i < n; i++) {
        this.db.boxes.push({
          id: uid(), hall_id: hallId, product_id: product.id, state: 'in_inventory',
          cost: perBoxValue(product), serial: '', source: 'adjust',
          ordered_at: new Date().toISOString(), received_at: new Date().toISOString(),
        });
      }
    } else {
      const pool = this.db.boxes.filter((b) => b.hall_id === hallId && b.product_id === product.id
        && b.state === 'in_inventory');
      if (!pool.length) throw new Error('No boxes in stock to remove');
      // mirrors supabaseStore: never under-apply and log the full delta
      if (pool.length < n) {
        throw new Error(`Only ${pool.length} in stock — cannot take ${n} off.`);
      }
      for (const b of pool.slice(0, n)) b.state = 'missing';
    }
    this._event('adjust', 'products', product.id, { label, note, delta, hall: hallId });
    this._save();
  }

  // ---- adjustments with a reason ---- (mirrors supabaseStore)
  async addAdjustment({ hallId, reason, note, lines, actor = 'demo' }) {
    // Snapshot before touching anything. supabaseStore rolls a failed multi-line
    // adjustment back; without this the demo left the first line's boxes written
    // off plus an orphan header when a later line could not be covered — newly
    // reachable now that the pool is floor-only.
    const snapshot = JSON.stringify({
      boxes: this.db.boxes, adj: this.db.stock_adjustments || [],
      lines: this.db.stock_adjustment_lines || [],
    });
    const rollback = () => {
      const prev = JSON.parse(snapshot);
      this.db.boxes = prev.boxes;
      this.db.stock_adjustments = prev.adj;
      this.db.stock_adjustment_lines = prev.lines;
    };
    try {
    const clean = (lines || []).filter((l) => l.product_id && Number(l.delta));
    if (!clean.length) throw new Error('An adjustment needs at least one game and a count');
    if (!String(note || '').trim()) throw new Error('An adjustment needs a note saying why');
    const head = { id: uid(), hall_id: hallId, at: new Date().toISOString(),
                   reason, note: String(note).trim(), actor };
    (this.db.stock_adjustments ||= []).push(head);
    const names = {};
    for (const l of clean) {
      const p = this.db.products.find((x) => x.id === l.product_id);
      if (!p) throw new Error('Unknown game on an adjustment line');
      names[l.product_id] = p.name;
      const lineHall = l.hall_id || hallId;
      const each = perBoxValue(p);
      const n = Math.abs(Number(l.delta));
      (this.db.stock_adjustment_lines ||= []).push({
        id: uid(), adjustment_id: head.id, hall_id: lineHall,
        product_id: p.id, delta: Number(l.delta), each_value: each });
      if (Number(l.delta) > 0) {
        for (let i = 0; i < n; i++) this.db.boxes.push({
          id: uid(), hall_id: lineHall, product_id: p.id, state: 'in_inventory',
          cost: each, serial: '', source: 'adjust', adjustment_id: head.id,
          received_at: new Date().toISOString() });
      } else {
        const pool = this.db.boxes.filter((b) => b.hall_id === lineHall
          && b.product_id === p.id && b.state === 'in_inventory');
        if (pool.length < n) throw new Error(`Only ${pool.length} ${p.name} in stock — cannot take ${n} off`);
        for (const b of pool.slice(0, n)) { b.state = 'missing'; b.adjustment_id = head.id; }
      }
    }
    const parts = clean.map((l) => `${Number(l.delta) > 0 ? '+' : '−'}${Math.abs(Number(l.delta))} ${names[l.product_id]}`);
    this._event('adjust', 'stock_adjustments', head.id, {
      label: `${reason}: ${parts.join(', ')}`,
      note: head.note, reason, hall: hallId });
    this._save();
    return head;
    } catch (e) { rollback(); this._save(); throw e; }
  }

  async getAdjustments(hallId) {
    const heads = (this.db.stock_adjustments || []).filter((a) => a.hall_id === hallId);
    const byId = Object.fromEntries(heads.map((h) => [h.id, h]));
    return (this.db.stock_adjustment_lines || [])
      .filter((l) => byId[l.adjustment_id])
      .map((l) => {
        const a = byId[l.adjustment_id];
        const p = this.db.products.find((x) => x.id === l.product_id) || {};
        return { ...a, ...l, booked_hall: a.hall_id, hall_id: l.hall_id,
                 game: p.name,
                 value_change: Math.round(l.delta * l.each_value * 100) / 100 };
      })
      .sort((x, y) => String(y.at).localeCompare(String(x.at)));
  }


  // ---- arrivals: every delivery received, newest first ----
  async getArrivals(hallId, limit = 60) {
    const pos = Object.fromEntries((this.db.purchase_orders || []).map((p) => [p.id, p]));
    return (this.db.shipments || [])
      .filter((sh) => sh.hall_id === hallId)
      .map((sh) => ({
        id: sh.id, hall_id: hallId,
        received_at: sh.received_on || String(sh.received_at).slice(0, 10), received_ts: sh.received_at,
        vendor_id: pos[sh.po_id]?.vendor_id || null, po_id: sh.po_id || null, po_ref: pos[sh.po_id]?.num || null,
        invoice_no: sh.invoice_no || null, confirmed: !!sh.confirmed,
        boxes: (this.db.boxes || []).filter((b) => b.shipment_id === sh.id).length,
      }))
      .sort((a, b) => String(b.received_ts).localeCompare(String(a.received_ts)))
      .slice(0, limit);
  }

  // ---- BC box actions (mirrors SupabaseStore exactly) ----
  //
  // Every action writes the moment it happens: a scan on Receive puts the box in
  // stock, a scan on Open puts it on the floor. Nothing waits for a confirm button,
  // because the floor record IS the compliance record.

  /** Receive one scanned box: claim a PO placeholder for this game, or create a box. */
  async receiveBox({ hallId, shipmentId = null, poId = null, product, serial, receivedOn }) {
    const s = normSerial(serial);
    const dup = this.db.boxes.find((b) => b.product_id === product.id && normSerial(b.serial) === s && b.serial && b.state !== 'on_order');
    if (dup) throw new Error(`${product.name} #${s} was already received.`);
    const when = receivedOn ? atLocalNoonIso(receivedOn, true) : new Date().toISOString();
    const fields = {
      serial: s, shipment_id: shipmentId, received_on: receivedOn || localYmd(),
      received_at: when, game_snapshot: gameSnapshot(product),
    };
    let box = poId && this.db.boxes.find((b) => b.po_id === poId && b.product_id === product.id && b.state === 'on_order');
    if (box) {
      Object.assign(box, fields, { state: 'in_inventory' });
    } else {
      box = { id: uid(), hall_id: hallId, product_id: product.id, po_id: poId, source: 'receive',
        cost: Number(product.cost) || 0, price_tbd: !(Number(product.cost) > 0), state: 'in_inventory',
        ordered_at: null, opened_at: null, sold_out_at: null, closed_at: null, ...fields };
      this.db.boxes.push(box);
    }
    this._event('box.receive', 'boxes', box.id, { label: `Received ${product.name} #${s}`, product: product.id, serial: s, shipment_id: shipmentId });
    this._save();
    return { ...box };
  }

  /** Undo a receive: a claimed placeholder goes back on order, a created box is removed. */
  async undoReceiveBox(boxId) {
    const b = this.db.boxes.find((x) => x.id === boxId);
    if (!b) return;
    if (b.state !== 'in_inventory') throw new Error('That box has already moved on — it can\'t be un-received.');
    if (b.source === 'po') {
      Object.assign(b, { state: 'on_order', serial: '', shipment_id: null, received_at: null, received_on: null, game_snapshot: null });
    } else {
      this.db.boxes = this.db.boxes.filter((x) => x.id !== boxId);
    }
    this._event('box.unreceive', 'boxes', boxId, { label: 'Receive undone' });
    this._save();
  }

  /** Open a box on the floor. openedOn = the session date picked on the Open screen. */
  async openBox(boxId, { openedOn } = {}) {
    const i = this.db.boxes.findIndex((x) => x.id === boxId);
    const cur = this.db.boxes[i];
    if (cur.state !== 'in_inventory') throw new Error(`That box is already ${cur.state === 'opened' ? 'open' : cur.state.replace('_', ' ')}.`);
    const next = transition(cur, 'opened');
    next.opened_on = openedOn || localYmd();
    this.db.boxes[i] = next;
    this._event('box.open', 'boxes', boxId, { label: `Opened ${this._nm(next)}`, opened_on: next.opened_on });
    this._save();
    return { ...next };
  }
  async undoOpen(boxId) {
    const i = this.db.boxes.findIndex((x) => x.id === boxId);
    this.db.boxes[i] = { ...transition(this.db.boxes[i], 'in_inventory'), tickets_remaining: null };
    this._event('box.unopen', 'boxes', boxId, { label: `Open undone — ${this._nm(this.db.boxes[i])}` });
    this._save();
  }

  /** Tickets left at the end of a session. The box stays open; every count is kept. */
  async recordRemainder(boxId, ticketsLeft, { sessionDate } = {}) {
    const b = this.db.boxes.find((x) => x.id === boxId);
    if (!b || b.state !== 'opened') throw new Error('Only an open box can have a remainder.');
    const n = checkCount(ticketsLeft, b, this.db.products);
    const row = { id: uid(), box_id: boxId, hall_id: b.hall_id, tickets_left: n,
      session_date: sessionDate || localYmd(), counted_at: new Date().toISOString(), kind: 'remainder' };
    (this.db.box_counts ||= []).push(row);
    b.tickets_remaining = n;
    this._event('box.remainder', 'boxes', boxId, { label: `Remainder ${n} tickets — ${this._nm(b)}`, tickets_left: n });
    this._save();
    return row;
  }
  async undoRemainder(countId) {
    const row = (this.db.box_counts || []).find((c) => c.id === countId);
    if (!row) return;
    this.db.box_counts = this.db.box_counts.filter((c) => c.id !== countId);
    const b = this.db.boxes.find((x) => x.id === row.box_id);
    const prev = this.db.box_counts.filter((c) => c.box_id === row.box_id)
      .sort((x, y) => String(y.counted_at).localeCompare(String(x.counted_at)))[0];
    if (b) b.tickets_remaining = prev ? prev.tickets_left : null;
    this._save();
  }

  async soldOut(boxId, { sessionDate } = {}) {
    const i = this.db.boxes.findIndex((x) => x.id === boxId);
    const next = transition(this.db.boxes[i], 'sold_out');
    next.tickets_remaining = 0;
    next.closed_on = sessionDate || localYmd();
    this.db.boxes[i] = next;
    this._event('box.soldout', 'boxes', boxId, { label: `Sold out — ${this._nm(next)}` });
    this._save();
    return { ...next };
  }

  /** Retire an open box that will not sell out, recording what was left in it. */
  async closeUnsold(boxId, ticketsLeft, { sessionDate } = {}) {
    const i = this.db.boxes.findIndex((x) => x.id === boxId);
    const b = this.db.boxes[i];
    const n = checkCount(ticketsLeft, b, this.db.products);
    const next = transition(b, 'closed_unsold');
    next.tickets_remaining = n;
    next.closed_on = sessionDate || localYmd();
    this.db.boxes[i] = next;
    (this.db.box_counts ||= []).push({ id: uid(), box_id: boxId, hall_id: b.hall_id, tickets_left: n,
      session_date: sessionDate || localYmd(), counted_at: new Date().toISOString(), kind: 'close' });
    this._event('box.close_unsold', 'boxes', boxId, { label: `Closed unsold, ${n} tickets left — ${this._nm(next)}`, tickets_left: n });
    this._save();
    return { ...next };
  }

  /** Undo a sold out or close-unsold: back to open. */
  async reopenBox(boxId) {
    const i = this.db.boxes.findIndex((x) => x.id === boxId);
    const b = this.db.boxes[i];
    const wasClose = b.state === 'closed_unsold';
    const next = transition(b, 'opened');
    if (wasClose) {
      // drop the close count; the last remainder (if any) is the count again
      const mine = (this.db.box_counts || []).filter((c) => c.box_id === boxId && c.kind === 'close')
        .sort((x, y) => String(y.counted_at).localeCompare(String(x.counted_at)));
      if (mine[0]) this.db.box_counts = this.db.box_counts.filter((c) => c.id !== mine[0].id);
    }
    const prev = (this.db.box_counts || []).filter((c) => c.box_id === boxId)
      .sort((x, y) => String(y.counted_at).localeCompare(String(x.counted_at)))[0];
    next.tickets_remaining = prev ? prev.tickets_left : null;
    next.closed_on = null;
    this.db.boxes[i] = next;
    this._event('box.reopen', 'boxes', boxId, { label: `Reopened — ${this._nm(next)}` });
    this._save();
    return { ...next };
  }

  async getBoxCounts(hallId) {
    return (this.db.box_counts || []).filter((c) => c.hall_id === hallId);
  }

  _nm(b) {
    const p = this.db.products.find((x) => x.id === b.product_id);
    return `${p?.name || b.product_id}${b.serial ? ' #' + b.serial : ''}`;
  }


  // ---- receiving ----
  async createShipment(s) {
    const row = { id: uid(), confirmed: false, received_at: new Date().toISOString(), ...s };
    this.db.shipments.push(row); this._save(); return row;
  }
  async confirmShipment(id, summary = {}) {
    const s = this.db.shipments.find((x) => x.id === id);
    s.confirmed = true;
    if (summary.invoice_no) s.invoice_no = summary.invoice_no;
    const po = this.db.purchase_orders.find((p) => p.id === s.po_id);
    this._event('shipment.receive', 'shipments', id, {
      label: `${po?.num || 'Delivery'} received`
        + (summary.invoice_no ? ` — invoice ${summary.invoice_no}` : '')
        + (summary.boxes != null ? ` — ${summary.boxes} box(es)` : '')
        + (summary.missing ? `, ${summary.missing} short` : ''),
      po_id: s.po_id, po_num: po?.num, hall: po?.hall_id, vendor_id: po?.vendor_id,
      invoice_no: summary.invoice_no || null, boxes: summary.boxes ?? null,
      missing: summary.missing || 0, amount: summary.amount ?? null,
    });
    this._save(); return s;
  }
  /** mirror of supabaseStore.getReceiptDetail — read the boxes, not a snapshot */
  async getReceiptDetail(shipmentId) {
    const rows = (this.db.boxes || []).filter((b) => b.shipment_id === shipmentId);
    const byProduct = {};
    for (const b of rows) {
      const p = (this.db.products || []).find((x) => x.id === b.product_id);
      const g = (byProduct[b.product_id] ||= {
        product_id: b.product_id, name: p?.name || b.product_id,
        boxes: 0, value: 0, serials: [], states: {},
      });
      g.boxes += 1;
      g.value = Math.round((g.value + (Number(b.cost) || 0)) * 100) / 100;
      if (b.serial) g.serials.push(b.serial);
      g.states[b.state] = (g.states[b.state] || 0) + 1;
    }
    return Object.values(byProduct).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getShipments(hallId) {
    return this.db.shipments.filter((s) => s.hall_id === hallId);
  }
  async uploadInvoicePhoto(file) {
    // demo: keep as data URL in memory-limited slot
    const dataUrl = await new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file);
    });
    const path = 'demo/' + uid();
    (this.db.photos ||= {})[path] = dataUrl.slice(0, 500000);   // cap size in demo
    this._save();
    return path;
  }
  getPhotoUrl(path) { return (this.db.photos || {})[path] || null; }

  // ---- payments ----
  async getPayments(hallId) { return this.db.payments.filter((p) => p.hall_id === hallId); }
  async addPayment(p) {
    const row = { id: uid(), status: 'open', created_at: new Date().toISOString(), ...p };
    this.db.payments.push(row);
    this._event('insert', 'payments', row.id, { amount: p.amount });
    this._save(); return row;
  }
  async setPaymentStatus(id, status) {
    const p = this.db.payments.find((x) => x.id === id);
    p.status = status;
    this._event('update', 'payments', id, { status });
    this._save();
  }

  // ---- emails (demo: log only, clearly marked) ----
  async sendEmails(list, hallId) {
    const logs = list.map((e) => ({
      id: uid(), hall_id: hallId, po_num: e.po_num || null, kind: e.kind,
      to_addr: e.to, subject: e.subject, body: e.body,
      test_mode: true, provider_id: null,
      status: 'sent', created_at: new Date().toISOString(),
      demo_note: 'DEMO MODE — not actually sent',
    }));
    this.db.emails.push(...logs);
    this._event('emails.send', 'emails', String(list.length), {});
    this._save();
    return logs;
  }
  async getEmails(hallId) { return this.db.emails.filter((e) => e.hall_id === hallId); }

  // ---- settings / events ----
  async getSetting(key) { return this.db.settings[key]; }
  async setSetting(key, value) { this.db.settings[key] = value; this._save(); }
  // mirrors supabaseStore.getEvents — raw audit rows are forensics, not activity
  async getEvents(limit = 200, { raw = false } = {}) {
    const rows = raw ? this.db.events
      : this.db.events.filter((e) => !['insert', 'update', 'delete'].includes(e.kind));
    return rows.slice(0, limit);
  }
  async logEvent(kind, entity, entity_id, detail = {}) { this._event(kind, entity, entity_id, detail); this._save(); }

  // ---- AI (demo stub: reads nothing, explains itself) ----
  async readInvoicePhoto() {
    return { demo: true, lines: [], note: 'AI invoice reading works once Supabase + the read-invoice function are set up. In demo mode, enter lines manually.' };
  }
}

// ---------------------------------------------------------------------------
// Staged sandbox seed (?demo): data at EVERY lifecycle stage so all screens
// demo well — POs sent/partial/closed, boxes in every state (including open boxes
// carrying a remainder from an earlier session), open + paid invoices.
function stagedSeed() {
  const db = seed();
  const H = 'bc';
  const now = Date.now();
  const at = (days, hour = 18, min = 0) => {
    const d = new Date(now - days * 864e5); d.setHours(hour, min, 0, 0); return d.toISOString();
  };
  const ymd = (days) => localYmd(new Date(now - days * 864e5));
  const pmap = Object.fromEntries(db.products.map((p) => [p.id, p]));
  // costs for a handful of games, so Accounting has money to show
  const costs = { G001: 38, G004: 52, G005: 52, G011: 310, G012: 470, G014: 118, G015: 245, G024: 395, G033: 410 };
  for (const [id, c] of Object.entries(costs)) pmap[id].cost = c;
  let serialN = 100400;
  const seq = {};

  const mkPo = (vendor, status, sentDays, lines, invoiceNo) => {
    const vc = { lib: 'LIB', tm: 'TM', clk: 'CLK', lan: 'LAN' }[vendor];
    const k = `BC-${vc}`;
    seq[k] = (seq[k] || 0) + 1;
    const d = new Date(now - sentDays * 864e5);
    const p2 = (v) => String(v).padStart(2, '0');
    const num = `BC-${p2(d.getFullYear() % 100)}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${vc}-${String(seq[k]).padStart(3, '0')}`;
    const priced = lines.filter((l) => Number(pmap[l.pid].cost) > 0);
    const subtotal = Math.round(priced.reduce((a, l) => a + l.qty * pmap[l.pid].cost, 0) * 100) / 100;
    const po = {
      id: uid(), num, hall_id: H, vendor_id: vendor, status, subtotal, tax: 0, total: subtotal,
      price_tbd_lines: lines.length - priced.length,
      sent_at: at(sentDays, 10), created_at: at(sentDays, 9),
    };
    db.purchase_orders.push(po);
    const ship = status !== 'sent'
      ? { id: uid(), hall_id: H, po_id: po.id, invoice_no: invoiceNo, notes: '', received_on: ymd(sentDays - 3),
          received_at: at(sentDays - 3, 11), confirmed: true, invoice_photo_path: null }
      : null;
    if (ship) db.shipments.push(ship);
    for (const l of lines) {
      const p = pmap[l.pid];
      db.po_lines.push({
        id: uid(), po_id: po.id, product_id: l.pid, qty: l.qty, cost: Number(p.cost) || 0, kind: 'item',
        price_tbd: !(Number(p.cost) > 0),
        name_snapshot: `${p.name} (form ${p.form_number}, ${p.tickets}/$1)`,
      });
      const states = l.states || [];
      for (let i = 0; i < l.qty; i++) {
        const st = states[i]?.s || (status === 'sent' ? 'on_order' : 'in_inventory');
        const received = st !== 'on_order' && st !== 'missing';
        const o = states[i] || {};
        const box = {
          id: uid(), hall_id: H, product_id: l.pid, po_id: po.id, source: 'po',
          shipment_id: received && ship ? ship.id : null,
          serial: received ? String(++serialN).padStart(7, '0') : '',
          cost: Number(p.cost) || 0, price_tbd: !(Number(p.cost) > 0), state: st,
          ordered_at: at(sentDays, 10),
          received_at: received ? ship.received_at : null,
          received_on: received ? ship.received_on : null,
          game_snapshot: received ? gameSnapshot(p) : null,
          opened_on: o.open != null ? ymd(o.open) : null,
          opened_at: o.open != null ? at(o.open, 18, 10 + i) : null,
          sold_out_at: st === 'sold_out' ? at(o.close, 21, 30 + i) : null,
          closed_at: st === 'closed_unsold' ? at(o.close, 21, 45) : null,
          closed_on: st === 'sold_out' || st === 'closed_unsold' ? ymd(o.close) : null,
          tickets_remaining: o.left ?? (st === 'sold_out' ? 0 : null),
        };
        db.boxes.push(box);
        for (const r of o.counts || []) {
          db.box_counts.push({ id: uid(), box_id: box.id, hall_id: H, tickets_left: r.left,
            session_date: ymd(r.day), counted_at: at(r.day, 22), kind: 'remainder' });
        }
        if (st === 'closed_unsold') {
          db.box_counts.push({ id: uid(), box_id: box.id, hall_id: H, tickets_left: o.left,
            session_date: ymd(o.close), counted_at: at(o.close, 21, 45), kind: 'close' });
        }
      }
    }
    db.emails.push({
      id: uid(), hall_id: H, po_num: num, kind: 'po', to_addr: 'orders@example.com',
      subject: `BC order — PO ${num}`, body: '(demo email body)', test_mode: true,
      provider_id: null, status: 'sent', created_at: at(sentDays, 10),
    });
    return { po, ship };
  };

  // Closed order, delivered three weeks ago: boxes at every stage of the floor
  const a = mkPo('clk', 'closed', 24, [
    { pid: 'G011', qty: 3, states: [
      { s: 'sold_out', open: 19, close: 18 },
      { s: 'sold_out', open: 12, close: 10 },
      { s: 'opened', open: 2, left: 214, counts: [{ day: 2, left: 214 }] },
    ] },
    { pid: 'G012', qty: 2, states: [
      { s: 'closed_unsold', open: 16, close: 9, left: 88, counts: [{ day: 16, left: 610 }, { day: 13, left: 240 }] },
      { s: 'in_inventory' },
    ] },
  ], '55102');
  const b = mkPo('lib', 'partial', 12, [
    { pid: 'G014', qty: 3, states: [
      { s: 'sold_out', open: 7, close: 7 },
      { s: 'opened', open: 1, left: 125, counts: [{ day: 3, left: 300 }, { day: 1, left: 125 }] },
      { s: 'in_inventory' },
    ] },
    { pid: 'G015', qty: 2, states: [{ s: 'opened', open: 0 }, { s: 'missing' }] },
    { pid: 'G001', qty: 2, states: [{ s: 'sold_out', open: 6, close: 5 }, { s: 'in_inventory' }] },
  ], 'LG-88410');
  mkPo('tm', 'sent', 2, [
    { pid: 'G033', qty: 2 },
    { pid: 'G004', qty: 3 },
  ]);

  // payments: one paid, one open
  db.payments.push(
    { id: uid(), hall_id: H, vendor_id: 'clk', po_num: a.po.num, invoice_no: '55102', amount: a.po.total, status: 'paid', created_at: a.ship.received_at },
    { id: uid(), hall_id: H, vendor_id: 'lib', po_num: b.po.num, invoice_no: 'LG-88410', amount: b.po.total, status: 'open', created_at: b.ship.received_at },
  );

  db.order_qty[H] = { G024: 2, G016: 1 };
  db.events.unshift(
    { at: at(0, 18, 2), actor: 'demo', kind: 'box.open', entity: 'boxes', entity_id: 'demo', detail: { label: `Opened ${pmap.G015.name}` } },
    { at: at(1, 22), actor: 'demo', kind: 'box.remainder', entity: 'boxes', entity_id: 'demo', detail: { label: `Remainder 125 tickets — ${pmap.G014.name}` } },
  );
  db.settings.po_sequence = seq;
  db.settings.email.accountingAddress = 'accounting@example.com';
  return db;
}

function seed() {
  return {
    vendors: CATALOG.vendors.map((v) => ({
      id: v.id, name: v.name, email: v.email || '', tax_rate: 0, active: true, contact_name: '',
    })),
    products: CATALOG.products.map((p) => ({
      id: p.id, vendor_id: p.vendor, name: p.name, form_number: p.form, vendor_sku: null,
      cost: p.cost ?? 0, tickets: p.tickets ?? null, price_per_ticket: 1,
      ideal_gross_receipts: p.igr, ideal_cash_prize: p.icp, ideal_profit: p.ip,
      non_cash_prize_value: p.ncp, net_profit: p.np, progressive_amount: p.prog,
      progressive_note: p.progNote || null, aliases: [], active: true,
    })),
    order_qty: { bc: {} },
    purchase_orders: [], po_lines: [], shipments: [], boxes: [], box_counts: [],
    payments: [], emails: [], events: [], photos: {},
    settings: {
      email: { testMode: true, testAddress: '', fromAddress: '', accountingAddress: '' },
      po_sequence: {},
      admin_pin: { pin: '1234' },
      halls_config: { bc: { address: '' } },
      demo_password: 'boxes',
      sender: { bc: { name: '', org: '', title: '', phone: '', replyTo: '' } },
    },
  };
}

