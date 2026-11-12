// Filtrowanie i sortowanie tabel jak autofiltr w arkuszu (wspólne dla Grafiku i Zakupów).
// columns: [{key, isDate?, isNumberAware?}], getValue(row, column) -> tekst do filtrowania.
import { naturalCompare, parseDate } from './common.js';

const dateKey = (text) => {
  const d = parseDate(text);
  return d ? d.getTime() : Number.NEGATIVE_INFINITY;
};

const DAY = 86400000;
/**
 * Filtr zakresu dat: od dnia [from] 00:00 do dnia [to] 23:59 (ms jak z parseDate; null = bez ograniczenia z tej strony).
 * Ma metodę has(tekst) jak zbiór wartości, więc działa w visibleRows; obejmuje też wiersze dodane później. Puste daty nie pasują.
 */
export function rangeFilter(from, to) {
  return {
    range: true, from: from ?? null, to: to ?? null,
    has(text) { const d = parseDate(text); if (!d) return false; const t = d.getTime(); return (from == null || t >= from) && (to == null || t < to + DAY); },
  };
}
export const isRangeFilter = (f) => !!(f && f.range);

/** Wiersze spełniające filtry WSZYSTKICH kolumn naraz; `except` pomija filtr jednej kolumny. */
export function visibleRows(rows, columns, filters, getValue, except = null) {
  const active = columns.filter((c) => c.key !== except && filters[c.key]);
  if (!active.length) return rows;
  return rows.filter((row) => active.every((c) => filters[c.key].has(getValue(row, c))));
}

/** Wartości do wyboru w oknie filtra kolumny: wszystkie wartości, a licznik mówi, ile wierszy ją ma przy filtrach INNYCH kolumn. */
export function filterOptions(rows, columns, filters, getValue, column) {
  const passing = new Set(visibleRows(rows, columns, filters, getValue, column.key));
  const counts = new Map();
  for (const row of rows) {
    const v = getValue(row, column);
    counts.set(v, (counts.get(v) || 0) + (passing.has(row) ? 1 : 0));
  }
  const list = [...counts].map(([value, count]) => ({ value, count }));
  list.sort((a, b) => {
    if ((a.value === '') !== (b.value === '')) return a.value === '' ? 1 : -1;
    if (column.isDate) return dateKey(a.value) - dateKey(b.value);
    return naturalCompare(a.value, b.value);
  });
  return list;
}

function compareCells(a, b, column, ascending) {
  if (a === '' && b === '') return 0;
  if (a === '') return 1; // puste zawsze na końcu
  if (b === '') return -1;
  let c;
  if (column.isDate) {
    c = dateKey(a) - dateKey(b);
    c = c < 0 ? -1 : c > 0 ? 1 : 0;
  } else {
    const na = Number(a.replace(',', '.'));
    const nb = Number(b.replace(',', '.'));
    c = Number.isFinite(na) && Number.isFinite(nb) && a.trim() !== '' && b.trim() !== '' ? Math.sign(na - nb) : naturalCompare(a, b);
  }
  return ascending ? c : -c;
}

/** Sortowanie wielopoziomowe (poziomy się sumują, pierwszy jest główny); stabilne. */
export function sortRows(rows, columns, sorts, getValue) {
  const levels = sorts
    .map((s) => ({ column: columns.find((c) => c.key === s.key), ascending: s.ascending }))
    .filter((l) => l.column);
  if (!levels.length) return rows;
  const indexed = rows.map((row, i) => ({ row, i }));
  indexed.sort((x, y) => {
    for (const { column, ascending } of levels) {
      const c = compareCells(getValue(x.row, column), getValue(y.row, column), column, ascending);
      if (c !== 0) return c;
    }
    return x.i - y.i;
  });
  return indexed.map((e) => e.row);
}

export function sortSummary(columns, titles, sorts) {
  return sorts
    .map((s) => (columns.some((c) => c.key === s.key) ? `${titles[s.key]} ${s.ascending ? '↑' : '↓'}` : null))
    .filter(Boolean)
    .join(' → ');
}
