import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { resolveReceiveScan } from '../lib/logic/scan.js';
import { fmtYmd } from '../lib/logic/bc.js';
import { buildShortageEmail, buildDeliveredEmail, senderFor } from '../lib/logic/emails.js';
import { receivedLine, missingLine, extraLine } from '../lib/logic/receiving.js';
import AddGameModal from './AddGameModal.jsx';
import GamePickModal from './GamePickModal.jsx';

/**
 * Receive — check a delivery in by scanning every box.
 *
 * Set the date, invoice number and (optionally) the purchase order once, then scan.
 * Each scan is written the moment it lands: the box is in stock, no button to push,
 * so ten scans in a row are ten boxes received. With a PO, a scan claims one of the
 * boxes that PO already put on order for that game; anything else is a new box.
 *
 * "Done" closes the delivery: for a PO it works out what is still missing and
 * builds the same shortage / amount-to-pay emails the bingo app sent.
 */
export default function Receive() {
  const { hall, hallName, pos, boxes, vendors, products, settings, store, reloadHall, setToast,
          receivingPo, setReceivingPo, can, scanHandlerRef, flashFor, today } = useContext(AppCtx);
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial');
  const vmap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const pmap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const [receivedOn, setReceivedOn] = useState(today());
  const [invoiceNo, setInvoiceNo] = useState('');
  const poId = receivingPo && openPos.some((p) => p.id === receivingPo) ? receivingPo : '';
  const po = openPos.find((p) => p.id === poId) || null;
  const [shipment, setShipment] = useState(null);      // created on the first scan
  const [scanned, setScanned] = useState([]);          // this delivery, newest first
  const [lines, setLines] = useState([]);              // the PO's lines
  const [code, setCode] = useState('');
  const [addGame, setAddGame] = useState(null);        // { form, serial } from an unknown scan
  const [choose, setChoose] = useState(null);         // several games match a typed name
  const [pending, setPending] = useState(null);        // game picked by a game-barcode scan; next scan is its serial
  const [stage, setStage] = useState('scan');          // scan | emails
  const [emails, setEmails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [arrivals, setArrivals] = useState([]);
  const scanBoxRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const live = useRef({});
  live.current = { products, boxes, poId, shipment, receivedOn, invoiceNo, pending };

  // a delivery record exists from the first scan, even if every scan is undone
  const started = !!shipment || scanned.length > 0;

  useEffect(() => {
    if (po) store.getPoLines(po.id).then((ls) => setLines(ls.filter((l) => l.kind !== 'fee' && l.product_id)));
    else setLines([]);
  }, [po?.id]);   // eslint-disable-line

  useEffect(() => { store.getArrivals(hall).then(setArrivals).catch(() => setArrivals([])); }, [hall, boxes, store]);

  useEffect(() => { if (stage === 'scan' && !addGame && !choose) scanBoxRef.current?.focus(); }, [stage, addGame, choose, poId]);

  // A screen left up overnight must not file the next delivery under yesterday:
  // until a delivery starts, the date follows the calendar unless someone picked one.
  const pickedRef = useRef(false);
  const lastToday = useRef(today());
  useEffect(() => {
    const tick = () => {
      const t = today();
      if (t !== lastToday.current) {
        if (!pickedRef.current && !live.current.shipment) setReceivedOn(t);
        lastToday.current = t;
      }
    };
    const iv = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, []);   // eslint-disable-line

  /** The delivery record, created the first time a box is scanned. */
  const ensureShipment = async () => {
    const cur = live.current;
    if (cur.shipment) return cur.shipment;
    const s = await store.createShipment({
      hall_id: hall, po_id: cur.poId || null, invoice_no: cur.invoiceNo.trim(),
      received_on: cur.receivedOn, notes: '',
    });
    live.current.shipment = s;
    setShipment(s);
    return s;
  };

  const receive = async (product, serial) => {
    const cur = live.current;
    const s = await ensureShipment();
    const box = await store.receiveBox({
      hallId: hall, shipmentId: s.id, poId: cur.poId || null, product, serial, receivedOn: cur.receivedOn,
    });
    const onPo = cur.poId ? box.source === 'po' : null;
    setScanned((xs) => [{ box, product, onPo, at: new Date().toISOString() }, ...xs]);
    const fresh = await reloadHall();
    if (fresh) live.current.boxes = fresh;
    return box;
  };

  const undoOne = async (boxId) => {
    await store.undoReceiveBox(boxId);
    setScanned((xs) => xs.filter((x) => x.box.id !== boxId));
    await reloadHall();
  };

  /** One path for every scan, from the scanner or the box. Scans run one at a time. */
  /** Every write that can follow a scan runs through one queue, one at a time. */
  const enqueue = (fn) => {
    const p = queue.current.then(fn, fn);
    queue.current = p.catch(() => {});
    return p;
  };

  const handleScan = (raw) => {
    setCode('');      // a scanner types into the focused box too; clear it every time
    const run = async () => {
      if (!can('receive')) return { ok: false, message: 'Your role can\'t receive deliveries.' };
      if (stage !== 'scan') return { ok: false, message: 'Finish or close the emails first.' };
      const cur = live.current;
      const r = resolveReceiveScan(raw, { products: cur.products, boxes: cur.boxes, poId: cur.poId, pending: cur.pending });
      if (r.action === 'pick') { live.current.pending = r.product; setPending(r.product); return { ok: true, message: r.message }; }
      // a serial scanned for a picked game ends that game's turn, whatever happens next
      if (cur.pending) { live.current.pending = null; setPending(null); }
      if (r.reason === 'choose') { setChoose(r.matches); return { ok: false, message: r.message }; }
      if (r.reason === 'unknown_game') { setAddGame({ form: r.form, serial: r.serial }); return { ok: false, message: r.message }; }
      if (!r.ok) return { ok: false, message: r.message };
      try {
        const box = await receive(r.product, r.serial);
        const notOnPo = cur.poId && box.source !== 'po';
        return {
          ok: true,
          message: `✓ ${r.product.name} #${r.serial}${notOnPo ? ' — not on this PO' : ''}`,
          undo: () => undoOne(box.id),
        };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    };
    return enqueue(run);
  };

  // own the scanner while this screen is up
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

  // ---- the PO, line by line ----
  // (the PO can leave the open list — closed by this very delivery — before its
  // lines are cleared, so never read lines without a PO in hand)
  const lineRows = !po ? [] : lines.filter((l) => l.po_id === po.id).map((l) => {
    const mine = boxes.filter((b) => b.po_id === po.id && b.product_id === l.product_id);
    const received = mine.filter((b) => b.state !== 'on_order' && b.state !== 'missing').length;
    const now = scanned.filter((x) => x.box.product_id === l.product_id && x.onPo).length;
    return { l, received, now, remaining: Math.max(0, l.qty - received) };
  });

  const startOver = () => {
    setShipment(null); live.current.shipment = null;
    setScanned([]); setInvoiceNo(''); setEmails(null); setStage('scan'); setPending(null);
    setReceivedOn(today()); pickedRef.current = false; setReceivingPo(null);
  };

  // ---- Done ----
  const done = async () => {
    if (!shipment || busy) return;
    const inv = invoiceNo.trim();
    if (!inv) {
      setToast('Enter the invoice number before finishing — Accounting quotes it on the payment.', null, 6000);
      return;
    }
    setBusy(true);
    try {
      const n = scanned.length;
      if (!po) {
        await store.confirmShipment(shipment.id, { invoice_no: inv, boxes: n, missing: 0 });
        setToast(`Delivery received — ${n} box${n === 1 ? '' : 'es'}`);
        startOver();
        return;
      }
      // what this delivery brought, against the PO; what the PO is still owed
      const receivedLines = [], missingLines = [];
      for (const r of lineRows) {
        const prod = pmap[r.l.product_id];
        if (r.now > 0) receivedLines.push(receivedLine(r.l, prod, r.now, prod && Number(prod.cost) > 0 ? Number(prod.cost) : Number(r.l.cost) || 0));
        if (r.remaining > 0) missingLines.push(missingLine(r.l, prod, r.remaining, prod && Number(prod.cost) > 0 ? Number(prod.cost) : Number(r.l.cost) || 0));
      }
      const extras = {};
      for (const x of scanned.filter((s) => !s.onPo)) (extras[x.product.id] ||= []).push(x);
      for (const [pid, xs] of Object.entries(extras)) {
        receivedLines.push(extraLine(pmap[pid], `${pmap[pid]?.name} (form ${pmap[pid]?.form_number})`, xs.length, Number(pmap[pid]?.cost) || 0));
      }
      await store.confirmShipment(shipment.id, {
        invoice_no: inv, boxes: n, missing: missingLines.reduce((a, l) => a + l.qty, 0),
      });
      await store.setPoStatus(po.id, missingLines.length ? 'partial' : 'closed');
      const v = vmap[po.vendor_id] || { name: po.vendor_id, email: '' };
      const sender = senderFor(settings.sender, hall);
      const list = [];
      if (missingLines.length) list.push(buildShortageEmail(po, v, hallName, missingLines, sender));
      const delivered = buildDeliveredEmail(po, v, hallName, inv, receivedLines, missingLines, sender, settings.email?.accountingName || '');
      delivered.to = settings.email?.accountingAddress || '(accounting address not set — Settings)';
      list.push(delivered);
      if (receivedLines.length) {
        await store.addPayment({ hall_id: hall, vendor_id: po.vendor_id, po_num: po.num, invoice_no: inv, amount: delivered.amount });
      }
      await reloadHall();
      setEmails(list);
      setStage('emails');
      setToast(missingLines.length
        ? `Delivery received — ${missingLines.reduce((a, l) => a + l.qty, 0)} box(es) still missing from ${po.num}`
        : `Delivery received — ${po.num} is complete`);
    } catch (e) {
      setToast('Could not finish: ' + e.message, null, 6000);
    } finally { setBusy(false); }
  };

  const sendEmails = async () => {
    setBusy(true);
    try {
      await store.sendEmails(emails, hall);
      setToast(`${emails.length} email(s) sent`);
      startOver();
    } catch (e) { setToast('Send failed: ' + e.message, null, 8000); }
    finally { setBusy(false); }
  };

  if (!can('receive')) {
    return (
      <div>
        <div className="page-head"><div className="h1">Receive</div></div>
        <div className="card pad dimmer">Your role can't receive deliveries.</div>
      </div>
    );
  }

  if (stage === 'emails' && emails) {
    return (
      <div>
        <div className="page-head">
          <div className="h1">Receive — follow-up emails</div>
          <div className="grow" />
          <button className="btn ghost" onClick={startOver} disabled={busy}>Skip</button>
          <button className="btn primary" onClick={sendEmails} disabled={busy}>Send {emails.length} email(s)</button>
        </div>
        {emails.map((e, i) => (
          <div className="email-preview" key={i} style={{ marginBottom: 14 }}>
            <div className="hd"><b>To:</b> {e.to} — <b>{e.subject}</b></div>
            <pre>{e.body}</pre>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div className="h1">Receive</div>
        <div className="grow" />
        {started && <button className="btn ghost" onClick={startOver} disabled={busy}
          title="Leave this delivery as it is and start another">Start a new delivery</button>}
        {started && <button className="btn green" onClick={done} disabled={busy}>
          {busy ? 'Finishing…' : `✓ Done — ${scanned.length} box${scanned.length === 1 ? '' : 'es'}`}
        </button>}
      </div>

      <div className="card pad" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Day received</label>
            <input type="date" value={receivedOn} max={today()} disabled={started}
              onChange={(e) => { const v = e.target.value || today(); pickedRef.current = v !== today(); setReceivedOn(v); }} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Invoice number</label>
            <input type="text" value={invoiceNo} placeholder="from the paper" style={{ width: 170 }}
              onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 280 }}>
            <label>Purchase order (optional)</label>
            <select value={poId} disabled={started} onChange={(e) => setReceivingPo(e.target.value || null)}>
              <option value="">No purchase order</option>
              {openPos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.num} — {vmap[p.vendor_id]?.name || p.vendor_id}{p.status === 'partial' ? ' (partly received)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <form onSubmit={typed} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Scan the game barcode, then the box serial</label>
              <input ref={scanBoxRef} type="text" data-scan-target="1" value={code}
                onChange={(e) => setCode(e.target.value)} placeholder="scan, or type a game name"
                style={{ width: 250, borderColor: 'var(--green)', fontFamily: "'IBM Plex Mono',monospace" }} />
            </div>
            <span className="scan-ind on"><span className="dot" />{scanned.length} scanned</span>
          </form>
        </div>
        {started && (
          <p className="muted-note" style={{ marginTop: 8 }}>
            Receiving on {fmtYmd(receivedOn)}{po ? ` against ${po.num}` : ' with no purchase order'}. Every scan is already in stock;
            date and PO are locked for this delivery.
          </p>
        )}
      </div>

      {pending && (
        <div className="card pad" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', background: '#ecfdf5', borderColor: 'var(--green)' }}>
          <span>Game: <b>{pending.name}</b> <span className="mono dim">· form {pending.form_number} · {Number(pending.tickets || 0).toLocaleString()} tickets</span> — <b>now scan the box serial</b></span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      {po && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            {po.num} · {vmap[po.vendor_id]?.name}
          </div>
          <table className="tbl">
            <thead><tr>
              <th className="first">Game</th><th>Form</th><th className="r">Ordered</th>
              <th className="r">Received before</th><th className="r">This delivery</th><th className="r last">Still expected</th>
            </tr></thead>
            <tbody>
              {lineRows.map(({ l, received, now, remaining }) => (
                <tr key={l.id} style={remaining === 0 ? { opacity: 0.6 } : {}}>
                  <td className="first">{pmap[l.product_id]?.name || l.name_snapshot}</td>
                  <td className="mono dim">{pmap[l.product_id]?.form_number}</td>
                  <td className="r mono">{l.qty}</td>
                  <td className="r mono">{received - now}</td>
                  <td className="r mono"><b>{now || ''}</b></td>
                  <td className="r mono last">{remaining === 0 ? <span className="badge b-green">complete</span> : remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
          Scanned this delivery ({scanned.length})
        </div>
        {scanned.length === 0
          ? <div style={{ padding: 26, textAlign: 'center' }} className="dimmer">
              Scan the first box — it goes straight into inventory.
            </div>
          : (
            <table className="tbl">
              <thead><tr>
                <th className="first">Time</th><th>Game</th><th>Form</th><th>Serial</th><th className="r">Tickets</th>
                <th /><th className="last" style={{ width: 80 }} />
              </tr></thead>
              <tbody>
                {scanned.map((x) => (
                  <tr key={x.box.id}>
                    <td className="first dimmer" style={{ fontSize: 12 }}>{new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</td>
                    <td>{x.product.name}</td>
                    <td className="mono dim">{x.product.form_number}</td>
                    <td className="mono">{x.box.serial}</td>
                    <td className="r mono">{(Number(x.product.tickets) || 0).toLocaleString()}</td>
                    <td>{po && !x.onPo && <span className="badge b-gold">not on PO</span>}</td>
                    <td className="last r"><button className="btn ghost sm" onClick={() => undoOne(x.box.id).catch((e) => setToast(e.message))}>Undo</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {!started && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            Recent deliveries
          </div>
          {arrivals.length === 0
            ? <div style={{ padding: 22, textAlign: 'center' }} className="dimmer">Nothing received yet.</div>
            : (
              <table className="tbl"><tbody>
                {arrivals.slice(0, 15).map((d) => (
                  <tr key={d.id}>
                    <td className="first mono">{fmtYmd(d.received_at)}</td>
                    <td>{vmap[d.vendor_id]?.name || <span className="dimmer">no PO</span>}</td>
                    <td className="mono dim" style={{ fontSize: 12 }}>{d.po_ref || '—'}</td>
                    <td className="dim" style={{ fontSize: 12 }}>{d.invoice_no ? `inv ${d.invoice_no}` : ''}</td>
                    <td className="r mono last">{d.boxes} {d.boxes === 1 ? 'box' : 'boxes'}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
        </div>
      )}

      {choose && (
        <GamePickModal matches={choose} onClose={() => setChoose(null)}
          onPick={(p) => { setChoose(null); live.current.pending = p; setPending(p); flashFor(true);
            setToast(`${p.name} (form ${p.form_number}) — now scan the box serial.`); }} />
      )}
      {addGame && (
        <AddGameModal form={addGame.form} serial={addGame.serial}
          onClose={() => setAddGame(null)}
          onSaved={async (product) => {
            const serial = addGame.serial;
            setAddGame(null);
            if (!serial) {           // added from a lone game barcode: the serial comes next
              live.current.pending = product; setPending(product);
              flashFor(true);
              setToast(`${product.name} added — now scan the box serial.`);
              return;
            }
            await enqueue(async () => {
              try {
                const box = await receive(product, serial);
                flashFor(true);
                setToast(`✓ ${product.name} #${serial}`, () => undoOne(box.id));
              } catch (e) { flashFor(false); setToast(e.message, null, 6000); }
            });
          }} />
      )}
    </div>
  );
}
