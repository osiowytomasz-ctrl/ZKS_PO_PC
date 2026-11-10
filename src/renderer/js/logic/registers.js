// Logika rejestrów w Skanerze (odpowiednik RegisterLogic.kt): rozpoznanie rodzaju kodu QR, rozbiór pól i walidacja.
// Kody mają pola w ogranicznikach, np. *komis*#przewodnik#@nr operacji@. Serwer rozbiera kod tak samo i jest decydujący.

import { resolveCode } from './scanner.js';

export const LOCK_SECONDS = 15;
export const OPER_STATUSES = ['Start', 'W toku', 'Koniec'];

/** Tekst między pierwszym wystąpieniem ogranicznika a następnym; '' gdy brak (jak mp_between_ w backendzie). */
export function between(str, startChar, endChar = startChar) {
  const s = String(str ?? '');
  const start = s.indexOf(startChar);
  if (start === -1) return '';
  const end = s.indexOf(endChar, start + 1);
  return end === -1 ? '' : s.slice(start + 1, end);
}

const MARKERS = '*#@^$⍵!~';

/**
 * Rodzaj kodu po znakach rozdzielających; Skaner sam przełącza się na właściwą opcję:
 * `⍵` = detal, `!` lub `~` = dokument, `#` lub `@` = operacja. Kod z listy produktów (products) i kod bez tych znaków to produkt.
 * Zwraca 'none' | 'product' | 'detail' | 'document' | 'operation' | 'unknown' (są znaki, ale rodzaj nieznany).
 * To tylko rozpoznanie rodzaju; poprawność pól sprawdza `valid` z parse*Code.
 */
export function classify(input, products = []) {
  const text = String(input ?? '').trim();
  if (!text) return 'none';
  if (resolveCode(text, products) !== null) return 'product';
  if (text.includes('⍵')) return 'detail';
  if (text.includes('!') || text.includes('~')) return 'document';
  if (text.includes('#') || text.includes('@')) return 'operation';
  if ([...text].some((c) => MARKERS.includes(c))) return 'unknown';
  return 'product';
}

/** Pola kodu detalu: komis, nr rysunku, nr pozycji, nr kompletu. */
export function parseDetailCode(code) {
  const f = { komis: between(code, '*'), rysunek: between(code, '$'), pozycja: between(code, '⍵'), komplet: between(code, '^') };
  return {
    fields: f,
    valid: !!(f.komis && f.rysunek && f.pozycja && f.komplet),
    display: `Komis: ${f.komis}\nNr rysunku: ${f.rysunek}\nNr pozycji: ${f.pozycja}\nNr kompletu: ${f.komplet}`,
  };
}

/** Pola kodu operacji: komis, przewodnik, nr operacji (wymagane), klient, nr rysunku. */
export function parseOperCode(code) {
  const f = { komis: between(code, '*'), przewodnik: between(code, '#'), nr: between(code, '@'), klient: between(code, '^'), rysunek: between(code, '$') };
  return {
    fields: f,
    valid: !!(f.komis && f.przewodnik && f.nr),
    display: `Komis: ${f.komis}\nPrzewodnik: ${f.przewodnik}\nNr operacji: ${f.nr}\nKlient: ${f.klient}\nNr rysunku: ${f.rysunek}`,
  };
}

/** Pola kodu dokumentu: wszystkie siedem jest wymaganych. */
export function parseDocCode(code) {
  const f = {
    komis: between(code, '*'), przewodnik: between(code, '#'), typ: between(code, '^'), nazwa: between(code, '$'),
    rysunek: between(code, '!'), id: between(code, '~'), ilosc: between(code, '@'),
  };
  return {
    fields: f,
    valid: Object.values(f).every(Boolean),
    display: `Komis: ${f.komis}\nNr przewodnika: ${f.przewodnik}\nTyp dokumentu: ${f.typ}\nNazwa: ${f.nazwa}\nNr rysunku: ${f.rysunek}\nNr id: ${f.id}\nIlość operacji: ${f.ilosc}`,
  };
}

/** Ilość sztuk jako tekst (liczba ≥ 1, przecinek dozwolony) albo null. */
export function parsePieces(input) {
  const text = String(input ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 1 ? text : null;
}

/** Ilość zlecona na liście detali: liczba całkowita ≥ 1 (jak w backendzie) albo null. */
export function parseOrdered(input) {
  const text = String(input ?? '').trim();
  return /^\d+$/.test(text) && Number(text) >= 1 ? text : null;
}

/** Wiersze tabeli „zaległe operacje” / „operacje” jako tekst do okna potwierdzenia. */
export function operationsText(list) {
  if (!list || !list.length) return 'brak';
  return list.map((o) => `${o.nr} | ${o.komis} | ${o.przewodnik} | ${o.klient} | ${o.operator} | ${o.status}`).join('\n');
}

/** Wpisy rejestru lub listy po filtrze „zawiera” (bez wielkości liter) na wszystkich polach tekstowych. */
export function filterRows(rows, query, keys) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
}
