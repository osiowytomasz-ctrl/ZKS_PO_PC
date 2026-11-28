// PSWT w bazie Firebase – Etap 1 przejścia z arkusza (docs/MIGRACJA_ARKUSZ_DO_BAZY.md): wpisy { n (numer wiersza arkusza), v: { A…AU: tekst jak w arkuszu, bez kolumn liczonych }, [qv], [ah95] },
// kolumny ƒ liczy logic/pswtEngine.js. Kolumny AV–BG (dane generatora konturów) zostają poza tym modelem (kontury są w bazie osobno: nd_*). Czyste funkcje – testy: test/pswt-engine.test.js.
import { COMPUTED, computePswt } from './pswtEngine.js';
import { parseNumber } from './destroyed.js';
import { parseDate } from './common.js';
import { ROW_LEN, EXTRA_CUT, EXTRA_ACC, toLogicalValues } from './pswtLayout.js';

export const LAST_COL = 46;   // AU (indeks od 0) – ostatnia kolumna w bazie
const letter = (i) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const index = (l) => [...l].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export { letter as colLetter, index as colIndex };
/** Kolumny wpisywane w bazie (indeksy logiczne): A…AU oraz dodatkowe miejsca płytek 8–10 i części 6–10 (patrz logic/pswtLayout.js). */
export const DATA_COLS = [...Array.from({ length: LAST_COL + 1 }, (_, i) => i), ...EXTRA_CUT, ...EXTRA_ACC];
/**
 * Dane z baseSheet('PSWT') (układ fizyczny karty – stary albo nowy z 10 + 10 miejscami na płytki i części) → { layout, values, flags, rawAJ } w układzie logicznym; flagi i cena AJ
 * (liczone po stronie serwera, literami logicznymi) są przekazywane bez zmian.
 */
export function logicalSheet(d) {
  const t = toLogicalValues((d && d.values) || []);
  return { layout: t.layout, values: t.values, flags: (d && d.flags) || null, rawAJ: (d && d.rawAJ) || null };
}

/** Wartości karty PSWT (baseSheet; wiersz 1 = nagłówki, produkty od wiersza 2) + flagi wariantów formuł → { headers, entries }. Wiersze bez żadnej wartości wpisywanej pomijane. flags[i] = [qv, ah95, [litery kolumn liczonych ze stałą zamiast formuły]], rawAJ[i] = cena (liczba). */
export function entriesFromSheet(values, flags, rawAJ = null) {
  const v = values || [], headers = (v[0] || []).slice(0, LAST_COL + 1).map((x) => String(x ?? '')), out = [];
  const skip = new Set(COMPUTED);
  for (let i = 1; i < v.length; i++) {
    const row = v[i] || [], m = {};
    for (const c of DATA_COLS) { const l = letter(c); if (skip.has(l)) continue; const t = String(row[c] ?? ''); if (t.trim() !== '') m[l] = t; }
    if (!Object.keys(m).length) continue;
    const e = { n: i + 1, v: m }, f = (flags || [])[i];
    const ay = String(row[index('AY')] ?? '').trim(); if (ay !== '') e.ay = ay;   // PSWT AY = dawny kontur trzonu (pary x_y) – potrzebny katalogowi narzędzi; poza zakresem A–AU, osobne pole
    if (f && f[0] === 2) e.qv = 2;
    if (f && f[1] === 1) e.ah95 = 1;
    if (f && Array.isArray(f[2]) && f[2].length) { e.ov = {}; for (const l of f[2]) e.ov[l] = String(row[index(l)] ?? ''); }   // stałe w miejsce formuł (kolumny liczone)
    const aj = rawAJ && rawAJ[i]; if (typeof aj === 'number' && Number.isFinite(aj)) e.aj = aj;   // cena (AJ) w pełnej precyzji – wyświetlana jest zaokrąglona do groszy
    out.push(e);
  }
  return { headers, entries: out };
}

/**
 * Import z arkusza zastępuje wpisy w bazie – dane, których arkusz nie ma, przenosimy ze starych wpisów (po symbolu B, pierwszy wiersz): typ narzędzia (`tt`) zawsze, a dodatkowe miejsca płytek 8–10
 * i części 6–10 (CW…DD) tylko gdy karta jest jeszcze w starym układzie (nie ma na nie kolumn) i wpis ich nie ma. Zwraca liczbę wpisów, którym coś przeniesiono.
 */
export function carryOver(newEntries, oldEntries, layout = 'old') {
  const by = new Map();
  for (const o of oldEntries || []) { const k = String((o.v || {}).B ?? '').trim().toLowerCase(); if (k && !by.has(k)) by.set(k, o); }
  let n = 0;
  for (const e of newEntries) {
    const o = by.get(String((e.v || {}).B ?? '').trim().toLowerCase()); if (!o) continue;
    let moved = false;
    if (o.tt && !e.tt) { e.tt = o.tt; moved = true; }
    if (layout !== 'new') for (const c of [...EXTRA_CUT, ...EXTRA_ACC]) { const l = letter(c); if ((o.v || {})[l] && !(e.v || {})[l]) { e.v[l] = o.v[l]; moved = true; } }
    if (moved) n++;
  }
  return n;
}

/** Znacznik czasu z komórki karty N („dd.mm.rrrr gg:mm:ss”) do wyboru najnowszej lokalizacji. */
export const parseTs = (t) => { const d = parseDate(t); return d ? d.getTime() : null; };

const fmt = (x) => (typeof x === 'number' ? String(Math.round(x * 1e6) / 1e6).replace('.', ',') : String(x ?? ''));
/** Tabela do widoku Produkty: wiersze (tablice w układzie logicznym: A…AU, dalej miejsca 100–107 – płytki 8–10 i części 6–10) z kolumnami ƒ policzonymi; numery wierszy w `rowNumbers` (równolegle do wierszy). */
export function tableRows(entries, ctx) {
  const comp = computePswt(entries, ctx), rows = [], numbers = [];
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    const r = Array(ROW_LEN).fill(''), c = comp.get(e.n) || {};
    for (const [l, t] of Object.entries(e.v || {})) r[index(l)] = t;
    for (const l of COMPUTED) r[index(l)] = fmt(c[l]);
    rows.push(r); numbers.push(e.n);
  }
  return { rows, numbers, computed: comp };
}

/** Kolumny stanu (AQ, AR) arkusz wyświetla zaokrąglone do całości (0,8 → „1”), program trzyma dokładną wartość. */
const DISPLAY_ROUNDED = new Set(['AQ', 'AR']);
const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const eqText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * Porównanie kolumn liczonych: wartości z arkusza (baseSheet) z tym, co liczy program z bazy – po numerze wiersza, każda kolumna ƒ. Liczby z tolerancją 0,01 (arkusz pokazuje je zaokrąglone),
 * Wynik: { sheet, db, onlySheet, onlyDb, diffs, expected, ok, byColumn }.
 */
export function comparePswt(sheetValues, entries, ctx) {
  const sheetEntries = entriesFromSheet(sheetValues, null).entries, mdb = new Map(entries.map((e) => [e.n, e])), seen = new Set(), diffs = [], onlySheet = [];
  const comp = computePswt(entries, ctx), byColumn = {}, expected = [];
  for (const e of sheetEntries) {
    const o = mdb.get(e.n);
    if (!o) { onlySheet.push(e.n); continue; }
    seen.add(e.n);
    const raw = sheetValues[e.n - 1] || [], c = comp.get(e.n);
    // kolumny wpisywane (wartości z bazy = z arkusza)
    for (const [l, t] of Object.entries(e.v)) { const d = (o.v || {})[l]; if (!eqText(t, d)) diffs.push({ n: e.n, field: l, sheet: t, db: d ?? '' }); }
    for (const l of COMPUTED) {
      const s = String(raw[index(l)] ?? ''), d = c[l], sn = parseNumber(s);
      let same;
      if (typeof d === 'number') same = sn != null ? (Math.abs(sn - d) <= 0.0101 || (DISPLAY_ROUNDED.has(l) && Number.isInteger(sn) && roundHalfAway(d) === sn)) : (s.trim() === '' && d === 0);   // liczba z tolerancją (arkusz pokazuje zaokrąglone); puste = 0
      else if (d === '') same = s.trim() === '';
      else same = eqText(s, d);
      if (!same) {
        if (s.trim() === '' && d !== '' && d !== 0) { expected.push({ n: e.n, field: l, sheet: s, db: fmt(d) }); continue; }   // arkusz nie policzył (brak formuły w komórce), program policzył
        diffs.push({ n: e.n, field: l, sheet: s, db: fmt(d) + (l === 'AI' && c.aiMiss ? ` (brak komponentu ${c.aiMiss})` : '') }); byColumn[l] = (byColumn[l] || 0) + 1;
      }
    }
  }
  const onlyDb = entries.filter((e) => !seen.has(e.n)).map((e) => e.n);
  return { sheet: sheetEntries.length, db: entries.length, onlySheet, onlyDb, diffs, expected, ok: !onlySheet.length && !onlyDb.length && !diffs.length, byColumn };
}
