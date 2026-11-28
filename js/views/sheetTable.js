// Tabela danych z arkusza (Produkty, Pomiarowe): filtr i sortowanie kolumn jak autofiltr w arkuszu (okno filtra z ui.js), wyszukiwanie, wybór widocznych kolumn
// (zapamiętany na tym komputerze), wiersze dociągane partiami. Dane: kolumny [{ key, title, isDate? }] i wiersze (dowolne obiekty) + getValue(wiersz, kolumna) → tekst.
import { h, clear, filterHeader, columnFilterDialog, modal, toast } from '../ui.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { updateSorts, sortLabels } from '../logic/common.js';
import { viewMemory } from '../logic/viewMemory.js';

const PAGE = 500;

/**
 * Tworzy tabelę: { el, setData(columns, rows, getValue, opts), info } – [storageKey] – klucz zapamiętania widocznych kolumn,
 * [onEdit](wiersz, kolumna, nowyTekst, staryTekst) – opcjonalnie: edycja komórek dwuklikiem (Enter zatwierdza, Esc anuluje); funkcja zapisuje i zmienia wiersz (zwraca obietnicę; błąd = komunikat i brak zmiany),
 * [sections] – sekcje kolumn do wyboru jednym kliknięciem: [{ id, label, test(kolumna) → bool, sub?: [{ id, label, test }] }] (okno „Kolumny…”), [defaultVisible] – ile pierwszych kolumn widać domyślnie, [rowStyle](wiersz) → styl wiersza (np. kolor statusu), [cellStyle](wiersz, kolumna) → styl komórki.
 */
export function sheetTable({ storageKey = '', defaultVisible = 14, rowStyle = null, cellStyle = null, onRow = null, onEdit = null, sections = null } = {}) {
  const st = { cols: [], rows: [], get: (r, c) => String(r[c.key] ?? ''), filters: {}, sorts: [], q: '', vis: null, shown: PAGE };
  const mem = storageKey ? viewMemory('sheet.' + storageKey, st, ['filters', 'sorts', 'q']) : null;   // filtry, sortowanie i szukanie zapamiętane na tym komputerze
  let restored = false;
  const info = h('span', { class: 'muted' });
  const body = h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, border: '1px solid #ccc', background: '#fff' } });
  const search = h('input', { type: 'search', placeholder: 'Szukaj w widocznych kolumnach…', style: { width: '260px', padding: '4px 8px' }, oninput: () => { st.q = search.value.trim().toLowerCase(); st.shown = PAGE; draw(); } });
  const colBtn = h('button', { class: 'btn', onclick: () => pickColumns() }, 'Kolumny…');
  const clearBtn = h('button', { class: 'btn', onclick: () => { st.filters = {}; st.sorts = []; st.q = ''; search.value = ''; st.shown = PAGE; draw(); } }, 'Wyczyść filtry');
  const bar = h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, search, colBtn, clearBtn, info);
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0 } }, bar, body);

  const loadVis = () => { try { const v = JSON.parse(localStorage.getItem('zks.cols.' + storageKey) || 'null'); return Array.isArray(v) ? new Set(v) : null; } catch { return null; } };
  const saveVis = () => { try { localStorage.setItem('zks.cols.' + storageKey, JSON.stringify([...st.vis])); } catch { /* bez pamięci */ } };
  const visCols = () => st.cols.filter((c) => st.vis.has(c.key));

  function pickColumns() {
    const boxes = st.cols.map((c) => { const cb = h('input', { type: 'checkbox', checked: st.vis.has(c.key) }); return [c, cb]; });
    const list = h('div', { style: { maxHeight: '45vh', overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '2px 10px' } }, ...boxes.map(([c, cb]) => h('label', { class: 'row', style: { gap: '4px' } }, cb, c.title)));
    // sekcje: jedno kliknięcie włącza / wyłącza wszystkie kolumny sekcji (✔ wszystkie, ◐ część, ○ żadna)
    const chips = [];
    const members = (test) => boxes.filter(([c]) => test(c));
    const chip = (sec, small) => {
      const mem = members(sec.test); if (!mem.length) return null;
      const el = h('button', { class: 'btn' + (small ? ' small' : ''), style: { textAlign: 'left' }, onclick: () => { const all = mem.every(([, cb]) => cb.checked); mem.forEach(([, cb]) => { cb.checked = !all; }); paint(); } });
      chips.push(() => { const n = mem.filter(([, cb]) => cb.checked).length; el.textContent = `${n === mem.length ? '✔' : n ? '◐' : '○'} ${sec.label}`; el.classList.toggle('primary', n === mem.length); });
      return el;
    };
    const paint = () => chips.forEach((f) => f());
    const secBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '0 0 8px' } });
    for (const sec of sections || []) {
      const main = chip(sec, false); if (!main) continue;
      const subs = (sec.sub || []).map((x) => chip(x, true)).filter(Boolean);
      secBox.append(subs.length ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, main, h('span', { class: 'muted' }, '↳'), ...subs) : main);
    }
    boxes.forEach(([, cb]) => cb.addEventListener('change', paint));
    paint();
    const body = sections ? h('div', {}, secBox, h('details', {}, h('summary', { style: { cursor: 'pointer', margin: '0 0 6px' } }, 'Pojedyncze kolumny…'), list)) : list;
    const m = modal('Widoczne kolumny', h('div', {}, body, h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { boxes.forEach(([, cb]) => { cb.checked = true; }); paint(); } }, 'Wszystkie'), h('button', { class: 'btn', onclick: () => { boxes.forEach(([, cb], i) => { cb.checked = i < defaultVisible; }); paint(); } }, 'Domyślne'),
      h('button', { class: 'btn primary', onclick: () => { st.vis = new Set(boxes.filter(([, cb]) => cb.checked).map(([c]) => c.key)); if (!st.vis.size) st.vis = new Set(st.cols.slice(0, 1).map((c) => c.key)); saveVis(); m.close(); draw(); } }, 'Zastosuj'), h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'))), { wide: true });
  }

  function rowsNow() {
    let rows = visibleRows(st.rows, st.cols, st.filters, st.get);
    if (st.q) { const vc = visCols(); rows = rows.filter((r) => vc.some((c) => st.get(r, c).toLowerCase().includes(st.q))); }
    return sortRows(rows, st.cols, st.sorts, st.get);
  }
  /** Edycja komórki w miejscu: pole tekstowe, Enter zapisuje ([onEdit]), Esc i kliknięcie obok – anulują. */
  function beginEdit(td, r, c) {
    if (td.querySelector('input')) return;
    const old = st.get(r, c);
    const input = h('input', { type: 'text', value: old, style: { width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '1px 3px' } });
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      if (!commit || input.value === old) { td.textContent = old; return; }
      input.disabled = true;
      try { await onEdit(r, c, input.value, old); td.textContent = st.get(r, c); td.classList.add('saved'); }
      catch (e) { td.textContent = old; toast('Nie zapisano: ' + (e.message || e), true); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } e.stopPropagation(); });
    input.addEventListener('blur', () => finish(false));
    td.textContent = ''; td.append(input); input.focus(); input.select();
  }
  function draw() {
    if (!st.vis) return;
    if (mem) mem.save();
    const vc = visCols(), rows = rowsNow(), labels = sortLabels(st.sorts);
    const thead = h('tr', {}, ...vc.map((c) => filterHeader(c, { filtered: !!st.filters[c.key], label: labels[c.key], onclick: () => {
      const cur = st.sorts.find((s) => s.key === c.key);
      columnFilterDialog({ title: c.title, options: filterOptions(st.rows, st.cols, st.filters, st.get, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
        onApply: (filter, sort) => { if (filter) st.filters[c.key] = filter; else delete st.filters[c.key]; st.sorts = updateSorts(st.sorts, c.key, sort); st.shown = PAGE; draw(); } });
    } })));
    const tbody = h('tbody', {});
    const more = () => {
      const end = Math.min(rows.length, st.shown);
      for (let i = tbody.children.length; i < end; i++) {
        const r = rows[i], rs = rowStyle ? rowStyle(r) : null;
        tbody.append(h('tr', { class: onRow ? 'click' : '', style: rs, onclick: onRow ? () => onRow(r) : null }, ...vc.map((c) => h('td', { class: 'left', title: onEdit ? 'Dwuklik – edycja komórki' : '', style: cellStyle ? cellStyle(r, c) : null, ondblclick: onEdit ? (e) => beginEdit(e.currentTarget, r, c) : null }, st.get(r, c)))));
      }
    };
    more();
    clear(body); body.append(h('table', { class: 't sheet-tbl', style: { width: 'max-content', minWidth: '100%' } }, h('thead', {}, thead), tbody));
    if (rows.length > st.shown) body.append(h('div', { style: { padding: '6px', display: 'flex', gap: '6px' } }, h('button', { class: 'btn', onclick: () => { st.shown += PAGE; draw(); } }, `Pokaż kolejne (${Math.min(PAGE, rows.length - st.shown)})`), h('button', { class: 'btn', onclick: () => { st.shown = rows.length; draw(); } }, `Pokaż wszystkie (${rows.length - st.shown})`)));
    info.textContent = `Pozycji: ${rows.length}${rows.length !== st.rows.length ? ' z ' + st.rows.length : ''}`;
    clearBtn.disabled = !Object.keys(st.filters).length && !st.sorts.length && !st.q;
  }
  return {
    el, info,
    setData(columns, rows, getValue = null, opts = {}) {
      st.cols = columns; st.rows = rows; if (getValue) st.get = getValue; st.shown = PAGE;
      if (mem && !restored) { restored = true; mem.load(); search.value = st.q || ''; }   // pierwsze wczytanie: filtry z pamięci; kolejne odświeżenia danych ich nie zerują
      const known = new Set(columns.map((c) => c.key));
      st.filters = Object.fromEntries(Object.entries(st.filters).filter(([k]) => known.has(k))); st.sorts = st.sorts.filter((x) => known.has(x.key));
      const keep = loadVis(); st.vis = keep && columns.some((c) => keep.has(c.key)) ? new Set(columns.filter((c) => keep.has(c.key)).map((c) => c.key)) : new Set(columns.slice(0, opts.defaultVisible || defaultVisible).map((c) => c.key));
      draw();
    },
    redraw: draw,
  };
}
