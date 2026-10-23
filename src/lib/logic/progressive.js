// Progressive jackpots. A progressive is fed by one or more games: every box of a
// feeding game that sells out adds money to it. Most progressives are one pot; some
// (Freedom Flash) have several parts that grow and pay separately — red, white, blue.
//
//   part amount = seed + adjust + Σ (per-box amount) over feeding boxes sold out since that part last hit
//
// The per-box amount is the part's own figure, or — when the part leaves it blank — each
// feeding game's "Amount to progressive" from the catalog (so $599 Flashboard and Wildball
// Flashboard can each add their own amount to the same pot).
//
// Stored in settings under 'progressives':
//   [{ id, name, color, game_ids, parts: [{ id, label, color, per_box|null, seed, adjust, reset_at, hits: [{amount, at, together}] }] }]

const COLOR_HEX = {
  red: '#ff2a2a', white: '#f4f4f4', blue: '#2a7bff', green: '#22d36a', gold: '#ffc21a',
  yellow: '#ffe11a', orange: '#ff8a1a', purple: '#a94bff', pink: '#ff4fb4', silver: '#c9d1d9',
};
export const PALETTE = ['#ff2a2a', '#ffc21a', '#2a7bff', '#22d36a', '#a94bff', '#ff8a1a', '#ff4fb4', '#f4f4f4'];
export const colorFor = (label, i = 0) => COLOR_HEX[String(label || '').toLowerCase()] || PALETTE[i % PALETTE.length];

/** "Red: 200, White: 100, Blue: 50" → [{label:'Red', amount:200}, …] */
export function parseSplit(note) {
  if (!note) return [];
  return String(note).split(/[,;]+/).map((part) => {
    const m = part.match(/^\s*([^:=]+?)\s*[:=]\s*\$?\s*([\d.]+)\s*$/);
    return m ? { label: m[1].trim(), amount: Number(m[2]) } : null;
  }).filter((x) => x && x.amount > 0);
}

const part = (o) => ({ id: 'main', label: '', color: null, per_box: null, seed: 0, adjust: 0, reset_at: null, hits: [], ...o });

/** BC's progressives, as the hall runs them. Used until someone saves their own list. */
export const BC_PROGRESSIVES = [
  { id: 'flashboard', name: 'Flashboard Progressive', color: '#ffc21a', game_ids: ['G010', 'G032', 'G034', 'G035'], parts: [part({})] },
  { id: 'derby', name: 'Jackpot Derby Progressive', color: '#22d36a', game_ids: ['G012'], parts: [part({})] },
  {
    id: 'freedom', name: 'Freedom Flash Progressive', color: '#f4f4f4', game_ids: ['G033'], parts: [
      part({ id: 'red', label: 'Red', color: '#ff2a2a', per_box: 200 }),
      part({ id: 'white', label: 'White', color: '#f4f4f4', per_box: 100 }),
      part({ id: 'blue', label: 'Blue', color: '#2a7bff', per_box: 50 }),
    ],
  },
];

/** Starting list: BC's three when their games are in the catalog, otherwise one per game that pays in. */
export function defaultProgressives(products) {
  const ids = new Set(products.map((p) => p.id));
  const known = BC_PROGRESSIVES.filter((p) => p.game_ids.some((g) => ids.has(g)))
    .map((p) => ({ ...p, game_ids: p.game_ids.filter((g) => ids.has(g)) }));
  if (known.length) return known;
  return products.filter((p) => Number(p.progressive_amount) > 0 && p.active !== false).map((p, i) => {
    const split = parseSplit(p.progressive_note);
    return {
      id: p.id, name: p.name, color: colorFor('', i), game_ids: [p.id],
      parts: split.length
        ? split.map((s, k) => part({ id: s.label.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'p' + k, label: s.label, color: colorFor(s.label, k), per_box: s.amount }))
        : [part({})],
    };
  });
}

/** Accept the older one-pot shape ({per_box, seed, adjust, reset_at, hits} on the progressive). */
export function normalize(prog) {
  if (Array.isArray(prog.parts) && prog.parts.length) return { ...prog, parts: prog.parts.map(part) };
  const { per_box, seed, adjust, reset_at, hits, ...rest } = prog;
  return { ...rest, game_ids: prog.game_ids || [], parts: [part({ per_box: per_box ?? null, seed, adjust, reset_at, hits })] };
}

const perBoxFor = (pt, gameId, products) =>
  (pt.per_box != null && pt.per_box !== '' ? Number(pt.per_box) : Number(products.find((g) => g.id === gameId)?.progressive_amount) || 0);

/** Feeding boxes sold out since this part last hit. */
export function feedingBoxes(prog, pt, boxes) {
  const ids = new Set(prog.game_ids || []);
  const since = pt.reset_at ? Date.parse(pt.reset_at) : -Infinity;
  return boxes.filter((b) => ids.has(b.product_id) && b.state === 'sold_out'
    && (b.sold_out_at ? Date.parse(b.sold_out_at) > since : since === -Infinity));
}

export function partAmount(prog, pt, boxes, products) {
  const grown = feedingBoxes(prog, pt, boxes).reduce((s, b) => s + perBoxFor(pt, b.product_id, products), 0);
  return Math.round(((Number(pt.seed) || 0) + (Number(pt.adjust) || 0) + grown) * 100) / 100;
}

export function progAmount(prog, boxes, products) {
  return Math.round(prog.parts.reduce((s, pt) => s + partAmount(prog, pt, boxes, products), 0) * 100) / 100;
}

/** What the TV shows for one progressive. */
export function displayItem(prog, boxes, products) {
  const parts = prog.parts.map((pt, i) => ({
    id: pt.id, label: pt.label, color: pt.color || colorFor(pt.label, i), amount: partAmount(prog, pt, boxes, products),
  }));
  return { id: prog.id, name: prog.name, color: prog.color, parts, amount: parts.reduce((s, x) => s + x.amount, 0) };
}

/** Record a hit on some parts (all of them when the red-white-blue ticket hits): pay them, start them over. */
export function hit(prog, partIds, boxes, products, at = new Date().toISOString()) {
  const together = partIds.length > 1;
  return {
    ...prog,
    parts: prog.parts.map((pt) => (partIds.includes(pt.id)
      ? { ...pt, reset_at: at, adjust: 0, hits: [{ amount: partAmount(prog, pt, boxes, products), at, together }, ...(pt.hits || [])].slice(0, 50) }
      : pt)),
  };
}

export const fmtJackpot = (n) => '$' + Number(n || 0).toLocaleString('en-US', {
  minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2,
});
