// Edytor płytki skrawającej: kontur płytki (arkusz PL_kontur, kolumna G – ścieżka SVG w mm, y rośnie w dół) jako wielokąt do edycji.
// Czyste funkcje – testy: test/plate-edit.test.js. Punkty: { x, y } w mm.
import { parseInsertPath } from './toolGeometry.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const fmt = (v) => String(Object.is(r3(v), -0) ? 0 : r3(v));

/** Ścieżka SVG płytki → { pts (mm, odcinki), hasArcs – ścieżka miała łuki / krzywe (w edytorze są odcinkami) }. */
export function parsePlate(path) {
  const text = String(path ?? '').trim();
  let pts = parseInsertPath(text, { absY: false }).map((p) => ({ x: r3(p.x / 10), y: r3(p.y / 10) }));
  if (pts.length > 2 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-6 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-6) pts = pts.slice(0, -1);   // zamknięcie = pierwszy punkt
  return { pts, hasArcs: /[AQ]/i.test(text) };
}
/** Punkty → ścieżka SVG „M x y L … Z” (mm, 3 miejsca). Mniej niż 3 punkty – pusty tekst. */
export const plateToPath = (pts) => (pts && pts.length >= 3 ? pts.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ') + ' Z' : '');

export function plateBounds(pts) {
  if (!pts || !pts.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 0, h: 0, cx: 0, cy: 0 };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
const map = (pts, f) => pts.map((p) => { const q = f(p); return { x: r3(q.x), y: r3(q.y) }; });
/** Odbicie względem pionowej osi środka płytki (X) albo poziomej (Y). */
export const mirrorX = (pts) => { const b = plateBounds(pts); return map(pts, (p) => ({ x: 2 * b.cx - p.x, y: p.y })).reverse(); };   // odwrócona kolejność – zachowuje kierunek obiegu
export const mirrorY = (pts) => { const b = plateBounds(pts); return map(pts, (p) => ({ x: p.x, y: 2 * b.cy - p.y })).reverse(); };
/** Obrót wokół środka płytki o [deg]° (dodatni – zgodnie z ruchem wskazówek zegara na ekranie, bo y rośnie w dół). */
export function rotate(pts, deg) {
  const b = plateBounds(pts), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return map(pts, (p) => ({ x: b.cx + (p.x - b.cx) * c - (p.y - b.cy) * s, y: b.cy + (p.x - b.cx) * s + (p.y - b.cy) * c }));
}
/** Skalowanie wokół środka płytki o [percent] %. */
export const scale = (pts, percent) => { const b = plateBounds(pts), k = percent / 100; return map(pts, (p) => ({ x: b.cx + (p.x - b.cx) * k, y: b.cy + (p.y - b.cy) * k })); };
/** Przesunięcie tak, aby lewy górny róg obwiedni był w (0, 0). */
export const toOrigin = (pts) => { const b = plateBounds(pts); return map(pts, (p) => ({ x: p.x - b.minX, y: p.y - b.minY })); };
/** Wstawienie punktu w środku odcinka [i] → [i+1] (po punkcie i). */
export function insertAfter(pts, i) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
  return [...pts.slice(0, i + 1), { x: r3((a.x + b.x) / 2), y: r3((a.y + b.y) / 2) }, ...pts.slice(i + 1)];
}
/** Usunięcie punktu [i]; wielokąt musi mieć co najmniej 3 punkty – inaczej bez zmian. */
export const removeAt = (pts, i) => (pts.length > 3 && i >= 0 && i < pts.length ? pts.filter((_, k) => k !== i) : pts);
/** Zamiana punktów [i] i [i + d] (d = ±1) – zmiana kolejności; poza zakresem – bez zmian. */
export function moveIndex(pts, i, d) {
  const j = i + d;
  if (i < 0 || j < 0 || i >= pts.length || j >= pts.length) return pts;
  const out = pts.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
}
/** Przyciągnięcie wartości [v] do siatki [step] (mm); step ≤ 0 – bez przyciągania. */
export const snap = (v, step) => (step > 0 ? r3(Math.round(v / step) * step) : r3(v));
/** Pole wielokąta (mm²) ze znakiem – dodatnie przy obiegu przeciwnym do wskazówek zegara na ekranie (y w dół: ujemne = zgodnie). */
export function area(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
/** Czy odcinki wielokąta się przecinają (kontur samoprzecinający się nie nadaje się do bryły 3D). */
export function selfIntersects(pts) {
  const n = pts.length, cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const hit = (p1, p2, p3, p4) => { const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4); return d1 * d2 < -1e-9 && d3 * d4 < -1e-9; };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (hit(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true; }
  return false;
}
/** Wielokąt płytki do podglądu 3D (0,1 mm, oś Y w górę): środek płytki w x = 0, y odwrócone względem rysunku SVG. */
export function previewPoly(pts) { const b = plateBounds(pts); return pts.map((p) => ({ x: r3((p.x - b.cx) * 10) || 0, y: r3((b.minY - p.y) * 10) || 0 })); }
