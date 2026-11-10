// Model danych Harmonogramu w bazie (Firestore) i budowa danych do wykresu.
//  - harm_ops/{chunk}: { ops: { "<lp>": {preds, client, komis, element, station, hours, startManual, endManual, wysylka, dostawa, status} } }
//    (operacje pogrupowane po 50 numerów, więc odczyt całości to kilkadziesiąt dokumentów, a zmiana to jedno pole)
//  - grafik/{RRRR-MM}: { days: { "RRRR-MM-DD": { "<nagłówek miejsca>": "a8" } } }   (tylko niepuste kody)
//  - config/main: { stations: [{name, bg, color}], holidays: ["RRRR-MM-DD"] }
import { stationHours, slotNumber, buildCapacity, computeSchedule, sortKey, compareKeys, DAY_MS } from './schedule.js';
import { parseDelimited } from './harmImport.js';

export const CHUNK = 50;
export const chunkId = (lp) => (/^\d+$/.test(String(lp)) ? 'c' + String(Math.floor(Number(lp) / CHUNK)).padStart(4, '0') : 'cx');

const p2 = (n) => String(n).padStart(2, '0');
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
export const fmtDt = (ms) => { if (ms == null) return ''; const d = new Date(ms); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };

// Kolory stanowisk (domyślne; można je zmienić w config/main).
export const DEFAULT_STATIONS = [
  { name: '1Si', bg: '#9fc5e8', color: '#000000' }, { name: '2Un', bg: '#b6d7a8', color: '#000000' }, { name: '3Co', bg: '#ffe599', color: '#000000' },
  { name: '5Śl', bg: '#ea9999', color: '#000000' }, { name: 'Do', bg: '#d9d2e9', color: '#000000' }, { name: 'Narz', bg: '#d9d9d9', color: '#000000' },
];

/** Plik graf_norm (wklejony/eksportowany tekst): A puste, B–G sumy, H data DD-MM-RRRR, od I kody miejsc pracy. */
export function parseGrafikText(text) {
  const rows = parseDelimited(text).filter((r) => r.length > 8);
  if (rows.length < 2) return { stations: [], days: [], warnings: ['Plik jest pusty albo ma za mało kolumn.'] };
  const head = rows[0].map((c) => String(c ?? '').trim());
  const stations = head.slice(1, 7).filter(Boolean);
  const slotCols = head.map((name, i) => ({ name, i })).filter((c) => c.i >= 8 && c.name);
  const days = [], warnings = [];
  for (const r of rows.slice(1)) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(r[7] ?? '').trim());
    if (!m) continue;
    const slots = {};
    for (const c of slotCols) { const v = String(r[c.i] ?? '').trim(); if (v) slots[c.name] = v; }
    days.push({ key: `${m[3]}-${m[2]}-${m[1]}`, slots });
  }
  if (!days.length) warnings.push('Nie znaleziono dni (oczekiwana data DD-MM-RRRR w kolumnie H).');
  return { stations, slotHeaders: slotCols.map((c) => c.name), days, warnings };
}

/** Dni → dokumenty miesięczne. */
export function grafikDocs(days) {
  const docs = {};
  for (const d of days) { const id = d.key.slice(0, 7); (docs[id] ||= { days: {} }).days[d.key] = d.slots; }
  return docs;
}

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

/**
 * Z operacji (mapa lp → operacja), dni grafiku i konfiguracji robi dane dla widoku Harmonogramu (ten sam kształt co z arkusza).
 * Zwraca też `result` (Map lp → {start, end, state}) do dalszych obliczeń.
 */
export function buildHarmData(opsByLp, daysByKey, cfg, nowMs) {
  const stations = (cfg && cfg.stations && cfg.stations.length) ? cfg.stations : DEFAULT_STATIONS;
  const look = Object.fromEntries(stations.map((s) => [s.name, s]));
  const list = Object.entries(opsByLp).map(([lp, o]) => ({ lp, ...o })).sort((a, b) => Number(a.lp) - Number(b.lp) || String(a.lp).localeCompare(b.lp));
  const capacity = capacityFrom(daysByKey, stations.map((s) => s.name));
  const result = computeSchedule(list, capacity);
  const keyed = list.map((o) => {
    const r = result.get(o.lp) || {};
    const zak = String(o.status || '').trim().toLowerCase() === 'zak.' || o.endManual != null ? 'zak.' : String(o.status || '');
    return { o, r, zak, key: sortKey({ station: o.station, element: o.element, zak }, r.start, 36500, nowMs) };
  });
  keyed.sort((a, b) => compareKeys(a.key, b.key));
  const rows = [];
  for (const { o, r, zak } of keyed) {
    const sl = look[o.station] || {};
    rows.push({
      lp: o.lp, z1: o.preds?.[0] || '', z2: o.preds?.[1] || '', z3: o.preds?.[2] || '', z4: o.preds?.[3] || '',
      komis: o.komis || '', element: o.element || '', stanowisko: o.station || '', godziny: o.hours == null ? '' : String(o.hours),
      start: fmtDt(r.start), koniec: fmtDt(r.end), startManual: fmtDt(o.startManual), dostawa: fmtDt(o.dostawa), wysylka: fmtDt(o.wysylka),
      zak, state: r.state, stanowiskoBg: sl.bg || '#cccccc', stanowiskoColor: sl.color || '#000000',
    });
  }
  return { rows, holidays: (cfg && cfg.holidays) || [], rapData: {}, result };
}
