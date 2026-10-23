import React, { useCallback, useEffect, useState } from 'react';
import { store } from '../lib/store/index.js';
import { HALL_ID } from '../lib/roles.js';
import { defaultProgressives, normalize } from '../lib/logic/progressive.js';
import { playlistOf, buildSlides } from '../lib/logic/tv.js';
import JackpotDisplay from './JackpotDisplay.jsx';
import Login from './Login.jsx';

/**
 * The hall TV as its own page (?tv) — the same rotation Show on TV plays, for a computer
 * that only ever drives the TV. No sidebar, no buttons: it plays the TV rotation in the
 * TV default look, and keeps itself going unattended:
 *  - amounts, the look and the rotation refresh every 30 seconds
 *  - a dropped connection keeps the last numbers on screen and retries
 *  - the screen is kept awake; the page reloads itself when a new version is published
 *    and once a night for a clean start
 */
const REFRESH_MS = 30 * 1000;

export default function TvApp() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);        // { slides, items, look }
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    (async () => { await store.init(); setSession(await store.getSession()); setReady(true); })();
  }, []);

  const load = useCallback(async () => {
    try {
      const [products, boxes, saved, disp, pl] = await Promise.all([
        store.getProducts(), store.getBoxes(HALL_ID), store.getSetting('progressives'), store.getSetting('progressive_display'),
        store.getSetting('tv_playlist'),
      ]);
      const list = (Array.isArray(saved) ? saved : defaultProgressives(products)).map(normalize);
      setData({ ...buildSlides(playlistOf(pl, list), list, boxes, products), look: disp?.look || 'inferno' });
      setOffline(false);
    } catch {
      setOffline(true);            // keep showing the last numbers
    }
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [session, load]);

  // keep the screen awake (re-acquired when the tab comes back into view)
  useEffect(() => {
    let lock = null;
    const grab = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } };
    grab();
    const onVis = () => { if (document.visibilityState === 'visible') grab(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}); };
  }, []);

  // reload on a new published version, and every night around 4am
  useEffect(() => {
    const t = setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 4 && now.getMinutes() < 2 && performance.now() > 10 * 60 * 1000) { location.reload(); return; }
      if (typeof __BUILD_ID__ === 'undefined') return;
      try {
        const r = await fetch(`${import.meta.env.BASE_URL || '/'}version.json?t=${Date.now()}`, { cache: 'no-store' });
        const { build } = await r.json();
        if (build && build !== __BUILD_ID__) location.reload();
      } catch { /* offline — try again later */ }
    }, 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Without a kiosk launch the browser needs one click (or key) before it will go full screen.
  useEffect(() => {
    const go = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
    window.addEventListener('click', go);
    window.addEventListener('keydown', go);
    return () => { window.removeEventListener('click', go); window.removeEventListener('keydown', go); };
  }, []);

  if (!ready) return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;
  if (!session) return <Login onLogin={async () => setSession(await store.getSession())} />;
  if (!data) return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;

  return (
    <>
      <JackpotDisplay slides={data.slides} items={data.items} look={data.look} tv />
      {offline && (
        <div style={{ position: 'fixed', right: 12, bottom: 10, zIndex: 10000, width: 10, height: 10, borderRadius: '50%', background: '#c33', opacity: 0.7 }}
          title="Can't reach the server — showing the last amounts and retrying" />
      )}
    </>
  );
}
