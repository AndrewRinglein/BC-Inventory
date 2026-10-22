import React, { useEffect, useRef, useState } from 'react';
import { fmtJackpot } from '../lib/logic/progressive.js';
import './jackpot.css';

/**
 * The hall TV: one progressive at a time, full screen, rotating. Sized in container
 * units, so the same component renders as a small preview tile or the whole screen.
 *   items   [{ id, name, color, amount }]
 *   look    'inferno' | 'marquee' | 'gold' | 'led'
 */
export const LOOKS = [
  { id: 'inferno', name: 'Inferno', blurb: 'Roaring flames, molten numbers, flashing title.' },
  { id: 'marquee', name: 'Vegas Marquee', blurb: 'Chasing light bulbs, spinning sunburst, neon glow.' },
  { id: 'gold', name: 'Gold Rush', blurb: 'Raining coins, golden rays, shining metal numbers.' },
  { id: 'led', name: 'LED Board', blurb: 'Amber dot-matrix sign with a scrolling ticker.' },
];

export default function JackpotDisplay({ items, look = 'inferno', seconds = 10, preview = false, startAt = 0, onExit }) {
  const [i, setI] = useState(startAt % Math.max(items.length, 1));
  const n = items.length;
  useEffect(() => {
    if (n < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % n), Math.max(3, seconds) * 1000);
    return () => clearInterval(t);
  }, [n, seconds]);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);

  useEffect(() => {
    if (preview || !onExit) return undefined;
    const k = (e) => {
      if (e.key === 'Escape') onExit();
      if (e.key === 'ArrowRight' || e.key === ' ') setI((x) => (x + 1) % Math.max(n, 1));
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % Math.max(n, 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [preview, onExit, n]);

  const item = items[i] || { id: 'none', name: 'No progressives yet', color: '#ffc21a', amount: 0 };
  const props = { item, items, index: i, preview };
  return (
    <div className={`jp jp-${look}${preview ? ' jp-preview' : ''}`} style={{ '--c': item.color }}
      onDoubleClick={!preview ? onExit : undefined}>
      {look === 'inferno' && <Inferno {...props} />}
      {look === 'marquee' && <Marquee {...props} />}
      {look === 'gold' && <Gold {...props} />}
      {look === 'led' && <Led {...props} />}
      {n > 1 && (
        <div className="jp-dots">{items.map((x, k) => <span key={x.id} className={k === i ? 'on' : ''} style={{ '--dc': x.color }} />)}</div>
      )}
      {!preview && onExit && <button className="jp-exit" onClick={onExit}>Exit (Esc)</button>}
    </div>
  );
}

/** Count up to the amount each time a jackpot comes on screen, then follow it live. */
function useRollUp(amount, key) {
  const [v, setV] = useState(amount);
  const from = useRef(0);
  useEffect(() => { from.current = amount * 0.6; }, [key]);   // eslint-disable-line
  useEffect(() => {
    let raf; const start = performance.now(); const a = from.current; const dur = 1600;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setV(a + (amount - a) * e);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = amount;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [amount, key]);
  return v;
}

const Amount = ({ item, className }) => {
  const v = useRollUp(item.amount, item.id);
  const shown = fmtJackpot(Math.round(v * 100) / 100 === item.amount ? item.amount : Math.floor(v));
  return <div key={item.id} className={'jp-amt ' + (className || '')} data-text={shown}>{shown}</div>;
};

// ---------- particles ----------

/** Doom-style fire: a low-res heat field that rises and cools, scaled up. */
function FireCanvas({ height = 0.6 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; const ctx = cv.getContext('2d');
    const W = 96, H = 60; cv.width = W; cv.height = H;
    // black → deep red → orange → yellow → white-hot
    const pal = Array.from({ length: 40 }, (_, k) => {
      const t = k / 39;
      const r = Math.min(255, t * 3.2 * 255);
      const g = Math.min(255, Math.max(0, (t - 0.3) * 2.1 * 255));
      const bl = Math.min(255, Math.max(0, (t - 0.8) * 5 * 255));
      return [r | 0, g | 0, bl | 0];
    });
    const max = pal.length - 1;
    const f = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) f[(H - 1) * W + x] = max;
    const img = ctx.createImageData(W, H);
    let raf, last = 0;
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 40) return; last = t;
      for (let x = 0; x < W; x++) f[(H - 1) * W + x] = Math.random() < 0.92 ? max : max - 6;
      for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
        const src = y * W + x; const r = (Math.random() * 3.6) | 0;
        const dst = src - W - (r - 1);
        if (dst >= 0) f[dst] = Math.max(0, f[src] - (r & 1) - (Math.random() < 0.45 ? 1 : 0));
      }
      for (let p = 0; p < W * H; p++) {
        const c = pal[f[p]]; const o = p * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
        img.data[o + 3] = f[p] < 3 ? 0 : Math.min(255, f[p] * 18);
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="jp-fire" style={{ height: `${height * 100}%` }} />;
}

/** Embers, sparks and coins — one small particle engine. */
function Particles({ kind }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; const ctx = cv.getContext('2d');
    let W = 0, H = 0, raf;
    const fit = () => { W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1); H = cv.height = cv.clientHeight * (window.devicePixelRatio || 1); };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(cv);
    const count = kind === 'coins' ? 46 : 70;
    const make = (init) => ({
      x: Math.random() * W, y: init ? Math.random() * H : (kind === 'coins' ? -20 : H + 10),
      v: kind === 'coins' ? 1 + Math.random() * 2.5 : 0.6 + Math.random() * 2.2,
      s: kind === 'coins' ? 0.5 + Math.random() : 0.4 + Math.random() * 1.4,
      ph: Math.random() * 6.28, w: 0.02 + Math.random() * 0.06,
    });
    const ps = Array.from({ length: count }, () => make(true));
    const step = () => {
      raf = requestAnimationFrame(step);
      ctx.clearRect(0, 0, W, H);
      const u = H / 400;
      for (const p of ps) {
        p.ph += p.w;
        if (kind === 'coins') {
          p.y += p.v * u * 2; p.x += Math.sin(p.ph) * 0.4 * u;
          if (p.y > H + 30) Object.assign(p, make(false));
          const r = 9 * p.s * u; const sx = Math.abs(Math.cos(p.ph * 1.6));
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.max(sx, 0.12), 1);
          const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
          g.addColorStop(0, '#fff6c2'); g.addColorStop(0.45, '#ffcf3a'); g.addColorStop(1, '#a8650a');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.29); ctx.fill();
          ctx.strokeStyle = 'rgba(120,70,0,.7)'; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, 6.29); ctx.stroke();
          ctx.restore();
        } else {
          p.y -= p.v * u * 1.6; p.x += Math.sin(p.ph) * 0.8 * u;
          if (p.y < -10) Object.assign(p, make(false));
          const a = Math.max(0, Math.min(1, p.y / H)) * (0.6 + 0.4 * Math.sin(p.ph * 3));
          const r = (kind === 'sparks' ? 1.6 : 2.4) * p.s * u;
          ctx.fillStyle = kind === 'sparks' ? `rgba(255,255,255,${a})` : `rgba(255,${120 + (p.s * 60) | 0},40,${a})`;
          ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 8 * u;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.29); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [kind]);
  return <canvas ref={ref} className="jp-particles" />;
}

// ---------- looks ----------

function Inferno({ item }) {
  return (
    <>
      <div className="jp-glow" />
      <FireCanvas height={0.62} />
      <Particles kind="embers" />
      <div className="jp-stage" key={item.id}>
        <div className="jp-title">
          {'PROGRESSIVE JACKPOT'.split('').map((ch, k) => <span key={k} style={{ animationDelay: `${k * 0.06}s` }}>{ch === ' ' ? ' ' : ch}</span>)}
        </div>
        <div className="jp-name">{item.name}</div>
        <Amount item={item} />
        <div className="jp-sub">🔥 GROWING EVERY BOX 🔥</div>
      </div>
      <div className="jp-flash" key={'f' + item.id} />
    </>
  );
}

function Bulbs() {
  const top = 22, side = 12;
  const row = (n, cls) => <div className={'jp-bulbs ' + cls}>{Array.from({ length: n }, (_, k) => <i key={k} />)}</div>;
  return <>{row(top, 'top')}{row(top, 'bottom')}{row(side, 'left')}{row(side, 'right')}</>;
}

function Marquee({ item }) {
  return (
    <>
      <div className="jp-rays" />
      <div className="jp-vignette" />
      <Bulbs />
      <Particles kind="sparks" />
      <div className="jp-stage" key={item.id}>
        <div className="jp-title">★ JACKPOT ★</div>
        <div className="jp-name">{item.name}</div>
        <Amount item={item} />
        <div className="jp-sub">PROGRESSIVE · PLAY NOW</div>
      </div>
      <div className="jp-flash" key={'f' + item.id} />
    </>
  );
}

function Gold({ item }) {
  return (
    <>
      <div className="jp-rays" />
      <div className="jp-vignette" />
      <Particles kind="coins" />
      <div className="jp-stage" key={item.id}>
        <div className="jp-title">PROGRESSIVE JACKPOT</div>
        <div className="jp-name">{item.name}</div>
        <Amount item={item} />
        <div className="jp-sub">◆ IT COULD BE YOU ◆</div>
      </div>
      <div className="jp-flash" key={'f' + item.id} />
    </>
  );
}

function Led({ item, items }) {
  const ticker = items.map((x) => `${x.name.toUpperCase()} ${fmtJackpot(x.amount)}`).join('   ◆   ');
  return (
    <>
      <div className="jp-stage" key={item.id}>
        <div className="jp-title"><span className="blink">●</span> PROGRESSIVE NOW AT <span className="blink">●</span></div>
        <div className="jp-name">{item.name}</div>
        <Amount item={item} />
      </div>
      <div className="jp-ticker"><div><span>{ticker}</span><span>{ticker}</span></div></div>
      <div className="jp-dotmask" />
    </>
  );
}
