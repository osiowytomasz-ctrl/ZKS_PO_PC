// Logika Skanera (odpowiednik ScanLogic.kt).
import { normalize } from './common.js';

export const LOCK_SECONDS = 15;
const MAX_SUGGESTIONS = 5;

/** Kod dokładnie taki jak na liście z arkusza (serwer porównuje dosłownie) albo null. */
export function resolveCode(input, codes) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (codes.includes(text)) return text;
  const wanted = normalize(text);
  const matches = codes.filter((c) => normalize(c) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

export function suggestions(input, codes) {
  const text = String(input ?? '').trim();
  if (!text || codes.includes(text)) return [];
  const wanted = normalize(text);
  return codes.filter((c) => normalize(c).includes(wanted)).slice(0, MAX_SUGGESTIONS);
}

/** Ilość jako tekst z kropką dziesiętną albo null (puste, ≤ 0, nie liczba). Przyjmuje przecinek. */
export function parseQuantity(input) {
  const text = String(input ?? '').trim().replace(',', '.');
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? text : null;
}

/** Wszystkie kody zawierające wpisany tekst (bez limitu, do przewijanej listy); pusty tekst = cała lista. */
export function filterCodes(input, codes) {
  const wanted = normalize(input);
  return wanted ? codes.filter((c) => normalize(c).includes(wanted)) : codes;
}
