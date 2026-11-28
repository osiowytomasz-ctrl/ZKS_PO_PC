// BN (zespoły narzędzi: Assem.Tool, zapis z ToolBuildera) w bazie Firebase zamiast karty BN w arkuszu – docs/NIEZALEZNOSC_OD_ARKUSZA.md.
// Karta BN: A (puste), B data i godzina zapisu, C rodzaj (wartości wyboru), D kody narzędzi zespołu rozdzielone „;”, E długość zespołu, F komis, G KTK, H operacja, I zapis przez, J grupa, K rodzaj.
// Zakres danych (od wiersza z A2: np. „C4:K300”) – wiersze od pierwszego wiersza danych. Baza: wpis { n (wiersz arkusza), v: { B…K } }; widok zespołów liczy program z katalogu
// (odpowiednik getBNbaseData / buildBnToolMap_ / hasBnPartWarningForCode_ z CodeBN.gs). Czyste funkcje – testy: test/bn-db.test.js.
import { parseNumber } from './destroyed.js';

const LETTERS = 'BCDEFGHIJK'.split('');
export const bnNorm = (x) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const cleanCode = (x) => String(x ?? '').replace(/ /g, ' ').replace(/[​-‍﻿]/g, '').trim();
const pct = (value) => { let n = parseFloat(String(value ?? '').replace('%', '').replace(',', '.')); if (Number.isNaN(n)) return 0; if (n > 0 && n <= 1) n *= 100; return Math.max(0, Math.min(100, n)); };

/** Wpisy BN z wartości karty (baseSheet 'BN'): pierwszy wiersz danych z komórki A2 (np. „C4:K300” → 4); wiersze bez rodzaju i kodów pomijane. */
export function entriesFromSheet(values) {
  const v = values || [], m = /(\d+)/.exec(String((v[1] || [])[0] ?? '').replace(/^:/, '')), start = m ? Number(m[1]) : 4, out = [];
  for (let i = start - 1; i < v.length; i++) {
    const r = v[i] || [], x = {};
    LETTERS.forEach((l, k) => { const t = String(r[1 + k] ?? '').trim(); if (t !== '') x[l] = t; });
    if (!x.C && !x.D) continue;
    out.push({ n: i + 1, v: x });
  }
  return out;
}

/** Widok narzędzia z mapy katalogu (jak buildBnToolView_). */
function toolView(code, map, details) {
  const c = cleanCode(code), t = map.get(bnNorm(c));
  if (!c) return { code: '', missing: true, exists: false, wear: 100, name: 'Brak kodu' };
  if (!t) return { code: c, missing: true, exists: false, wear: 100, name: 'Brak w katalogu', columnP: '', columnO: '', columnF: '', columnJ: '', rAlpha: '', columnM: '', columnN: '' };
  const color = String(t.color || '').trim().toLowerCase();
  return { code: t.code, missing: false, exists: true, warning: !!color && !['#ffffff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)'].includes(color), wear: pct(t.wear), name: t.name, columnP: t.firma, columnO: t.info, columnF: t.diameter,
    columnJ: t.length, rAlpha: t.radius, columnM: t.ms, columnN: t.mk, location: bnNorm(t.location), stock: parseNumber(t.zapas) || 0, status: parseNumber(t.stan) || 0, available: parseNumber(t.dostepne) || 0, partStatusColor: String(t.color || '').trim() };
}
/** Czy któraś z części narzędzia ma kolor stanu inny niż biały (jak hasBnPartWarningForCode_). */
function partWarning(code, map, details) {
  const d = details[bnNorm(code)];
  if (!d) return false;
  return [...(d.partsCutting || []), ...(d.partsAccessories || [])].some((p) => {
    const t = map.get(bnNorm(p)); if (!t) return false;
    const c = String(t.color || '').trim().toLowerCase();
    return !!c && !['#ffffff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)'].includes(c);
  });
}

/**
 * Zespoły do widoku BN (jak getBNbaseData): entries – wpisy BN, rows – wiersze katalogu (catalogRows), details – detailsFromCatalog.
 * Wynik: [{ rodzaj, columnJ, columnK, firstTool: {…, warning, bnTeamCode, teamTotalLength, bnKomis, bnKtk, bnOper}, components: [...] }] w kolejności wierszy karty.
 */
export function bnRows(entries, rows, details) {
  const map = new Map();
  for (const r of rows || []) { const k = bnNorm(r.code); if (k) map.set(k, r); }
  const out = [];
  for (const e of [...(entries || [])].sort((a, b) => a.n - b.n)) {
    const v = e.v || {}, rodzaj = String(v.C ?? '').trim();
    const team = String(v.D ?? '').split(';').map((c) => cleanCode(c)).filter((c) => c && /[A-Za-z_]/.test(c));
    if (!rodzaj && !team.length) continue;
    const main = team[0] || '', first = toolView(main, map, details);
    first.warning = partWarning(main, map, details); first.bnTeamCode = team.join('; ');
    first.teamTotalLength = String(v.E ?? '').trim(); first.bnKomis = String(v.F ?? '').trim(); first.bnKtk = String(v.G ?? '').trim(); first.bnOper = String(v.H ?? '').trim();
    out.push({ rodzaj, columnJ: String(v.J ?? '').trim(), columnK: String(v.K ?? '').trim(), firstTool: first,
      components: team.slice(1).map((c) => { const t = toolView(c, map, details); t.warning = partWarning(c, map, details); return t; }) });
  }
  return out;
}

const p2 = (n) => String(n).padStart(2, '0');
/** Nowy wpis zapisu zespołu z ToolBuildera ({ toolCodes, selections, toolLength, toolKomis, toolKtk, toolOperation }, kto = login przed „@”). J i K (grupa, rodzaj) – z pierwszego narzędzia zespołu w zapisie dotychczasowych wartości. */
export function newBnEntry(d, who, rows, existing = [], now = new Date()) {
  const first = cleanCode(String(d.toolCodes ?? '').split(';')[0]), t = (rows || []).find((r) => bnNorm(r.code) === bnNorm(first)) || {};
  const casing = (letter, want) => { const w = bnNorm(want); if (!w) return ''; const hit = existing.find((e) => bnNorm((e.v || {})[letter]) === w); return hit ? String(hit.v[letter]).trim() : String(want).trim().toLowerCase(); };
  const v = { B: `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`, C: String(d.selections ?? '').trim(), D: String(d.toolCodes ?? '').trim(), E: String(d.toolLength ?? '').trim(),
    F: String(d.toolKomis ?? '').trim(), G: String(d.toolKtk ?? '').trim(), H: String(d.toolOperation ?? '').trim(), I: String(who ?? '').trim() };
  const g = casing('J', t.group), k = casing('K', t.kind); if (g) v.J = g; if (k) v.K = k;
  for (const l of Object.keys(v)) if (v[l] === '') delete v[l];
  return { v };
}

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/** Porównanie karty BN z bazą: po numerze wiersza, kolumny B–K jako tekst. */
export function compareBn(sheetValues, dbEntries) {
  const sheet = entriesFromSheet(sheetValues), mdb = new Map((dbEntries || []).map((e) => [e.n, e])), seen = new Set(), diffs = [], onlySheet = [];
  for (const e of sheet) {
    const o = mdb.get(e.n);
    if (!o) { onlySheet.push(e.n); continue; }
    seen.add(e.n);
    for (const l of LETTERS) if (!eq((e.v || {})[l], (o.v || {})[l])) diffs.push({ n: e.n, field: l, sheet: (e.v || {})[l] ?? '', db: (o.v || {})[l] ?? '' });
  }
  const onlyDb = (dbEntries || []).filter((e) => !seen.has(e.n)).map((e) => e.n);
  return { sheet: sheet.length, db: (dbEntries || []).length, onlySheet, onlyDb, diffs, expected: [], ok: !onlySheet.length && !onlyDb.length && !diffs.length };
}
