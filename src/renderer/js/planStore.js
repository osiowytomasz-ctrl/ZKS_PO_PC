// Plan w Firestore (źródło danych); karta PLAN arkusza dostaje kopię każdego zapisu (savePlanData – formuły i wersja webowa).
//  - plan_meta/main: { nRows, chunk, firstVisibleCol, workers[], userColors{email: kolor}, importedAt/By, updatedAt }
//  - plan_rows/{nnn}: { r: { "<wiersz>": "<JSON {v, b, f, k, runs}>" } } – po [chunk] wierszy w dokumencie; wiersz jako tekst JSON,
//    bo Firestore nie przechowuje tablic w tablicach (komórki × fragmenty tekstu z kolorami).
// Odczyt na żywo całego planu (kilkadziesiąt KB); zapis zmienia tylko dotknięte wiersze.
import { firebase } from './fb.js';
import { api } from './ui.js';
import * as P from './logic/plan.js';

export const PLAN_CHUNK = 50;
const chunkId = (r) => String(Math.floor(r / PLAN_CHUNK)).padStart(3, '0');

/** Wiersze siatki (jak z api_getPlanGrid) → zapis wiersza do bazy. */
export function rowToJson(g, r) {
  return JSON.stringify({ v: g.values[r] || [], b: (g.backgrounds || [])[r] || [], f: (g.fontColors || [])[r] || [], k: (g.kinds || [])[r] || [], runs: (g.runs || [])[r] || [] });
}

/** Siatka planu z dokumentów bazy (kształt jak odpowiedź api_getPlanGrid; bloki i daty dolicza normalizeGrid). */
export function gridFromDocs(meta, rowDocs, email = '') {
  const n = Number(meta && meta.nRows) || 0;
  const g = { firstVisibleCol: (meta && meta.firstVisibleCol) || 1, values: [], backgrounds: [], fontColors: [], kinds: [], runs: [], dateCells: [], workers: (meta && meta.workers) || [],
    userColor: ((meta && meta.userColors) || {})[String(email).toLowerCase()] || '#000000' };
  const rows = {};
  for (const d of rowDocs) for (const [k, v] of Object.entries((d && d.r) || {})) rows[k] = v;
  for (let r = 0; r < n; r++) {
    let x = null; try { x = rows[r] ? JSON.parse(rows[r]) : null; } catch { x = null; }
    g.values.push((x && x.v) || []); g.backgrounds.push((x && x.b) || []); g.fontColors.push((x && x.f) || []); g.kinds.push((x && x.k) || []); g.runs.push((x && x.runs) || []);
    (x && x.k || []).forEach((kind, c) => {
      if (kind !== 'date') return;
      const t = String(x.v[c] ?? '').trim(), m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t);
      g.dateCells.push({ row: r, col: c, value: m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '' });
    });
  }
  return g;
}

/** Zmiany z ekranu ([{row, col, entry}] – entry jak w views/plan.js: tekst z liniami albo wartość) wprowadzone do kopii wierszy siatki. */
export function applyToRows(g, changes) {
  const touched = new Map();
  const row = (r) => { if (!touched.has(r)) touched.set(r, { v: [...(g.values[r] || [])], b: [...(g.backgrounds[r] || [])], f: [...(g.fontColors[r] || [])], k: [...(g.kinds[r] || [])], runs: [...(g.runs[r] || [])] }); return touched.get(r); };
  for (const { row: r, col: c, entry } of changes) {
    const x = row(r);
    if (entry.type === 'text') {
      x.v[c] = P.plainText(entry.lines);
      x.runs[c] = entry.lines.flatMap((line, i) => (i ? [{ text: '\n', color: '#000000' }] : []).concat(line));
    } else {
      x.v[c] = entry.display ?? entry.value ?? '';
    }
  }
  return touched;
}

/** Nasłuch planu: [cb](grid | null – brak planu w bazie). */
export async function watchPlan(cb, onError, email = '') {
  const { sdk, db } = await firebase();
  let meta, metaReady = false, rowsReady = false;
  const docs = new Map();
  const emit = () => { if (metaReady && rowsReady) cb(meta ? gridFromDocs(meta, [...docs.values()], email) : null); };
  const un1 = sdk.onSnapshot(sdk.doc(db, 'plan_meta', 'main'), { includeMetadataChanges: true }, (s) => {
    if (!s.exists() && s.metadata && s.metadata.fromCache) return;
    meta = s.exists() ? s.data() : null; metaReady = true; emit();
  }, onError);
  const un2 = sdk.onSnapshot(sdk.collection(db, 'plan_rows'), (snap) => {
    for (const ch of snap.docChanges()) { if (ch.type === 'removed') docs.delete(ch.doc.id); else docs.set(ch.doc.id, ch.doc.data()); }
    rowsReady = true; emit();
  }, onError);
  return () => { un1(); un2(); };
}

/**
 * Zapis zmian: wiersze w bazie (jednym zapisem wsadowym), potem ta sama zmiana w karcie PLAN (savePlanData, format jak dotąd).
 * Błąd arkusza nie cofa zapisu w bazie – zwracany jako {sheetError}.
 */
export async function savePlan(g, changes, user = '') {
  const { sdk, db } = await firebase();
  const touched = applyToRows(g, changes);
  const byChunk = new Map();
  for (const [r, x] of touched) { const id = chunkId(r); if (!byChunk.has(id)) byChunk.set(id, {}); byChunk.get(id)[`r.${r}`] = JSON.stringify(x); }
  const b = sdk.writeBatch(db);
  for (const [id, patch] of byChunk) b.update(sdk.doc(db, 'plan_rows', id), patch);
  b.set(sdk.doc(db, 'plan_meta', 'main'), { updatedAt: Date.now(), updatedBy: user }, { merge: true });
  await b.commit();
  const list = changes.map(({ row, col, entry }) => ({ row, col, value: entry.type === 'text' ? P.toHtml(entry.lines) : entry.value }));
  try { const r = await api('savePlanData', [list]); return { message: r && r.message }; }
  catch (e) { return { sheetError: e.message || String(e) }; }
}

/** Import całej karty PLAN do bazy (zastępuje plan w bazie). */
export async function importPlanFromSheet(user = '') {
  const x = await api('planExport', [], { timeoutMs: 180000 });
  const g = x.grid;
  const { sdk, db } = await firebase();
  const old = await sdk.getDocs(sdk.collection(db, 'plan_rows'));
  const writes = [];
  old.forEach((d) => writes.push((b) => b.delete(d.ref)));
  const chunks = new Map();
  g.values.forEach((_, r) => { const id = chunkId(r); if (!chunks.has(id)) chunks.set(id, {}); chunks.get(id)[r] = rowToJson(g, r); });
  for (const [id, rows] of chunks) writes.push((b) => b.set(sdk.doc(db, 'plan_rows', id), { r: rows }));
  writes.push((b) => b.set(sdk.doc(db, 'plan_meta', 'main'), { nRows: g.values.length, chunk: PLAN_CHUNK, firstVisibleCol: g.firstVisibleCol || 1, workers: g.workers || [],
    userColors: x.userColors || {}, importedAt: Date.now(), importedBy: user, updatedAt: Date.now() }));
  // najpierw usunięcia, potem zapisy (ten sam identyfikator paczki – set po delete w jednym zapisie wsadowym)
  for (let i = 0; i < writes.length; i += 400) { const b = sdk.writeBatch(db); writes.slice(i, i + 400).forEach((w) => w(b)); await b.commit(); }
  return { rows: g.values.length, chunks: chunks.size };
}
