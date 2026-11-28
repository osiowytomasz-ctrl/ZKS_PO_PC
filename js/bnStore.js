// BN (zespoły narzędzi) w bazie Firebase: reg_bn/{cnnn}, n = numer wiersza karty BN, wpis { v: { B…K } } (logic/bnDb.js). Tryby (migrationStore, domena 'bn'): sheet | db –
// tryb równoległy nie jest dostępny (zapis do karty BN nie zwraca numeru wiersza). Odczyt widoku: wpisy z bazy + katalog narzędzi liczony z PSWT w bazie.
import { api } from './ui.js';
import { loadReg, appendReg, importReg } from './regStore.js';
import { getMode } from './migrationStore.js';
import { loadCatalogParts } from './pswtStore.js';
import { entriesFromSheet, bnRows, newBnEntry } from './logic/bnDb.js';

const KEY = 'bn';

export const loadBnEntries = () => loadReg(KEY);
/** Zespoły do widoku BN z bazy (jak getBNbaseData). */
export async function loadBnRowsDb() { const [entries, cat] = await Promise.all([loadReg(KEY), loadCatalogParts()]); return bnRows(entries, cat.rows, cat.details); }
/** Import karty BN (baseSheet 'BN') do bazy. Zwraca liczbę wpisów. */
export async function importBnDb(values, user = '') { const e = entriesFromSheet(values); await importReg(KEY, e, user); return e.length; }

/** Zapis zespołu z ToolBuildera: tryb „arkusz” – karta BN (jak dotąd), tryb „tylko baza” – wpis w bazie. [who] – login przed „@”. */
export async function saveBn(data, who) {
  if ((await getMode('bn')) !== 'db') return api('saveToolDataToBN', [data]);
  const [existing, cat] = await Promise.all([loadReg(KEY), loadCatalogParts()]);
  return appendReg(KEY, newBnEntry(data, who, cat.rows, existing));
}
