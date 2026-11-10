// Model danych Harmonogramu w bazie (Firestore) i budowa danych do wykresu.
//  - harm_ops/{chunk}: { ops: { "<lp>": {preds, client, komis, element, station, hours, startManual, endManual, wysylka, dostawa, status} } }
//    (operacje pogrupowane po 50 numerów, więc odczyt całości to kilkadziesiąt dokumentów, a zmiana to jedno pole)
//  - Grafik NIE jest w bazie: program pobiera go z arkusza (karta graf_norm, API getGrafNorm) i liczy z niego godziny stanowisk.
//  - W bazie są wyłącznie suche dane tekstowe/liczbowe (bez kolorów i czcionek).
import { stationHours, slotNumber, buildCapacity, computeSchedule, sortKey, compareKeys, toSerial, DAY_MS } from './schedule.js';

export const HORIZON_DAYS = 417;   // komórka S12 arkusza: operacje startujące dalej niż tyle dni od dziś trafiają za stanowiska

export const CHUNK = 50;
export const chunkId = (lp) => {
  const t = String(lp);
  if (/^\d+$/.test(t)) return 'c' + String(Math.floor(Number(t) / CHUNK)).padStart(4, '0');
  const m = /^s(\d+)$/.exec(t);          // numer techniczny operacji bez numeru w arkuszu: s<wiersz>
  return m ? 's' + String(Math.floor(Number(m[1]) / CHUNK)).padStart(4, '0') : 'cx';
};

const p2 = (n) => String(n).padStart(2, '0');
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
export const fmtDt = (ms) => { if (ms == null) return ''; const d = new Date(ms); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };

// Kolory stanowisk (domyślne; można je zmienić w config/main).
export const DEFAULT_STATIONS = [
  { name: '1Si', bg: '#9fc5e8', color: '#000000' }, { name: '2Un', bg: '#b6d7a8', color: '#000000' }, { name: '3Co', bg: '#ffe599', color: '#000000' },
  { name: '5Śl', bg: '#ea9999', color: '#000000' }, { name: 'Do', bg: '#d9d2e9', color: '#000000' }, { name: 'Narz', bg: '#d9d9d9', color: '#000000' },
];

/**
 * Grafik z karty graf_norm (odpowiedź API getGrafNorm): header = nagłówki od kolumny H (pierwszy pusty = data), rows = dni
 * (pierwsza komórka = data DD-MM-RRRR, dalej kody miejsc pracy). Zwraca dni i nazwy stanowisk.
 */
export function parseGrafik(g) {
  const header = (g && g.header || []).map((c) => String(c ?? '').trim());
  const days = [];
  for (const r of (g && g.rows) || []) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(r[0] ?? '').trim());
    if (!m) continue;
    const slots = {};
    for (let i = 1; i < header.length; i++) { const v = String(r[i] ?? '').trim(); if (v && header[i]) slots[header[i]] = v; }
    days.push({ key: `${m[3]}-${m[2]}-${m[1]}`, slots });
  }
  return { stations: ((g && g.stations) || []).map((x) => String(x ?? '').trim()).filter(Boolean), days };
}
export const daysByKeyOf = (parsed) => Object.fromEntries(parsed.days.map((d) => [d.key, d.slots]));

/** Pojemność każdego stanowiska z kodów miejsc pracy: { stanowisko: buildCapacity(...) }. `daysByKey`: { "RRRR-MM-DD": {nagłówek: kod} }. */
export function capacityFrom(daysByKey, stationNames) {
  const keys = Object.keys(daysByKey).sort();
  const out = {};
  for (const st of stationNames) {
    const list = keys.map((k) => {
      const slots = daysByKey[k], codes = Array(9).fill('');
      for (const [header, code] of Object.entries(slots)) { const n = slotNumber(header, st); if (n) codes[n - 1] = code; }
      const [y, mo, d] = k.split('-').map(Number);
      return { date: Date.UTC(y, mo - 1, d), hours: stationHours(st, codes) };
    });
    out[st] = buildCapacity(list);
  }
  return out;
}

/** Klucz „Stat.” z kolumny S: „00Zak” dla zakończonych, stanowisko + numer seryjny startu w horyzoncie, w pozostałych „0ZZ” (+ „Z” bez opisu). */
export function statKey(o, r, key) {
  if (key.group === 0) return '00Zak';
  if (key.group === 2) return String(o.station) + String(Number(toSerial(r.start).toFixed(10))).replace('.', ',');
  return '0ZZ' + (String(o.element ?? '').trim() ? '' : 'Z');
}

/**
 * Z operacji (mapa lp → operacja), dni grafiku i konfiguracji robi dane dla widoku Harmonogramu (ten sam kształt co z arkusza).
 * Zwraca też `result` (Map lp → {start, end, state}) do dalszych obliczeń.
 */
export function buildHarmData(opsByLp, daysByKey, cfg, nowMs) {
  const stations = DEFAULT_STATIONS;   // kolory i czcionki nie są w bazie (ustalimy później); tu tylko domyślne wyświetlanie
  const look = Object.fromEntries(stations.map((s) => [s.name, s]));
  const list = Object.entries(opsByLp).map(([lp, o]) => ({ lp, ...o })).sort((a, b) => Number(a.lp) - Number(b.lp) || String(a.lp).localeCompare(b.lp));
  const names = [...new Set([...stations.map((s) => s.name), ...list.map((o) => o.station).filter(Boolean)])];
  const capacity = capacityFrom(daysByKey, names);
  const result = computeSchedule(list, capacity);
  const keyed = list.map((o) => {
    const r = result.get(o.lp) || {};
    const zak = String(o.status || '').trim().toLowerCase() === 'zak.' ? 'zak.' : String(o.status || '');
    return { o, r, zak, key: sortKey({ station: o.station, element: o.element, zak }, r.start, HORIZON_DAYS, nowMs) };
  });
  keyed.sort((a, b) => compareKeys(a.key, b.key));
  const rows = [];
  for (const { o, r, zak, key } of keyed) {
    const sl = look[o.station] || {};
    rows.push({
      id: o.lp, hours: o.hours == null ? '' : String(o.hours), station: o.station || '', client: o.client || '', status: o.status || '', endManual: fmtDt(o.endManual), key: statKey(o, r, key),
      lp: /^s\d+$/.test(o.lp) ? '' : o.lp, z1: o.preds?.[0] || '', z2: o.preds?.[1] || '', z3: o.preds?.[2] || '', z4: o.preds?.[3] || '',
      komis: o.komis || '', element: o.element || '', stanowisko: o.station || '', godziny: o.hours == null ? '' : String(o.hours),
      start: fmtDt(r.start), koniec: fmtDt(r.end), startManual: fmtDt(o.startManual), dostawa: fmtDt(o.dostawa), wysylka: fmtDt(o.wysylka),
      zak, state: r.state, stanowiskoBg: sl.bg || '#cccccc', stanowiskoColor: sl.color || '#000000',
    });
  }
  return { rows, holidays: [], rapData: {}, result };
}
