// Zakupy (karta „Zakupy”) w bazie Firebase – Etap 1 przejścia z arkusza (docs/MIGRACJA_ARKUSZ_DO_BAZY.md). Archiwum (Zakupy_ar) zostaje w arkuszu – przenoszenie do archiwum bez zmian.
// W bazie każdy wiersz karty (numer n = numer wiersza arkusza) to { v: { B…L: tekst jak w arkuszu }, ov?: { J } }; kolumny liczone: J (znak „x”, gdy jest ilość zakupiona w D)
// i M (klucz z ZMW: ŚRODEK(G;9;2) & ŚRODEK(G;6;2) & ŚRODEK(G;1;4)). Wartości ręczne w miejsce formuły (np. „x” wpisane w J) zapisujemy w `ov`.
// Dane dla widoku Zakupy mają ten sam kształt co z API getZakupyData: { rows: [{ rowNumber, columnA … columnL }] }. Czyste funkcje – testy: test/zakupy-db.test.js.
import { parseDate, formatDate } from './common.js';

const LETTERS = 'ABCDEFGHIJKL'.split('');
const INPUT = LETTERS.filter((c) => c !== 'J');   // A–L bez J (liczone)
const mid = (s, start, len) => String(s ?? '').substr(start - 1, len);
export const computedJ = (v) => (String((v && v.D) ?? '').trim() !== '' ? 'x' : '');
export const computedM = (v) => (String((v && v.G) ?? '') === '' ? '' : mid(v.G, 9, 2) + mid(v.G, 6, 2) + mid(v.G, 1, 4));

/** Wiersze karty (wartości wyświetlane z baseSheet, wiersz 1 = nagłówki) → wpisy do bazy; puste wiersze pomijane (jak getZakupyData). */
export function entriesFromSheet(values) {
  const out = [];
  (values || []).forEach((r, i) => {
    if (i < 1) return;
    const v = {};
    for (const c of INPUT) { const t = String((r || [])[LETTERS.indexOf(c)] ?? '').trim(); if (t !== '') v[c] = String(r[LETTERS.indexOf(c)]); }
    const jRaw = String((r || [])[9] ?? '').trim();
    const any = Object.keys(v).length || jRaw !== '';
    if (!any) return;
    const e = { n: i + 1, v };
    if (jRaw.toLowerCase() !== computedJ(v)) e.ov = { J: jRaw };   // ręcznie wpisane / wyczyszczone J
    out.push(e);
  });
  return out;
}

/** Wpisy z bazy → wiersze dla widoku Zakupy (jak getZakupyData). */
export function toApiRows(entries) {
  return [...(entries || [])].sort((a, b) => a.n - b.n).map((e) => {
    const v = e.v || {}, row = { rowNumber: e.n };
    for (const c of LETTERS) row['column' + c] = c === 'J' ? (e.ov && 'J' in e.ov ? e.ov.J : computedJ(v)) : (v[c] ?? '');
    return row;
  });
}

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * Porównanie karty Zakupy z arkusza z bazą: po numerze wiersza, kolumny A–L (J liczona) jako tekst; kolumna M (klucz z ZMW) nie jest importowana. Wynik: { sheet, db, onlySheet, onlyDb, diffs, expected, ok }.
 */
export function compareZakupy(sheetValues, entries) {
  const sheet = entriesFromSheet(sheetValues), mdb = new Map((entries || []).map((e) => [e.n, e])), seen = new Set(), diffs = [], onlySheet = [];
  const rows = new Map(toApiRows(entries).map((r) => [r.rowNumber, r]));
  for (const e of sheet) {
    const raw = (sheetValues || [])[e.n - 1] || [], o = mdb.get(e.n);
    if (!o) { onlySheet.push(e.n); continue; }
    seen.add(e.n);
    const row = rows.get(e.n);
    for (const c of LETTERS) { const s = String(raw[LETTERS.indexOf(c)] ?? ''), d = String(row['column' + c] ?? ''); if (!eq(s, d)) diffs.push({ n: e.n, field: c, sheet: s, db: d }); }
  }
  const onlyDb = (entries || []).filter((e) => !seen.has(e.n)).map((e) => e.n);
  return { sheet: sheet.length, db: (entries || []).length, onlySheet, onlyDb, diffs, expected: [], ok: !onlySheet.length && !onlyDb.length && !diffs.length };
}

// ---- zapis (te same reguły co API w Apps Script: api_updateZakupCells_, updateZakupyItem, addZakupyItem) ----
export const COLS = { B: 'B', C: 'C', D: 'D', E: 'E', G: 'G', I: 'I', K: 'K', L: 'L' };   // kolumny edytowalne komórkowo
/** Normalizacja do kontroli konfliktu (data B jako rrrr-mm-dd, reszta bez wielkości liter) – jak `norm` w api_updateZakupCells_. */
export function normCell(col, x) {
  const t = String(x ?? '').trim();
  if (col === 'B') {
    let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}`;
    m = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${('0' + m[2]).slice(-2)}-${('0' + m[1]).slice(-2)}`;
  }
  return t.toLowerCase();
}
/** Zmiana jednej komórki: { entry } albo { conflict: aktualna wartość } (gdy [expect] podano i się różni), albo { error }. */
export function applyCell(entry, col, value, expect, check = true) {
  const c = String(col || '').toUpperCase();
  if (!COLS[c]) return { error: 'badcol' };
  const v = { ...(entry.v || {}) }, cur = String(v[c] ?? '');
  if (check && normCell(c, cur) !== normCell(c, expect)) return { conflict: cur };
  const t = String(value ?? '');
  if (t.trim() === '') delete v[c]; else v[c] = t;
  const next = { ...entry, v };
  return { entry: next };
}
/** Realizacja zakupu (updateZakupyItem): B data zakupu, C kod, D ilość, E PZ, F cena, G ZMW, K opis, L uwagi, J = „x”. */
export function applyRealization(entry, d) {
  const v = { ...(entry.v || {}) };
  const set = (c, x) => { const t = String(x ?? ''); if (t.trim() === '') delete v[c]; else v[c] = t; };
  set('B', d.zakup); set('C', d.kod); set('D', d.iloscKupiona); set('E', d.pz); set('F', d.cena); set('G', d.zmw); set('K', d.opis); set('L', d.uwagi);
  return { ...entry, v, ov: { ...(entry.ov || {}), J: 'x' } };
}
/** Nowa pozycja zamówienia (addZakupyItem): C kod, I ilość zamówiona, F cena (tylko kopia po częściowym zakupie), G ZMW, H data zamówienia (dziś), K opis, L uwagi. */
export function newEntry(d, now = new Date()) {
  const v = {}, set = (c, x) => { const t = String(x ?? '').trim(); if (t !== '') v[c] = t; };
  set('C', d.kod); set('I', d.ilosc); set('F', d.cena); set('G', d.zmw);
  v.H = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  set('K', d.opis); set('L', d.uwagi);
  return { v };
}
export { parseDate, formatDate };
