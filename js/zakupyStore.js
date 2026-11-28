// Zakupy w bazie Firebase (Etap 1 przejścia z arkusza): reg_zakupy/{cnnn}, numer wpisu = numer wiersza arkusza (logic/zakupyDb.js). Archiwum (Zakupy_ar) zostaje w arkuszu.
// Odczyt i zapis: MASTER / GOD w Zakupach (reguły Firestore, claim `zk`). Wyniki zapisów mają ten sam kształt co odpowiedzi API w Apps Script (wynik na każdą zmianę komórki).
import { loadReg, appendReg, updateReg, importReg, deleteReg } from './regStore.js';
import { toApiRows, applyCell, applyRealization, newEntry, entriesFromSheet } from './logic/zakupyDb.js';

const KEY = 'zakupy';

/** Dane dla widoku Zakupy: { rows, exactRows: true } jak getZakupyData. */
export async function loadZakupyDb() { return { rows: toApiRows(await loadReg(KEY)), exactRows: true }; }

/** Dodaje pozycję zamówienia; [row] – numer wiersza z arkusza (tryb równoległy) albo następny wolny. */
export async function addZakupyDb(data, row = null) { return appendReg(KEY, newEntry(data), row); }

/** Realizacja zakupu w wierszu [rowNumber] (updateZakupyItem). Gdy [expectKod] podano, kod w wierszu musi się zgadzać (jak w API). */
export async function updateItemDb(data) {
  const r = await updateReg(KEY, Number(data.rowNumber), (e) => {
    if (data.expectKod != null && String((e.v || {}).C ?? '').trim().toLowerCase() !== String(data.expectKod).trim().toLowerCase()) return { conflict: (e.v || {}).C || '' };
    return { entry: applyRealization(e, data) };
  });
  if (r && r.error) throw new Error(r.error === 'badrow' ? 'Nie ma takiego wiersza w bazie.' : r.error);
  if (r && r.conflict !== undefined) throw new Error('Wiersz został zmieniony (inny kod) – odśwież listę.');
  return { success: true, message: 'Zapisano realizację zakupu.' };
}

/**
 * Zmiany komórek [{ rowNumber, col, value, expect }] → { v: 1, results: [{ s: 'ok'|'conflict'|'badrow'|'badcol', now }] } jak updateZakupyCells.
 * [force] – bez kontroli poprzedniej wartości (tryb równoległy: zmiana już przeszła kontrolę w arkuszu).
 */
export async function updateCellsDb(changes, { force = false } = {}) {
  const results = [];
  for (const ch of changes) {
    const r = await updateReg(KEY, Number(ch.rowNumber), (e) => applyCell(e, ch.col, ch.value, ch.expect, !force));
    if (r && r.error) results.push({ s: r.error === 'badrow' ? 'badrow' : 'badcol' });
    else if (r && r.conflict !== undefined) results.push({ s: 'conflict', now: r.conflict });
    else results.push({ s: 'ok', now: String(((r.entry || {}).v || {})[String(ch.col).toUpperCase()] ?? '') });
  }
  return { v: 1, results };
}

/** Import: zastępuje wszystkie wiersze Zakupów w bazie wierszami z karty (wartości z baseSheet). MASTER / GOD. */
export async function importZakupyDb(values, user = '') { const e = entriesFromSheet(values); await importReg(KEY, e.map((x) => ({ n: x.n, v: x.v, ...(x.ov ? { ov: x.ov } : {}) })), user); return e.length; }

/** Archiwum zakupów z bazy (reg_zakupy_ar) w kształcie getZakupyArchiveData. */
export async function loadZakupyArchiveDb() { return { rows: toApiRows(await loadReg('zakupy_ar')) }; }

/** Przenosi pozycję [n] z bieżących zakupów do archiwum (nowy numer w archiwum; najpierw zapis w archiwum, potem usunięcie – przerwanie zostawia kopię, nie gubi danych). */
export async function archiveItemDb(n) {
  const e = (await loadReg(KEY)).find((x) => x.n === Number(n));
  if (!e) throw new Error('Nie ma takiego wiersza w bazie – odśwież listę.');
  const { n: _drop, ...rest } = e;
  const saved = await appendReg('zakupy_ar', rest);
  await deleteReg(KEY, n);
  return { archiveRow: saved.n };
}
