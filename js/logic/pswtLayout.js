// Układ kolumn karty PSWT: „stary” (płytki ply1–7 = V:AB, części osp1–5 = AC:AG, dalej AH…) i „nowy” (płytki ply1–10 = V:AE, części osp1–10 = AF:AO, dalej AP…: wszystko od dawnej AH przesunięte o 8 kolumn).
// Program i baza używają stałego układu LOGICZNEGO (litery jak w starym układzie, nowe miejsca na końcu: indeksy 100–107), a ten moduł przelicza go na układ fizyczny arkusza i z powrotem –
// dzięki temu import, eksport i edycja działają przed i po przebudowie karty. Układ rozpoznaje się po nagłówkach wiersza 1. Czyste funkcje – testy: test/pswt-layout.test.js.

/** Indeksy logiczne (od 0) dodatkowych miejsc: płytki 8–10 i części 6–10. */
export const EXTRA_CUT = [100, 101, 102];
export const EXTRA_ACC = [103, 104, 105, 106, 107];
export const ROW_LEN = 108;   // długość wiersza w układzie logicznym
const FIRST_SHIFTED = 33;     // dawna AH (indeks 33) – od niej wszystko w nowym układzie jest przesunięte o 8
export const SHIFT = 8;

const letter = (i) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/** Litery logiczne miejsc płytek (10) i części (10) w kolejności ply1…ply10 / osp1…osp10. */
export const CUT_LETTERS = ['V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', ...EXTRA_CUT.map(letter)];
export const ACC_LETTERS = ['AC', 'AD', 'AE', 'AF', 'AG', ...EXTRA_ACC.map(letter)];
/** Nazwy nagłówków dodatkowych miejsc (w arkuszu są w nowym układzie jako ply8–ply10 i osp6–osp10). */
export const EXTRA_HEADERS = { [EXTRA_CUT[0]]: 'ply8', [EXTRA_CUT[1]]: 'ply9', [EXTRA_CUT[2]]: 'ply10', [EXTRA_ACC[0]]: 'osp6', [EXTRA_ACC[1]]: 'osp7', [EXTRA_ACC[2]]: 'osp8', [EXTRA_ACC[3]]: 'osp9', [EXTRA_ACC[4]]: 'osp10' };

const norm = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, '');
/** 'new', gdy w wierszu nagłówków część osp1 jest w kolumnie AF (indeks 31) albo w AC stoi ply8; inaczej 'old'. */
export function detectLayout(headers) {
  const h = headers || [];
  if (norm(h[31]) === 'osp1' || norm(h[28]) === 'ply8') return 'new';
  return 'old';
}

/** Indeks fizyczny (od 0) kolumny o indeksie logicznym [l] w układzie [layout]; −1, gdy kolumny nie ma w arkuszu (dodatkowe miejsca w starym układzie). */
export function physIndex(l, layout = 'old') {
  if (layout !== 'new') return l >= 100 ? -1 : l;
  if (l <= 27) return l;
  const e = EXTRA_CUT.indexOf(l); if (e >= 0) return 28 + e;
  if (l >= 28 && l <= 32) return l + 3;
  const a = EXTRA_ACC.indexOf(l); if (a >= 0) return 36 + a;
  if (l >= FIRST_SHIFTED && l < 100) return l + SHIFT;
  return -1;
}
/** Indeks logiczny dla fizycznego [p] (od 0) albo −1, gdy kolumna nie ma odpowiednika. */
export function logicIndex(p, layout = 'old') {
  if (layout !== 'new') return p;
  if (p <= 27) return p;
  if (p >= 28 && p <= 30) return EXTRA_CUT[p - 28];
  if (p >= 31 && p <= 35) return p - 3;
  if (p >= 36 && p <= 40) return EXTRA_ACC[p - 36];
  return p - SHIFT;
}
/** Wiersz arkusza (tablica wartości w układzie fizycznym) → wiersz w układzie logicznym (długość ROW_LEN; brakujące miejsca puste). */
export function toLogicalRow(row, layout = 'old') {
  const out = Array(ROW_LEN).fill(''), r = row || [];
  for (let p = 0; p < r.length; p++) { const l = logicIndex(p, layout); if (l >= 0 && l < ROW_LEN) out[l] = r[p]; }
  return out;
}
/** Wartości karty PSWT z baseSheet (wiersz 0 = nagłówki) → { layout, values } w układzie logicznym; nagłówki dodatkowych miejsc uzupełnione (ply8…, osp6…) także w starym układzie. */
export function toLogicalValues(values) {
  const v = values || [], layout = detectLayout(v[0]);
  const out = v.map((row) => toLogicalRow(row, layout));
  if (out.length) for (const [i, name] of Object.entries(EXTRA_HEADERS)) if (!String(out[0][i] ?? '').trim()) out[0][i] = name;
  return { layout, values: out };
}
/** Kolejność wyświetlania kolumn w tabeli Produkty (indeksy logiczne): jak w nowym układzie arkusza – płytki 1–10, potem części 1–10, dalej reszta. [maxIdx] – największy indeks < 100 do pokazania. */
export function displayOrder(maxIdx = 46) {
  const out = [];
  for (let i = 0; i <= 27; i++) out.push(i);
  out.push(...EXTRA_CUT);
  for (let i = 28; i <= 32; i++) out.push(i);
  out.push(...EXTRA_ACC);
  for (let i = 33; i <= Math.min(maxIdx, 99); i++) out.push(i);
  return out;
}
/** Sekcje przycisków wyboru kolumn w Produktach: { id, label, test(indeks logiczny), sub? }. */
export const COLUMN_SECTIONS = [
  { id: 'general', label: 'Ogólny opis (A:C)', test: (i) => i <= 2 },
  { id: 'params', label: 'Parametry narzędzia (D:N)', test: (i) => i >= 3 && i <= 13 },
  { id: 'extra', label: 'Opis dodatkowy (O:U)', test: (i) => i >= 14 && i <= 20 },
  { id: 'parts', label: 'Płytki i części', test: (i) => (i >= 21 && i <= 32) || i >= 100, sub: [
    { id: 'plates', label: 'Płytki (ply)', test: (i) => (i >= 21 && i <= 27) || EXTRA_CUT.includes(i) },
    { id: 'acc', label: 'Części (osp)', test: (i) => (i >= 28 && i <= 32) || EXTRA_ACC.includes(i) }] },
  { id: 'rest', label: 'Stany, ceny i inne (AH:AU)', test: (i) => i >= 33 && i <= 46 },
  { id: 'more', label: 'Dalsze kolumny (AV…)', test: (i) => i >= 47 && i < 100 },
];
