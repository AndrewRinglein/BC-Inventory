import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import Adjust from './Adjust.jsx';
import UpdateGame from './UpdateGame.jsx';
import { fmtMoney, sumMoney } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { needsCost, needsTickets } from '../lib/logic/setup.js';
import { perBoxValue } from '../lib/logic/pricing.js';
import { searchMatches } from '../lib/logic/naming.js';
import { fmtYmd } from '../lib/logic/bc.js';

const COLS = [
  { key: 'inv', label: 'In stock', r: true }, { key: 'open', label: 'Open', r: true },
  { key: 'onorder', label: 'On order', r: true }, { key: 'form', label: 'Form #' },
  { key: 'vendor', label: 'Distributor' }, { key: 'tickets', label: 'Tickets', r: true },
  { key: 'cost', label: 'Cost / box', r: true }, { key: 'value', label: 'Value', r: true },
];

const STATE_LABEL = { in_inventory: 'in stock', opened: 'open', on_order: 'on order', sold_out: 'sold out', closed_unsold: 'closed unsold', missing: 'missing' };

/**
 * What BC holds, game by game: sealed in stock, open on the floor, on order.
 * Click a row for the boxes and serials behind the counts. Value is at cost, once
 * costs are entered. A hand count that disagrees with the system, or a damaged /
 * returned / swapped box, is recorded with a note (Adjust).
 */
export default function Inventory() {
  const { products, vendors, boxes, store, reloadHall, setToast, can } = useContext(AppCtx);
  const editable = can('boxes');
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [showAdjust, setShowAdjust] = useState(null);   // null | { product? }
  const [adj, setAdj] = useState(null);                  // { p, from, to }
  const [adjNote, setAdjNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [updPid, setUpdPid] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);

  const rows = products
    .map((p) => {
      const c = cnt[p.id] || {};
      const each = perBoxValue(p);
      const held = (c.inv || 0) + (c.open || 0);
      return { p, c, each, held, value: held * each };
    })
    .filter((r) => showAll || r.held > 0 || (r.c.onorder || 0) > 0)
    .filter((r) => !q || searchMatches(r.p, q) || String(r.p.form_number || '').toLowerCase().includes(q.toLowerCase()));

  const sortVal = (r, k) => ({
    name: r.p.name.toLowerCase(), inv: r.c.inv || 0, open: r.c.open || 0, onorder: r.c.onorder || 0,
    form: r.p.form_number || '', vendor: vmap[r.p.vendor_id] || '', tickets: Number(r.p.tickets) || 0,
    cost: r.each, value: r.value,
  }[k]);
  rows.sort((a, b) => {
    const x = sortVal(a, sortKey), y = sortVal(b, sortKey);
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.p.name.localeCompare(b.p.name);
  });
  const sortBy = (k) => { if (k === sortKey) setDir(-dir); else { setSortKey(k); setDir(k === 'name' ? 1 : -1); } };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const totals = {
    inv: rows.reduce((a, r) => a + (r.c.inv || 0), 0),
    open: rows.reduce((a, r) => a + (r.c.open || 0), 0),
    onorder: rows.reduce((a, r) => a + (r.c.onorder || 0), 0),
    value: sumMoney(rows, (r) => r.value),
    unvalued: rows.filter((r) => r.held > 0 && needsCost(r.p)).length,
  };

  // a hand count of sealed boxes that disagrees with the system; the note is required
  const saveCount = async () => {
    const to = parseInt(adj.to);
    if (!(to >= 0)) { setToast('Enter the number of sealed boxes on the shelf'); return; }
    if (!adjNote.trim()) { setToast('Say why the count is different'); return; }
    const delta = to - adj.from;
    if (!delta) { setAdj(null); return; }
    setSaving(true);
    try {
      await store.adjustStock({
        hallId: 'bc', product: adj.p, delta, note: adjNote.trim(),
        label: `Count corrected: ${adj.p.name} ${adj.from} → ${to}`,
      });
      await reloadHall();
      setToast(`${adj.p.name}: count set to ${to}`);
      setAdj(null); setAdjNote('');
    } catch (e) { setToast(e.message, null, 6000); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Inventory</div>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>
          {totals.inv} sealed · {totals.open} open · {totals.onorder} on order
          {totals.value > 0 && <> · <b className="mono">{fmtMoney(totals.value)}</b> at cost</>}
        </span>
        {editable && <button className="btn ghost" onClick={() => setShowAdjust({})}>Adjust stock…</button>}
      </div>
      {totals.unvalued > 0 && (
        <div className="demo-banner">
          {totals.unvalued} game{totals.unvalued === 1 ? '' : 's'} in stock {totals.unvalued === 1 ? 'has' : 'have'} no cost yet, so the value above is incomplete.
        </div>
      )}
      <div className="filter-bar">
        <input type="text" placeholder="Search name or form #…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include games with no stock
        </label>
        <div style={{ flex: 1 }} />
        <span className="dimmer" style={{ fontSize: 12 }}>{rows.length} games</span>
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first sortable" onClick={() => sortBy('name')}>Game{arrow('name')}</th>
            {COLS.map((c) => <th key={c.key} className={'sortable' + (c.r ? ' r' : '')} onClick={() => sortBy(c.key)}>{c.label}{arrow(c.key)}</th>)}
            <th className="last" style={{ width: 150 }} />
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const mine = expanded === r.p.id
                ? boxes.filter((b) => b.product_id === r.p.id && ['in_inventory', 'opened', 'on_order'].includes(b.state))
                  .sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.serial).localeCompare(String(b.serial)))
                : [];
              return (
                <React.Fragment key={r.p.id}>
                  <tr style={{ cursor: 'pointer' }} className={expanded === r.p.id ? 'hl' : ''}
                    onClick={() => setExpanded(expanded === r.p.id ? null : r.p.id)}>
                    <td className="first"><b>{r.p.name}</b></td>
                    <td className="r mono"><b>{r.c.inv || 0}</b></td>
                    <td className="r mono">{r.c.open || 0}</td>
                    <td className="r mono dimmer">{r.c.onorder || 0}</td>
                    <td className="mono dim">{r.p.form_number}</td>
                    <td className="dim" style={{ fontSize: 12 }}>{vmap[r.p.vendor_id] || r.p.vendor_id}</td>
                    <td className="r mono">{needsTickets(r.p) ? <span className="dimmer">—</span> : Number(r.p.tickets).toLocaleString()}</td>
                    <td className="r mono">{needsCost(r.p)
                      ? <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
                          onClick={(e) => { e.stopPropagation(); setUpdPid(r.p.id); }}>update</button>
                      : fmtMoney(r.each)}</td>
                    <td className="r mono">{r.value ? fmtMoney(r.value) : ''}</td>
                    <td className="last r" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {editable && <button className="btn ghost sm" title="The shelf count disagrees with the system"
                        onClick={() => { setAdj({ p: r.p, from: r.c.inv || 0, to: String(r.c.inv || 0) }); setAdjNote(''); }}>Count</button>}{' '}
                      {editable && <button className="btn ghost sm" onClick={() => setShowAdjust({ product: r.p })}>Adjust</button>}
                    </td>
                  </tr>
                  {expanded === r.p.id && (
                    <tr><td colSpan={COLS.length + 2} style={{ background: 'var(--bg)', padding: '6px 16px 10px' }}>
                      {mine.length === 0 ? <span className="dimmer">No boxes in stock, open or on order.</span> : (
                        <table className="tbl" style={{ background: 'transparent' }}>
                          <thead><tr><th className="first">Serial</th><th>State</th><th>Received</th><th>Opened</th><th className="r last">Tickets left</th></tr></thead>
                          <tbody>
                            {mine.map((b) => (
                              <tr key={b.id}>
                                <td className="first mono">{b.serial || <span className="dimmer">—</span>}</td>
                                <td><span className={'badge ' + (b.state === 'opened' ? 'b-orange' : b.state === 'on_order' ? 'b-gray' : 'b-green')}>{STATE_LABEL[b.state]}</span></td>
                                <td style={{ fontSize: 12 }}>{b.received_on ? fmtYmd(b.received_on) : ''}</td>
                                <td style={{ fontSize: 12 }}>{b.opened_at ? new Date(b.opened_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</td>
                                <td className="r mono last">{b.tickets_remaining != null && b.state === 'opened' ? Number(b.tickets_remaining).toLocaleString() : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">
          {q ? 'No games match.' : 'Nothing in stock yet. Boxes appear here as they are received.'}
        </div>}
      </div>

      {adj && (
        <div className="modal-bg" onClick={() => !saving && setAdj(null)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Correct the count — {adj.p.name}</div>
            <div style={{ display: 'flex', gap: 14 }}>
              <div className="field" style={{ margin: 0 }}><label>System says (sealed)</label>
                <input type="number" value={adj.from} disabled style={{ width: 120 }} /></div>
              <div className="field" style={{ margin: 0 }}><label>Actually on the shelf</label>
                <input type="number" min="0" autoFocus value={adj.to} style={{ width: 120 }}
                  onChange={(e) => setAdj({ ...adj, to: e.target.value })} /></div>
            </div>
            <div className="field" style={{ marginTop: 14 }}><label>Note — why is it different? (required)</label>
              <input type="text" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} style={{ width: '100%' }} /></div>
            <p className="dimmer" style={{ fontSize: 11.5 }}>Extra boxes are added with no serial; missing ones are marked missing. Both show in History with your note.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={saving} onClick={saveCount}>{saving ? 'Saving…' : 'Save count'}</button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" disabled={saving} onClick={() => setAdj(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showAdjust && <Adjust onClose={() => setShowAdjust(null)} preset={showAdjust.product ? { reason: 'damaged', product: showAdjust.product } : undefined} />}
      {updPid && products.find((p) => p.id === updPid) && (
        <UpdateGame key={updPid} product={products.find((p) => p.id === updPid)} onClose={() => setUpdPid(null)} />
      )}
    </div>
  );
}
