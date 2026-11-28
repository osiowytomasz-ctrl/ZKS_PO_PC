// Skaner na bazie (Etap 1, tryb „tylko baza” dla ZP): lista kodów, stan części i pobranie części liczone z PSWT w bazie – zamiast funkcji Apps Script na arkuszu
// (getProductCodes = karta I kol. D, scanPartInfo = karta I + ND_CACHE, processForm = sprawdzenie stanu z karty I i wpis do ZP). Zasady jak w skrypcie (CodeScan.gs):
// lista = produkty o numerze < 1000 ze stanem (AQ) ≥ 0; „dostępne” = AR (stan − zapas); ilość większa od dostępnej = błąd; wpis ZP: ilość, data (do minuty), osoba = login przed „@”.
import { loadReg, appendReg } from './regStore.js';
import { loadPswtContext } from './pswtStore.js';
import { computePswt } from './logic/pswtEngine.js';
import { catalogRows, productCodes, scanPartInfo } from './logic/pswtCatalog.js';
import { isoOf, wallClockMs } from './logic/znDb.js';
import { parseNumber } from './logic/destroyed.js';

let cache = null;   // { at, entries, computed, rows, codes } – pamięć krótkotrwała (stan zmienia się po każdym pobraniu)
const TTL = 60000;

/** Dane Skanera z bazy (PSWT + silnik stanów). [force] – bez pamięci podręcznej. */
export async function scanData(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache;
  const [entries, ctx] = await Promise.all([loadReg('pswt'), loadPswtContext()]);
  const computed = computePswt(entries, ctx);
  cache = { at: Date.now(), entries, computed, rows: catalogRows(entries, computed, ctx.znEntries || []), codes: productCodes(entries, computed) };
  return cache;
}
export const invalidateScan = () => { cache = null; };

/** Lista kodów do pobrania części. */
export async function scanCodesDb(force = false) { return (await scanData(force)).codes; }

/** Podgląd części: jak scanPartInfo z API ({ code, sheetI: null, part, tools }). */
export async function scanPartInfoDb(code, force = false) { return { ...scanPartInfo(code, (await scanData(force)).rows), sheetI: null }; }

/** Pobranie części: kontrola dostępnej ilości (AR) i wpis do ZP w bazie. Wynik jak processForm: { status, message }. */
export async function pickPartDb(code, quantity, who) {
  const productCode = String(code ?? '').trim(), qty = parseFloat(String(quantity).replace(',', '.'));
  if (!productCode || !quantity) throw new Error('Brak wymaganych danych: kod produktu lub ilość');
  const d = await scanData(true);   // świeże dane tuż przed zapisem
  const hit = d.entries.find((e) => String((e.v || {}).B ?? '').trim().toLowerCase() === productCode.toLowerCase());
  if (!hit || !d.codes.some((c) => c.toLowerCase() === productCode.toLowerCase())) throw new Error(`Produkt ${productCode} nie został znaleziony na liście produktów`);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Nieprawidłowa ilość: ' + quantity);
  const c = d.computed.get(hit.n) || {}, available = typeof c.AR === 'number' ? c.AR : parseNumber(c.AR) || 0;
  if (qty > available) throw new Error(`Błąd podczas zapisu: Kliknij OK i wpisz wartość z zakresu (dostępna: ${String(Math.round(available * 1e6) / 1e6).replace('.', ',')})`);
  const short = String(who || '').split('@')[0];
  const saved = await appendReg('zp', { lp: '', code: String((hit.v || {}).B).trim(), qty, at: isoOf(Math.floor(wallClockMs() / 60000) * 60000), who: short });
  invalidateScan();
  return { status: 'success', message: `Dane zostały pomyślnie zapisane w bazie (wpis ${saved.n}) przez ${short}` };
}
