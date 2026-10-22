import React, { useContext, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney, buildDrafts } from '../lib/logic/po.js';
import { countByProduct } from '../lib/logic/boxes.js';
import { needsCost, needsTickets, needsVendor } from '../lib/logic/setup.js';
import { searchMatches } from '../lib/logic/naming.js';
import UpdateGame from './UpdateGame.jsx';

const STOCK_FILTERS = [
  ['', 'All'], ['out', 'Out of stock'], ['low', 'Low (1–2)'], ['some', 'In stock'],
  ['onorder', 'On order'], ['nocost', 'Needs cost'],
];
const stockMatch = (p, live, onorder, sel) =>
  !sel ? true : sel === 'out' ? live === 0 : sel === 'low' ? live > 0 && live <= 2
    : sel === 'some' ? live > 0 : sel === 'onorder' ? onorder > 0 : needsCost(p);

/**
 * Purchase — the order builder. Enter how many boxes of each game; Review turns it
 * into one PO per distributor. A game with no cost yet still orders: the PO shows
 * "?" and asks the distributor to bill at their price.
 */
export default function Purchase() {
  const { hall, products, vendors, boxes, orderQty, store, reloadHall, setScreen, can } = useContext(AppCtx);
  const editable = can('order');
  const [vendorF, setVendorF] = useState('');
  const [q, setQ] = useState('');
  const [stockF, setStockF] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [dir, setDir] = useState(1);
  const [updPid, setUpdPid] = useState(null);

  const cnt = useMemo(() => countByProduct(boxes), [boxes]);
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const drafts = useMemo(() => buildDrafts(orderQty, products, vendors), [orderQty, products, vendors]);
  const grand = drafts.reduce((a, d) => a + d.total, 0);
  const boxCount = drafts.reduce((a, d) => a + d.lines.reduce((x, l) => x + l.qty, 0), 0);
  const tbd = drafts.reduce((a, d) => a + d.lines.filter((l) => l.price_tbd).length, 0);

  const live = (p) => (cnt[p.id]?.inv || 0) + (cnt[p.id]?.open || 0);
  const sortVal = (p, k) => ({
    name: p.name.toLowerCase(), form: p.form_number || '', live: live(p), onorder: cnt[p.id]?.onorder || 0,
    cost: Number(p.cost) || 0, tickets: Number(p.tickets) || 0, vendor: vmap[p.vendor_id]?.name || '',
  }[k]);

  const rows = products
    .filter((p) => p.active !== false)
    .filter((p) => (orderQty[p.id] || 0) > 0 || (      // anything already on the order always shows
      (!vendorF || p.vendor_id === vendorF)
      && (!q || searchMatches(p, q) || String(p.form_number || '').toLowerCase().includes(q.toLowerCase()))
      && stockMatch(p, live(p), cnt[p.id]?.onorder || 0, stockF)))
    .sort((a, b) => {
      const x = sortVal(a, sortKey), y = sortVal(b, sortKey);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.name.localeCompare(b.name);
    });
  const sortBy = (k) => { if (k === sortKey) setDir(-dir); else { setSortKey(k); setDir(1); } };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const setQty = async (pid, v) => {
    const n = Math.max(0, parseInt(v) || 0);
    await store.setOrderQty(hall, pid, n);
    await reloadHall();
  };

  return (
    <div>
      <div className="page-head" style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10, paddingTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <div className="h1">Purchase</div>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>{boxCount ? `${boxCount} box${boxCount === 1 ? '' : 'es'} · ${drafts.length} distributor${drafts.length === 1 ? '' : 's'}` : 'Enter quantities to build an order'}</span>
        <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{boxCount ? (tbd ? `${fmtMoney(grand)} +?` : fmtMoney(grand)) : ''}</span>
        <button className="btn primary" disabled={!boxCount || !editable} onClick={() => setScreen('review')}>Review order →</button>
      </div>
      {tbd > 0 && (
        <div className="demo-banner">
          <b>{tbd} line{tbd === 1 ? '' : 's'} on this order {tbd === 1 ? 'has' : 'have'} no cost yet.</b>{' '}
          {tbd === 1 ? 'It' : 'They'}'ll go out as “?” and the email asks the distributor to bill at their price. The total covers priced lines only.
        </div>
      )}
      <div className="filter-bar">
        <input type="text" placeholder="Search name or form #…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 210 }} />
        <label>Distributor
          <select value={vendorF} onChange={(e) => setVendorF(e.target.value)}>
            <option value="">All</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
        <label>Stock
          <select value={stockF} onChange={(e) => setStockF(e.target.value)}>
            {STOCK_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <div style={{ flex: 1 }} />
        <span className="dimmer" style={{ fontSize: 12 }}>{rows.length} shown</span>
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="tbl">
          <thead><tr>
            <th className="first sortable" onClick={() => sortBy('name')}>Game{arrow('name')}</th>
            <th className="sortable" onClick={() => sortBy('form')}>Form #{arrow('form')}</th>
            <th className="r sortable" onClick={() => sortBy('live')} title="Sealed + open">In stock{arrow('live')}</th>
            <th className="r sortable" onClick={() => sortBy('onorder')}>On order{arrow('onorder')}</th>
            <th style={{ textAlign: 'center', width: 96 }}>Boxes</th>
            <th className="r sortable" onClick={() => sortBy('cost')}>Cost / box{arrow('cost')}</th>
            <th className="r">Line total</th>
            <th className="r sortable" onClick={() => sortBy('tickets')}>Tickets{arrow('tickets')}</th>
            <th className="sortable" onClick={() => sortBy('vendor')}>Distributor{arrow('vendor')}</th>
            <th className="last" style={{ width: 60 }} />
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const n = orderQty[p.id] || 0;
              return (
                <tr key={p.id} className={n ? 'hl' : ''}>
                  <td className="first">{p.name}</td>
                  <td className="mono dim">{p.form_number}</td>
                  <td className="r mono">{live(p)}</td>
                  <td className="r mono dimmer">{cnt[p.id]?.onorder || 0}</td>
                  <td style={{ textAlign: 'center' }}>
                    {needsVendor(p)
                      ? <button className="badge b-gold" style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600 }}
                          onClick={() => setUpdPid(p.id)}>needs distributor</button>
                      : <input className={'qty' + (needsCost(p) ? ' tbd-qty' : '')} type="number" min="0" value={n || ''} disabled={!editable}
                          onChange={(e) => setQty(p.id, e.target.value)} />}
                  </td>
                  <td className="r mono">{needsCost(p)
                    ? <button className="tbd" title="No cost yet — the PO goes out with ? and the distributor fills it in. Click to enter it now."
                        onClick={() => setUpdPid(p.id)}>?</button>
                    : fmtMoney(p.cost)}</td>
                  <td className="r mono">{n ? (needsCost(p) ? <span className="tbd">?</span> : <b>{fmtMoney(n * Number(p.cost))}</b>) : ''}</td>
                  <td className="r mono">{needsTickets(p) ? '—' : Number(p.tickets).toLocaleString()}</td>
                  <td className="dim" style={{ fontSize: 12 }}>{vmap[p.vendor_id]?.name}</td>
                  <td className="last r"><button className="btn ghost sm" onClick={() => setUpdPid(p.id)}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No games match.</div>}
      </div>
      {updPid && products.find((p) => p.id === updPid) && (
        <UpdateGame key={updPid} product={products.find((p) => p.id === updPid)} onClose={() => setUpdPid(null)} />
      )}
    </div>
  );
}
