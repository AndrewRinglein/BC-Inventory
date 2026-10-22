import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import JackpotDisplay, { LOOKS } from './JackpotDisplay.jsx';
import {
  defaultProgressives, currentAmount, feedingBoxes, hit, fmtJackpot, PALETTE,
} from '../lib/logic/progressive.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export default function Progressives() {
  const { store, settings, reloadSettings, reloadHall, products, boxes, setToast, can } = useContext(AppCtx);
  const saved = settings.progressives;
  const list = useMemo(() => (Array.isArray(saved) ? saved : defaultProgressives(products)), [saved, products]);
  const disp = { look: 'inferno', seconds: 10, ...(settings.progressive_display || {}) };
  const [editing, setEditing] = useState(null);      // a progressive, or {} for new
  const [hitting, setHitting] = useState(null);
  const [showing, setShowing] = useState(null);      // look id while full screen
  const mayEdit = can('settings');
  const mayHit = can('boxes');

  const items = list.map((p) => ({ id: p.id, name: p.name, color: p.color, amount: currentAmount(p, boxes) }));
  const total = items.reduce((s, x) => s + x.amount, 0);

  const saveList = async (next, msg) => {
    await store.setSetting('progressives', next);
    await store.logEvent('catalog.progressive', 'settings', 'progressives', { label: msg });
    await reloadSettings();
    setToast(msg);
  };
  const saveDisp = async (patch) => {
    await store.setSetting('progressive_display', { ...disp, ...patch });
    await reloadSettings();
  };

  // full screen: keep the numbers fresh while the TV runs all night
  useEffect(() => {
    if (!showing) return undefined;
    const t = setInterval(() => { reloadHall().catch(() => {}); }, 60000);
    return () => clearInterval(t);
  }, [showing, reloadHall]);
  const goFull = async (look) => {
    if (look !== disp.look) saveDisp({ look }).catch(() => {});
    setShowing(look);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* not allowed — the overlay still covers the window */ }
  };
  const exitFull = () => {
    setShowing(null);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setShowing(null); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  if (showing) return <JackpotDisplay items={items} look={showing} seconds={disp.seconds} onExit={exitFull} />;

  return (
    <div>
      <div className="page-head">
        <div className="h1">Progressive Jackpots</div>
        <div className="grow" />
        {mayEdit && <button className="btn ghost" onClick={() => setEditing({})}>+ Add progressive</button>}
        <button className="btn primary" disabled={!items.length} onClick={() => goFull(disp.look)}>▶ Start TV display</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="card pad stat"><label>Progressives</label><div className="v">{items.length}</div><div className="s">{Array.isArray(saved) ? 'saved' : 'from the game catalog'}</div></div>
        <div className="card pad stat"><label>Total up for grabs</label><div className="v">{fmtJackpot(total)}</div><div className="s">all jackpots together</div></div>
        <div className="card pad stat"><label>TV display</label><div className="v" style={{ fontSize: 18 }}>{LOOKS.find((l) => l.id === disp.look)?.name}</div><div className="s">each jackpot {disp.seconds}s</div></div>
      </div>

      {!items.length && (
        <div className="card pad dim" style={{ marginBottom: 16 }}>
          No game in the catalog sends money to a progressive yet. Set "Amount to progressive" on a game, or add one here.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, marginBottom: 26 }}>
        {list.map((p) => {
          const amt = currentAmount(p, boxes);
          const n = feedingBoxes(p, boxes).length;
          const games = (p.game_ids || []).map((id) => products.find((g) => g.id === id)?.name || id);
          return (
            <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ height: 6, background: p.color }} />
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: p.color, border: '1px solid rgba(0,0,0,.2)' }} />
                  <b style={{ fontSize: 15 }}>{p.name}</b>
                </div>
                <div className="mono" style={{ fontSize: 32, fontWeight: 700, margin: '8px 0 4px' }}>{fmtJackpot(amt)}</div>
                <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  {fmtJackpot(p.per_box)} per box sold out · {n} box{n === 1 ? '' : 'es'} since {p.reset_at ? 'last hit' : 'start'}<br />
                  {Number(p.seed) ? <>Starts at {fmtJackpot(p.seed)} · </> : null}
                  {Number(p.adjust) ? <>Adjusted {Number(p.adjust) > 0 ? '+' : ''}{fmtJackpot(p.adjust)} · </> : null}
                  Fed by {games.join(', ') || 'no games'}<br />
                  Last hit: {p.hits?.[0] ? <>{fmtJackpot(p.hits[0].amount)} on {fmtDate(p.hits[0].at)}</> : 'never'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {mayHit && <button className="btn primary sm" onClick={() => setHitting(p)}>Jackpot hit</button>}
                  {mayEdit && <button className="btn ghost sm" onClick={() => setEditing(p)}>Edit</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="page-head" style={{ marginBottom: 6 }}>
        <div className="h1" style={{ fontSize: 16 }}>TV display looks</div>
        <div className="grow" />
        <label className="dim" style={{ fontSize: 13 }}>Each jackpot on screen for&nbsp;
          <select value={disp.seconds} disabled={!mayEdit} onChange={(e) => saveDisp({ seconds: Number(e.target.value) })}>
            {[5, 8, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
        </label>
      </div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Live previews with your real jackpots. Pick one and press Show to fill the screen — put this page on the hall TV.
        On the TV: Esc or double-click to leave, arrow keys to step through.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
        {LOOKS.map((l, k) => (
          <div key={l.id} className="card" style={{ overflow: 'hidden', outline: disp.look === l.id ? '3px solid var(--teal)' : 'none' }}>
            <div style={{ aspectRatio: '16 / 9', background: '#000' }}>
              <JackpotDisplay items={items} look={l.id} seconds={disp.seconds} preview startAt={k} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
              <div style={{ flex: 1 }}>
                <b>{l.name}</b>{disp.look === l.id && <span className="badge b-teal" style={{ marginLeft: 8 }}>TV default</span>}
                <div className="dim" style={{ fontSize: 12 }}>{l.blurb}</div>
              </div>
              {mayEdit && disp.look !== l.id && <button className="btn ghost sm" onClick={() => saveDisp({ look: l.id })}>Use on TV</button>}
              <button className="btn primary sm" disabled={!items.length} onClick={() => goFull(l.id)}>▶ Show</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditModal prog={editing} list={list} products={products}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            const exists = list.some((x) => x.id === p.id);
            await saveList(exists ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p], `${p.name} saved`);
            setEditing(null);
          }}
          onDelete={async (p) => { await saveList(list.filter((x) => x.id !== p.id), `${p.name} removed`); setEditing(null); }} />
      )}
      {hitting && (
        <div className="modal-bg" onClick={() => setHitting(null)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{hitting.name} — jackpot hit?</div>
            <p className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
              Records a payout of <b className="mono">{fmtJackpot(currentAmount(hitting, boxes))}</b> now and starts
              the jackpot over at {fmtJackpot(hitting.seed || 0)}. Only boxes sold out after this count toward the next one.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={async () => {
                const before = list;
                const p = hit(hitting, boxes);
                await saveList(list.map((x) => (x.id === p.id ? p : x)), `${p.name}: ${fmtJackpot(p.hits[0].amount)} hit recorded`);
                setHitting(null);
                setToast(`${p.name}: hit recorded`, async () => { await store.setSetting('progressives', before); await reloadSettings(); });
              }}>Record hit</button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setHitting(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({ prog, list, products, onSave, onDelete, onClose }) {
  const isNew = !prog.id;
  const [f, setF] = useState({
    name: prog.name || '', color: prog.color || PALETTE[list.length % PALETTE.length],
    seed: prog.seed ?? 0, per_box: prog.per_box ?? '', adjust: prog.adjust ?? 0, game_ids: prog.game_ids || [],
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (id) => set('game_ids', f.game_ids.includes(id) ? f.game_ids.filter((x) => x !== id) : [...f.game_ids, id]);
  const sorted = [...products].filter((p) => p.active !== false)
    .sort((a, b) => (Number(b.progressive_amount) || 0) - (Number(a.progressive_amount) || 0) || a.name.localeCompare(b.name));
  const save = (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    onSave({
      hits: [], reset_at: isNew ? new Date().toISOString() : null, ...prog,
      id: prog.id || 'p' + Date.now().toString(36),
      name: f.name.trim(), color: f.color, seed: Number(f.seed) || 0, per_box: Number(f.per_box) || 0,
      adjust: Number(f.adjust) || 0, game_ids: f.game_ids,
    });
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{isNew ? 'Add a progressive' : `Edit ${prog.name}`}</div>
        <div className="field"><label>Name (shown on the TV)</label>
          <input type="text" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} style={{ width: '100%' }} /></div>
        <div className="field"><label>Colour</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => set('color', c)} title={c}
                style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: f.color === c ? '3px solid var(--ink)' : '1px solid rgba(0,0,0,.25)' }} />
            ))}
            <input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} style={{ width: 34, height: 28, border: 'none', background: 'none' }} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div className="field"><label>Starts at $</label><input type="number" step="0.01" value={f.seed} onChange={(e) => set('seed', e.target.value)} /></div>
          <div className="field"><label>$ added per box sold out</label><input type="number" step="0.01" value={f.per_box} onChange={(e) => set('per_box', e.target.value)} /></div>
          <div className="field"><label>Manual adjustment $</label><input type="number" step="0.01" value={f.adjust} onChange={(e) => set('adjust', e.target.value)} /></div>
        </div>
        <div className="field"><label>Games that feed it</label>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px' }}>
            {sorted.map((g) => (
              <label key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>
                <input type="checkbox" checked={f.game_ids.includes(g.id)} onChange={() => toggle(g.id)} />
                {g.name} <span className="dimmer mono" style={{ fontSize: 11 }}>{g.form_number}{Number(g.progressive_amount) ? ` · ${fmtJackpot(g.progressive_amount)} to progressive` : ''}</span>
              </label>
            ))}
          </div>
        </div>
        <p className="dimmer" style={{ fontSize: 11.5 }}>Use the manual adjustment to match the jackpot board on day one, or to correct it later.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn primary" type="submit">Save</button>
          {!isNew && <button className="btn ghost" type="button" style={{ color: '#a33' }} onClick={() => onDelete(prog)}>Remove</button>}
          <div style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
