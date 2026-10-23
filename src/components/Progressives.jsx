import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx } from '../App.jsx';
import JackpotDisplay, { LOOKS } from './JackpotDisplay.jsx';
import {
  defaultProgressives, normalize, partAmount, progAmount, feedingBoxes, hit, fmtJackpot, PALETTE, colorFor,
} from '../lib/logic/progressive.js';
import {
  playlistOf, buildSlides, missingScreens, screenLabel, cycleSeconds, prepareArt, MESSAGE_COLORS, DEFAULT_SECONDS,
} from '../lib/logic/tv.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const newId = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** Full screen on the TV: the screen that isn't this one when the browser can tell, otherwise this one. */
async function pickTvScreen() {
  try {
    if (!('getScreenDetails' in window)) return null;
    const d = await window.getScreenDetails();
    return d.screens.find((s) => s !== d.currentScreen && !s.isInternal) || d.screens.find((s) => s !== d.currentScreen) || null;
  } catch { return null; }
}

export default function Progressives() {
  const { store, settings, reloadSettings, reloadHall, products, boxes, setToast, can } = useContext(AppCtx);
  const saved = settings.progressives;
  const list = useMemo(() => (Array.isArray(saved) ? saved : defaultProgressives(products)).map(normalize), [saved, products]);
  const playlist = useMemo(() => playlistOf(settings.tv_playlist, list), [settings.tv_playlist, list]);
  const disp = { look: 'inferno', ...(settings.progressive_display || {}) };
  const [editing, setEditing] = useState(null);      // a progressive, or {} for new
  const [hitting, setHitting] = useState(null);
  const [showing, setShowing] = useState(null);      // look id while on the TV
  const [needClick, setNeedClick] = useState(false);
  const tvScreen = useRef(null);
  const mayEdit = can('settings');
  const mayHit = can('boxes');
  const mayRotate = can('boxes');
  const gameName = (id) => products.find((g) => g.id === id)?.name || id;

  const { slides, items } = buildSlides(playlist, list, boxes, products);
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
  const savePlaylist = async (next, msg) => {
    await store.setSetting('tv_playlist', next);
    await reloadSettings();
    if (msg) setToast(msg);
  };

  // on the TV: keep amounts and the rotation fresh while it runs all night
  useEffect(() => {
    if (!showing) return undefined;
    const t = setInterval(() => { reloadHall().catch(() => {}); reloadSettings().catch(() => {}); }, 30000);
    let lock = null;
    navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { clearInterval(t); lock?.release?.().catch(() => {}); };
  }, [showing, reloadHall, reloadSettings]);
  const fullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen(tvScreen.current ? { screen: tvScreen.current } : undefined);
      setNeedClick(false);
    } catch { setNeedClick(true); }
  };
  const showOnTv = async (look) => {
    setShowing(look);
    tvScreen.current = await pickTvScreen();
    await fullscreen();
  };
  const exitTv = () => {
    setShowing(null); setNeedClick(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement && !needClick) setShowing(null); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [needClick]);

  if (showing) {
    return (
      <>
        <JackpotDisplay slides={slides} items={items} look={showing} onExit={exitTv} />
        {needClick && (
          <div onClick={fullscreen} style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', cursor: 'pointer' }}>
            <div style={{ background: '#fff', color: '#111', padding: '18px 26px', borderRadius: 10, fontSize: 18, fontWeight: 600 }}>Click to go full screen on the TV</div>
          </div>
        )}
      </>
    );
  }

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
        <button className="btn primary" disabled={!slides.length} onClick={() => showOnTv(disp.look)}>📺 Show on TV</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="card pad stat"><label>Progressives</label><div className="v">{items.length}</div><div className="s">{Array.isArray(saved) ? 'saved' : 'BC defaults — not edited yet'}</div></div>
        <div className="card pad stat"><label>Total up for grabs</label><div className="v">{fmtJackpot(total)}</div><div className="s">all progressives together</div></div>
        <div className="card pad stat"><label>TV</label><div className="v" style={{ fontSize: 18 }}>{LOOKS.find((l) => l.id === disp.look)?.name}</div><div className="s">{slides.length} screens · {cycleSeconds(playlist)}s rotation</div></div>
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

      <Rotation playlist={playlist} list={list} look={disp.look} may={mayRotate} onSave={savePlaylist} />

      <div className="page-head" style={{ marginBottom: 6, marginTop: 26 }}>
        <div className="h1" style={{ fontSize: 16 }}>TV looks</div>
      </div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Live previews playing the rotation above. The <b>TV default</b> is what Show on TV uses.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
        {LOOKS.map((l, k) => (
          <div key={l.id} className="card" style={{ overflow: 'hidden', outline: disp.look === l.id ? '3px solid var(--teal)' : 'none' }}>
            <div style={{ aspectRatio: '16 / 9', background: '#000' }}>
              <JackpotDisplay slides={slides} items={items} look={l.id} preview startAt={k} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
              <div style={{ flex: 1 }}>
                <b>{l.name}</b>{disp.look === l.id && <span className="badge b-teal" style={{ marginLeft: 8 }}>TV default</span>}
                <div className="dim" style={{ fontSize: 12 }}>{l.blurb}</div>
              </div>
              {mayEdit && disp.look !== l.id && <button className="btn ghost sm" onClick={() => saveDisp({ look: l.id })}>Make TV default</button>}
              <button className="btn ghost sm" disabled={!slides.length} onClick={() => showOnTv(l.id)}>📺 Try on TV</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card pad" style={{ marginTop: 18, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <b>Hall TV</b>
          <div className="dim" style={{ fontSize: 13 }}>
            With the TV plugged into this computer, press <b>Show on TV</b>. The rotation plays full screen on the TV and keeps itself up to date. Press Esc to stop.
          </div>
        </div>
        <button className="btn primary" disabled={!slides.length} onClick={() => showOnTv(disp.look)}>📺 Show on TV</button>
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
      {hitting && <HitModal prog={hitting} boxes={boxes} products={products} onHit={recordHit} onClose={() => setHitting(null)} />}
    </div>
  );
}

/** The TV rotation: every screen in order, with its own seconds. */
function Rotation({ playlist, list, look, may, onSave }) {
  const { store, setToast } = useContext(AppCtx);
  const [msg, setMsg] = useState(null);   // a message screen being added/edited
  const [art, setArt] = useState(null);   // an art screen being added/edited
  const missing = missingScreens(playlist, list);
  const put = (next, toast) => onSave(next, toast).catch((e) => setToast('Could not save: ' + e.message, null, 6000));
  const update = (id, patch) => put(playlist.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= playlist.length) return;
    const next = [...playlist]; [next[i], next[j]] = [next[j], next[i]]; put(next);
  };
  const remove = async (s) => {
    await put(playlist.filter((x) => x.id !== s.id), `${screenLabel(s, list)} taken out of the rotation`);
    if (s.type === 'art' && s.path) store.deleteArt(s.path).catch(() => {});
  };
  const upsert = (s) => put(playlist.some((x) => x.id === s.id) ? playlist.map((x) => (x.id === s.id ? s : x)) : [...playlist, s], 'Rotation saved');
  const kind = { progressive: 'Progressive', all: 'All together', message: 'Message', art: 'Art' };

  return (
    <div className="card" style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 8px' }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 15 }}>TV rotation</b>
          <div className="dim" style={{ fontSize: 12.5 }}>The screens the TV plays, top to bottom, then starts over. Full rotation: <b>{cycleSeconds(playlist)} seconds</b>.</div>
        </div>
        {may && <button className="btn ghost sm" onClick={() => setMsg({})}>+ Message</button>}
        {may && <button className="btn ghost sm" onClick={() => setArt({})}>+ Art</button>}
      </div>
      <table className="tbl">
        <thead><tr>
          <th className="first" style={{ width: 54 }}>Show</th><th>Screen</th><th style={{ width: 110 }}>Type</th><th className="r" style={{ width: 120 }}>Seconds</th><th className="last" style={{ width: 210 }} />
        </tr></thead>
        <tbody>
          {playlist.map((s, i) => (
            <tr key={s.id} style={{ opacity: s.enabled === false ? 0.45 : 1 }}>
              <td className="first"><input type="checkbox" disabled={!may} checked={s.enabled !== false} onChange={(e) => update(s.id, { enabled: e.target.checked })} /></td>
              <td style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40 }}>
                {s.type === 'art' && s.url && <img src={s.url} alt="" style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 3, background: '#000' }} />}
                {s.type === 'message' && <span style={{ width: 12, height: 12, borderRadius: '50%', background: s.color || MESSAGE_COLORS[0], border: '1px solid rgba(0,0,0,.25)' }} />}
                {s.type === 'progressive' && <span style={{ width: 12, height: 12, borderRadius: '50%', background: list.find((p) => p.id === s.prog_id)?.color || '#999', border: '1px solid rgba(0,0,0,.25)' }} />}
                <span>{screenLabel(s, list)}</span>
              </td>
              <td className="dim">{kind[s.type]}</td>
              <td className="r"><Seconds value={s.seconds} disabled={!may} onChange={(v) => update(s.id, { seconds: v })} /></td>
              <td className="last r" style={{ whiteSpace: 'nowrap' }}>
                {may && <>
                  <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} title="Earlier">↑</button>{' '}
                  <button className="btn ghost sm" disabled={i === playlist.length - 1} onClick={() => move(i, 1)} title="Later">↓</button>{' '}
                  {(s.type === 'message' || s.type === 'art') && <><button className="btn ghost sm" onClick={() => (s.type === 'message' ? setMsg(s) : setArt(s))}>Edit</button>{' '}</>}
                  <button className="btn ghost sm" onClick={() => remove(s)} title="Take out of the rotation">Remove</button>
                </>}
              </td>
            </tr>
          ))}
          {!playlist.length && <tr><td colSpan={5} className="first dim" style={{ padding: 14 }}>Nothing in the rotation.</td></tr>}
        </tbody>
      </table>
      {may && missing.length > 0 && (
        <div style={{ padding: '10px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: 12.5 }}>Add back:</span>
          {missing.map((m) => {
            const { label, ...screen } = m;
            return <button key={m.id} className="btn ghost sm" onClick={() => put([...playlist, screen], `${label} added to the rotation`)}>+ {label}</button>;
          })}
        </div>
      )}
      <div style={{ height: 6 }} />
      {msg && <MessageModal screen={msg} look={look} onClose={() => setMsg(null)} onSave={async (s) => { await upsert(s); setMsg(null); }} />}
      {art && <ArtModal screen={art} look={look} onClose={() => setArt(null)} onSave={async (s) => { await upsert(s); setArt(null); }} />}
    </div>
  );
}

/** Seconds box that saves when you leave it (or press Enter), not on every keystroke. */
function Seconds({ value, disabled, onChange }) {
  const [v, setV] = useState(String(value ?? DEFAULT_SECONDS));
  useEffect(() => { setV(String(value ?? DEFAULT_SECONDS)); }, [value]);
  const commit = () => {
    const n = Math.max(2, Math.min(600, Math.round(Number(v)) || DEFAULT_SECONDS));
    setV(String(n));
    if (n !== Number(value)) onChange(n);
  };
  return (
    <input type="number" min="2" max="600" className="num" style={{ width: 70 }} disabled={disabled} value={v}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
  );
}

function MessageModal({ screen, look, onSave, onClose }) {
  const [text, setText] = useState(screen.text || '');
  const [color, setColor] = useState(screen.color || MESSAGE_COLORS[0]);
  const [seconds, setSeconds] = useState(screen.seconds ?? 4);
  const preview = [{ key: 'm', type: 'message', seconds: 999, text: text.trim() || 'Your message', color }];
  const save = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSave({ enabled: true, ...screen, id: screen.id || newId('msg'), type: 'message', text: text.trim(), color, seconds: Math.max(2, Number(seconds) || 4) });
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{screen.id ? 'Edit message' : 'Add a message to the TV'}</div>
        <div style={{ aspectRatio: '16 / 9', background: '#000', borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
          <JackpotDisplay slides={preview} look={look} preview />
        </div>
        <div className="field"><label>Message (Enter for a new line)</label>
          <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Hello, welcome to Bingo!" style={{ width: '100%', fontSize: 15 }} /></div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}><label>Colour</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {MESSAGE_COLORS.map((c) => (
                <button type="button" key={c} onClick={() => setColor(c)} title={c}
                  style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? '3px solid var(--ink)' : '1px solid rgba(0,0,0,.25)' }} />
              ))}
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}><label>Seconds on screen</label>
            <input type="number" min="2" max="600" className="num" style={{ width: 80 }} value={seconds} onChange={(e) => setSeconds(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" type="submit" disabled={!text.trim()}>{screen.id ? 'Save' : 'Add to rotation'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function ArtModal({ screen, look, onSave, onClose }) {
  const { store, setToast } = useContext(AppCtx);
  const [file, setFile] = useState(null);
  const [localUrl, setLocalUrl] = useState(null);
  const [name, setName] = useState(screen.name || '');
  const [fit, setFit] = useState(screen.fit || 'fit');
  const [seconds, setSeconds] = useState(screen.seconds ?? DEFAULT_SECONDS);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const pick = (f) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setToast('That isn\'t a picture — choose a JPG, PNG, GIF or WebP'); return; }
    setFile(f); setLocalUrl(URL.createObjectURL(f));
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  };
  const shown = localUrl || screen.url;
  const preview = shown ? [{ key: 'a', type: 'art', seconds: 999, url: shown, fit }] : [];
  const save = async (e) => {
    e.preventDefault();
    if (!shown || busy) return;
    setBusy(true);
    try {
      let { url, path } = screen;
      if (file) {
        const ready = await prepareArt(file);
        ({ url, path } = await store.uploadArt(ready.blob, ready.ext, ready.type));
        if (screen.path) store.deleteArt(screen.path).catch(() => {});
      }
      await onSave({ enabled: true, ...screen, id: screen.id || newId('art'), type: 'art', url, path: path || null, name: name.trim() || 'Picture', fit, seconds: Math.max(2, Number(seconds) || DEFAULT_SECONDS) });
    } catch (err) {
      setToast('Could not upload the picture: ' + err.message, null, 7000);
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <form className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{screen.id ? 'Edit art' : 'Add art to the TV'}</div>
        <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
          style={{ display: 'block', aspectRatio: '16 / 9', background: '#000', borderRadius: 6, overflow: 'hidden', marginBottom: 12, cursor: 'pointer', position: 'relative' }}>
          {shown
            ? <JackpotDisplay slides={preview} look={look} preview />
            : <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#ddd', gap: 6 }}>
                <div style={{ fontSize: 34 }}>🖼️</div><b>Click to choose a picture</b><span style={{ fontSize: 12, opacity: .7 }}>or drag one here · JPG, PNG, GIF, WebP</span>
              </div>}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {shown && <div style={{ marginTop: -6, marginBottom: 10 }}>
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}>Choose a different picture
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} /></label>
        </div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}><label>Name (just for this list)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} /></div>
          <div className="field" style={{ margin: 0 }}><label>On the TV</label>
            <select value={fit} onChange={(e) => setFit(e.target.value)}>
              <option value="fit">Whole picture</option>
              <option value="fill">Fill the screen (may crop)</option>
            </select></div>
          <div className="field" style={{ margin: 0 }}><label>Seconds</label>
            <input type="number" min="2" max="600" className="num" style={{ width: 80 }} value={seconds} onChange={(e) => setSeconds(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn primary" type="submit" disabled={!shown || busy}>{busy ? 'Uploading…' : screen.id ? 'Save' : 'Add to rotation'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
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
