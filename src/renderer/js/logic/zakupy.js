// Logika Zakupów (odpowiednik ZakupyLogic.kt).
import { formatDate } from './common.js';
import { visibleRows, filterOptions, sortRows, sortSummary as genericSummary } from './tableFilter.js';

export const VIEWS = { ordered: 'Zamówione', bought: 'Zakupione', archive: 'Archiwum' };

const FIELDS = {
  zakup: { col: 'columnB', isDate: true },
  kod: { col: 'columnC' },
  ilosc: { col: 'columnD' },
  pz: { col: 'columnE' },
  cena: { col: 'columnF' },
  zmw: { col: 'columnG' },
  zamowiono: { col: 'columnH', isDate: true },
  iloscZamowiona: { col: 'columnI' },
  opis: { col: 'columnK' },
  uwagi: { col: 'columnL' },
};

export const isBought = (row) => String(row.columnJ ?? '').trim().toLowerCase() === 'x';

/** Kolumny widoku: zamówione (data, kod, ilość zam., ZMW, opis), zakupione/archiwum (data, kod, ilość, PZ, opis). */
export function columns(view) {
  const defs = view === 'ordered'
    ? [['zamowiono', 'Data'], ['kod', 'Kod'], ['iloscZamowiona', 'Ilość'], ['zmw', 'ZMW'], ['opis', 'Opis']]
    : [['zakup', 'Data'], ['kod', 'Kod'], ['ilosc', 'Ilość'], ['pz', 'PZ'], ['opis', 'Opis']];
  return defs.map(([key, title]) => ({ key, title, isDate: !!FIELDS[key].isDate }));
}

export const value = (row, field) => String(row[FIELDS[field].col] ?? '');
export const display = (field, raw) => (FIELDS[field].isDate ? formatDate(raw) : raw);
export const filterValue = (row, column) => display(column.key, value(row, column.key)).trim();

export function source(rows, archive, view) {
  if (view === 'ordered') return rows.filter((r) => !isBought(r));
  if (view === 'bought') return rows.filter(isBought);
  return archive;
}

export const visible = (src, view, filters, except = null) => visibleRows(src, columns(view), filters, filterValue, except);
export const options = (src, view, filters, column) => filterOptions(src, columns(view), filters, filterValue, column);

export function shown(rows, archive, view, filters, sorts) {
  return sortRows(visible(source(rows, archive, view), view, filters), columns(view), sorts, filterValue);
}

export function sortSummary(view, sorts) {
  const cols = columns(view);
  const titles = Object.fromEntries(cols.map((c) => [c.key, c.title]));
  return genericSummary(cols, titles, sorts);
}

/** Tekst tabeli do skopiowania/udostępnienia (tytuł, nagłówki i wiersze rozdzielone „ | ”). */
export function shareText(view, rows) {
  const cols = columns(view);
  const lines = [VIEWS[view], '', cols.map((c) => c.title).join(' | ')];
  for (const row of rows) {
    lines.push(cols.map((c) => display(c.key, value(row, c.key)).replace(/\s+/g, ' ').trim()).join(' | '));
  }
  return lines.join('\n');
}
