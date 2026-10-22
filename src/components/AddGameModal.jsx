import React, { useContext, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { normCode } from '../lib/logic/scan.js';

/** The spreadsheet's columns, in its order. Ticket count is ideal gross receipts ($1 a ticket). */
export const GAME_FIELDS = [
  ['ideal_gross_receipts', 'Ideal gross receipts $ (= tickets)'],
  ['ideal_cash_prize', 'Ideal cash prize $'],
  ['ideal_profit', 'Ideal profit $'],
  ['non_cash_prize_value', 'Non-cash prize value $'],
  ['net_profit', 'Net profit $'],
  ['progressive_amount', 'Amount to progressive $'],
];

const slug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8) || 'dist';

const Field = ({ label, children, width }) => (
  <div className="field" style={{ margin: 0, width }}><label>{label}</label>{children}</div>
);

/**
 * Add a game to the catalog — opened from Receive when a scanned form number is not
 * in the catalog yet (pre-filled with that form number), or from the Games screen.
 * onSaved(product) runs after the game exists, so the held scan can finish.
 */
export default function AddGameModal({ form = '', serial = '', onSaved, onClose }) {
  const { store, vendors, products, reloadCatalog, setToast } = useContext(AppCtx);
  const [g, setG] = useState({
    name: '', form_number: form, vendor_id: vendors[0]?.id || '', newVendor: '', cost: '',
    ideal_gross_receipts: '', ideal_cash_prize: '', ideal_profit: '', non_cash_prize_value: '0',
    net_profit: '', progressive_amount: '0', progressive_note: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const num = (v) => (v === '' || v == null ? null : Number(v));

  // ideal profit and net profit default to receipts minus prizes when left blank
  const igr = num(g.ideal_gross_receipts);
  const icp = num(g.ideal_cash_prize);
  const autoProfit = igr != null && icp != null ? Math.round((igr - icp) * 100) / 100 : null;

  const save = async (e) => {
    e?.preventDefault();
    if (busy) return;
    const name = g.name.trim();
    const formNo = g.form_number.trim();
    if (!name) { setToast('Enter the game name'); return; }
    if (!formNo) { setToast('Enter the form number'); return; }
    if (products.some((p) => normCode(p.form_number) === normCode(formNo))) {
      setToast(`Form ${formNo} is already in the catalog`); return;
    }
    if (!(igr > 0)) { setToast('Enter ideal gross receipts — it is the ticket count'); return; }
    setBusy(true);
    try {
      let vendorId = g.vendor_id;
      if (vendorId === '_new') {
        const vname = g.newVendor.trim();
        if (!vname) { setToast('Enter the new distributor\'s name'); setBusy(false); return; }
        let id = slug(vname);
        while (vendors.some((v) => v.id === id)) id += 'x';
        const v = await store.addVendor({ id, name: vname });
        vendorId = v.id;
      }
      const ideal = num(g.ideal_profit) ?? autoProfit;
      const product = await store.addProduct({
        name, form_number: formNo, vendor_id: vendorId,
        cost: num(g.cost) || 0, tickets: Math.round(igr), price_per_ticket: 1,
        ideal_gross_receipts: igr, ideal_cash_prize: icp, ideal_profit: ideal,
        non_cash_prize_value: num(g.non_cash_prize_value), net_profit: num(g.net_profit) ?? ideal,
        progressive_amount: num(g.progressive_amount), progressive_note: g.progressive_note.trim() || null,
        aliases: [],
      });
      await reloadCatalog();
      setToast(`${name} added to the catalog`);
      await onSaved?.(product);
    } catch (err) {
      setToast('Could not add the game: ' + err.message, null, 6000);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={() => !busy && onClose?.()}>
      <form className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Add a game</div>
        {form
          ? <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
              <b className="mono">{form}</b> isn't in the catalog.{' '}
              {serial ? <>Save it and box <b className="mono">#{serial}</b> is received straight away.</> : 'Save it, then scan the box serial.'}
              {/^[A-Z]{2}\d/.test(form) && <> Game barcodes usually carry a two-letter maker code in front of the form number (e.g. AI6747U for form 6747U); either is fine here.</>}
            </p>
          : <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>Everything from the ticket sheet. Cost can be left blank and filled in later.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label="Game name"><input type="text" autoFocus value={g.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Form number"><input type="text" className="mono" value={g.form_number} onChange={(e) => set('form_number', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label="Distributor">
            <select value={g.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              <option value="_new">+ New distributor…</option>
            </select>
          </Field>
          <Field label="Cost of game $ (per box)">
            <input type="number" min="0" step="0.01" placeholder="blank = not known" value={g.cost} onChange={(e) => set('cost', e.target.value)} />
          </Field>
        </div>
        {g.vendor_id === '_new' && (
          <div style={{ marginBottom: 10 }}>
            <Field label="New distributor name"><input type="text" value={g.newVendor} onChange={(e) => set('newVendor', e.target.value)} /></Field>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          {GAME_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}>
              <input type="number" step="0.01"
                placeholder={(k === 'ideal_profit' || k === 'net_profit') && autoProfit != null ? String(autoProfit) : ''}
                value={g[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
        <Field label="Progressive breakdown (optional, e.g. Red: 200, White: 100)">
          <input type="text" value={g.progressive_note} onChange={(e) => set('progressive_note', e.target.value)} />
        </Field>
        <p className="dimmer" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
          Ticket count is set to ideal gross receipts ($1 per ticket). Blank profit fields use receipts minus cash prize.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : serial ? 'Save game & receive box' : 'Save game'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
