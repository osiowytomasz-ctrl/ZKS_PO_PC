import { h, clear, api, apiCached, toast, modal, field, confirmBox, alertBox } from '../ui.js';
import * as P from '../logic/plan.js';
import { parseSheetColor } from '../logic/common.js';

export function mountPlan(el, ctx) {
  const st = { grid: null, expanded: new Set(), changes: new Map(), zoom: 100, saving: false };
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0 } });
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: save }, 'Zapisz zmiany');
  const zoomLabel = h('button', { class: 'btn small', onclick: () => setZoom(100) }, '100%');
  const info = h('span', { class: 'muted' });

  const setZoom = (z) => { st.zoom = Math.max(40, Math.min(200, z)); zoomLabel.textContent = st.zoom + '%'; body.style.fontSize = 13 * st.zoom / 100 + 'px'; };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

  async function load() {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie planu…'));
    try { st.changes = new Map(); await apiCached('api_getPlanGrid', [], (g, meta) => { st.grid = g; st.fresh = !meta.cached; if (st.fresh) st.changes = new Map(); draw(); }, { timeoutMs: 180000 }); }
    catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów'))); }
  }

  const key = (r, c) => r + ':' + c;
  const originalLines = (r, c) => {
    const runs = st.grid.runs?.[r]?.[c];
    if (runs) return P.splitLines(runs);
    const text = String(st.grid.values[r]?.[c] ?? '');
    const color = st.grid.fontColors?.[r]?.[c] || '#000000';
    return P.splitLines(text ? [{ text, color }] : []);
  };
  const currentLines = (r, c) => { const e = st.changes.get(key(r, c)); return e && e.type === 'text' ? e.lines : originalLines(r, c); };
  const cellDisplay = (r, c) => { const e = st.changes.get(key(r, c)); return e ? e.display : String(st.grid.values[r]?.[c] ?? ''); };

  function draw() {
    const g = st.grid;
    const widths = P.columnWidths(g);
    const rows = P.visibleRows(g, st.expanded);
    const canEdit = !!g.canEdit && ctx.level('plan') === 'write' && st.fresh;
    const first = g.firstVisibleCol ?? 1;
    const tbody = h('tbody', {});
    for (const r of rows) {
      const block = P.blockHeadedBy(g, r);
      const tr = h('tr', {});
      for (let c = first; c < widths.length; c++) {
        const kind = g.kinds?.[r]?.[c] || 'static';
        if (kind === 'hidden') continue;
        const k = key(r, c);
        const changed = st.changes.has(k);
        const td = h('td', { class: 'left' + (changed ? ' edited' : ''), style: { minWidth: widths[c] + 'px', maxWidth: widths[c] + 'px', whiteSpace: 'pre-wrap', verticalAlign: 'top', background: parseSheetColor(g.backgrounds?.[r]?.[c]), color: parseSheetColor(g.fontColors?.[r]?.[c], '#000'), outline: changed ? '2px solid #e65100' : '', outlineOffset: '-2px', cursor: (canEdit && ['edit', 'date', 'worker'].includes(kind)) ? 'cell' : 'default' } });
        if (kind === 'edit') {
          const lines = currentLines(r, c);
          lines.forEach((line, i) => { if (i) td.append(h('br')); for (const run of line) td.append(h('span', { style: { color: parseSheetColor(run.color, '#000') } }, run.text)); });
        } else {
          td.textContent = kind === 'date' && changed ? cellDisplay(r, c) : String(g.values[r]?.[c] ?? '');
        }
        if (block && kind === 'edit' && /KARTA PRACY/i.test(String(g.values[r]?.[c] ?? ''))) {
          td.prepend(h('b', { style: { cursor: 'pointer', marginRight: '4px' }, onclick: (e) => { e.stopPropagation(); st.expanded.has(block.id) ? st.expanded.delete(block.id) : st.expanded.add(block.id); draw(); } }, st.expanded.has(block.id) ? '▼' : '▶'));
        }
        if (canEdit && kind === 'edit') td.addEventListener('click', () => editText(r, c));
        else if (canEdit && kind === 'date') td.addEventListener('click', () => editDate(r, c));
        else if (canEdit && kind === 'worker') td.addEventListener('click', () => editWorker(r, c));
        tr.append(td);
      }
      tbody.append(tr);
    }
    clear(body); body.append(h('table', { class: 't' }, tbody));
    info.textContent = !st.fresh ? 'dane z pamięci, odświeżanie… (edycja po odświeżeniu)' : canEdit ? '' : 'tylko odczyt';
    saveBtn.disabled = st.saving || !st.changes.size || !canEdit;
    saveBtn.textContent = st.changes.size ? `Zapisz zmiany (${st.changes.size})` : 'Zapisz zmiany';
  }

  function editText(r, c) {
    const orig = P.plainText(originalLines(r, c));
    const cur = P.plainText(currentLines(r, c));
    const ta = h('textarea', { rows: 8, style: { width: '100%', padding: '6px' } }, cur === '' ? P.FIRST_ITEM : cur);
    const apply = () => {
      const clean = ta.value.replace(/\r/g, '');
      const k = key(r, c);
      if ((clean === P.FIRST_ITEM && orig === '') || clean === orig) st.changes.delete(k);
      else st.changes.set(k, { type: 'text', lines: P.composeLines(currentLines(r, c), clean, st.grid.userColor || '#000000'), get display() { return P.plainText(this.lines); } });
      m.close(); draw();
    };
    const m = modal('Edycja komórki', h('div', {}, ta, h('div', { class: 'muted' }, 'Nowe linie dostaną Twój kolor; istniejące zachowają swoje.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: apply }, 'OK'))));
    ta.focus();
  }
  function editDate(r, c) {
    const orig = st.grid.dateCells?.find((d) => d.row === r && d.col === c)?.value || '';
    const cur = st.changes.get(key(r, c));
    const inp = h('input', { type: 'date', value: cur ? cur.value : orig });
    const m = modal('Data', h('div', {}, field('Data', inp), h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { inp.value = ''; apply(); } }, 'Wyczyść'), h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: () => apply() }, 'OK'))));
    const apply = () => { const v = inp.value; if (v === orig) st.changes.delete(key(r, c)); else st.changes.set(key(r, c), { type: 'plain', value: v, display: P.displayDate(v) }); m.close(); draw(); };
  }
  function editWorker(r, c) {
    const orig = String(st.grid.values[r]?.[c] ?? '');
    const cur = st.changes.get(key(r, c));
    const sel = h('select', { style: { width: '100%', padding: '6px' } }, h('option', { value: '' }, '(brak)'), ...(st.grid.workers || []).map((w) => h('option', { value: w, selected: (cur ? cur.value : orig) === w }, w)));
    const m = modal('Pracownik', h('div', {}, sel, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
      h('button', { class: 'btn primary', onclick: () => { const v = sel.value; if (v === orig) st.changes.delete(key(r, c)); else st.changes.set(key(r, c), { type: 'plain', value: v, display: v }); m.close(); draw(); } }, 'OK'))));
  }

  async function save() {
    if (st.saving || !st.changes.size) return;
    if (!(await confirmBox('Zapisać plan?', `Zmienione komórki: ${st.changes.size}.`, 'Zapisz'))) return;
    const list = [...st.changes].map(([k, e]) => { const [row, col] = k.split(':').map(Number); return { row, col, value: e.type === 'text' ? P.toHtml(e.lines) : e.value }; });
    st.saving = true; saveBtn.disabled = true;
    try {
      const r = await api('savePlanData', [list]);
      st.saving = false; st.changes = new Map(); toast((r && r.message) || 'Zmiany zapisane.'); load();
    } catch (e) {
      st.saving = false; draw();
      await alertBox('Plan', 'Błąd zapisu planu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież plan i sprawdź, zanim zapiszesz ponownie.' : ''));
    }
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, saveBtn,
    h('button', { class: 'btn', onclick: async () => { if (st.changes.size && !(await confirmBox('Odświeżyć?', 'Niezapisane zmiany zostaną utracone.', 'Odśwież'))) return; load(); } }, 'Odśwież'),
    h('button', { class: 'btn small', onclick: () => setZoom(st.zoom - 10) }, '−'), zoomLabel, h('button', { class: 'btn small', onclick: () => setZoom(st.zoom + 10) }, '+'), info), body);
  setZoom(100); load();
}
