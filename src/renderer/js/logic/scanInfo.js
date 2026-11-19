// Skaner – podgląd z danych prosto z arkusza (API mp_scanInfo, scanPartInfo); ta sama logika co w aplikacji na Androida (ScanInfo.kt):
// operacje przewodnika co 10 (10…n) z pominiętymi, wykonane detale komisu, dokument już zarejestrowany, historia rejestrowania.
import { eq, num, looseKey, cellColor } from './mistrz.js';

const rank = (st) => ({ koniec: 3, 'w toku': 2, start: 1 })[eq(st)] || 0;
const NAMES = ['', 'Start', 'W toku', 'Koniec'];
const stamp = (d, t) => [d, String(t || '').slice(0, 5)].filter((x) => String(x || '').trim()).join(' ');

/** Kolor statusu operacji jak w arkuszu: [tło, czcionka] albo null. */
export const statusColor = (st) => cellColor('ops', { K: st }, 'A');
export const SKIPPED_COLOR = ['#ff00ff', ''];

/** Operacje przewodnika z arkusza: jedna pozycja na numer – najwyższy status, start, koniec, operator ostatniego wpisu. */
export function opers(ops, nr = '') {
  const groups = new Map();
  for (const o of ops || []) { if (eq(o.status) === 'usunięta') continue; const k = eq(o.nr); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  return [...groups.entries()].sort((a, b) => (Number.isFinite(num(a[0])) ? num(a[0]) : 1e9) - (Number.isFinite(num(b[0])) ? num(b[0]) : 1e9)).map(([k, rows]) => {
    const best = rows.reduce((x, y) => (rank(y.status) > rank(x.status) ? y : x));
    const st = NAMES[rank(best.status)];
    const s = rows.find((o) => eq(o.status) === 'start'), e = [...rows].reverse().find((o) => eq(o.status) === 'koniec');
    return { nr: rows[0].nr, status: st, start: s ? stamp(s.date, s.time) : '', end: e ? stamp(e.date, e.time) : '', operator: String(rows[rows.length - 1].operator || '').split('@')[0], current: !!nr && k === eq(nr) };
  });
}

/**
 * Tabela operacji 10, 20, … n (n = ilość operacji z dokumentu × 10 albo najwyższy zapisany numer); pominięta – bez wpisów, a są wpisy dalszych.
 * [doc] – dokument przewodnika z arkusza ({ilosc, status, start, end, hours}) albo null.
 */
export function operTable(list, doc, nr = '') {
  const by = new Map();
  for (const o of list) { const n = num(o.nr); if (Number.isFinite(n)) by.set(Math.round(n), o); }
  const seen = [...by.entries()].filter(([, o]) => rank(o.status) > 0).map(([n]) => n);
  const maxSeen = seen.length ? Math.max(...seen) : 0;
  const ilosc = doc && Number.isFinite(num(doc.ilosc)) && num(doc.ilosc) > 0 ? Math.round(num(doc.ilosc)) : 0;
  const last = Math.max(ilosc * 10, Math.ceil(maxSeen / 10) * 10);
  const cur = Number.isFinite(num(nr)) ? Math.round(num(nr)) : null;
  const rows = [];
  for (let n = 10; n <= last; n += 10) {
    const o = by.get(n), st = o ? o.status : '';
    rows.push({ nr: n, status: st, start: o ? o.start : '', end: o ? o.end : '', operator: o ? o.operator : '', skipped: !st && seen.some((m) => m > n), current: n === cur });
  }
  const total = ilosc || rows.length, done = rows.filter((r) => rank(r.status) === 3).length;
  return { rows, done, total, progress: total ? done / total : null, skipped: rows.filter((r) => r.skipped).length };
}

/** Dokument przewodnika już zarejestrowany (komis + przewodnik, jak sprawdza serwer) – opis do komunikatu albo null. */
export function registered(docs, komis, przewodnik) {
  const d = (docs || []).find((x) => eq(x.komis) === eq(komis) && eq(x.nr) === eq(przewodnik));
  if (!d) return null;
  return `Dokument przewodnika ${d.nr} komisu ${d.komis} jest już zarejestrowany${d.archive ? ' (w archiwum)' : ''}: ${d.date} ${d.time}`
    + (d.kto ? `, ${d.kto}` : '') + (d.status ? `, status ${d.status}` : '') + '.';
}

/** Wykonane detale komisu: jeden wiersz na rysunek / pozycję / komplet (suma sztuk, do zrobienia, postęp, ostatni zapis). */
export function details(dreg, current) {
  const groups = new Map();
  const key = (r, p, k) => [r, p, k].map(looseKey).join('|');
  for (const d of dreg || []) { const k = key(d.rysunek, d.poz, d.kpl); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  const cur = current ? key(current.rysunek, current.pozycja, current.komplet) : null;
  return [...groups.entries()].map(([k, rows]) => {
    const last = rows[rows.length - 1];
    const done = rows.reduce((a, d) => a + (Number.isFinite(num(d.szt)) ? num(d.szt) : 0), 0);
    const todo = Number.isFinite(num(last.todo)) ? num(last.todo) : null;
    return { rysunek: last.rysunek, pozycja: last.poz, komplet: last.kpl, done, todo, progress: todo ? done / todo : null, last: stamp(last.date, last.time),
      color: cellColor('dreg', { J: todo || 0, K: done }, 'A'), current: k === cur };
  });
}

const sortKey = (date, time) => {
  const d = /^(\d{1,2})[.-](\d{1,2})[.-](\d{4})/.exec(date || ''), y = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  const k = d ? `${d[3]}${d[2].padStart(2, '0')}${d[1].padStart(2, '0')}` : y ? `${y[1]}${y[2]}${y[3]}` : String(date || '');
  return `${k} ${String(time || '').padStart(8, '0')}`;
};
/** Historia rejestrowania przewodnika: wszystkie wpisy (także „Usunięta” i z archiwum), od najstarszego. */
export const history = (ops) => (ops || []).map((o) => ({ date: o.date, time: String(o.time || '').slice(0, 5), nr: o.nr, status: o.status, who: String(o.operator || '').split('@')[0], archive: !!o.archive }))
  .sort((a, b) => (sortKey(a.date, a.time) < sortKey(b.date, b.time) ? -1 : sortKey(a.date, a.time) > sortKey(b.date, b.time) ? 1 : 0));

// ---------- celownik (kształt z logo: viewBox 200, moduł – belka i kółko, obroty 0/120/240°) ----------
const rot = (x, y, deg, c, k) => { const a = (deg * Math.PI) / 180, dx = x - 100, dy = y - 100; return [c[0] + k * (dx * Math.cos(a) - dy * Math.sin(a)), c[1] + k * (dx * Math.sin(a) + dy * Math.cos(a))]; };
/** Zewnętrzne narożniki trzech belek celownika o boku [size] na środku [c] – cały celownik leży na kodzie, gdy wszystkie są w kodzie. */
export const reticlePoints = (c, size) => [0, 120, 240].flatMap((d) => [rot(26, 154, d, c, size / 200), rot(174, 154, d, c, size / 200)]);
/** Punkt wewnątrz wypukłego wielokąta (narożniki kodu w kolejności obiegu). */
export function inside(poly, p) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const s = cr > 0 ? 1 : cr < 0 ? -1 : 0;
    if (s) { if (!sign) sign = s; else if (s !== sign) return false; }
  }
  return true;
}
/**
 * Wybór kodu przy kilku w kadrze: najpierw kod, na którym leży cały celownik, potem kod pod środkiem celownika, a jeden kod w kadrze – zawsze.
 * [codes] – [{ rawValue, corners: [[x, y]…] }], [size] – bok celownika (0 – bez celownika), [c] – środek widoku.
 */
export function pickCode(codes, c, size) {
  if (!codes.length) return null;
  if (!size) return codes[0];
  const pts = reticlePoints(c, size);
  return codes.find((b) => b.corners.length >= 3 && pts.every((p) => inside(b.corners, p)))
    || codes.find((b) => b.corners.length >= 3 && inside(b.corners, c)) || (codes.length === 1 ? codes[0] : null);
}

/** SVG celownika (logo): czerwony #BE1E2D, przy odczycie kodu – czerwona poświata. */
export function reticleSvg(size, glow) {
  const seg = '<g id="s"><polygon points="26,154 174,154 150,140 50,140"/><circle cx="72" cy="116" r="12"/></g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" style="overflow:visible${glow ? ';filter:drop-shadow(0 0 6px #ff1a1a) drop-shadow(0 0 12px #ff1a1a)' : ''}">`
    + `<defs>${seg}</defs><g fill="#BE1E2D" stroke="#BE1E2D" stroke-width="1.5"><use href="#s"/><use href="#s" transform="rotate(120 100 100)"/><use href="#s" transform="rotate(240 100 100)"/></g></svg>`;
}
