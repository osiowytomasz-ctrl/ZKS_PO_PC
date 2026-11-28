// Tabela uprawnień (Ustawienia → Uprawnienia – tabela): nadpisania domyślnych praw poszczególnych elementów modułów dla poziomów
// GOD / MASTER / CLERIK / TOURIST / PEASANT. Plik bez zależności (importują go funkcje dostępu: grafikAccess, toolroomAccess, appAccess, harmAccess).
// Stan elementu na poziomie: 'write' (ZAPIS – widoczny i można go używać), 'read' (ODCZYT – widoczny, bez możliwości zmian), 'hidden' (UKRYTY).
// Element rodzaju 'edit' (przycisk / opcja zmieniająca dane) jest dostępny tylko w stanie ZAPIS; rodzaju 'view' (widok, moduł, sekcja) – w stanie ZAPIS i ODCZYT.
// Brak nadpisania = dotychczasowe zasady (kod funkcji dostępu). Poziom „---” (brak dostępu) nigdy nie dostaje więcej niż daje kod.
// UWAGA: tabela steruje programem (przyciski, widoki). Twarde blokady po stronie serwera (reguły Firestore, Api.gs) zostają bez zmian, więc nadanie praw
// ponad nie nie wystarczy do zapisu w bazie – rozszerzenie praw zapisu wymaga też zmiany reguł.

export const STATE_LABELS = { write: 'ZAPIS', read: 'ODCZYT', hidden: 'UKRYTY' };
export const STATES = ['write', 'read', 'hidden'];
/** Poziomy w tabeli – od najwyższego (kolejność kolumn). */
export const MATRIX_LEVELS = ['god', 'master', 'clerik', 'tourist', 'peasant'];

let over = {};
const listeners = new Set();

/** Nadpisania: { 'grafik.cells': { god: 'write', master: 'write', clerik: 'read', … }, … }. */
export function setOverrides(o) {
  over = o && typeof o === 'object' ? o : {};
  for (const fn of listeners) { try { fn(over); } catch { /* słuchacz nie psuje zmiany */ } }
}
export function getOverrides() { return over; }
export function onOverridesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Nadpisany stan elementu [id] na poziomie [level] albo undefined. */
export function overrideState(id, level) {
  const st = over[id] && over[id][level];
  return STATES.includes(st) ? st : undefined;
}

/** Czy element dostępny: [kind] 'edit' – tylko ZAPIS, 'view' – ZAPIS i ODCZYT; brak nadpisania (albo poziom „---”) → [baseOn] z kodu. */
export function resolveOn(id, level, kind, baseOn) {
  if (level === 'none' || level == null) return baseOn;
  const st = overrideState(id, level);
  if (!st) return baseOn;
  return kind === 'edit' ? st === 'write' : st !== 'hidden';
}

/** Nakłada nadpisania na flagi: [spec] = { nazwaFlagi: 'view' | 'edit' }, identyfikator elementu to `${mod}.${nazwaFlagi}`. */
export function overlayFlags(flags, mod, level, spec) {
  for (const [flag, kind] of Object.entries(spec || {})) if (flag in flags) flags[flag] = resolveOn(`${mod}.${flag}`, level, kind, !!flags[flag]);
  return flags;
}
