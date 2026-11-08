// Workflow (karta Z): kategoria zadania z formuły w kolumnie H oraz kolorowanie wg formatowania warunkowego arkusza.
// Wszystko liczone lokalnie z surowych wartości, bo Apps Script nie zwraca wyników formatowania warunkowego.

/** Pierwszy pasujący wiersz wygrywa (jak zagnieżdżone JEŻELI). Wartości: [słowo kluczowe, początek, koniec]; między nimi „v”, gdy A = x. */
export const CATEGORY_RULES = [
  ['mistrz', 'M', 'istrz'],
  ['urlop', 'U', 'rlop'],
  ['zakup', 'Z', 'akup'],
  ['modernizacja', 'p', 'rojektowanie'],
  ['rysowanie', 'p', 'rojektowanie'],
  ['oprzyrządowanie', 'p', 'rojektowanie'],
  ['projektowanie', 'p', 'rojektowanie'],
  ['modelowanie', 'p', 'rojektowanie'],
  ['cad', 'p', 'rojektowanie'],
  ['3d', 'p', 'rojektowanie'],
  ['obr', 'o', 'brobka'],
  ['poprawa', 'K', 'or prog'],
  ['korekta', 'K', 'or prog'],
  ['zlecen', 'z', 'lec prac'],
  ['audit', 'a', 'udit'],
  ['odbici', 'o', 'dbicia'],
];

/** Odpowiednik =JEŻELI(...) z kolumny H. A = znacznik „x” (Sheets porównuje bez wielkości liter), D = niepuste → „inne”, F = opis. */
export function category(a, d, f) {
  const text = String(f ?? '').toLowerCase();
  const v = String(a ?? '').trim().toLowerCase() === 'x' ? 'v' : '';
  for (const [kw, start, end] of CATEGORY_RULES) if (text.includes(kw)) return start + v + end;
  return String(d ?? '') !== '' ? 'i' + v + 'nne' : 'zz';
}

// ---- formatowanie warunkowe (zakres wierszy 2–460, kolumny A–H) ----
export const LAST_ROW = 460;
export const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Reguły w kolejności priorytetu (pierwsza = najwyższy); gdy kilka pasuje, własność ustawiona w wyższej regule wygrywa.
 * `from` = pierwsza kolumna zakresu (zakres do H). Kolory są przybliżone ze zrzutów ekranu; zmień tu, jeśli odbiegają.
 */
export const FORMAT_RULES = [
  { name: 'A=x', from: 'A', when: (r) => isX(r.A), style: { background: '#b7b7b7' } },
  { name: 'C=x', from: 'C', when: (r) => isX(r.C), style: { background: '#000000', color: '#ffffff', bold: true } },
  { name: 'B=x', from: 'B', when: (r) => isX(r.B), style: { background: '#fce8b2' } },
  { name: 'H=Mistrz', from: 'A', when: (r) => String(r.H ?? '').trim().toLowerCase() === 'mistrz', style: { background: '#a4c2f4', bold: true, italic: true } },
];
function isX(v) { return String(v ?? '').trim().toLowerCase() === 'x'; }

/** Styl komórki (kolumna `col`, wiersz arkusza `sheetRow`) po złożeniu pasujących reguł; null, gdy brak formatowania. */
export function cellStyle(values, col, sheetRow, rules = FORMAT_RULES) {
  if (sheetRow < 2 || sheetRow > LAST_ROW) return null;
  const idx = COLS.indexOf(col);
  let out = null;
  for (const rule of rules) {
    if (idx < COLS.indexOf(rule.from) || !rule.when(values)) continue;
    out = out || {};
    for (const [k, val] of Object.entries(rule.style)) if (!(k in out)) out[k] = val;
  }
  return out;
}

/** Wiersz z serwera ({row, cells:[A..]}) → wartości po literach z kolumną H policzoną lokalnie. */
export function toRecord(cells) {
  const rec = {};
  COLS.forEach((c, i) => { rec[c] = String(cells[i] ?? ''); });
  rec.sheetH = rec.H;                         // wartość z arkusza (do porównania)
  rec.H = category(rec.A, rec.D, rec.F);
  return rec;
}

/** Ile wierszy ma kategorię inną niż w arkuszu (kontrola zgodności z formułą; puste H z arkusza pomijamy). */
export function mismatches(records) {
  return records.filter((r) => r.sheetH !== '' && r.sheetH !== r.H);
}
