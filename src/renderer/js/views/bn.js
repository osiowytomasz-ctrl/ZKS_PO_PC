import { h, clear, apiCached, modal } from '../ui.js';
import * as B from '../logic/builder.js';

const LABELS = { group: 'Grupa', type: 'Rodzaj', diameter: 'Ø', length: 'Długość' };

export function mountBn(el, ctx) {
  const st = { rows: [], filters: { group: '', type: '', diameter: '', length: '' }, fromCache: false, loading: false };
  const info = h('span', { class: 'muted' });
  const filtersBox = h('div', { class: 'row' });
  const listBox = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0 } });

  async function refresh() {
    if (st.loading) return;
    st.loading = true; info.textContent = 'Pobieranie zespołów z arkusza BN (może potrwać)…';
    try { await apiCached('getBNbaseData', [], (d, meta) => { st.rows = d.rows || []; st.fromCache = meta.cached; draw(); }, { timeoutMs: 300000 }); }
    catch (e) { info.textContent = ''; clear(listBox); listBox.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message)); }
    st.loading = false;
  }

  function draw() {
    clear(filtersBox);
    for (const f of B.BN_FIELDS) {
      const sel = h('select', { style: { padding: '4px' }, onchange: () => { st.filters[f] = sel.value; draw(); } }, h('option', { value: '' }, LABELS[f]),
        ...B.bnOptions(st.rows, st.filters, f).map((o) => h('option', { value: o, selected: String(st.filters[f]).toLowerCase() === o.toLowerCase() }, o)));
      filtersBox.append(sel);
    }
    filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = { group: '', type: '', diameter: '', length: '' }; draw(); } }, 'Wyczyść'));
    const shown = B.bnFilter(st.rows, st.filters);
    const tbody = h('tbody', {});
    for (const r of shown.slice(0, 1000)) {
      const t = r.firstTool || {};
      tbody.append(h('tr', { class: 'click', onclick: () => detail(r) },
        h('td', { class: 'left', style: { fontWeight: 600 } }, B.bnTeamCodes(r).join('; ')), h('td', {}, r.columnJ), h('td', {}, r.columnK), h('td', {}, t.columnF),
        h('td', {}, (t.teamTotalLength || '').trim() ? t.teamTotalLength : t.columnJ), h('td', { class: 'left' }, B.bnExtraText(t))));
    }
    clear(listBox);
    listBox.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...['Kody zespołu', 'Grupa', 'Rodzaj', 'Ø', 'Długość', 'Komis _ KTK _ operacja'].map((x) => h('th', {}, x)))), tbody),
      !shown.length ? h('div', { class: 'muted', style: { padding: '10px' } }, st.rows.length ? 'Brak zespołów dla wybranych filtrów.' : 'Brak danych. Kliknij „Odśwież BN”.') : null);
    info.textContent = `Zespołów: ${shown.length}` + (st.fromCache ? '  ·  dane z pamięci, odświeżanie…' : '');
  }

  function detail(r) {
    const parts = [r.firstTool, ...(r.components || [])].filter(Boolean);
    const m = modal('Zespół narzędzi', h('div', {}, h('div', { class: 'muted' }, B.bnExtraText(r.firstTool || {})),
      ...parts.map((t, i) => h('div', { class: 'row', style: { margin: '3px 0' } }, h('b', { style: { width: '120px' } }, `${i + 1}. ${t.code}`), h('span', { class: 'grow' }, B.description(t)),
        h('span', { class: 'muted' }, [t.columnF && 'Ø' + t.columnF, t.columnJ && 'L' + t.columnJ, t.location].filter(Boolean).join(' · ')),
        h('span', { style: { color: t.missing ? '#c62828' : '#2e7d32', fontWeight: 600 } }, t.missing ? 'brak w katalogu' : Math.round(t.wear) + '%'))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('span', { class: 'grow' }), info, h('button', { class: 'btn', onclick: refresh }, 'Odśwież BN')), filtersBox, listBox);
  refresh();
}
