// Katalog narzędzi (getStToolOptions): pamięć w procesie + pamięć podręczna na dysku, wspólny dla ToolTrack, ToolBuildera i Assem.Tool.
import { apiCached } from './ui.js';
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

/** Wczytanie w tle zaraz po starcie, żeby moduły otwierały się od razu. */
export function preload() { toolCatalog().catch(() => {}); }
