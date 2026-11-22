// Edytor płytki skrawającej: kontur płytki (arkusz PL_kontur, kolumna G – ścieżka SVG w mm, y rośnie w dół) jako wielokąt do edycji z ŁUKAMI.
// Punkt: { x, y, arc? } – arc: { r (mm), sweep (0 | 1), large (0 | 1) } oznacza, że odcinek od tego punktu do następnego jest łukiem koła (SVG „A r r 0 large sweep x y”),
// a nie prostą; zapis do SVG zachowuje łuki (nie rozbija ich na krótkie odcinki). Czyste funkcje – testy: test/plate-edit.test.js. Punkty: { x, y } w mm.
import { arcPoints } from './toolGeometry.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const fmt = (v) => String(Object.is(r3(v), -0) ? 0 : r3(v));
const clone = (p) => (p.arc ? { x: p.x, y: p.y, arc: { ...p.arc } } : { x: p.x, y: p.y });

/**
 * Ścieżka SVG płytki → { pts (z łukami), hasArcs – są łuki, lossy – coś nie dało się zachować (łuk eliptyczny / obrócony, krzywa Q → odcinki) }.
 * Łuk „A r r 0 large sweep x y” zostaje łukiem przypisanym do punktu początkowego odcinka.
 */
export function parsePlate(path) {
  const tokens = String(path ?? '').trim().replace(/,/g, ' ').match(/[MLAQZ]|-?\d+(?:\.\d+)?/gi) || [];
  const pts = [], isNum = (t) => t != null && Number.isFinite(Number(t));
  let i = 0, cmd = '', lossy = false;
  const read = () => { const t = tokens[i++]; return isNum(t) ? Number(t) : NaN; };
  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === 'M' || cmd === 'L') { const x = read(), y = read(); if (!Number.isNaN(x) && !Number.isNaN(y)) pts.push({ x: r3(x), y: r3(y) }); }
    else if (cmd === 'A') {
      const rx = read(), ry = read(), rot = read(), large = read(), sweep = read(), x = read(), y = read();
      if (pts.length && ![rx, ry, x, y].some(Number.isNaN)) {
        const prev = pts[pts.length - 1], chord = Math.hypot(x - prev.x, y - prev.y);
        if (Math.abs(rx - ry) > 1e-6 || (Number.isFinite(rot) && rot !== 0)) lossy = true;   // łuk eliptyczny / obrócony – przybliżony kołem
        if (chord > 1e-9) prev.arc = { r: r3(Math.max((Math.abs(rx) + Math.abs(ry)) / 2, chord / 2)), sweep: sweep ? 1 : 0, large: large ? 1 : 0 };
        pts.push({ x: r3(x), y: r3(y) });
      }
    } else if (cmd === 'Q') {
      const cx = read(), cy = read(), x = read(), y = read();
      if (pts.length && ![cx, cy, x, y].some(Number.isNaN)) {
        lossy = true; const p0 = pts[pts.length - 1];
        for (let s = 1; s <= 12; s++) { const t = s / 12, u = 1 - t; pts.push({ x: r3(u * u * p0.x + 2 * u * t * cx + t * t * x), y: r3(u * u * p0.y + 2 * u * t * cy + t * t * y) }); }
      }
    } else if (cmd === 'Z') break;
    else i++;
  }
  if (pts.length > 2 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-6 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-6) pts.pop();   // zamknięcie = pierwszy punkt
  return { pts, hasArcs: pts.some((p) => p.arc), lossy };
}
/** Punkty → ścieżka SVG „M x y L … A r r 0 large sweep x y … Z” (mm, 3 miejsca); odcinek z łukiem zapisuje się jako A. Mniej niż 3 punkty – pusty tekst. */
export function plateToPath(pts) {
  if (!pts || pts.length < 3) return '';
  const n = pts.length, seg = (i) => { const a = pts[i], b = pts[(i + 1) % n]; return a.arc && a.arc.r > 0 ? `A ${fmt(a.arc.r)} ${fmt(a.arc.r)} 0 ${a.arc.large ? 1 : 0} ${a.arc.sweep ? 1 : 0} ${fmt(b.x)} ${fmt(b.y)}` : `L ${fmt(b.x)} ${fmt(b.y)}`; };
  const parts = [`M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`];
  for (let i = 0; i < n - 1; i++) parts.push(seg(i));
  if (pts[n - 1].arc && pts[n - 1].arc.r > 0) parts.push(seg(n - 1));   // łuk zamykający – do pierwszego punktu
  return parts.join(' ') + ' Z';
}

// ---------- łuki ----------
/** Punkty pośrednie łuku odcinka a → b (bez końców; [steps] odcinków); odcinek bez łuku – []. */
export function arcInterior(a, b, steps = 24) {
  if (!a.arc || !(a.arc.r > 0)) return [];
  return arcPoints(a.x, a.y, a.arc.r, a.arc.r, 0, a.arc.large ? 1 : 0, a.arc.sweep ? 1 : 0, b.x, b.y, steps).slice(0, -1).map((p) => ({ x: p.x, y: p.y }));
}
/** Środek łuku odcinka a → b (punkt na łuku w połowie); odcinek bez łuku – środek odcinka. */
export function arcMid(a, b) {
  const q = arcInterior(a, b, 24);
  return q.length ? { x: r3(q[11].x), y: r3(q[11].y) } : { x: r3((a.x + b.x) / 2), y: r3((a.y + b.y) / 2) };
}
/** Wielokąt z łuków rozbity na odcinki (do obwiedni, pola, przecięć i podglądu 3D): punkty konturu + pośrednie punkty łuków. */
export function flatten(pts, steps = 24) {
  const out = [], n = (pts || []).length;
  pts.forEach((p, i) => { out.push({ x: p.x, y: p.y }); if (p.arc) out.push(...arcInterior(p, pts[(i + 1) % n], steps)); });
  return out;
}
/**
 * Łuk dla odcinka a → b przeciągniętego do punktu [q]: strzałka (odległość q od cięciwy) wyznacza promień; łuk wybrzusza się w stronę q
 * (mały, gdy strzałka ≤ połowy cięciwy, inaczej duży). Prawie prosta (strzałka < [tol] mm) – null (odcinek).
 */
export function arcThrough(a, b, q, tol = 0.01) {
  const dx = b.x - a.x, dy = b.y - a.y, c = Math.hypot(dx, dy);
  if (c < 1e-9) return null;
  const nlx = dy / c, nly = -dx / c, s = (q.x - (a.x + b.x) / 2) * nlx + (q.y - (a.y + b.y) / 2) * nly, h = Math.abs(s);   // lewa strona kierunku a → b (y w dół)
  if (h < tol) return null;
  const left = s > 0, large = h > c / 2 ? 1 : 0;
  return { r: r3((c * c / 4 + h * h) / (2 * h)), sweep: (left ? 1 : 0) ^ large, large };
}

export function plateBounds(pts) {
  const f = flatten(pts);
  if (!f.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 0, h: 0, cx: 0, cy: 0 };
  const xs = f.map((p) => p.x), ys = f.map((p) => p.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
/** Przekształcenie punktów funkcją [f] (łuki zostają; [kr] – skala promieni łuków). */
const map = (pts, f, kr = 1) => pts.map((p) => { const q = f(p), o = { x: r3(q.x), y: r3(q.y) }; if (p.arc) o.arc = { ...p.arc, r: r3(p.arc.r * kr) }; return o; });
/** Odwrócenie kolejności punktów z zachowaniem łuków: łuk odcinka i → i+1 po odwróceniu należy do punktu i+1 (kierunek odwrócony – w połączeniu z odbiciem znak zwrotu bez zmian). */
const reversed = (pts) => { const n = pts.length; return pts.slice().reverse().map((p, j) => { const src = pts[(n - 2 - j + n) % n], o = { x: p.x, y: p.y }; if (src.arc) o.arc = { ...src.arc }; return o; }); };
/** Odbicie względem pionowej osi środka płytki (X) albo poziomej (Y); łuki zostają łukami. */
export const mirrorX = (pts) => { const b = plateBounds(pts); return reversed(map(pts, (p) => ({ x: 2 * b.cx - p.x, y: p.y }))); };   // odwrócona kolejność – zachowuje kierunek obiegu
export const mirrorY = (pts) => { const b = plateBounds(pts); return reversed(map(pts, (p) => ({ x: p.x, y: 2 * b.cy - p.y }))); };
/** Obrót wokół środka płytki o [deg]° (dodatni – zgodnie z ruchem wskazówek zegara na ekranie, bo y rośnie w dół). */
export function rotate(pts, deg) {
  const b = plateBounds(pts), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return map(pts, (p) => ({ x: b.cx + (p.x - b.cx) * c - (p.y - b.cy) * s, y: b.cy + (p.x - b.cx) * s + (p.y - b.cy) * c }));
}
/** Skalowanie wokół środka płytki o [percent] % (promienie łuków też). */
export const scale = (pts, percent) => { const b = plateBounds(pts), k = percent / 100; return map(pts, (p) => ({ x: b.cx + (p.x - b.cx) * k, y: b.cy + (p.y - b.cy) * k }), k); };
/** Przesunięcie tak, aby lewy górny róg obwiedni był w (0, 0). */
export const toOrigin = (pts) => { const b = plateBounds(pts); return map(pts, (p) => ({ x: p.x - b.minX, y: p.y - b.minY })); };
/** Wstawienie punktu po punkcie [i]: w środku odcinka, a na łuku – w środku łuku (obie części zostają łukami o tym samym promieniu). */
export function insertAfter(pts, i) {
  const a = pts[i], b = pts[(i + 1) % pts.length], m = a.arc ? arcMid(a, b) : { x: r3((a.x + b.x) / 2), y: r3((a.y + b.y) / 2) };
  const out = pts.map(clone), half = a.arc ? { ...a.arc, large: 0 } : null;
  if (half) out[i].arc = { ...half };
  out.splice(i + 1, 0, half ? { x: m.x, y: m.y, arc: { ...half } } : m);
  return out;
}
/** Usunięcie punktu [i]; wielokąt musi mieć co najmniej 3 punkty – inaczej bez zmian. Poprzedni odcinek staje się prostą do następnego punktu. */
export function removeAt(pts, i) {
  if (!(pts.length > 3 && i >= 0 && i < pts.length)) return pts;
  const out = pts.map(clone), prev = (i - 1 + pts.length) % pts.length;
  delete out[prev].arc;
  return out.filter((_, k) => k !== i);
}
/** Zamiana punktów [i] i [i + d] (d = ±1) – zmiana kolejności; poza zakresem – bez zmian. */
export function moveIndex(pts, i, d) {
  const j = i + d;
  if (i < 0 || j < 0 || i >= pts.length || j >= pts.length) return pts;
  const out = pts.slice(); [out[i], out[j]] = [out[j], out[i]]; return out;
}
/** Przyciągnięcie wartości [v] do siatki [step] (mm); step ≤ 0 – bez przyciągania. */
export const snap = (v, step) => (step > 0 ? r3(Math.round(v / step) * step) : r3(v));
/** Pole wielokąta (mm²) ze znakiem – dodatnie przy obiegu przeciwnym do wskazówek zegara na ekranie (y w dół: ujemne = zgodnie). */
export function area(pts) { const f = flatten(pts); let s = 0; for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
/** Czy odcinki wielokąta (łuki jako odcinki) się przecinają (kontur samoprzecinający się nie nadaje się do bryły 3D). */
export function selfIntersects(pts0) {
  const pts = flatten(pts0), n = pts.length, cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const hit = (p1, p2, p3, p4) => { const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4); return d1 * d2 < -1e-9 && d3 * d4 < -1e-9; };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (hit(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true; }
  return false;
}
/** Wielokąt płytki do podglądu 3D (0,1 mm, oś Y w górę): środek płytki w x = 0, y odwrócone względem rysunku SVG; łuki rozbite na odcinki. */
export function previewPoly(pts) { const b = plateBounds(pts); return flatten(pts).map((p) => ({ x: r3((p.x - b.cx) * 10) || 0, y: r3((b.minY - p.y) * 10) || 0 })); }

// ---------- punkt bazowy płytki: punkt odniesienia do liczenia położenia (współrzędne, obrót korekty, ● na rysunku) ----------
/** Środek ciężkości wielokąta (średnia wierzchołków). */
const meanPt = (pts) => ({ x: r3(pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1)), y: r3(pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1)) });
/** Propozycje punktu bazowego dla płytki o punktach [pts] (mm, y w dół): [{ id, label, pt }] – środki i narożniki obwiedni, środek ciężkości, każdy punkt konturu. */
export function basePresets(pts) {
  const b = plateBounds(pts), out = [['c', 'środek obwiedni', b.cx, b.cy], ['tl', 'lewy górny róg obwiedni', b.minX, b.minY], ['tc', 'górny środek obwiedni', b.cx, b.minY], ['tr', 'prawy górny róg obwiedni', b.maxX, b.minY],
    ['lc', 'lewy środek obwiedni', b.minX, b.cy], ['rc', 'prawy środek obwiedni', b.maxX, b.cy], ['bl', 'lewy dolny róg obwiedni', b.minX, b.maxY], ['bc', 'dolny środek obwiedni', b.cx, b.maxY], ['br', 'prawy dolny róg obwiedni', b.maxX, b.maxY]];
  const m = meanPt(pts || []);
  out.push(['m', 'środek ciężkości (średnia punktów)', m.x, m.y]);
  (pts || []).forEach((p, i) => out.push(['p' + i, `punkt ${i + 1} konturu`, p.x, p.y]));
  return out.map(([id, label, x, y]) => ({ id, label, pt: { x: r3(x), y: r3(y) } }));
}
/** Punkt bazowy po przekształceniu konturu: [op] – mirrorX | mirrorY | rotate (arg °) | scale (arg %) | origin; [pts] – kontur PRZED przekształceniem. Bez punktu bazowego – null. */
export function mapBase(op, base, pts, arg = 0) {
  if (!base) return null;
  const b = plateBounds(pts);
  if (op === 'mirrorX') return { x: r3(2 * b.cx - base.x), y: base.y };
  if (op === 'mirrorY') return { x: base.x, y: r3(2 * b.cy - base.y) };
  if (op === 'rotate') { const a = (arg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return { x: r3(b.cx + (base.x - b.cx) * c - (base.y - b.cy) * s), y: r3(b.cy + (base.x - b.cx) * s + (base.y - b.cy) * c) }; }
  if (op === 'scale') { const k = arg / 100; return { x: r3(b.cx + (base.x - b.cx) * k), y: r3(b.cy + (base.y - b.cy) * k) }; }
  if (op === 'origin') return { x: r3(base.x - b.minX), y: r3(base.y - b.minY) };
  return base;
}
/** Krawędź skrawająca płytki: { a: { x, y }, b: { x, y } } (mm, współrzędne konturu płytki) albo null; punkty identyczne albo nieliczbowe – null. */
export function normEdge(e) {
  const a = e && normBase(e.a), b = e && normBase(e.b);
  return a && b && (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) ? { a, b } : null;
}
/** Krawędź po przekształceniu konturu (jak [mapBase] dla obu końców). */
export const mapEdge = (op, edge, pts, arg = 0) => (edge ? { a: mapBase(op, edge.a, pts, arg), b: mapBase(op, edge.b, pts, arg) } : null);
/** Punkt bazowy zapisany jako { x, y } (mm) albo null; wartości nieliczbowe – null. */
export const normBase = (b) => (b && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y)) && b.x !== '' && b.y !== '' ? { x: r3(Number(b.x)), y: r3(Number(b.y)) } : null);
