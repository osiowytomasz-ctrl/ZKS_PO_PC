import { h, clear, api, apiCached, toast, modal, field, filterHeader, columnFilterDialog, confirmBox } from '../ui.js';
import * as G from '../logic/grafik.js';
import { updateSorts, sortLabels, parseSheetColor, filterSummary } from '../logic/common.js';
import { sortSummary } from '../logic/tableFilter.js';

export function mountGrafik(el, ctx) {
  const canWrite = ctx.level('grafik') === 'write';
  let [start, end] = G.defaultRange();
  const st = { data: null, loaded: { start: '', end: '' }, changes: new Map(), filters: {}, sorts: [], zoom: 100, saving: false };

  const startIn = h('input', { type: 'date', value: start });
  const endIn = h('input', { type: 'date', value: end });
  const info = h('span', { class: 'muted' });
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: save }, 'Zapisz zmiany');
  const discardBtn = h('button', { class: 'btn', disabled: true, onclick: discard }, 'Odrzuć zmiany');
  const clearBtn = h('button', { class: 'btn', onclick: () => { st.filters = {}; st.sorts = []; draw(); } }, 'Wyczyść filtry i sortowanie');
  const zoomLabel = h('button', { class: 'btn small', title: 'Kliknij, aby wrócić do 100%', onclick: () => setZoom(100) }, '100%');
  const body = h('div', { class: 'gr table-wrap', style: { flex: 1, minHeight: 0 } });
  const message = h('div', { class: 'muted' });

  function setZoom(z) {
    st.zoom = Math.max(50, Math.min(200, z));
    zoomLabel.textContent = st.zoom + '%';
    body.style.setProperty('--z', st.zoom / 100);
  }
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

  async function load(s, e) {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie grafiku…')); message.textContent = '';
    st.changes = new Map(); st.filters = {}; st.sorts = []; st.fresh = false;
    const show = (range) => (data, meta) => { st.data = data; st.loaded = range; st.fresh = !meta.cached; if (st.fresh) st.changes = new Map(); draw(); };
    try {
      try {
        await apiCached('getGrData', [s, e], show({ start: s, end: e }));
      } catch (err) {
        // Gdy arkusz nie ma dat z zakresu, pokazujemy cały grafik (jak w aplikacji na Androida).
        if (/zakres/i.test(err.message)) { startIn.value = ''; endIn.value = ''; await apiCached('getGrData', ['', ''], show({ start: '', end: '' })); }
        else throw err;
      }
    } catch (err) {
      clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, err.message, ' ', h('button', { class: 'btn small', onclick: () => load(startIn.value, endIn.value) }, 'Ponów')));
    }
  }

  const cellValue = (r, c) => {
    const k = r + ':' + c;
    return st.changes.has(k) ? st.changes.get(k) : String(st.data.extraValues[r]?.[c] ?? '');
  };

  function draw() {
    const data = st.data;
    if (!data) return;
    const header = (data.extraValues && data.extraValues[0]) || [];
    const visible = G.visibleIndexes(header, startIn.value || null, endIn.value || null);
    const cols = G.columns(data, visible);
    const labels = sortLabels(st.sorts);
    const rows = G.gridSorted(data, cols, st.sorts, G.gridVisibleRows(data, cols, st.filters));
    const canEdit = canWrite && data.canEdit && st.fresh;

    const thead = h('tr', {}, ...cols.map((c, i) => filterHeader(c, {
      filtered: !!st.filters[c.key], label: labels[c.key], vertical: i >= 2,
      extra: i === 0 ? { class: 'click stick' + (st.filters[c.key] ? ' filtered' : '') } : {},
      onclick: () => openFilter(c, cols),
    })));
    const tbody = h('tbody', {});
    for (const r of rows) {
      const row = data.rows[r];
      const tr = h('tr', {});
      tr.append(h('td', { class: 'stick left', style: { background: parseSheetColor(row.nameBg), color: parseSheetColor(row.nameColor, '#000') } }, G.cleanName(row.name)));
      tr.append(h('td', { style: { background: parseSheetColor(row.valueBg), color: parseSheetColor(row.valueColor, '#000') } }, String(row.value ?? '').trim()));
      for (const c of cols.slice(2)) {
        const k = r + ':' + c.col;
        const v = cellValue(r, c.col);
        const td = h('td', {
          class: (st.changes.has(k) ? 'edited ' : '') + (canEdit ? 'editable' : ''),
          style: { background: parseSheetColor(data.extraBackgrounds?.[r]?.[c.col]), color: parseSheetColor(data.extraFontColors?.[r]?.[c.col], '#000') },
          onclick: canEdit ? () => editCell(r, c, row) : null,
        }, v);
        tr.append(td);
      }
      tbody.append(tr);
    }
    clear(body);
    body.append(h('table', { class: 't' }, h('thead', {}, thead), tbody));
    info.textContent = `Wierszy: ${rows.length}` + (G.dataRows(data).length !== rows.length ? ` z ${G.dataRows(data).length}` : '') +
      (st.sorts.length ? '  ·  Sortowanie: ' + sortSummary(cols, Object.fromEntries(cols.map((c) => [c.key, c.title])), st.sorts) : '') +
      (!st.fresh ? '  ·  dane z pamięci, odświeżanie… (edycja po odświeżeniu)' : canEdit ? '' : '  ·  tylko odczyt');
    saveBtn.disabled = st.saving || st.changes.size === 0 || !canEdit;
    discardBtn.disabled = st.changes.size === 0;
    saveBtn.textContent = st.changes.size ? `Zapisz zmiany (${st.changes.size})` : 'Zapisz zmiany';
    clearBtn.disabled = !Object.keys(st.filters).length && !st.sorts.length;
  }

  function openFilter(column, cols) {
    const opts = G.gridOptions(st.data, cols, st.filters, column);
    const cur = st.sorts.find((s) => s.key === column.key);
    columnFilterDialog({
      title: column.title, options: opts, activeFilter: st.filters[column.key], activeSort: cur ? cur.ascending : null,
      onApply: (filter, sort) => {
        if (filter) st.filters[column.key] = filter; else delete st.filters[column.key];
        st.sorts = updateSorts(st.sorts, column.key, sort);
        draw();
      },
    });
  }

  function editCell(r, c, row) {
    const input = h('input', { type: 'text', value: cellValue(r, c.col), style: { width: '100%', padding: '6px' } });
    const m = modal(`${G.cleanName(row.name)} · ${c.title}`, h('div', {}, input,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
        h('button', { class: 'btn primary', onclick: () => apply() }, 'OK'))));
    const apply = () => {
      const clean = input.value.trim();
      const original = String(st.data.extraValues[r]?.[c.col] ?? '');
      const k = r + ':' + c.col;
      if (clean === original) st.changes.delete(k); else st.changes.set(k, clean);
      m.close(); draw();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    input.focus(); input.select();
  }

  async function discard() {
    if (st.changes.size && !(await confirmBox('Odrzucić zmiany?', `Niezapisane zmiany: ${st.changes.size}.`, 'Odrzuć'))) return;
    st.changes = new Map(); draw();
  }

  async function save() {
    if (st.saving || !st.changes.size) return;
    const list = [...st.changes].map(([k, value]) => { const [row, col] = k.split(':').map(Number); return { row, col, value }; });
    if (!(await confirmBox('Zapisać grafik?', `Zmienione komórki: ${list.length}.`, 'Zapisz'))) return;
    st.saving = true; saveBtn.disabled = true;
    try {
      // Daty muszą być te same, z którymi pobrano dane (indeksy kolumn są względem pobranego zakresu).
      const r = await api('saveGrData', [list, st.loaded.start, st.loaded.end]);
      toast((r && r.message) || 'Grafik zapisany.');
      st.changes = new Map(); st.saving = false;
      await load(st.loaded.start, st.loaded.end);
    } catch (e) {
      st.saving = false;
      const hint = e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież grafik i sprawdź, zanim spróbujesz ponownie.' : '';
      toast('Błąd zapisu grafiku: ' + e.message + hint, true);
      draw();
    }
  }

  const apply = h('button', { class: 'btn', onclick: () => load(startIn.value, endIn.value) }, 'Pokaż');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '8px';
  el.append(
    h('div', { class: 'row panel' }, 'Od', startIn, 'do', endIn, apply, h('span', { class: 'grow' }),
      h('button', { class: 'btn small', onclick: () => setZoom(st.zoom - 10) }, '−'), zoomLabel,
      h('button', { class: 'btn small', onclick: () => setZoom(st.zoom + 10) }, '+')),
    h('div', { class: 'row' }, saveBtn, discardBtn, clearBtn, info), message, body);
  setZoom(100);
  load(startIn.value, endIn.value);
}
