// Katalog narzędzi (getStToolOptions): pamięć w procesie + pamięć podręczna na dysku, wspólny dla ToolTrack, ToolBuildera i Assem.Tool.
import { apiCached } from './ui.js';
import * as E from './logic/contourEditor.js';
let memory = null;
let pending = null;

/** `force` pobiera dane z serwera od nowa. Bez `force` zwraca od razu dane z pamięci/dysku, a świeże dociąga w tle. */
export function toolCatalog(force = false) {
  if (memory && !force) return Promise.resolve(memory);
  if (pending && !force) return pending;
  pending = new Promise((resolve, reject) => {
    let done = false;
    const finish = (d) => { memory = d; if (!done) { done = true; resolve(d); } };
    apiCached('getStToolOptions', [], (d, meta) => { if (!meta.cached || force || !memory) finish(d); else memory = d; }, { timeoutMs: 300000 })
      .then((d) => { if (!done) finish(d); }, reject);
  }).finally(() => { pending = null; });
  return pending;
}

/** Zatwierdzone kontury narzędzi (PSWT: BH potwierdzone, BC – kontur) jako Map kod → kontur x_y; zastępują kontur z kolumny T
 *  w ToolBuilderze, BN i Częściach (toolIndex). Brak dostępu / funkcji na serwerze → pusta mapa (zostaje kolumna T). */
let confirmed = null;
export function confirmedContours(force = false) {
  if (confirmed && !force) return confirmed;
  confirmed = new Promise((resolve) => {
    let done = false;
    const gen = contourGenOn();
    const vP = gen ? apiCached('ndContoursV', [], () => {}).catch(() => ({})) : Promise.resolve({});
    const fin = (d) => { if (!done) { done = true; vP.then((v) => resolve(E.contourOverrides((d && d.params) || {}, (d && d.mounts) || {}, { gen, v: v || {} }))); } };
    apiCached('ndContourData', [], (d) => fin(d), { timeoutMs: 180000 }).then(fin, () => fin(null));
  });
  return confirmed;
}

/** Ustawienia → Narzędziownia: kontury z wewnętrznego generatora zamiast kolumny T (ten komputer). */
export function contourGenOn() { try { return !!(JSON.parse(localStorage.getItem('zks.tools.look') || '{}') || {}).gen; } catch { return false; } }

/** Po zatwierdzeniu / cofnięciu konturu – następne odczyty pobiorą świeże dane. */
export function invalidateConfirmed() { confirmed = null; }

/** Jak confirmedContours, ale czeka najwyżej [ms] – moduł otwiera się od razu (przy następnym otwarciu dane są już w pamięci). */
export const confirmedContoursQuick = (ms = 4000) => Promise.race([confirmedContours(), new Promise((r) => setTimeout(() => r(null), ms))]);

/** Wczytanie w tle zaraz po starcie, żeby moduły otwierały się od razu. */
export function preload() { toolCatalog().catch(() => {}); }
