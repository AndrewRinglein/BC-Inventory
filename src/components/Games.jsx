import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { needsCost, needsTickets, needsForm, needsAnyUpdate, productsNeedingUpdate } from '../lib/logic/setup.js';
import { fmtMoney } from '../lib/logic/po.js';
import { searchMatches } from '../lib/logic/naming.js';
import { countByProduct } from '../lib/logic/boxes.js';
import AskDistributor from './AskDistributor.jsx';
import UpdateGame from './UpdateGame.jsx';
import AddGameModal from './AddGameModal.jsx';

const money = (v) => (v == null || v === '' ? '' : fmtMoney(v));

const COLS = [
  ['name', 'Game'], ['form', 'Form #'], ['vendor', 'Distributor'], ['cost', 'Cost', true],
  ['tickets', 'Tickets', true], ['icp', 'Ideal cash prize', true], ['ip', 'Ideal profit', true],
  ['ncp', 'Non-cash prize', true], ['np', 'Net profit', true], ['prog', 'To progressive', true],
  ['stock', 'In stock', true],
];

/**
 * The game catalog — everything on the ticket sheet, plus cost. Blank cells say
 * "update" in gold; anyone on the floor can fill a blank, Admin changes values.
 */
export default function Games() {
  const { products, vendors, boxes, can } = useContext(AppCtx);
  const editable = can('editCatalog');
  const [q, setQ] = useState('');
  const [vendorF, setVendorF] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [editPid, setEditPid] = useState(null);
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);

  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);
  const cnt = useMemo(() => countByProduct(boxes), [boxes]);
  const gaps = productsNeedingUpdate(products.filter((p) => p.active !== false));

  const val = (p, k) => ({
    name: p.name.toLowerCase(), form: p.form_number || '', vendor: vmap[p.vendor_id] || '',
    cost: Number(p.cost) || 0, tickets: Number(p.tickets) || 0, icp: Number(p.ideal_cash_prize) || 0,
    ip: Number(p.ideal_profit) || 0, ncp: Number(p.non_cash_prize_value) || 0, np: Number(p.net_profit) || 0,
    prog: Number(p.progressive_amount) || 0, stock: (cnt[p.id]?.inv || 0),
  }[k]);

  const rows = products
    .filter((p) => showHidden || p.active !== false)
    .filter((p) => !onlyGaps || needsAnyUpdate(p))
    .filter((p) => !vendorF || p.vendor_id === vendorF)
    .filter((p) => !q || searchMatches(p, q) || String(p.form_number || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const x = val(a, sortKey), y = val(b, sortKey);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.name.localeCompare(b.name);
    });
  const sortBy = (k) => { if (k === sortKey) setDir(-dir); else { setSortKey(k); setDir(1); } };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const Upd = ({ p }) => (
    <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
      onClick={() => setEditPid(p.id)}>update</button>
  );

  return (
    <div>
      <div className="page-head">
        <div className="h1">{editable ? 'Add / Update Games' : 'Game Catalog'}</div>
        <div className="grow" />
        {gaps.length > 0 && <button className="btn ghost" onClick={() => setAsking(true)}
          title="Email distributors for the costs and ticket counts we're missing">Ask distributors…</button>}
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add game</button>
      </div>
      {gaps.length > 0 && (
        <div className="demo-banner">
          <b>{gaps.length} game{gaps.length === 1 ? '' : 's'}</b> {gaps.length === 1 ? 'is' : 'are'} missing a cost, ticket count, form number or distributor.
          A blank cost still orders — the PO shows “?” and the distributor fills it in.
        </div>
      )}
      <div className="filter-bar">
        <input type="text" placeholder="Search name or form #…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <label>Distributor
          <select value={vendorF} onChange={(e) => setVendorF(e.target.value)}>
            <option value="">All</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only games with blanks
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
        </label>
        <div style={{ flex: 1 }} />
        <span className="dimmer" style={{ fontSize: 12 }}>{rows.length} games</span>
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="tbl">
          <thead><tr>
            {COLS.map(([k, label, r], i) => (
              <th key={k} className={'sortable' + (r ? ' r' : '') + (i === 0 ? ' first' : '')} onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
            ))}
            <th className="last" style={{ width: 60 }} />
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={p.active === false ? { opacity: 0.5 } : {}}>
                <td className="first"><b>{p.name}</b>{p.active === false && <span className="badge b-gray" style={{ marginLeft: 6 }}>hidden</span>}</td>
                <td className="mono">{needsForm(p) ? <Upd p={p} /> : p.form_number}</td>
                <td className="dim" style={{ fontSize: 12 }}>{vmap[p.vendor_id] || p.vendor_id}</td>
                <td className="r mono">{needsCost(p) ? <Upd p={p} /> : fmtMoney(p.cost)}</td>
                <td className="r mono">{needsTickets(p) ? <Upd p={p} /> : Number(p.tickets).toLocaleString()}</td>
                <td className="r mono">{money(p.ideal_cash_prize)}</td>
                <td className="r mono">{money(p.ideal_profit)}</td>
                <td className="r mono dimmer">{money(p.non_cash_prize_value)}</td>
                <td className="r mono">{money(p.net_profit)}</td>
                <td className="r mono" title={p.progressive_note || ''}>{money(p.progressive_amount)}{p.progressive_note ? ' *' : ''}</td>
                <td className="r mono">{cnt[p.id]?.inv || 0}</td>
                <td className="last r"><button className="btn ghost sm" onClick={() => setEditPid(p.id)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No games match.</div>}
      </div>
      <p className="muted-note" style={{ marginTop: 8 }}>Tickets = ideal gross receipts ($1 per ticket). * progressive split by color — hover for the breakdown.</p>
      {editPid && products.find((p) => p.id === editPid) && (
        <UpdateGame key={editPid} product={products.find((p) => p.id === editPid)} onClose={() => setEditPid(null)} />
      )}
      {adding && <AddGameModal onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />}
      {asking && <AskDistributor onClose={() => setAsking(false)} />}
    </div>
  );
}
