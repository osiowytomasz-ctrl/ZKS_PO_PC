// Grupy narzędzi wg numeru w kolumnie A karty PSWT (przedziały numeracji) – zgrubny rodzaj narzędzia i źródło zużycia. Przedziały wynikają z formuł PSWT
// (kol. AS – zużycie, AM – wystąpienia), nazwy są PROPOZYCJĄ do poprawienia (zmiana tylko w tej tablicy): [od, do (włącznie), nazwa, źródło zużycia, opis].
export const TOOL_GROUPS = [
  { from: 1, to: 399, name: 'Płytki skrawające', usage: 'ZP', note: 'zużycie z rejestru płytek (ZP); w PSWT: typ „insert” z numerem < 500' },
  { from: 400, to: 999, name: 'Oprzyrządowanie', usage: 'ZP', note: 'zużycie z ZP; „wystąpienia” = ile razy użyto w zespołach (osp1–osp5)' },
  { from: 1000, to: 1999, name: 'Narzędzia (frezy, wytaczaki, tokarskie…)', usage: 'ZN', note: 'zużycie z karty ZN (zniszczone)' },
  { from: 2000, to: 3999, name: 'Wiertła, gwintowniki, trepany', usage: 'ZwG', note: 'zużycie z rejestru ZwG (wiercenie, gwintowanie, trepany)' },
  { from: 10000, to: 10199, name: 'Zespoły złożone (numeracja 10000+)', usage: 'ZN', note: '„wystąpienia” liczone po kodzie z kolumny C' },
];
/** Grupa narzędzia o numerze [a] z kolumny A (nazwa albo null dla numeru spoza przedziałów). */
export function groupOfNumber(a) {
  const n = Number(String(a ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return TOOL_GROUPS.find((g) => n >= g.from && n <= g.to) || null;
}
/** Źródło zużycia z formuły PSWT!AS: A < 1000 (od 1) → ZP, 1999 < A < 4000 → ZwG, pozostałe → ZN. */
export function usageSource(a) {
  const n = Number(String(a ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 'ZN';
  if (n < 1000) return 'ZP';
  if (n > 1999 && n < 4000) return 'ZwG';
  return 'ZN';
}
