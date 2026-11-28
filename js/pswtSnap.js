// Migawka PSWT dla widoków, które szukają produktu po symbolu (Zniszczone – opis / cena / firma, Zużycie ZwG – lista wymiarów): { data: { headers, rows }, meta }.
// Gdy PSWT działa w trybie „równolegle” lub „tylko baza”, wiersze pochodzą z bazy (reg_pswt, kolumny wpisywane A–AU); w trybie „arkusz” – dotychczasowa migawka z arkusza.
import { getSnapshot } from './snapStore.js';
import { getMode } from './migrationStore.js';
import { loadReg } from './regStore.js';
import { colIndex } from './logic/pswtDb.js';
import { ROW_LEN, toLogicalValues } from './logic/pswtLayout.js';

export async function pswtSnapshot(force = false) {
  if ((await getMode('pswt')) === 'sheet') {
    const snap = await getSnapshot('pswt', force);   // migawka karty w układzie fizycznym (stary albo nowy) → układ logiczny (litery jak dotąd: A…AU, miejsca płytek 8–10 i części 6–10 od indeksu 100)
    if (!snap || !snap.data) return snap;
    const t = toLogicalValues([snap.data.headers || [], ...(snap.data.rows || [])]);
    return { ...snap, data: { ...snap.data, headers: t.values[0] || [], rows: t.values.slice(1), layout: t.layout } };
  }
  const rows = (await loadReg('pswt')).map((e) => { const r = Array(ROW_LEN).fill(''); for (const [l, t] of Object.entries(e.v || {})) r[colIndex(l)] = t; return r; });
  return { data: { headers: [], rows }, meta: null };
}
