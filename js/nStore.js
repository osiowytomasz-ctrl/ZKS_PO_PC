// Dziennik lokalizacji N w bazie Firebase: reg_n/{cnnn} (wpisy { at, code, loc, who }, n = numer wiersza arkusza przy imporcie, dalej kolejne numery).
// Zapis: każdy zalogowany (jak dotąd ToolTrack i Skaner); import – MASTER / GOD w Narzędziowni (reguły Firestore). Tryby: migrationStore, domena 'n' (sheet | dual).
import { loadReg, appendReg, importReg } from './regStore.js';
import { getMode } from './migrationStore.js';
import { entriesFromSheet, newEntry } from './logic/nDb.js';

const KEY = 'n';

/** Dozwolone lokalizacje zapisu (jak ST_ALLOWED_LOCATIONS w skrypcie Code_ST.gs) – w trybie „tylko baza” bez wywołania arkusza. */
export const ST_ALLOWED_LOCATIONS = ['Correa', 'Union', 'Schiess', 'Skoda', 'Soraluce', 'Narzędziownia'];
/** Lista lokalizacji: z bazy (stała), gdy karta N jest w trybie „tylko baza”, inaczej null (wołający pyta serwer). */
export async function dbLocations() { return (await getMode('n')) === 'db' ? [...ST_ALLOWED_LOCATIONS] : null; }
/** Login zapisywany w kolumnie D karty N: pełny adres e-mail małymi literami (tak zapisuje skrypt: ctx.email). */
export const nWho = (user) => String((user && user.email) || '').trim().toLowerCase();

export const loadN = () => loadReg(KEY);

/** Import: zastępuje dziennik w bazie dziennikiem z karty N (baseSheet). Zwraca liczbę wpisów. */
export async function importN(values, user = '') { const e = entriesFromSheet(values); await importReg(KEY, e, user); return e.length; }

/**
 * Lustrzany zapis po zapisie w arkuszu (tryb równoległy): items = [{ code, location }], who = login. W trybie „arkusz” nic nie robi. Błąd zapisu w bazie zgłasza wyjątek –
 * wywołujący pokazuje komunikat, a zapis w arkuszu już się udał.
 */
export async function mirrorLocations(items, who) {
  if ((await getMode('n')) === 'sheet') return 0;
  for (const it of items) await appendReg(KEY, newEntry({ code: it.code, loc: it.location, who }));
  return items.length;
}
