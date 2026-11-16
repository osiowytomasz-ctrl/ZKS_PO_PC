// Podpowiedzi w Planie: kto jest w Grafiku na danej zmianie danego dnia, zmiana bloku z listy, historyczne komisy.
// Czyste funkcje (testy: test/plan-hints.test.js); ten sam algorytm ma Android (ui/plan/PlanHints.kt).
import { shiftHours } from './schedule.js';
import { cleanName } from './grafik.js';

export const SHIFT_RE = /Zmiana\s*([123])\s*-\s*KARTA PRACY/i;
export const SHIFT_LETTER = { 1: 'a', 2: 'b', 3: 'c' };
export const SHIFT_NAMES = { 1: 'I zmiana', 2: 'II zmiana', 3: 'III zmiana' };

/** Blok „Zmiana N - KARTA PRACY”, do którego należy wiersz [r] (nagłówek albo wiersz pod nim) – albo null. */
export function blockOf(grid, r) {
  for (const b of grid.blocks || []) if (r >= b.headerRow && r <= b.lastRow) return b;
  return null;
}
/** Numer zmiany z tekstu nagłówka („Zmiana 2 - KARTA PRACY” → '2') albo null. */
export const shiftOfText = (t) => { const m = SHIFT_RE.exec(String(t ?? '')); return m ? m[1] : null; };
/** Ten sam tekst z inną zmianą (reszta – np. dopiski – bez zmian). */
export const withShift = (t, n) => String(t ?? '').replace(/(Zmiana\s*)[123](\s*-\s*KARTA PRACY)/i, `$1${n}$2`);

/** Klucz pracownika do porównania z Grafikiem: „Nazwisko Imi” (trzy litery imienia), bez wielkości liter. */
export const workerKey = (name) => cleanName(name).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Pracownicy Planu ([workers]) pogrupowani wg Grafiku dnia ([people] z grafikPeople) dla zmiany [shift] ('1'|'2'|'3'):
 *  - on: na tej zmianie (w Grafiku godziny w literze zmiany: a = I, b = II, c = III),
 *  - other: tego dnia na innej zmianie,
 *  - away: nieobecni / bez godzin (UT, L4, wolne…),
 *  - rest: bez wpisu w Grafiku tego dnia.
 * Każdy wpis: {name (jak na liście Planu), code (wpis z Grafiku), hours}.
 */
export function workersForShift(workers, people, shift) {
  const byKey = new Map(people.map((p) => [workerKey(p.fullName || p.name), p]));
  const letter = SHIFT_LETTER[shift];
  const out = { on: [], other: [], away: [], rest: [] };
  for (const w of workers || []) {
    const p = byKey.get(workerKey(w));
    if (!p) { out.rest.push({ name: w, code: '', hours: 0 }); continue; }
    const h = shiftHours(p.text), hours = h.a + h.b + h.c;
    const item = { name: w, code: p.text, hours: letter ? h[letter] : hours };
    if (letter && h[letter] > 0) out.on.push(item);
    else if (hours > 0) out.other.push({ ...item, hours });
    else out.away.push(item);
  }
  return out;
}

/** Fragment komisu w bieżącej linii: tekst po numerze pozycji („3. 26/9” → „26/9”). */
export const komisFragment = (line) => String(line ?? '').replace(/^\s*\d+\.\s*/, '').trim();
const KOMIS_TOKEN = /\b\d{2}\/\d{1,5}[a-zA-Z]?\b/g;

/**
 * Historyczne komisy z planu: linie kolumn z nagłówkiem „Komis” (bez numeru pozycji) i napisy w formacie komisu (np. 26/934) z całego arkusza,
 * plus [extra] (np. z Harmonogramu, wpisane wcześniej na tym komputerze). Kolejność: najczęstsze, potem alfabetycznie (od najnowszego roku).
 */
export function komisHistory(grid, extra = []) {
  const count = new Map();
  const add = (k, n = 1) => { const s = String(k ?? '').trim(); if (s && s.length <= 40) count.set(s, (count.get(s) || 0) + n); };
  const head = grid.values?.[0] || [];
  const komisCols = new Set(head.map((t, c) => (/komis/i.test(String(t)) ? c : -1)).filter((c) => c >= 0));
  (grid.values || []).forEach((row, r) => {
    if (!r) return;
    row.forEach((v, c) => {
      const text = String(v ?? '');
      if (komisCols.has(c)) for (const line of text.split('\n')) add(komisFragment(line));
      else for (const m of text.match(KOMIS_TOKEN) || []) add(m);
    });
  });
  for (const k of extra) add(k, 0.5);
  return [...count].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0], 'pl', { numeric: true })).map(([k]) => k);
}

/** Kolumna komisów (nagłówek zawiera „Komis”). */
export const isKomisColumn = (grid, c) => /komis/i.test(String(grid.values?.[0]?.[c] ?? ''));

/** Podpowiedzi dla wpisanego fragmentu: najpierw zaczynające się od niego, potem zawierające (bez wielkości liter); najwyżej [max]. */
export function komisSuggestions(history, fragment, max = 8) {
  const f = String(fragment ?? '').trim().toLowerCase();
  if (!f) return history.slice(0, max);
  const starts = [], contains = [];
  for (const k of history) { const l = k.toLowerCase(); if (l === f) continue; if (l.startsWith(f)) starts.push(k); else if (l.includes(f)) contains.push(k); }
  return [...starts, ...contains].slice(0, max);
}
