import React, { useContext, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { needsCost } from '../lib/logic/setup.js';
import { normCode } from '../lib/logic/scan.js';
import { GAME_FIELDS } from './AddGameModal.jsx';

const Locked = () => <span className="dimmer" title="Only Admin can change a value that is already set" style={{ fontSize: 11 }}> 🔒</span>;

const Field = ({ label, children }) => (
  <div className="field" style={{ margin: 0 }}><label>{label}</label>{children}</div>
);

const blank = (v) => v == null || v === '';

/**
 * Edit a game without leaving the screen you're on.
 *
 * Filling a BLANK field is open to anyone who keeps the floor, since a blank blocks
 * their work and there's nothing to lose. Changing a value that already exists is
 * Admin only, and changing a cost that was already set asks for the PIN — it
 * follows through onto every future PO.
 */
export default function UpdateGame({ product, onClose }) {
  const { store, reloadCatalog, setToast, vendors, products, requirePin, can } = useContext(AppCtx);
  const admin = can('editCatalog');
  const str = (v) => (blank(v) ? '' : String(v));
  const [f, setF] = useState({
    name: product.name || '', form_number: product.form_number || '', vendor_id: product.vendor_id || '',
    vendor_sku: product.vendor_sku || '',
    cost: needsCost(product) ? '' : String(Number(product.cost)),
    ideal_gross_receipts: str(product.ideal_gross_receipts ?? product.tickets),
    ideal_cash_prize: str(product.ideal_cash_prize), ideal_profit: str(product.ideal_profit),
    non_cash_prize_value: str(product.non_cash_prize_value), net_profit: str(product.net_profit),
    progressive_amount: str(product.progressive_amount), progressive_note: product.progressive_note || '',
    active: product.active !== false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // a field this person may edit: admin, or it was blank to begin with
  const may = (orig) => admin || blank(orig);

  const save = async (e) => {
    e?.preventDefault();
    if (saving) return;
    const out = {};
    const num = (v) => (v === '' ? null : Number(v));
    if (f.name.trim() && f.name.trim() !== product.name) out.name = f.name.trim();
    if (f.form_number.trim() !== (product.form_number || '')) {
      const clash = products.find((p) => p.id !== product.id && normCode(p.form_number) === normCode(f.form_number));
      if (clash) { setToast(`Form ${f.form_number} already belongs to ${clash.name}`); return; }
      out.form_number = f.form_number.trim();
    }
    if (f.vendor_id !== product.vendor_id) out.vendor_id = f.vendor_id;
    if ((f.vendor_sku.trim() || null) !== (product.vendor_sku || null)) out.vendor_sku = f.vendor_sku.trim() || null;
    const c = f.cost === '' ? 0 : Number(f.cost);
    if (!Number.isFinite(c) || c < 0) { setToast('Cost must be a positive number'); return; }
    if (c !== (Number(product.cost) || 0)) out.cost = c;
    for (const [k] of GAME_FIELDS) {
      const v = num(f[k]);
      if (v !== (blank(product[k]) ? null : Number(product[k]))) out[k] = v;
    }
    if (out.ideal_gross_receipts !== undefined) out.tickets = out.ideal_gross_receipts == null ? null : Math.round(out.ideal_gross_receipts);
    if ((f.progressive_note.trim() || null) !== (product.progressive_note || null)) out.progressive_note = f.progressive_note.trim() || null;
    if (f.active !== (product.active !== false)) out.active = f.active;
    if (!Object.keys(out).length) { onClose(); return; }
    // money that was already set needs the PIN
    if (out.cost !== undefined && !needsCost(product)) {
      if (!(await requirePin())) return;
    }
    setSaving(true);
    try {
      await store.updateProduct(product.id, out);
      await reloadCatalog();
      setToast(`${f.name || product.name} saved`);
      onClose();
    } catch (err) {
      setToast('Could not save: ' + err.message, null, 6000);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-bg" onClick={() => !saving && onClose()}>
      <form className="modal" style={{ width: 580 }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{product.name}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label={<>Game name{!may(product.name) && <Locked />}</>}>
            <input type="text" value={f.name} disabled={!may(product.name)} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={<>Form number{!may(product.form_number) && <Locked />}</>}>
            <input type="text" className="mono" value={f.form_number} disabled={!may(product.form_number)} onChange={(e) => set('form_number', e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Field label={<>Distributor{!may(product.vendor_id) && <Locked />}</>}>
            <select value={f.vendor_id} disabled={!may(product.vendor_id)} onChange={(e) => set('vendor_id', e.target.value)}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label={<>Cost of game ${!may(needsCost(product) ? '' : product.cost) && <Locked />}</>}>
            <input type="number" min="0" step="0.01" placeholder="not known" value={f.cost}
              disabled={!may(needsCost(product) ? '' : product.cost)} onChange={(e) => set('cost', e.target.value)} />
          </Field>
          <Field label={<>Alt. barcode code{!may(product.vendor_sku) && <Locked />}</>}>
            <input type="text" className="mono" placeholder="optional" value={f.vendor_sku}
              disabled={!may(product.vendor_sku)} onChange={(e) => set('vendor_sku', e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          {GAME_FIELDS.map(([k, label]) => (
            <Field key={k} label={<>{label}{!may(product[k]) && <Locked />}</>}>
              <input type="number" step="0.01" value={f[k]} disabled={!may(product[k])} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
        <Field label={<>Progressive breakdown{!may(product.progressive_note) && <Locked />}</>}>
          <input type="text" value={f.progressive_note} disabled={!may(product.progressive_note)} onChange={(e) => set('progressive_note', e.target.value)} />
        </Field>
        {admin && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 10 }}>
            <input type="checkbox" checked={!f.active} onChange={(e) => set('active', !e.target.checked)} />
            Hidden — no longer ordered (kept for history and reports)
          </label>
        )}
        <p className="dimmer" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
          Ticket count follows ideal gross receipts ($1 per ticket). Boxes already received keep the values they arrived with on the compliance report.
          {!admin && ' You can fill in blanks; changing a value that is already set is Admin only.'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" type="button" disabled={saving} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
