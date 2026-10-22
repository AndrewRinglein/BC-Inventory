// Scanner input: capture + parsing + resolution.
//
// Capture: HID keyboard-wedge scanners "type" the code as a fast keystroke burst
// ending in Enter. We watch document keydown; characters arriving faster than
// BURST_MS apart accumulate in a buffer. Enter after >= MIN_LEN chars = a scan.
// Human typing is slower and (unless focused on our hidden pattern) goes to
// whatever input has focus — we ignore bursts when a text field is focused
// UNLESS the field opts in with data-scan-target.
//
// A box is identified by its game code + its serial. It can arrive as ONE scan
// ("CR5 0012345") or as TWO (game barcode, then serial), which is how the Frontier
// admin box scanner works — see readScan. The bingo app this was copied from
// matched on the serial alone.

// 100 ms between keys, matching the POS member-card scanner that already runs in
// the field: people type at >100 ms a key, HID scanners at well under 30 ms, and
// some Bluetooth scanners are slower than USB ones. A tighter limit (the bingo app
// used 45 ms) risks splitting one barcode into two partial scans.
const BURST_MS = 100;
const MIN_LEN = 3;   // "SR3" is a whole game code

export function createScanCapture(onScan) {
  let buf = '';
  let last = 0;
  const handler = (e) => {
    const el = document.activeElement;
    const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (inField && !el.dataset.scanTarget) return;   // let normal typing be normal
    const now = performance.now();
    if (now - last > BURST_MS) buf = '';
    last = now;
    if (e.key === 'Enter') {
      if (buf.length >= MIN_LEN) {
        const code = buf;
        buf = '';
        e.preventDefault();
        onScan(code.trim());
      }
      return;
    }
    if (e.key.length === 1) buf += e.key;
  };
  // A pasted code counts as a scan too (as on the POS): handy for testing with no
  // scanner, and for a code copied from somewhere else.
  const onPaste = (e) => {
    const el = document.activeElement;
    const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    if (inField && !el.dataset.scanTarget) return;
    const text = ((e.clipboardData || window.clipboardData)?.getData('text') || '').trim();
    if (text.length < 2) return;
    e.preventDefault();
    buf = '';
    onScan(text);
  };
  document.addEventListener('keydown', handler, true);
  document.addEventListener('paste', onPaste, true);
  return () => {
    document.removeEventListener('keydown', handler, true);
    document.removeEventListener('paste', onPaste, true);
  };
}

/** Codes compare as text, case- and space-insensitive: "cr5" is "CR5". */
export const normCode = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Serials are stored and compared trimmed and upper-case — the Bingo Vision
 *  verifier matches form + serial the same way (trim, ignore case). Leading zeros
 *  are kept: "000123" and "123" are different boxes. */
export const normSerial = (s) => String(s ?? '').trim().toUpperCase();

/**
 * Split one scan into form number + serial.
 *
 * Splits on the LAST run of whitespace, so a form number can never swallow part of
 * the serial. Returns null when there is no space (that is a single code: a game
 * barcode on its own, or a serial — see readScan).
 *   parseScan("CR5 0012345")      -> { form: "CR5", serial: "0012345" }
 *   parseScan("  bp52634   991 ") -> { form: "BP52634", serial: "991" }
 */
export function parseScan(code) {
  const s = String(code ?? '').trim();
  const m = s.match(/^(.+?)\s+(\S+)$/);
  if (!m) return null;
  const form = normCode(m[1]);
  const serial = normSerial(m[2]);
  if (!form || !serial) return null;
  return { form, serial };
}

/**
 * The game a scanned code belongs to.
 *
 * In the field the game barcode carries a two-letter MANUFACTURER code in front of
 * the form number — the Frontier flash catalog has Candy Pack (form 6747U on the BC
 * sheet) as "AI6747U", Wizard of Oz (40JN) as "AI40JN", Wild Unicorn (6303W) as
 * "AN6303W". So: exact form number first, then the alternate code (vendor_sku),
 * then the code with a leading two-letter prefix removed. Suffix letters are never
 * ignored — "AN6303WR" is a different box (1,100 tickets) from "AN6303W" (1,060).
 */
export function gameForForm(products, form) {
  const f = normCode(form);
  if (!f) return null;
  const ps = products || [];
  const exact = (code) => ps.find((p) => normCode(p.form_number) === code)
    || ps.find((p) => p.vendor_sku && normCode(p.vendor_sku) === code);
  const hit = exact(f);
  if (hit) return hit;
  const m = f.match(/^[A-Z]{2}(.+)$/);
  return (m && exact(m[1])) || null;
}

/**
 * What one scan is. Boxes can be scanned two ways, and both work:
 *   - ONE scan carrying both values: "<game code> <serial>"
 *   - TWO scans, as the Frontier admin scanner does it: the game barcode, then the
 *     box serial. `pending` is the game picked by the first scan.
 * Returns one of:
 *   { type: 'box',     product|null, form, serial }   both values in hand
 *   { type: 'game',    product }                      a game barcode — now scan the serial
 *   { type: 'unknown', code }                         a lone code that is no game we know
 */
export function readScan(code, { products, pending = null }) {
  const both = parseScan(code);
  if (both) return { type: 'box', product: gameForForm(products, both.form), form: both.form, serial: both.serial };
  const single = String(code ?? '').trim();
  // with a game waiting, the next scan is its serial (as in the admin scanner)
  if (pending) return { type: 'box', product: pending, form: pending.form_number, serial: normSerial(single) };
  const product = gameForForm(products, single);
  if (product) return { type: 'game', product };
  return { type: 'unknown', code: normCode(single) };
}

/** Every box of this game carrying this serial (normally zero or one). */
export function boxesFor(boxes, productId, serial) {
  const s = normSerial(serial);
  return (boxes || []).filter((b) => b.product_id === productId && b.serial && normSerial(b.serial) === s);
}

/** Shared first step: a game picked, an unknown code, or a box with both values. */
function firstStep(code, ctx, verb) {
  const r = readScan(code, ctx);
  if (r.type === 'game') {
    return { ok: true, action: 'pick', product: r.product,
      message: `${r.product.name} (form ${r.product.form_number}) — now scan the box serial.` };
  }
  if (r.type === 'unknown') {
    return { ok: false, reason: 'unknown_game', form: r.code, serial: null,
      message: `${r.code} isn't a game in the catalog — add it, then scan the box serial.` };
  }
  if (!r.product) {
    return { ok: false, reason: 'unknown_game', form: r.form, serial: r.serial,
      message: `Form ${r.form} isn't in the catalog yet — add the game${verb ? ' to ' + verb + ' this box' : ''}.` };
  }
  return { box: r };
}

/**
 * Receive: what should happen to this scan?
 *   { ok:true,  action:'pick', product }                 game picked; next scan is its serial
 *   { ok:true,  product, serial, placeholder? }          receive it (claim placeholder if given)
 *   { ok:false, reason:'unknown_game', form, serial }    offer "Add game" (serial may be null)
 *   { ok:false, reason:'duplicate', box }
 */
export function resolveReceiveScan(code, { products, boxes, poId = null, pending = null }) {
  const f = firstStep(code, { products, pending }, 'receive');
  if (!f.box) return f;
  const { product, serial } = f.box;
  const dup = boxesFor(boxes, product.id, serial).find((b) => b.state !== 'on_order');
  if (dup) {
    return { ok: false, reason: 'duplicate', box: dup, product,
      message: `${product.name} #${serial} was already received (${fmtWhen(dup.received_at)}).` };
  }
  // claim a placeholder the PO created for this game, if there is one left
  const placeholder = poId
    ? (boxes || []).find((b) => b.po_id === poId && b.product_id === product.id && b.state === 'on_order')
    : null;
  return { ok: true, action: 'receive', product, serial, placeholder: placeholder || null,
    onPo: poId ? !!placeholder || (boxes || []).some((b) => b.po_id === poId && b.product_id === product.id) : null };
}

/**
 * Open: what should happen to this scan?
 *   { ok:true, action:'pick', product }    game picked; next scan is its serial
 *   { ok:true, action:'open', box, product }
 *   { ok:false, reason:'unknown_game'|'not_received'|'already_open'|'closed'|'wrong_state', ... }
 * 'not_received' carries product + serial so the screen can offer receive-and-open.
 */
export function resolveOpenScan(code, { products, boxes, pending = null }) {
  const f = firstStep(code, { products, pending }, 'open');
  if (!f.box) return f;
  const { product, serial } = f.box;
  const hits = boxesFor(boxes, product.id, serial);
  const inv = hits.find((b) => b.state === 'in_inventory');
  if (inv) return { ok: true, action: 'open', box: inv, product };
  const open = hits.find((b) => b.state === 'opened');
  if (open) return { ok: false, reason: 'already_open', box: open, product, message: `${product.name} #${serial} is already open (since ${fmtWhen(open.opened_at)}).` };
  const sold = hits.find((b) => b.state === 'sold_out' || b.state === 'closed_unsold');
  if (sold) return { ok: false, reason: 'closed', box: sold, product, message: `${product.name} #${serial} was ${sold.state === 'sold_out' ? 'sold out' : 'closed'} — it can't be opened again.` };
  if (hits.length) return { ok: false, reason: 'wrong_state', box: hits[0], product, message: `${product.name} #${serial} is ${label(hits[0].state)}.` };
  return { ok: false, reason: 'not_received', product, serial,
    message: `${product.name} #${serial} was never received.` };
}

const label = (s) => ({ on_order: 'still on order', in_inventory: 'in inventory', opened: 'open', sold_out: 'sold out', closed_unsold: 'closed unsold', missing: 'marked missing' }[s] || s);

export function fmtWhen(iso) {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Short beeps via WebAudio — no audio files needed. */
export function beep(ok = true) {
  try {
    const ctx = (beep._ctx ||= new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = ok ? 1120 : 300;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.12 : 0.32));
    o.start(); o.stop(ctx.currentTime + (ok ? 0.13 : 0.33));
  } catch { /* audio unavailable — visual flash still shows */ }
}
