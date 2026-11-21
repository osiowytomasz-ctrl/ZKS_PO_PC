// Geometria narzędzi Narzędziowni – port 1:1 z aplikacji na Androida (ui/tools: ToolGeometry.kt, ToolsLogic.kt, ToolExport.kt, Lathe3D.kt).
// Kontur trzonu (ND_CACHE kolumna T, w API `columnAY`) to pary `x_y` rozdzielone `;` w jednostkach 0,1 mm; kontury płytek (PL_kontur, kolumna G)
// to ścieżki SVG w mm, przeliczane ×10. Czyste funkcje – testy: test/tool-geometry.test.js.
import { normCode } from './tooltrack.js';
import { halfFromContour, halfPath, withEdgeLines, expandHalf } from './contourEditor.js';
import { TREPAN, trepanPlates, trepanDrawing, tapHole, socketProfile, nutFor, colletSlits, freL2, freD, freKeyDepth } from './contourGen.js';
import { resolvePlates, normPlates } from './plateLayout.js';
import { naturalCompare } from './common.js';

export const pt = (x, y) => ({ x, y });

/** Jak JS `parseFloat(String(x).replace(',', '.')) || 0` (prefiks liczbowy, przecinek dziesiętny). */
export function num(text) {
  const m = /^\s*[-+]?\d+(?:\.\d+)?/.exec(String(text ?? '').replace(',', '.'));
  return m ? Number(m[0]) : 0;
}

export function parseContour(text) {
  const out = [];
  for (const pair of String(text ?? '').split(';')) {
    const p = pair.split('_');
    if (p.length < 2) continue;
    const xs = p[0].trim(), ys = p[1].trim();
    if (!xs || !ys) continue;
    // arkusz zapisuje ułamki z przecinkiem dziesiętnym (65,8_450; także „-102,”)
    const x = Number(xs.replace(',', '.')), y = Number(ys.replace(',', '.'));
    if (Number.isFinite(x) && Number.isFinite(y)) out.push(pt(x, y));
  }
  return out;
}

/** Granice konturu; r = największe Y, m = odległość najniższego punktu poniżej zera. */
export function bounds(points) {
  if (!points || !points.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { minX, maxX, minY, maxY, r: maxY, m: Math.abs(minY) };
}

/** Płytka: ścieżka SVG → punkty w jednostkach konturu (×10, Y jako wartość bezwzględna). Łuki (A) i krzywe (Q) rozbite na odcinki. */
export function parseInsertPath(path, { absY = true } = {}) {
  const tokens = String(path ?? '').replace(/,/g, ' ').match(/[MLAQZ]|-?\d+(?:\.\d+)?/gi) || [];
  const points = [];
  let i = 0, cmd = '', cur = null;
  const isNum = (t) => t != null && Number.isFinite(Number(t));
  const read = () => { const t = tokens[i++]; return isNum(t) ? Number(t) : NaN; };
  const push = (x, y) => { if (!Number.isNaN(x) && !Number.isNaN(y)) points.push(pt(x * 10, y * 10)); };
  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === 'M' || cmd === 'L') {
      const x = read(), y = read();
      if (!Number.isNaN(x) && !Number.isNaN(y)) { push(x, y); cur = pt(x, y); }
    } else if (cmd === 'A') {
      const rx = read(), ry = read(), rot = read(), large = read(), sweep = read(), x = read(), y = read();
      if (cur && ![rx, ry, x, y].some(Number.isNaN)) { for (const q of arcPoints(cur.x, cur.y, rx, ry, rot, large, sweep, x, y, 18)) push(q.x, q.y); cur = pt(x, y); }
    } else if (cmd === 'Q') {
      const cx = read(), cy = read(), x = read(), y = read();
      if (cur && ![cx, cy, x, y].some(Number.isNaN)) {
        for (let s = 1; s <= 12; s++) { const t = s / 12, u = 1 - t; push(u * u * cur.x + 2 * u * t * cx + t * t * x, u * u * cur.y + 2 * u * t * cy + t * t * y); }
        cur = pt(x, y);
      }
    } else if (cmd === 'Z') break;
    else i++;
  }
  // płytki: Y dodatnie w górę – kontur odwrócony jako całość, gdy leży głównie pod osią (dawniej |y| dla każdego punktu
  // odbijało pojedyncze łuki narożników przekraczające Y = 0 i promień „wywracał się” w drugą stronę)
  if (absY && points.length) {
    const ys = points.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
    if (Math.abs(lo) > Math.abs(hi)) for (const p of points) p.y = -p.y;
  }
  return points;
}

/** Łuk SVG rozbity na [steps] odcinków (co najmniej 8); punkt początkowy nie jest zwracany. */
export function arcPoints(x1, y1, rxIn, ryIn, angleDeg, largeArc, sweep, x2, y2, steps) {
  const angle = (angleDeg * Math.PI) / 180, cosA = Math.cos(angle), sinA = Math.sin(angle);
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [pt(x2, y2)];
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosA * dx + sinA * dy, y1p = -sinA * dx + cosA * dy;
  let rxSq = rx * rx, rySq = ry * ry;
  const lambda = (x1p * x1p) / rxSq + (y1p * y1p) / rySq;
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; rxSq = rx * rx; rySq = ry * ry; }
  const sign = largeArc === sweep ? -1 : 1;
  const coef = sign * Math.sqrt(Math.max(0, (rxSq * rySq - rxSq * y1p * y1p - rySq * x1p * x1p) / (rxSq * y1p * y1p + rySq * x1p * x1p)));
  const cxp = coef * ((rx * y1p) / ry), cyp = coef * (-(ry * x1p) / rx);
  const cx = cosA * cxp - sinA * cyp + (x1 + x2) / 2, cy = sinA * cxp + cosA * cyp + (y1 + y2) / 2;
  const vAng = (ux, uy, vx, vy) => {
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const start = vAng(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vAng((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweep !== 0 && delta < 0) delta += 2 * Math.PI;
  const n = Math.max(8, steps), out = [];
  for (let k = 0; k < n; k++) {
    const t = start + delta * ((k + 1) / n);
    out.push(pt(cx + rx * Math.cos(t) * cosA - ry * Math.sin(t) * sinA, cy + rx * Math.cos(t) * sinA + ry * Math.sin(t) * cosA));
  }
  return out;
}

export function rotateAround(p, pivot, angleDeg) {
  const a = (angleDeg * Math.PI) / 180, dx = p.x - pivot.x, dy = p.y - pivot.y;
  return pt(pivot.x + dx * Math.cos(a) - dy * Math.sin(a), pivot.y + dx * Math.sin(a) + dy * Math.cos(a));
}

// ---------- zestaw narzędzi jeden pod drugim (widok 2D) ----------

/** Frez z mocowaniem FRExxx (nasadzany na trzpień, grupa „fre”). */
export const isFreFit = (t) => String((t && t.columnD) ?? '').trim().toLowerCase() === 'fre' && freL2(t && t.columnM) > 0;
/** Długość do ustalenia płytek: J, a dla frezów z mocowaniem FRExxx J − L2 (kontur cofnięty o wysokość trzpienia mocującego). */
export const plateLength = (t) => num(t && t.columnJ) - (isFreFit(t) ? freL2(t.columnM) : 0);
/** Promień obrysu (0,1 mm) konturu na wysokości [y]; 0 – poza konturem. */
function radiusAtY(contour, y) {
  let r = 0;
  const rows = halfFromContour(contour).map((q) => pt(Number(q.r) * 10, Number(q.z) * 10));
  for (let i = 0; i + 1 < rows.length; i++) { const a = rows[i], c = rows[i + 1]; if (y < Math.min(a.y, c.y) - 1e-6 || y > Math.max(a.y, c.y) + 1e-6) continue; r = Math.max(r, a.y === c.y ? Math.max(a.x, c.x) : a.x + ((c.x - a.x) * (y - a.y)) / (c.y - a.y)); }
  return r;
}
/**
 * Gniazdo żeńskie frezu nasadzanego z mocowaniem FRExxx: otwór ød (z kodu) o głębokości L2 od dolnej płaszczyzny frezu (linia przerywana) i pozioma linia przerywana
 * kanału pod kamień na całej szerokości frezu. Wynik: { hidden, cavity } (wnęka 3D otwarta od dołu) albo null.
 */
export function fitDrawingFor(M, contour) {
  const L2 = freL2(M), d = freD(M), b = bounds(contour);
  if (!L2 || !d || !b) return null;
  // wszystko względem dolnej płaszczyzny frezu (konturu): otwór L2 w górę, kamienie H nad nią; kontur w indeksie jest przesunięty tak, że dolna płaszczyzna = −L2, więc dno otworu = Z 0
  const r = d * 5, yb = b.minY, yt = yb + L2 * 10, ys = yb + freKeyDepth(M) * 10, rad = radiusAtY(contour, ys) || b.maxX;
  return { hidden: [[pt(-r, yb), pt(-r, yt), pt(r, yt), pt(r, yb)], [pt(-rad, ys), pt(rad, ys)]], cavity: { bottom: true, ri: r, yTop: yt } };
}
/** Rysunek wiertła rurowego (płytki i linie niewidoczne, 0,1 mm) dla konturu: czubek z konturu, gdy odbiega od długości J narzędzia. null – brak. */
export function trepanDrawingFor(diameter, length, contour) {
  const b = bounds(contour);
  if (!b) return null;
  const j = Math.abs(b.maxY - num(length) * 10) > 1 ? b.maxY / 10 : num(length);
  return trepanDrawing(num(diameter), j);
}
/**
 * Otwór pod chwyt gwintownika (oprawka gwintująca, kolumna N „D12,0□09,0_042”) dla konturu: linia niewidoczna (przerywana) i wnęka do 3D,
 * od czubka konturu na głębokość z kolumny N. null – inna oprawka.
 */
export function holeDrawingFor(N, contour, M = '') {
  const h = tapHole(N), b = bounds(contour);
  if (!b) return null;
  if (h && /^ER_\d{3}$/i.test(String(M ?? '').trim())) {   // tulejka ER (mocowanie początkowe ER_): otwór przelotowy – od czoła do końca tulei, bez dna
    return { hidden: [[pt(-h.r, b.maxY), pt(-h.r, b.minY)], [pt(h.r, b.maxY), pt(h.r, b.minY)]], cavity: { ri: h.r, yb: b.minY, rb: 0, y7: Infinity, through: true } };
  }
  if (!h) {   // gniazdo żeńskie o kształcie męskiego zakończenia N (ABS, Weldon, Capto, MHD, KAR, MK): linia niewidoczna i wnęka 3D
    const sk = socketProfile(N);
    if (!sk) return null;
    const prof = sk.map(([x, z]) => pt(x, b.maxY + z)), poly = [...[...prof].reverse().map((p) => pt(p.x ? -p.x : 0, p.y)), ...prof].filter((p, i, a) => !i || Math.abs(p.x - a[i - 1].x) > 1e-6 || Math.abs(p.y - a[i - 1].y) > 1e-6);
    // krawędzie średnic wewnątrz gniazda: pozioma linia przerywana na każdym załamaniu profilu (np. stożek → walec w MHD, stożek → kołek w Morse'ie);
    // na poziomie z kilkoma punktami – środkowa część, bo boki są już w linii gniazda
    const edge = new Map();
    for (let i = 1; i < prof.length - 1; i++) { const q = prof[i]; if (q.y > prof[0].y + 1e-6 && q.x > 1e-6) edge.set(q.y, Math.min(edge.get(q.y) ?? Infinity, q.x)); }
    const lines = [...edge].map(([y, x]) => [pt(-x, y), pt(x, y)]);
    return { hidden: [poly, ...lines], cavity: { prof, rb: 0, y7: Infinity } };
  }
  const top = b.maxY, yb = top - h.depth;
  return { hidden: [[pt(-h.r, top), pt(-h.r, yb), pt(h.r, yb), pt(h.r, top)]], cavity: { ri: h.r, yb, rb: 0, y7: Infinity } };
}
/**
 * Nakrętka ER na czubku oprawki (kolumna N „ER_025”): pas nakrętki [z1, z2] (współrzędne konturu, 0,1 mm – ciemniejszy kolor) i wcięcia pod klucz
 * (linie widoczne w rzucie 2D: 6 wcięć co 60°, jedno na środku, dwa po bokach ze skrótem perspektywicznym). null – brak nakrętki.
 */
export function nutDrawingFor(N, contour) {
  const nut = nutFor(N), b = bounds(contour);
  if (!nut || !b) return null;
  const R = nut.R * 10, h = nut.slot.half * 10, d = Math.asin(Math.min(1, h / R)), base = b.maxY - nut.L * 10;
  const y0 = base + nut.slot.from * 10, y1 = base + nut.slot.to * 10;
  const slots = [90, 30, 150].map((deg) => {   // wcięcia zwrócone do patrzącego: 90° – środek, 30° / 150° – po bokach
    const c = (deg * Math.PI) / 180, xs = [R * Math.cos(c + d), R * Math.cos(c - d)].sort((p, q) => p - q);
    // dno wcięcia zaokrąglone (półkole o promieniu połowy szerokości wcięcia; po bokach – elipsa ze skrótem)
    const a = (xs[1] - xs[0]) / 2, xc = (xs[0] + xs[1]) / 2, yc = y0 + h, arc = [...Array(9)].map((_, i) => { const th = Math.PI + (Math.PI * i) / 8; return pt(xc + a * Math.cos(th), yc + h * Math.sin(th)); });
    return [pt(xs[0], y1), ...arc, pt(xs[1], y1)];
  });
  return { z1: base, z2: b.maxY, slots };
}
/** Szczeliny wzdłużne tulejki ER (mocowanie początkowe M = ER_nnn) – linie widoczne w rzucie 2D, współrzędne konturu (0,1 mm); null – nie tulejka. */
export function colletDrawingFor(M) {
  const s = colletSlits(M);
  return s ? s.map((l) => l.map(([x, y]) => pt(x, y))) : null;
}
/** Pas nakrętki i wcięcia przeniesione do układu rysunku: [map] – punkt konturu → punkt rysunku. */
export function mapNut(n, map) {
  if (!n) return null;
  const a = map(pt(0, n.z1)).y, c = map(pt(0, n.z2)).y;
  return { y1: Math.min(a, c), y2: Math.max(a, c), slots: n.slots.map((q) => q.map(map)) };
}
/** Rysunek wiertła rurowego przeniesiony do układu rysunku: [map] – punkt konturu → punkt rysunku. */
export const mapTrepanDrawing = (d, map) => (d ? { plates: d.plates.map((q) => q.map(map)), hidden: d.hidden.map((q) => q.map(map)) } : null);

/**
 * Układa narzędzia jedno pod drugim ([tools] – {code, contour, inserts: [ścieżka SVG], diameter, length, angle, chamfer}).
 * [allInserts] – wszystkie płytki (Viewer) zamiast pierwszej; [rotateChamfer] – obrót płytek fazowników (podgląd zapisu).
 * Wynik: { layers: [{code, outline, inserts, referenceY}], bounds } albo null.
 */
export function buildStack(tools, allInserts, rotateChamfer) {
  const layers = [];
  let offsetY = 0;
  tools.forEach((tool, index) => {
    const b = bounds(tool.contour);
    if (!b) return;
    const offsetY0 = offsetY;
    const outline = tool.contour.map((p) => pt(p.x, offsetY + (b.maxY - p.y)));
    // płytki: własny układ narzędzia (rodzaj, wiele płytek, położenie) albo płytki katalogu; centralna – jeden wielokąt na osi, obwodowa – para lewa / prawa
    // podgląd zapisu (allInserts = false) pokazuje pierwszą płytkę, ale nie gubi płytek, które tworzą układ: własny układ, płytki centralne / nieregularne i wiertła płytkowe (np. Komet z dwiema płytkami)
    const list = tool.plates ? (allInserts ? tool.plates : tool.plates.filter((p, i) => i === 0 || p.custom || (p.kind && p.kind !== 'edge') || tool.drill))
      : (allInserts ? tool.inserts : tool.inserts.slice(0, 1)).map((path) => ({ path, code: '', kind: tool.central ? 'central' : 'edge', central: !!tool.central, dx: 0, dz: 0, ang: 0, phi: 0, z: 0 }));
    const placed = [], plates = [];
    for (const pl0 of list) {
      const raw = parseInsertPath(pl0.path);
      if (raw.length < 2) continue;
      // punkt bazowy płytki (współrzędne konturu z arkusza); gdy konturem płytki odwrócono w pionie (cały pod osią) – razem z nim
      const rawN = pl0.base ? parseInsertPath(pl0.path, { absY: false }) : null, flip = !!rawN && rawN.length > 0 && Math.abs(rawN[0].y) > 1e-9 && Math.abs(raw[0].y + rawN[0].y) < 1e-9;
      const pl = flip ? { ...pl0, base: { x: pl0.base.x, y: -pl0.base.y } } : pl0;
      const kind = pl.kind || (pl.central ? 'central' : 'edge');   // centralna: jedna na osi; nieregularna: jedna w dowolnym miejscu; obwodowa: para lewa / prawa
      const polys = kind === 'central' ? [placeCentral(raw, apexBase(b, offsetY, tool), pl)]
        : kind === 'irregular' ? [tool.drill ? placeCentral(raw, apexBase(b, offsetY, tool), pl) : placeInsert(raw, b, offsetY, tool, true, rotateChamfer, pl)]
          : [false, true].map((mirror) => placeInsert(raw, b, offsetY, tool, mirror, rotateChamfer, pl));
      // płytka pojedyncza (centralna / nieregularna) obrócona wokół osi narzędzia o φ: w rzucie z boku jej współrzędne X skaleją się przez cos φ
      // (φ = 180° – lustrzane odbicie względem osi, ostrze po drugiej stronie), dzięki czemu dwie płytki nie nachodzą na siebie; src – położenie przed obrotem (dla 3D)
      const phi = pl.phi || 0, single = polys.length === 1, cs = Math.abs(phi % 360) < 1e-9 ? 1 : Math.round(Math.cos((phi * Math.PI) / 180) * 1e9) / 1e9;
      const shown = single && cs !== 1 ? polys.map((q) => q.map((p) => pt(p.x * cs, p.y))) : polys;
      placed.push(...shown); plates.push({ code: pl.code, kind, central: kind === 'central', irregular: kind === 'irregular', single, phi, z: pl.z || 0, polys: shown, src: polys, bases: shown.map((q) => basePlaced(raw, q, pl.base)) });   // bases – punkt bazowy płytki w układzie rysunku (null – nie ustawiony)
    }
    // frez nasadzany na trzpień FRExxx osadza się dolną płaszczyzną na czole oprawki (trzpień wchodzi w otwór na głębokość L2): kolejne narzędzie (oprawka) leży o L2 wyżej niż koniec trzpienia, niezależnie od tego, jak głęboko sięga kontur frezu
    offsetY += tool.fitM && index < tools.length - 1 ? (b.maxY - b.minY) - freL2(tool.fitM) * 10 : b.r;
    if (index === tools.length - 1) offsetY += b.m;
    const fitD = tool.fitM ? fitDrawingFor(tool.fitM, tool.contour) : null, fitH = fitD ? fitD.hidden.map((q) => q.map((p) => pt(p.x, offsetY0 + (b.maxY - p.y)))) : null;   // gniazdo frezu nasadzanego (FRExxx)
    layers.push({ code: tool.code, outline, inserts: placed, plates, referenceY: offsetY, blades: tool.trepan ? [] : bladeBands(tool.regions, (z) => offsetY0 + (b.maxY - z * 10)), nut: tool.holeN ? mapNut(nutDrawingFor(tool.holeN, tool.contour), (p) => pt(p.x, offsetY0 + (b.maxY - p.y))) : null, slits: ((d) => (d ? d.map((q) => q.map((p) => pt(p.x, offsetY0 + (b.maxY - p.y)))) : null))(colletDrawingFor(tool.startM)), hole: tool.holeN || fitH ? [...(tool.holeN ? ((h) => (h ? h.hidden.map((q) => q.map((p) => pt(p.x, offsetY0 + (b.maxY - p.y)))) : []))(holeDrawingFor(tool.holeN, tool.contour, tool.startM)) : []), ...(fitH || [])] : null, draw: tool.trepan ? mapTrepanDrawing(trepanDrawingFor(tool.diameter, tool.length, tool.contour), (p) => pt(p.x, offsetY0 + (b.maxY - p.y))) : null });
  });
  if (!layers.length) return null;
  return { layers, bounds: bounds(layers.flatMap((l) => [...l.outline, ...l.inserts.flat()])) };
}

/**
 * Pasy ostrza narzędzia obróbczego (rejony „ostrze” z PSWT BE / podziału wg długości roboczej, Z w mm): [{ y1, y2 }] w układzie rysunku ([yOf] – Z mm → y);
 * koloruje się je na żółto (kolor płytek) na sylwecie narzędzia w miniaturach i podglądach 2D.
 */
export function bladeBands(regions, yOf) {
  return (regions || []).filter((r) => r && r.role === 'ostrze' && Number.isFinite(r.z1) && Number.isFinite(r.z2)).map((r) => { const a = yOf(r.z1), c = yOf(r.z2); return { y1: Math.min(a, c), y2: Math.max(a, c) }; });
}
/**
 * Y rysunku punktu Z = J (długość narzędzia – odległość wierzchołka płytki od Z = 0): kontur korpusu bywa od J krótszy (zależnie od oprawki), więc wierzchołek
 * płytki leży ponad jego górną krawędzią. Bez J – górna krawędź konturu.
 */
const apexBase = (b, offsetY, tool) => (tool.length > 0 ? offsetY + (b.maxY - tool.length * 10) : offsetY);
/** Korekta położenia płytki: obrót o [ang]° wokół jej środka, potem przesunięcie o [dx] mm (w prawo) i [dz] mm (wzdłuż osi, w górę); rysunek ma y w dół. */
function adjustPoly(poly, dx, dz, ang, pivot = null) {
  if (!dx && !dz && !ang) return poly;
  const c = pivot || pt(poly.reduce((s2, p) => s2 + p.x, 0) / poly.length, poly.reduce((s2, p) => s2 + p.y, 0) / poly.length);   // obrót wokół punktu bazowego płytki (gdy ustawiony), inaczej wokół środka
  return poly.map((p) => { const r = ang ? rotateAround(p, c, ang) : p; return pt(r.x + dx * 10, r.y - dz * 10); });
}
/**
 * Przekształcenie afiniczne wierzchołków [raw] w odpowiadające im 1:1 wierzchołki [poly] (przesunięcie, obrót, odbicie, skalowanie X) jako funkcja punktu;
 * null, gdy wierzchołki leżą na jednej prostej.
 */
export function affineFit(raw, poly) {
  if (!raw || !poly || raw.length < 3 || raw.length !== poly.length) return null;
  const r0 = raw[0];
  let i1 = 1, best = -1;
  raw.forEach((p, i) => { const d = Math.hypot(p.x - r0.x, p.y - r0.y); if (d > best) { best = d; i1 = i; } });
  const ux = raw[i1].x - r0.x, uy = raw[i1].y - r0.y;
  let i2 = -1, area = 1e-9;
  raw.forEach((p, i) => { const a = Math.abs(ux * (p.y - r0.y) - uy * (p.x - r0.x)); if (a > area) { area = a; i2 = i; } });
  if (i2 < 0) return null;
  const vx = raw[i2].x - r0.x, vy = raw[i2].y - r0.y, det = ux * vy - vx * uy, q0 = poly[0], q1 = poly[i1], q2 = poly[i2];
  return (p) => { const dx = p.x - r0.x, dy = p.y - r0.y, s2 = (dx * vy - dy * vx) / det, t = (ux * dy - uy * dx) / det; return pt(q0.x + s2 * (q1.x - q0.x) + t * (q2.x - q0.x), q0.y + s2 * (q1.y - q0.y) + t * (q2.y - q0.y)); };
}
/** Punkt bazowy płytki ([base] – { x, y } mm we współrzędnych konturu płytki) w układzie narysowanego wielokąta [poly] (odpowiada wierzchołkom [raw] 1:1); null – brak. */
export function basePlaced(raw, poly, base) {
  if (!base || !Number.isFinite(base.x) || !Number.isFinite(base.y)) return null;
  const f = affineFit(raw, poly);
  return f ? f(pt(base.x * 10, base.y * 10)) : null;
}
/**
 * Płytka centralna (wiertło płytkowe ISCAR / AMEC): jeden wielokąt na osi narzędzia – środek płytki w x = 0, ścieżka odwrócona w pionie jak w miniaturze
 * (buildMini). Długość narzędzia J to odległość od wierzchołka płytki do Z = 0, a kontur korpusu jest od niej krótszy (zależnie od oprawki), więc
 * wierzchołek płytki leży na Z = J, czyli ponad górną krawędzią konturu: [base] = y rysunku punktu Z = J (offsetY + maxY − J·10); bez J – górna krawędź konturu.
 */
function placeCentral(raw, base, pl) {
  const minX = Math.min(...raw.map((p) => p.x)), maxX = Math.max(...raw.map((p) => p.x)), maxY = Math.max(...raw.map((p) => p.y)), cx = (minX + maxX) / 2;
  const poly0 = raw.map((p) => pt(p.x - cx, base + (maxY - p.y)));
  return adjustPoly(poly0, pl ? pl.dx : 0, pl ? pl.dz : 0, pl ? pl.ang : 0, pl && pl.base ? basePlaced(raw, poly0, pl.base) : null);
}
/** Płytka obwodowa (przy krawędzi): prawa ([mirror]) z korektą położenia płytki [pl], lewa – jej odbicie (dX i obrót z przeciwnym znakiem). */
function placeInsert(raw, b, offsetY, tool, mirror, rotateChamfer, pl) {
  const out = placeInsert0(raw, b, offsetY, tool, mirror, rotateChamfer);
  return pl ? adjustPoly(out, mirror ? pl.dx : -pl.dx, pl.dz, mirror ? pl.ang : -pl.ang, pl.base ? basePlaced(raw, out, pl.base) : null) : out;
}
function placeInsert0(raw, b, offsetY, tool, mirror, rotateChamfer) {
  const minX = Math.min(...raw.map((p) => p.x)), minY = Math.min(...raw.map((p) => p.y));
  const leftX = -(tool.diameter * 10) / 2, rightX = (tool.diameter * 10) / 2;
  const topY = apexBase(b, offsetY, tool);   // wierzchołek płytki na Z = J
  const plain = raw.map((p) => { const dx = p.x - minX; return pt(mirror ? rightX - dx : leftX + dx, topY + (p.y - minY)); });
  if (!rotateChamfer || !tool.chamfer) return plain;
  const pivotTop = offsetY - (tool.length * 10 - b.maxY);
  const pivotLeft = pt(leftX + (raw[0].x - minX), pivotTop + (raw[0].y - minY));
  const pivot = mirror ? pt(-pivotLeft.x, pivotLeft.y) : pivotLeft;
  const shift = -(tool.length * 10), angle = mirror ? -tool.angle : tool.angle;
  return plain.map((p) => rotateAround(pt(p.x, p.y + shift), pivot, angle));
}

// ---------- miniatura (pole 60 × 70) ----------
export const MINI_W = 60, MINI_H = 70;

/**
 * Płytki wiertarskie ISCAR i AMEC (grupa „wie”, rodzaj „ply”) są płytkami centralnymi: jedna płytka na osi narzędzia (środek płytki = oś, czubek = czubek
 * narzędzia), z opadem na obie strony – inaczej niż płytki frezów mocowane przy obwodzie (para lewa i prawa).
 */
export const isCentralTool = (t) => {
  const grp = String((t && t.columnD) ?? '').trim().toLowerCase(), typ = String((t && t.columnE) ?? '').trim().toLowerCase(), co = String((t && t.columnP) ?? '').toLowerCase();
  return grp === 'wie' && typ === 'ply' && (co.includes('iscar') || co.includes('amec'));
};
/** Wiertło płytkowe (grupa „wie”, rodzaj „ply”) – dowolna firma: ścieżki płytek są odwrócone w pionie (wierzchołek = największe y). */
export const isDrillPlate = (t) => String((t && t.columnD) ?? '').trim().toLowerCase() === 'wie' && String((t && t.columnE) ?? '').trim().toLowerCase() === 'ply';
export const isChamfer = (t) => { const g = String(t.columnD ?? '').trim().toLowerCase(), y = String(t.columnE ?? '').trim().toLowerCase(); return g === 'faz' || y === 'faz'; };
export const isChamferForPreview = (code, type, name) => String(code ?? '').toUpperCase().includes('POGF') || String(type ?? '').toLowerCase().includes('faz') || String(name ?? '').toLowerCase().includes('faz');

/** Miniatura z konturu i płytek: { outline, inserts } albo null (kontur < 3 punktów). */
/**
 * Miniatura narzędzia. [plateLookup] – (kod płytki) → ścieżka SVG płytki spoza katalogu narzędzia (płytki dodane we własnym układzie); gdy narzędzie ma własny
 * układ płytek (rodzaj, wiele płytek, położenie), płytki rysuje to samo rozmieszczenie co w podglądzie (buildStack).
 */
export function buildMini(tool, details, plateLookup = null) {
  const points = parseContour(details && details.columnAY);
  if (points.length < 3) return null;
  const b = bounds(points);
  const width = Math.max(b.maxX - b.minX, 1), height = Math.max(b.maxY - b.minY, 1);
  const boxW = 50, boxH = 60, scale = Math.min(boxW / width, boxH / height);
  const offsetX = 5 + (boxW - width * scale) / 2, offsetY = 5 + (boxH - height * scale) / 2;
  const outline = points.map((p) => pt(offsetX + (p.x - b.minX) * scale, offsetY + (b.maxY - p.y) * scale));
  const company = String(tool.columnP ?? '').toLowerCase().trim(), group = String(tool.columnD ?? '').toLowerCase().trim(), type = String(tool.columnE ?? '').toLowerCase().trim();
  const isWiePly = group === 'wie' && type === 'ply';
  const inserts = (details && details.insertContours) || [];
  const toRender = isWiePly && company.includes('komet') && !company.includes('iscar') && !company.includes('amec') ? inserts : inserts.slice(0, 1);
  const diameter = num(tool.columnF), length = plateLength(tool), faz = isChamfer(tool);   // płytki: J (frez FRExxx: J − L2)
  const tMounting = /t__0/i.test(String(tool.productCode ?? ''));
  const centerAxisX = offsetX + (0 - b.minX) * scale;
  const leftToolX = isWiePly ? centerAxisX - diameter * 5 * scale : offsetX + (-diameter * 5 - b.minX) * scale;
  const rightToolX = isWiePly ? centerAxisX + diameter * 5 * scale : offsetX + (diameter * 5 - b.minX) * scale;
  const insertTopY = tMounting ? offsetY : length > 0 ? offsetY + (b.maxY - length * 10) * scale : offsetY;   // wierzchołek płytki na Z = J
  let polygons = [];
  const custom = group === 'tre' ? null : plateSetup(tool);
  const kometDrill = isWiePly && company.includes('komet') && !company.includes('iscar') && !company.includes('amec');   // płytki Komet nie są centralne – układ jak w podglądzie
  if (group !== 'tre' && (custom || kometDrill)) {   // własny układ płytek albo wiertło Komet: to samo rozmieszczenie co w podglądzie (miniatura = podgląd) (stos jednego narzędzia: y rysunku = offsetY + maxY − Z), przeliczone na miniaturę
    const catalog = inserts.filter((i) => String(i.contour ?? '').trim());
    const pathOf = (code) => ((catalog.find((i) => normCode(i.code) === normCode(code)) || {}).contour) || (plateLookup && plateLookup(code)) || '';
    const plates = resolvePlates(custom, catalog.map((i) => i.code), isCentralTool(tool)).map((p) => ({ ...p, path: pathOf(p.code), base: plateBaseOf(p.code) })).filter((p) => p.path);
    const lay = buildStack([{ code: tool.productCode, contour: points, plates, inserts: plates.map((p) => p.path), diameter, length, angle: num(tool.columnG), chamfer: false, central: isCentralTool(tool), drill: isWiePly }], true, false);
    polygons = lay ? lay.layers[0].inserts.map((poly) => poly.map((p) => pt(offsetX + (p.x - b.minX) * scale, offsetY + p.y * scale))) : [];
  } else for (const ins of toRender) {
    const raw = parseInsertPath(ins.contour);
    if (raw.length < 2) continue;
    const iMinX = Math.min(...raw.map((p) => p.x)), iMaxX = Math.max(...raw.map((p) => p.x)), iMinY = Math.min(...raw.map((p) => p.y)), iMaxY = Math.max(...raw.map((p) => p.y));
    const polygon = (mirror) => {
      if (isWiePly) {
        const midX = (iMinX + iMaxX) / 2, apexY = offsetY + (b.maxY - length * 10) * scale;   // wierzchołek płytki (największe y ścieżki) na Z = J; płytka odwrócona w pionie, reszta w dół
        return raw.map((p) => { const dx = (p.x - midX) * scale; return pt(mirror ? centerAxisX + dx : centerAxisX - dx, apexY + (iMaxY - p.y) * scale); });
      }
      return raw.map((p) => { const dx = (p.x - iMinX) * scale; const my = iMaxY - (p.y - iMinY); return pt(mirror ? rightToolX - dx : leftToolX + dx, insertTopY + (iMaxY - my) * scale); });
    };
    if (faz) {
      const angle = num(String(tool.columnG ?? '').trim() ? tool.columnG : tool.columnH);
      polygons.push(polygon(false).map((p) => rotateAround(p, pt(leftToolX, insertTopY), angle)));
      polygons.push(polygon(true).map((p) => rotateAround(p, pt(rightToolX, insertTopY), -angle)));
    } else if (isWiePly && (company.includes('iscar') || company.includes('amec'))) polygons.push(polygon(true));
    else { polygons.push(polygon(false)); polygons.push(polygon(true)); }
  }
  const draw = group === 'tre' ? mapTrepanDrawing(trepanDrawingFor(diameter, length, points), (p) => pt(offsetX + (p.x - b.minX) * scale, offsetY + (b.maxY - p.y) * scale)) : null;   // wiertło rurowe: płytki żółte, wnęka przerywana
  const mapM = (h) => (h ? h.hidden.map((q) => q.map((p) => pt(offsetX + (p.x - b.minX) * scale, offsetY + (b.maxY - p.y) * scale))) : null);
  const hole0 = group === 'opr' ? mapM(holeDrawingFor(tool.columnN, points, tool.columnM)) : null, fitM = group === 'fre' && freL2(tool.columnM) ? mapM(fitDrawingFor(tool.columnM, points)) : null;   // gniazdo frezu FRExxx
  const hole = hole0 || fitM ? [...(hole0 || []), ...(fitM || [])] : null;
  const slits = ((d) => (d ? d.map((q) => q.map((p) => pt(offsetX + (p.x - b.minX) * scale, offsetY + (b.maxY - p.y) * scale))) : null))(colletDrawingFor(tool.columnM));   // szczeliny tulejki ER   // oprawka gwintująca: otwór przerywaną linią
  const nut = group === 'opr' ? mapNut(nutDrawingFor(tool.columnN, points), (p) => pt(offsetX + (p.x - b.minX) * scale, offsetY + (b.maxY - p.y) * scale)) : null;   // nakrętka ER: ciemniejszy pas i wcięcia
  const blades = group === 'tre' ? [] : bladeBands(details && details.regions, (z) => offsetY + (b.maxY - z * 10) * scale);   // ostrze narzędzia obróbczego – żółty pas na sylwecie
  return { outline, inserts: group === 'tre' ? [] : polygons, axisX: centerAxisX, draw, hole, nut, slits, blades };
}

// ---------- układ płytek na narzędziu: własny układ (rodzaj, wiele płytek, położenie) dostarcza program (zapis na tym komputerze) ----------
let plateSetup = () => null;
/** Dostawca własnego układu płytek narzędzia: (narzędzie) → lista płytek (logic/plateLayout.js) albo null. Ustawia warstwa widoków. */
let plateBaseOf = () => null;
/** Dostawca punktu bazowego płytki: (kod płytki) → { x, y } mm we współrzędnych konturu płytki albo null. Ustawia warstwa widoków. */
export const setPlateBaseProvider = (fn) => { plateBaseOf = typeof fn === 'function' ? fn : () => null; };
export const setPlateSetupProvider = (fn) => { plateSetup = typeof fn === 'function' ? fn : () => null; };

// ---------- indeks katalogu (ToolsLogic.kt) ----------
export const NO_DATA = 'Brak danych';
const isWhite = (c) => { const x = String(c ?? '').trim().toLowerCase().replace(/ /g, ''); return !x || x === '#ffffff' || x === '#fff' || x === 'white' || x === 'rgb(255,255,255)'; };
export const numberText = (v) => (Number(v) === Math.round(Number(v)) ? String(Math.round(Number(v))) : String(Number(v)));

/** Rejony narzędzia monolitycznego z konturu x_y (0,1 mm): ostrze – górne [k] mm (od czubka), reszta oprawka; null, gdy kontur za krótki. */
function bladeRegions(contourText, k) {
  const ys = parseContour(contourText).map((p) => p.y / 10);
  if (ys.length < 3 || !(k > 0)) return null;
  const zMin = Math.min(...ys), zMax = Math.max(...ys), z = Math.round((zMax - k) * 1000) / 1000;
  return z > zMin && z < zMax ? [{ role: 'oprawka', z1: Math.round(zMin * 1000) / 1000, z2: z }, { role: 'ostrze', z1: z, z2: Math.round(zMax * 1000) / 1000 }] : null;
}
/** Indeks katalogu narzędzi ({tools, detailsMap} z getStToolOptions): narzędzie, szczegóły, części, dane do 2D/3D/DXF. */
export function toolIndex(catalog, overrides = null) {
  const tools = new Map(), details = new Map();
  for (const t of (catalog && catalog.tools) || []) if (String(t.productCode ?? '').trim()) tools.set(normCode(t.productCode), t);
  for (const [k, d] of Object.entries((catalog && catalog.detailsMap) || {})) details.set(normCode(k), d);
  const tool = (code) => tools.get(normCode(code)) || null;
  // zatwierdzony kontur (PSWT BC) zastępuje kontur z kolumny T
  const det0 = (code) => { const k = normCode(code), d = details.get(k) || null, o = overrides && overrides.get(k); const rg = overrides && overrides.regions && overrides.regions.get(k); const genC = !!(overrides && overrides.generated && overrides.generated.has(k));
    const bl = overrides && overrides.blade && overrides.blade.get(k), rg0 = rg || (bl ? bladeRegions(o || (d && d.columnAY), bl) : null);   // ostrze narzędzia monolitycznego wg długości roboczej (żółty pas w podglądach)
    if (!o) return rg0 && d ? { ...d, regions: rg0 } : d;
    return { ...(d || {}), columnAY: o, confirmedContour: !genC, generatedContour: genC, originalAY: d ? d.columnAY : '', regions: rg0 || null }; };
  /**
   * Frezy (grupa „fre”): kontur z dowolnego źródła (T, V, BC, generator) jest uzupełniany o poziome krawędzie średnic (linia przez całą szerokość na każdym uskoku i załamaniu
   * obrysu – jak w innych narzędziach), a frez z mocowaniem FRExxx dodatkowo przesunięty w osi Z tak, aby jego najniższy punkt (dolna płaszczyzna) leżał na Z = −L2:
   * wtedy Z = 0 to dno otworu pod trzpień, a gniazdo, kamienie i osadzenie na oprawce są zgodne. Obie operacje są idempotentne.
   */
  const detMemo = new Map();
  const det = (code) => {
    const r = det0(code), t = tools.get(normCode(code));
    if (!r || !t || String(t.columnD ?? '').trim().toLowerCase() !== 'fre' || !String(r.columnAY ?? '').trim()) return r;
    const l2 = isFreFit(t) ? freL2(t.columnM) : 0, key = normCode(code), hit = detMemo.get(key);
    if (hit && hit.src === r.columnAY && hit.l2 === l2 && hit.regions === r.regions) return hit.ay === r.columnAY && hit.rg === r.regions ? r : { ...r, columnAY: hit.ay, regions: hit.rg };
    let pts = parseContour(r.columnAY), dy = 0;
    if (l2 && pts.length) { dy = -l2 * 10 - Math.min(...pts.map((p) => p.y)); if (Math.abs(dy) >= 1e-6) pts = pts.map((p) => ({ x: p.x, y: p.y + dy })); else dy = 0; }
    const half = pts.length >= 3 ? halfPath(pts) : [], withLines = half.length >= 3 ? withEdgeLines(half) : half;
    if (withLines !== half) pts = expandHalf(withLines);   // dopisane brakujące krawędzie średnic
    const fmt3 = (v) => String(Math.round(v * 1000) / 1000);
    const ay = dy || withLines !== half ? pts.map((p) => `${fmt3(p.x)}_${fmt3(p.y)}`).join(';') : r.columnAY;
    const rg = r.regions && dy ? r.regions.map((g) => ({ ...g, z1: Math.round((g.z1 + dy / 10) * 1000) / 1000, z2: Math.round((g.z2 + dy / 10) * 1000) / 1000 })) : r.regions;
    detMemo.set(key, { src: r.columnAY, l2, regions: r.regions, ay, rg });
    return ay === r.columnAY && rg === r.regions ? r : { ...r, columnAY: ay, regions: rg };
  };
  let usage = null;
  const idx = {
    tool, details: det,
    /**
     * Narzędzie do rysunku zestawu / 3D. [opts.layout] false – bez własnego układu płytek (tylko płytki katalogu), [opts.adj] false – bez korekt położenia
     * (dX, dZ, obrót) – układ „z algorytmu”. Płytki: [{ code, path, central, dx, dz, ang, phi, z, custom }].
     */
    stackTool(t, opts = {}) {
      if (typeof t === 'string') t = tool(t);
      if (!t) return null;
      const d = det(t.productCode);
      const tre = String(t.columnD ?? '').trim().toLowerCase() === 'tre';   // wiertło rurowe: kielich, ostrze = węglik (płytki rysuje podgląd 3D z liczby wg Ø)
      const catalog = tre ? [] : ((d && d.insertContours) || []).filter((i) => String(i.contour ?? '').trim());
      const pathOf = (code) => ((catalog.find((i) => normCode(i.code) === normCode(code)) || {}).contour) || idx.insertContour(code) || '';
      // tylko płytki przypisane do narzędzia (kolumna części skrawających) – własny układ nie może dodać cudzych płytek
      const own = (list) => { const l = Array.isArray(list) ? list.filter((p) => catalog.some((i) => normCode(i.code) === normCode(p.code))) : null; return l && l.length ? l : null; };
      let plates = resolvePlates(opts.layout === false ? null : own(plateSetup(t)), catalog.map((i) => i.code), isCentralTool(t));
      if (opts.adj === false) plates = plates.map((p) => ({ ...p, dx: 0, dz: 0, ang: 0 }));
      plates = tre ? [] : plates.map((p) => ({ ...p, path: pathOf(p.code), base: plateBaseOf(p.code) })).filter((p) => p.path);
      const contour = parseContour(d && d.columnAY);
      return { code: t.productCode, contour, regions: (d && d.regions) || null, inserts: plates.map((p) => p.path), plates, diameter: num(t.columnF), length: plateLength(t), angle: num(t.columnG), chamfer: isChamferForPreview(t.productCode, t.columnE, t.name), central: isCentralTool(t), drill: isDrillPlate(t), trepan: tre, holeN: String(t.columnD ?? '').trim().toLowerCase() === 'opr' ? t.columnN : '', startM: t.columnM, fitM: String(t.columnD ?? '').trim().toLowerCase() === 'fre' && freL2(t.columnM) ? t.columnM : '' };
    },
    dxfTool(t) { const d = det(t.productCode); return { code: t.productCode, contour: parseContour(d && d.columnAY), inserts: (d && d.insertContours) || [], diameter: num(t.columnF), length: num(t.columnJ) }; },
    coordinatesTool(t) { const d = det(t.productCode); return { code: t.productCode, company: t.columnP || '', diameter: t.columnF || '', length: t.columnJ || '', angle: num(t.columnG), contour: parseContour(d && d.columnAY), inserts: (d && d.insertContours) || [] }; },
    partRows(codes) {
      return codes.flatMap((code) => {
        const d = det(code);
        if (!d) return [];
        return [...(d.partsCutting || []), ...(d.partsAccessories || [])].map((partCode) => {
          const p = tool(partCode);
          return { toolCode: code, partCode, status: p ? numberText(p.status || 0) : NO_DATA, stock: p ? numberText(p.stock || 0) : NO_DATA, available: p ? numberText(p.available || 0) : NO_DATA,
            color: (p && String(p.partStatusColor || '').trim()) || '#ffffff' };
        });
      });
    },
    hasPartWarning(code) {
      const d = det(code);
      if (!d) return false;
      return [...(d.partsCutting || []), ...(d.partsAccessories || [])].some((pc) => { const p = tool(pc); return !!p && !isWhite(p.partStatusColor); });
    },
    /** Kontur płytki (ścieżka SVG) o kodzie [partCode] – z pierwszego narzędzia, które go ma; null, gdy brak. */
    insertContour(partCode) {
      const k = normCode(partCode);
      for (const d of details.values()) for (const ic of d.insertContours || []) if (normCode(ic.code) === k && String(ic.contour || '').trim()) return ic.contour;
      return null;
    },
    /** Podmiana konturu płytki o kodzie [partCode] we wszystkich narzędziach (po edycji w edytorze płytki, w pamięci programu). Zwraca liczbę zmienionych wpisów. */
    setInsertContour(partCode, path) {
      const k = normCode(partCode); let n = 0;
      for (const d of details.values()) for (const ic of d.insertContours || []) if (normCode(ic.code) === k) { ic.contour = path; n++; }
      return n;
    },
    /** Wszystkie kody części skrawających (płytek) z narzędzi katalogu. */
    cuttingParts() {
      const out = new Map();
      for (const d of details.values()) for (const p of d.partsCutting || []) { const k = normCode(p); if (k && !out.has(k)) out.set(k, p); }
      return [...out.values()];
    },
    usages(partCode) {
      if (!usage) {
        usage = new Map();
        for (const [k, d] of details) {
          const tc = (tools.get(k) || {}).productCode || k;
          const add = (p, role) => { const key = normCode(p); if (!usage.has(key)) usage.set(key, []); const l = usage.get(key); if (!l.some((u) => u.toolCode === tc && u.role === role)) l.push({ toolCode: tc, role }); };
          (d.partsCutting || []).forEach((p) => add(p, 'cutting'));
          (d.partsAccessories || []).forEach((p) => add(p, 'accessory'));
        }
        for (const l of usage.values()) l.sort((a, b) => naturalCompare(a.toolCode, b.toolCode));
      }
      return usage.get(normCode(partCode)) || [];
    },
  };
  return idx;
}

// ---------- eksport: DXF i współrzędne (ToolExport.kt) ----------
export const TOOL_PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
const SCALE = 0.1, INSERT_COLOR = '#d50000';
const f3 = (v) => v.toFixed(3);
export const sanitizeLayer = (v) => String(v ?? 'LAYER').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
export const sanitizeFileName = (v) => String(v ?? 'Tool_DXF').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120);
export function trueColor(hex) {
  const c = String(hex).trim().replace(/^#/, '');
  const part = (from) => { const n = parseInt(c.slice(from, from + 2), 16); return Number.isFinite(n) ? n : 0; };
  return part(0) * 65536 + part(2) * 256 + part(4);
}
const stackHeight = (tool, minY, maxY) => { const nominal = tool.length * 10; return nominal !== 0 ? nominal : maxY - minY; };

/** Tekst pliku DXF (skala 1:10, milimetry); narzędzia bez konturu (< 2 punktów) pomijane. */
export function buildDxf(tools) {
  const out = ['0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n', '0\nSECTION\n2\nTABLES\n0\nENDSEC\n', '0\nSECTION\n2\nENTITIES\n'];
  let base = 0;
  for (const t of tools) { if (t.contour.length < 2) continue; const b = bounds(t.contour); base += stackHeight(t, b.minY, b.maxY); }
  const line = (p1, p2, layer, color) => out.push(`0\nLINE\n8\n${sanitizeLayer(layer)}\n420\n${color}\n10\n${f3(p1.x * SCALE)}\n20\n${f3(p1.y * SCALE)}\n30\n0.000\n11\n${f3(p2.x * SCALE)}\n21\n${f3(p2.y * SCALE)}\n31\n0.000\n`);
  const lines = (pts, layer, hex) => { if (pts.length < 2) return; const c = trueColor(hex); for (let i = 0; i < pts.length - 1; i++) line(pts[i], pts[i + 1], layer, c); line(pts[pts.length - 1], pts[0], layer, c); };
  let currentY = 0;
  const allOuter = [];
  tools.forEach((tool, index) => {
    if (tool.contour.length < 2) return;
    const b = bounds(tool.contour), height = stackHeight(tool, b.minY, b.maxY);
    const positioned = tool.contour.map((p) => pt(p.x, currentY + (b.maxY - p.y) - base));
    const color = TOOL_PALETTE[index % TOOL_PALETTE.length], name = String(tool.code || '').trim() ? tool.code : 'TOOL_' + index;
    lines(positioned, name, color); lines(positioned, 'ALL_TOOLS', color);
    tool.inserts.forEach((ins, ii) => {
      const pts = transformInsert(ins.contour, b, currentY, base, tool.diameter, tool.length);
      if (pts.length < 2) return;
      const layer = 'INSERT_' + sanitizeLayer(name) + '_' + sanitizeLayer(String(ins.code || '').trim() ? ins.code : 'P' + ii);
      lines(pts, layer, INSERT_COLOR); lines(pts, 'ALL_INSERTS', INSERT_COLOR);
    });
    allOuter.push(...positioned);
    currentY += height;
  });
  const outer = outerContour(allOuter);
  if (outer.length > 1) lines(outer, 'OUTER_CONTOUR', INSERT_COLOR);
  out.push('0\nENDSEC\n0\nEOF\n');
  return out.join('');
}
function transformInsert(path, b, currentY, base, diameter, length) {
  const raw = parseInsertPath(path);
  if (raw.length < 2) return [];
  const minX = Math.min(...raw.map((p) => p.x)), minY = Math.min(...raw.map((p) => p.y));
  const left = -((diameter * 10) / 2), top = currentY - base - (length * 10 - (b.maxY - b.minY));
  return raw.map((p) => pt(left + (p.x - minX), top + (p.y - minY)));
}
/** Zewnętrzny obrys: dla każdego poziomu Y skrajne X po prawej, potem w górę po lewej. */
export function outerContour(points) {
  if (points.length < 2) return [];
  const byY = new Map();
  for (const p of points) {
    const k = f3(p.y);
    const l = byY.get(k) || { y: p.y, minX: p.x, maxX: p.x };
    l.minX = Math.min(l.minX, p.x); l.maxX = Math.max(l.maxX, p.x); byY.set(k, l);
  }
  const levels = [...byY.values()].sort((a, b) => a.y - b.y);
  const right = levels.map((l) => pt(l.maxX, l.y)), left = [...levels].reverse().map((l) => pt(l.minX, l.y));
  return [...right, ...left, right[0]];
}
export const defaultNameOptions = () => ({ codes: true, length: true, diameter: false, toolType: false, company: false, date: false, manual: '' });
export function dxfFileName(o, codes, totalLength, firstDiameter, firstType, firstCompany, isoDate) {
  const parts = [];
  if (String(o.manual || '').trim()) parts.push(o.manual.trim());
  if (o.codes) parts.push(codes.join('_'));
  if (o.length) parts.push('L' + Math.round(totalLength));
  if (o.diameter && String(firstDiameter).trim()) parts.push('D' + String(firstDiameter).replace(',', '.'));
  if (o.toolType && String(firstType).trim()) parts.push(firstType);
  if (o.company && String(firstCompany).trim()) parts.push(firstCompany);
  if (o.date) parts.push(isoDate);
  return sanitizeFileName(parts.join('_') || 'Tool_DXF') + '.dxf';
}
/** Tekst „Współrzędne”: punkty konturu i płytek (przed i po obrocie). */
export function coordinatesText(tools) {
  let s = '';
  for (const t of tools) {
    s += `==============================\nNARZĘDZIE: ${t.code}\nFirma: ${t.company}\nŚrednica: ${t.diameter}\nDługość: ${t.length}\nKąt płytki / columnG: ${f3(t.angle)}°\n--- Punkty konturu narzędzia ---\n`;
    t.contour.forEach((p, i) => { s += `${i + 1}. X=${f3(p.x)}  Y=${f3(p.y)}\n`; });
    if (!t.inserts.length) s += '\n--- Płytki ---\nBrak konturów płytek.\n';
    const maxY = t.contour.length ? Math.max(...t.contour.map((p) => p.y)) : 0;
    for (const ins of t.inserts) {
      const raw = parseInsertPath(ins.contour);
      let placed = [];
      if (raw.length >= 2) {
        const minX = Math.min(...raw.map((p) => p.x)), minY = Math.min(...raw.map((p) => p.y));
        const leftX = -((num(t.diameter) * 10) / 2), topY = -(num(t.length) * 10 - maxY);
        placed = raw.map((p) => pt(leftX + (p.x - minX), topY + (p.y - minY)));
      }
      const pivot = placed[0] || pt(0, 0);
      s += `\n--- Płytka: ${ins.code} ---\nKontur źródłowy:\n${ins.contour}\n\n--- Obrót płytki ---\nKąt obrotu z columnG: ${f3(t.angle)}°\nPunkt obrotu LEWY / bazowy:\nX=${f3(pivot.x)}  Y=${f3(pivot.y)}\n\n`;
      s += 'Punkty płytki PO TRANSFORMACJI:\nUwaga: pokazane przy środku osi 0, pozycji 0 i skali 1\n\n';
      placed.forEach((p, i) => { const r = rotateAround(p, pivot, t.angle); s += `${i + 1}. przed X=${f3(p.x)}  Y=${f3(p.y)}  |  po obrocie X=${f3(r.x)}  Y=${f3(r.y)}\n`; });
    }
    s += '\n';
  }
  return s;
}

// ---------- bryła obrotowa 3D (Lathe3D.kt) ----------
/** Prawa połowa konturu bez powtórzeń, zamknięta do osi na dole i na górze. */
export function profileOf(contour, cav = null) {
  if (!contour || contour.length < 3) return null;
  // obrys zewnętrzny: dla każdego poziomu Z największa odległość od osi (z obu stron), w kolejności Z – bez linii wewnętrznych
  // (gniazda oprawek, linie rzutu bocznego), które przy obrocie dawały fałszywe stożki i lejki
  let rows = halfFromContour(contour).map((r) => pt(Number(r.r) * 10, Number(r.z) * 10)).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (rows.length < 2) return null;
  const ys = rows.map((p) => p.y);
  // wiertło rurowe: wnęka otwarta od czubka; płytki (w ściance) rysuje osobno podgląd – bryła ma tu promień korpusu aż do czubka
  if (cav) rows = rows.map((p) => (p.y >= cav.y7 - 1e-6 ? pt(Math.min(p.x, cav.rb), p.y) : p));
  const out = [];
  if (cav && cav.bottom) { for (const p of [pt(cav.ri, Math.min(...ys)), ...rows, pt(0, Math.max(...ys)), pt(0, cav.yTop), pt(cav.ri, cav.yTop)]) { const l = out[out.length - 1]; if (!l || Math.abs(l.x - p.x) > 1e-3 || Math.abs(l.y - p.y) > 1e-3) out.push(p); } return out.length >= 2 ? out : null; }   // gniazdo otwarte od dołu (frez FRExxx)
  for (const p of [pt(cav && cav.through ? cav.ri : 0, Math.min(...ys)), ...rows, ...(cav ? (cav.prof ? [...cav.prof].reverse() : cav.through ? [pt(cav.ri, Math.max(...ys)), pt(cav.ri, Math.min(...ys))] : [pt(cav.ri, Math.max(...ys)), pt(cav.ri, cav.yb), pt(0, cav.yb)]) : [pt(0, Math.max(...ys))])]) { const l = out[out.length - 1]; if (!l || Math.abs(l.x - p.x) > 0.001 || Math.abs(l.y - p.y) > 0.001) out.push(p); }
  return out.length >= 2 ? out : null;
}
/**
 * Dane płytek ostrza wiertła rurowego (mm, układ konturu): n – liczba (wg Ø albo zapisana), rIn / rOut – węglik, z1 / z2 – ostrze od czubka,
 * arc – długość płytki po obwodzie (maks. 4 mm; przy gęstym rozstawie mniejsza). null – brak rejonu ostrza.
 */
export function trepanBlade(diameter, regions, n = 0) {
  const r = (regions || []).find((q) => q.role === 'ostrze'), d = num(diameter);
  if (!r || !(d > 0)) return null;
  const cnt = n >= 1 ? Math.min(60, Math.round(n)) : trepanPlates(d);
  return { n: cnt, rIn: Math.max(0, d / 2 - TREPAN.blade), rOut: d / 2, z1: r.z1, z2: r.z2, arc: Math.min(TREPAN.plateArc, (Math.PI * d) / cnt * 0.9) };
}
/**
 * Linie obrysu do rysowania (ścieżka SVG „M … L …”): krawędzie zamkniętego konturu bez odcinków leżących na osi narzędzia
 * (x = [axis] dla obu końców) – to ślad połówki konturu po odbiciu, a nie krawędź elementu. [map] – punkt → [x, y] na rysunku.
 */
export function outlinePath(points, map, axis = 0) {
  const P = points || [], n = P.length, onAxis = (p) => Math.abs(p.x - axis) < 1e-3;
  if (n < 2) return '';
  let d = '', pen = false;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    if (onAxis(a) && onAxis(b)) { pen = false; continue; }
    const [ax, ay] = map(a), [bx, by] = map(b);
    if (!pen) d += `M${ax.toFixed(2)},${ay.toFixed(2)}`;
    d += `L${bx.toFixed(2)},${by.toFixed(2)}`;
    pen = true;
  }
  return d;
}
/** Siatka brył obrotowych zestawu (kolejność: pierwsze = tnące). null, gdy brak konturów. */
/** Głębokość osadzenia frezu na trzpieniu (mm, L2 z mocowania FRExxx) dla narzędzia zestawu; 0 – brak. */
export const fitSeat = (stt) => (stt && stt.fitM ? freL2(stt.fitM) : 0);
/**
 * Siatka bryły obrotowej zestawu. [seats] – dla frezów z mocowaniem FRExxx głębokość osadzenia L2 (mm): dolna płaszczyzna frezu leży na czole oprawki pod nim (trzpień wchodzi w otwór na L2).
 */
export function buildMesh(contours, segments = 36, cavities = [], seats = []) {
  const profiles = contours.map((c, i) => profileOf(c, cavities[i] || null));
  const offsets = new Array(contours.length).fill(0);
  let z = 0;
  for (let i = contours.length - 1; i >= 0; i--) { const p = profiles[i]; if (!p) continue; const seat = i < contours.length - 1 ? seats[i] || 0 : 0; offsets[i] = seat ? z - seat * 10 - Math.min(...p.map((q) => q.y)) : z; z = offsets[i] + Math.max(...p.map((q) => q.y)); }
  const vx = [], vy = [], vz = [], quads = [], faceTool = [];
  const sin = [...Array(segments)].map((_, j) => Math.sin((2 * Math.PI * j) / segments)), cos = [...Array(segments)].map((_, j) => Math.cos((2 * Math.PI * j) / segments));
  profiles.forEach((profile, ti) => {
    if (!profile) return;
    const base = vx.length;
    for (const p of profile) for (let j = 0; j < segments; j++) { vx.push(p.x * cos[j]); vy.push(-p.x * sin[j]); vz.push(p.y + offsets[ti]); }
    for (let k = 0; k < profile.length - 1; k++) {
      if (profile[k].x === 0 && profile[k + 1].x === 0) continue;
      for (let j = 0; j < segments; j++) { const j2 = (j + 1) % segments; quads.push(base + k * segments + j, base + k * segments + j2, base + (k + 1) * segments + j2, base + (k + 1) * segments + j); faceTool.push(ti); }
    }
  });
  if (!quads.length) return null;
  const faces = quads.length / 4, normals = new Float64Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    const a = quads[f * 4], b = quads[f * 4 + 1], d = quads[f * 4 + 3];
    const e1 = [vx[b] - vx[a], vy[b] - vy[a], vz[b] - vz[a]], e2 = [vx[d] - vx[a], vy[d] - vy[a], vz[d] - vz[a]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) { nx /= len; ny /= len; nz /= len; }
    normals[f * 3] = nx; normals[f * 3 + 1] = ny; normals[f * 3 + 2] = nz;
  }
  const mm = (a) => [Math.min(...a), Math.max(...a)];
  const [x0, x1] = mm(vx), [y0, y1] = mm(vy), [z0, z1] = mm(vz);
  return { vx, vy, vz, quads, faceTool, normals, faceCount: faces, profiles, offsets, center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: Math.max(1, x1 - x0, y1 - y0, z1 - z0) };
}
/** Płytki zestawu do podglądu 3D: prawa płytka każdej pary (0,1 mm) w układzie siatki buildMesh – rozmieszczenie jak na rysunku 2D (buildStack),
 *  wysokość + offsets[i]; { code: kod narzędzia, poly }. Kopie na obwodzie (z=) robi podgląd 3D. */
export function insertsForMesh(stackTools, offsets) {
  const out = [];
  stackTools.forEach((stt, i) => {
    if (!stt || !stt.inserts || !stt.inserts.length || !stt.contour || stt.contour.length < 3) return;
    const st2 = buildStack([stt], true, false); if (!st2) return;
    const b = bounds(stt.contour), off = (offsets && offsets[i]) || 0;
    for (const pm of st2.layers[0].plates) {   // centralna – jeden wielokąt, obwodowa – prawa płytka pary (kopie na obwodzie robi podgląd 3D)
      const poly = pm.single ? (pm.src || pm.polys)[0] : pm.polys[pm.polys.length - 1];   // 3D obraca płytkę o φ samo – bierze położenie przed obrotem
      if (poly) out.push({ code: stt.code, plate: pm.code, central: pm.central, irregular: !!pm.irregular, phi: pm.phi, z: pm.z, poly: poly.map((p) => pt(p.x, b.maxY - p.y + off)) });
    }
  });
  return out;
}
/** Kamera obracająca się wokół środka bryły: ustawienie początkowe jak w wersji webowej (1,3; 0,8; 1,8). */
export function initialCamera(size) {
  const x = 1.3, y = 0.8, z = 1.8, len = Math.hypot(x, y, z);
  return { yaw: Math.atan2(x, z), pitch: Math.asin(y / len), distance: size * len };
}
export const rotateCamera = (c, dYaw, dPitch) => ({ ...c, yaw: c.yaw + dYaw, pitch: Math.max(-1.5, Math.min(1.5, c.pitch + dPitch)) });
export const zoomCamera = (c, factor, size) => ({ ...c, distance: Math.max(size * 0.6, Math.min(size * 8, c.distance / factor)) });
/** Rzut perspektywiczny: współrzędne ekranu, ściany od najdalszej i jasność ścian. */
export function project(mesh, cam, width, height) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const dir = [cp * Math.sin(cam.yaw), sp, cp * Math.cos(cam.yaw)];
  const camP = mesh.center.map((c, i) => c + dir[i] * cam.distance);
  const f = dir.map((v) => -v);
  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(...r) < 1e-6 ? 1 : Math.hypot(...r); r = r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const focal = height / 2 / Math.tan((45 * Math.PI) / 360);
  const n = mesh.vx.length, sx = new Float64Array(n), sy = new Float64Array(n), depth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const px = mesh.vx[i] - camP[0], py = mesh.vy[i] - camP[1], pz = mesh.vz[i] - camP[2];
    const x = px * r[0] + py * r[1] + pz * r[2], y = px * u[0] + py * u[1] + pz * u[2], zz = px * f[0] + py * f[1] + pz * f[2];
    depth[i] = zz;
    if (zz > 0.01) { sx[i] = width / 2 + (focal * x) / zz; sy[i] = height / 2 - (focal * y) / zz; }
  }
  const L = [100, 200, 200], ll = Math.hypot(...L), light = L.map((v) => v / ll);
  const list = [], shade = new Float64Array(mesh.faceCount);
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const q = mesh.quads.slice(fi * 4, fi * 4 + 4);
    if (q.some((i) => depth[i] <= 0.01)) continue;
    list.push([fi, (depth[q[0]] + depth[q[1]] + depth[q[2]] + depth[q[3]]) / 4]);
    const dot = Math.abs(mesh.normals[fi * 3] * light[0] + mesh.normals[fi * 3 + 1] * light[1] + mesh.normals[fi * 3 + 2] * light[2]);
    shade[fi] = Math.max(0, Math.min(1, 0.45 + 0.55 * dot));
  }
  list.sort((a, b) => b[1] - a[1]);
  return { sx, sy, order: list.map((x) => x[0]), shade };
}
