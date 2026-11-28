// Reguły Planu (odpowiednik PlanLogic.kt, z Index_Plan.html i Code_Plan.js).
export const FIRST_ITEM = '1. ';

/** Numery wierszy widocznych: nagłówek bloku zawsze, wiersze poniżej tylko w rozwiniętych blokach. */
export function visibleRows(grid, expanded) {
  const hidden = new Set();
  for (const b of grid.blocks || []) {
    if (expanded.has(b.id)) continue;
    for (let r = b.headerRow + 1; r <= b.lastRow; r++) hidden.add(r);
  }
  return grid.values.map((_, i) => i).filter((i) => !hidden.has(i));
}
export const blockHeadedBy = (grid, row) => (grid.blocks || []).find((b) => b.headerRow === row) || null;

/** Szerokości kolumn w px z najdłuższej linii tekstu (API nie zna szerokości z arkusza). */
export function columnWidths(grid) {
  const cols = Math.max(0, ...grid.values.map((r) => r.length));
  const out = [];
  for (let c = 0; c < cols; c++) {
    let longest = 0;
    for (const row of grid.values) for (const line of String(row[c] ?? '').split('\n')) longest = Math.max(longest, line.length);
    out.push(Math.max(54, Math.min(240, Math.min(longest, 40) * 6.6 + 14)));
  }
  return out;
}

/** Dzieli fragmenty na linie wg znaków nowej linii (pusta linia = pusta lista). */
export function splitLines(runs) {
  const lines = [[]];
  for (const run of runs) {
    String(run.text).replace(/\r/g, '').split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, color: run.color });
    });
  }
  return lines;
}
export const lineText = (line) => line.map((r) => r.text).join('');
export const plainText = (lines) => lines.map(lineText).join('\n');

/** Linia, która już istniała (ten sam tekst), zachowuje kolory; nowa lub zmieniona dostaje kolor autora. */
export function composeLines(old, newText, userColor) {
  const oldTexts = old.map(lineText);
  const used = old.map(() => false);
  const newLines = String(newText).replace(/\r/g, '').split('\n');
  const matched = newLines.map(() => null);
  newLines.forEach((line, i) => { if (line && i < old.length && !used[i] && oldTexts[i] === line) { matched[i] = i; used[i] = true; } });
  newLines.forEach((line, i) => {
    if (matched[i] !== null || !line) return;
    const j = oldTexts.findIndex((t, k) => !used[k] && t === line);
    if (j >= 0) { matched[i] = j; used[j] = true; }
  });
  return newLines.map((line, i) => (!line ? [] : matched[i] !== null ? old[matched[i]] : [{ text: line, color: userColor }]));
}

const safe = (t) => String(t).replace(/</g, '‹').replace(/>/g, '›');
/** HTML w formacie, który rozumie `savePlanData`: <span style="color:…;"> na fragment, linie rozdzielone <br>. */
export const toHtml = (lines) => lines.map((line) => line.map((r) => `<span style="color:${r.color};">${safe(r.text)}</span>`).join('')).join('<br>');

export function displayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
