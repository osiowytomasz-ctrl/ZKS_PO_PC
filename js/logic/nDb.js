// Karta N (dziennik lokalizacji narzędzi: ToolTrack i Skaner → „Narzędzia”) w bazie Firebase – Etap 1 przejścia z arkusza (docs/MIGRACJA_ARKUSZ_DO_BAZY.md).
// Arkusz: A data i godzina, B kod narzędzia, C lokalizacja, D login; bez formuł. Baza: wpisy { at (rrrr-mm-ddTgg:mm:ss), code, loc, who }. Ostatnia lokalizacja narzędzia = wpis z największą datą (kolumna Q w PSWT).
// Czyste funkcje – testy: test/n-db.test.js.
import { parseDate } from './common.js';
import { isoOf, wallClockMs } from './znDb.js';

const p2 = (n) => String(n).padStart(2, '0');
/** „rrrr-mm-ddTgg:mm[:ss]” → „dd.mm.rrrr gg:mm:ss” (jak w arkuszu). */
export const plFull = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}` : ''; };
const isoSec = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`; };

/** Wartości karty N (baseSheet; wiersz 2 = nagłówki, dane od wiersza 3) → wpisy { n (wiersz arkusza), at, code, loc, who } (+ atText, gdy daty nie da się odczytać). Wiersze bez kodu pomijane. */
export function entriesFromSheet(values) {
  const out = [];
  (values || []).forEach((r, i) => {
    if (i < 2) return;   // wiersz 2 = nagłówki, dane od wiersza 3
    const code = String((r || [])[1] ?? '').trim();
    if (!code) return;
    const a = String(r[0] ?? '').trim(), d = parseDate(a);
    const e = { n: i + 1, at: d ? isoSec(d.getTime()) : '', code, loc: String(r[2] ?? '').trim(), who: String(r[3] ?? '').trim() };
    if (!d && a) e.atText = a;
    out.push(e);
  });
  return out;
}

/** Nowy wpis (zapis ToolTrack / Skaner): { code, loc, who } + czas lokalny [now]. */
export const newEntry = ({ code, loc, who }, now = new Date()) => ({ at: isoSec(wallClockMs(now)), code: String(code ?? '').trim(), loc: String(loc ?? '').trim(), who: String(who ?? '').trim() });

/** Wpisy z bazy → wartości jak z baseSheet (wiersz nagłówka + wiersze A–C), wejście silnika PSWT (latestLocation). */
export const toNValues = (entries) => [[], ...(entries || []).map((e) => [plFull(e.at) || e.atText || '', e.code, e.loc, e.who || ''])];

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * Porównanie dziennika z arkusza z bazą. Wpisy dodane w trybie równoległym nie znają numeru wiersza arkusza, więc zestawiamy je po kolei wg czasu (potem numer):
 * kod, lokalizacja i login muszą być takie same, a czas może się różnić do [tolSec] sekund (arkusz zapisuje czas serwera). Wynik jak w innych porównaniach: { sheet, db, onlySheet, onlyDb, diffs, expected, ok }.
 */
export function compareN(sheetValues, dbEntries, tolSec = 120) {
  const key = (e) => [e.at ? (parseDate(e.at) || { getTime: () => 0 }).getTime() : 0, e.n ?? 0];
  const sortE = (a) => [...a].sort((x, y) => { const kx = key(x), ky = key(y); return kx[0] - ky[0] || kx[1] - ky[1]; });
  const s = sortE(entriesFromSheet(sheetValues)), d = sortE(dbEntries || []), diffs = [];
  const m = Math.min(s.length, d.length);
  for (let i = 0; i < m; i++) {
    const a = s[i], b = d[i], at = key(a)[0], bt = key(b)[0], id = a.n ?? b.n;
    if (!eq(a.code, b.code)) diffs.push({ n: id, field: 'code', sheet: a.code, db: b.code });
    if (!eq(a.loc, b.loc)) diffs.push({ n: id, field: 'loc', sheet: a.loc, db: b.loc });
    if (!eq(a.who, b.who)) diffs.push({ n: id, field: 'who', sheet: a.who, db: b.who });
    if (Math.abs(at - bt) > tolSec * 1000) diffs.push({ n: id, field: 'at', sheet: a.at, db: b.at });
  }
  const onlySheet = s.slice(m).map((e) => e.n), onlyDb = d.slice(m).map((e) => e.n);
  return { sheet: s.length, db: d.length, onlySheet, onlyDb, diffs, expected: [], ok: !onlySheet.length && !onlyDb.length && !diffs.length };
}
export { isoOf };
