import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { resolveOpenScan } from '../lib/logic/scan.js';
import { ticketsIn, fmtDateTime, fmtYmd } from '../lib/logic/bc.js';
import { closedAt } from '../lib/logic/boxes.js';
import AddGameModal from './AddGameModal.jsx';

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/**
 * Asks how many tickets are left — for a remainder (the box stays open) or for
 * closing a box unsold. Module-level, so typing never loses focus.
 */
function CountModal({ mode, box, product, lastCount, onCancel, onConfirm, busy }) {
  const full = ticketsIn(box, product);
  const [value, setValue] = useState(mode === 'close' && lastCount != null ? String(lastCount) : '');
  const n = value === '' ? null : Number(value);
  const bad = n != null && (!Number.isInteger(n) || n < 0 || (full && n > full));
  return (
    <div className="modal-bg" onClick={() => !busy && onCancel()}>
      <form className="modal" style={{ width: 430 }} onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (n != null && !bad) onConfirm(n); }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          {mode === 'close' ? 'Close this box unsold' : 'Remainder — how many tickets are left?'}
        </div>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <b>{product?.name}</b> <span className="mono dim">· form {product?.form_number} · #{box.serial}</span>
        </div>
        <div style={{ display: 'flex', gap: 18, marginBottom: 12, fontSize: 13 }}>
          <div><div className="dimmer" style={{ fontSize: 11.5 }}>Tickets in a full box</div><b className="mono">{full.toLocaleString()}</b> <span className="dimmer">(${full.toLocaleString()})</span></div>
          {lastCount != null && <div><div className="dimmer" style={{ fontSize: 11.5 }}>Last count</div><b className="mono">{lastCount.toLocaleString()}</b></div>}
        </div>
        <div className="field">
          <label>Tickets left</label>
          <input type="number" min="0" max={full || undefined} step="1" autoFocus value={value}
            onChange={(e) => setValue(e.target.value)} style={{ width: 160, fontSize: 18 }} className="mono" />
        </div>
        {bad && <p style={{ color: 'var(--orange)', fontSize: 12.5, margin: '4px 0 0' }}>Enter a whole number from 0 to {full.toLocaleString()}.</p>}
        {mode === 'remainder' && n === 0 && !bad && (
          <p className="muted-note" style={{ marginTop: 6 }}>No tickets left means the box sold out — confirming marks it sold out.</p>
        )}
        <p className="dimmer" style={{ fontSize: 11.5, marginTop: 8 }}>
          {mode === 'close'
            ? 'The box leaves the floor and goes on the report as closed unsold, with this many tickets left.'
            : 'The box stays open and carries this count into the next session.'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn primary" type="submit" disabled={busy || n == null || bad}>
            {busy ? 'Saving…' : mode === 'close' ? 'Confirm — close unsold' : n === 0 ? 'Confirm — sold out' : 'Confirm remainder'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmModal({ title, children, confirmLabel, onCancel, onConfirm, busy }) {
  return (
    <div className="modal-bg" onClick={() => !busy && onCancel()}>
      <div className="modal" style={{ width: 430 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13 }}>{children}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" autoFocus disabled={busy} onClick={onConfirm}>{busy ? 'Saving…' : confirmLabel}</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Open — the floor screen, and where the compliance record is made.
 *
 * Scanning a sealed box opens it: the session date picked here and the exact time
 * of the scan are written at once. Every open box then ends one of three ways:
 * Sold out, a Remainder (tickets left — the box stays open into the next session),
 * or Close unsold (retired with tickets left).
 */
export default function Open() {
  const { hall, boxes, products, boxCounts, store, reloadHall, setToast, can, scanHandlerRef, flashFor, today } = useContext(AppCtx);
  const editable = can('boxes');
  const [sessionDate, setSessionDate] = useState(today());
  const [code, setCode] = useState('');
  const [ask, setAsk] = useState(null);       // { kind: 'remainder'|'close'|'soldout'|'receive', box?, product?, serial? }
  const [addGame, setAddGame] = useState(null);
  const [busy, setBusy] = useState(false);
  const scanBoxRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const live = useRef({});
  live.current = { products, boxes, sessionDate };

  const pmap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const lastCountOf = useMemo(() => {
    const out = {};
    for (const c of [...boxCounts].sort((a, b) => String(a.counted_at).localeCompare(String(b.counted_at)))) {
      out[c.box_id] = c;
    }
    return out;
  }, [boxCounts]);

  const openList = useMemo(() => boxes.filter((b) => b.state === 'opened')
    .sort((a, b) => String(a.opened_at || '').localeCompare(String(b.opened_at || ''))), [boxes]);
  const closedToday = useMemo(() => boxes.filter((b) => {
    const at = closedAt(b);
    return at && localDay(at) === sessionDate;
  }).sort((a, b) => String(closedAt(b)).localeCompare(String(closedAt(a)))), [boxes, sessionDate]);

  useEffect(() => { if (!ask && !addGame) scanBoxRef.current?.focus(); }, [ask, addGame]);

  const open = async (box, product) => {
    await store.openBox(box.id, { openedOn: live.current.sessionDate });
    await reloadHall();
    return {
      ok: true,
      message: `✓ Opened ${product.name} #${box.serial}`,
      undo: async () => { await store.undoOpen(box.id); await reloadHall(); },
    };
  };

  const handleScan = (raw) => {
    const run = async () => {
      if (!editable) return { ok: false, message: 'Your role can\'t open boxes.' };
      const cur = live.current;
      const r = resolveOpenScan(raw, { products: cur.products, boxes: cur.boxes });
      if (r.ok) {
        try { return await open(r.box, r.product); } catch (e) { return { ok: false, message: e.message }; }
      }
      if (r.reason === 'not_received') {
        setAsk({ kind: 'receive', product: r.product, serial: r.serial });
        return { ok: false, message: r.message };
      }
      if (r.reason === 'unknown_game') {
        setAddGame({ form: r.form, serial: r.serial });
        return { ok: false, message: `Form ${r.form} isn't in the catalog — add the game to open this box.` };
      }
      return { ok: false, message: r.message };
    };
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => {});
    return p;
  };

  useEffect(() => {
    scanHandlerRef.current = handleScan;
    return () => { if (scanHandlerRef.current === handleScan) scanHandlerRef.current = null; };
  });

  const typed = async (e) => {
    e.preventDefault();
    const c = code.trim();
    setCode('');
    if (!c) return;
    const r = await handleScan(c);
    if (r) { flashFor(r.ok); if (r.message) setToast(r.message, r.undo || null); }
    scanBoxRef.current?.focus();
  };

  /** Receive a box nobody checked in, then open it — so the floor is never blocked. */
  const receiveAndOpen = async (product, serial) => {
    const box = await store.receiveBox({ hallId: hall, product, serial, receivedOn: live.current.sessionDate });
    const r = await open(box, product);
    flashFor(true);
    setToast(`✓ Received and opened ${product.name} #${serial}`, async () => {
      await store.undoOpen(box.id); await store.undoReceiveBox(box.id); await reloadHall();
    });
    return r;
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { setToast(e.message, null, 6000); }
    finally { setBusy(false); }
  };

  const doSoldOut = (box) => act(async () => {
    await store.soldOut(box.id);
    await reloadHall();
    setAsk(null);
    setToast(`Sold out — ${pmap[box.product_id]?.name} #${box.serial}`,
      async () => { await store.reopenBox(box.id); await reloadHall(); });
  });

  const doRemainder = (box, n) => act(async () => {
    if (n === 0) { await store.soldOut(box.id); }
    else { await store.recordRemainder(box.id, n, { sessionDate }); }
    await reloadHall();
    setAsk(null);
    const name = `${pmap[box.product_id]?.name} #${box.serial}`;
    setToast(n === 0 ? `Sold out — ${name}` : `Remainder saved: ${n.toLocaleString()} tickets left in ${name}`);
  });

  const doClose = (box, n) => act(async () => {
    await store.closeUnsold(box.id, n, { sessionDate });
    await reloadHall();
    setAsk(null);
    setToast(`Closed unsold, ${n.toLocaleString()} tickets left — ${pmap[box.product_id]?.name} #${box.serial}`,
      async () => { await store.reopenBox(box.id); await reloadHall(); });
  });

  const doReopen = (box) => act(async () => {
    await store.reopenBox(box.id);
    await reloadHall();
    setToast(`Back on the floor — ${pmap[box.product_id]?.name} #${box.serial}`);
  });

  const isToday = sessionDate === today();

  return (
    <div>
      <div className="page-head">
        <div className="h1">Open</div>
        <div className="grow" />
        <span className="dim" style={{ fontSize: 13 }}>{openList.length} box{openList.length === 1 ? '' : 'es'} open on the floor</span>
      </div>

      <div className="card pad" style={{ marginBottom: 14, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Session date</label>
          <input type="date" value={sessionDate} max={today()} onChange={(e) => setSessionDate(e.target.value || today())}
            style={{ fontWeight: 600 }} />
        </div>
        {!isToday && <span className="badge b-gold" style={{ marginBottom: 6 }}>Not today — opens record this date with the time of the scan</span>}
        <div style={{ flex: 1 }} />
        {editable ? (
          <form onSubmit={typed} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Scan a box to open it</label>
              <input ref={scanBoxRef} type="text" data-scan-target="1" value={code}
                onChange={(e) => setCode(e.target.value)} placeholder="e.g. CR5 0012345"
                style={{ width: 250, borderColor: 'var(--orange)', fontFamily: "'IBM Plex Mono',monospace" }} />
            </div>
            <span className="scan-ind on"><span className="dot" />scanner on</span>
          </form>
        ) : <span className="dimmer" style={{ fontSize: 12.5 }}>Read-only for your role.</span>}
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
          Open on the floor ({openList.length})
        </div>
        <table className="tbl">
          <thead><tr>
            <th className="first">Game</th><th>Form</th><th>Serial</th><th>Opened</th>
            <th className="r">Tickets in box</th><th className="r">Tickets left</th>
            <th className="last r" style={{ width: 300 }} />
          </tr></thead>
          <tbody>
            {openList.map((b) => {
              const p = pmap[b.product_id];
              const last = lastCountOf[b.id];
              const carried = b.opened_on && b.opened_on !== sessionDate;
              return (
                <tr key={b.id}>
                  <td className="first"><b>{p?.name || b.product_id}</b></td>
                  <td className="mono dim">{p?.form_number}</td>
                  <td className="mono">{b.serial || '—'}</td>
                  <td style={{ fontSize: 12 }}>
                    {fmtTime(b.opened_at)}
                    {carried && <div className="dimmer" style={{ fontSize: 11 }}>session {fmtYmd(b.opened_on)}</div>}
                  </td>
                  <td className="r mono">{ticketsIn(b, p).toLocaleString()}</td>
                  <td className="r mono">
                    {b.tickets_remaining != null
                      ? <><b>{Number(b.tickets_remaining).toLocaleString()}</b>{last && <div className="dimmer" style={{ fontSize: 11 }}>counted {fmtYmd(last.session_date)}</div>}</>
                      : <span className="dimmer">—</span>}
                  </td>
                  <td className="last r" style={{ whiteSpace: 'nowrap' }}>
                    {editable ? (<>
                      <button className="btn green sm" onClick={() => setAsk({ kind: 'soldout', box: b })}>Sold out</button>{' '}
                      <button className="btn orange sm" onClick={() => setAsk({ kind: 'remainder', box: b })}>Remainder</button>{' '}
                      <button className="btn ghost sm" onClick={() => setAsk({ kind: 'close', box: b })}>Close unsold</button>
                    </>) : <span className="dimmer" style={{ fontSize: 11 }}>read-only</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {openList.length === 0 && <div style={{ padding: 30, textAlign: 'center' }} className="dimmer">No boxes are open. Scan a box to open it.</div>}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
          Closed {isToday ? 'today' : `on ${fmtYmd(sessionDate)}`} ({closedToday.length})
        </div>
        {closedToday.length === 0
          ? <div style={{ padding: 20, textAlign: 'center' }} className="dimmer">Nothing closed {isToday ? 'yet today' : 'that day'}.</div>
          : (
            <table className="tbl">
              <thead><tr>
                <th className="first">Game</th><th>Serial</th><th>Opened</th><th>Closed</th><th>Status</th>
                <th className="r">Tickets left</th><th className="last" style={{ width: 90 }} />
              </tr></thead>
              <tbody>
                {closedToday.map((b) => (
                  <tr key={b.id}>
                    <td className="first">{pmap[b.product_id]?.name}</td>
                    <td className="mono">{b.serial}</td>
                    <td style={{ fontSize: 12 }}>{fmtTime(b.opened_at)}</td>
                    <td style={{ fontSize: 12 }}>{fmtTime(closedAt(b))}</td>
                    <td>{b.state === 'sold_out' ? <span className="badge b-green">sold out</span> : <span className="badge b-gold">closed unsold</span>}</td>
                    <td className="r mono">{b.state === 'closed_unsold' ? Number(b.tickets_remaining || 0).toLocaleString() : ''}</td>
                    <td className="last r">{editable && <button className="btn ghost sm" disabled={busy} title="Put it back on the floor (for a mistake)" onClick={() => doReopen(b)}>Reopen</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {ask?.kind === 'soldout' && (
        <ConfirmModal title="Mark this box sold out?" confirmLabel="Confirm — sold out" busy={busy}
          onCancel={() => setAsk(null)} onConfirm={() => doSoldOut(ask.box)}>
          <b>{pmap[ask.box.product_id]?.name}</b> <span className="mono dim">· #{ask.box.serial}</span>
          <p className="dimmer" style={{ fontSize: 12, marginTop: 6 }}>The sold-out date and time are recorded now ({fmtDateTime(new Date().toISOString())}).</p>
        </ConfirmModal>
      )}
      {(ask?.kind === 'remainder' || ask?.kind === 'close') && (
        <CountModal mode={ask.kind} box={ask.box} product={pmap[ask.box.product_id]} busy={busy}
          lastCount={ask.box.tickets_remaining != null ? Number(ask.box.tickets_remaining) : null}
          onCancel={() => setAsk(null)}
          onConfirm={(n) => (ask.kind === 'close' ? doClose(ask.box, n) : doRemainder(ask.box, n))} />
      )}
      {ask?.kind === 'receive' && (
        <ConfirmModal title="This box was never received" confirmLabel="Receive and open it" busy={busy}
          onCancel={() => setAsk(null)}
          onConfirm={() => act(async () => { await receiveAndOpen(ask.product, ask.serial); setAsk(null); })}>
          <b>{ask.product.name}</b> <span className="mono dim">· form {ask.product.form_number} · #{ask.serial}</span>
          <p className="dimmer" style={{ fontSize: 12, marginTop: 6 }}>
            It will be received with no purchase order or invoice, dated {fmtYmd(sessionDate)}, then opened.
          </p>
        </ConfirmModal>
      )}
      {addGame && (
        <AddGameModal form={addGame.form} serial={addGame.serial}
          onClose={() => setAddGame(null)}
          onSaved={async (product) => {
            const serial = addGame.serial;
            setAddGame(null);
            try { await receiveAndOpen(product, serial); } catch (e) { flashFor(false); setToast(e.message, null, 6000); }
          }} />
      )}
    </div>
  );
}

function localDay(iso) {
  const d = new Date(iso);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
