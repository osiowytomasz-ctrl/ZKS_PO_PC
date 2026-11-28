// PSWT w bazie Firebase (Etap 1 przejścia z arkusza): reg_pswt/{cnnn} (wpisy { v: { A…AU wpisywane }, [qv], [ah95] }, n = numer wiersza karty), nagłówki w reg_meta/pswt.headers.
// Kolumny liczone (stany, zużycie, status…) liczy logic/pswtEngine.js z rejestrów reg_zp, reg_zwg, zn_entries, reg_zakupy, reg_zakupy_ar i lokalizacji z karty N (arkusz, do czasu przeniesienia N).
// Odczyt: każdy zalogowany do Narzędziowni; import i zmiany komórek: MASTER / GOD w Narzędziowni (reguły Firestore).
import { api } from './ui.js';
import { loadReg, importReg, updateReg, loadRegMeta, appendReg, readReg } from './regStore.js';
import { loadZnEntries } from './znStore.js';
import { entriesFromSheet, tableRows, parseTs, comparePswt, logicalSheet, carryOver } from './logic/pswtDb.js';
import { buildContext, computePswt } from './logic/pswtEngine.js';
import { catalogRows, compareCatalog, toolsFromCatalog, detailsFromCatalog, missingParts } from './logic/pswtCatalog.js';
import { loadPlContours } from './plStore.js';
import { getMode } from './migrationStore.js';
import { toNValues } from './logic/nDb.js';
import { entriesFromSheet as zakupyEntries } from './logic/zakupyDb.js';
import { getSnapshot } from './snapStore.js';
import { usageFromRows } from './logic/partsInfo.js';
import { candidatesFrom } from './logic/toolParts.js';
import { colIndex } from './logic/pswtDb.js';

const KEY = 'pswt';

/** Kontekst obliczeń (sumy zużycia i dostaw, ZN, ostatnie lokalizacje) z bazy; karta N – z arkusza (jeszcze nie w bazie). */
export async function loadPswtContext() {
  const nFromDb = (await getMode('n', true)) !== 'sheet';   // dziennik lokalizacji: z bazy, gdy karta N jest już przeniesiona (tryb równoległy)
  const [zp, zwg, zn, zakupy, zakupyAr, nSheet] = await Promise.all([
    loadReg('zp'), loadReg('zwg'), loadZnEntries(), loadReg('zakupy'), loadReg('zakupy_ar').catch(() => []),
    nFromDb ? loadReg('n').then(toNValues) : api('baseSheet', ['N'], { timeoutMs: 300000 }).then((d) => d.values || []).catch(() => []),
  ]);
  return Object.assign(buildContext({ zp, zwg, zn, zakupy, zakupyAr, nValues: nSheet, parseTs }), { znEntries: zn });
}

/** Produkty z bazy z policzonymi kolumnami: { headers, rows, numbers, entries } (rows – tablice kolumn A…AU, numbers – numery wierszy karty). */
export async function loadPswtDb() {
  const [entries, meta, ctx] = await Promise.all([loadReg(KEY), loadRegMeta(KEY), loadPswtContext()]);
  let headers = []; try { headers = JSON.parse(meta.headers || '[]'); } catch { /* bez nagłówków */ }
  const t = tableRows(entries, ctx);
  return { headers, rows: t.rows, numbers: t.numbers, entries, ctx, meta };
}

/** Import karty PSWT (baseSheet + flagi wariantów formuł, stałe w miejsce formuł, cena AJ w pełnej precyzji): zastępuje wpisy w bazie. Zwraca { count, overrides: { kolumna: liczba } }. */
export async function importPswtDb(d, user = '') {
  const L = logicalSheet(d), e = entriesFromSheet(L.values, L.flags, L.rawAJ), overrides = {};   // karta w starym albo nowym układzie kolumn (10 + 10 miejsc) → układ logiczny bazy
  for (const x of e.entries) for (const l of Object.keys(x.ov || {})) overrides[l] = (overrides[l] || 0) + 1;
  const carried = carryOver(e.entries, await loadReg(KEY).catch(() => []), L.layout);   // typ narzędzia i dodatkowe miejsca części są tylko w bazie – import ich nie kasuje
  await importReg(KEY, e.entries, user, { headers: JSON.stringify(e.headers), layout: L.layout });
  return { count: e.entries.length, overrides, layout: L.layout, carried };
}

/** Import archiwum zakupów (karta Zakupy_ar) do reg_zakupy_ar – potrzebne do dostaw (AT) w PSWT. */
export async function importZakupyArDb(values, user = '') {
  const e = zakupyEntries(values);
  await importReg('zakupy_ar', e.map((x) => ({ n: x.n, v: x.v, ...(x.ov ? { ov: x.ov } : {}) })), user);
  return e.length;
}

/** Zmiana jednej komórki wpisywanej (litera kolumny A…AU albo dodatkowego miejsca) w wierszu [n] karty PSWT w bazie. Pusty tekst usuwa wartość. */
export async function updatePswtCellDb(n, letter, value) {
  const r = await updateReg(KEY, Number(n), (e) => {
    const v = { ...(e.v || {}) }, t = String(value ?? '');
    if (t.trim() === '') delete v[letter]; else v[letter] = t;
    const entry = { ...e, v };
    if (letter === 'AJ') delete entry.aj;   // ręcznie zmieniona cena – pełna precyzja z importu nie obowiązuje
    return { entry };
  });
  if (r && r.error) throw new Error('Nie ma takiego wiersza w bazie – zrób ponowny import PSWT.');
  return true;
}

/** Porównanie bazy z kartą PSWT w arkuszu (kolumny wpisywane i liczone). */
export async function comparePswtDb() {
  const [d, entries, ctx] = await Promise.all([api('baseSheet', ['PSWT'], { timeoutMs: 300000 }), loadReg(KEY), loadPswtContext()]);
  return comparePswt(logicalSheet(d).values, entries, ctx);
}

/** Katalog narzędzi z PSWT w bazie (jak karta ND_CACHE): wiersze z logic/pswtCatalog.js. */
export async function loadCatalogDb() {
  const [entries, ctx] = await Promise.all([loadReg(KEY), loadPswtContext()]);
  return catalogRows(entries, computePswt(entries, ctx), ctx.znEntries || []);
}

/** Porównanie katalogu liczonego z bazy z kartą ND_CACHE w arkuszu (kolumny z prefiksem „ND:”). */
export async function compareCatalogDb() {
  const [d, entries, ctx] = await Promise.all([api('baseSheet', ['ND_CACHE'], { timeoutMs: 300000 }), loadReg(KEY), loadPswtContext()]);
  return compareCatalog(d.values || [], catalogRows(entries, computePswt(entries, ctx), ctx.znEntries || []));
}

/** Porównanie PSWT (kolumny liczone) i katalogu (ND_CACHE) w jednym wyniku do okna migracji. */
export async function compareAllDb() {
  const [r, c, entries] = await Promise.all([comparePswtDb(), compareCatalogDb().catch((e) => ({ error: e })), loadReg(KEY)]);
  if (c.error) { r.diffs.push({ n: 'ND_CACHE', field: 'katalog', sheet: '(błąd odczytu karty)', db: String(c.error.message || c.error) }); r.ok = false; return r; }
  // objaśnienie symboli występujących tylko po jednej stronie: co jest w PSWT w bazie (numer A, grupa D)
  const by = new Map(); for (const e of entries) { const k = String((e.v || {}).B ?? '').trim().toLowerCase(); if (k && !by.has(k)) by.set(k, e); }
  const why = (code) => { const e = by.get(String(code).trim().toLowerCase()); return e ? ` [PSWT w bazie: wiersz ${e.n}, A=${(e.v || {}).A ?? ''}, D=${(e.v || {}).D ?? ''}]` : ' [brak w PSWT w bazie]'; };
  r.diffs.push(...c.diffs.map((x) => ({ ...x, field: 'ND:' + x.field })));
  r.expected.push(...c.expected.map((x) => ({ ...x, field: 'ND:' + x.field })));
  r.onlySheet.push(...c.onlySheet.map((x) => 'ND:' + x + why(x))); r.onlyDb.push(...c.onlyDb.map((x) => 'ND:' + x + why(x)));
  r.byColumn = { ...r.byColumn, ...Object.fromEntries(Object.entries(c.byColumn).map(([k, v]) => ['ND:' + k, v])) };
  r.ok = r.ok && c.ok;
  return r;
}

/** Nowy produkt: wpis { v: { litera: tekst } } z numerem wiersza karty [n] (tryb równoległy – numer z arkusza) albo następnym wolnym (tryb „tylko baza”). Zwraca wpis z numerem. */
export async function addPswtDb(values, n = null) {
  const v = {}; for (const [l, t] of Object.entries(values || {})) if (String(t ?? '').trim() !== '') v[l] = String(t);
  return appendReg(KEY, { v }, n);
}

/** Narzędzia z bazy w kształcie `tools` z getStToolOptions (bez `detailsMap`). */
export async function loadToolsDb() { return toolsFromCatalog(await loadCatalogDb()); }

/** Pełny katalog z bazy w kształcie odpowiedzi getStToolOptions: { tools, detailsMap } (zamiast kart ND_CACHE, PSWT i PL_kontur w arkuszu). */
export async function loadFullCatalogDb() {
  const [entries, ctx, pl] = await Promise.all([loadReg(KEY), loadPswtContext(), loadPlContours().catch(() => new Map())]);
  const rows = catalogRows(entries, computePswt(entries, ctx), ctx.znEntries || []);
  return { tools: toolsFromCatalog(rows), detailsMap: detailsFromCatalog(rows, pl) };
}

/** „Braki części” z bazy (PSWT w trybie „tylko baza”). */
export async function loadMissingPartsDb() { return missingParts(await loadCatalogDb()); }

/** Wiersze katalogu i szczegóły z bazy (dla BN i innych widoków budowanych z katalogu): { rows, details }. */
export async function loadCatalogParts() {
  const [entries, ctx, pl] = await Promise.all([loadReg(KEY), loadPswtContext(), loadPlContours().catch(() => new Map())]);
  const rows = catalogRows(entries, computePswt(entries, ctx), ctx.znEntries || []);
  return { rows, details: detailsFromCatalog(rows, pl) };
}

/** Zużycie części (kolumna AS PSWT) wg symbolu: z bazy (tryby „równolegle” / „tylko baza” – liczone przez program) albo z migawki arkusza. Map kod znormalizowany → liczba; przy błędzie pusta. */
let usageCache = { at: 0, p: null };
export async function loadPartUsage(force = false) {
  if (!force && usageCache.p && Date.now() - usageCache.at < 60000) return usageCache.p;   // okno Kontur przerysowuje się często – bez ponownego liczenia PSWT
  const p = (async () => {
    try {
      if ((await getMode('pswt')) === 'sheet') { const s = await getSnapshot('pswt'); return usageFromRows(s && s.data && s.data.rows); }
      return usageFromRows((await loadPswtDb()).rows);
    } catch { return new Map(); }
  })();
  usageCache = { at: Date.now(), p };
  return p;
}

/**
 * Dane do edytora części narzędzia (z bazy): { entries, candidates } – wpisy PSWT i kandydaci (kod, numer A, firma, stany, liczba użyć). Wymaga PSWT w trybie „równolegle” albo „tylko baza”.
 */
export async function loadPartsData() {
  const db = await loadPswtDb();
  return { entries: db.entries, candidates: candidatesFrom([...db.entries].sort((a, b) => a.n - b.n), db.rows, { AP: colIndex('AP'), AQ: colIndex('AQ'), AR: colIndex('AR') }) };
}
/**
 * Zapis w bazie przypisania części (zmienione kolumny wpisu: { litera logiczna: tekst }) i / albo typu narzędzia ([tt]: 'mono' | 'comp' | 'holder' | '' (domyślny)) dla wpisu PSWT [n]
 * – jedna transakcja na jeden dokument. Zwraca zapisany wpis.
 */
export async function savePartsDb(n, changes = {}, tt) {
  let saved = null;
  const r = await updateReg(KEY, n, (e) => {
    const v = { ...(e.v || {}) };
    for (const [l, t] of Object.entries(changes)) { if (String(t ?? '').trim() === '') delete v[l]; else v[l] = String(t); }
    const entry = { ...e, v };
    if (tt !== undefined) { if (tt) entry.tt = tt; else delete entry.tt; }
    saved = entry; return { entry };
  });
  if (r && r.error) throw new Error('Nie ma takiego wiersza w bazie PSWT – zrób ponowny import.');
  return saved;
}

/** Odczyt jednego wpisu PSWT [n] wprost z bazy (po zapisie – kontrola, czy baza zachowała zmianę). */
export async function readPswtEntry(n) { return readReg(KEY, n); }
