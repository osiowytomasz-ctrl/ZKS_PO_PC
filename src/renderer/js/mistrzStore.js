// Mistrz PO w Firestore – tylko dane WPISYWANE zakładek arkusza Mistrz_po (kolumny liczone liczy program: logic/mistrz.js).
//  - mp_meta/main: { sheets: { key: { rows, name } }, chunk, importedAt, importedBy, source: 'arkusz' | 'plik' }
//  - mp_rows/{key}_{nnn}: { k: key, r: { "<wiersz arkusza>": "<JSON {A: …, B: …}>" } } – po [MP_CHUNK] wierszy w dokumencie.
// Okres przejściowy: dane wpisuje się w arkuszu (Skaner, ręcznie), a baza jest aktualizowana importem z arkusza albo z pliku .xlsx.
import { firebase } from './fb.js';
import { api } from './ui.js';
import * as M from './logic/mistrz.js';

export const MP_CHUNK = 300;

/** Dane z bazy: { meta, data: { key: [{row, v}] } } (wiersze w kolejności arkusza). */
export async function loadMistrz() {
  const { sdk, db } = await firebase();
  const [metaSnap, rowsSnap] = await Promise.all([sdk.getDoc(sdk.doc(db, 'mp_meta', 'main')), sdk.getDocs(sdk.collection(db, 'mp_rows'))]);
  const meta = metaSnap.exists() ? metaSnap.data() : null;
  const data = {};
  rowsSnap.forEach((d) => {
    const x = d.data() || {}, k = x.k || d.id.replace(/_\d+$/, '');
    for (const [row, json] of Object.entries(x.r || {})) { let v = {}; try { v = JSON.parse(json); } catch { v = {}; } (data[k] = data[k] || []).push({ row: Number(row), v }); }
  });
  for (const k of Object.keys(data)) data[k].sort((a, b) => a.row - b.row);
  return { meta, data };
}

/** Zastępuje dane w bazie danymi z importu ({ key: [{row, v}] }); zakładki spoza importu zostają bez zmian. */
export async function saveMistrz(data, { user = '', source = '' } = {}) {
  const { sdk, db } = await firebase();
  const keys = Object.keys(data).filter((k) => M.sheetByKey(k));
  const old = await sdk.getDocs(sdk.collection(db, 'mp_rows'));
  const metaSnap = await sdk.getDoc(sdk.doc(db, 'mp_meta', 'main'));
  const writes = [];
  old.forEach((d) => { const k = (d.data() || {}).k || d.id.replace(/_\d+$/, ''); if (keys.includes(k)) writes.push((b) => b.delete(d.ref)); });
  const sheets = { ...((metaSnap.exists() && metaSnap.data().sheets) || {}) };
  for (const k of keys) {
    const rows = data[k] || [];
    for (let i = 0; i < rows.length; i += MP_CHUNK) {
      const r = {}; for (const x of rows.slice(i, i + MP_CHUNK)) r[x.row] = JSON.stringify(x.v);
      const id = `${k}_${String(i / MP_CHUNK).padStart(3, '0')}`;
      writes.push((b) => b.set(sdk.doc(db, 'mp_rows', id), { k, r }));
    }
    sheets[k] = { rows: rows.length, name: M.sheetByKey(k).name, at: Date.now() };
  }
  writes.push((b) => b.set(sdk.doc(db, 'mp_meta', 'main'), { sheets, chunk: MP_CHUNK, importedAt: Date.now(), importedBy: user, source }));
  // najpierw usunięcia, potem zapisy (ten sam identyfikator paczki – set po delete w jednym zapisie wsadowym działa)
  for (let i = 0; i < writes.length; i += 400) { const b = sdk.writeBatch(db); writes.slice(i, i + 400).forEach((w) => w(b)); await b.commit(); }
  return Object.fromEntries(keys.map((k) => [k, (data[k] || []).length]));
}

/** Import z arkusza Google Mistrz_po (API mp_export, poziom MASTER lub GOD). */
export async function importFromSheet(user = '') {
  const x = await api('mp_export', [], { timeoutMs: 240000 });
  const data = {};
  for (const sh of M.SHEETS) if (x && x.sheets && x.sheets[sh.name]) data[sh.key] = M.rowsFromGrid(sh, x.sheets[sh.name]);
  if (!Object.keys(data).length) throw new Error('Arkusz nie zwrócił żadnej zakładki modułu (sprawdź wdrożenie Apps Script: mp_export).');
  return { counts: await saveMistrz(data, { user, source: 'arkusz' }), data };
}

/** Import z pliku .xlsx (pobrany arkusz Mistrz_PO): te same zakładki i kolumny. */
export async function importFromXlsx(buf, user = '') {
  const { readXlsx } = await import('./logic/xlsxRead.js');
  const data = M.dataFromXlsx(await readXlsx(buf));
  if (!Object.keys(data).length) throw new Error('W pliku nie ma zakładek modułu (Rejestr operacji, Rejestr dokumentacji, Lista detali…).');
  return { counts: await saveMistrz(data, { user, source: 'plik' }), data };
}
