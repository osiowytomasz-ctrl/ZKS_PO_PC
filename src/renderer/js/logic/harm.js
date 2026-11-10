// Reguły Harmonogramu (odpowiednik HarmLogic.kt). Czasy jako liczby milisekund (czas lokalny jako UTC, bez stref).
import { parseDate as parseD, naturalCompare } from './common.js';

const HOUR = 3600000;
export const parseDate = (v) => parseD(v);
const ms = (d) => d.getTime();
const hoursBetween = (a, b) => (ms(b) - ms(a)) / HOUR;

export function shortDate(value) {
  const d = parseDate(value);
  if (!d) return value;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCFullYear() % 100)} ${p(d.getUTCHours())}`;
}
export const dayLabel = (d) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

/** 'work' | 'sat' | 'sun' (niedziela lub święto). */
export function dayKind(date, holidays) {
  const key = date.toISOString().slice(0, 10);
  const dow = date.getUTCDay();
  if (holidays.has(key) || dow === 0) return 'sun';
  if (dow === 6) return 'sat';
  return 'work';
}
export function holidaySet(raw) {
  const s = new Set();
  for (const r of raw || []) { const d = parseDate(r); if (d) s.add(d.toISOString().slice(0, 10)); }
  return s;
}

/** Jak JS parseFloat po zamianie przecinka na kropkę. */
export function parseHours(text) {
  const m = /^\s*[-+]?\d+(?:\.\d+)?/.exec(String(text ?? '').replace(',', '.'));
  return m ? parseFloat(m[0]) : 0;
}

export const emptySorts = () => ({ komis: null, start: null, station: null });
export function cycleSort(sorts, field) {
  const cur = sorts[field];
  const next = cur === null ? 'asc' : cur === 'asc' ? 'desc' : null;
  return { ...sorts, [field]: next };
}

export function filterRows(rows, filters) {
  return rows.filter((r) => (!filters.komis.size || filters.komis.has(r.komis)) && (!filters.station.size || filters.station.has(r.stanowisko)));
}

const coll = new Intl.Collator('pl');
export function sortRows(rows, sorts) {
  const cmps = [];
  const dir = (d, f) => (a, b) => (d === 'asc' ? f(a, b) : -f(a, b));
  if (sorts.komis) cmps.push(dir(sorts.komis, (a, b) => naturalCompare(a.komis, b.komis)));
  if (sorts.start) cmps.push(dir(sorts.start, (a, b) => ((parseDate(a.start)?.getTime() ?? 0) - (parseDate(b.start)?.getTime() ?? 0))));
  if (sorts.station) cmps.push(dir(sorts.station, (a, b) => coll.compare(a.stanowisko, b.stanowisko)));
  if (!cmps.length) return rows;
  return rows.map((r, i) => [r, i]).sort((x, y) => { for (const c of cmps) { const v = c(x[0], y[0]); if (v) return v; } return x[1] - y[1]; }).map((e) => e[0]);
}

function delivery(axisStart, row, end) {
  const dostawa = parseDate(row.dostawa);
  const wysylka = parseDate(row.wysylka);
  const h = (t) => hoursBetween(axisStart, t);
  if (!dostawa && !wysylka) return [];
  if (!dostawa) {
    if (!(ms(end) > ms(wysylka))) return [];
    return [{ left: Math.max(0, h(wysylka)), width: h(end) - h(wysylka), kind: 'red' }];
  }
  const dl = Math.max(0, h(dostawa));
  if (!wysylka) return [{ left: dl, width: h(end) - h(dostawa), kind: 'green' }];
  const wl = Math.max(0, h(wysylka));
  const segs = [{ left: dl, width: wl - dl, kind: 'green' }];
  if (ms(end) > ms(wysylka)) segs.push({ left: wl, width: h(end) - h(wysylka), kind: 'red' });
  return segs;
}

/** Składa dane do wykresu; `now` to Date (czas lokalny przekazany jako UTC). */
export function buildChart(data, filters, sorts, daysBack, now, opts = {}) {
  const axisStart = new Date(Math.floor(ms(now) / HOUR) * HOUR - Math.max(0, daysBack) * 24 * HOUR);
  const parsed = [];
  for (const row of sortRows(filterRows(data.rows || [], filters), sorts)) {
    const s = parseDate(row.start), e = parseDate(row.koniec);
    if (s && e && !(ms(e) < ms(axisStart))) parsed.push({ row, s, e });
    else if (opts.keepAll) parsed.push({ row, s: null, e: null });   // widok klasyczny: każdy wiersz jest w tabeli, nawet bez paska
  }
  const planSums = new Map();
  for (const { row } of parsed) {
    const key = String(row.komis).trim() + '||' + String(row.stanowisko).trim();
    planSums.set(key, (planSums.get(key) || 0) + parseHours(row.godziny));
  }
  const items = parsed.map(({ row, s, e }) => {
    if (!s) return { row, start: null, end: null, startHours: 0, durationHours: 0, endHours: 0, pct: null, delivery: [], noBar: true };
    const komis = String(row.komis).trim(), station = String(row.stanowisko).trim();
    const plan = planSums.get(komis + '||' + station) || 0;
    let pct = null;
    if (plan > 0) pct = Math.round(((((data.rapData || {})[komis] || {})[station] || 0) / plan) * 100);
    const cs = ms(s) < ms(axisStart) ? axisStart : s;
    return { row, start: s, end: e, startHours: Math.max(0, hoursBetween(axisStart, cs)), durationHours: Math.max(1, hoursBetween(cs, e)),
      endHours: Math.max(0, hoursBetween(axisStart, e)), pct, delivery: delivery(axisStart, row, e) };
  });
  const dated = parsed.filter((p) => p.s);
  const maxEnd = dated.length ? new Date(Math.max(...dated.map((p) => ms(p.e)))) : axisStart;
  const totalDays = Math.max(7, Math.ceil(hoursBetween(axisStart, maxEnd) / 24) + 2);
  const nextDay = new Date(Date.UTC(axisStart.getUTCFullYear(), axisStart.getUTCMonth(), axisStart.getUTCDate() + 1));
  const lpIndex = new Map();
  items.forEach((it, i) => { const lp = String(it.row.lp).trim(); if (lp) lpIndex.set(lp, i); });
  const deps = [];
  items.forEach((it, to) => {
    for (const z of [it.row.z1, it.row.z2, it.row.z3, it.row.z4].map((x) => String(x ?? '').trim()).filter(Boolean)) {
      if (lpIndex.has(z)) { const from = lpIndex.get(z); if (!items[from].noBar && !it.noBar) deps.push({ from, to, x: items[from].endHours }); }
    }
  });
  return { axisStart, items, totalDays, firstDayHours: hoursBetween(axisStart, nextDay), deps };
}

export const filterOptions = (values) => [...new Set(values.filter((v) => v !== ''))].sort(naturalCompare);

/** „Teraz” jako Date z lokalnym czasem zapisanym jak UTC (zgodnie z parseDate). */
export function localNow() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
}
