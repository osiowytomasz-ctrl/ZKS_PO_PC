// Tabela części narzędzia (ToolBuilder → miniatura → Kontury, edytor płytki): jakie części są do narzędzia (kod, parametry), ile ich jest (stan, zapas, dostępne, zużycie).
// Czyste funkcje – testy: test/parts-info.test.js. Widok (z możliwością transpozycji wiersze ↔ kolumny): views/partsInfoTable.js.
import { normCode } from './tooltrack.js';
import { parseNumber } from './destroyed.js';

/** Kolumna AS karty PSWT (zużycie: ZP / ZwG / ZN) – indeks od 0. */
export const USAGE_COL = 44;

const t = (v) => String(v ?? '').trim();
const numText = (v) => { const n = Number(v); return Number.isFinite(n) ? (n === Math.round(n) ? String(Math.round(n)) : String(Math.round(n * 100) / 100).replace('.', ',')) : ''; };

/** Kolumny tabeli: { key, label, kind: 'text' | 'num' } – kod, rola, parametry części (z katalogu), ilości. */
export const PART_COLUMNS = [
  { key: 'code', label: 'Kod części', kind: 'text' },
  { key: 'role', label: 'Rola', kind: 'text' },
  { key: 'firma', label: 'Firma', kind: 'text' },
  { key: 'name', label: 'Opis', kind: 'text' },
  { key: 'kind', label: 'Grupa / rodzaj', kind: 'text' },
  { key: 'dia', label: 'Φ', kind: 'text' },
  { key: 'len', label: 'L', kind: 'text' },
  { key: 'ra', label: 'r / α', kind: 'text' },
  { key: 'ms', label: 'Ms', kind: 'text' },
  { key: 'mk', label: 'Mk', kind: 'text' },
  { key: 'info', label: 'Uwagi', kind: 'text' },
  { key: 'status', label: 'Stan', kind: 'num' },
  { key: 'stock', label: 'Zapas', kind: 'num' },
  { key: 'available', label: 'Dostępne', kind: 'num' },
  { key: 'usage', label: 'Zużycie', kind: 'num' },
];

/** Mapa kod części (znormalizowany) → zużycie (kolumna AS PSWT) z wierszy karty / bazy (kolumna B = symbol). */
export function usageFromRows(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const code = normCode(t(r && r[1])); if (!code) continue;
    const v = parseNumber(r[USAGE_COL]);
    if (v != null) m.set(code, v);
  }
  return m;
}

/**
 * Wiersze tabeli części: [index] – indeks katalogu (partRows / tool / details), [toolCodes] – narzędzia (części skrawające i akcesoria każdego), [partCodes] – dodatkowo wprost podane części,
 * [usage] – Map z usageFromRows. Część powtarzająca się w kilku narzędziach – jeden wiersz (role połączone). Brak pozycji w katalogu – parametry puste, ilości „—”.
 */
export function partInfoRows(index, { toolCodes = [], partCodes = [] } = {}, usage = new Map()) {
  const by = new Map();
  const add = (code, role) => { const k = normCode(code); if (!k) return; const e = by.get(k) || { code: t(code), roles: new Set() }; if (role) e.roles.add(role); by.set(k, e); };
  for (const tc of toolCodes) {
    const d = index && index.details(tc); if (!d) continue;
    (d.partsCutting || []).forEach((p) => add(p, 'skrawająca'));
    (d.partsAccessories || []).forEach((p) => add(p, 'akcesorium'));
  }
  for (const c of partCodes) add(c, '');
  return [...by.values()].map((e) => {
    const p = index && index.tool(e.code), u = usage.get(normCode(e.code));
    const ra = p ? [p.columnG, p.columnH].map(t).filter(Boolean).join(' / ') : '';
    return {
      code: e.code, role: [...e.roles].join(', '), found: !!p, color: p ? t(p.partStatusColor) : '',
      firma: p ? t(p.columnP) : '', name: p ? t(p.name) : '', kind: p ? [t(p.columnD), t(p.columnE)].filter(Boolean).join(' / ') : '', dia: p ? t(p.columnF) : '', len: p ? t(p.columnJ) : '',
      ra, ms: p ? t(p.columnM) : '', mk: p ? t(p.columnN) : '', info: p ? t(p.columnO) : '',
      status: p ? numText(p.status || 0) : '', stock: p ? numText(p.stock || 0) : '', available: p ? numText(p.available || 0) : '', usage: u == null ? '' : numText(u),
    };
  });
}

/** Kolumny, w których jest jakakolwiek wartość (kod i ilości zawsze) – puste parametry nie zajmują miejsca w tabeli. */
export function visibleColumns(rows, cols = PART_COLUMNS) {
  return cols.filter((c) => c.key === 'code' || c.kind === 'num' || (rows || []).some((r) => t(r[c.key]) !== ''));
}

/**
 * Macierz do wyświetlenia: bez transpozycji – nagłówek = kolumny, wiersze = części; z transpozycją – wiersze = parametry / ilości, kolumny = części (pierwsza kolumna – nazwa pola).
 * Wynik: { head: [tekst], body: [[{ text, row (część), col (kolumna), head }]] }.
 */
export function tableMatrix(rows, transposed = false, cols = visibleColumns(rows)) {
  const cell = (r, c) => ({ text: t(r[c.key]) || (c.kind === 'num' ? '—' : ''), row: r, col: c });
  if (!transposed) return { head: cols.map((c) => c.label), body: (rows || []).map((r) => cols.map((c) => cell(r, c))) };
  return { head: ['', ...(rows || []).map((r) => r.code)], body: cols.filter((c) => c.key !== 'code').map((c) => [{ text: c.label, col: c, head: true }, ...(rows || []).map((r) => cell(r, c))]) };
}
