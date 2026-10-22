import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { fmtMoney } from '../lib/logic/po.js';
import { localYmd, fmtYmd } from '../lib/logic/bc.js';
import { buildReport, monthBounds } from '../lib/logic/report.js';

const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString([], { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const shiftDay = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return localYmd(new Date(y, m - 1, d + n, 12)); };

/** Columns of the box list: [key, header, value(row), printable text(row), numeric?] */
const COLUMNS = [
  ['name', 'Game', (r) => r.g.name],
  ['form', 'Form #', (r) => r.g.form_number],
  ['vendor', 'Distributor', (r) => r.vendor],
  ['serial', 'Serial #', (r) => r.b.serial],
  ['invoice', 'Invoice #', (r) => r.invoiceNo],
  ['invoiceDate', 'Invoice date', (r) => r.invoiceDate],
  ['opened', 'Opened', (r) => r.b.opened_at],
  ['closed', 'Sold out / closed', (r) => r.closedAt],
  ['status', 'Status', (r) => r.status],
  ['left', 'Tickets left', (r) => r.left, true],
  ['tickets', 'Tickets', (r) => r.tickets, true],
  ['igr', 'Ideal gross receipts', (r) => num(r.g.ideal_gross_receipts), true],
  ['icp', 'Ideal cash prize', (r) => num(r.g.ideal_cash_prize), true],
  ['ip', 'Ideal profit', (r) => num(r.g.ideal_profit), true],
  ['ncp', 'Non-cash prize value', (r) => num(r.g.non_cash_prize_value), true],
  ['np', 'Net profit', (r) => num(r.g.net_profit), true],
  ['prog', 'Amount to progressive', (r) => num(r.g.progressive_amount), true],
  ['cost', 'Cost of game', (r) => r.cost, true],
];
const num = (v) => (v == null || v === '' ? null : Number(v));
const MONEY = new Set(['igr', 'icp', 'ip', 'ncp', 'np', 'prog', 'cost']);

function cellText(key, r) {
  const col = COLUMNS.find((c) => c[0] === key);
  const v = col[2](r);
  if (key === 'opened' || key === 'closed') return fmtTs(v);
  if (key === 'invoiceDate') return v ? fmtYmd(v) : '';
  if (MONEY.has(key)) return v == null ? '' : (key === 'cost' && !v ? '' : fmtMoney(v));
  if (key === 'left' || key === 'tickets') return v == null ? '' : Number(v).toLocaleString();
  return v ?? '';
}

/**
 * Reports — the compliance report.
 *
 * Every box closed in a period (sold out or closed unsold), with its serial, the
 * exact date and time it was opened and closed, and the game's attributes as they
 * were when the box was received. A second view lists boxes by the day they were
 * opened. Print it, or export CSV.
 */
export default function Reports({ initialShipments = [] }) {
  const { hall, boxes, products, vendors, store, settings, today } = useContext(AppCtx);
  const [mode, setMode] = useState('day');          // day | range | month
  const [day, setDay] = useState(today());
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState('closed');       // closed | opened
  const [sortKey, setSortKey] = useState('closed');
  const [dir, setDir] = useState(1);
  const [shipments, setShipments] = useState(initialShipments);

  useEffect(() => { store.getShipments(hall).then(setShipments).catch(() => setShipments([])); }, [hall, boxes, store]);

  const period = mode === 'day' ? { from: day, to: day }
    : mode === 'month' ? monthBounds(month)
      : { from: from <= to ? from : to, to: from <= to ? to : from };
  const periodLabel = period.from === period.to ? fmtYmd(period.from)
    : mode === 'month' ? new Date(`${month}-15T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' })
      : `${fmtYmd(period.from)} – ${fmtYmd(period.to)}`;

  const report = useMemo(() => buildReport({ boxes, products, vendors, shipments, period }),
    [boxes, products, vendors, shipments, period.from, period.to]);   // eslint-disable-line
  const { closed: closedRows, opened: openedRows, summary: S } = report;

  const rows = (view === 'closed' ? closedRows : openedRows).slice().sort((a, b) => {
    const col = COLUMNS.find((c) => c[0] === sortKey);
    const x = col[2](a), y = col[2](b);
    if (col[3]) return ((Number(x) || 0) - (Number(y) || 0)) * dir;
    return String(x ?? '').localeCompare(String(y ?? '')) * dir;
  });
  const sortBy = (k) => { if (k === sortKey) setDir(-dir); else { setSortKey(k); setDir(1); } };
  const arrow = (k) => (k === sortKey ? (dir > 0 ? ' ▲' : ' ▼') : '');

  const quick = (q) => {
    const t = today();
    if (q === 'today') { setMode('day'); setDay(t); }
    if (q === 'yesterday') { setMode('day'); setDay(shiftDay(t, -1)); }
    if (q === 'month') { setMode('month'); setMonth(t.slice(0, 7)); }
    if (q === 'lastmonth') { const [y, m] = t.split('-').map(Number); const d = new Date(y, m - 2, 15); setMode('month'); setMonth(localYmd(d).slice(0, 7)); }
  };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = COLUMNS.map((c) => c[1]);
    const body = rows.map((r) => COLUMNS.map(([k, , val]) => {
      const v = val(r);
      if (k === 'opened' || k === 'closed') return v ? new Date(v).toISOString() : '';
      return v ?? '';
    }));
    const csv = [head, ...body].map((line) => line.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bc-compliance-${view}-${period.from}${period.to !== period.from ? '_' + period.to : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const business = settings.report?.businessName || 'BC';
  const license = settings.report?.license || '';

  return (
    <div className="report">
      <div className="page-head no-print">
        <div className="h1">Reports</div>
        <div className="grow" />
        <button className="btn ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        <button className="btn primary" onClick={() => window.print()}>Print report</button>
      </div>

      <div className="card pad no-print" style={{ marginBottom: 14, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="hall-switch" style={{ margin: 0 }}>
          {[['day', 'Day'], ['range', 'Date range'], ['month', 'Month']].map(([k, l]) => (
            <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        {mode === 'day' && <div className="field" style={{ margin: 0 }}><label>Day</label><input type="date" value={day} onChange={(e) => setDay(e.target.value || today())} /></div>}
        {mode === 'range' && <>
          <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value || today())} /></div>
          <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value || today())} /></div>
        </>}
        {mode === 'month' && <div className="field" style={{ margin: 0 }}><label>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} /></div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn ghost sm" onClick={() => quick('today')}>Today</button>
          <button className="btn ghost sm" onClick={() => quick('yesterday')}>Yesterday</button>
          <button className="btn ghost sm" onClick={() => quick('month')}>This month</button>
          <button className="btn ghost sm" onClick={() => quick('lastmonth')}>Last month</button>
        </div>
        <div style={{ flex: 1 }} />
        <div className="hall-switch" style={{ margin: 0 }}>
          <button className={view === 'closed' ? 'on' : ''} onClick={() => { setView('closed'); setSortKey('closed'); setDir(1); }}>Closed in period</button>
          <button className={view === 'opened' ? 'on' : ''} onClick={() => { setView('opened'); setSortKey('opened'); setDir(1); }}>Opened in period</button>
        </div>
      </div>

      <div className="report-head">
        <div style={{ fontSize: 18, fontWeight: 700 }}>{business} — Box compliance report</div>
        <div style={{ fontSize: 13 }}>
          {view === 'closed' ? 'Boxes sold out or closed' : 'Boxes opened'}: <b>{periodLabel}</b>
          {license && <> · License {license}</>}
        </div>
        <div className="dimmer" style={{ fontSize: 11.5 }}>Generated {new Date().toLocaleString()}</div>
      </div>

      <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <div className="card pad stat"><label>Boxes opened</label><div className="v">{S.opened}</div><div className="s">in the period</div></div>
        <div className="card pad stat"><label>Sold out</label><div className="v">{S.soldOut}</div><div className="s">{S.closedUnsold} closed unsold</div></div>
        <div className="card pad stat"><label>Still open</label><div className="v">{S.stillOpen}</div><div className="s">at the end of the period</div></div>
        <div className="card pad stat"><label>Cost of boxes closed</label><div className="v">{S.costClosed ? fmtMoney(S.costClosed) : '—'}</div><div className="s">{S.costClosed ? `${closedRows.length} boxes` : 'costs not entered yet'}</div></div>
        <div className="card pad stat"><label>Ideal gross receipts</label><div className="v">{fmtMoney(S.idealGross)}</div><div className="s">boxes sold out</div></div>
        <div className="card pad stat"><label>Ideal cash prize</label><div className="v">{fmtMoney(S.idealCashPrize)}</div><div className="s">boxes sold out</div></div>
        <div className="card pad stat"><label>Ideal / net profit</label><div className="v">{fmtMoney(S.idealProfit)}</div><div className="s">net {fmtMoney(S.netProfit)}</div></div>
        <div className="card pad stat"><label>Amount to progressive</label><div className="v">{fmtMoney(S.progressive)}</div><div className="s">boxes sold out</div></div>
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
          {view === 'closed' ? 'Boxes closed' : 'Boxes opened'} — {periodLabel} ({rows.length})
        </div>
        <table className="tbl report-tbl">
          <thead><tr>
            {COLUMNS.map(([k, label, , numeric], i) => (
              <th key={k} className={'sortable' + (numeric ? ' r' : '') + (i === 0 ? ' first' : '') + (i === COLUMNS.length - 1 ? ' last' : '')}
                onClick={() => sortBy(k)}>{label}{arrow(k)}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.b.id}>
                {COLUMNS.map(([k, , , numeric], i) => (
                  <td key={k} className={(numeric ? 'r mono' : '') + (k === 'serial' || k === 'form' ? ' mono' : '') + (i === 0 ? ' first' : '') + (i === COLUMNS.length - 1 ? ' last' : '')}
                    style={k === 'opened' || k === 'closed' ? { whiteSpace: 'nowrap', fontSize: 12 } : undefined}>
                    {cellText(k, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">
          No boxes {view === 'closed' ? 'closed' : 'opened'} in this period.
        </div>}
      </div>
    </div>
  );
}
