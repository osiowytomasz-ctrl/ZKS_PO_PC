// Workflow w Firebase (Firestore) – szybka lista zadań na żywo zamiast karty Z w arkuszu (Apps Script był wolny).
//  - wf_tasks/r{n}: { n, A, B, C ('x' albo ''), D ('RRRR.MM.DD GG:MM'), E, F (tekst), G (zlecający), runs: { E: [...], F: [...] } (formatowanie),
//                     updatedAt (ms), updatedBy }
//  - wf_meta/main: { next } – licznik numerów nowych zadań (n), żeby dwie osoby nie dostały tego samego numeru.
// Kolumna H (kategoria) jest liczona w programie (logic/workflow.js: category). Ten sam model ma Android (ui/workflow/WfFirestore.kt).
import { firebase } from './fb.js';
import { api } from './ui.js';
import { toRecord, normalizeRuns, runsText, TEXT_COLS, STATUS_COLS } from './logic/workflow.js';

const COL = 'wf_tasks', META = ['wf_meta', 'main'], BATCH = 400;
const p2 = (n) => String(n).padStart(2, '0');
/** Teraz w formacie kolumny D („RRRR.MM.DD GG:MM”, czas lokalny). */
export const nowD = (d = new Date()) => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** Dokument → rekord widoku (jak wiersz karty Z; row = numer zadania n). */
export function docToRecord(d) {
  const runs = {};
  for (const c of TEXT_COLS) if (d.runs && Array.isArray(d.runs[c]) && d.runs[c].length) runs[c] = d.runs[c];
  const rec = toRecord(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k) => String(d[k] ?? '')).concat(['']), runs);
  rec.row = Number(d.n);
  return rec;
}

/** Nasłuch na żywo: onChange(records posortowane po n, {empty}). Zwraca funkcję kończącą. */
export async function watchWorkflow(onChange, onError) {
  const { sdk, db } = await firebase();
  return sdk.onSnapshot(sdk.collection(db, COL), (snap) => {
    const recs = [];
    snap.forEach((doc) => { const d = doc.data(); if (d && d.n != null) recs.push(docToRecord(d)); });
    recs.sort((a, b) => a.row - b.row);
    onChange(recs, { empty: snap.empty, fromCache: snap.metadata && snap.metadata.fromCache });
  }, onError);
}

const styled = (runs) => (runs || []).some((r) => r.bold || r.italic || r.underline || r.strike || r.color);

/**
 * Zapis zmian (format jak api_saveWorkflow): [{ row|null, status?, cells: {E|F: {text, runs}}, expect: {E|F: tekst} }].
 * Jedna transakcja: sprawdza, czy nikt w międzyczasie nie zmienił edytowanego tekstu (expect), nowym zadaniom nadaje kolejne numery,
 * uzupełnia datę i zlecającego tylko tam, gdzie są puste.
 */
export async function saveWorkflow(items, user, localMax = 0) {
  if (!Array.isArray(items) || !items.length) throw new Error('Brak zmian do zapisu.');
  const { sdk, db } = await firebase();
  const ref = (n) => sdk.doc(db, COL, 'r' + n), metaRef = sdk.doc(db, ...META);
  const now = Date.now(), who = String(user || '');
  return sdk.runTransaction(db, async (tx) => {
    // 1. odczyty (w transakcji wszystkie przed zapisami)
    const olds = new Map();
    for (const it of items) if (it.row) olds.set(it.row, await tx.get(ref(it.row)));
    const newCount = items.filter((it) => !it.row).length;
    const meta = newCount ? await tx.get(metaRef) : null;
    // 2. kontrola
    for (const it of items) {
      if (it.status !== undefined && !['', ...STATUS_COLS].includes(it.status)) throw new Error('Nieprawidłowy status.');
      if (!it.row) { if (!Object.values(it.cells || {}).some((c) => String(c.text || '').trim())) throw new Error('Wpisz komis albo treść zadania.'); continue; }
      const snap = olds.get(it.row);
      if (!snap.exists()) throw new Error(`Zadanie ${it.row} zostało usunięte. Odśwież listę.`);
      const cur = snap.data();
      for (const [c, txt] of Object.entries(it.expect || {})) if (String(cur[c] ?? '').trim() !== String(txt ?? '').trim()) throw new Error(`Zadanie ${it.row} zmienił ktoś inny od ostatniego odświeżenia (${c}). Sprawdź i zapisz ponownie.`);
    }
    // 3. zapisy
    let next = newCount ? Math.max(Number(meta.exists() ? meta.data().next : 0) || 0, localMax + 1) : 0;
    const written = [];
    for (const it of items) {
      const isNew = !it.row, n = isNew ? next++ : it.row;
      const cur = isNew ? {} : olds.get(n).data();
      const data = { n, updatedAt: now, updatedBy: who };
      if (it.status !== undefined) STATUS_COLS.forEach((c) => { data[c] = c === it.status ? 'x' : ''; });
      const runs = { ...(cur.runs || {}) };
      for (const [c, cell] of Object.entries(it.cells || {})) {
        if (!TEXT_COLS.includes(c)) continue;
        const r = normalizeRuns(cell.runs || [{ text: cell.text }]);
        data[c] = runsText(r);
        if (styled(r)) runs[c] = r; else delete runs[c];
      }
      data.runs = runs;
      if (!String(cur.D ?? '').trim()) data.D = nowD();
      if (!String(cur.G ?? '').trim()) data.G = who;
      if (isNew) for (const c of [...STATUS_COLS, 'E', 'F']) if (data[c] === undefined) data[c] = '';
      tx.set(ref(n), data, { merge: true });
      written.push(n);
    }
    if (newCount) tx.set(metaRef, { next }, { merge: true });
    return { message: `Zapisano zmiany: ${written.length}.`, rows: written };
  });
}

/** Jednorazowe przeniesienie karty Z z arkusza do Firebase (tylko GOD): zastępuje całą listę zadań; numer zadania = numer wiersza. */
export async function importFromSheet() {
  const d = await api('api_getWorkflow', [], { timeoutMs: 180000 });
  const { sdk, db } = await firebase();
  const rows = (d.rows || []).filter((r) => (r.cells || []).slice(0, 7).join('') !== '');
  const keep = new Set(rows.map((r) => 'r' + r.row));
  const old = await sdk.getDocs(sdk.collection(db, COL));
  const writes = [];
  old.forEach((doc) => { if (!keep.has(doc.id)) writes.push((b) => b.delete(doc.ref)); });
  const now = Date.now();
  for (const r of rows) {
    const c = r.cells || [];
    const data = { n: r.row, A: c[0] || '', B: c[1] || '', C: c[2] || '', D: c[3] || '', E: c[4] || '', F: c[5] || '', G: c[6] || '', runs: {}, updatedAt: now, updatedBy: 'import z karty Z' };
    for (const col of TEXT_COLS) if (r.runs && r.runs[col]) data.runs[col] = normalizeRuns(r.runs[col]);
    writes.push((b) => b.set(sdk.doc(db, COL, 'r' + r.row), data));
  }
  writes.push((b) => b.set(sdk.doc(db, ...META), { next: Math.max(0, ...rows.map((r) => r.row)) + 1 }, { merge: true }));
  for (let i = 0; i < writes.length; i += BATCH) { const b = sdk.writeBatch(db); writes.slice(i, i + BATCH).forEach((w) => w(b)); await b.commit(); }
  return rows.length;
}
