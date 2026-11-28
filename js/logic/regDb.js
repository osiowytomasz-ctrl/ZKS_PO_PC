// Rejestry zużycia w bazie Firebase – Etap 1 przejścia z arkusza (docs/MIGRACJA_ARKUSZ_DO_BAZY.md): ZP (zużycie płytek skrawających, zapisuje je m.in. Skaner → pobranie części)
// i ZwG (zużycie wierteł, gwintowników i trepanów). W bazie są kolumny WPISYWANE (lp, symbol / wymiary, ilość, data, kto, uwaga); kolumny liczone (ƒ) liczy program z PSWT:
// Kolumny liczone arkusza (ZP: stan, rodzaj, koszt; ZwG: koszt) nie są przenoszone – ustalenie użytkownika: niepotrzebne.
// Wyszukiwanie w PSWT po symbolu (kol. B), całe PSWT od wiersza 2, bez rozróżniania wielkości liter. Czyste funkcje – testy: test/reg-db.test.js.
import { parseDate } from './common.js';
import { parseNumber } from './destroyed.js';
import { isoOf, wallClockMs } from './znDb.js';

export const REGISTERS = {
  zp: { key: 'zp', short: 'ZP', name: 'ZP – zużycie płytek skrawających', sheet: 'ZP', dataStart: 3, cols: { lp: 0, code: 1, qty: 2, date: 3, who: 4 }, computed: {},
    heads: ['Lp.', 'Symbol płytki / oprzyrządowania', 'Ile', 'Data', 'Osoba montująca'] },
  zwg: { key: 'zwg', short: 'ZwG', name: 'ZwG – zużycie wierteł, gwintowników i trepanów', sheet: 'ZwG', dataStart: 3, cols: { lp: 0, code: 1, qty: 2, date: 3 }, computed: {},
    heads: ['Lp.', 'Wymiary (Φ…Lr…)', 'Ilość', 'Pobrano'] },
};
export const CHUNK = 300;   // wpisów w jednym dokumencie bazy (reg_rows/{klucz}_{nnn})
export const chunkOf = (n) => Math.floor(n / CHUNK);

/** Kolumny karty ZP / ZwG: wpisy z wartości wyświetlanych (jak baseSheet) → wpisy do bazy { n (numer wiersza arkusza), lp, code, qty, at, who, note }. Wiersze bez symbolu pomijane. */
export function entriesFromSheet(cfg, values) {
  const out = [], v = values || [], c = cfg.cols;
  for (let i = cfg.dataStart - 1; i < v.length; i++) {
    const r = v[i] || [], code = String(r[c.code] ?? '').trim();
    if (!code) continue;
    const d = parseDate(r[c.date]), qty = parseNumber(r[c.qty]);
    const e = { n: i + 1, lp: String(r[c.lp] ?? '').trim(), code, qty: qty == null ? 0 : qty, at: isoOf(d ? d.getTime() : null), who: c.who == null ? '' : String(r[c.who] ?? '').trim() };
    if (!e.at && String(r[c.date] ?? '').trim()) e.dateText = String(r[c.date]).trim();
    if (c.note != null && String(r[c.note] ?? '').trim()) e.note = String(r[c.note]).trim();
    out.push(e);
  }
  return out;
}

const p2 = (n) => String(n).padStart(2, '0');
export const plDateTime = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] : ''}` : ''; };
const num = (n) => (n == null ? '' : String(n).replace('.', ','));

/** Wiersze do tabeli w programie (kolejność jak w arkuszu): tablica pól tekstowych zgodna z cfg.heads. */
export function displayRows(cfg, entries, { extraWho = false } = {}) {
  return [...(entries || [])].sort((a, b) => a.n - b.n).map((e) => {
    const row = [];
    Object.defineProperty(row, '_n', { value: e.n, enumerable: false });   // numer wpisu (do usuwania zaznaczonego wiersza)
    row[cfg.cols.lp] = e.lp; row[cfg.cols.code] = e.code; row[cfg.cols.qty] = num(e.qty); row[cfg.cols.date] = plDateTime(e.at) || e.dateText || ''; if (cfg.cols.who != null) row[cfg.cols.who] = e.who || '';
    if (cfg.cols.note != null) row[cfg.cols.note] = e.note || '';
    if (extraWho && cfg.cols.who == null) row[cfg.heads.length] = e.who || '';   // rejestr bez kolumny osoby w arkuszu (ZwG): osoba z bazy – dodatkowa kolumna tylko w programie
    return row;
  });
}

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const near = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);
/**
 * Porównanie rejestru z arkusza z bazą: po numerze wiersza arkusza (n), pola wpisywane (kolumny liczone ƒ – stan, rodzaj, koszt – nie są używane). Wynik: { sheet, db, onlySheet, onlyDb, diffs, expected, ok }.
 * `expected` – różnice, w których arkusz ma pole liczone puste, a program je policzył (formuła arkusza nie znalazła symbolu albo odwołuje się do innego wiersza); `diffs` – reszta.
 */
export function compareRegister(cfg, sheetValues, dbEntries) {
  const sheet = entriesFromSheet(cfg, sheetValues), mdb = new Map((dbEntries || []).map((e) => [e.n, e])), seen = new Set(), diffs = [], expected = [], onlySheet = [];
  for (const e of sheet) {
    const o = mdb.get(e.n);
    if (!o) { onlySheet.push(e.n); continue; }
    seen.add(e.n);
    const chk = (field, ok, sheetVal, dbVal, soft = false) => { if (ok) return; (soft && (sheetVal == null || sheetVal === '') ? expected : diffs).push({ n: e.n, field, sheet: sheetVal, db: dbVal }); };
    chk('code', eq(e.code, o.code), e.code, o.code); chk('qty', near(e.qty, o.qty, 0.0001), e.qty, o.qty); chk('at', (e.at || '') === (o.at || ''), e.at, o.at); if (cfg.cols.who != null) chk('who', eq(e.who, o.who), e.who, o.who);
    if (cfg.cols.note != null) chk('note', eq(e.note, o.note), e.note, o.note);
  }
  const onlyDb = (dbEntries || []).filter((e) => !seen.has(e.n)).map((e) => e.n);
  return { sheet: sheet.length, db: (dbEntries || []).length, onlySheet, onlyDb, diffs, expected, ok: !onlySheet.length && !onlyDb.length && !diffs.length };
}

/** Nowy wpis zużycia ZwG z formularza { code, qty, date ('rrrr-mm-dd' albo pusta = dziś), who } → { entry } (bez n) albo { error }. */
export function makeRegEntry(f, now = new Date()) {
  const code = String((f && f.code) ?? '').trim();
  if (!code) return { error: 'Podaj symbol / wymiary.' };
  const qty = parseNumber(f && f.qty);
  if (qty == null || qty <= 0) return { error: 'Podaj ilość (większą od zera).' };
  const raw = String((f && f.date) ?? '').trim() || `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const d = parseDate(raw);
  if (!d) return { error: 'Podaj poprawną datę.' };
  return { entry: { lp: '', code, qty, at: isoOf(d.getTime()), who: String((f && f.who) ?? '').trim() } };
}

/** Dopisek przy nazwisku we wpisie dodanym ręcznie przez GOD-a. */
export const MANUAL_MARK = 'wpis ręczny';
/**
 * Ręczny wpis zużycia (tylko GOD) – taki sam jak ze Skanera (symbol, ilość, data i godzina z minutami, osoba), a przy nazwisku dopisek „wpis ręczny”.
 * Formularz { code, qty, who } → { entry } (bez n) albo { error }. Odjęcie zużycia to usunięcie konkretnego wpisu (bez śladu zmiany) – nie ma osobnego wpisu z minusem.
 */
export function makeManualEntry(f, now = new Date()) {
  const code = String((f && f.code) ?? '').trim();
  if (!code) return { error: 'Podaj symbol.' };
  const qty = parseNumber(f && f.qty);
  if (qty == null || qty <= 0) return { error: 'Podaj ilość (większą od zera).' };
  const who = String((f && f.who) ?? '').trim();
  return { entry: { lp: '', code, qty, at: isoOf(Math.floor(wallClockMs(now) / 60000) * 60000), who: (who ? who + ' – ' : '') + MANUAL_MARK } };
}
