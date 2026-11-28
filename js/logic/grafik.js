// Logika Grafiku (odpowiednik GrafikLogic.kt i GrafikFilter.kt).
import { visibleRows, filterOptions, sortRows } from './tableFilter.js';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const PL = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/;

export function toIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Domyślny zakres: poniedziałek bieżącego tygodnia i 10 dni dalej (jako yyyy-MM-dd). */
export function defaultRange(today = new Date()) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const back = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - back);
  const end = new Date(monday);
  end.setDate(end.getDate() + 10);
  return [toIso(monday), toIso(end)];
}

/** Data z nagłówka arkusza lub pola daty jako liczba yyyyMMdd; null, gdy nie rozpoznano. */
export function dateToNumber(value) {
  const text = String(value ?? '').trim();
  let m = ISO.exec(text);
  if (m) return Number(m[1] + m[2] + m[3]);
  m = PL.exec(text);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return Number(String(year) + m[2].padStart(2, '0') + m[1].padStart(2, '0'));
  }
  return null;
}

/** Indeksy kolumn z datami do pokazania; kolumny bez czytelnej daty są zawsze pokazywane. */
export function visibleIndexes(header, start, end) {
  const s = start ? dateToNumber(start) : null;
  const e = end ? dateToNumber(end) : null;
  const out = [];
  header.forEach((h, i) => {
    const n = dateToNumber(h);
    if (n === null) { out.push(i); return; }
    if (s !== null && n < s) return;
    if (e !== null && n > e) return;
    out.push(i);
  });
  return out;
}

/** Nazwisko z dyspozycji: bez „UT=…”, potem pierwsze słowo i 3 litery drugiego. */
export function cleanName(value) {
  const cleaned = String(value ?? '').replace(/\s*UT\s*=.*$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return cleaned;
  return parts[0] + ' ' + parts[1].slice(0, 3);
}

export const isSeparator = (name) => cleanName(name).includes('****');

export const KEY_NAME = 'name';
export const KEY_VALUE = 'value';

/** Kolumny w kolejności z ekranu: nazwisko, dyspozycja, potem widoczne daty. */
export function columns(data, visibleCols) {
  const header = (data.extraValues && data.extraValues[0]) || [];
  const head = data.rows && data.rows[0];
  const seen = new Map();
  const dates = visibleCols.map((col) => {
    const title = String(header[col] ?? '').trim();
    const n = seen.get(title) || 0;
    seen.set(title, n + 1);
    const key = n === 0 ? 'c:' + title : `c:${title}#${n}`;
    return { key, col, title: title || `(kolumna ${col + 1})` };
  });
  return [
    { key: KEY_NAME, col: null, title: String((head && head.name) || '').trim() || 'Pracownik' },
    { key: KEY_VALUE, col: null, title: String((head && head.value) || '').trim() || 'Dyspozycja' },
    ...dates,
  ];
}

export function valueOf(data, column, row) {
  if (column.key === KEY_NAME) return cleanName((data.rows[row] && data.rows[row].name) || '');
  if (column.key === KEY_VALUE) return String((data.rows[row] && data.rows[row].value) || '').trim();
  const r = data.extraValues[row] || [];
  return String(r[column.col] ?? '').trim();
}

export function dataRows(data) {
  const out = [];
  for (let i = 1; i < data.rows.length; i++) if (!isSeparator(data.rows[i].name)) out.push(i);
  return out;
}

export const getter = (data) => (row, column) => valueOf(data, column, row);

export function gridVisibleRows(data, cols, filters, except = null) {
  return visibleRows(dataRows(data), cols, filters, getter(data), except);
}
export function gridOptions(data, cols, filters, column) {
  return filterOptions(dataRows(data), cols, filters, getter(data), column);
}
export function gridSorted(data, cols, sorts, rows) {
  return sortRows(rows, cols, sorts, getter(data));
}
