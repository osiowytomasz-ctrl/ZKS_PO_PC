// Model danych Harmonogramu w bazie (Firestore) i budowa danych do wykresu.
//  - harm_ops/{chunk}: { ops: { "<lp>": {preds, client, komis, element, station, hours, startManual, endManual, wysylka, dostawa, status} } }
//    (operacje pogrupowane po 50 numerów, więc odczyt całości to kilkadziesiąt dokumentów, a zmiana to jedno pole)
//  - Grafik NIE jest w bazie: program pobiera go z arkusza (karta graf_norm, API getGrafNorm) i liczy z niego godziny stanowisk.
//  - config/main: { stations: [{name, bg, color}] } – tylko zmiany użytkownika (kolory stanowisk i dodane stanowiska); domyślne są w kodzie.
import { stationHours, slotNumber, buildCapacity, computeSchedule, sortKey, compareKeys, toSerial, DAY_MS } from './schedule.js';

export const HORIZON_DAYS = 417;   // komórka S12 arkusza: operacje startujące dalej niż tyle dni od dziś trafiają za stanowiska

export const CHUNK = 50;
/** Numer operacji (lp.) może mieć litery, cyfry, „_” i „-” (1–20 znaków). Numery „s<cyfry>” są techniczne (operacje bez numeru w arkuszu). */
export const ID_PATTERN = /^[\p{L}\p{N}_-]{1,20}$/u;
export const isSyntheticId = (id) => /^s\d+$/.test(String(id));

/** Porządek numerów: liczby rosnąco, potem numery z literami (naturalnie, bez wielkości liter), na końcu techniczne „s…”. */
export function lpCompare(a, b) {
  a = String(a); b = String(b);
  const rank = (x) => (/^\d+$/.test(x) ? 0 : isSyntheticId(x) ? 2 : 1);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return Number(a) - Number(b);
  return a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
}

/** Powód, dla którego [id] nie nadaje się na nowy numer operacji (null = można). [existing] to obiekt operacji (klucze = numery). */
export function idError(id, existing, { ignore } = {}) {
  const t = String(id ?? '').trim();
  if (!t) return 'Numer operacji nie może być pusty';
  if (!ID_PATTERN.test(t)) return 'Numer operacji: litery, cyfry, „_” lub „-” (do 20 znaków, bez spacji i kropek)';
  if (isSyntheticId(t)) return 'Numery „s” + cyfry są zarezerwowane dla operacji bez numeru';
  if (t !== ignore && existing[t]) return `Operacja o numerze ${t} już istnieje`;
  return null;
}

/** Zmiana numeru: nowy klucz, usunięcie starego i poprawienie poprzedników we wszystkich operacjach, które się do niego odwołują. */
export function renamePlan(opsByLp, oldId, newId) {
  const err = idError(newId, opsByLp, { ignore: oldId });
  if (err) return { error: err };
  if (!opsByLp[oldId]) return { error: `Operacja ${oldId} nie istnieje` };
  const neu = String(newId).trim();
  if (neu === oldId) return { error: null, same: true };
  const referrers = [];
  for (const [lp, op] of Object.entries(opsByLp)) if ((op.preds || []).includes(oldId)) referrers.push([lp, op.preds.map((p) => (p === oldId ? neu : p))]);
  return { error: null, oldId, newId: neu, op: opsByLp[oldId], referrers };
}

const hashLp = (t) => { let h = 7; for (const ch of t) h = (h * 31 + ch.codePointAt(0)) % 1000003; return h; };

/** Dokument z operacjami: numery po 50 (c0000…), techniczne „s…” osobno, numery z literami rozproszone po 20 dokumentach (x00…x19). */
export const chunkId = (lp) => {
  const t = String(lp);
  if (/^\d+$/.test(t)) return 'c' + String(Math.floor(Number(t) / CHUNK)).padStart(4, '0');
  const m = /^s(\d+)$/.exec(t);
  if (m) return 's' + String(Math.floor(Number(m[1]) / CHUNK)).padStart(4, '0');
  return 'x' + String(hashLp(t) % 20).padStart(2, '0');
};

const p2 = (n) => String(n).padStart(2, '0');
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
export const fmtDt = (ms) => { if (ms == null) return ''; const d = new Date(ms); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };

// Kolory stanowisk (domyślne; można je zmienić w config/main).
export const DEFAULT_STATIONS = [
  { name: '1Si', bg: '#0070c0', color: '#ffffff' }, { name: '2Un', bg: '#00b0f0', color: '#000000' }, { name: '3Co', bg: '#ffc000', color: '#000000' },
  { name: '5Śl', bg: '#92d050', color: '#000000' }, { name: 'Do', bg: '#d9d2e9', color: '#000000' }, { name: 'Narz', bg: '#bfbfbf', color: '#000000' },
];
export const FALLBACK_STATION = { bg: '#cccccc', color: '#000000' };
/** Stanowiska: domyślne (kolory ze zrzutu arkusza) nadpisane ustawieniami z bazy (cfg.stations) + stanowiska dodane przez użytkownika. */
export function stationList(cfg) {
  const over = new Map(((cfg && cfg.stations) || []).filter((x) => x && x.name).map((x) => [x.name, x]));
  const list = DEFAULT_STATIONS.map((d) => ({ ...d, ...(over.get(d.name) || {}), builtin: true, custom: over.has(d.name) }));
  for (const [name, x] of over) if (!DEFAULT_STATIONS.some((d) => d.name === name)) list.push({ name, bg: x.bg || FALLBACK_STATION.bg, color: x.color || FALLBACK_STATION.color, sum: !!x.sum, builtin: false, custom: true });
  return list;
}

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
export function capacityFrom(daysByKey, stationNames, sumStations) {
  const keys = Object.keys(daysByKey).sort();
  const out = {};
  for (const st of stationNames) {
    const list = keys.map((k) => {
      const slots = daysByKey[k], codes = Array(9).fill('');
      for (const [header, code] of Object.entries(slots)) { const n = slotNumber(header, st); if (n) codes[n - 1] = code; }
      const [y, mo, d] = k.split('-').map(Number);
      return { date: Date.UTC(y, mo - 1, d), hours: stationHours(st, codes, sumStations && sumStations.has(st) ? true : undefined) };
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
  const stations = stationList(cfg);
  const look = Object.fromEntries(stations.map((s) => [s.name, s]));
  const list = Object.entries(opsByLp).map(([lp, o]) => ({ lp, ...o })).sort((a, b) => lpCompare(a.lp, b.lp));
  const names = [...new Set([...stations.map((s) => s.name), ...list.map((o) => o.station).filter(Boolean)])];
  const capacity = capacityFrom(daysByKey, names, new Set(stations.filter((x) => x.sum).map((x) => x.name)));
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
      lp: isSyntheticId(o.lp) ? '' : o.lp, z1: o.preds?.[0] || '', z2: o.preds?.[1] || '', z3: o.preds?.[2] || '', z4: o.preds?.[3] || '',
      komis: o.komis || '', element: o.element || '', stanowisko: o.station || '', godziny: o.hours == null ? '' : String(o.hours),
      start: fmtDt(r.start), koniec: fmtDt(r.end), startManual: fmtDt(o.startManual), dostawa: fmtDt(o.dostawa), wysylka: fmtDt(o.wysylka),
      zak, state: r.state, stanowiskoBg: sl.bg || '#cccccc', stanowiskoColor: sl.color || '#000000',
    });
  }
  return { rows, holidays: [], rapData: {}, result };
}

// ---------------------------------------------------------------------------------------------------------------------
// Powiązania (poprzednicy) i dodawanie operacji: reguły bezpieczeństwa, żeby nie powstał cykl ani duplikat
// ---------------------------------------------------------------------------------------------------------------------

/** Operacje zależne (bezpośrednio lub pośrednio) od [id], razem z nim samym: nie mogą być jego poprzednikami (powstałby cykl). */
export function dependents(opsByLp, id) {
  const children = new Map();
  for (const [lp, op] of Object.entries(opsByLp)) for (const p of op.preds || []) { if (!children.has(p)) children.set(p, []); children.get(p).push(lp); }
  const seen = new Set([String(id)]), stack = [String(id)];
  while (stack.length) for (const c of children.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); stack.push(c); }
  return seen;
}

/** Dlaczego operacja [pred] nie może być poprzednikiem [id] w pozycji [slot] (null = można). */
export function predError(opsByLp, id, slot, pred) {
  const p = String(pred ?? '').trim();
  if (!p) return null;                                                   // puste = brak powiązania
  if (!opsByLp[p]) return `Operacja ${p} nie istnieje`;
  if (p === String(id)) return 'Operacja nie może być swoim poprzednikiem';
  if (dependents(opsByLp, id).has(p)) return `Operacja ${p} zależy od tej operacji, powiązanie utworzyłoby cykl`;
  const others = (opsByLp[id]?.preds || []).filter((_, i) => i !== slot);
  if (others.includes(p)) return `Operacja ${p} jest już wpisana jako inny poprzednik`;
  return null;
}

/** Operacje, które można wybrać jako poprzednika w pozycji [slot]: bez samej siebie, zależnych od niej i już użytych. Posortowane po numerze. */
export function predecessorChoices(opsByLp, id, slot) {
  return Object.keys(opsByLp).filter((lp) => predError(opsByLp, id, slot, lp) === null).sort(lpCompare);
}

/**
 * Walidacja wielu nowych operacji naraz (tabela do wpisywania). [rows]: [{lp, client, komis, element, station, hours, wysylka, dostawa}] jako teksty.
 * Puste wiersze (bez komisu, opisu, stanowiska, klienta, czasu i dat) są pomijane. Zwraca {ops: [[lp, op]], errors: [teksty]}.
 * Numery nie mogą się powtarzać ani z bazą, ani między wierszami tabeli.
 */
export function validateNewOps(rows, existing, parseDate, parseNum) {
  const ops = [], errors = [], seen = new Set();
  rows.forEach((r, i) => {
    const v = (k) => String(r[k] ?? '').trim();
    const filled = ['client', 'komis', 'element', 'station', 'hours', 'wysylka', 'dostawa'].some((k) => v(k));
    if (!filled) return;
    const n = i + 1, lp = v('lp');
    const idErr = idError(lp, existing);
    if (idErr) { errors.push(`Wiersz ${n}: ${idErr}`); return; }
    if (seen.has(lp)) { errors.push(`Wiersz ${n}: numer ${lp} powtórzony w tabeli`); return; }
    seen.add(lp);
    const op = { preds: [], client: v('client'), komis: v('komis'), element: v('element'), station: v('station') };
    if (v('hours')) { const h = parseNum(v('hours')); if (h == null || h < 0) { errors.push(`Wiersz ${n}: czas to liczba godzin`); return; } op.hours = h; }
    for (const k of ['wysylka', 'dostawa']) if (v(k)) { const d = parseDate(v(k)); if (d == null) { errors.push(`Wiersz ${n}: nie rozpoznano daty „${v(k)}” (${k === 'wysylka' ? 'zakończenie' : 'dostawa'})`); return; } op[k] = d; }
    ops.push([lp, op]);
  });
  if (!ops.length && !errors.length) errors.push('Wpisz przynajmniej jedną operację');
  return { ops, errors };
}
