// Katalog narzędzi (getStToolOptions) trzymany w pamięci, wspólny dla ToolTrack, ToolBuildera i Assem.Tool.
import { api } from './ui.js';
let cache = null;
let pending = null;
export async function toolCatalog(force = false) {
  if (cache && !force) return cache;
  if (!pending) pending = api('getStToolOptions', [], { timeoutMs: 300000 }).then((d) => { cache = d; return d; }).finally(() => { pending = null; });
  return pending;
}
