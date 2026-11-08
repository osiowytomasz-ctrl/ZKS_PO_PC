import { parseDate } from './common.js';
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

/** Wiersz z serwera ({row, cells:[A..], runs:{E,F}}) → wartości po literach z kolumną H policzoną lokalnie. */
export function toRecord(cells, runs = {}) {
  const rec = { runs: runs || {} };
  COLS.forEach((c, i) => { rec[c] = String(cells[i] ?? ''); });
  rec.sheetH = rec.H;                         // wartość z arkusza (do porównania)
  rec.H = category(rec.A, rec.D, rec.F);
  return rec;
}

/** Ile wierszy ma kategorię inną niż w arkuszu (kontrola zgodności z formułą; puste H z arkusza pomijamy). */
export function mismatches(records) {
  return records.filter((r) => r.sheetH !== '' && r.sheetH !== r.H);
}

// ---- edycja: status, tekst z formatowaniem, składanie zapisu ----
export const STATUS_COLS = ['A', 'B', 'C'];
export const TEXT_COLS = ['E', 'F'];
export const STATUS_LABELS = { A: 'Zakończone', B: 'W trakcie', C: 'Wstrzymane' };

/** Status wiersza: pierwsza z kolumn A, B, C z „x”, albo ''. */
export function statusOf(rec) {
  return STATUS_COLS.find((c) => String(rec[c] ?? '').trim().toLowerCase() === 'x') || '';
}
/** Kliknięcie w A/B/C: kliknięty status włącza się, a kliknięcie aktywnego go czyści (jest tylko jeden status). */
export const toggleStatus = (current, col) => (current === col ? '' : col);

const emptyStyle = { bold: false, italic: false, underline: false, strike: false, color: null };
const styleKey = (r) => [r.bold ? 1 : 0, r.italic ? 1 : 0, r.underline ? 1 : 0, r.strike ? 1 : 0, r.color || ''].join('|');

/** Fragmenty bez pustych, ze wszystkimi polami stylu; sąsiednie o tym samym stylu są scalane. */
export function normalizeRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    const text = String(r.text ?? '');
    if (!text) continue;
    const color = /^#[0-9a-f]{6}$/i.test(String(r.color || '')) && String(r.color).toLowerCase() !== '#000000' ? String(r.color).toLowerCase() : null;
    const run = { text, bold: !!r.bold, italic: !!r.italic, underline: !!r.underline, strike: !!r.strike, color };
    const last = out[out.length - 1];
    if (last && styleKey(last) === styleKey(run)) last.text += text; else out.push(run);
  }
  return out;
}
export const runsText = (runs) => (runs || []).map((r) => r.text).join('');
export const runsEqual = (a, b) => JSON.stringify(normalizeRuns(a)) === JSON.stringify(normalizeRuns(b));

/** Fragmenty komórki z serwera albo cały tekst jako jeden fragment bez formatowania. */
export function cellRuns(rec, col) {
  const server = rec.runs && rec.runs[col];
  if (server && server.length) return normalizeRuns(server);
  return normalizeRuns([{ text: rec[col] ?? '', ...emptyStyle }]);
}

/** Rekord z naniesioną niezapisaną zmianą (status, tekst E/F); H liczone ponownie. */
export function effective(rec, change) {
  if (!change) return rec;
  const out = { ...rec, runs: { ...rec.runs } };
  if (change.status !== undefined) STATUS_COLS.forEach((c) => { out[c] = c === change.status ? 'x' : ''; });
  for (const col of TEXT_COLS) {
    if (change.cells && change.cells[col]) { out.runs[col] = change.cells[col]; out[col] = runsText(change.cells[col]); }
  }
  out.H = category(out.A, out.D, out.F);
  return out;
}

/** Zmiana w jednej komórce tekstowej; zwraca nowy zbiór zmian (zmiana równa oryginałowi jest usuwana). */
export function stageText(changes, rec, col, runs) {
  const next = new Map(changes);
  const cur = { ...(next.get(rec.row) || {}), cells: { ...((next.get(rec.row) || {}).cells || {}) } };
  const orig = cellRuns(rec, col);
  if (runsEqual(runs, orig)) delete cur.cells[col]; else cur.cells[col] = normalizeRuns(runs);
  return finishStage(next, rec.row, cur);
}
export function stageStatus(changes, rec, col) {
  const next = new Map(changes);
  const cur = { ...(next.get(rec.row) || {}), cells: { ...((next.get(rec.row) || {}).cells || {}) } };
  const shown = statusOf(effective(rec, next.get(rec.row)));
  const status = toggleStatus(shown, col);
  if (status === statusOf(rec)) delete cur.status; else cur.status = status;
  return finishStage(next, rec.row, cur);
}
function finishStage(next, row, cur) {
  if (cur.status === undefined && !Object.keys(cur.cells).length) next.delete(row); else next.set(row, cur);
  return next;
}

/** Zmiany → lista dla api_saveWorkflow; `expect` chroni przed nadpisaniem tekstu zmienionego w arkuszu przez kogoś innego. */
export function buildItems(changes, records) {
  const byRow = new Map(records.map((r) => [r.row, r]));
  const items = [];
  for (const [row, ch] of changes) {
    const rec = byRow.get(row);
    if (!rec) continue;
    const item = { row };
    if (ch.status !== undefined) item.status = ch.status;
    const cells = {}, expect = {};
    for (const col of TEXT_COLS) {
      if (!ch.cells || !ch.cells[col]) continue;
      cells[col] = { text: runsText(ch.cells[col]), runs: normalizeRuns(ch.cells[col]) };
      expect[col] = rec[col];
    }
    if (Object.keys(cells).length) { item.cells = cells; item.expect = expect; }
    items.push(item);
  }
  return items;
}

/** Nowe zadanie: komis (E), zadanie (F) jako fragmenty z formatowaniem i opcjonalny status. */
export function newItem(eRuns, fRuns, status = '') {
  const cells = {};
  for (const [col, runs] of [['E', eRuns], ['F', fRuns]]) {
    const n = normalizeRuns(runs);
    if (runsText(n).trim()) cells[col] = { text: runsText(n), runs: n };
  }
  const item = { row: null, cells };
  if (status) item.status = status;
  return item;
}

/** Data w formacie RRRR.MM.DD (z godziną „RRRR.MM.DD GG:MM”, gdy wartość ją zawiera); tekst bez daty zostaje bez zmian. */
export function fmtDate(raw) {
  const text = String(raw ?? '').trim();
  const d = parseDate(text);
  if (!d) return text;
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
  return /\d{1,2}:\d{2}/.test(text) ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}
