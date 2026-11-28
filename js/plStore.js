// Kontury płytek skrawających (karta PL_kontur: A kod, G kontur – ścieżka SVG w mm) w bazie Firebase: reg_plk/{cnnn}, n = numer wiersza arkusza, wpis { v: { A…G } }.
// Czytane przez katalog narzędzi (insertContours); zapis konturu płytki: arkusz (tryby sheet / dual) i/lub baza (dual / db) wg trybu PSWT.
import { api } from './ui.js';
import { loadReg, importReg, updateReg } from './regStore.js';
import { getMode } from './migrationStore.js';

const KEY = 'plk';
const norm = (c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Import karty PL_kontur (baseSheet 'PL_KONTUR'; wiersz 1 = nagłówki): zastępuje wpisy w bazie. Zwraca liczbę płytek. */
export async function importPlKonturDb(values, user = '') {
  const entries = [];
  (values || []).forEach((r, i) => {
    if (i < 1) return;
    const v = {}; 'ABCDEFG'.split('').forEach((l, k) => { const t = String((r || [])[k] ?? '').trim(); if (t !== '') v[l] = t; });
    if (v.A) entries.push({ n: i + 1, v });
  });
  await importReg(KEY, entries, user);
  return entries.length;
}

/** Mapa kod znormalizowany → ścieżka konturu (kol. G), tylko płytki z konturem. */
export async function loadPlContours() {
  const m = new Map();
  for (const e of await loadReg(KEY)) { const c = norm((e.v || {}).A), g = String((e.v || {}).G ?? '').trim(); if (c && g && !m.has(c)) m.set(c, g); }
  return m;
}

/** Zapis konturu płytki [code] (pusty [svg] – usunięcie): tryb PSWT „arkusz” – tylko arkusz, „równolegle” – arkusz i baza, „tylko baza” – baza. */
export async function savePlContour(code, svg) {
  const mode = await getMode('pswt');
  if (mode !== 'db') await api('plSaveContour', [code, svg]);
  if (mode === 'sheet') return;
  const hit = (await loadReg(KEY)).find((e) => norm((e.v || {}).A) === norm(code));
  if (!hit) { if (mode === 'db') throw new Error('Nie ma płytki ' + code + ' w bazie (import karty PL_kontur w „⇄ Migracja” Produktów).'); return; }
  await updateReg(KEY, hit.n, (e) => { const v = { ...(e.v || {}) }; if (String(svg || '').trim()) v.G = String(svg).trim(); else delete v.G; return { entry: { ...e, v } }; });
}
