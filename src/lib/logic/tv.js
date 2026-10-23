// The hall TV rotation: an ordered list of screens, each shown for its own number of
// seconds. Stored in settings under 'tv_playlist':
//   [{ id, type, seconds, enabled, ...type fields }]
//     type 'progressive'  prog_id                 one progressive
//     type 'all'                                   every progressive on one screen
//     type 'message'      text, color             a message board
//     type 'art'          url, path, name, fit    an uploaded picture ('fit' whole picture, 'fill' crop to screen)
import { displayItem } from './progressive.js';

export const DEFAULT_SECONDS = 6;
export const MESSAGE_COLORS = ['#ffc21a', '#ffffff', '#ff2a2a', '#2a7bff', '#22d36a', '#ff4fb4', '#a94bff', '#ff8a1a'];

/** The starting rotation: each progressive for 6 seconds, then all of them together for 6. */
export function defaultPlaylist(progressives) {
  return [
    ...progressives.map((p) => ({ id: 'prog-' + p.id, type: 'progressive', prog_id: p.id, seconds: DEFAULT_SECONDS, enabled: true })),
    { id: 'all', type: 'all', seconds: DEFAULT_SECONDS, enabled: true },
  ];
}

export const playlistOf = (saved, progressives) => (Array.isArray(saved) ? saved : defaultPlaylist(progressives));

/** Progressive screens missing from the rotation (removed, or added since) — offered back in "+ Add". */
export function missingScreens(playlist, progressives) {
  const have = new Set(playlist.filter((s) => s.type === 'progressive').map((s) => s.prog_id));
  const out = progressives.filter((p) => !have.has(p.id))
    .map((p) => ({ id: 'prog-' + p.id, type: 'progressive', prog_id: p.id, seconds: DEFAULT_SECONDS, enabled: true, label: p.name }));
  if (!playlist.some((s) => s.type === 'all')) out.push({ id: 'all', type: 'all', seconds: DEFAULT_SECONDS, enabled: true, label: 'All progressives together' });
  return out;
}

export function screenLabel(s, progressives) {
  if (s.type === 'progressive') return progressives.find((p) => p.id === s.prog_id)?.name || 'Removed progressive';
  if (s.type === 'all') return 'All progressives together';
  if (s.type === 'message') return `Message: “${String(s.text || '').replace(/\s+/g, ' ').slice(0, 60)}”`;
  if (s.type === 'art') return `Art: ${s.name || 'picture'}`;
  return s.type;
}

/** What the TV actually plays: enabled screens, with live amounts filled in. */
export function buildSlides(playlist, progressives, boxes, products) {
  const items = progressives.map((p) => displayItem(p, boxes, products));
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));
  const slides = [];
  for (const s of playlist) {
    if (s.enabled === false) continue;
    const seconds = Math.max(2, Number(s.seconds) || DEFAULT_SECONDS);
    if (s.type === 'progressive' && byId[s.prog_id]) slides.push({ key: s.id, type: 'progressive', seconds, item: byId[s.prog_id] });
    else if (s.type === 'all' && items.length) slides.push({ key: s.id, type: 'all', seconds, items });
    else if (s.type === 'message' && String(s.text || '').trim()) slides.push({ key: s.id, type: 'message', seconds, text: s.text, color: s.color || MESSAGE_COLORS[0] });
    else if (s.type === 'art' && s.url) slides.push({ key: s.id, type: 'art', seconds, url: s.url, fit: s.fit || 'fit' });
  }
  return { slides, items };
}

export const cycleSeconds = (playlist) => playlist.filter((s) => s.enabled !== false)
  .reduce((t, s) => t + Math.max(2, Number(s.seconds) || DEFAULT_SECONDS), 0);

/**
 * Shrink a picture for the TV before it is stored: at most 1920 px wide / 1080 high.
 * Animated GIFs are kept as they are (re-drawing one would freeze it).
 */
export async function prepareArt(file, { maxW = 1920, maxH = 1080, quality = 0.88 } = {}) {
  if (/gif$/i.test(file.type)) return { blob: file, ext: 'gif', type: file.type };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/webp', quality));
    if (blob) return { blob, ext: 'webp', type: 'image/webp', w, h };
    const jpg = await new Promise((res) => cv.toBlob(res, 'image/jpeg', quality));
    return { blob: jpg, ext: 'jpg', type: 'image/jpeg', w, h };
  } finally { URL.revokeObjectURL(url); }
}
