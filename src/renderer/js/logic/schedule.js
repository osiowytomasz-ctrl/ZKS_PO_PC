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
export function computeSchedule(ops, capacity) {
  const byLp = new Map();
  for (const op of ops) if (!byLp.has(String(op.lp))) byLp.set(String(op.lp), op);

  // Suboperacje: numer główny + litery (np. 3000a). Wykonują się po kolei (a, b, …) od startu operacji głównej (albo później, jeśli czekają na swoje
  // poprzedniki), mają własny czas. Operacja główna bez własnego czasu trwa od swojego startu do końca ostatniej suboperacji (czas = suma, możliwe przerwy).
  const isSub = (lp) => { const p = subParent(lp); return p != null && byLp.has(p); };
  const children = new Map();
  for (const op of byLp.values()) if (isSub(op.lp)) { const p = subParent(op.lp); if (!children.has(p)) children.set(p, []); children.get(p).push(op); }
  for (const list of children.values()) list.sort((x, y) => String(x.lp).localeCompare(String(y.lp), 'pl', { numeric: true, sensitivity: 'base' }));
  const chopped = (op) => children.has(String(op.lp)) && !(op.hours > 0);     // operacja główna złożona z suboperacji (bez własnego czasu)

  // Start (S) i koniec (E) liczone osobno, żeby suboperacje mogły czekać na start operacji głównej, a jej koniec zależał od suboperacji.
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
    const ends = []; let all = true, cyc = false;
    const take = (r) => { if (r.cyc) cyc = true; if (r.v == null) all = false; else ends.push(r.v); };
    if (isSub(op.lp)) {
      const parent = byLp.get(subParent(op.lp)), sibs = children.get(parent.lp), idx = sibs.indexOf(op);
      take(idx > 0 ? E(sibs[idx - 1]) : S(parent));
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
      for (const k of children.get(String(op.lp))) { const r = E(k); if (r.cyc) cyc = true; if (r.v == null) all = false; else max = max == null ? r.v : Math.max(max, r.v); }
      if (cyc) return CYC;
      return { v: all ? max : null, cyc: false };
    }
    const sub = isSub(op.lp);
    const station = sub ? (op.station || byLp.get(subParent(op.lp)).station) : op.station;
    if (s.v == null || op.hours == null) return { v: null, cyc: false };
    return { v: computeEnd(s.v, op.hours, capacity && capacity[station]), cyc: false };
  });

  const result = new Map();
  for (const op of byLp.values()) {
    const s = S(op), e = E(op);
    if (s.cyc || e.cyc) { result.set(String(op.lp), { start: null, end: null, state: 'cycle' }); continue; }
    result.set(String(op.lp), { start: s.v, end: e.v, state: s.v == null ? 'no-start' : e.v == null ? 'no-end' : 'ok' });
  }
  return result;
}

/** Numer operacji głównej dla suboperacji („3000a” → „3000”); null, gdy to nie jest numer suboperacji. */
export function subParent(lp) {
  const m = /^(\d+)\p{L}+$/u.exec(String(lp));
  return m ? m[1] : null;
}

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
