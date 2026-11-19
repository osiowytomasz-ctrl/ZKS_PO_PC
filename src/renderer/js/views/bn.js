// Assembled Tool Viewer – jak w aplikacji na Androida (BnScreen.kt): zespoły narzędzi z arkusza BN. Filtry kaskadowe (grupa, rodzaj, Φ, L),
// kod na pasku zużycia z kolorem lokalizacji, L zespołu i komis _ KTK _ operacja, opis i parametry, przyciski Części / 2D / 3D,
// miniatura całego zespołu (kliknięcie – widok 2D) i elementy zespołu. Tylko odczyt.
import { h, clear, apiCached } from '../ui.js';
import { toolCatalog } from '../catalog.js';
import * as B from '../logic/builder.js';
import * as G from '../logic/toolGeometry.js';
import { wearCodeCell, toolCard, stackSvg, view3d, partsTable, fullScreen, filterDropdown, statusLine } from './toolViews.js';

const FILTERS = [['group', 'Grupa'], ['type', 'Rodzaj'], ['diameter', 'Φ'], ['length', 'L']];
const empty = () => ({ group: '', type: '', diameter: '', length: '' });

export function mountBn(el, ctx) {
  const st = { rows: [], filters: empty(), fromCache: false, loading: false, index: null, indexError: null };
  const status = statusLine();
  const filtersBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
  const list = h('div', { class: 'tool-list' });
  const refreshBtn = h('button', { class: 'btn', onclick: () => refresh() }, 'Odśwież BN');

  async function refresh() {
    if (st.loading) return;
    st.loading = true; refreshBtn.disabled = true;
    status.set('Czytanie arkusza BN… przy dużej liczbie wierszy może to potrwać kilka minut.', 'neutral');
    try {
      await apiCached('getBNbaseData', [], (d, meta) => { st.rows = d.rows || []; st.fromCache = meta.cached; draw(); }, { timeoutMs: 300000 });
      status.set(st.fromCache ? 'Dane z pamięci komputera. „Odśwież BN” pobiera aktualne z arkusza.' : '', 'neutral');
    } catch (e) { status.set(e.message, 'error'); }
    st.loading = false; refreshBtn.disabled = false;
  }
  async function loadIndex() {
    try { st.index = G.toolIndex(await toolCatalog()); st.indexError = null; } catch (e) { st.indexError = e.message; }
    draw();
  }

  function draw() {
    clear(filtersBox);
    if (st.rows.length) {
      filtersBox.append(...FILTERS.map(([f, l]) => filterDropdown(l, st.filters[f], B.bnOptions(st.rows, st.filters, f), (v) => { st.filters[f] = v; draw(); })));
      if (Object.values(st.filters).some((v) => String(v).trim())) filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = empty(); draw(); } }, 'Wyczyść'));
    }
    const shown = B.bnFilter(st.rows, st.filters);
    clear(list);
    if (st.indexError) list.append(h('div', { class: 'err' }, 'Nie wczytano danych narzędzi (części, 2D, 3D): ' + st.indexError, ' ', h('button', { class: 'btn small', onclick: loadIndex }, 'Ponów')));
    if (st.rows.length) list.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, `Zespoły: ${shown.length} z ${st.rows.length}`));
    if (!shown.length && st.rows.length) list.append(h('div', {}, 'Brak narzędzi spełniających kryteria.'));
    let n = 0;
    const more = () => {
      const end = Math.min(shown.length, n + 150);
      for (; n < end; n++) list.append(rowItem(shown[n]));
      if (n < shown.length) { const b = h('button', { class: 'btn', onclick: () => { b.remove(); more(); } }, `Pokaż kolejne (${shown.length - n})`); list.append(b); }
    };
    more();
  }

  function open(view, row) {
    const codes = B.bnTeamCodes(row);
    const title = { parts: 'Części zamienne', d2: 'Widok 2D', d3: 'Widok 3D' }[view] + ' · ' + codes.join('; ');
    let content;
    if (!st.index) content = h('p', {}, st.indexError ? 'Brak danych narzędzi: ' + st.indexError : 'Ładowanie danych narzędzi…');
    else if (view === 'parts') content = partsTable(st.index.partRows(codes));
    else if (view === 'd2') { const s = G.buildStack(codes.map((c) => st.index.stackTool(c)).filter(Boolean), true, false); content = s ? stackSvg(s, { labels: true, width: 900, height: 900 }) : h('p', {}, 'Brak danych konturu 2D.'); }
    else content = view3d(G.buildMesh(codes.map((c) => G.parseContour((st.index.details(c) || {}).columnAY))));
    fullScreen(title, content);
  }

  function rowItem(row) {
    const t = row.firstTool || {};
    const extra = B.bnExtraText(t);
    const stack = st.index ? G.buildStack(B.bnTeamCodes(row).map((c) => st.index.stackTool(c)).filter(Boolean), true, false) : null;
    const thumb = h('div', { class: 'tool-mini-col', style: { cursor: 'pointer' }, onclick: () => open('d2', row) },
      stack ? h('div', { style: { width: '60px', height: '100%', minHeight: '70px' } }, stackSvg(stack, { pad: 4, width: 60, height: 90 })) : h('span', { class: 'muted', style: { fontSize: '10px' } }, 'brak'));
    return h('div', { class: 'tool-row', style: { flexDirection: 'column' } },
      h('div', { style: { display: 'flex', alignItems: 'stretch' } },
        wearCodeCell(t.wear, t.location, t.warning, h('b', {}, t.code), String(t.teamTotalLength || '').trim() ? h('div', { style: { fontWeight: 700 } }, 'L=' + t.teamTotalLength) : null,
          extra ? h('div', { style: { fontSize: '10px', lineHeight: '12px' } }, extra) : null),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          toolCard([t.columnP, t.name, t.columnO].filter((s) => String(s ?? '').trim()).join(' | '), [['Φ', t.columnF], ['r/α', t.rAlpha], ['L', t.columnJ], ['Ms', t.columnM], ['Mk', t.columnN]]),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '2px' } },
            h('button', { class: 'btn small', onclick: () => open('parts', row) }, 'Części'), h('button', { class: 'btn small', onclick: () => open('d2', row) }, '2D'), h('button', { class: 'btn small', onclick: () => open('d3', row) }, '3D'))),
        thumb),
      (row.components || []).length ? h('div', { class: 'chip-row' }, ...row.components.map((c) => wearCodeCell(c.wear, c.location, c.warning, h('b', {}, c.code)))) : null);
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Assembled Tool Viewer'), h('span', { class: 'grow' }), refreshBtn), status, filtersBox, list);
  loadIndex();
  refresh();
}
