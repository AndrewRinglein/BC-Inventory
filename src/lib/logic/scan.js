// Scanner input: capture + parsing + resolution.
//
// Capture: HID keyboard-wedge scanners "type" the code as a fast keystroke burst
// ending in Enter. We watch document keydown; characters arriving faster than
// BURST_MS apart accumulate in a buffer. Enter after >= MIN_LEN chars = a scan.
// Human typing is slower and (unless focused on our hidden pattern) goes to
// whatever input has focus — we ignore bursts when a text field is focused
// UNLESS the field opts in with data-scan-target.
//
// BC barcodes carry BOTH values in one scan: the game's form number, a space, then
// the box serial number — e.g. "CR5 0012345". The bingo app this was copied from
// matched on the serial alone; here the form number says which game the box is,
// so a box can be received straight from a scan without asking.

const BURST_MS = 45;
const MIN_LEN = 4;

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
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}

/** Codes compare as text, case- and space-insensitive: "cr5" is "CR5". */
export const normCode = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * Split one scan into form number + serial.
 *
 * Splits on the LAST run of whitespace, so a form number can never swallow part of
 * the serial. Returns null when there is no space — that is not a BC box barcode.
 *   parseScan("CR5 0012345")      -> { form: "CR5", serial: "0012345" }
 *   parseScan("  bp52634   991 ") -> { form: "BP52634", serial: "991" }
 */
export function parseScan(code) {
  const s = String(code ?? '').trim();
  const m = s.match(/^(.+?)\s+(\S+)$/);
  if (!m) return null;
  const form = normCode(m[1]);
  const serial = m[2].trim();
  if (!form || !serial) return null;
  return { form, serial };
}

/**
 * The game a form number belongs to. Matches the form number first, then the
 * distributor's alternate code (vendor_sku), in case a distributor prints a
 * different code on the box than the form number on the sheet.
 */
export function gameForForm(products, form) {
  const f = normCode(form);
  if (!f) return null;
  return (products || []).find((p) => normCode(p.form_number) === f)
    || (products || []).find((p) => p.vendor_sku && normCode(p.vendor_sku) === f)
    || null;
}

/** Every box of this game carrying this serial (normally zero or one). */
export function boxesFor(boxes, productId, serial) {
  const s = String(serial ?? '').trim();
  return (boxes || []).filter((b) => b.product_id === productId && b.serial && String(b.serial).trim() === s);
}

/**
 * Receive: what should happen to this scan?
 *   { ok:true,  product, serial, placeholder? }   -> receive it (claim placeholder if given)
 *   { ok:false, reason:'format',  message }
 *   { ok:false, reason:'unknown_game', form, serial, message }  -> offer "Add game"
 *   { ok:false, reason:'duplicate', box, message }
 */
export function resolveReceiveScan(code, { products, boxes, poId = null }) {
  const parsed = parseScan(code);
  if (!parsed) {
    return { ok: false, reason: 'format', message: `"${code}" isn't a box barcode (expected form number, space, serial).` };
  }
  const product = gameForForm(products, parsed.form);
  if (!product) {
    return { ok: false, reason: 'unknown_game', form: parsed.form, serial: parsed.serial,
      message: `Form ${parsed.form} isn't in the catalog yet — add the game.` };
  }
  const dup = boxesFor(boxes, product.id, parsed.serial).find((b) => b.state !== 'on_order');
  if (dup) {
    return { ok: false, reason: 'duplicate', box: dup, product,
      message: `${product.name} #${parsed.serial} was already received (${fmtWhen(dup.received_at)}).` };
  }
  // claim a placeholder the PO created for this game, if there is one left
  const placeholder = poId
    ? (boxes || []).find((b) => b.po_id === poId && b.product_id === product.id && b.state === 'on_order')
    : null;
  return { ok: true, product, serial: parsed.serial, placeholder: placeholder || null,
    onPo: poId ? !!placeholder || (boxes || []).some((b) => b.po_id === poId && b.product_id === product.id) : null };
}

/**
 * Open: what should happen to this scan?
 *   { ok:true, action:'open', box, product }
 *   { ok:false, reason:'format'|'unknown_game'|'not_received'|'already_open'|'closed'|'wrong_state', ... }
 * 'not_received' carries product + serial so the screen can offer receive-and-open.
 */
export function resolveOpenScan(code, { products, boxes }) {
  const parsed = parseScan(code);
  if (!parsed) {
    return { ok: false, reason: 'format', message: `"${code}" isn't a box barcode (expected form number, space, serial).` };
  }
  const product = gameForForm(products, parsed.form);
  if (!product) {
    return { ok: false, reason: 'unknown_game', form: parsed.form, serial: parsed.serial,
      message: `Form ${parsed.form} isn't in the catalog. Receive it first.` };
  }
  const hits = boxesFor(boxes, product.id, parsed.serial);
  const inv = hits.find((b) => b.state === 'in_inventory');
  if (inv) return { ok: true, action: 'open', box: inv, product };
  const open = hits.find((b) => b.state === 'opened');
  if (open) return { ok: false, reason: 'already_open', box: open, product, message: `${product.name} #${parsed.serial} is already open (since ${fmtWhen(open.opened_at)}).` };
  const sold = hits.find((b) => b.state === 'sold_out' || b.state === 'closed_unsold');
  if (sold) return { ok: false, reason: 'closed', box: sold, product, message: `${product.name} #${parsed.serial} was ${sold.state === 'sold_out' ? 'sold out' : 'closed'} — it can't be opened again.` };
  if (hits.length) return { ok: false, reason: 'wrong_state', box: hits[0], product, message: `${product.name} #${parsed.serial} is ${label(hits[0].state)}.` };
  return { ok: false, reason: 'not_received', product, serial: parsed.serial,
    message: `${product.name} #${parsed.serial} was never received.` };
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
