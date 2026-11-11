// Model danych Harmonogramu w bazie (Firestore) i budowa danych do wykresu.
//  - harm_ops/{chunk}: { ops: { "<lp>": {preds, client, komis, element, station, hours, startManual, endManual, wysylka, dostawa, status} } }
//    (operacje pogrupowane po 50 numerów, więc odczyt całości to kilkadziesiąt dokumentów, a zmiana to jedno pole)
//  - Grafik NIE jest w bazie: program pobiera go z arkusza (karta graf_norm, API getGrafNorm) i liczy z niego godziny stanowisk.
//  - config/main: { stations: [{name, bg, color}] } – tylko zmiany użytkownika (kolory stanowisk i dodane stanowiska); domyślne są w kodzie.
import { stationHours, slotNumber, buildCapacity, computeSchedule, sortKey, compareKeys, toSerial, subParent, DAY_MS } from './schedule.js';

export const HORIZON_DAYS = 417;   // komórka S12 arkusza: operacje startujące dalej niż tyle dni od dziś trafiają za stanowiska

export const CHUNK = 50;
/**
 * Numer operacji: liczba = operacja główna (np. 3000); liczba + litery = suboperacja tej operacji (np. 3000a, 3000b).
 * Numery „s<cyfry>” są techniczne (operacje bez numeru w arkuszu) i nie można ich wpisać ręcznie.
 */
export const ID_PATTERN = /^\d{1,15}\p{L}{0,3}$/u;
export const isSyntheticId = (id) => /^s\d+$/.test(String(id));
export { subParent };
/** Czy numer ma postać suboperacji (liczba + litery), niezależnie od tego, czy operacja główna istnieje. */
export const isSubId = (id) => subParent(id) != null;

/** Porządek numerów: liczba rosnąco, przy tej samej liczbie najpierw operacja główna, potem suboperacje (a, b, …); techniczne „s…” na końcu. */
export function lpCompare(a, b) {
  a = String(a); b = String(b);
  const parse = (x) => { const m = /^(\d+)(\p{L}*)$/u.exec(x); return m ? { n: BigInt(m[1]), suf: m[2] } : null; };
  const pa = parse(a), pb = parse(b);
  if (pa && pb) return pa.n === pb.n ? pa.suf.localeCompare(pb.suf, 'pl', { numeric: true, sensitivity: 'base' }) : (pa.n < pb.n ? -1 : 1);
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
}

/**
 * Powód, dla którego [id] nie nadaje się na nowy numer operacji (null = można). [existing] to obiekt operacji (klucze = numery),
 * [pending] – numery operacji głównych dodawanych jednocześnie (np. w tej samej tabeli). Suboperacja wymaga istniejącej operacji głównej.
 */
export function idError(id, existing, { ignore, pending } = {}) {
  const t = String(id ?? '').trim();
  if (!t) return 'Numer operacji nie może być pusty';
  if (isSyntheticId(t)) return 'Numery „s” + cyfry są zarezerwowane dla operacji bez numeru';
  if (!ID_PATTERN.test(t)) return 'Numer operacji: liczba (operacja główna, np. 3000) albo liczba + litera (suboperacja, np. 3000a)';
  if (t !== ignore && existing[t]) return `Operacja o numerze ${t} już istnieje`;
  const parent = subParent(t);
  if (parent && !(existing[parent] && parent !== ignore) && !(pending && pending.has(parent))) return `Suboperacja ${t} wymaga istniejącej operacji głównej ${parent}`;
  return null;
}

/** Suboperacje operacji głównej [id] (numery), w kolejności a, b, … */
export function subOps(opsByLp, id) {
  return Object.keys(opsByLp).filter((lp) => subParent(lp) === String(id)).sort(lpCompare);
}

/**
 * Zmiana numeru: nowy klucz, usunięcie starego i poprawienie poprzedników we wszystkich operacjach, które się do niego odwołują.
 * Zmiana numeru operacji głównej przenosi razem z nią jej suboperacje (3000a → 3001a). Wynik: {moves: [{oldId, newId, op}], referrers: [[lp, preds]]}.
 */
export function renamePlan(opsByLp, oldId, newId) {
  const neu = String(newId ?? '').trim();
  if (!opsByLp[oldId]) return { error: `Operacja ${oldId} nie istnieje` };
  const err = idError(neu, opsByLp, { ignore: oldId });
  if (err) return { error: err };
  if (neu === oldId) return { error: null, same: true };
  const idMap = new Map([[oldId, neu]]);
  if (/^\d+$/.test(oldId)) {
    const subs = subOps(opsByLp, oldId);
    if (/^\d+$/.test(neu)) {
      for (const sub of subs) {                                  // operacja główna zabiera swoje suboperacje pod nowy numer
        const target = neu + sub.slice(oldId.length);
        if (opsByLp[target]) return { error: `Nie można przenieść suboperacji ${sub}: numer ${target} już istnieje` };
        idMap.set(sub, target);
      }
    } else if (subs.length) {                                    // operacja główna → suboperacja innej operacji: tylko gdy sama nie ma suboperacji
      return { error: `Operacja ${oldId} ma suboperacje (${subs.join(', ')}); najpierw zmień ich numery albo je usuń` };
    }
  }
  const fix = (preds) => (preds || []).map((p) => idMap.get(p) ?? p);
  const moves = [...idMap].map(([from, to]) => ({ oldId: from, newId: to, op: { ...opsByLp[from], preds: fix(opsByLp[from].preds) } }));
  const referrers = [];
  for (const [lp, op] of Object.entries(opsByLp)) if (!idMap.has(lp) && (op.preds || []).some((p) => idMap.has(p))) referrers.push([lp, fix(op.preds)]);
  // Po zmianie numeru operacja może trafić pod inną operację główną (albo spod niej wyjść), więc sprawdzamy, czy powiązania nie utworzą cyklu.
  const newParent = subParent(neu);
  if (newParent && (opsByLp[oldId].preds || []).includes(newParent)) return { error: `Operacja ${oldId} zależy od ${newParent}, która byłaby jej operacją główną; usuń najpierw to powiązanie` };
  const sim = { ...opsByLp };
  for (const m of moves) delete sim[m.oldId];
  for (const m of moves) sim[m.newId] = m.op;
  for (const [lp, preds] of referrers) sim[lp] = { ...sim[lp], preds };
  const cyclesOf = (ops) => new Set([...computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), {})].filter(([, r]) => r.state === 'cycle').map(([lp]) => lp));
  const before = cyclesOf(opsByLp), after = cyclesOf(sim);
  const fresh = [...after].filter((lp) => !before.has([...idMap].find(([, to]) => to === lp)?.[0] ?? lp));
  if (fresh.length) return { error: `Zmiana numeru utworzyłaby cykl zależności (operacje: ${fresh.slice(0, 5).join(', ')}); popraw najpierw powiązania` };
  return { error: null, oldId, newId: neu, op: moves[0].op, moves, referrers };
}

const hashLp = (t) => { let h = 7; for (const ch of t) h = (h * 31 + ch.codePointAt(0)) % 1000003; return h; };

/** Dokument z operacjami: numery po 50 (c0000…), suboperacje razem z operacją główną, techniczne „s…” osobno, pozostałe rozproszone po x00…x19. */
export const chunkId = (lp) => {
  const t = String(lp);
  if (/^\d+$/.test(t)) return 'c' + String(Math.floor(Number(t) / CHUNK)).padStart(4, '0');
  const sp = subParent(t);
  if (sp) return 'c' + String(Math.floor(Number(sp) / CHUNK)).padStart(4, '0');
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
/** Wiersze po filtrach i sortowaniu: suboperacje układają się chronologicznie razem z pozostałymi; znikają tylko wtedy, gdy ich operacja główna jest zwinięta. */
export function arrangeRows(rows, collapsed) {
  if (!collapsed || !collapsed.size) return rows;
  return rows.filter((r) => !(r.sub && collapsed.has(r.parent)));
}

/** Odcinki paska operacji głównej złożonej z suboperacji (bez własnego czasu): [[start, koniec], …] w ms; puste, gdy pasek ma być ciągły. */
function segsOf(o, kidIds, opsByLp, result) {
  if (!kidIds.length || o.hours > 0) return [];
  return kidIds.map((k) => result.get(k)).filter((r) => r && r.start != null && r.end != null).map((r) => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
}

export function buildHarmData(opsByLp, daysByKey, cfg, nowMs) {
  const stations = stationList(cfg);
  const look = Object.fromEntries(stations.map((s) => [s.name, s]));
  const list = Object.entries(opsByLp).map(([lp, o]) => ({ lp, ...o })).sort((a, b) => lpCompare(a.lp, b.lp));
  const names = [...new Set([...stations.map((s) => s.name), ...list.map((o) => o.station).filter(Boolean)])];
  const capacity = capacityFrom(daysByKey, names, new Set(stations.filter((x) => x.sum).map((x) => x.name)));
  const result = computeSchedule(list, capacity);
  const parentOf = (lp) => { const p = subParent(lp); return p && opsByLp[p] ? p : null; };
  const kids = new Map();
  for (const lp of Object.keys(opsByLp)) { const p = parentOf(lp); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(lp); } }
  for (const l of kids.values()) l.sort(lpCompare);
  const keyed = list.map((o) => {
    const r = result.get(o.lp) || {};
    const zak = String(o.status || '').trim().toLowerCase() === 'zak.' ? 'zak.' : String(o.status || '');
    const po = parentOf(o.lp) ? opsByLp[parentOf(o.lp)] : null;
    return { o, r, zak, key: sortKey({ station: o.station || (po && po.station) || '', element: o.element, zak }, r.start, HORIZON_DAYS, nowMs) };   // suboperacja sortuje się po stanowisku (własnym albo operacji głównej) i starcie, jak każda inna
  });
  const ordered = keyed.slice().sort((a, b) => compareKeys(a.key, b.key));
  const rows = [];
  for (const { o, r, zak, key } of ordered) {
    const par = parentOf(o.lp), po = par ? opsByLp[par] : null;
    const sl = look[o.station || (po && po.station)] || {};
    const myKids = kids.get(o.lp) || [];
    const sum = myKids.reduce((t, c) => t + (opsByLp[c].hours > 0 ? opsByLp[c].hours : 0), 0);
    const hoursShown = o.hours > 0 ? String(o.hours) : (myKids.length && sum > 0 ? `Σ${sum}` : (o.hours == null ? '' : String(o.hours)));
    rows.push({
      id: o.lp, sub: !!par, parent: par, subCount: myKids.length, hours: o.hours == null ? '' : String(o.hours), hoursShown,
      station: o.station || (po && po.station) || '', client: o.client || (po && po.client) || '', status: o.status || '', endManual: fmtDt(o.endManual), key: statKey(o, r, key),
      lp: isSyntheticId(o.lp) ? '' : o.lp, z1: o.preds?.[0] || '', z2: o.preds?.[1] || '', z3: o.preds?.[2] || '', z4: o.preds?.[3] || '',
      komis: o.komis || (po && po.komis) || '', element: o.element || '', stanowisko: o.station || (po && po.station) || '', godziny: hoursShown,
      start: fmtDt(r.start), koniec: fmtDt(r.end), startManual: fmtDt(o.startManual), dostawa: fmtDt(o.dostawa), wysylka: fmtDt(o.wysylka),
      segs: segsOf(o, myKids, opsByLp, result), zak, state: r.state, stanowiskoBg: sl.bg || '#cccccc', stanowiskoColor: sl.color || '#000000',
    });
  }
  return { rows, holidays: [], rapData: {}, result };
}

// ---------------------------------------------------------------------------------------------------------------------
// Powiązania (poprzednicy) i dodawanie operacji: reguły bezpieczeństwa, żeby nie powstał cykl ani duplikat
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Operacje, których KONIEC zależy (bezpośrednio lub pośrednio) od STARTU operacji [id]. Taka operacja nie może być jej poprzednikiem (powstałby cykl).
 * Graf zależności (jak w silniku): start suboperacji zależy od startu jej operacji głównej, od końca poprzedniej suboperacji i od końców jej poprzedników;
 * start operacji głównej od końców poprzedników; koniec operacji głównej złożonej z suboperacji od końców jej suboperacji; koniec zwykły od własnego startu.
 */
export function blockedPredecessors(opsByLp, id) {
  const kids = new Map();
  for (const lp of Object.keys(opsByLp)) { const p = subParent(lp); if (p && opsByLp[p]) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(lp); } }
  for (const l of kids.values()) l.sort(lpCompare);
  const own = (o) => o.startManual != null || (o.preds || []).length > 0;
  const deps = new Map();                         // węzeł → węzły, od których zależy
  const add = (n, d) => { if (!deps.has(n)) deps.set(n, []); deps.get(n).push(d); };
  for (const [lp, op] of Object.entries(opsByLp)) {
    for (const p of op.preds || []) if (opsByLp[p]) add('s:' + lp, 'e:' + p);
    const par = subParent(lp);
    if (par && opsByLp[par]) {
      const sibs = kids.get(par), i = sibs.indexOf(lp);
      if (i > 0) add('s:' + lp, 'e:' + sibs[i - 1]);
      else if (own(opsByLp[par])) add('s:' + lp, 's:' + par);             // pierwsza suboperacja startuje z operacją główną, o ile ta ma własny start
    }
    if (kids.has(lp) && !own(op)) add('s:' + lp, 's:' + kids.get(lp)[0]);   // operacja główna bez własnego startu dziedziczy start po pierwszej suboperacji
    add('e:' + lp, 's:' + lp);
    if (kids.has(lp) && !(op.hours > 0)) for (const k of kids.get(lp)) add('e:' + lp, 'e:' + k);
  }
  const rev = new Map();
  for (const [n, ds] of deps) for (const d of ds) { if (!rev.has(d)) rev.set(d, []); rev.get(d).push(n); }
  const seen = new Set(['s:' + id]), stack = ['s:' + id];
  while (stack.length) for (const n of rev.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  return new Set(Object.keys(opsByLp).filter((lp) => seen.has('e:' + lp)));
}

/**
 * Dlaczego operacja [pred] nie może być poprzednikiem [id] w pozycji [slot] (null = można). Operacja główna może zależeć od suboperacji innej
 * operacji, a suboperacja od innej operacji; nie może zależeć od swojej operacji głównej ani operacja główna od własnych suboperacji (cykl).
 */
export function predError(opsByLp, id, slot, pred) {
  const p = String(pred ?? '').trim();
  if (!p) return null;                                                   // puste = brak powiązania
  if (!opsByLp[p]) return `Operacja ${p} nie istnieje`;
  if (p === String(id)) return 'Operacja nie może być swoim poprzednikiem';
  if (subParent(id) === p) return `Operacja ${p} jest operacją główną tej suboperacji; powiązanie jest zbędne i tworzy cykl`;
  if (subParent(p) === String(id)) return `Operacja ${p} jest suboperacją tej operacji; powiązanie tworzy cykl`;
  if (blockedPredecessors(opsByLp, id).has(p)) return `Operacja ${p} zależy od tej operacji, powiązanie utworzyłoby cykl`;
  const others = (opsByLp[id]?.preds || []).filter((_, i) => i !== slot);
  if (others.includes(p)) return `Operacja ${p} jest już wpisana jako inny poprzednik`;
  return null;
}

/** Operacje, które można wybrać jako poprzednika w pozycji [slot] (też suboperacje innych operacji). Posortowane po numerze. */
export function predecessorChoices(opsByLp, id, slot) {
  const blocked = blockedPredecessors(opsByLp, id);
  const others = new Set((opsByLp[id]?.preds || []).filter((_, i) => i !== slot));
  return Object.keys(opsByLp).filter((lp) => lp !== String(id) && !blocked.has(lp) && !others.has(lp) && subParent(id) !== lp && subParent(lp) !== String(id)).sort(lpCompare);
}

/**
 * Walidacja wielu nowych operacji naraz (tabela do wpisywania). [rows]: [{lp, client, komis, element, station, hours, wysylka, dostawa}] jako teksty.
 * Puste wiersze (bez komisu, opisu, stanowiska, klienta, czasu i dat) są pomijane. Zwraca {ops: [[lp, op]], errors: [teksty]}.
 * Numery nie mogą się powtarzać ani z bazą, ani między wierszami tabeli.
 */
export function validateNewOps(rows, existing, parseDate, parseNum) {
  const ops = [], errors = [], seen = new Set();
  const pending = new Set(rows.map((r) => String(r.lp ?? '').trim()).filter((x) => /^\d+$/.test(x)));
  rows.forEach((r, i) => {
    const v = (k) => String(r[k] ?? '').trim();
    const filled = ['client', 'komis', 'element', 'station', 'hours', 'wysylka', 'dostawa'].some((k) => v(k));
    if (!filled) return;
    const n = i + 1, lp = v('lp');
    const idErr = idError(lp, existing, { pending });
    if (idErr) { errors.push(`Wiersz ${n}: ${idErr}`); return; }
    if (seen.has(lp)) { errors.push(`Wiersz ${n}: numer ${lp} powtórzony w tabeli`); return; }
    seen.add(lp);
    const op = { preds: [], client: v('client'), komis: v('komis'), element: v('element'), station: v('station') };
    if (v('hours')) { const h = parseNum(v('hours')); if (h == null || h < 0) { errors.push(`Wiersz ${n}: czas to liczba godzin`); return; } op.hours = h; }
    for (const k of ['wysylka', 'dostawa']) if (v(k)) { const d = parseDate(v(k)); if (d == null) { errors.push(`Wiersz ${n}: nie rozpoznano daty „${v(k)}” (${k === 'wysylka' ? 'wysyłka' : 'dostawa'})`); return; } op[k] = d; }
    ops.push([lp, op]);
  });
  if (!ops.length && !errors.length) errors.push('Wpisz przynajmniej jedną operację');
  return { ops, errors };
}
