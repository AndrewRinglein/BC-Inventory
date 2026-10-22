import React, { useEffect, useState, useCallback, useRef } from 'react';
import { store, IS_DEMO, IS_SANDBOX } from './lib/store/index.js';
import { roleFromUrl, roleLink, can as roleCan, ROLES, HALL_ID, HALL_NAME } from './lib/roles.js';
import { createScanCapture, beep } from './lib/logic/scan.js';
import { localYmd } from './lib/logic/bc.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './components/Dashboard.jsx';
import Purchase from './components/Purchase.jsx';
import Review from './components/Review.jsx';
import Receive from './components/Receive.jsx';
import Open from './components/Open.jsx';
import Reports from './components/Reports.jsx';
import Inventory from './components/Inventory.jsx';
import Orders from './components/Orders.jsx';
import Accounting from './components/Accounting.jsx';
import Games from './components/Games.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import History from './components/History.jsx';
import { PinModal } from './components/PinModal.jsx';

export const AppCtx = React.createContext(null);

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const role = roleFromUrl();                       // null -> role picker
  const hall = HALL_ID;                             // BC is one location
  const [screen, setScreen] = useState(() => (role === 'floor' ? 'open' : 'dashboard'));

  // data
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [allPos, setPos] = useState([]);
  // archived orders drop out of every working view — Open Orders' Archive tab reads allPos
  const pos = allPos.filter((p) => !p.archived_at);
  const [payments, setPayments] = useState([]);
  const [orderQty, setOrderQtyState] = useState({});
  const [boxCounts, setBoxCounts] = useState([]);
  const [settings, setSettings] = useState({});

  // ui
  const [toast, setToastState] = useState(null);
  const [flash, setFlash] = useState(null);
  const [receivingPo, setReceivingPo] = useState(null);  // po id picked on Receive (Open Orders can preselect)
  const [pinAsk, setPinAsk] = useState(null);            // {resolve}
  const scanHandlerRef = useRef(null);                   // the screen that owns the scanner registers here
  const pinOkRef = useRef(false);
  const toastTimer = useRef(null);
  const undoRef = useRef(null);

  const setToast = useCallback((msg, undo = null, ms = 3200) => {
    clearTimeout(toastTimer.current);
    undoRef.current = undo;
    setToastState(msg ? { msg, undo: !!undo } : null);
    if (msg) toastTimer.current = setTimeout(() => setToastState(null), undo ? 10000 : ms);
  }, []);

  const doUndo = useCallback(async () => {
    const u = undoRef.current;
    undoRef.current = null;
    setToastState(null);
    if (u) {
      try { await u(); } catch (e) { setToast('Undo failed: ' + e.message, null, 6000); }
    }
  }, [setToast]);

  const reloadHall = useCallback(async () => {
    const [bx, ps, pay, oq, bc] = await Promise.all([
      store.getBoxes(hall), store.getPos(hall), store.getPayments(hall), store.getOrderQty(hall),
      store.getBoxCounts(hall),
    ]);
    setBoxes(bx); setPos(ps); setPayments(pay); setOrderQtyState(oq); setBoxCounts(bc);
  }, [hall]);

  const reloadCatalog = useCallback(async () => {
    const [vs, prods] = await Promise.all([store.getVendors(), store.getProducts()]);
    setVendors(vs); setProducts(prods);
  }, []);

  const reloadSettings = useCallback(async () => {
    const keys = ['email', 'po_sequence', 'admin_pin', 'halls_config', 'eom', 'sender', 'po_email', 'report'];
    const entries = await Promise.all(keys.map(async (k) => [k, await store.getSetting(k)]));
    setSettings(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    (async () => {
      await store.init();
      setSession(await store.getSession());
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    reloadCatalog();
    reloadSettings();
    reloadHall();
  }, [session, reloadCatalog, reloadSettings, reloadHall]);

  // ---- is this tab running the current build? ----
  //
  // Asset filenames are content-hashed, so a browser holding a cached index.html
  // keeps asking for files a later deploy deleted. Poll the build id and say so
  // plainly instead of showing a screen that will not load.
  const [staleBuild, setStaleBuild] = useState(false);
  useEffect(() => {
    if (typeof __BUILD_ID__ === 'undefined') return;
    let stop = false;
    const check = async () => {
      try {
        const base = import.meta.env.BASE_URL || '/';
        const r = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!stop && build && build !== __BUILD_ID__) setStaleBuild(true);
      } catch { /* offline, or the file isn't there yet — say nothing */ }
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { stop = true; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  // ---- admin PIN gate ----
  const requirePin = useCallback(() => {
    if (pinOkRef.current) return Promise.resolve(true);
    return new Promise((resolve) => setPinAsk({ resolve }));
  }, []);
  // Checked against the stored value, read fresh at the moment of asking, so a PIN
  // change takes effect at once and a failed read refuses rather than guessing.
  const answerPin = useCallback(async (pin) => {
    if (pin === null) { pinAsk?.resolve(false); setPinAsk(null); return; }
    let want;
    try {
      want = (await store.getSetting('admin_pin'))?.pin;
    } catch {
      setToast('Could not check the PIN — check your connection and try again', null, 6000);
      pinAsk?.resolve(false); setPinAsk(null); return;
    }
    if (want == null || want === '') want = '1234';   // never configured
    const ok = String(pin).trim() === String(want).trim();
    if (ok) pinOkRef.current = true;
    pinAsk?.resolve(ok);
    setPinAsk(null);
    if (!ok) setToast('Wrong PIN');
  }, [pinAsk, setToast]);

  // ---- scanner ----
  //
  // One capture for the whole app. The screen that owns scanning (Receive or Open)
  // registers a handler; the handler does the work and returns { ok, message }, and
  // the beep, flash and toast happen here so every scan feels the same.
  const flashFor = useCallback((ok) => {
    beep(!!ok);
    setFlash(ok ? 'ok' : 'bad'); setTimeout(() => setFlash(null), 500);
  }, []);

  useEffect(() => {
    if (!session) return;
    const stop = createScanCapture(async (code) => {
      const h = scanHandlerRef.current;
      if (!h) {
        flashFor(false);
        setToast('Go to Receive or Open to scan boxes.');
        return;
      }
      try {
        const r = await h(code);
        if (!r) return;
        flashFor(r.ok);
        if (r.message) setToast(r.message, r.undo || null);
      } catch (err) {
        flashFor(false);
        setToast('Scan failed: ' + err.message, null, 6000);
      }
    });
    return stop;
  }, [session, setToast, flashFor]);

  const productName = (pid) => products.find((p) => p.id === pid)?.name || pid;

  if (!ready) return null;
  if (!session) return <Login onLogin={async () => setSession(await store.getSession())} />;
  if (!role) return <RolePicker />;

  const canDo = (action) => roleCan(role, action);

  const ctx = {
    store, IS_DEMO, IS_SANDBOX, hall, hallName: HALL_NAME, screen, setScreen,
    role, roleLabel: ROLES[role].label, can: canDo,
    vendors, products, boxes, pos, allPos, payments, orderQty, settings, boxCounts,
    reloadHall, reloadCatalog, reloadSettings,
    setToast, requirePin, flashFor, scanHandlerRef,
    receivingPo, setReceivingPo, productName, today: localYmd,
  };

  const SCREENS = {
    dashboard: Dashboard, purchase: Purchase, review: Review, receive: Receive, open: Open,
    reports: Reports, inventory: Inventory, orders: Orders, accounting: Accounting,
    games: Games, settings: SettingsScreen, history: History,
  };
  const Screen = SCREENS[screen] || Dashboard;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="layout">
        <Sidebar />
        <div className="main">
          {staleBuild && (
            <div className="demo-banner no-print" style={{ background: '#fdf3e7', borderColor: '#e2c39a', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>
                <b>A newer version of this app has been published.</b> This tab is still running an
                older one — some screens may fail to load until you reload.
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn primary sm" onClick={() => location.reload(true)}>Reload now</button>
            </div>
          )}
          {IS_SANDBOX ? (
            <div className="demo-banner no-print" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span><b>Test mode</b> — sandbox with fake data at every stage. Nothing here touches the real system.</span>
              <div style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={async () => { await store.resetDemo(); location.reload(); }}>Reset demo data</button>
            </div>
          ) : IS_DEMO ? (
            <div className="demo-banner no-print">
              Local mode — data lives only in this browser. Add your Supabase keys to <b>.env</b> to go live (see SETUP.md). Emails are logged, never sent.
            </div>
          ) : null}
          <Screen />
        </div>
      </div>
      {flash && <div className={`scan-flash ${flash}`} />}
      {toast && (
        <div className="toast no-print">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={doUndo}>Undo</button>}
        </div>
      )}
      {pinAsk && <PinModal onSubmit={answerPin} />}
    </AppCtx.Provider>
  );
}

/** Shown when the URL has no ?role= parameter — normally people arrive via their role link. */
function RolePicker() {
  return (
    <div className="login-wrap">
      <div className="login-box" style={{ width: 420, textAlign: 'left' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 30 }}>📦</div>
          <h1 style={{ fontSize: 18, margin: '6px 0 2px' }}>Who's signing in?</h1>
          <p className="dim" style={{ fontSize: 12.5 }}>
            Normally you'd open your personal role link — bookmark the one you pick.
          </p>
        </div>
        {Object.entries(ROLES).map(([id, r]) => (
          <a key={id} href={roleLink(id, IS_SANDBOX)} className="nav-item"
            style={{ display: 'flex', border: '1px solid var(--border)', marginBottom: 8, textDecoration: 'none' }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            <span className={'badge ' + r.badge}>{id}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
