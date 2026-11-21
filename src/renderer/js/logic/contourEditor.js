// Edytor konturów narzędzi: użytkownik wpisuje połowę konturu (od osi na zewnątrz), program tworzy cały kontur (odbicie lustrzane)
// z zaokrągleniami i zapisuje go jako ścieżkę SVG w milimetrach (kolumna V arkusza ND_CACHE; Kontury.gs).
// Układ: x = promień (±, mm), y = Z – pozycja wzdłuż osi narzędzia (mm), jak w kolumnie T (tam jednostki 0,1 mm).
// Czyste funkcje – testy: test/contour-editor.test.js.
import { parseInsertPath, parseContour } from './toolGeometry.js';
import { fullContour, TREPAN, nutFor, NUT_UNDERCUT, NUT_FILLET } from './contourGen.js';

const n = (v) => { const x = Number(String(v ?? '').trim().replace(',', '.')); return String(v ?? '').trim() === '' ? NaN : x; };
const fmt = (v) => { const r = Math.round(v * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };

/**
 * Połowa konturu (obrys zewnętrzny) z dowolnego konturu w 0,1 mm – także z liniami pomocniczymi wewnątrz (krawędzie skrawające itp.):
 * dla każdego poziomu Z największa odległość od osi; uskoki (dwa promienie na tym samym Z) zachowane. Wynik: wiersze {z, r, rad} w mm.
 */
export function halfFromContour(points) {
  const P = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (P.length < 2) return [];
  const segs = [];
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if (a.x !== b.x || a.y !== b.y) segs.push([a, b]); }
  const zs = [...new Set(P.map((p) => p.y))].sort((a, b) => a - b);
  const at = (s, z) => { const [a, b] = s; return Math.abs(a.x + ((b.x - a.x) * (z - a.y)) / (b.y - a.y)); };
  const env = (z, side) => { // side −1: tuż poniżej z, +1: tuż powyżej
    let r = -1;
    for (const s of segs) {
      const lo = Math.min(s[0].y, s[1].y), hi = Math.max(s[0].y, s[1].y);
      if (lo === hi) continue;
      if (side < 0 ? lo < z && z <= hi : lo <= z && z < hi) r = Math.max(r, at(s, side < 0 ? Math.min(z, hi) : Math.max(z, lo)));
    }
    return r;
  };
  const out = [];
  const push = (z, r) => { if (r < 0) return; const row = { z: fmt(z / 10), r: fmt(r / 10), rad: '' }; const l = out[out.length - 1]; if (!l || l.z !== row.z || l.r !== row.r) out.push(row); };
  zs.forEach((z, i) => {
    const below = i > 0 ? env(z, -1) : -1, above = i < zs.length - 1 ? env(z, 1) : -1;
    let flat = -1;
    for (const s of segs) if (s[0].y === z && s[1].y === z) flat = Math.max(flat, Math.abs(s[0].x), Math.abs(s[1].x));
    const lvl = P.filter((p) => p.y === z).reduce((m, p) => Math.max(m, Math.abs(p.x)), -1);
    if (i === 0) { push(z, Math.max(above, 0)); return; }
    if (i === zs.length - 1) { push(z, below); if (Math.max(flat, lvl) > below + 1e-9) push(z, Math.max(flat, lvl)); return; }
    push(z, below);
    const top = Math.max(flat, lvl);
    if (top > Math.max(below, above) + 1e-9) push(z, top);
    push(z, above);
  });
  // punkty pośrednie na prostej (ten sam promień albo ten sam Z co sąsiedzi) są zbędne
  const between = (v, a, b) => (v - a) * (v - b) <= 0;
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1], b = out[i + 1];
    if (p.r === a.r && p.r === b.r) return !between(+p.z, +a.z, +b.z);
    if (p.z === a.z && p.z === b.z) return !between(+p.r, +a.r, +b.r);
    return true;
  });
}
/** Połowa z zapisanej ścieżki SVG (kolumna V): punkty z x ≥ 0 (łuki rozbite na odcinki). */
export const halfFromSvg = (path) => halfFromContour(svgToContour(path));

/** Ścieżka SVG (mm) → punkty konturu w 0,1 mm jak kolumna T (bez wartości bezwzględnej Y – Z może być ujemne). */
export const svgToContour = (path) => parseInsertPath(path, { absY: false });
/** Kontur narzędzia z kolumny V (SVG) albo T (x_y). */
export const anyContour = (text) => (/^\s*M/i.test(String(text ?? '')) ? expandHalf(svgToContour(text)) : parseContour(text));

/** Czy kontur (0,1 mm) to sama prawa połowa (wszystkie x ≥ 0) – tak zapisujemy nowe kontury (V, BC). */
export const isHalf = (points) => (points || []).length >= 2 && Math.min(...points.map((p) => p.x)) >= -0.5;
/** Połowa → cały kontur: prawa połowa, potem lewa jako odbicie w odwrotnej kolejności (punkty na osi bez powtórzeń). Pełny kontur – bez zmian. */
export function expandHalf(points) {
  const P = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!isHalf(P)) return P;
  const right = P.map((p) => ({ x: Math.max(0, p.x), y: p.y }));
  // lewa strona – odbicie całej ścieżki w odwrotnej kolejności (także linie krawędzi wewnątrz obrysu)
  const all = [...right, ...[...right].reverse().map((p) => ({ x: p.x > 1e-6 ? -p.x : 0, y: p.y }))];
  const out = all.filter((p, i) => !i || Math.abs(p.x - all[i - 1].x) > 1e-6 || Math.abs(p.y - all[i - 1].y) > 1e-6);
  while (out.length > 2 && Math.abs(out[0].x - out[out.length - 1].x) < 1e-6 && Math.abs(out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
  return out;
}
/**
 * Prawa połowa pełnego konturu (0,1 mm) z zachowaniem przebiegu ścieżki: obrys zewnętrzny i linie krawędzi elementów
 * (np. nakrętka ER, krawędzie skrawające) po stronie x ≥ 0; w miejscach przejścia przez oś – punkt na osi.
 * Ścieżka zaczyna się i kończy na osi (pominięta lewa strona = odcinek wzdłuż osi przy zamknięciu „Z”).
 */
export function halfPath(points) {
  const P = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (P.length < 2) return [];
  if (isHalf(P)) return P.map((p) => ({ x: Math.max(0, p.x), y: p.y }));
  const out = [], n = P.length, eq = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  const push = (p) => { const q = { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }; if (!out.length || !eq(out[out.length - 1], q)) out.push(q); };
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    if (a.x >= 0) push(a);
    if ((a.x >= 0) !== (b.x >= 0) && a.x !== 0 && b.x !== 0) { const t = a.x / (a.x - b.x); push({ x: 0, y: a.y + t * (b.y - a.y) }); }
  }
  if (out.length > 1 && eq(out[0], out[out.length - 1])) out.pop();
  // początek w punkcie wejścia na prawą stronę: odcinek oś → oś przed nim to pominięta lewa strona (zamknięcie ścieżki)
  let k = out.findIndex((p, i) => p.x === 0 && out[(i - 1 + out.length) % out.length].x === 0 && out[(i + 1) % out.length].x > 0);
  if (k < 0) k = out.findIndex((p) => p.x === 0);
  return k > 0 ? [...out.slice(k), ...out.slice(0, k)] : out;
}
/**
 * Zaokrągla pierwszy wklęsły róg obrysu (prawa połowa, od dołu): płaszczyzna idąca do osi, potem korpus pionowo w górę – jak górna płaszczyzna
 * kołnierza i korpus oprawki. Promień [r] w 0,1 mm, łuk jako odcinki (co ~11°); róg o krótszych bokach niż [r] – bez zmian.
 */
export function filletFirstStep(pts, r) {
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    if (a.y === b.y && b.x < a.x && b.x === c.x && c.y > b.y) {   // pozioma do osi, potem pionowo w górę
      if (a.x - b.x < r - 1e-6 || c.y - b.y < r - 1e-6) return pts;
      const cx = b.x + r, cy = b.y + r, arc = [];
      for (let k = 0; k <= 8; k++) { const th = (3 * Math.PI) / 2 - ((Math.PI / 2) * k) / 8; arc.push({ x: Math.round((cx + r * Math.cos(th)) * 1000) / 1000, y: Math.round((cy + r * Math.sin(th)) * 1000) / 1000 }); }
      return [...pts.slice(0, i), ...arc, ...pts.slice(i + 1)];
    }
  }
  return pts;
}
/**
 * Dokłada nakrętkę ER (kolumna N oprawki) na czubku prawej połowy konturu [half] (0,1 mm): górne [L] mm zastępuje zewnętrzny kształt nakrętki
 * (walec z fazą i stożkiem czoła z plików STEP / IGES) z podcięciem pod nią (szyjka + stożek do korpusu). Przy braku nakrętki albo zbyt krótkim korpusie – bez zmian.
 */
export function withNut(half, N) {
  const nut = nutFor(N), P = half || [];
  if (!nut || P.length < 3) return P;
  const rows = halfFromContour(expandHalf(P)).map((r) => ({ x: Number(r.r) * 10, y: Number(r.z) * 10 }));
  if (rows.length < 2) return P;
  const top = Math.max(...rows.map((r) => r.y)), bottom = Math.min(...rows.map((r) => r.y)), cut = top - nut.L * 10;
  if (cut <= bottom + 10) return P;
  // promień korpusu na wysokości y (obrys: największy promień, w skokach – ten niżej)
  const radiusAt = (y) => { const a = [...rows].reverse().find((r) => r.y <= y + 1e-6), b = rows.find((r) => r.y >= y - 1e-6); return a && b && b.y > a.y ? a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y) : (a ? a.x : 0); };
  // podcięcie pod nakrętką (jak w oprawce CAT50 ER32): walec szyjki, niżej stożek do korpusu – proporcjonalnie do promienia nakrętki
  const u = NUT_UNDERCUT, neckR = u.neckR * nut.R * 10, neckLen = u.neckLen * nut.R * 10, body = radiusAt(cut - 1e-3);
  const coneLen = body > neckR + 1 ? (body - neckR) / u.tan : 0, y0 = cut - neckLen - coneLen;
  const under = coneLen > 0 && y0 > bottom + 10;
  const keep = rows.filter((r) => r.y < (under ? y0 : cut) - 1e-6);
  const out = [{ x: 0, y: bottom }, ...keep];
  if (under) out.push({ x: radiusAt(y0), y: y0 }, { x: neckR, y: cut - neckLen }, { x: neckR, y: cut });
  else out.push({ x: Math.max(body, 0), y: cut });
  for (const [r, t] of nut.prof) out.push({ x: Math.round(r * 100) / 10, y: Math.round((cut + t * 10) * 1000) / 1000 });
  out.push({ x: 0, y: top });
  const clean = out.filter((q, i, a) => !i || Math.abs(q.x - a[i - 1].x) > 1e-6 || Math.abs(q.y - a[i - 1].y) > 1e-6);
  return filletFirstStep(clean, NUT_FILLET * 10);   // R1 przy kołnierzu
}
/**
 * Linie krawędzi średnic w połowie konturu (0,1 mm): na każdym uskoku i załamaniu obrysu (> 15°) linia przez całą szerokość – w połowie odcinek
 * od obrysu do osi i z powrotem. Linie już narysowane nie są powtarzane. Robi to samo co [addEdgeLines] na ścieżce SVG.
 */
export function withEdgeLines(half) {
  const pts = half || [];
  if (pts.length < 3 || !isHalf(pts)) return pts;
  const near = (a, b) => Math.abs(a - b) < 0.02;
  const has = (lv) => pts.some((p, i) => { const q = pts[(i + 1) % pts.length]; return near(p.y, lv.z) && near(q.y, lv.z) && (near(p.x, 0) || near(q.x, 0)) && Math.max(p.x, q.x) >= lv.r - 0.02; });
  const todo = edgeLevels(pts).filter((lv) => !has(lv));
  if (!todo.length) return pts;
  const out = [];
  for (const p of pts) {
    out.push(p);
    const k = todo.findIndex((lv) => near(lv.z, p.y) && near(lv.r, p.x));
    if (k >= 0) { out.push({ x: 0, y: p.y }, { x: p.x, y: p.y }); todo.splice(k, 1); }
  }
  return out;
}
/**
 * Wewnętrzny generator – sama prawa połowa konturu (0,1 mm, od osi do osi, z liniami krawędzi): korpus z PSWT D:N
 * dorysowany do mocowania z karty „kontury” (kształt i położenie w osi Z jak w karcie). [] – brak danych.
 */
export function generatedHalf(p, mounts) {
  const g = p ? parseContour(fullContour(p, mounts || {}) || '') : [];
  if (g.length < 3 || Math.max(...g.map((q) => q.x)) <= Math.min(...g.map((q) => q.x))) return [];
  const h = halfPath(g);
  if (h.length < 3) return [];
  if (isTrepan(p)) return h;
  const n = p && String(p.D || '').trim().toLowerCase() === 'opr' ? withNut(h, p.N) : h;   // oprawka z nakrętką ER na końcu (kolumna N)
  return withEdgeLines(n);   // linie krawędzi średnic wszędzie (wiertło rurowe ma własne linie w sylwecie)
}
/** Prawa połowa (z liniami krawędzi) pełnego konturu jako ścieżka SVG w mm – zapis do BC / V. */
export const halfPathSvg = (points) => contourToSvg(halfPath(points));
/** Prawa połowa konturu z wierszy (mm) jako zamknięta ścieżka SVG: od osi, punkty z zaokrągleniami, z powrotem do osi. */
export function halfSvg(rows) {
  const right = rows.filter((r) => Number.isFinite(n(r.z)) && Number.isFinite(n(r.r)))
    .map((r) => ({ x: Math.abs(n(r.r)), y: n(r.z), rad: Math.max(0, n(r.rad) || 0) }));
  if (right.length < 2) return '';
  const pts = [...(right[0].x > 0 ? [{ x: 0, y: right[0].y, rad: 0 }] : []), ...right, ...(right[right.length - 1].x > 0 ? [{ x: 0, y: right[right.length - 1].y, rad: 0 }] : [])];
  return pathWithFillets(pts);
}
/** Zatwierdzone kontury z PSWT (BH potwierdzone, BC – SVG w mm, zwykle połowa) → Map kod → kontur jak kolumna T (x_y w 0,1 mm, cały). */
export function confirmedOverrides(params) {
  const m = new Map();
  for (const [k, o] of Object.entries(params || {})) {
    if (!o || !String(o.BH || '').trim() || !String(o.BC || '').trim()) continue;
    const pts = expandHalf(svgToContour(o.BC));
    if (pts.length >= 3) m.set(String(k).trim().toLowerCase(), pts.map((p) => `${fmt(p.x)}_${fmt(p.y)}`).join(';'));
  }
  // rejony ostrze / oprawka (BE) zatwierdzonych narzędzi – kolor części roboczej w 3D
  m.regions = new Map();
  for (const [k, o] of Object.entries(params || {})) if (o && String(o.BH || '').trim() && String(o.BE || '').trim()) m.regions.set(String(k).trim().toLowerCase(), parseRegionsText(o.BE));
  return m;
}

/**
 * Kontury zastępujące kolumnę T w całym programie: zatwierdzone (PSWT BC) zawsze; przy [gen] (Ustawienia → Narzędziownia:
 * wewnętrzny generator) dla pozostałych narzędzi – roboczy z kolumny V, a bez niego kontur z generatora (PSWT D:N + zakładka „kontury”).
 * Narzędzia monolityczne bez rejonów – część robocza wg długości roboczej (K). Wynik: Map kod → kontur x_y; .regions, .generated (Set).
 */
export function contourOverrides(params, mounts, { gen = false, v = {} } = {}) {
  const m = confirmedOverrides(params);
  m.generated = new Set();
  m.blade = new Map();   // długość ostrza (mm) narzędzi monolitycznych – podział na ostrze / oprawkę także bez zatwierdzonego konturu
  const key = (k) => String(k).trim().toLowerCase();
  const str = (pts) => pts.map((p) => `${fmt(p.x)}_${fmt(p.y)}`).join(';');
  for (const [k0, o] of Object.entries(params || {})) {
    const k = key(k0);
    let pts = null;
    if (gen && !m.has(k)) {
      const vs = String((v || {})[k0] || (v || {})[k] || '').trim();
      if (vs) pts = expandHalf(svgToContour(vs));
      if (!pts || pts.length < 3) { const hh = generatedHalf(o, mounts); pts = hh.length >= 3 ? expandHalf(hh) : null; }
      if (pts && pts.length >= 3) { m.set(k, str(pts)); m.generated.add(k); }
    }
    if (isMonolithic(o) && bladeLength(o) > 0) m.blade.set(k, bladeLength(o));
    if (!m.regions.has(k) && isMonolithic(o) && bladeLength(o) > 0) {   // część robocza (kolor w 3D): trepan – węglik 7 mm, inne wg L roboczej
      const src = m.has(k) ? parseContour(m.get(k)) : null;
      const s = src && src.length >= 3 ? workSplit(halfPathSvg(src), bladeLength(o)) : null;
      if (s) m.regions.set(k, s.regions);
    }
  }
  return m;
}

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
export const toSvg = (rows) => pathWithFillets(fullPoints(rows));
/** Zamknięta ścieżka SVG (mm) przez punkty {x, y, rad} – w punktach z rad > 0 łuk styczny do obu odcinków. */
function pathWithFillets(pts) {
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

/**
 * Pełny kontur (punkty w 0,1 mm, np. z kolumny T albo z danych D:N) → ścieżka SVG w mm bez żadnych zmian: ta sama kolejność punktów,
 * także celowe linie przechodzące z X+ na X- (rzut boczny: nakrętka ER, krawędzie skrawające, czubek wiertła).
 */
export function contourToSvg(points) {
  const P = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (P.length < 2) return '';
  return P.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p.x / 10)} ${fmt(p.y / 10)}`).join(' ') + ' Z';
}

/**
 * Poziomy krawędzi części obrotowej (0,1 mm) z połowy konturu: na każdym załamaniu obrysu (uskok, przejście stożek → walec;
 * kąt > 15°, więc nie na łagodnych łukach) w widoku z boku widać krawędź – linię przez całą szerokość. Bez czoła i podstawy.
 * Wynik: [{ z, r }] – r: mniejszy promień na tym poziomie (od osi do r brakuje linii).
 */
export function edgeLevels(halfPts) {
  const rows = halfFromContour(expandHalf(halfPts)).map((q) => ({ r: Number(q.r) * 10, z: Number(q.z) * 10 }));
  if (rows.length < 3) return [];
  const zMin = Math.min(...rows.map((q) => q.z)), zMax = Math.max(...rows.map((q) => q.z)), same = (a, b) => Math.abs(a - b) < 1e-6;
  const out = [];
  const add = (z, r) => { if (r > 1e-6 && !same(z, zMin) && !same(z, zMax) && !out.some((o) => same(o.z, z))) out.push({ z, r }); };
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i - 1], p = rows[i], b = rows[i + 1];
    const atZ = rows.filter((q) => same(q.z, p.z));
    if (atZ.length > 1) { add(p.z, Math.min(...atZ.map((q) => q.r))); continue; }   // uskok
    const ux = p.r - a.r, uy = p.z - a.z, vx = b.r - p.r, vy = b.z - p.z, lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const ang = (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))) * 180) / Math.PI;
    if (ang > 15) add(p.z, p.r);
  }
  return out;
}
/**
 * Dopisanie do ścieżki połowy konturu (SVG, mm) brakujących linii krawędzi części obrotowej: w punkcie (r, z) odcinek do osi i z powrotem
 * („L 0 z L r z”; po odbiciu – linia przez całą szerokość). Łuki zostają; linie już narysowane nie są powtarzane.
 */
export function addEdgeLines(svg) {
  const path = String(svg || '').trim();
  const pts = svgToContour(path);
  if (pts.length < 3 || !isHalf(pts)) return path;
  const near = (a, b) => Math.abs(a - b) < 0.02;   // 0,002 mm w jednostkach 0,1 mm
  const has = (lv) => pts.some((p, i) => { const q = pts[(i + 1) % pts.length]; return near(p.y, lv.z) && near(q.y, lv.z) && (near(p.x, 0) || near(q.x, 0)) && Math.max(p.x, q.x) >= lv.r - 0.02; });
  const todo = edgeLevels(pts).filter((lv) => !has(lv));
  if (!todo.length) return path;
  const cmds = path.match(/[MLAQZ][^MLAQZ]*/gi) || [];
  const out = [];
  for (const c of cmds) {
    out.push(c.trim());
    const nums = (c.slice(1).match(/-?\d+(?:[.,]\d+)?(?:e-?\d+)?/gi) || []).map((x) => Number(x.replace(',', '.')));
    if (nums.length < 2) continue;
    const x = nums[nums.length - 2] * 10, y = nums[nums.length - 1] * 10;
    const k = todo.findIndex((lv) => near(lv.z, y) && near(lv.r, x));
    if (k >= 0) { out.push(`L 0 ${fmt(y / 10)} L ${fmt(x / 10)} ${fmt(y / 10)}`); todo.splice(k, 1); }
  }
  return out.join(' ');
}

// ---------- narzędzia monolityczne: część robocza wg długości roboczej (PSWT, kolumna K) ----------
/** Narzędzia z jednej części (frez / wiertło węglikowe i HSS, wiertło rurowe trepanacyjne) – ostrze i chwyt to jeden kontur. */
export function isMonolithic(p) {
  const d = String((p && p.D) || '').trim().toLowerCase(), e = String((p && p.E) || '').trim().toLowerCase();
  return d === 'tre' || ((d === 'wie' || d === 'fre') && (e === 'hss' || e === 'węg'));
}
/** Wiertło rurowe (trepan) – korpus jako kielich, ostrze to węglik na czubku. */
export const isTrepan = (p) => String((p && p.D) || '').trim().toLowerCase() === 'tre';
/** Długość ostrza od czubka (mm) do podziału ostrze / oprawka: trepan – węglik (7 mm), inne monolityczne – długość robocza K. */
export const bladeLength = (p) => (isTrepan(p) ? TREPAN.bladeLen : workLength(p));
/** Długość robocza (mm) z kolumny K albo 0. */
export const workLength = (p) => { const k = Number(String((p && p.K) || '').trim().replace(',', '.')); return Number.isFinite(k) && k > 0 ? k : 0; };
/**
 * Podział istniejącego konturu (połowa SVG, mm) wg długości roboczej: ostrze od czubka (największe Z) na długości [k],
 * reszta – oprawka (chwyt). Wynik: { z (mm) – granica, regions: [{role, z1, z2}] } albo null.
 */
export function workSplit(svg, k) {
  const pts = expandHalf(svgToContour(svg));
  if (pts.length < 3 || !(k > 0)) return null;
  const ys = pts.map((p) => p.y / 10), zMin = Math.min(...ys), zMax = Math.max(...ys), z = Math.round((zMax - k) * 1000) / 1000;
  if (!(z > zMin && z < zMax)) return null;
  return { z, regions: [{ role: 'oprawka', z1: Math.round(zMin * 1000) / 1000, z2: z }, { role: 'ostrze', z1: z, z2: Math.round(zMax * 1000) / 1000 }] };
}
/**
 * Linia przez całą szerokość na wysokości [z] (mm) w połowie konturu (SVG): punkt na obrysie (przecięcie odcinka) i odcinek do osi.
 * Gdy taka linia już jest – bez zmian. Łuki zostają (linia wstawiana tylko na odcinkach prostych).
 */
export function addLineAt(svg, z) {
  const path = String(svg || '').trim(), Z = z * 10;
  const pts = svgToContour(path);
  if (pts.length < 3 || !isHalf(pts)) return path;
  const near = (a, b) => Math.abs(a - b) < 0.02;
  if (pts.some((p, i) => { const q = pts[(i + 1) % pts.length]; return near(p.y, Z) && near(q.y, Z) && (near(p.x, 0) || near(q.x, 0)) && Math.max(p.x, q.x) > 0.02; })) return path;
  const cmds = (path.match(/[MLAQZ][^MLAQZ]*/gi) || []).map((c) => c.trim());
  const end = (c) => { const nums = (c.slice(1).match(/-?\d+(?:[.,]\d+)?(?:e-?\d+)?/gi) || []).map((x) => Number(x.replace(',', '.'))); return nums.length >= 2 ? { x: nums[nums.length - 2] * 10, y: nums[nums.length - 1] * 10 } : null; };
  // kandydaci: punkt obrysu dokładnie na Z albo przecięcie odcinka prostego; wybierany najdalszy od osi (obrys zewnętrzny)
  let best = null, prev = null, start = null;
  cmds.forEach((c, i) => {
    const cmd = c[0].toUpperCase(), e = cmd === 'Z' ? start : end(c);
    if (cmd === 'M') start = e;
    if (e && near(e.y, Z) && e.x > 0.02 && cmd !== 'Z' && (!best || e.x > best.x)) best = { i, x: e.x, at: true };
    if (cmd === 'L' && prev && e && (prev.y - Z) * (e.y - Z) < 0) {
      const x = prev.x + ((Z - prev.y) * (e.x - prev.x)) / (e.y - prev.y);
      if (x > 0.02 && (!best || x > best.x)) best = { i, x, at: false };
    }
    if (e) prev = e;
  });
  if (!best) return path;
  const X = fmt(best.x / 10), Zs = fmt(z), spur = `L 0 ${Zs} L ${X} ${Zs}`;
  if (best.at) cmds.splice(best.i + 1, 0, spur);
  else cmds.splice(best.i, 0, `L ${X} ${Zs} ${spur}`);
  return cmds.join(' ');
}

/** Rejony z tekstu kolumny BE: „ostrze 0–45; oprawka 45–60” → [{ role, z1, z2 }] (mm). */
export function parseRegionsText(text) {
  return String(text || '').split(';').map((x) => /^(ostrze|oprawka)\s+(-?[\d.,]+)\s*[–-]\s*(-?[\d.,]+)$/i.exec(x.trim())).filter(Boolean)
    .map((m) => ({ role: m[1].toLowerCase(), z1: Number(m[2].replace(',', '.')), z2: Number(m[3].replace(',', '.')) }));
}
