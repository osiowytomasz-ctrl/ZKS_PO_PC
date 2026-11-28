// Katalog narzędzi i dane Skanera liczone wprost z PSWT w bazie – zamiast karty ND_CACHE (docs/MIGRACJA_ARKUSZ_DO_BAZY.md): „Braki” i katalog wynikają z PSWT, nie są osobnym zbiorem.
// ND_CACHE = FILTER(PSWT!B; A < 4000; A <> ""; D <> "NARZ") + WYSZUKAJ.PIONOWO po symbolu (pierwszy wiersz o danym symbolu) – tu to samo z wpisów PSWT i wyników silnika (pswtEngine).
// Czyste funkcje – testy: test/pswt-catalog.test.js.
import { parseNumber } from './destroyed.js';
import { znFirst } from './pswtEngine.js';
import { CUT_LETTERS, ACC_LETTERS } from './pswtLayout.js';

/** Kolumny ND_CACHE → kolumny PSWT (numer z wiersza 2 karty ND_CACHE: 2 → C … 50 → AY). */
export const ND_MAP = { name: 'C', group: 'D', kind: 'E', diameter: 'F', angle: 'G', radius: 'H', length: 'J', ms: 'M', mk: 'N', info: 'O', firma: 'P', stan: 'AP', contour: 'AY' };
const CUT_COLS = CUT_LETTERS, ACC_COLS = ACC_LETTERS;   // ply1–10 (części skrawające), osp1–10 (akcesoria); miejsca 8–10 i 6–10 są dodatkowe (logic/pswtLayout.js)
/**
 * Kolor stanu (ND_CACHE!Q, formuła potwierdzona przez użytkownika): stosunek „Zapas” (kol. AQ = stan) do minimum (AN); tylko dla numerów < 1000.
 * Minimum 0 / puste → biały; ≤ 25% czerwony, ≤ 50% żółty, ≤ 75% zielony, powyżej – biały. Błąd formuły (minimum tekstowe) → pusty.
 */
export const COLOR_STEPS = [[0.25, '#ff0000'], [0.5, '#ffff00'], [0.75, '#00ff00']];
const WHITE = '#ffffff';
const lower = (s) => String(s ?? '').trim().toLowerCase();
const norm = (x) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');   // jak api_normCode_
export const splitNdList = (s) => String(s ?? '').split(';').map(norm).filter(Boolean);   // jak splitNdList_ w skrypcie (przypuszczalnie: po „;”, bez pustych)
/** IFERROR(WYSZUKAJ.PIONOWO(…); ""): komórka PSWT z błędem (#N/A, #VALUE!…) daje w katalogu puste pole. */
const cleanErr = (t) => (/^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)/i.test(String(t ?? '').trim()) ? '' : String(t ?? ''));
const fmt = (x) => (typeof x === 'number' ? String(Math.round(x * 1e6) / 1e6).replace('.', ',') : String(x ?? ''));

/** Kolor stanu dla wiersza: A – numer, AN – minimum, zapas – kolumna AQ (obie jako liczby lub null). */
export function stateColor(a, an, zapas, steps = COLOR_STEPS) {
  if (!an) return WHITE;
  if (a == null || !(a < 1000)) return WHITE;
  const ratio = (zapas || 0) / an;
  for (const [limit, color] of steps) if (ratio <= limit) return color;
  return WHITE;
}

/**
 * Wiersze katalogu (jak ND_CACHE) z wpisów PSWT: entries = [{ n, v }], computed = wynik computePswt (Map n → kolumny liczone), zn = wpisy ZN (zużycie narzędzia = procent pierwszego wpisu).
 * Wynik: [{ code, n, name, group, kind, diameter, angle, radius, length, ms, mk, info, firma, location, stan, zapas, dostepne, color, cutting[], accessories[], contour, wear }].
 */
export function catalogRows(entries, computed, zn = []) {
  const sorted = [...entries].sort((a, b) => a.n - b.n), first = new Map(), wearMap = znFirst(zn);
  for (const e of sorted) { const k = lower((e.v || {}).B); if (k && !first.has(k)) first.set(k, e); }
  const out = [];
  for (const e of sorted) {
    const v = e.v || {}, code = String(v.B ?? '').trim(), a = parseNumber(v.A);
    if (!code || String(v.A ?? '').trim() === '' || !(a < 4000) || lower(v.D) === 'narz') continue;
    const f = first.get(lower(code)), fv = f.v || {}, c = (computed.get(f.n) || {}), an = parseNumber(fv.AN), fa = parseNumber(fv.A);
    const row = { code, n: f.n, ay: String(f.ay ?? ''), tt: String(f.tt ?? '') };   // tt – typ narzędzia ustawiony w programie (mono | comp | holder)
    for (const [key, l] of Object.entries(ND_MAP)) row[key] = cleanErr(fv[l]);
    row.contour = String(f.ay ?? '').trim();
    row.location = fmt(c.Q); row.zapas = fmt(c.AQ); row.dostepne = fmt(c.AR);
    row.color = an == null && String(fv.AN ?? '').trim() !== '' ? '' : stateColor(fa, an, typeof c.AQ === 'number' ? c.AQ : 0);   // minimum tekstowe → błąd formuły → puste
    row.cutting = CUT_COLS.map((l) => cleanErr(fv[l]).trim()); row.accessories = ACC_COLS.map((l) => cleanErr(fv[l]).trim());
    const w = wearMap.get(lower(code)); row.wear = w == null ? '' : fmt(w);
    out.push(row);
  }
  return out;
}

/**
 * Lista narzędzi w kształcie odpowiedzi API getStToolOptions (`tools`, skrypt Code_ST.gs) z wierszy katalogu: kod znormalizowany (małe litery, pojedyncze spacje), pola columnX = kolumny PSWT
 * (D grupa, E rodzaj, F średnica – małe litery; G kąt, H promień, J długość – tekst jak w arkuszu; M, N mocowania – małe litery; O info; P firma), `location` małymi literami,
 * stock = „Zapas” (AQ, czyli stan liczony), status = „Stan” (AP), available = „Dostępne” (AR), wear = zużycie w procentach 0–100, partStatusColor = kolor stanu.
 * Brakuje jeszcze `detailsMap` (getAllToolDetailsMap – kontury, dane płytek, BN) – patrz docs/NIEZALEZNOSC_OD_ARKUSZA.md.
 */
/** parseNdPercent_ ze skryptu: „30%”, „0,3”, 30 → procent 0–100 (ułamek 0 < x ≤ 1 jest mnożony przez 100). */
export function parseNdPercent(value) {
  if (value === null || value === undefined || value === '') return 0;
  let n = parseFloat(String(value).replace('%', '').replace(',', '.').trim());
  if (Number.isNaN(n)) return 0;
  if (n > 0 && n <= 1) n *= 100;
  return Math.max(0, Math.min(100, n));
}
export function toolsFromCatalog(rows) {
  const out = [];
  (rows || []).forEach((r, index) => {
    const productCode = String(r.code ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!productCode) return;
    out.push({
      productCode, name: String(r.name ?? '').trim(), columnD: String(r.group ?? '').trim().toLowerCase(), columnE: String(r.kind ?? '').trim().toLowerCase(),
      columnF: String(r.diameter ?? '').trim().toLowerCase(), columnG: String(r.angle ?? ''), columnH: String(r.radius ?? ''), columnJ: String(r.length ?? ''),   // wartości jak w arkuszu (tekst wyświetlany)
      columnM: String(r.ms ?? '').trim().toLowerCase(), columnN: String(r.mk ?? '').trim().toLowerCase(), columnO: String(r.info ?? '').trim(), columnP: String(r.firma ?? '').trim(),
      location: String(r.location ?? '').trim().toLowerCase(), stock: parseNumber(r.zapas) || 0, status: parseNumber(r.stan) || 0, available: parseNumber(r.dostepne) || 0,
      wear: parseNdPercent(r.wear), partStatusColor: String(r.color || '#ffffff').trim().toLowerCase(), rowIndex: index + 1, toolType: String(r.tt ?? ''),
    });
  });
  return out;
}

/**
 * `detailsMap` jak w getAllToolDetailsMap (Code_Ndobor.gs): klucz = kod znormalizowany, bez narzędzi na złomie i zapasie; { productCode, partsCutting, partsAccessories, columnAY (dawny kontur,
 * PSWT AY), insertContours: [{ code, contour }] – kontury płytek z PL_kontur (kol. G) dla części skrawających, które je mają }. plContours: Map kod znormalizowany → ścieżka konturu.
 */
export function detailsFromCatalog(rows, plContours) {
  const out = {}, pl = plContours || new Map();
  for (const r of rows || []) {
    const key = String(r.code ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    const loc = String(r.location ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (loc === 'złom' || loc === 'zapas') continue;
    const partsCutting = splitNdList((r.cutting || []).join('; ')), partsAccessories = splitNdList((r.accessories || []).join('; '));
    out[key] = { productCode: key, partsCutting, partsAccessories, columnAY: String(r.ay ?? '').trim(), insertContours: partsCutting.map((code) => ({ code, contour: pl.get(code) || '' })).filter((x) => x.contour) };
  }
  return out;
}

/**
 * „Braki części” (ekran główny): części (numer < 1000), których kolor stanu nie jest biały, czyli zapas (AQ) ≤ 75% minimum (AN): { partCode, status, stock, available, color }.
 * Kolejność: czerwone, żółte, zielone, potem kod (naturalnie). Odpowiednik getHomeMissingPartsFromNdCacheV2 liczony z PSWT – dokładny kształt tej funkcji w skrypcie nie jest znany.
 */
export function missingParts(rows) {
  const rank = { '#ff0000': 0, '#ffff00': 1, '#00ff00': 2 };
  return (rows || []).filter((r) => r.color && r.color !== '#ffffff' && r.code)
    .map((r) => ({ partCode: r.code, status: r.stan, stock: r.zapas, available: r.dostepne, color: r.color }))
    .sort((a, b) => (rank[a.color] ?? 3) - (rank[b.color] ?? 3) || String(a.partCode).localeCompare(String(b.partCode), 'pl', { numeric: true, sensitivity: 'base' }));
}

/** Lista kodów do pobrania części w Skanerze (karta I, kol. D): PSWT!B dla numeru < 1000, niepustego, ze stanem (AQ) ≥ 0 – posortowana. */
export function productCodes(entries, computed) {
  const codes = [];
  for (const e of entries) {
    const v = e.v || {}, code = String(v.B ?? '').trim(), a = parseNumber(v.A), c = computed.get(e.n) || {};
    if (code && String(v.A ?? '').trim() !== '' && a < 1000 && typeof c.AQ === 'number' && c.AQ >= 0) codes.push(code);
  }
  return codes.sort((x, y) => x.localeCompare(y, 'pl', { sensitivity: 'base' }));
}

/**
 * Podgląd części w Skanerze (jak scanPartInfo w skrypcie): { code, part, tools } – część = pierwszy wiersz katalogu o tym kodzie, narzędzia = wiersze (bez złomu), które mają kod
 * wśród części skrawających (ply1–7) albo akcesoriów (osp1–5). Wiersz katalogu: wynik catalogRows.
 */
export function scanPartInfo(code, rows) {
  const want = norm(code);
  if (!want) throw new Error('Brak kodu części.');
  const out = { code: String(code), part: null, tools: [] };
  const pick = (r) => ({ code: r.code, name: r.name, group: r.group, kind: r.kind, diameter: r.diameter, location: r.location, stan: r.stan, zapas: r.zapas, dostepne: r.dostepne, color: r.color, wear: r.wear, info: r.info });
  for (const r of rows) {
    const k = norm(r.code);
    if (!k) continue;
    if (k === want && !out.part) out.part = pick(r);
    if (norm(r.location) === 'złom') continue;
    const role = r.cutting.map(norm).includes(want) ? 'płytka / część skrawająca' : r.accessories.map(norm).includes(want) ? 'akcesorium' : '';
    if (role) out.tools.push({ ...pick(r), role });
  }
  return out;
}

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const same = (s, d) => { const sn = parseNumber(s), dn = parseNumber(d); return sn != null && dn != null ? Math.abs(sn - dn) <= 0.0101 : eq(s, d); };
const wearNum = (t) => { const s = String(t ?? '').trim(); if (!s) return null; const n = parseNumber(s.replace('%', '')); return n == null ? null : /%/.test(s) ? n / 100 : n; };
/**
 * Porównanie katalogu z bazy z kartą ND_CACHE w arkuszu (baseSheet 'ND_CACHE'; dane od wiersza 3, kolumny A–U wg nagłówków karty). Po symbolu: pierwszy wiersz o danym symbolu.
 * Wynik jak comparePswt: { sheet, db, onlySheet, onlyDb, diffs, expected, ok, byColumn } (pole `n` w różnicach = symbol).
 */
export function compareCatalog(ndValues, rows) {
  const idx = { name: 1, group: 2, kind: 3, diameter: 4, angle: 5, radius: 6, length: 7, ms: 8, mk: 9, info: 10, firma: 11, location: 12, stan: 13, zapas: 14, dostepne: 15, color: 16, contour: 19, wear: 20 };
  const sheet = new Map();
  (ndValues || []).slice(2).forEach((r) => { const c = norm(r && r[0]); if (c && !sheet.has(c)) sheet.set(c, r); });
  const mdb = new Map(); for (const r of rows) { const c = norm(r.code); if (c && !mdb.has(c)) mdb.set(c, r); }
  const diffs = [], byColumn = {}, onlySheet = [], onlyDb = [], expected = [];
  const add = (code, field, s, d) => {
    if (String(s ?? '').trim() === '' && String(d ?? '').trim() !== '') { expected.push({ n: code, field, sheet: s, db: d }); return; }   // komórka karty ND_CACHE pusta (brak formuły), program policzył
    diffs.push({ n: code, field, sheet: s, db: d }); byColumn[field] = (byColumn[field] || 0) + 1;
  };
  for (const [k, r] of sheet) {
    const o = mdb.get(k);
    if (!o) { onlySheet.push(String(r[0])); continue; }
    for (const [f, i] of Object.entries(idx)) {
      const s = String(r[i] ?? ''), d = o[f];
      if (f === 'diameter' && (parseNumber(s) || 0) > 40000 && !(parseNumber(d) > 40000)) continue;   // arkusz zamienił tekst (np. „10.8”, „1/4 01:16”) na datę – baza ma właściwy tekst
      const ok = f === 'wear' ? ((a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 0.0101))(wearNum(s), wearNum(d)) : f === 'color' ? eq(s, d) : same(s, d);
      if (!ok) add(r[0], f, s, d);
    }
    const sc = splitNdList(cleanErr(r[17])).join('|'), dc = o.cutting.map(norm).filter(Boolean).join('|'); if (sc !== dc) add(r[0], 'cutting', sc, dc);
    const sa = splitNdList(cleanErr(r[18])).join('|'), da = o.accessories.map(norm).filter(Boolean).join('|'); if (sa !== da) add(r[0], 'accessories', sa, da);
  }
  for (const [k, r] of mdb) if (!sheet.has(k)) onlyDb.push(r.code);
  return { sheet: sheet.size, db: mdb.size, onlySheet, onlyDb, diffs, expected, ok: !onlySheet.length && !onlyDb.length && !diffs.length, byColumn };
}
