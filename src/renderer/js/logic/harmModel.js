// Model danych Harmonogramu w bazie (Firestore) i budowa danych do wykresu.
//  - harm_ops/{chunk}: { ops: { "<lp>": {preds, client, komis, element, station, hours, startManual, endManual, wysylka, dostawa, status} } }
//    (operacje pogrupowane po 50 numerów, więc odczyt całości to kilkadziesiąt dokumentów, a zmiana to jedno pole)
//  - Grafik NIE jest w bazie: program pobiera go z arkusza (karta graf_norm, API getGrafNorm) i liczy z niego godziny stanowisk.
//  - config/main: { stations: [{name, bg, color}] } – tylko zmiany użytkownika (kolory stanowisk i dodane stanowiska); domyślne są w kodzie.
import { stationHours, slotNumber, buildCapacity, computeSchedule, sortKey, compareKeys, toSerial, subParent, depthOf, DAY_MS } from './schedule.js';

export const HORIZON_DAYS = 417;   // komórka S12 arkusza: operacje startujące dalej niż tyle dni od dziś trafiają za stanowiska

export const CHUNK = 50;
/**
 * Numer operacji: liczba = operacja (np. 100); liczba + litera = suboperacja (np. 100a, detal), liczba + dwie litery = subsuboperacja
 * (np. 100aa, operacja na detalu). Numery „s<cyfry>” są techniczne (operacje bez numeru w arkuszu) i nie można ich wpisać ręcznie.
 */
export const MAX_DEPTH = 2;
export const ID_PATTERN = /^\d{1,15}\p{L}{0,2}$/u;
export const isSyntheticId = (id) => /^s\d+$/.test(String(id));
export { subParent, depthOf };
/** Czy numer ma postać suboperacji albo subsuboperacji (liczba + litery), niezależnie od tego, czy rodzic istnieje. */
export const isSubId = (id) => subParent(id) != null;
/** Nazwa poziomu numeru (do komunikatów). */
export const levelName = (id) => ['operacja', 'suboperacja', 'subsuboperacja'][depthOf(id)] || 'operacja';
const levelGen = (id) => ['operacji', 'suboperacji', 'subsuboperacji'][depthOf(id)] || 'operacji';   // „tej suboperacji”
const levelIns = (id) => ['operacją', 'suboperacją', 'subsuboperacją'][depthOf(id)] || 'operacją';     // „jest suboperacją”

/** Porządek numerów: liczba rosnąco, przy tej samej liczbie najpierw operacja, potem jej suboperacje i subsuboperacje (a, aa, ab, b, …); techniczne „s…” na końcu. */
const LP_COLL = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
const lpParsed = new Map();   // pamięć rozbioru numerów (sortowanie 10 000 pozycji porównuje je setki tysięcy razy)
const lpParse = (x) => {
  let v = lpParsed.get(x);
  if (v === undefined) { const m = /^(\d+)(\p{L}*)$/u.exec(x); v = m ? { n: m[1].length <= 15 ? Number(m[1]) : BigInt(m[1]), suf: m[2] } : null; if (lpParsed.size > 100000) lpParsed.clear(); lpParsed.set(x, v); }
  return v;
};
export function lpCompare(a, b) {
  a = String(a); b = String(b);
  const pa = lpParse(a), pb = lpParse(b);
  if (pa && pb) return pa.n == pb.n ? (pa.suf === pb.suf ? 0 : LP_COLL.compare(pa.suf, pb.suf)) : (pa.n < pb.n ? -1 : 1);   // eslint-disable-line eqeqeq
  if (pa) return -1;
  if (pb) return 1;
  return LP_COLL.compare(a, b);
}

/**
 * Powód, dla którego [id] nie nadaje się na nowy numer operacji (null = można). [existing] to obiekt operacji (klucze = numery),
 * [pending] – numery dodawane jednocześnie (np. w tej samej tabeli). Suboperacja wymaga istniejącej operacji, subsuboperacja – istniejącej suboperacji.
 */
export function idError(id, existing, { ignore, pending } = {}) {
  const t = String(id ?? '').trim();
  if (!t) return 'Numer operacji nie może być pusty';
  if (isSyntheticId(t)) return 'Numery „s” + cyfry są zarezerwowane dla operacji bez numeru';
  if (!ID_PATTERN.test(t)) return 'Numer operacji: liczba (operacja, np. 100), liczba + litera (suboperacja, np. 100a) albo liczba + dwie litery (subsuboperacja, np. 100aa)';
  if (t !== ignore && existing[t]) return `Operacja o numerze ${t} już istnieje`;
  const parent = subParent(t);
  if (parent && !(existing[parent] && parent !== ignore) && !(pending && pending.has(parent))) {
    return depthOf(t) === 1 ? `Suboperacja ${t} wymaga istniejącej operacji głównej ${parent}` : `Subsuboperacja ${t} wymaga istniejącej suboperacji ${parent}`;
  }
  return null;
}

/** Bezpośrednie dzieci węzła [id] (numery dłuższe o jedną literę), w kolejności a, b, … */
export function subOps(opsByLp, id) {
  return Object.keys(opsByLp).filter((lp) => subParent(lp) === String(id)).sort(lpCompare);
}
/** Wszystkie potomki węzła [id] (dzieci, wnuki), w kolejności numerów. */
export function descendants(opsByLp, id) {
  const out = [];
  for (const c of subOps(opsByLp, id)) out.push(c, ...descendants(opsByLp, c));
  return out;
}
/** Czy [a] jest przodkiem [b] (rodzicem, dziadkiem). */
export function isAncestor(a, b) {
  for (let p = subParent(b); p != null; p = subParent(p)) if (p === String(a)) return true;
  return false;
}

/**
 * Zmiana numeru: nowy klucz, usunięcie starego i poprawienie poprzedników we wszystkich operacjach, które się do niego odwołują.
 * Węzeł zabiera ze sobą wszystkie potomki (100 → 105: 100a → 105a, 100aa → 105aa; 100a → 760: 100aa → 760a), o ile nie przekroczą trzech poziomów
 * i nowe numery są wolne. Wynik: {moves: [{oldId, newId, op}], referrers: [[lp, preds]]}.
 */
export function renamePlan(opsByLp, oldId, newId) {
  const neu = String(newId ?? '').trim();
  if (!opsByLp[oldId]) return { error: `Operacja ${oldId} nie istnieje` };
  const err = idError(neu, opsByLp, { ignore: oldId });
  if (err) return { error: err };
  if (neu === oldId) return { error: null, same: true };
  if (isAncestor(oldId, neu)) return { error: `Operacja ${oldId} nie może zostać swoją własną suboperacją` };
  const idMap = new Map([[oldId, neu]]);
  for (const d of descendants(opsByLp, oldId)) {                 // potomki idą razem z węzłem
    const target = neu + d.slice(oldId.length);
    if (!ID_PATTERN.test(target)) return { error: `Nie można przenieść ${d}: numer ${target} przekroczyłby trzy poziomy (operacja › suboperacja › subsuboperacja)` };
    if (opsByLp[target] && !idMap.has(target)) return { error: `Nie można przenieść ${d}: numer ${target} już istnieje` };
    idMap.set(d, target);
  }
  const fix = (preds) => (preds || []).map((p) => idMap.get(p) ?? p);
  const moves = [...idMap].map(([from, to]) => ({ oldId: from, newId: to, op: { ...opsByLp[from], preds: fix(opsByLp[from].preds) } }));
  const referrers = [];
  for (const [lp, op] of Object.entries(opsByLp)) if (!idMap.has(lp) && (op.preds || []).some((p) => idMap.has(p))) referrers.push([lp, fix(op.preds)]);
  // Po zmianie numeru operacja może trafić pod inny węzeł (albo spod niego wyjść), więc sprawdzamy, czy powiązania nie utworzą cyklu.
  for (let p = subParent(neu); p != null; p = subParent(p)) {
    if ((opsByLp[oldId].preds || []).includes(p)) return { error: `Operacja ${oldId} zależy od ${p}, który byłby jej rodzicem; usuń najpierw to powiązanie` };
  }
  const sim = { ...opsByLp };
  for (const m of moves) delete sim[m.oldId];
  for (const m of moves) sim[m.newId] = m.op;
  for (const [lp, preds] of referrers) sim[lp] = { ...sim[lp], preds };
  const cyclesOf = (ops) => new Set([...computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), {})].filter(([, r]) => r.state === 'cycle').map(([lp]) => lp));
  const before = cyclesOf(opsByLp), after = cyclesOf(sim);
  const back = new Map([...idMap].map(([from, to]) => [to, from]));
  const fresh = [...after].filter((lp) => !before.has(back.get(lp) ?? lp));
  if (fresh.length) return { error: `Zmiana numeru utworzyłaby cykl zależności (operacje: ${fresh.slice(0, 5).join(', ')}); popraw najpierw powiązania` };
  return { error: null, oldId, newId: neu, op: moves[0].op, moves, referrers };
}

/**
 * Nowe numery po zmianie kolejności dzieci w gałęzi [rootId] (przeciągnij i upuść). [order]: rodzic (stary numer) → dzieci w nowej kolejności (stare numery).
 * Każda grupa rodzeństwa zachowuje swoje litery, zmienia się tylko ich przydział (pierwsze na liście dostaje najniższą literę); dziecko zabiera swoje dzieci.
 * Przenoszenie między rodzicami nie jest możliwe. Zwraca Map stary numer → nowy (tylko zmienione).
 */
export function reorderIds(opsByLp, rootId, order) {
  const map = new Map();
  const assign = (oldNode, newNode) => {
    const kids = subOps(opsByLp, oldNode);
    if (!kids.length) return;
    const wanted = order && order[oldNode] ? order[oldNode] : kids;
    if (wanted.length !== kids.length || wanted.some((k) => !kids.includes(k))) throw new Error(`Lista dzieci operacji ${oldNode} nie zgadza się z bazą (przenoszenie między operacjami jest niedozwolone)`);
    const letters = kids.map((k) => k.slice(oldNode.length));          // litery w kolejności a, b, …
    wanted.forEach((k, i) => { const nk = newNode + letters[i]; if (nk !== k) map.set(k, nk); assign(k, nk); });
  };
  assign(String(rootId), String(rootId));
  return map;
}

/** Plan zmiany kolejności dzieci w gałęzi [rootId]: przeniesienia, poprawione powiązania (także operacji spoza gałęzi) i kontrola cykli. */
export function reorderPlan(opsByLp, rootId, order) {
  if (!opsByLp[rootId]) return { error: `Operacja ${rootId} nie istnieje` };
  let idMap;
  try { idMap = reorderIds(opsByLp, rootId, order); } catch (e) { return { error: e.message }; }
  if (!idMap.size) return { error: null, same: true, moves: [], referrers: [] };
  return finishMoves(opsByLp, idMap);
}

/** Wspólne zakończenie planu przeniesień: dane z poprawionymi poprzednikami, operacje z zewnątrz do poprawy i kontrola nowych cykli. */
function finishMoves(opsByLp, idMap) {
  const fix = (preds) => (preds || []).map((p) => idMap.get(p) ?? p);
  const moves = [...idMap].map(([from, to]) => ({ oldId: from, newId: to, op: { ...opsByLp[from], preds: fix(opsByLp[from].preds) } }));
  const referrers = [];
  for (const [lp, op] of Object.entries(opsByLp)) if (!idMap.has(lp) && (op.preds || []).some((p) => idMap.has(p))) referrers.push([lp, fix(op.preds)]);
  const sim = { ...opsByLp };
  for (const m of moves) delete sim[m.oldId];
  for (const m of moves) sim[m.newId] = m.op;
  for (const [lp, preds] of referrers) sim[lp] = { ...sim[lp], preds };
  const cyclesOf = (ops) => new Set([...computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), {})].filter(([, r]) => r.state === 'cycle').map(([lp]) => lp));
  const before = cyclesOf(opsByLp), after = cyclesOf(sim);
  const back = new Map([...idMap].map(([from, to]) => [to, from]));
  const fresh = [...after].filter((lp) => !before.has(back.get(lp) ?? lp));
  if (fresh.length) return { error: `Zmiana utworzyłaby cykl zależności (operacje: ${fresh.slice(0, 5).join(', ')}); popraw najpierw powiązania` };
  return { error: null, moves, referrers };
}

const hashLp = (t) => { let h = 7; for (const ch of t) h = (h * 31 + ch.codePointAt(0)) % 1000003; return h; };

/** Dokument z operacjami: numery po 50 (c0000…), suboperacje i subsuboperacje razem z operacją główną, techniczne „s…” osobno, pozostałe rozproszone po x00…x19. */
export const chunkId = (lp) => {
  const t = String(lp);
  if (/^\d+$/.test(t)) return 'c' + String(Math.floor(Number(t) / CHUNK)).padStart(4, '0');
  const root = /^(\d+)\p{L}+$/u.exec(t);                // suboperacje i subsuboperacje razem z operacją główną
  if (root) return 'c' + String(Math.floor(Number(root[1]) / CHUNK)).padStart(4, '0');
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
/**
 * Wiersze po filtrach i sortowaniu: suboperacje układają się chronologicznie razem z pozostałymi; znikają, gdy któryś ich przodek jest zwinięty.
 * [hiddenLevels] – ukryte poziomy liczone od dołu drzewa: I = operacje bez dzieci (najniższy, najważniejszy poziom), II = węzły zbierające
 * poziom I, III = węzły zbierające poziomy II i I.
 */
export function arrangeRows(rows, collapsed, hiddenLevels) {
  const hiddenByCollapse = (r) => { if (!collapsed || !collapsed.size) return false; for (let p = r.parent; p != null; p = subParent(p)) if (collapsed.has(p)) return true; return false; };
  return rows.filter((r) => !hiddenByCollapse(r) && !(hiddenLevels && hiddenLevels.has(r.level)));
}

// Obsada maszyn zmienia się tylko z grafikiem: pamiętana dla tego samego obiektu dni i tej samej listy stanowisk (zmiana operacji nie liczy jej od nowa)
const capCache = new WeakMap();
function cachedCapacity(daysByKey, names, sumSet) {
  if (!daysByKey || typeof daysByKey !== 'object') return capacityFrom(daysByKey || {}, names, sumSet);
  const key = names.join('|') + '#' + [...sumSet].sort().join('|');
  let m = capCache.get(daysByKey); if (!m) { m = new Map(); capCache.set(daysByKey, m); }
  if (!m.has(key)) { if (m.size > 8) m.clear(); m.set(key, capacityFrom(daysByKey, names, sumSet)); }
  return m.get(key);
}
export function buildHarmData(opsByLp, daysByKey, cfg, nowMs) {
  const stations = stationList(cfg);
  const look = Object.fromEntries(stations.map((s) => [s.name, s]));
  const list = Object.entries(opsByLp).map(([lp, o]) => ({ lp, ...o })).sort((a, b) => lpCompare(a.lp, b.lp));
  const names = [...new Set([...stations.map((s) => s.name), ...list.map((o) => o.station).filter(Boolean)])];
  const capacity = cachedCapacity(daysByKey, names, new Set(stations.filter((x) => x.sum).map((x) => x.name)));
  const result = computeSchedule(list, capacity);
  const parentOf = (lp) => { const p = subParent(lp); return p && opsByLp[p] ? p : null; };
  const kids = new Map();
  for (const lp of Object.keys(opsByLp)) { const p = parentOf(lp); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(lp); } }
  for (const l of kids.values()) l.sort(lpCompare);
  // stanowisko, komis i klient: puste dziedziczą po rodzicu (w górę); do sortowania węzeł bez stanowiska bierze stanowisko pierwszego dziecka
  const up = (lp, key) => { const o = opsByLp[lp]; if (o[key]) return o[key]; const p = parentOf(lp); return p ? up(p, key) : ''; };
  const sortStation = (lp) => up(lp, 'station') || (kids.has(lp) ? sortStation(kids.get(lp)[0]) : '');
  const chopped = (lp) => kids.has(lp) && !(opsByLp[lp].hours > 0);
  // poziom od dołu drzewa: 1 = bez dzieci, 2 = zbiera poziom 1, 3 = zbiera poziomy 2 i 1
  const levelOf = (lp) => (kids.has(lp) ? 1 + Math.max(...kids.get(lp).map(levelOf)) : 1);
  // czas węzła złożonego = suma czasów dzieci (dziecko złożone liczy swoją sumę)
  const effHours = (lp) => (chopped(lp) ? kids.get(lp).reduce((t, c) => t + (effHours(c) || 0), 0) : (opsByLp[lp].hours > 0 ? opsByLp[lp].hours : 0));
  // odcinki paska węzła złożonego: liście poddrzewa, każdy w kolorze swojego stanowiska (pasek pokazuje plan i kolejność stanowisk)
  const leafSegs = (lp) => {
    if (chopped(lp)) return kids.get(lp).flatMap(leafSegs);
    const r = result.get(lp), sl = look[up(lp, 'station')] || {};
    return r && r.start != null && r.end != null ? [[r.start, r.end, sl.bg || '#cccccc']] : [];
  };
  const keyed = list.map((o) => {
    const r = result.get(o.lp) || {};
    const zak = String(o.status || '').trim().toLowerCase() === 'zak.' ? 'zak.' : String(o.status || '');
    return { o, r, zak, key: sortKey({ station: sortStation(o.lp), element: o.element, zak }, r.start, HORIZON_DAYS, nowMs) };
  });
  const ordered = keyed.slice().sort((a, b) => compareKeys(a.key, b.key));
  const rows = [];
  for (const { o, r, zak, key } of ordered) {
    const par = parentOf(o.lp);
    const station = up(o.lp, 'station');
    const sl = look[station] || {};
    const myKids = kids.get(o.lp) || [];
    const sum = myKids.length ? effHours(o.lp) : 0;
    const hoursShown = o.hours > 0 ? String(o.hours) : (myKids.length && sum > 0 ? `Σ${sum}` : (o.hours == null ? '' : String(o.hours)));
    rows.push({
      id: o.lp, sub: !!par, parent: par, depth: par ? depthOf(o.lp) : 0, level: levelOf(o.lp), subCount: myKids.length, hours: o.hours == null ? '' : String(o.hours), hoursShown,
      station, client: up(o.lp, 'client'), status: o.status || '', endManual: fmtDt(o.endManual), key: statKey({ ...o, station: sortStation(o.lp) }, r, key),
      lp: isSyntheticId(o.lp) ? '' : o.lp, z1: o.preds?.[0] || '', z2: o.preds?.[1] || '', z3: o.preds?.[2] || '', z4: o.preds?.[3] || '',
      komis: up(o.lp, 'komis'), element: o.element || '', stanowisko: station, godziny: hoursShown,
      start: fmtDt(r.start), koniec: fmtDt(r.end), startManual: fmtDt(o.startManual), dostawa: fmtDt(o.dostawa), wysylka: fmtDt(o.wysylka),
      segs: chopped(o.lp) ? leafSegs(o.lp).sort((a, b) => a[0] - b[0]) : [], zak, state: r.state, stanowiskoBg: sl.bg || '#cccccc', stanowiskoColor: sl.color || '#000000',
    });
  }
  return { rows, holidays: [], rapData: {}, result, komisRows: komisSummaries(rows, list, kids, result, up, look, nowMs) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Podsumowanie komisu (pasek komisu, nie jest poziomem drzewa). Tworzy się sam z operacji, które mają ten komis (także dziedziczony po rodzicu); nie jest zapisywany
// w bazie, nie ma numeru operacji i nie wpływa na liczenie harmonogramu ani na powiązania. Pokazuje: start pierwszej i koniec ostatniej operacji,
// odcinki wszystkich operacji-liści w kolorach stanowisk (zakończone na zielono), sumę godzin, postęp (zak.), najbliższą wysyłkę i ostatnią dostawę.
// ---------------------------------------------------------------------------------------------------------------------

export const KOMIS_PREFIX = 'K:';
export const isKomisId = (id) => typeof id === 'string' && id.startsWith(KOMIS_PREFIX);
const KOMIS_DONE_BAR = '#93c47d';

/** Etap komisu: 0 – zakończony (wszystkie operacje „zak.”), 1 – w trakcie (coś zakończone albo start już minął), 2 – nierozpoczęty. */
export function komisPhase(k, nowMs) {
  if (k.leafCount && k.zakCount === k.leafCount) return 0;
  if (k.zakCount > 0 || (k.ms && k.ms.start != null && k.ms.start <= nowMs)) return 1;
  return 2;
}

function komisSummaries(rows, list, kids, result, up, look, nowMs = Date.now()) {
  const byKomis = new Map();
  for (const o of list) { const k = String(up(o.lp, 'komis') || '').trim(); if (!k) continue; if (!byKomis.has(k)) byKomis.set(k, []); byKomis.get(k).push(o); }
  const out = new Map();
  for (const [k, ops] of byKomis) {
    if (ops.length < 2) continue;   // podsumowanie tylko dla komisów z więcej niż jedną operacją
    const leaves = ops.filter((o) => !kids.has(o.lp));
    const done = (o) => String(o.status || '').trim().toLowerCase() === 'zak.';
    const zak = leaves.filter(done).length;
    const segs = [];
    let hours = 0, start = null, end = null, wys = null, dost = null;
    for (const o of leaves) {
      if (o.hours > 0) hours += o.hours;
      const r = result.get(o.lp);
      if (r && r.start != null && r.end != null) {
        segs.push([r.start, r.end, done(o) ? KOMIS_DONE_BAR : (look[up(o.lp, 'station')] || {}).bg || '#cccccc']);
        start = start == null ? r.start : Math.min(start, r.start); end = end == null ? r.end : Math.max(end, r.end);
      }
    }
    for (const o of ops) {
      if (o.wysylka != null) wys = wys == null ? o.wysylka : Math.min(wys, o.wysylka);
      if (o.dostawa != null) dost = dost == null ? o.dostawa : Math.max(dost, o.dostawa);
    }
    segs.sort((a, b) => a[0] - b[0]);
    const h = Math.round(hours * 100) / 100;
    const status = leaves.length && zak === leaves.length ? 'zak.' : `${zak}/${leaves.length}`;
    out.set(k, {
      id: KOMIS_PREFIX + k, komisRow: true, komisName: k, sub: false, parent: null, depth: 0, level: 0, subCount: ops.length, opCount: ops.length, leafCount: leaves.length, zakCount: zak,
      hours: '', hoursShown: h > 0 ? `Σ${h}` : '', godziny: h > 0 ? `Σ${h}` : '', sumHours: h, station: '', stanowisko: '', stanowiskoBg: '#cccccc', stanowiskoColor: '#000000',
      client: String(ops.map((o) => up(o.lp, 'client')).find(Boolean) || ''), status, endManual: '', startManual: '', key: '',
      lp: '', z1: '', z2: '', z3: '', z4: '', komis: k, element: `Komis ${k}: operacji ${ops.length}, zakończonych ${zak}/${leaves.length}`,
      start: fmtDt(start), koniec: fmtDt(end), wysylka: fmtDt(wys), dostawa: fmtDt(dost), late: wys != null && end != null && end > wys,
      ms: { start, koniec: end, wysylka: wys, dostawa: dost }, segs, zak: status === 'zak.' ? 'zak.' : '', state: 'ok',
    });
  }
  // kolejność: u góry zakończone, potem w trakcie, na dole nierozpoczęte; w każdej grupie alfabetycznie wg komisu
  return new Map([...out].sort((a, b) => komisPhase(a[1], nowMs) - komisPhase(b[1], nowMs) || a[0].localeCompare(b[0], 'pl', { numeric: true, sensitivity: 'base' })));
}

/**
 * Wstawia paski podsumowania komisów. [summaries] – lista pasków do pokazania (już przefiltrowana i posortowana, gdy tak ustawiono).
 * Domyślnie wszystkie na samej górze tabeli; z opcją [inline] – nad pierwszą widoczną operacją komisu (pasek komisu bez widocznych operacji zostaje na górze).
 * Zwinięty komis (id „K:<komis>” w [collapsed]) chowa swoje operacje.
 */
export function withKomisRows(rows, summaries, collapsed, { inline = false } = {}) {
  if (!summaries || !summaries.length) return rows;
  const byKomis = new Map(summaries.map((s) => [s.komisName, s]));
  const hidden = (r) => { const k = String(r.komis || '').trim(); return k && byKomis.has(k) && collapsed && collapsed.has(KOMIS_PREFIX + k); };
  if (!inline) return [...summaries, ...rows.filter((r) => !hidden(r))];
  const placed = new Set(), body = [];
  for (const r of rows) {
    const k = String(r.komis || '').trim();
    if (k && byKomis.has(k) && !placed.has(k)) { placed.add(k); body.push(byKomis.get(k)); }
    if (!hidden(r)) body.push(r);
  }
  return [...summaries.filter((s) => !placed.has(s.komisName)), ...body];
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
  // własny start jak w silniku: ręczny, z poprzedników albo z kolejności rodzeństwa (od rodzica z własnym startem albo po poprzednim dziecku)
  const ownMemo = new Map();
  const own = (lp) => {
    if (ownMemo.has(lp)) return ownMemo.get(lp);
    ownMemo.set(lp, false);
    const o = opsByLp[lp], par = subParent(lp);
    let v = o.startManual != null || (o.preds || []).length > 0;
    if (!v && par && opsByLp[par]) v = kids.get(par).indexOf(lp) > 0 || own(par);
    ownMemo.set(lp, v);
    return v;
  };
  const deps = new Map();                         // węzeł → węzły, od których zależy
  const add = (n, d) => { if (!deps.has(n)) deps.set(n, []); deps.get(n).push(d); };
  for (const [lp, op] of Object.entries(opsByLp)) {
    for (const p of op.preds || []) if (opsByLp[p]) add('s:' + lp, 'e:' + p);
    const par = subParent(lp);
    if (par && opsByLp[par]) {
      const sibs = kids.get(par), i = sibs.indexOf(lp);
      if (i > 0) add('s:' + lp, 'e:' + sibs[i - 1]);
      else if (own(par)) add('s:' + lp, 's:' + par);                       // pierwsze dziecko startuje z rodzicem, o ile ten ma własny start
    }
    if (kids.has(lp) && !own(lp)) add('s:' + lp, 's:' + kids.get(lp)[0]);   // węzeł bez własnego startu dziedziczy start po pierwszym dziecku
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
 * Operacje, na których koniec [id] i tak czeka z samej budowy drzewa – bez żadnych wpisanych zależności: wcześniejsze suboperacje tej samej
 * operacji (kolejność liter), wcześniejsze rodzeństwo jej operacji nadrzędnych i ich potomki. Wpisanie ich w Z1–Z4 jest zbędne.
 */
export function structurallyBefore(opsByLp, id) {
  const kids = new Map();
  for (const lp of Object.keys(opsByLp)) { const p = subParent(lp); if (p && opsByLp[p]) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(lp); } }
  for (const l of kids.values()) l.sort(lpCompare);
  const memo = new Map();
  const own = (lp) => {
    if (memo.has(lp)) return memo.get(lp);
    memo.set(lp, false);
    const o = opsByLp[lp], par = subParent(lp);
    let v = o.startManual != null || (o.preds || []).length > 0;
    if (!v && par && opsByLp[par]) v = kids.get(par).indexOf(lp) > 0 || own(par);
    memo.set(lp, v); return v;
  };
  // tylko powiązania wynikające z drzewa (bez Z1–Z4): kolejność rodzeństwa, start z rodzicem, start po pierwszym dziecku, koniec rodzica po dzieciach
  const deps = (n) => {
    const lp = n.slice(2), op = opsByLp[lp], out = [];
    if (!op) return out;
    const par = subParent(lp);
    if (n[0] === 's') {
      if (par && opsByLp[par]) { const sibs = kids.get(par), i = sibs.indexOf(lp); if (i > 0) out.push('e:' + sibs[i - 1]); else if (own(par)) out.push('s:' + par); }
      if (kids.has(lp) && !own(lp)) out.push('s:' + kids.get(lp)[0]);
    } else {
      out.push('s:' + lp);
      if (kids.has(lp) && !(op.hours > 0)) for (const k of kids.get(lp)) out.push('e:' + k);
    }
    return out;
  };
  const seen = new Set(['s:' + id]), stack = ['s:' + id];
  while (stack.length) for (const d of deps(stack.pop())) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  return new Set(Object.keys(opsByLp).filter((lp) => lp !== String(id) && seen.has('e:' + lp)));
}

/** Zbędne zależności operacji [id] (wpisane w Z1–Z4, a wynikające z kolejności suboperacji). */
export function redundantPreds(opsByLp, id) {
  const preds = (opsByLp[id] && opsByLp[id].preds) || [];
  if (!preds.length) return [];
  const before = structurallyBefore(opsByLp, id);
  return preds.filter((p) => before.has(p));
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
  if (isAncestor(p, id)) return `Operacja ${p} jest ${depthOf(p) === 0 ? 'operacją główną' : 'suboperacją nadrzędną'} tej ${levelGen(id)}; powiązanie jest zbędne i tworzy cykl`;
  if (isAncestor(id, p)) return `Operacja ${p} jest ${levelIns(p)} tej ${levelGen(id)}; powiązanie tworzy cykl`;
  if (blockedPredecessors(opsByLp, id).has(p)) return `Operacja ${p} zależy od tej operacji, powiązanie utworzyłoby cykl`;
  if (structurallyBefore(opsByLp, id).has(p)) return `Zbędne: ${id} i tak czeka na ${p} (kolejność suboperacji wynika z liter numeru)`;
  const others = (opsByLp[id]?.preds || []).filter((_, i) => i !== slot);
  if (others.includes(p)) return `Operacja ${p} jest już wpisana jako inny poprzednik`;
  return null;
}

/** Operacje, które można wybrać jako poprzednika w pozycji [slot] (też suboperacje innych operacji). Posortowane po numerze. */
export function predecessorChoices(opsByLp, id, slot) {
  const blocked = blockedPredecessors(opsByLp, id);
  const others = new Set((opsByLp[id]?.preds || []).filter((_, i) => i !== slot));
  const implied = structurallyBefore(opsByLp, id);
  return Object.keys(opsByLp).filter((lp) => lp !== String(id) && !blocked.has(lp) && !implied.has(lp) && !others.has(lp) && !isAncestor(lp, id) && !isAncestor(id, lp)).sort(lpCompare);
}

/**
 * Walidacja wielu nowych operacji naraz (tabela do wpisywania). [rows]: [{lp, client, komis, element, station, hours, wysylka, dostawa}] jako teksty.
 * Puste wiersze (bez komisu, opisu, stanowiska, klienta, czasu i dat) są pomijane. Zwraca {ops: [[lp, op]], errors: [teksty]}.
 * Numery nie mogą się powtarzać ani z bazą, ani między wierszami tabeli.
 */
export function validateNewOps(rows, existing, parseDate, parseNum) {
  const ops = [], errors = [], seen = new Set();
  const pending = new Set(rows.map((r) => String(r.lp ?? '').trim()).filter((x) => ID_PATTERN.test(x)));
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
