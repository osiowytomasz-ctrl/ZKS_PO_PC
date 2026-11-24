// Assembled Tool Viewer – jak w aplikacji na Androida (BnScreen.kt): zespoły narzędzi z arkusza BN. Filtry kaskadowe (grupa, rodzaj, Φ, L),
// kod na pasku zużycia z kolorem lokalizacji, L zespołu i komis _ KTK _ operacja, opis i parametry, przyciski Części / 2D / 3D,
// miniatura całego zespołu (kliknięcie – widok 2D) i elementy zespołu. Tylko odczyt.
import { h, clear, api } from '../ui.js';
import { getSnapshot, putSnapshot } from '../snapStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { toolroomAccess, toolroomLevelOf } from '../logic/toolroomAccess.js';
import { toolCatalog, confirmedContoursQuick } from '../catalog.js';
import * as B from '../logic/builder.js';
import * as G from '../logic/toolGeometry.js';
import { wearCodeCell, toolCard, stackSvg, view3d, toolView3d, partsTable, fullScreen, filterDropdown, statusLine, dimsOn, dimsToggle } from './toolViews.js';

const FILTERS = [['group', 'Grupa'], ['type', 'Rodzaj'], ['diameter', 'Φ'], ['length', 'L']];
const empty = () => ({ group: '', type: '', diameter: '', length: '' });

export function mountBn(el, ctx) {
  const st = { rows: [], filters: empty(), fromCache: false, loading: false, index: null, indexError: null };
  const status = statusLine();
  const filtersBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
  const list = h('div', { class: 'tool-list' });
  let view = 'list';
  try { view = localStorage.getItem('zks.bn.view') === 'tiles' ? 'tiles' : 'list'; } catch { /* domyślnie lista */ }
  // widok: lista albo kafelki (najwyżej 4 w wierszu)
  const viewBtn = h('button', { class: 'btn', title: 'Zmiana widoku: lista / kafelki', onclick: () => { view = view === 'tiles' ? 'list' : 'tiles'; try { localStorage.setItem('zks.bn.view', view); } catch { /* bez pamięci */ } paintView(); draw(); } });
  const paintView = () => { viewBtn.textContent = view === 'tiles' ? '☰ Lista' : '▦ Kafelki'; list.className = view === 'tiles' ? 'tool-grid max4' : 'tool-list'; };
  paintView();
  const refreshBtn = h('button', { class: 'btn', title: 'Połącz z arkuszem BN i pobierz aktualne dane (MASTER / GOD zapisują je w bazie Firebase)', onclick: () => refresh() }, 'Odśwież BN');

  const canStore = toolroomAccess(toolroomLevelOf(ctx.user)).manage;   // MASTER / GOD zapisują dane BN w bazie Firebase
  const when = (m) => new Date(m.updatedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  /** Dane BN z bazy Firebase (zapisane trwale); null – brak. */
  async function loadStored() {
    try {
      const snap = await getSnapshot('bn');
      if (!snap || !snap.data || !Array.isArray(snap.data.rows)) return false;
      st.rows = snap.data.rows; st.fromCache = false; draw();
      status.set(`Dane BN z bazy Firebase (${when(snap.meta)}${snap.meta.updatedBy ? ', ' + snap.meta.updatedBy : ''}). „Odśwież BN” łączy z arkuszem BN na żądanie${canStore ? ' i zapisuje nowe dane w bazie' : ' (zapis w bazie – MASTER / GOD)'}.`, 'neutral');
      return true;
    } catch (e) { status.set('Baza Firebase: ' + (e.code === 'permission-denied' ? 'brak dostępu (opublikuj reguły z snap_meta / snap_rows)' : e.message), 'error'); return false; }
  }
  /** Połączenie z arkuszem BN na żądanie; MASTER / GOD zapisują wynik trwale w Firebase. */
  async function refresh() {
    if (st.loading) return;
    st.loading = true; refreshBtn.disabled = true;
    status.set('Czytanie arkusza BN… przy dużej liczbie wierszy może to potrwać kilka minut.', 'neutral');
    try {
      const d = await api('getBNbaseData', [], { timeoutMs: 300000 });
      st.rows = (d && d.rows) || []; st.fromCache = false; draw();
      if (canStore && st.rows.length) {
        status.set('Zapis danych BN w bazie Firebase…', 'neutral');
        const meta = await putSnapshot('bn', { rows: st.rows }, { user: (ctx.user && (ctx.user.name || ctx.user.email)) || '', info: `zespoły: ${st.rows.length}` });
        status.set(`Dane BN pobrane z arkusza i zapisane w bazie Firebase (${when(meta)}).`, 'neutral');
      } else status.set(canStore ? 'Arkusz BN nie zwrócił wierszy.' : 'Dane BN z arkusza (tylko na tym komputerze – zapis w bazie: MASTER / GOD).', 'neutral');
    } catch (e) { status.set(e.message, 'error'); }
    st.loading = false; refreshBtn.disabled = false;
  }
  async function loadIndex() {
    try { st.index = G.toolIndex(await toolCatalog(), await confirmedContoursQuick()); st.indexError = null; } catch (e) { st.indexError = e.message; }
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
      for (; n < end; n++) list.append(view === 'tiles' ? tileItem(shown[n]) : rowItem(shown[n]));
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
    else if (view === 'd2') { const s = G.buildStack(codes.map((c) => st.index.stackTool(c)).filter(Boolean), true, false); if (!s) content = h('p', {}, 'Brak danych konturu 2D.'); else { const pane = h('div', { style: { flex: 1, minHeight: 0 } }), draw = () => { clear(pane); pane.append(stackSvg(s, { labels: true, dims: dimsOn(), width: 900, height: 900 })); }; draw(); content = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', gap: '4px' } }, h('div', { class: 'row' }, dimsToggle(draw)), pane); } }
    else content = toolView3d(st.index, codes);
    fullScreen(title, content);
  }

  /** Zespół jako kafelek: kod na pasku zużycia, miniatura całego zespołu (kliknięcie – widok 2D), opis i parametry, przyciski i elementy zespołu. */
  function tileItem(row) {
    const t = row.firstTool || {};
    const extra = B.bnExtraText(t);
    const stack = st.index ? G.buildStack(B.bnTeamCodes(row).map((c) => st.index.stackTool(c)).filter(Boolean), true, false) : null;
    const thumb = h('div', { class: 'tile-mini', style: { cursor: 'pointer' }, onclick: () => open('d2', row) },
      h('div', { class: 'tool-mini', style: { width: '90px', height: '140px', cursor: 'pointer' } }, stack ? stackSvg(stack, { pad: 4, width: 90, height: 140 }) : h('span', { class: 'muted', style: { fontSize: '10px' } }, 'brak')));
    return h('div', { class: 'tool-tile' },
      h('div', { class: 'tile-head' }, wearCodeCell(t.wear, t.location, t.warning, h('b', {}, t.code), String(t.teamTotalLength || '').trim() ? h('div', { style: { fontWeight: 700 } }, 'L=' + t.teamTotalLength) : null,
        extra ? h('div', { style: { fontSize: '10px', lineHeight: '12px' } }, extra) : null)),
      h('div', { class: 'tile-body' }, thumb,
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          toolCard([t.columnP, t.name, t.columnO].filter((x) => String(x ?? '').trim()).join(' | '), [['Φ', t.columnF], ['r/α', t.rAlpha], ['L', t.columnJ], ['Ms', t.columnM], ['Mk', t.columnN]]))),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '4px' } },
        h('button', { class: 'btn small', onclick: () => open('parts', row) }, 'Części'), h('button', { class: 'btn small', onclick: () => open('d2', row) }, '2D'), h('button', { class: 'btn small', onclick: () => open('d3', row) }, '3D')),
      (row.components || []).length ? h('div', { class: 'chip-row' }, ...row.components.map((c) => wearCodeCell(c.wear, c.location, c.warning, h('b', {}, c.code)))) : null);
  }

  function rowItem(row) {
    const t = row.firstTool || {};
    const extra = B.bnExtraText(t);
    const stack = st.index ? G.buildStack(B.bnTeamCodes(row).map((c) => st.index.stackTool(c)).filter(Boolean), true, false) : null;
    const thumb = h('div', { class: 'tool-mini-col', style: { cursor: 'pointer' }, onclick: () => open('d2', row) },
      stack ? h('div', { class: 'tool-mini', style: { width: '60px', height: '90px' } }, stackSvg(stack, { pad: 4, width: 60, height: 90 })) : h('span', { class: 'muted', style: { fontSize: '10px' } }, 'brak'));
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
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Assembled Tool Viewer'), h('span', { class: 'grow' }), viewBtn, refreshBtn), status, filtersBox, list);
  loadIndex();
  loadStored().then((ok) => { if (!ok && !st.rows.length) refresh(); });   // pierwszy raz (brak danych w bazie) – odczyt z arkusza i zapis w bazie
}
