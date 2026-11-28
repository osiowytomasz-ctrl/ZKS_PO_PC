// Tabela części narzędzia (kod, parametry, stan / zapas / dostępne / zużycie) z przełącznikiem „⇄ Transponuj” (wiersze ↔ kolumny) – ToolBuilder → Kontury i edytor płytki.
// Wybór układu zapamiętany na tym komputerze. Logika: logic/partsInfo.js.
import { h, clear, modal } from '../ui.js';
import { parseSheetColor } from '../logic/common.js';
import { partInfoRows, tableMatrix, visibleColumns } from '../logic/partsInfo.js';
import { loadPartUsage } from '../pswtStore.js';

const KEY = 'zks.partsInfo.transposed';
const readT = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const saveT = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* bez pamięci */ } };

/** Sama tabela z przełącznikiem: [rows] – z partInfoRows; [highlight] – kod części wyróżnionej (np. edytowanej płytki). */
export function partsInfoTable(rows, { highlight = '', title = '' } = {}) {
  const box = h('div', { class: 'parts-info' });
  let transposed = readT();
  const hl = String(highlight || '').trim().toLowerCase();
  const draw = () => {
    clear(box);
    const btn = h('button', { class: 'btn small', title: 'Zamień wiersze z kolumnami', onclick: () => { transposed = !transposed; saveT(transposed); draw(); } }, '⇄ Transponuj');
    box.append(h('div', { class: 'row', style: { gap: '8px', margin: '2px 0' } }, h('b', {}, title || `Części (${rows.length})`), h('span', { class: 'grow' }), btn));
    if (!rows.length) { box.append(h('p', { class: 'muted', style: { margin: '4px 0' } }, 'Brak części dla tego narzędzia.')); return; }
    const m = tableMatrix(rows, transposed, visibleColumns(rows));
    const cellStyle = (c) => {
      const st = {};
      if (c.row && c.col.key === 'code') { st.fontWeight = 700; if (c.row.color) st.background = parseSheetColor(c.row.color, '#ffffff'); }
      if (c.row && c.row.code.toLowerCase() === hl) st.outline = '2px solid #1565c0';
      return st;
    };
    const head = h('tr', {}, ...m.head.map((x, i) => {
      const part = transposed && i > 0 ? rows[i - 1] : null;
      return h('th', { style: part && part.color ? { background: parseSheetColor(part.color, '#ffffff') } : {}, class: 'left' }, String(x));
    }));
    const body = m.body.map((r) => h('tr', {}, ...r.map((c, i) => h(c.head ? 'th' : 'td', { class: (c.col && c.col.kind === 'num') || (transposed && !c.head) ? '' : 'left', style: cellStyle(c), title: c.row ? c.col.label + ' · ' + c.row.code : '' }, c.text))));
    box.append(h('div', { style: { overflow: 'auto', maxWidth: '100%' } }, h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, head), h('tbody', {}, ...body))));
  };
  draw();
  return box;
}

/**
 * Przycisk, który otwiera okno z tabelą części (nic nie jest liczone ani rysowane, dopóki go nie naciśnięto): wiersze z katalogu [index] dla narzędzi [toolCodes] i/lub części [partCodes];
 * [label] – napis przycisku, [title] – tytuł okna, [highlight] – wyróżniona część. Zużycie (AS) dociągane przy otwarciu.
 */
export function partsInfoButton(index, { label = 'Lista części', title = '', toolCodes = [], partCodes = [], highlight = '', tip = '' } = {}) {
  return h('button', { class: 'btn small', title: tip || 'Pokaż w oknie: kod, parametry, stan, zapas, dostępne i zużycie', onclick: () => {
    const m = modal(title || label, h('div', {}, h('div', { style: { overflow: 'auto', maxHeight: '70vh' } }, partsInfoPanel(index, { toolCodes, partCodes, highlight, title: '' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  } }, label);
}

/**
 * Panel „Części”: wiersze z katalogu [index] dla narzędzi [toolCodes] i/lub części [partCodes]; zużycie (AS) dociągane w tle (po przybyciu – przerysowanie).
 * Zwraca element; [highlight] – wyróżniona część.
 */
export function partsInfoPanel(index, { toolCodes = [], partCodes = [], highlight = '', title = '' } = {}) {
  const host = h('div', {});
  const paint = (usage) => { clear(host).append(partsInfoTable(index ? partInfoRows(index, { toolCodes, partCodes }, usage) : [], { highlight, title })); };
  paint(new Map());
  loadPartUsage().then((u) => { if (u.size && host.isConnected !== false) paint(u); }).catch(() => {});
  return host;
}
