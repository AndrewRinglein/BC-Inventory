import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AppCtx } from '../App.jsx';
import JackpotDisplay, { LOOKS } from './JackpotDisplay.jsx';
import {
  defaultProgressives, normalize, partAmount, progAmount, feedingBoxes, displayItem, hit, fmtJackpot, PALETTE, colorFor,
} from '../lib/logic/progressive.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export default function Progressives() {
  const { store, settings, reloadSettings, reloadHall, products, boxes, setToast, can } = useContext(AppCtx);
  const saved = settings.progressives;
  const list = useMemo(() => (Array.isArray(saved) ? saved : defaultProgressives(products)).map(normalize), [saved, products]);
  const disp = { look: 'inferno', seconds: 10, ...(settings.progressive_display || {}) };
  const [editing, setEditing] = useState(null);      // a progressive, or {} for new
  const [hitting, setHitting] = useState(null);
  const [showing, setShowing] = useState(null);      // look id while full screen
  const mayEdit = can('settings');
  const mayHit = can('boxes');
  const gameName = (id) => products.find((g) => g.id === id)?.name || id;

  const items = list.map((p) => displayItem(p, boxes, products));
  const total = items.reduce((s, x) => s + x.amount, 0);

  const saveList = async (next, msg, undo) => {
    await store.setSetting('progressives', next);
    await store.logEvent('catalog.progressive', 'settings', 'progressives', { label: msg });
    await reloadSettings();
    setToast(msg, undo || null);
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
    if (look !== disp.look && mayEdit) saveDisp({ look }).catch(() => {});
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

  const recordHit = async (prog, partIds) => {
    const before = saved ?? null;
    const p = hit(prog, partIds, boxes, products);
    const paid = p.parts.filter((x) => partIds.includes(x.id));
    const sum = paid.reduce((s, x) => s + x.hits[0].amount, 0);
    const what = prog.parts.length > 1 ? `${paid.map((x) => x.label).join(' + ')} ` : '';
    await saveList(list.map((x) => (x.id === p.id ? p : x)), `${prog.name} ${what}hit: ${fmtJackpot(sum)} recorded`,
      async () => { await store.setSetting('progressives', before); await reloadSettings(); });
    setHitting(null);
  };

  return (
    <div>
      <div className="page-head">
        <div className="h1">Progressive Jackpots</div>
        <div className="grow" />
        {mayEdit && <button className="btn ghost" onClick={() => setEditing({})}>+ Add progressive</button>}
        <button className="btn primary" disabled={!items.length} onClick={() => goFull(disp.look)}>▶ Start TV display</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="card pad stat"><label>Progressives</label><div className="v">{items.length}</div><div className="s">{Array.isArray(saved) ? 'saved' : 'BC defaults — not edited yet'}</div></div>
        <div className="card pad stat"><label>Total up for grabs</label><div className="v">{fmtJackpot(total)}</div><div className="s">all progressives together</div></div>
        <div className="card pad stat"><label>TV display</label><div className="v" style={{ fontSize: 18 }}>{LOOKS.find((l) => l.id === disp.look)?.name}</div><div className="s">each progressive {disp.seconds}s</div></div>
      </div>

      {!items.length && (
        <div className="card pad dim" style={{ marginBottom: 16 }}>No progressives yet. Add one, and pick the games that pay into it.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12, marginBottom: 26 }}>
        {list.map((p) => {
          const multi = p.parts.length > 1;
          return (
            <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ height: 6, background: multi ? `linear-gradient(90deg, ${p.parts.map((x, i) => x.color || colorFor(x.label, i)).join(',')})` : p.color }} />
              <div style={{ padding: 16 }}>
                <b style={{ fontSize: 15 }}>{p.name}</b>
                {!multi && <div className="mono" style={{ fontSize: 32, fontWeight: 700, margin: '8px 0 4px' }}>{fmtJackpot(progAmount(p, boxes, products))}</div>}
                {multi && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p.parts.length}, 1fr)`, gap: 8, margin: '10px 0 6px' }}>
                    {p.parts.map((pt, i) => (
                      <div key={pt.id} style={{ borderLeft: `4px solid ${pt.color || colorFor(pt.label, i)}`, paddingLeft: 8 }}>
                        <div className="dimmer" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.8px' }}>{pt.label}</div>
                        <div className="mono" style={{ fontSize: 21, fontWeight: 700 }}>{fmtJackpot(partAmount(p, pt, boxes, products))}</div>
                        <div className="dimmer" style={{ fontSize: 11 }}>+{fmtJackpot(pt.per_box)}/deal</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  {!multi && (() => {
                    const pt = p.parts[0];
                    const n = feedingBoxes(p, pt, boxes).length;
                    const per = pt.per_box != null && pt.per_box !== ''
                      ? `${fmtJackpot(pt.per_box)} per deal`
                      : p.game_ids.map((g) => `${gameName(g)} ${fmtJackpot(products.find((x) => x.id === g)?.progressive_amount)}`).join(' · ') + ' per deal';
                    return <>{per}<br />{n} deal{n === 1 ? '' : 's'} sold out since {pt.reset_at ? 'last hit' : 'start'}<br /></>;
                  })()}
                  Fed by {p.game_ids.map(gameName).join(', ') || 'no games'}<br />
                  Last hit: {(() => {
                    const last = p.parts.flatMap((pt) => (pt.hits || []).map((h) => ({ ...h, label: pt.label }))).sort((a, b) => b.at.localeCompare(a.at))[0];
                    return last ? <>{multi && last.label ? `${last.together ? 'all' : last.label} · ` : ''}{fmtJackpot(last.amount)} on {fmtDate(last.at)}</> : 'never';
                  })()}
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
        <label className="dim" style={{ fontSize: 13 }}>Each progressive on screen for&nbsp;
          <select value={disp.seconds} disabled={!mayEdit} onChange={(e) => saveDisp({ seconds: Number(e.target.value) })}>
            {[5, 8, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
        </label>
      </div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Live previews with your real progressives. Pick one and press Show to fill the screen — put this page on the hall TV.
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

      <TvSetup look={LOOKS.find((l) => l.id === disp.look)?.name} setToast={setToast} />

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
      {hitting && <HitModal prog={hitting} boxes={boxes} products={products} onHit={recordHit} onClose={() => setHitting(null)} />}
    </div>
  );
}

function HitModal({ prog, boxes, products, onHit, onClose }) {
  const multi = prog.parts.length > 1;
  const [pick, setPick] = useState(multi ? [] : [prog.parts[0].id]);
  const [busy, setBusy] = useState(false);
  const amt = (pt) => partAmount(prog, pt, boxes, products);
  const go = async (ids) => { if (busy || !ids.length) return; setBusy(true); try { await onHit(prog, ids); } finally { setBusy(false); } };
  const sum = prog.parts.filter((pt) => pick.includes(pt.id)).reduce((s, pt) => s + amt(pt), 0);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{prog.name} — jackpot hit</div>
        {multi ? (
          <>
            <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>Which bonus hit? Each one you pick is paid and starts over.</p>
            {prog.parts.map((pt, i) => (
              <label key={pt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={pick.includes(pt.id)}
                  onChange={() => setPick((x) => (x.includes(pt.id) ? x.filter((y) => y !== pt.id) : [...x, pt.id]))} />
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: pt.color || colorFor(pt.label, i), border: '1px solid rgba(0,0,0,.25)' }} />
                <b style={{ flex: 1 }}>{pt.label}</b>
                <span className="mono">{fmtJackpot(amt(pt))}</span>
              </label>
            ))}
            <button className="btn ghost" disabled={busy} style={{ width: '100%', marginTop: 4 }} onClick={() => go(prog.parts.map((x) => x.id))}
              title="The ticket that pays every bonus at once">
              All {prog.parts.length} hit at once ({prog.parts.map((x) => x.label).join('-')} ticket) · {fmtJackpot(prog.parts.reduce((s, pt) => s + amt(pt), 0))}
            </button>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={busy || !pick.length} onClick={() => go(pick)}>
                {pick.length ? `Record ${fmtJackpot(sum)}` : 'Pick a bonus'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
              Records a payout of <b className="mono">{fmtJackpot(amt(prog.parts[0]))}</b> now and starts the
              progressive over at {fmtJackpot(prog.parts[0].seed || 0)}. Only deals sold out after this count toward the next one.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" disabled={busy} onClick={() => go(pick)}>Record hit</button>
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EditModal({ prog, list, products, onSave, onDelete, onClose }) {
  const isNew = !prog.id;
  const now = new Date().toISOString();
  const [f, setF] = useState({
    name: prog.name || '', color: prog.color || PALETTE[list.length % PALETTE.length], game_ids: prog.game_ids || [],
    parts: (prog.parts || [{ id: 'main', label: '', color: null, per_box: null, seed: 0, adjust: 0, reset_at: now, hits: [] }])
      .map((pt) => ({ ...pt, per_box: pt.per_box ?? '', seed: pt.seed ?? 0, adjust: pt.adjust ?? 0 })),
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setPart = (i, k, v) => setF((x) => ({ ...x, parts: x.parts.map((pt, j) => (j === i ? { ...pt, [k]: v } : pt)) }));
  const toggle = (id) => set('game_ids', f.game_ids.includes(id) ? f.game_ids.filter((x) => x !== id) : [...f.game_ids, id]);
  const multi = f.parts.length > 1;
  const sorted = [...products].filter((p) => p.active !== false)
    .sort((a, b) => (Number(b.progressive_amount) || 0) - (Number(a.progressive_amount) || 0) || a.name.localeCompare(b.name));
  const addPart = () => setF((x) => {
    const parts = x.parts.length === 1 && !x.parts[0].label ? [{ ...x.parts[0], label: 'Red', color: '#ff2a2a' }] : x.parts;
    const k = parts.length;
    return { ...x, parts: [...parts, { id: 'p' + Date.now().toString(36) + k, label: '', color: PALETTE[k % PALETTE.length], per_box: '', seed: 0, adjust: 0, reset_at: now, hits: [] }] };
  });
  const save = (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    onSave({
      ...prog,
      id: prog.id || 'p' + Date.now().toString(36),
      name: f.name.trim(), color: f.color, game_ids: f.game_ids,
      parts: f.parts.map((pt) => ({
        ...pt, label: (pt.label || '').trim(), per_box: pt.per_box === '' ? null : Number(pt.per_box),
        seed: Number(pt.seed) || 0, adjust: Number(pt.adjust) || 0,
      })),
    });
  };
  const num = { textAlign: 'right', width: '100%' };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{isNew ? 'Add a progressive' : `Edit ${prog.name}`}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
          <div className="field"><label>Name (the headline on the TV)</label>
            <input type="text" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} style={{ width: '100%' }} /></div>
          <div className="field"><label>Colour</label>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {PALETTE.map((c) => (
                <button type="button" key={c} onClick={() => set('color', c)} title={c}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: f.color === c ? '3px solid var(--ink)' : '1px solid rgba(0,0,0,.25)' }} />
              ))}
            </div>
          </div>
        </div>

        <div className="field"><label>Games that pay into it</label>
          <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px' }}>
            {sorted.map((g) => (
              <label key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13, textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>
                <input type="checkbox" checked={f.game_ids.includes(g.id)} onChange={() => toggle(g.id)} />
                {g.name} <span className="dimmer mono" style={{ fontSize: 11 }}>{g.form_number}{Number(g.progressive_amount) ? ` · ${fmtJackpot(g.progressive_amount)} to progressive` : ''}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginBottom: 4 }}><label>{multi ? 'Bonuses — each grows and pays on its own' : 'Amounts'}</label></div>
        <table className="tbl" style={{ marginBottom: 6 }}>
          <thead><tr>
            {multi && <th>Bonus</th>}{multi && <th />}
            <th className="r">$ per deal sold out</th><th className="r">Starts at $</th><th className="r">Adjustment $</th>{multi && <th />}
          </tr></thead>
          <tbody>
            {f.parts.map((pt, i) => (
              <tr key={pt.id}>
                {multi && <td><input type="text" value={pt.label} placeholder="e.g. Red" onChange={(e) => setPart(i, 'label', e.target.value)} style={{ width: 90 }} /></td>}
                {multi && <td><input type="color" value={pt.color || colorFor(pt.label, i)} onChange={(e) => setPart(i, 'color', e.target.value)} style={{ width: 30, height: 24, border: 'none', background: 'none' }} /></td>}
                <td><input type="number" step="0.01" style={num} value={pt.per_box} placeholder="each game's own" onChange={(e) => setPart(i, 'per_box', e.target.value)} /></td>
                <td><input type="number" step="0.01" style={num} value={pt.seed} onChange={(e) => setPart(i, 'seed', e.target.value)} /></td>
                <td><input type="number" step="0.01" style={num} value={pt.adjust} onChange={(e) => setPart(i, 'adjust', e.target.value)} /></td>
                {multi && <td><button type="button" className="btn ghost sm" onClick={() => set('parts', f.parts.filter((_, j) => j !== i))}>×</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn ghost sm" onClick={addPart}>+ Add a bonus{multi ? '' : ' (split into red / white / blue style parts)'}</button>
        <p className="dimmer" style={{ fontSize: 11.5, marginTop: 8 }}>
          Leave "$ per deal" blank to use each game's own "Amount to progressive" from the catalog.
          Use the adjustment to match the board on day one, or to correct it later.
        </p>
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

/** The TV link and a one-click launcher for the computer plugged into the TV. */
function TvSetup({ look, setToast }) {
  const u = new URL(window.location.href);
  const keep = u.searchParams.has('demo') ? '&demo' : '';
  const link = `${u.origin}${u.pathname}?tv${keep}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setToast('TV link copied'); } catch { setToast('Copy failed — select the link and copy it'); }
  };
  const launcher = () => {
    const chrome = '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe';
    const bat = [
      '@echo off',
      'REM BC Inventory - progressive jackpot TV. Opens the TV display full screen on the screen it starts on.',
      'REM To leave it: press Alt+F4.  To start it with the computer: put this file (or a shortcut) in',
      'REM   Win+R  ->  shell:startup',
      `set "URL=${link}"`,
      `if not exist "${chrome}" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"`,
      `if exist "${chrome}" set "CHROME=${chrome}"`,
      'if defined CHROME if exist "%CHROME%" (',
      `  start "" "%CHROME%" --kiosk --no-first-run --disable-session-crashed-bubble --disable-features=Translate "%URL%"`,
      ') else (',
      '  start "" msedge --start-fullscreen --no-first-run --app="%URL%"',
      ')',
      '',
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bat], { type: 'application/octet-stream' }));
    a.download = 'BC Jackpot TV.bat';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div className="card pad" style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Hall TV (HDMI)</div>
      <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>
        The TV shows the <b>TV default</b> look ({look}), full screen, with nothing else on it. Change the default above and the
        TV switches within 30 seconds; amounts update as boxes sell out.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input type="text" readOnly value={link} className="mono" style={{ flex: 1, minWidth: 260 }} onFocus={(e) => e.target.select()} />
        <button className="btn ghost sm" onClick={copy}>Copy link</button>
        <a className="btn ghost sm" href={link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open TV view</a>
        <button className="btn primary sm" onClick={launcher}>Download TV launcher (Windows)</button>
      </div>
      <ol className="dim" style={{ fontSize: 12.5, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Plug the computer into the TV with HDMI. In Windows display settings (Win+P), choose <b>Second screen only</b> — or
          <b> Duplicate</b> if you want the same picture on both.</li>
        <li>On that computer, open the TV link once and sign in. It stays signed in after that.</li>
        <li>Run <b>BC Jackpot TV.bat</b>: the display opens full screen with no browser bars or cursor. Alt+F4 closes it.</li>
        <li>To start it automatically when the computer turns on, press Win+R, type <span className="mono">shell:startup</span>, and put the .bat file in that folder.
          Also set Windows Power &amp; sleep to <b>Never</b> so the screen stays on.</li>
      </ol>
    </div>
  );
}
