// Tabela Planu jak w Excelu: schowek (TSV zgodny z Excelem), wspólny układ (szerokości kolumn, wysokości wierszy, czcionka),
// wysokość wiersza dopasowana do tekstu, wiersze widoczne na ekranie (sumy wysokości). Bez DOM – testy w test/plan-grid.test.js.

export const DEFAULT_FONT = 13;          // px przy 100%
export const MIN_COL = 24, MAX_COL = 1200, MIN_ROW = 14, MAX_ROW = 800;
const PAD_Y = 6, PAD_X = 8;

/** Nazwa kolumny jak w arkuszu: 0 → A, 25 → Z, 26 → AA. */
export function colName(c) {
  let s = '', n = c + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Klucz wiersza we wspólnym układzie. Wiersz operacji (numer w ukrytej kolumnie A) – po numerze, więc wysokość idzie za operacją,
 * gdy w arkuszu dojdą wiersze; pozostałe – po numerze wiersza.
 */
export function rowKey(grid, r) {
  const a = String(grid.values?.[r]?.[0] ?? '').trim();
  return /^\d+/.test(a) && r > 0 ? 'n:' + a : 'r:' + r;
}

/** Wspólny układ z bazy (Firestore plan_layout/main) – poprawione wartości, bez śmieci. */
export function cleanLayout(raw) {
  const out = { cols: {}, rows: {}, font: DEFAULT_FONT };
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; };
  for (const [k, v] of Object.entries(r.cols || {})) { const n = num(v, MIN_COL, MAX_COL); if (n != null && /^\d+$/.test(k)) out.cols[k] = n; }
  for (const [k, v] of Object.entries(r.rows || {})) { const n = num(v, MIN_ROW, MAX_ROW); if (n != null && /^[nr]:/.test(k)) out.rows[k] = n; }
  const f = num(r.font, 8, 28); if (f != null) out.font = f;
  return out;
}

/** Tekst komórki do schowka w formacie Excela: w cudzysłowie, gdy ma tabulator, nową linię albo cudzysłów (cudzysłów podwojony). */
const tsvCell = (t) => { const s = String(t ?? '').replace(/\r/g, ''); return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toTsv = (rows) => rows.map((r) => r.map(tsvCell).join('\t')).join('\r\n');

/** Schowek z Excela / Arkuszy Google → tablica wierszy (komórki w cudzysłowie mogą mieć nowe linie i tabulatory). */
export function parseTsv(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = []; let row = [], cell = '', i = 0, q = false, start = true;
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && start) { q = true; start = false; i++; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; start = true; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; start = true; i++; continue; }
    cell += ch; start = false; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Liczba linii tekstu po zawinięciu w kolumnie [width] px. [measure] – szerokość napisu w px (np. z canvas.measureText).
 * Zawija po słowach jak arkusz; słowo dłuższe niż kolumna łamie się po znakach.
 */
export function wrappedLines(text, width, measure) {
  const avail = Math.max(8, width - PAD_X);
  let n = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (!line) { n++; continue; }
    let cur = 0, lines = 1;
    for (const word of line.split(/(\s+)/)) {
      if (!word) continue;
      const w = measure(word);
      if (cur + w <= avail) { cur += w; continue; }
      if (/^\s+$/.test(word)) { cur = 0; lines++; continue; }
      if (w <= avail) { lines++; cur = w; continue; }
      for (const ch of word) { const cw = measure(ch); if (cur + cw > avail && cur > 0) { lines++; cur = 0; } cur += cw; }
    }
    n += lines;
  }
  return Math.max(1, n);
}

/** Wysokość wiersza dopasowana do najwyższej komórki (px przy danej czcionce). */
export const autoRowHeight = (maxLines, font) => Math.max(MIN_ROW, Math.round(maxLines * font * 1.3 + PAD_Y));

/** Sumy wysokości: offsets[i] = górna krawędź i-tego widocznego wiersza; offsets[n] = wysokość całości. */
export function offsets(heights) {
  const out = new Array(heights.length + 1); out[0] = 0;
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i];
  return out;
}
/** Indeks wiersza na wysokości [y] (wyszukiwanie binarne w sumach). */
export function rowAt(offs, y) {
  let lo = 0, hi = offs.length - 2;
  if (hi < 0) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Data wpisana ręcznie lub wklejona: rrrr-mm-dd, dd-mm-rrrr, dd.mm.rrrr, dd/mm/rrrr → rrrr-mm-dd albo null ('' – czyszczenie). */
export function parseDateText(t) {
  const s = String(t ?? '').trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; } else { m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s); if (!m) return null; [, d, mo, y] = m; }
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
