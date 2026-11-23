// Narzędziownia → Zniszczone: wszystkie narzędzia ze stanem zużycia i ich historia (karta ZN: procent zniszczenia, kto / gdzie, data, kwota strat, opis zniszczeń, przyczyna)
// oraz rozszerzona informacja o narzędziu (katalog i PSWT: grupa, rodzaj, Φ, L, Lrob, mocowania, firma, lokalizacja, rysunek 2D). W ToolBuilderze zostaje informacja ogólna.
// Dane karty ZN: odczyt z arkusza raz, zapis w bazie Firebase (klucz „zn”), potem na życzenie (przycisk „Odśwież z karty ZN”; zapis w bazie: MASTER / GOD).
import { h, clear, api, toast, modal } from '../ui.js';
import { getSnapshot, putSnapshot } from '../snapStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { toolCatalog, confirmedContoursQuick } from '../catalog.js';
import { ndLoad } from '../ndStore.js';
import { normCode, wearPercent } from '../logic/tooltrack.js';
import * as G from '../logic/toolGeometry.js';
import * as D from '../logic/destroyed.js';
import { stackSvg, fullScreen, lazyFill } from './toolViews.js';
import { naturalCompare } from '../logic/common.js';

const when = (m) => new Date(m.updatedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function mountDestroyed(el, ctx) {
  const canStore = grafikAccess(grafikLevelOf(ctx.user)).manage;
  const st = { values: null, meta: null, groups: [], index: null, params: {}, cat: null, q: '', grp: '', firma: '', year: '', min: 0, sort: 'date', dir: 1, noPct: false, track: true, loading: false, stop: null };
  const status = h('span', { class: 'muted' }), info = h('span', { class: 'muted' });
  const grid = h('div', { class: 'tool-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' } });
  const sel = (fn, ...opts) => { const s = h('select', { class: 'filter-dd', onchange: () => { fn(s.value); s.classList.toggle('on', !!s.value && s.value !== '0'); draw(); } }, ...opts); return s; };
  const grpSel = sel((v) => { st.grp = v; }), firmaSel = sel((v) => { st.firma = v; }), yearSel = sel((v) => { st.year = v; });
  const minSel = sel((v) => { st.min = Number(v); }, ...[[0, 'Stan: wszystkie'], [20, 'Stan ≥ 20%'], [50, 'Stan ≥ 50%'], [100, 'Stan 100%']].map(([v, l]) => h('option', { value: v }, l)));
  const sortSel = h('select', { title: 'Sortowanie', onchange: () => { st.sort = sortSel.value; draw(); } }, ...D.SORTS.map(([v, l]) => h('option', { value: v }, 'Sortuj: ' + l)));
  const dirBtn = h('button', { class: 'btn', title: 'Kierunek sortowania', onclick: () => { st.dir = -st.dir; dirBtn.textContent = st.dir > 0 ? '↑' : '↓'; draw(); } }, '↑');
  const search = h('input', { type: 'search', placeholder: 'Szukaj: numer, opis, firma, kto, przyczyna…', style: { width: '260px', padding: '4px 8px' }, oninput: () => { st.q = search.value.trim().toLowerCase(); draw(); } });
  const mkChk = (label, key, tip) => { const i = h('input', { type: 'checkbox', checked: st[key], onchange: () => { st[key] = i.checked; draw(); } }); return h('label', { class: 'row', style: { gap: '4px' }, title: tip }, i, label); };
  const refreshBtn = h('button', { class: 'btn', title: 'Połącz z kartą ZN w arkuszu' + (canStore ? ' (zapis w bazie Firebase)' : ' (zapis w bazie – MASTER / GOD)'), onclick: () => refresh() }, 'Odśwież z karty ZN');

  const toolOf = (code) => (st.index ? st.index.tool(code) : null);
  /** Grupy do listy: narzędzia z karty ZN oraz (opcjonalnie) narzędzia z zużyciem z ToolTrack bez wpisu w ZN. */
  function allGroups() {
    const zn = D.groupByTool(D.parseZn(st.values || [])), keys = new Set(zn.map((g) => g.key)), out = zn.slice();
    if (st.cat) for (const t of st.cat.tools || []) {
      const p = wearPercent(t.wear), k = normCode(t.productCode);
      if (!(p > 0) || keys.has(k) || !String(t.productCode ?? '').trim()) continue;
      out.push({ key: k, code: t.productCode, entries: [], pct: p, maxPct: p, lastTs: null, loss: 0, events: 0, opis: [t.columnP, t.name, t.columnO].filter((x) => String(x || '').trim()).join(' | '), firma: t.columnP || '', mark: '', cena: '', who: [], tracked: true });
    }
    return out;
  }
  function fillFilters(groups) {
    const fill = (s, label, vals, keep) => { clear(s).append(h('option', { value: '' }, label), ...vals.map((v) => h('option', { value: v, selected: v === keep }, v))); };
    fill(grpSel, 'Grupa', [...new Set(groups.map((g) => String((toolOf(g.code) || {}).columnD || '').trim()).filter(Boolean))].sort(naturalCompare), st.grp);
    fill(firmaSel, 'Firma', [...new Set(groups.map((g) => String(g.firma || (toolOf(g.code) || {}).columnP || '').trim()).filter(Boolean))].sort(naturalCompare), st.firma);
    fill(yearSel, 'Rok', [...new Set(groups.flatMap((g) => g.entries.map((e) => (e.ts != null ? String(new Date(e.ts).getUTCFullYear()) : ''))).filter(Boolean))].sort().reverse(), st.year);
  }
  const text = (g) => [g.code, g.opis, g.firma, g.mark, ...g.who, ...g.entries.flatMap((e) => [e.damage, e.cause, e.who])].join(' ').toLowerCase();

  function infoRows(g) {
    const t = toolOf(g.code) || {}, p = st.params[normCode(g.code)] || {}, d = st.index && st.index.details ? st.index.details(g.code) : null;
    const rows = [['Opis', g.opis || [t.columnP, t.name, t.columnO].filter(Boolean).join(' | ')], ['Firma', g.firma || t.columnP], ['Oznaczenie', g.mark], ['Cena', g.cena], ['Grupa / rodzaj', [t.columnD, t.columnE].filter(Boolean).join(' / ')],
      ['Φ mniejsze', t.columnF], ['Pochylenie płytki', t.columnG], ['Promień', t.columnH], ['Φ większe', p.I], ['Długość L', t.columnJ], ['Długość robocza (Lrob)', p.K], ['Ząb / zbieżność', p.L],
      ['Mocowanie początkowe', t.columnM], ['Mocowanie końcowe', t.columnN], ['Lokalizacja', t.location], ['Zużycie (ToolTrack)', t.wear != null && t.wear !== '' ? Math.round(wearPercent(t.wear)) + '%' : ''],
      ['Stan magazynowy', t.status != null && t.status !== '' ? `stan ${G.numberText(t.status || 0)} · zapas ${G.numberText(t.stock || 0)} · dostępne ${G.numberText(t.available || 0)}` : ''],
      ['Części (płytki)', d && (d.partsCutting || []).length ? d.partsCutting.join(', ') : ''], ['Akcesoria', d && (d.partsAccessories || []).length ? d.partsAccessories.join(', ') : '']];
    return rows.filter(([, v]) => String(v ?? '').trim());
  }
  function thumb(code, w, hgt) {
    const stt = st.index && toolOf(code) ? st.index.stackTool(code) : null, stack = stt ? G.buildStack([stt], true, false) : null;
    return h('div', { class: 'tool-mini', style: { width: w + 'px', height: hgt + 'px', cursor: stack ? 'pointer' : 'default', background: '#fff' }, onclick: stack ? () => open2d(code) : null }, stack ? stackSvg(stack, { pad: 4, width: w, height: hgt }) : h('span', { class: 'muted', style: { fontSize: '10px' } }, 'brak rysunku'));
  }
  function open2d(code) {
    const stt = st.index.stackTool(code), s = stt && G.buildStack([stt], true, false);
    if (!s) { toast('Brak danych konturu 2D.', true); return; }
    fullScreen('Widok 2D · ' + code, h('div', { style: { flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' } }, stackSvg(s, { width: 560, height: 760, dims: true })));
  }
  function bar(p) { return h('div', { style: { height: '8px', background: '#e0e0e0', border: '1px solid #888', marginTop: '3px' } }, h('div', { style: { width: Math.max(0, Math.min(100, p || 0)) + '%', height: '100%', background: D.wearColor(p) } })); }
  function tile(g) {
    const last = g.entries[0], t = toolOf(g.code) || {};
    return h('div', { class: 'tool-tile click', onclick: () => detail(g), style: { minHeight: '0' } },
      h('div', { class: 'tile-head' }, h('div', { style: { flex: 1, padding: '4px 8px', background: '#fff' } }, h('b', {}, String(g.code).toUpperCase()), '   ', h('b', { style: { color: D.wearColor(g.pct) } }, g.pct == null ? 'brak %' : Math.round(g.pct) + '%'), bar(g.pct))),
      h('div', { style: { display: 'flex', gap: '6px', padding: '4px 6px' } }, thumb(g.code, 80, 120),
        h('div', { style: { flex: 1, minWidth: 0, fontSize: '12px' } }, h('div', { style: { fontWeight: 600 } }, g.opis || [t.columnP, t.name].filter(Boolean).join(' | ') || '—'),
          h('div', { class: 'muted' }, [g.firma, g.mark, [t.columnD, t.columnE].filter(Boolean).join('/'), t.columnF ? 'Φ' + t.columnF : '', t.columnJ ? 'L' + t.columnJ : ''].filter(Boolean).join(' · ')),
          g.events ? h('div', {}, `Wpisów: ${g.events}`, g.lastTs != null ? ` · ostatni ${last.date}` : '', g.loss ? ` · straty ${D.money(g.loss)}` : '') : h('div', { class: 'muted' }, 'Zużycie z ToolTrack · brak wpisu w karcie ZN'),
          g.who.length ? h('div', { class: 'muted' }, 'Kto / gdzie: ' + g.who.join(', ')) : null,
          last && (last.damage || last.cause) ? h('div', { style: { fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '48px', overflow: 'hidden' } }, [last.damage, last.cause ? 'Przyczyna: ' + last.cause : ''].filter(Boolean).join('\n')) : null)));
  }
  function detail(g) {
    const kv = h('table', { class: 't', style: { width: '100%' } }, h('tbody', {}, ...infoRows(g).map(([k, v]) => h('tr', {}, h('th', { class: 'left', style: { width: '36%' } }, k), h('td', { class: 'left' }, String(v))))));
    const hist = g.entries.length ? h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...['Data', 'Stan', 'Kto / gdzie', 'Kwota strat', 'Opis zniszczeń', 'Przyczyna'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...g.entries.map((e) => h('tr', {}, h('td', {}, e.date || '—'), h('td', { style: { fontWeight: 700, color: D.wearColor(e.pct) } }, e.pct == null ? '' : Math.round(e.pct) + '%'), h('td', { class: 'left' }, e.who), h('td', {}, e.loss != null ? D.money(e.loss) : ''),
        h('td', { class: 'left', style: { whiteSpace: 'pre-wrap' } }, e.damage), h('td', { class: 'left', style: { whiteSpace: 'pre-wrap' } }, e.cause))))) : h('div', { class: 'muted' }, 'Brak wpisów w karcie ZN dla tego narzędzia (zużycie pochodzi z ToolTrack).');
    const m = modal(`Zniszczone · ${String(g.code).toUpperCase()}${g.pct != null ? ' · ' + Math.round(g.pct) + '%' : ''}`, h('div', {},
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } }, thumb(g.code, 120, 240), h('div', { style: { flex: 1, minWidth: 0 } }, kv)),
      h('h4', { style: { margin: '10px 0 4px' } }, `Historia (${g.events})${g.loss ? ' · suma strat ' + D.money(g.loss) : ''}`), hist,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }

  function draw() {
    if (!st.values) return;
    const all = allGroups().filter((g) => st.track || !g.tracked);
    fillFilters(all);
    const items = all.filter((g) => (st.noPct || (g.pct != null && g.pct > 0)) && (g.pct == null ? st.min === 0 : g.pct >= st.min) && (!st.q || text(g).includes(st.q))
      && (!st.grp || String((toolOf(g.code) || {}).columnD || '').trim() === st.grp) && (!st.firma || String(g.firma || (toolOf(g.code) || {}).columnP || '').trim() === st.firma)
      && (!st.year || g.entries.some((e) => e.ts != null && String(new Date(e.ts).getUTCFullYear()) === st.year)));
    const sorted = D.sortGroups(items, st.sort, st.dir);
    info.textContent = `Narzędzi: ${sorted.length} z ${all.length} · wpisów w ZN: ${all.reduce((a, g) => a + g.events, 0)}`;
    if (st.stop) st.stop();
    clear(grid);
    if (!sorted.length) grid.append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Brak narzędzi spełniających kryteria.'));
    st.stop = lazyFill(grid, sorted, tile, 60);
  }
  async function loadAux() {
    try { st.cat = await toolCatalog(); st.index = G.toolIndex(st.cat, await confirmedContoursQuick()); } catch { /* bez katalogu – tylko dane z karty ZN */ }
    try { st.params = (await ndLoad({ manage: false })).params || {}; } catch { st.params = {}; }
  }
  async function loadStored() {
    try {
      const snap = await getSnapshot('zn');
      if (!snap || !snap.data) return false;
      st.values = snap.data.values || []; st.meta = snap.meta; status.textContent = `Karta ZN z bazy Firebase: ${when(snap.meta)}${snap.meta.updatedBy ? ', ' + snap.meta.updatedBy : ''}`; draw(); return true;
    } catch (e) { status.textContent = 'Baza Firebase: ' + (e.code === 'permission-denied' ? 'brak dostępu (opublikuj reguły z snap_meta / snap_rows)' : e.message); return false; }
  }
  async function refresh() {
    if (st.loading) return; st.loading = true; refreshBtn.disabled = true; status.textContent = 'Czytanie karty ZN…';
    try {
      const d = await api('baseSheet', ['ZN'], { timeoutMs: 300000 }), data = { sheet: d.sheet, values: d.values || [] };
      st.values = data.values;
      if (canStore) { st.meta = await putSnapshot('zn', data, { user: (ctx.user && (ctx.user.name || ctx.user.email)) || '', info: `wierszy: ${data.values.length}` }); status.textContent = `Karta ZN zapisana w bazie Firebase (${when(st.meta)}).`; toast('Karta ZN zapisana w bazie Firebase'); }
      else status.textContent = 'Karta ZN z arkusza (tylko na tym komputerze – zapis w bazie: MASTER / GOD).';
      draw();
    } catch (e) { status.textContent = 'Błąd: ' + (/Nieznana karta|Nieznana funkcja|UNKNOWN_FN/i.test(e.message || '') ? 'w Apps Script brak karty ZN w Baza.gs – wgraj nowy Baza.gs i wdróż API.' : e.message); }
    st.loading = false; refreshBtn.disabled = false;
  }
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px'; el.style.height = '100%';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap', gap: '6px', alignItems: 'center' } }, h('b', {}, 'Zniszczone narzędzia'), search, grpSel, firmaSel, yearSel, minSel, sortSel, dirBtn,
    mkChk('też bez procentu', 'noPct', 'Pokaż także narzędzia z wpisem w ZN bez procentu zniszczenia'), mkChk('z ToolTrack', 'track', 'Dodaj narzędzia ze zużyciem z ToolTrack, których nie ma w karcie ZN'), h('span', { class: 'grow' }), info, status, refreshBtn),
    h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0 } }, grid));
  clear(grid).append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie…'));
  loadAux().then(() => (st.values ? draw() : null));
  loadStored().then((ok) => { if (!ok && canStore) refresh(); else if (!ok) status.textContent = 'Brak danych w bazie – poproś MASTER / GOD o pobranie karty ZN albo użyj przycisku (dane tylko lokalnie).'; });
}
