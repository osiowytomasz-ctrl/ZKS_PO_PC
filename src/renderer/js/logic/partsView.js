// Narzędziownia → Części: kategoria części (wiertła / frezy / toczenie) z grup narzędzi, w których jest używana, opis narzędzia (Grupa / Rodzaj, Lrob, L),
// filtry po kolumnach U i T arkusza PSWT i sortowanie. Czyste funkcje – testy: test/parts-view.test.js.
import { naturalCompare } from './common.js';

/** Kategorie kafelków części: kolor tła (piaskowy – wiertła, szary – frezy, niebieski – toczenie). */
export const CATEGORIES = {
  wie: { label: 'wiertła', bg: '#dcc578' },
  fre: { label: 'frezy', bg: '#b4b4b4' },
  tok: { label: 'toczenie', bg: '#8fb3e6' },
};
const ORDER = { wie: 0, fre: 1, tok: 2, '': 3 };
const low = (v) => String(v ?? '').trim().toLowerCase();

/** Kategoria narzędzia z jego grupy (kolumna D): wie / tre → wiertła, fre / faz → frezy, oprawki i brak grupy – bez kategorii, pozostałe → toczenie. */
export function toolCategory(t) {
  const g = low(t && t.columnD);
  if (['wie', 'tre'].includes(g)) return 'wie';
  if (['fre', 'faz'].includes(g)) return 'fre';
  if (!g || g === 'opr') return '';
  return 'tok';
}
/** Kategoria części: najczęstsza kategoria narzędzi [tools], w których część skrawa (remis – wiertła, frezy, toczenie); brak – ''. */
export function partCategory(tools) {
  const n = new Map();
  for (const t of tools || []) { const c = toolCategory(t); if (c) n.set(c, (n.get(c) || 0) + 1); }
  let best = '', bc = 0;
  for (const [c, k] of [...n.entries()].sort((a, b) => ORDER[a[0]] - ORDER[b[0]])) if (k > bc) { best = c; bc = k; }
  return best;
}
/** Opis narzędzia przy części: { group: „fre / jez”, lrob: długość robocza (K z PSWT), len: L (J z katalogu) } – puste pola jako ''. */
export function toolInfo(t, params) {
  const g = String((t && t.columnD) ?? '').trim(), e = String((t && t.columnE) ?? '').trim();
  return { group: [g, e].filter(Boolean).join(' / '), lrob: String((params && params.K) ?? '').trim(), len: String((t && t.columnJ) ?? '').trim() };
}
/** Tekst opisu narzędzia: „fre / jez · Lrob 55 · L 60” (pola puste pomijane). */
export function toolInfoText(info) {
  return [info.group, info.lrob ? 'Lrob ' + info.lrob : '', info.len ? 'L ' + info.len : ''].filter(Boolean).join(' · ');
}
/** Wartości kolumny [col] (T / U arkusza PSWT) narzędzi części – posortowane, bez pustych: [paramsList] – parametry PSWT narzędzi części. */
export function partValues(paramsList, col) {
  return [...new Set((paramsList || []).map((p) => String((p && p[col]) ?? '').trim()).filter(Boolean))].sort(naturalCompare);
}
/** Czy część spełnia filtry [f] { U, T } (puste – bez ograniczenia): wystarczy, że jedno z jej narzędzi ma wybraną wartość (U i T – dla tego samego narzędzia). */
export function matchesColumns(paramsList, f) {
  if (!f || (!f.U && !f.T)) return true;
  return (paramsList || []).some((p) => (!f.U || String((p && p.U) ?? '').trim() === f.U) && (!f.T || String((p && p.T) ?? '').trim() === f.T));
}
/** Opcje sortowania części. */
export const SORTS = [['code', 'Kod'], ['stock', 'Stan / zapas / dostępne'], ['uses', 'Liczba narzędzi'], ['group', 'Grupa / rodzaj narzędzia']];
/**
 * Sortowanie części [parts] ({ code, tool (pozycja katalogu części), uses, cat, types }) według [mode]; [dir] 1 – rosnąco, −1 – malejąco.
 * stock: najmniej dostępnych na górze (braki), potem stan, zapas; części bez pozycji w katalogu na końcu; uses: domyślnie najczęściej używane na górze; group: wiertła, frezy, toczenie, potem rodzaj i kod.
 */
export function sortParts(parts, mode = 'code', dir = 1) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const byCode = (a, b) => naturalCompare(a.code, b.code);
  const cmp = {
    code: byCode,
    stock: (a, b) => (!a.tool - !b.tool) || num(a.tool && a.tool.available) - num(b.tool && b.tool.available) || num(a.tool && a.tool.status) - num(b.tool && b.tool.status) || num(a.tool && a.tool.stock) - num(b.tool && b.tool.stock) || byCode(a, b),
    uses: (a, b) => (b.uses.length - a.uses.length) || byCode(a, b),
    group: (a, b) => (ORDER[a.cat ?? ''] - ORDER[b.cat ?? '']) || naturalCompare(a.types || '', b.types || '') || byCode(a, b),
  }[mode] || byCode;
  return parts.slice().sort((a, b) => dir * cmp(a, b));
}
