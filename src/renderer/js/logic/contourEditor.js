// Edytor konturów narzędzi: użytkownik wpisuje połowę konturu (od osi na zewnątrz), program tworzy cały kontur (odbicie lustrzane)
// z zaokrągleniami i zapisuje go jako ścieżkę SVG w milimetrach (kolumna V arkusza ND_CACHE; Kontury.gs).
// Układ: x = promień (±, mm), y = Z – pozycja wzdłuż osi narzędzia (mm), jak w kolumnie T (tam jednostki 0,1 mm).
// Czyste funkcje – testy: test/contour-editor.test.js.
import { parseInsertPath, parseContour } from './toolGeometry.js';

const n = (v) => { const x = Number(String(v ?? '').trim().replace(',', '.')); return String(v ?? '').trim() === '' ? NaN : x; };
const fmt = (v) => { const r = Math.round(v * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };

/** Połowa konturu z dawnej kolumny T (punkty w 0,1 mm): prawa strona (x ≥ 0) w kolejności zapisu, bez powtórzeń → wiersze {z, r, rad} w mm. */
export function halfFromContour(points) {
  const out = [];
  for (const p of points || []) {
    if (p.x < 0) continue;
    const row = { z: fmt(p.y / 10), r: fmt(p.x / 10), rad: '' };
    const last = out[out.length - 1];
    if (!last || last.z !== row.z || last.r !== row.r) out.push(row);
  }
  return out;
}
/** Połowa z zapisanej ścieżki SVG (kolumna V): punkty z x ≥ 0 (łuki rozbite na odcinki). */
export const halfFromSvg = (path) => halfFromContour(svgToContour(path));

/** Ścieżka SVG (mm) → punkty konturu w 0,1 mm jak kolumna T (bez wartości bezwzględnej Y – Z może być ujemne). */
export const svgToContour = (path) => parseInsertPath(path, { absY: false });
/** Kontur narzędzia z kolumny V (SVG) albo T (x_y). */
export const anyContour = (text) => (/^\s*M/i.test(String(text ?? '')) ? svgToContour(text) : parseContour(text));

/** Sprawdzenie wierszy: liczby, promień ≥ 0, zaokrąglenie ≥ 0, co najmniej 2 punkty. Wynik: lista komunikatów (pusta = dobrze). */
export function validate(rows) {
  const errs = [];
  const ok = rows.filter((r) => String(r.z ?? '').trim() !== '' || String(r.r ?? '').trim() !== '');
  if (ok.length < 2) errs.push('Wpisz co najmniej 2 punkty (Z i R).');
  ok.forEach((r, i) => {
    const z = n(r.z), rr = n(r.r), rad = String(r.rad ?? '').trim() === '' ? 0 : n(r.rad);
    if (!Number.isFinite(z)) errs.push(`Punkt ${i + 1}: Z nie jest liczbą.`);
    if (!Number.isFinite(rr) || rr < 0) errs.push(`Punkt ${i + 1}: R musi być liczbą ≥ 0.`);
    if (!Number.isFinite(rad) || rad < 0) errs.push(`Punkt ${i + 1}: zaokrąglenie musi być liczbą ≥ 0.`);
  });
  return errs;
}

/** Cały kontur (mm): prawa połowa w kolejności wpisania, potem lewa – odbicie w odwrotnej kolejności (punkty na osi bez powtórzeń). */
export function fullPoints(rows) {
  const right = rows.filter((r) => Number.isFinite(n(r.z)) && Number.isFinite(n(r.r)))
    .map((r) => ({ x: Math.abs(n(r.r)), y: n(r.z), rad: Math.max(0, n(r.rad) || 0) }));
  const left = [...right].reverse().filter((p) => p.x > 0).map((p) => ({ ...p, x: -p.x }));
  return [...right, ...left];
}

/** Ścieżka SVG (mm) pełnego konturu z zaokrągleniami w punktach (łuk stycznie do obu odcinków). */
export function toSvg(rows) {
  const pts = fullPoints(rows);
  if (pts.length < 2) return '';
  const N = pts.length, parts = [];
  for (let i = 0; i < N; i++) {
    const p = pts[i], a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    let corner = null;
    if (p.rad > 0 && N >= 3) {
      const ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y;
      const la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
      if (la > 1e-9 && lb > 1e-9) {
        const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (la * lb))), phi = Math.acos(cos);
        if (phi > 1e-6 && phi < Math.PI - 1e-6) {
          let rad = p.rad, d = rad / Math.tan(phi / 2);
          const maxD = Math.min(la, lb) / 2;
          if (d > maxD) { d = maxD; rad = d * Math.tan(phi / 2); }
          const t1 = { x: p.x + (ux / la) * d, y: p.y + (uy / la) * d }, t2 = { x: p.x + (vx / lb) * d, y: p.y + (vy / lb) * d };
          const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
          corner = { t1, t2, rad, sweep: cross > 0 ? 1 : 0 };
        }
      }
    }
    if (corner) {
      parts.push(`${i === 0 ? 'M' : 'L'} ${fmt(corner.t1.x)} ${fmt(corner.t1.y)}`, `A ${fmt(corner.rad)} ${fmt(corner.rad)} 0 0 ${corner.sweep} ${fmt(corner.t2.x)} ${fmt(corner.t2.y)}`);
    } else parts.push(`${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`);
  }
  return parts.join(' ') + ' Z';
}

/** Wymiary z wierszy: największa średnica i długość (rozpiętość Z) w mm. */
export function dims(rows) {
  const pts = fullPoints(rows);
  if (!pts.length) return { diameter: 0, length: 0 };
  const ys = pts.map((p) => p.y);
  return { diameter: 2 * Math.max(...pts.map((p) => Math.abs(p.x))), length: Math.max(...ys) - Math.min(...ys) };
}
