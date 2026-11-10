// Tabela danych Harmonogramu (jak karta Harmonogram w arkuszu): edycja wyłącznie danych twardych; Start i Koniec liczy program.
import { h, clear, modal, confirmBox, toast } from '../ui.js';
import { fmtDt } from '../logic/harmModel.js';
import { parseDateTime, parseNumber } from '../logic/harmImport.js';
import { updateOp, saveOp, deleteOp } from '../harmStore.js';

const ROW = 26;
const COLS = [
  { key: 'lp', title: 'lp.', w: 52, ro: true },
  { key: 'z1', title: 'Z1', w: 46, pred: 0 }, { key: 'z2', title: 'Z2', w: 46, pred: 1 }, { key: 'z3', title: 'Z3', w: 46, pred: 2 }, { key: 'z4', title: 'Z4', w: 46, pred: 3 },
  { key: 'client', title: 'Klient', w: 130, text: true }, { key: 'komis', title: 'Komis', w: 78, text: true }, { key: 'element', title: 'Opis operacji', w: 320, text: true },
  { key: 'calcStart', title: 'Start (liczony)', w: 116, ro: true }, { key: 'startManual', title: 'Start ręcznie', w: 116, date: true },
  { key: 'hours', title: 'Czas [h]', w: 60, num: true }, { key: 'endManual', title: 'Koniec ręcznie', w: 116, date: true }, { key: 'calcEnd', title: 'Koniec (liczony)', w: 116, ro: true },
  { key: 'wysylka', title: 'Zakończenie', w: 116, date: true }, { key: 'dostawa', title: 'Dostawa', w: 116, date: true }, { key: 'station', title: 'Stan.', w: 60, text: true },
];
const TOTAL_W = COLS.reduce((a, c) => a + c.w, 0) + 44;

function valueOf(col, lp, op, res) {
  if (col.key === 'lp') return /^s\d+$/.test(lp) ? '' : lp;
  if (col.pred !== undefined) return (op.preds || [])[col.pred] || '';
  if (col.key === 'calcStart') return fmtDt(res?.start);
  if (col.key === 'calcEnd') return fmtDt(res?.end);
  const v = op[col.key];
  if (col.date) return fmtDt(v);
  return v == null ? '' : String(v);
}

/** Zwraca {el, update(model)}; model = {opsByLp, result}. */
export function createTable() {
  const st = { opsByLp: {}, result: new Map(), q: '', station: '', rows: [], editing: null };
  const search = h('input', { type: 'search', placeholder: 'Szukaj (komis, opis, lp, klient)…', style: { width: '240px', padding: '4px' }, oninput: () => { st.q = search.value.trim().toLowerCase(); rebuild(); } });
  const stationSel = h('select', { onchange: () => { st.station = stationSel.value; rebuild(); } });
  const info = h('span', { class: 'muted' });
  const spacer = h('div', { style: { position: 'relative', width: TOTAL_W + 'px' } });
  const head = h('div', { style: { position: 'sticky', top: 0, zIndex: 3, display: 'flex', width: TOTAL_W + 'px', background: '#eee', borderBottom: '1px solid #888' } },
    ...COLS.map((c) => h('div', { style: { width: c.w + 'px', flex: 'none', padding: '4px', fontWeight: 700, fontSize: '12px', boxSizing: 'border-box', borderRight: '1px solid #ccc', background: c.ro ? '#e4e4e4' : '#eee' } }, c.title)), h('div', { style: { width: '44px' } }));
  const scroller = h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', border: '1px solid #ccc' } }, head, spacer);
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row panel' }, search, stationSel, h('button', { class: 'btn small primary', onclick: () => addDialog() }, 'Dodaj operację'), h('span', { class: 'grow' }), info,
      h('span', { class: 'muted' }, 'Zmieniasz tylko dane twarde; Start i Koniec (liczony) wylicza program.')), scroller);

  const lps = () => Object.keys(st.opsByLp);
  function rebuild() {
    const q = st.q;
    st.rows = lps().sort((a, b) => (Number(a.replace(/^s/, '')) + (a[0] === 's' ? 1e9 : 0)) - (Number(b.replace(/^s/, '')) + (b[0] === 's' ? 1e9 : 0)))
      .filter((lp) => {
        const o = st.opsByLp[lp];
        if (st.station && o.station !== st.station) return false;
        return !q || [lp, o.komis, o.element, o.client].some((x) => String(x ?? '').toLowerCase().includes(q));
      });
    spacer.style.height = st.rows.length * ROW + 'px';
    info.textContent = `Operacji: ${st.rows.length} z ${lps().length}`;
    paint();
  }
  function paint() {
    if (st.editing) return;           // nie przerysowujemy w trakcie wpisywania
    const top = Math.max(0, scroller.scrollTop - ROW), vh = scroller.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / ROW)), to = Math.min(st.rows.length, Math.ceil((top + vh + 2 * ROW) / ROW));
    clear(spacer);
    for (let i = from; i < to; i++) spacer.append(rowEl(st.rows[i], i));
  }
  function rowEl(lp, i) {
    const op = st.opsByLp[lp], res = st.result.get(lp);
    const bad = res && (res.state === 'cycle');
    const row = h('div', { style: { position: 'absolute', top: i * ROW + 'px', left: 0, display: 'flex', height: ROW + 'px', width: TOTAL_W + 'px', background: i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #eee' } });
    for (const col of COLS) {
      const text = valueOf(col, lp, op, res);
      const predMissing = col.pred !== undefined && text && !st.opsByLp[text];
      const cell = h('div', { title: predMissing ? 'Brak operacji o tym numerze' : col.key === 'calcStart' && res?.state === 'no-start' ? 'Brak startu: ustaw start ręcznie albo uzupełnij poprzedniki' : bad ? 'Zależności tworzą cykl' : '',
        style: { width: col.w + 'px', flex: 'none', height: ROW + 'px', lineHeight: ROW - 2 + 'px', padding: '0 4px', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '12px', borderRight: '1px solid #eee',
          background: col.ro ? '#f3f3f3' : predMissing ? '#ffd6d6' : 'transparent', color: col.ro ? '#333' : '#000', cursor: col.ro ? 'default' : 'text' } }, text);
      if (!col.ro) cell.addEventListener('click', () => startEdit(cell, lp, col, text));
      row.append(cell);
    }
    row.append(h('div', { style: { width: '44px', flex: 'none', textAlign: 'center' } }, h('button', { class: 'btn small', title: 'Usuń operację', onclick: () => removeOp(lp) }, '✕')));
    return row;
  }
  function startEdit(cell, lp, col, text) {
    if (st.editing) return;
    st.editing = true;
    const input = h('input', { type: 'text', value: text, spellcheck: 'false', style: { width: '100%', height: ROW - 2 + 'px', boxSizing: 'border-box', border: '2px solid #1a73e8', padding: '0 3px', fontSize: '12px' } });
    clear(cell); cell.style.padding = '0'; cell.append(input); input.focus(); input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true; st.editing = false;
      if (commit && input.value.trim() !== text.trim()) await save(lp, col, input.value.trim());
      paint();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true); }
    });
    input.addEventListener('blur', () => finish(true));
  }
  async function save(lp, col, raw) {
    let patch;
    if (col.pred !== undefined) {
      const preds = [...(st.opsByLp[lp].preds || [])]; while (preds.length <= col.pred) preds.push('');
      preds[col.pred] = raw;
      if (raw && !/^(\d+|s\d+)$/.test(raw)) { toast('Poprzednik to numer operacji (lp.)'); return; }
      if (raw === lp) { toast('Operacja nie może być swoim poprzednikiem'); return; }
      patch = { preds: preds.filter(Boolean) };
    } else if (col.date) {
      const v = raw ? parseDateTime(raw) : null;
      if (raw && v == null) { toast('Nie rozpoznano daty. Wpisz np. 14.11.2026 14:00'); return; }
      patch = { [col.key]: v };
    } else if (col.num) {
      const v = raw ? parseNumber(raw) : null;
      if (raw && (v == null || v < 0)) { toast('Czas to liczba godzin, np. 46 albo 7,5'); return; }
      patch = { hours: v };
    } else patch = { [col.key]: raw || null };
    try { await updateOp(lp, patch); } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
  }
  async function removeOp(lp) {
    const op = st.opsByLp[lp];
    if (!(await confirmBox('Usuń operację', `Usunąć operację ${/^s\d+$/.test(lp) ? '' : lp + ' '}„${op.element || op.komis || ''}”?`, 'Usuń'))) return;
    try { await deleteOp(lp); } catch (e) { toast('Nie usunięto: ' + (e.code || e.message)); }
  }
  function addDialog() {
    const free = (() => { let n = 1; for (const k of lps()) if (/^\d+$/.test(k)) n = Math.max(n, Number(k) + 1); return String(n); })();
    const f = {};
    const inp = (key, label, value = '', w = '100%') => { f[key] = h('input', { type: 'text', value, style: { width: w, padding: '4px' }, spellcheck: 'false' }); return h('div', { style: { margin: '4px 0' } }, h('div', { class: 'muted' }, label), f[key]); };
    const m = modal('Nowa operacja', h('div', {},
      inp('lp', 'Numer operacji (lp.)', free, '120px'), inp('preds', 'Poprzednicy (numery po przecinku, max 4)'), inp('client', 'Klient'), inp('komis', 'Komis'), inp('element', 'Opis operacji'),
      inp('station', 'Stanowisko (np. 1Si, 2Un, 3Co, 5Śl)', '', '120px'), inp('hours', 'Czas [h]', '', '120px'),
      inp('startManual', 'Start ręcznie (np. 14.11.2026 14:00) – tylko gdy sztywny termin albo brak poprzednika'), inp('endManual', 'Koniec ręcznie (rzeczywisty)'), inp('wysylka', 'Zakończenie / wysyłka'), inp('dostawa', 'Dostawa'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        const v = (k) => f[k].value.trim();
        const lp = v('lp');
        if (!/^\d+$/.test(lp)) { toast('Numer operacji to liczba'); return; }
        if (st.opsByLp[lp]) { toast('Operacja o numerze ' + lp + ' już istnieje'); return; }
        const preds = v('preds').split(/[\s,;]+/).filter(Boolean);
        if (preds.length > 4 || preds.some((p) => !/^\d+$/.test(p))) { toast('Poprzednicy: do 4 numerów'); return; }
        const op = { preds, client: v('client'), komis: v('komis'), element: v('element'), station: v('station') };
        if (v('hours')) { const n = parseNumber(v('hours')); if (n == null || n < 0) { toast('Czas to liczba godzin'); return; } op.hours = n; }
        for (const k of ['startManual', 'endManual', 'wysylka', 'dostawa']) { if (v(k)) { const d = parseDateTime(v(k)); if (d == null) { toast('Nie rozpoznano daty: ' + v(k)); return; } op[k] = d; } }
        try { await saveOp(lp, op); m.close(); toast('Dodano operację ' + lp); } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
      } }, 'Dodaj'))));
    f.lp.focus();
  }
  scroller.addEventListener('scroll', () => requestAnimationFrame(paint));
  return {
    el,
    update(model) {
      st.opsByLp = model.opsByLp; st.result = model.result || new Map();
      const stations = [...new Set(lps().map((k) => st.opsByLp[k].station).filter(Boolean))].sort();
      const cur = st.station;
      clear(stationSel); stationSel.append(h('option', { value: '' }, 'Wszystkie stanowiska'), ...stations.map((s) => h('option', { value: s }, s)));
      stationSel.value = stations.includes(cur) ? cur : ''; st.station = stationSel.value;
      rebuild();
    },
  };
}
