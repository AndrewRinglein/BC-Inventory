// Progressive jackpots. Each one is fed by one or more games: every box of a feeding
// game that sells out adds that game's per-box contribution. The running total is
// worked out from the boxes themselves, so nobody has to keep a tally by hand:
//
//   current = seed + adjust + per_box × (feeding boxes sold out since the last hit)
//
// Stored in settings under 'progressives' as a list of
//   { id, name, color, seed, per_box, game_ids, reset_at, adjust, hits: [{amount, at}] }

const COLOR_HEX = {
  red: '#ff2a2a', white: '#f4f4f4', blue: '#2a7bff', green: '#22d36a', gold: '#ffc21a',
  yellow: '#ffe11a', orange: '#ff8a1a', purple: '#a94bff', pink: '#ff4fb4', silver: '#c9d1d9',
  black: '#3a3a3a',
};
export const PALETTE = ['#ff2a2a', '#ffc21a', '#2a7bff', '#22d36a', '#a94bff', '#ff8a1a', '#ff4fb4', '#f4f4f4'];

/** "Red: 200, White: 100, Blue: 50" → [{label:'Red', amount:200}, …] */
export function parseSplit(note) {
  if (!note) return [];
  return String(note).split(/[,;]+/).map((part) => {
    const m = part.match(/^\s*([^:=]+?)\s*[:=]\s*\$?\s*([\d.]+)\s*$/);
    return m ? { label: m[1].trim(), amount: Number(m[2]) } : null;
  }).filter((x) => x && x.amount > 0);
}

export const colorFor = (label, i = 0) => COLOR_HEX[String(label || '').toLowerCase()] || PALETTE[i % PALETTE.length];

/** Starting list built from the catalog: one jackpot per colour of a split, else one per game. */
export function defaultProgressives(products) {
  const out = [];
  for (const p of products) {
    const per = Number(p.progressive_amount) || 0;
    if (!(per > 0) || p.active === false) continue;
    const split = parseSplit(p.progressive_note);
    if (split.length) {
      split.forEach((s, i) => out.push({
        id: `${p.id}-${s.label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
        name: `${p.name} ${s.label}`, color: colorFor(s.label, i),
        seed: 0, per_box: s.amount, game_ids: [p.id], reset_at: null, adjust: 0, hits: [],
      }));
    } else {
      out.push({
        id: p.id, name: p.name, color: colorFor('', out.length),
        seed: 0, per_box: per, game_ids: [p.id], reset_at: null, adjust: 0, hits: [],
      });
    }
  }
  return out;
}

/** Feeding boxes sold out since the last hit. */
export function feedingBoxes(prog, boxes) {
  const ids = new Set(prog.game_ids || []);
  const since = prog.reset_at ? Date.parse(prog.reset_at) : -Infinity;
  return boxes.filter((b) => ids.has(b.product_id) && b.state === 'sold_out'
    && (b.sold_out_at ? Date.parse(b.sold_out_at) > since : since === -Infinity));
}

export function currentAmount(prog, boxes) {
  const n = feedingBoxes(prog, boxes).length;
  const v = (Number(prog.seed) || 0) + (Number(prog.adjust) || 0) + (Number(prog.per_box) || 0) * n;
  return Math.round(v * 100) / 100;
}

/** Record a hit: keep the amount paid, start over from the seed. */
export function hit(prog, boxes, at = new Date().toISOString()) {
  const amount = currentAmount(prog, boxes);
  return { ...prog, reset_at: at, adjust: 0, hits: [{ amount, at }, ...(prog.hits || [])].slice(0, 50) };
}

export const fmtJackpot = (n) => '$' + Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2,
});
