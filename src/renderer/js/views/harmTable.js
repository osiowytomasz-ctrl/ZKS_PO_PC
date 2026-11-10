// Panel danych Harmonogramu (obok wykresu): kolumny jak w pliku Harmonogramu (A–H, I, J, K, L, M, R, S, T, X, AB).
// Edytujesz tylko dane twarde; kolumny liczone przez program (I, M, S) są tylko do odczytu. Filtry i sortowanie kolumn jak w Zakupach.
import { h, clear, modal, confirmBox, toast, columnFilterDialog } from '../ui.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { parseDateTime, parseNumber } from '../logic/harmImport.js';
import { updateOp, saveOp, deleteOp } from '../harmStore.js';

const ROW = 26;
// group: 'z' = zależności (ukrywane razem); calc = liczone przez program; letter = kolumna w pliku
export const COLS = [
  { key: 'lp', letter: 'A', title: 'lp.', w: 52, ro: true, isNumberAware: true },
  { key: 'z1', letter: 'B', title: 'Z1', w: 48, group: 'z', pred: 0 }, { key: 'z2', letter: 'C', title: 'Z2', w: 48, group: 'z', pred: 1 },
  { key: 'z3', letter: 'D', title: 'Z3', w: 48, group: 'z', pred: 2 }, { key: 'z4', letter: 'E', title: 'Z4', w: 48, group: 'z', pred: 3 },
  { key: 'client', letter: 'F', title: 'Klient', w: 130, text: true },
  { key: 'komis', letter: 'G', title: 'Komis', w: 78, text: true },
  { key: 'element', letter: 'H', title: 'Opis operacji nazwa/element', w: 300, text: true },
  { key: 'start', letter: 'I', title: 'Start zlec.', w: 116, ro: true, isDate: true },
  { key: 'startManual', letter: 'J', title: 'Start ręcznie', w: 116, date: true, isDate: true },
  { key: 'hours', letter: 'K', title: 'Czas [h]', w: 62, num: true },
  { key: 'endManual', letter: 'L', title: 'Koniec ręcznie', w: 116, date: true, isDate: true },
  { key: 'koniec', letter: 'M', title: 'Koniec zlec.', w: 116, ro: true, isDate: true },
  { key: 'wysylka', letter: 'R', title: 'Zakończenie', w: 116, date: true, isDate: true },
  { key: 'key', letter: 'S', title: 'Stat. (klucz)', w: 150, ro: true },
  { key: 'status', letter: 'T', title: 'Status', w: 64, text: true },
  { key: 'dostawa', letter: 'X', title: 'Dostawa', w: 116, date: true, isDate: true },
  { key: 'station', letter: 'AB', title: 'Stan.', w: 62, text: true },
];
const LS_KEY = 'zks.harm.hiddenCols';
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); } };
const saveHidden = (set) => { try { localStorage.setItem(LS_KEY, JSON.stringify([...set])); } catch { /* brak pamięci przeglądarki */ } };

const isSynthetic = (id) => /^s\d+$/.test(id);

/**
 * createTable({ onFilterChange }) → { el, update({opsByLp, rows}), allowed(): Set|null, toolbarExtras }.
 * rows = wiersze z buildHarmData (z polem id).
 */
export function createTable({ onFilterChange }) {
  const st = { opsByLp: {}, rows: [], filters: {}, sorts: [], hidden: loadHidden(), editing: false, shown: [] };
  const info = h('span', { class: 'muted' });
  const spacer = h('div', { style: { position: 'relative' } });
  const headEl = h('div', { style: { position: 'sticky', top: 0, zIndex: 3, display: 'flex', background: '#eee', borderBottom: '1px solid #888' } });
  const scroller = h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', border: '1px solid #ccc', background: '#fff' } }, headEl, spacer);
  const visibleCols = () => COLS.filter((c) => !st.hidden.has(c.key));
  const totalW = () => visibleCols().reduce((a, c) => a + c.w, 0) + 44;
  const val = (row, col) => String(row[col.key] ?? '');
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0, minWidth: 0 } },
    h('div', { class: 'row panel', style: { flexWrap: 'wrap' } },
      h('button', { class: 'btn small primary', onclick: () => addDialog() }, 'Dodaj operację'),
      h('button', { class: 'btn small', onclick: () => columnsDialog() }, 'Kolumny'),
      h('button', { class: 'btn small', onclick: () => { st.filters = {}; st.sorts = []; rebuild(); onFilterChange(); } }, 'Wyczyść filtry'),
      info), scroller);

  const sortLabel = (key) => { const i = st.sorts.findIndex((s) => s.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
  function drawHead() {
    clear(headEl);
    headEl.style.width = totalW() + 'px';
    for (const c of visibleCols()) {
      const filtered = !!st.filters[c.key];
      headEl.append(h('div', { title: `Kolumna ${c.letter}${c.ro ? ' (liczona przez program)' : ''}. Kliknij: filtr i sortowanie`, onclick: () => openFilter(c),
        style: { width: c.w + 'px', flex: 'none', padding: '4px', fontWeight: 700, fontSize: '12px', boxSizing: 'border-box', borderRight: '1px solid #ccc', cursor: 'pointer', userSelect: 'none', background: filtered ? '#cfe3ff' : c.ro ? '#e4e4e4' : '#eee', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } },
        c.title, filtered ? ' ▼' : '', ' ', h('span', { class: 'muted' }, sortLabel(c.key))));
    }
    headEl.append(h('div', { style: { width: '44px', flex: 'none' } }));
  }
  function openFilter(c) {
    const cur = st.sorts.find((s) => s.key === c.key);
    columnFilterDialog({
      title: c.title, options: filterOptions(st.rows, COLS, st.filters, val, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
      onApply: (filter, sort) => {
        if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
        st.sorts = st.sorts.filter((s) => s.key !== c.key); if (sort !== null) st.sorts.unshift({ key: c.key, ascending: sort });
        rebuild(); onFilterChange();
      },
    });
  }
  function columnsDialog() {
    const boxes = [];
    const line = (label, keys) => {
      const cb = h('input', { type: 'checkbox', checked: keys.every((k) => !st.hidden.has(k)), onchange: () => { for (const k of keys) cb.checked ? st.hidden.delete(k) : st.hidden.add(k); } });
      boxes.push(cb); return h('label', { style: { display: 'block', margin: '3px 0' } }, cb, ' ', label);
    };
    const zKeys = COLS.filter((c) => c.group === 'z').map((c) => c.key);
    const content = h('div', {}, h('p', { class: 'muted' }, 'Zaznaczone kolumny są widoczne. Zależności (Z1–Z4) włączasz i wyłączasz razem, pozostałe kolumny osobno.'),
      ...COLS.filter((c) => c.group !== 'z' || c.key === 'z1').map((c) => (c.group === 'z' ? line('Zależności Z1–Z4 (B–E)', zKeys) : line(`${c.title} (${c.letter})`, [c.key]))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { st.hidden.clear(); saveHidden(st.hidden); m.close(); rebuild(); } }, 'Pokaż wszystkie'),
        h('button', { class: 'btn primary', onclick: () => { saveHidden(st.hidden); m.close(); rebuild(); } }, 'OK')));
    const m = modal('Kolumny tabeli', content);
  }

  function rebuild() {
    st.shown = sortRows(visibleRows(st.rows, COLS, st.filters, val), COLS, st.sorts, val);
    drawHead();
    spacer.style.width = totalW() + 'px'; spacer.style.height = st.shown.length * ROW + 'px';
    info.textContent = `Operacji: ${st.shown.length} z ${st.rows.length}`;
    paint();
  }
  function paint() {
    if (st.editing) return;
    const top = Math.max(0, scroller.scrollTop - ROW), vh = scroller.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / ROW)), to = Math.min(st.shown.length, Math.ceil((top + vh + 2 * ROW) / ROW));
    clear(spacer);
    for (let i = from; i < to; i++) spacer.append(rowEl(st.shown[i], i));
  }
  function rowEl(r, i) {
    const row = h('div', { style: { position: 'absolute', top: i * ROW + 'px', left: 0, display: 'flex', height: ROW + 'px', width: totalW() + 'px', background: i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #eee' } });
    for (const col of visibleCols()) {
      const text = val(r, col);
      const predMissing = col.pred !== undefined && text && !st.opsByLp[text];
      const noStart = col.key === 'start' && !text && String(r.state) === 'no-start';
      const cell = h('div', { title: predMissing ? 'Brak operacji o tym numerze' : noStart ? 'Brak startu: ustaw start ręcznie albo uzupełnij poprzedników' : col.key === 'status' ? 'np. zak. (zakończona)' : '',
        style: { width: col.w + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW - 2 + 'px', padding: '0 4px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '12px', borderRight: '1px solid #eee',
          background: col.ro ? '#f3f3f3' : predMissing ? '#ffd6d6' : 'transparent', color: '#000', cursor: col.ro ? 'default' : 'text' } }, text);
      if (!col.ro) cell.addEventListener('click', () => startEdit(cell, r.id, col, text));
      row.append(cell);
    }
    row.append(h('div', { style: { width: '44px', flex: 'none', textAlign: 'center' } }, h('button', { class: 'btn small', title: 'Usuń operację', onclick: () => removeOp(r.id) }, '✕')));
    return row;
  }
  function startEdit(cell, id, col, text) {
    if (st.editing) return;
    st.editing = true;
    const input = h('input', { type: 'text', value: text, spellcheck: 'false', style: { width: '100%', height: ROW - 2 + 'px', boxSizing: 'border-box', border: '2px solid #1a73e8', padding: '0 3px', fontSize: '12px' } });
    clear(cell); cell.style.padding = '0'; cell.append(input); input.focus(); input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true; st.editing = false;
      if (commit && input.value.trim() !== text.trim()) await save(id, col, input.value.trim());
      paint();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }
  async function save(id, col, raw) {
    let patch;
    if (col.pred !== undefined) {
      if (raw && !/^(\d+|s\d+)$/.test(raw)) { toast('Poprzednik to numer operacji (lp.)'); return; }
      if (raw === id) { toast('Operacja nie może być swoim poprzednikiem'); return; }
      const preds = [...(st.opsByLp[id]?.preds || [])]; while (preds.length <= col.pred) preds.push('');
      preds[col.pred] = raw; patch = { preds: preds.filter(Boolean) };
    } else if (col.date) {
      const v = raw ? parseDateTime(raw) : null;
      if (raw && v == null) { toast('Nie rozpoznano daty. Wpisz np. 14.11.2026 14:00'); return; }
      patch = { [col.key]: v };
    } else if (col.num) {
      const v = raw ? parseNumber(raw) : null;
      if (raw && (v == null || v < 0)) { toast('Czas to liczba godzin, np. 46 albo 7,5'); return; }
      patch = { hours: v };
    } else patch = { [col.key]: raw || null };
    try { await updateOp(id, patch); } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
  }
  async function removeOp(id) {
    const op = st.opsByLp[id] || {};
    if (!(await confirmBox('Usuń operację', `Usunąć operację ${isSynthetic(id) ? '' : id + ' '}„${op.element || op.komis || ''}”?`, 'Usuń'))) return;
    try { await deleteOp(id); } catch (e) { toast('Nie usunięto: ' + (e.code || e.message)); }
  }
  function addDialog() {
    const free = (() => { let n = 1; for (const k of Object.keys(st.opsByLp)) if (/^\d+$/.test(k)) n = Math.max(n, Number(k) + 1); return String(n); })();
    const f = {};
    const inp = (key, label, value = '', w = '100%') => { f[key] = h('input', { type: 'text', value, style: { width: w, padding: '4px' }, spellcheck: 'false' }); return h('div', { style: { margin: '4px 0' } }, h('div', { class: 'muted' }, label), f[key]); };
    const m = modal('Nowa operacja', h('div', {},
      inp('lp', 'Numer operacji (lp.)', free, '120px'), inp('preds', 'Poprzednicy (numery po przecinku, max 4)'), inp('client', 'Klient'), inp('komis', 'Komis'), inp('element', 'Opis operacji'),
      inp('station', 'Stanowisko (np. 1Si, 2Un, 3Co, 5Śl)', '', '120px'), inp('hours', 'Czas [h]', '', '120px'),
      inp('startManual', 'Start ręcznie (np. 14.11.2026 14:00) – gdy sztywny termin albo brak poprzednika'), inp('endManual', 'Koniec ręcznie (rzeczywisty)'), inp('wysylka', 'Zakończenie / wysyłka'), inp('dostawa', 'Dostawa'), inp('status', 'Status (np. zak.)', '', '120px'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        const v = (k) => f[k].value.trim();
        const lp = v('lp');
        if (!/^\d+$/.test(lp)) { toast('Numer operacji to liczba'); return; }
        if (st.opsByLp[lp]) { toast('Operacja o numerze ' + lp + ' już istnieje'); return; }
        const preds = v('preds').split(/[\s,;]+/).filter(Boolean);
        if (preds.length > 4 || preds.some((p) => !/^\d+$/.test(p))) { toast('Poprzednicy: do 4 numerów'); return; }
        const op = { preds, client: v('client'), komis: v('komis'), element: v('element'), station: v('station'), status: v('status') };
        if (v('hours')) { const n = parseNumber(v('hours')); if (n == null || n < 0) { toast('Czas to liczba godzin'); return; } op.hours = n; }
        for (const k of ['startManual', 'endManual', 'wysylka', 'dostawa']) { if (v(k)) { const d = parseDateTime(v(k)); if (d == null) { toast('Nie rozpoznano daty: ' + v(k)); return; } op[k] = d; } }
        try { await saveOp(lp, op); m.close(); toast('Dodano operację ' + lp); } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
      } }, 'Dodaj'))));
    f.lp.focus();
  }
  scroller.addEventListener('scroll', () => requestAnimationFrame(paint));
  return {
    el,
    update(model) { st.opsByLp = model.opsByLp; st.rows = model.rows; rebuild(); },
    /** Identyfikatory operacji, które przechodzą filtry kolumn (null = brak filtrów). */
    allowed() { return Object.keys(st.filters).length ? new Set(visibleRows(st.rows, COLS, st.filters, val).map((r) => r.id)) : null; },
  };
}
