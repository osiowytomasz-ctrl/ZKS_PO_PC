// Silnik harmonogramu: godziny na stanowisku z grafiku, start operacji z poprzedników i koniec z dostępnych godzin.
// Odwzorowuje formuły z arkusza harmonogramu (graf_norm, kolumny I, M i klucz „Stat.”). Czas „lokalny” jest liczony jak UTC (bez stref).

export const DAY_MS = 86400000;
export const DAY_START_HOUR = 6;   // doba pracy stanowiska zaczyna się o 6:00
const MACHINE_SHIFT_CAP = 8;       // maszyny: najwyżej 8 h na zmianę

// ---------------------------------------------------------------------------
// Godziny z kodów grafiku
// ---------------------------------------------------------------------------

/** Godziny zmian a, b, c z kodu (np. „a5b3” → {a:5,b:3,c:0}): cyfra BEZPOŚREDNIO po małej literze, pierwsze wystąpienie (jak ZNAJDŹ + FRAGMENT.TEKSTU). */
export function shiftHours(code) {
  const text = String(code ?? '');
  const out = { a: 0, b: 0, c: 0 };
  for (const letter of ['a', 'b', 'c']) {
    const i = text.indexOf(letter);                 // ZNAJDŹ rozróżnia wielkość liter
    if (i >= 0 && /\d/.test(text[i + 1] || '')) out[letter] = Number(text[i + 1]);
  }
  return out;
}

/** Stanowiska liczone jako suma wszystkich miejsc pracy: „Śl” (znaki 2–3 nazwy), „Do”, „Narz”. */
export function isSumStation(station) {
  const s = String(station ?? '').toLocaleLowerCase('pl');
  return s.slice(1, 3) === 'śl' || s === 'do' || s === 'narz';
}

/**
 * Godziny na dobę na stanowisku. `slotCodes` to kody miejsc pracy 1..9 (indeks 0 = miejsce 1); brak = pusty tekst.
 * Suma: wszystkie litery a/b/c ze wszystkich 9 miejsc. Maszyna: osobno dla a, b i c suma z miejsc 1–3, każda ograniczona do 8 h.
 */
export function stationHours(station, slotCodes, forceSum) {
  const hours = (slotCodes || []).slice(0, 9).map(shiftHours);
  if (forceSum ?? isSumStation(station)) return hours.reduce((s, h) => s + h.a + h.b + h.c, 0);
  const first3 = hours.slice(0, 3);
  return ['a', 'b', 'c'].reduce((s, l) => s + Math.min(MACHINE_SHIFT_CAP, first3.reduce((x, h) => x + h[l], 0)), 0);
}

/**
 * Miejsce pracy stanowiska z nagłówka kolumny: nagłówek to nazwa stanowiska + cyfra 1–9 (np. „1Si2” → miejsce 2).
 * Nagłówek bez cyfry (np. samo „Narz”) nie pasuje do żadnego miejsca, więc takie stanowisko ma 0 godzin (tak liczy dziś arkusz).
 */
export function slotNumber(header, station) {
  const h = String(header ?? '').trim(), st = String(station ?? '').trim();
  if (!st || h.toLocaleLowerCase('pl').indexOf(st.toLocaleLowerCase('pl')) !== 0) return null;
  const rest = h.slice(st.length);
  return /^[1-9]$/.test(rest) ? Number(rest) : null;
}

// ---------------------------------------------------------------------------
// Pojemność stanowiska: godziny na dobę i sumy narastające
// ---------------------------------------------------------------------------

/** Pojemność z listy dni: `days` = [{date: ms północy, hours}] rosnąco po dacie. */
export function buildCapacity(days) {
  const dates = days.map((d) => d.date);
  const prefix = [];
  let sum = 0;
  for (const d of days) { sum += Number(d.hours) || 0; prefix.push(sum); }
  return { dates, prefix };
}

const startOfDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Koniec operacji (odpowiednik formuły LET z arkusza). Od dnia startu sumujemy godziny dostępne na stanowisku dzień po dniu;
 * doba pracy zaczyna się o 6:00, więc godzina startu przesuwa wymaganą sumę o (godzina − 6). Wynik = dzień, w którym suma
 * osiąga wymaganą + godzina startu + (godziny − suma sprzed tego dnia). Zwraca ms albo null, gdy nie starcza dni w grafiku.
 */
export function computeEnd(startMs, hours, cap) {
  if (startMs == null || hours == null || !cap || !cap.dates.length) return null;
  const day0 = startOfDay(startMs);
  // pierwszy dzień grafiku >= dzień startu
  let lo = 0, hi = cap.dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cap.dates[mid] >= day0) hi = mid; else lo = mid + 1; }
  const first = lo;
  if (first >= cap.dates.length) return null;
  const base = first === 0 ? 0 : cap.prefix[first - 1];
  const startHour = Math.floor((startMs - day0) / 3600000);
  const required = hours + startHour - DAY_START_HOUR;
  // pierwszy dzień, w którym suma narastająca (od dnia startu) >= wymagana
  lo = first; hi = cap.dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cap.prefix[mid] - base >= required) hi = mid; else lo = mid + 1; }
  if (lo >= cap.dates.length) return null;
  const before = lo === first ? 0 : cap.prefix[lo - 1] - base;
  return cap.dates[lo] + (startMs - day0) + ((hours - before) * 3600000);
}

// ---------------------------------------------------------------------------
// Harmonogram: start z poprzedników, koniec, zależności
// ---------------------------------------------------------------------------

/**
 * Liczy start i koniec wszystkich operacji.
 * ops: [{ lp, preds: [lp…], startManual: ms|null, hours: liczba|null, endManual: ms|null, station }]
 *  - Start: ręczny (kolumna J), a gdy go nie ma: najpóźniejszy koniec poprzedników, o ile WSZYSTKIE wpisane poprzedniki istnieją i mają koniec; inaczej brak startu.
 *  - Koniec: ręczny (rzeczywisty, kolumna L) albo wyliczony z godzin na stanowisku; bez startu lub godzin brak końca.
 *  - Koniec poprzednika (także ręczny) jest startem następnika. Przy powtórzonym numerze lp liczy się pierwsza operacja.
 * capacity: { [stanowisko]: buildCapacity(...) }. Zwraca Map lp → { start, end, state } (state: ok | no-start | no-end | cycle).
 */
/**
 * Hierarchia numerów (do trzech poziomów): 100 = operacja, 100a = suboperacja (np. detal), 100aa = subsuboperacja (operacja na detalu w gnieździe).
 * Dziećmi węzła są numery dłuższe o jedną literę. Reguły (jednakowe na każdym poziomie):
 *  - dzieci wykonują się po kolei (a, b, …): pierwsze od startu rodzica (o ile rodzic ma własny start), kolejne po końcu poprzedniego,
 *    i nie wcześniej niż koniec ich własnych poprzedników;
 *  - rodzic bez własnego startu (ręcznego, z poprzedników albo z kolejności wśród rodzeństwa) dziedziczy start po PIERWSZYM dziecku;
 *  - rodzic bez własnego czasu trwa do końca ostatniego dziecka (czas = suma czasów dzieci, możliwe przerwy);
 *  - puste stanowisko dziedziczy się po rodzicu.
 */
const SCHED_COLL = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
export function computeSchedule(ops, capacity) {
  const byLp = new Map();
  for (const op of ops) if (!byLp.has(String(op.lp))) byLp.set(String(op.lp), op);

  const isSub = (lp) => { const p = subParent(lp); return p != null && byLp.has(p); };
  const children = new Map();
  for (const op of byLp.values()) if (isSub(op.lp)) { const p = subParent(op.lp); if (!children.has(p)) children.set(p, []); children.get(p).push(op); }
  for (const list of children.values()) list.sort((x, y) => SCHED_COLL.compare(String(x.lp), String(y.lp)));
  const kidsOf = (op) => children.get(String(op.lp));
  const hasPreds = (op) => (op.preds || []).some((x) => String(x ?? '').trim());
  // własne źródło startu: ręczny start, poprzednicy albo miejsce w kolejności rodzeństwa (start od rodzica z własnym startem albo po poprzednim)
  const ownMemo = new Map();
  const hasOwnStart = (op) => {
    const key = String(op.lp);
    if (ownMemo.has(key)) return ownMemo.get(key);
    ownMemo.set(key, false);
    let v = op.startManual != null || hasPreds(op);
    if (!v && isSub(key)) { const par = byLp.get(subParent(key)); v = kidsOf(par).indexOf(op) > 0 || hasOwnStart(par); }
    ownMemo.set(key, v);
    return v;
  };
  const chopped = (op) => !!kidsOf(op) && !(op.hours > 0);     // węzeł złożony z dzieci (bez własnego czasu)
  const stationOf = (op) => op.station || (isSub(op.lp) ? stationOf(byLp.get(subParent(op.lp))) : '');

  // Start (S) i koniec (E) liczone osobno: dzieci czekają na start rodzica, a koniec rodzica zależy od dzieci.
  const sMemo = new Map(), eMemo = new Map(), visiting = new Set();
  const CYC = { v: null, cyc: true };
  const memo = (map, key, fn) => {
    if (map.has(key)) return map.get(key);
    if (visiting.has(key)) return CYC;
    visiting.add(key);
    const r = fn();
    visiting.delete(key);
    map.set(key, r);
    return r;
  };
  const S = (op) => memo(sMemo, 's:' + op.lp, () => {
    if (op.startManual != null) return { v: op.startManual, cyc: false };
    if (!hasOwnStart(op) && kidsOf(op)) return S(kidsOf(op)[0]);          // dziedziczy start po pierwszym dziecku
    const ends = []; let all = true, cyc = false;
    const take = (r) => { if (r.cyc) cyc = true; if (r.v == null) all = false; else ends.push(r.v); };
    if (isSub(op.lp)) {
      const par = byLp.get(subParent(op.lp)), sibs = kidsOf(par), idx = sibs.indexOf(op);
      if (idx > 0) take(E(sibs[idx - 1]));
      else if (hasOwnStart(par)) take(S(par));
    }
    for (const p of (op.preds || []).map((x) => String(x ?? '').trim()).filter(Boolean)) {
      const po = byLp.get(p);
      if (!po) { all = false; continue; }
      take(E(po));
    }
    if (cyc) return CYC;
    return { v: all && ends.length ? Math.max(...ends) : null, cyc: false };
  });
  const E = (op) => memo(eMemo, 'e:' + op.lp, () => {
    if (op.endManual != null) return { v: op.endManual, cyc: false };
    const s = S(op);
    if (s.cyc) return CYC;
    if (chopped(op)) {
      let all = true, cyc = false, max = null;
      for (const k of kidsOf(op)) { const r = E(k); if (r.cyc) cyc = true; if (r.v == null) all = false; else max = max == null ? r.v : Math.max(max, r.v); }
      if (cyc) return CYC;
      return { v: all ? max : null, cyc: false };
    }
    if (s.v == null || op.hours == null) return { v: null, cyc: false };
    return { v: computeEnd(s.v, op.hours, capacity && capacity[stationOf(op)]), cyc: false };
  });

  const result = new Map();
  for (const op of byLp.values()) {
    const s = S(op), e = E(op);
    if (s.cyc || e.cyc) { result.set(String(op.lp), { start: null, end: null, state: 'cycle' }); continue; }
    result.set(String(op.lp), { start: s.v, end: e.v, state: s.v == null ? 'no-start' : e.v == null ? 'no-end' : 'ok' });
  }
  return result;
}

/** Numer rodzica: numer bez ostatniej litery („100aa” → „100a”, „100a” → „100”); null dla operacji głównej (sama liczba). */
export function subParent(lp) {
  const m = /^(\d+\p{L}*)\p{L}$/u.exec(String(lp));
  return m ? m[1] : null;
}

/** Poziom numeru: 0 = operacja, 1 = suboperacja, 2 = subsuboperacja (liczba liter po numerze). */
export const depthOf = (lp) => { const m = /^\d+(\p{L}*)$/u.exec(String(lp)); return m ? [...m[1]].length : 0; };

// ---------------------------------------------------------------------------
// Klucz sortowania „Stat.” (kolumna z AB i I) oraz numer seryjny daty jak w Arkuszach
// ---------------------------------------------------------------------------

const EPOCH_1899 = Date.UTC(1899, 11, 30);
/** Numer seryjny daty z godziną (dni od 30.12.1899), np. 14.11.2026 14:00 → 46340,5833… */
export const toSerial = (ms) => (ms - EPOCH_1899) / DAY_MS;

/**
 * Grupa i klucz sortowania: zakończone (`zak.`) = grupa 0, operacje bez stanowiska albo poza horyzontem (start dalej niż `horizonDays` od `todayMs`) = grupa 1,
 * pozostałe = grupa 2 sortowana po stanowisku, potem po starcie. Odpowiada tekstowemu kluczowi „stanowisko + numer seryjny startu” z arkusza.
 */
export function sortKey(op, start, horizonDays, todayMs) {
  if (String(op.zak ?? '').trim().toLowerCase() === 'zak.') return { group: 0, station: '', start: 0 };
  const inHorizon = start != null && start <= todayMs + horizonDays * DAY_MS;
  if (op.station && inHorizon) return { group: 2, station: String(op.station), start };
  return { group: 1, station: '', start: start ?? Infinity, noName: !String(op.element ?? '').trim() };
}
export function compareKeys(a, b) {
  if (a.group !== b.group) return a.group - b.group;
  if (a.station !== b.station) return a.station.localeCompare(b.station, 'pl');
  return a.start - b.start;
}
