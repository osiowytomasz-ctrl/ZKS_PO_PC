// Narzędziownia → Zniszczone: narzędzia ze stanem zużycia i ich historia z karty ZN („Osiągnięcia w dziedzinie użytkowania narzędzi – Ranking”).
// Karta ZN: wiersz 2 – nagłówki; od wiersza 3 wpisy: lp, Nr narz., procent zniszczenia, opis / cena / firma / oznaczenie (formuły z PSWT – program czyta wartości),
// kto / gdzie, data, data2 (rrrr.mm), kwota strat, opis zniszczeń, przyczyna. Jedno narzędzie może mieć kilka wpisów (historia). Czyste funkcje – testy: test/destroyed.test.js.
import { parseDate, naturalCompare } from './common.js';
import { normCode } from './tooltrack.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/\s+/g, ' ').trim();
/** Nagłówek → pole wpisu (po nazwie, żeby przesunięcie kolumn nie psuło odczytu); kolejność domyślna jak w arkuszu. */
const FIELDS = [['lp', /^lp/], ['code', /^nr narz/], ['pct', /^procent/], ['opis', /^opis narz/], ['cena', /^cena/], ['firma', /^firma/], ['mark', /^oznaczenie/], ['who', /^kto/], ['date', /^data$/], ['month', /^data2/], ['loss', /^kwota/], ['damage', /^opis zniszcz/], ['cause', /^przyczyna/]];
const DEFAULT_IDX = Object.fromEntries(FIELDS.map(([k], i) => [k, i]));

/** Liczba z tekstu („1 234,50 zł”, „100%”) albo null. */
export function parseNumber(v) {
  const t = String(v ?? '').replace(/\s| /g, '').replace(/[^0-9,.\-]/g, '').replace(',', '.');
  const n = t === '' || t === '-' || t === '.' ? NaN : Number(t);
  return Number.isFinite(n) ? n : null;
}
/** Indeksy kolumn pól z wiersza nagłówków (brak nagłówka – kolumna domyślna). */
export function columnMap(headerRow) {
  const m = {};
  (headerRow || []).forEach((t, i) => { const n = norm(t); for (const [k, re] of FIELDS) if (!(k in m) && re.test(n)) m[k] = i; });
  return { ...DEFAULT_IDX, ...m };
}
/**
 * Wpisy z wartości karty ZN: wiersz nagłówków = pierwszy z „Nr narz.” w kolumnie B w pierwszych 6 wierszach (inaczej wiersz 2); pominięte wiersze bez numeru narzędzia.
 * Wynik: [{ row (wiersz arkusza), lp, code, pct (0–100 albo null), opis, cena, firma, mark, who, date (tekst), ts (ms albo null), month, loss, damage, cause }].
 */
export function parseZn(values) {
  const v = values || [];
  let h = v.findIndex((r, i) => i < 6 && /^nr narz/.test(norm(r && r[1])));
  if (h < 0) h = 1;
  const m = columnMap(v[h]), out = [];
  for (let i = h + 1; i < v.length; i++) {
    const r = v[i] || [], g = (k) => String(r[m[k]] ?? '').trim(), code = g('code');
    if (!code) continue;
    const d = parseDate(g('date')), pct = parseNumber(g('pct'));
    out.push({ row: i + 1, lp: g('lp'), code, pct: pct == null ? null : Math.max(0, Math.min(100, pct)), opis: g('opis'), cena: g('cena'), firma: g('firma'), mark: g('mark'), who: g('who'),
      date: g('date'), ts: d ? d.getTime() : null, month: g('month'), loss: parseNumber(g('loss')), damage: g('damage'), cause: g('cause') });
  }
  return out;
}
/** Narzędzia z historią: grupy wpisów po numerze narzędzia, wpisy od najnowszego; pct = stan z najnowszego wpisu z procentem. */
export function groupByTool(entries) {
  const map = new Map();
  for (const e of entries || []) {
    const k = normCode(e.code);
    if (!map.has(k)) map.set(k, { key: k, code: e.code, entries: [] });
    map.get(k).entries.push(e);
  }
  const out = [];
  for (const g of map.values()) {
    g.entries.sort((a, b) => (b.ts ?? -1) - (a.ts ?? -1) || Number(b.row) - Number(a.row));
    const withPct = g.entries.find((e) => e.pct != null && e.pct > 0) || g.entries.find((e) => e.pct != null);
    const first = (f) => (g.entries.find((e) => e[f]) || {})[f] || '';
    Object.assign(g, { pct: withPct ? withPct.pct : null, maxPct: Math.max(-1, ...g.entries.map((e) => (e.pct == null ? -1 : e.pct))), lastTs: g.entries.reduce((a, e) => (e.ts != null && (a == null || e.ts > a) ? e.ts : a), null),
      loss: g.entries.reduce((a, e) => a + (e.loss || 0), 0), events: g.entries.length, opis: first('opis'), firma: first('firma'), mark: first('mark'), cena: first('cena'), who: [...new Set(g.entries.flatMap((e) => String(e.who).split(/\r?\n/)).map((s) => s.trim()).filter(Boolean))] });
    out.push(g);
  }
  return out;
}
export const SORTS = [['date', 'Ostatnia data (najnowsze)'], ['pct', 'Stan zużycia (największy)'], ['loss', 'Kwota strat (największa)'], ['events', 'Liczba wpisów'], ['code', 'Numer narzędzia']];
/** Sortowanie grup narzędzi. */
export function sortGroups(groups, mode = 'date', dir = 1) {
  const c = { date: (a, b) => (b.lastTs ?? -1) - (a.lastTs ?? -1), pct: (a, b) => (b.pct ?? -1) - (a.pct ?? -1), loss: (a, b) => b.loss - a.loss, events: (a, b) => b.events - a.events, code: (a, b) => naturalCompare(a.code, b.code) }[mode] || (() => 0);
  return groups.slice().sort((a, b) => dir * (c(a, b) || naturalCompare(a.code, b.code)));
}
/** Kolor paska zużycia: zielony do 40%, żółty do 70%, czerwony powyżej. */
export const wearColor = (p) => (p == null ? '#bdbdbd' : p < 40 ? '#00c853' : p < 70 ? '#ffd600' : '#d50000');
export const money = (n) => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł');
