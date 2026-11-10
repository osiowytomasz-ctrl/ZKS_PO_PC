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
export function stationHours(station, slotCodes) {
  const hours = (slotCodes || []).slice(0, 9).map(shiftHours);
  if (isSumStation(station)) return hours.reduce((s, h) => s + h.a + h.b + h.c, 0);
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
  const result = new Map();
  const visiting = new Set();

  function resolve(op) {
    const key = String(op.lp);
    if (result.has(key) && byLp.get(key) === op) return result.get(key);
    if (visiting.has(key)) return { start: null, end: null, state: 'cycle' };
    visiting.add(key);
    let start = null, state = 'ok';
    if (op.startManual != null) {
      start = op.startManual;
    } else {
      const preds = (op.preds || []).map((p) => String(p ?? '').trim()).filter(Boolean);
      if (preds.length) {
        const ends = [];
        let allResolved = true, cyc = false;
        for (const p of preds) {
          const po = byLp.get(p);
          if (!po) { allResolved = false; continue; }
          const r = resolve(po);
          if (r.state === 'cycle') cyc = true;
          if (r.end == null) allResolved = false; else ends.push(r.end);
        }
        if (cyc) state = 'cycle';
        else if (allResolved && ends.length) start = Math.max(...ends);
      }
    }
    let end = null;
    if (state !== 'cycle') {
      if (op.endManual != null) end = op.endManual;
      else if (start != null && op.hours != null) end = computeEnd(start, op.hours, capacity && capacity[op.station]);
      state = start == null ? 'no-start' : end == null ? 'no-end' : 'ok';
    }
    visiting.delete(key);
    const res = { start: state === 'cycle' ? null : start, end: state === 'cycle' ? null : end, state };
    if (byLp.get(key) === op) result.set(key, res);
    return res;
  }
  for (const op of ops) { const r = resolve(op); if (byLp.get(String(op.lp)) === op) result.set(String(op.lp), r); }
  return result;
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
