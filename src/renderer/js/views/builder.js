// ToolBuilder – jak w aplikacji na Androida (BuilderScreen.kt): składanie zestawu narzędzi. Pierwsze narzędzie z listy z filtrami,
// kolejne pasują mocowaniem (Mk = Ms ostatniego). Wiersze z paskiem zużycia i miniaturą; zapis do BN z podglądem 2D, 3D i współrzędnymi,
// części zamienne, przekazanie do ToolTrack i eksport DXF.
import { h, clear, api, toast, modal, alertBox, confirmBox } from '../ui.js';
import { toolCatalog } from '../catalog.js';
import * as B from '../logic/builder.js';
import * as G from '../logic/toolGeometry.js';
import { toolRow, toolTile, miniSvg, stackSvg, view3d, partsTable, fullScreen, filterDropdown, statusLine, lazyFill, setToolStations, locColor, contrast } from './toolViews.js';
import { firebase } from '../fb.js';
import { stationList } from '../logic/harmModel.js';
import * as T from '../logic/tooltrack.js';
import { setToolTrackSelection } from './tooltrack.js';
import { openContoursFor, mountContours } from './contours.js';

const FILTERS = [['location', 'Lokal'], ['group', 'Grupa'], ['type', 'Rodzaj'], ['company', 'Firma'], ['diameter', 'Φ'], ['length', 'L'], ['rAlpha', 'r/α']];

export function mountBuilder(el, ctx) {
  const st = { all: [], listed: [], index: null, filters: B.emptyFilters(), selected: [], loading: false, view: 'list', stopFill: null };
  try { st.view = localStorage.getItem('zks.builder.view') === 'tiles' ? 'tiles' : 'list'; } catch { /* domyślnie lista */ }
  const status = statusLine();
  const filtersBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
  const list = h('div', { class: 'tool-list' });
  const newBtn = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => { st.selected = []; status.set(''); draw(); } }, 'Nowe narzędzie');
  // widok: lista (jak na telefonie) albo kafelki – liczba kafelków w wierszu zależy od szerokości okna
  const viewBtn = h('button', { class: 'btn', title: 'Zmiana widoku: lista / kafelki', onclick: () => { st.view = st.view === 'tiles' ? 'list' : 'tiles'; try { localStorage.setItem('zks.builder.view', st.view); } catch { /* bez pamięci */ } paintView(); drawList(); } });
  const paintView = () => { viewBtn.textContent = st.view === 'tiles' ? '☰ Lista' : '▦ Kafelki'; list.className = st.view === 'tiles' ? 'tool-grid' : 'tool-list'; };
  paintView();

  async function load(force) {
    st.loading = true; clear(list).append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie narzędzi…'));
    try {
      const cat = await toolCatalog(force);
      st.all = (cat.tools || []).filter((t) => String(t.productCode ?? '').trim());
      st.listed = st.all.filter(B.isListed); st.index = G.toolIndex(cat); st.selected = [];
      // kolory lokalizacji z kolorów stanowisk (Ustawienia programu – config/main)
      try { const { sdk, db } = await firebase(); const snap = await sdk.getDoc(sdk.doc(db, 'config', 'main')); setToolStations(stationList(snap.exists() ? snap.data() : null)); } catch { setToolStations(null); }
      draw();
    } catch (e) { clear(list).append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano narzędzi: ' + e.message, ' ', h('button', { class: 'btn small', onclick: () => load(true) }, 'Ponów'))); }
    st.loading = false;
  }

  const shown = () => B.sorted(st.selected.length ? B.nextCandidates(st.all, st.selected) : B.filterTools(st.listed, st.filters));
  // ikonka narzędzia: Kontury z tym narzędziem; karta narzędzia – prawy przycisk myszy na wierszu / kafelku
  const mini = (t, w = 60, hgt = 70) => miniSvg(st.index && G.buildMini(t, st.index.details(t.productCode)), { w, hgt, onclick: () => contoursWindow(t) });
  const row = (t, opts = {}) => (st.view === 'tiles'
    ? toolTile(t, { warning: !!st.index && st.index.hasPartWarning(t.productCode), mini: mini(t, 90, 110), oncontextmenu: (e) => { e.preventDefault(); miniPreview(t); }, ...opts })
    : toolRow(t, { warning: !!st.index && st.index.hasPartWarning(t.productCode), mini: mini(t), oncontextmenu: (e) => { e.preventDefault(); miniPreview(t); }, ...opts }));

  function draw() {
    newBtn.style.display = st.selected.length ? '' : 'none';
    clear(filtersBox);
    if (st.selected.length) filtersBox.append(h('span', { class: 'muted' }, 'Filtry są wyłączone. Kolejne narzędzie musi pasować mocowaniem: Mk = Ms ostatnio wybranego.'));
    else {
      const code = h('input', { type: 'search', placeholder: 'Kod', value: st.filters.code, style: { width: '110px', padding: '4px 8px' }, oninput: () => { st.filters.code = code.value; drawList(); } });
      filtersBox.append(code, ...FILTERS.map(([f, l]) => filterDropdown(l, st.filters[f], B.options(st.listed, st.filters, f), (v) => { st.filters[f] = v; draw(); })));
      if (Object.values(st.filters).some((v) => String(v).trim())) filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = B.emptyFilters(); draw(); } }, 'Wyczyść'));
    }
    drawList();
  }

  function drawList() {
    const items = shown();
    if (st.stopFill) st.stopFill();
    clear(list);
    if (st.selected.length) {
      list.append(h('div', { class: 'tool-title' }, `Zestaw (${st.selected.length}) · L=${B.totalLength(st.selected)}`));
      for (const t of st.selected) {
        const d = st.index && st.index.details(t.productCode);
        const parts = d ? (d.partsCutting || []).length + (d.partsAccessories || []).length : null;
        list.append(row(t, { description: B.description(t) + ' | CZĘŚCI: ' + (parts ?? 'brak danych') }));
      }
      list.append(h('div', { class: 'tool-actions' },
        h('button', { class: 'btn primary', onclick: openSave }, 'Zapisz'),
        h('button', { class: 'btn', onclick: () => fullScreen('Części zamienne · ' + B.codesText(st.selected), partsTable(st.index ? st.index.partRows(st.selected.map((t) => t.productCode)) : [])) }, 'Części'),
        h('button', { class: 'btn', onclick: () => { setToolTrackSelection(st.selected); ctx.go('tooltrack'); } }, '→ ToolTrack'),
        h('button', { class: 'btn', onclick: dxf }, 'DXF'),
        h('button', { class: 'btn', onclick: () => { st.selected.pop(); status.set('Usunięto ostatnie narzędzie z zestawu.', 'neutral'); draw(); } }, 'Usuń ostatni')),
      h('hr', { style: { width: '100%', border: 0, borderTop: '1px solid #ccc', margin: '4px 0' } }));
    }
    list.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, (st.selected.length ? 'Pasujące narzędzia: ' : 'Narzędzia: ') + items.length));
    if (!items.length && st.all.length) list.append(h('div', {}, 'Brak narzędzi spełniających kryteria.'));
    // wszystkie narzędzia: dorysowywane porcjami przy przewijaniu (miniatury są kosztowne)
    st.stopFill = lazyFill(list, items, (t) => row(t, { onclick: () => select(t) }));
  }

  function select(t) {
    if (st.selected.some((x) => x.productCode === t.productCode)) return;
    st.selected.push(t);
    draw();
    if (!String(t.columnM ?? '').trim()) status.set('Brak danych w kolumnie M dla wybranego narzędzia.', 'neutral');
    else if (!shown().length) status.set('Brak dalszych powiązanych narzędzi.', 'neutral');
    else status.set('');
  }

  /**
   * Kontury nad ToolBuilderem: okno na prawie cały ekran, reszta wyszarzona i nieaktywna; „Zamknij” albo Esc wraca do ToolBuildera
   * (przy niezapisanych zmianach – pytanie). ToolBuilder zostaje otwarty ze swoim stanem.
   */
  function contoursWindow(t) {
    openContoursFor(t.productCode);
    const host = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
    let api2 = null;
    const close = async () => {
      if (api2 && api2.dirty() && !(await confirmBox('Kontury', 'Porzucić niezapisane zmiany konturu?', 'Porzuć'))) return;
      document.removeEventListener('keydown', onKey, true); m.close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const overlays = document.querySelectorAll('.overlay');
      if (overlays[overlays.length - 1] !== m.root.parentElement) return;   // Esc zamyka najpierw okna otwarte w Konturach
      e.preventDefault(); e.stopPropagation(); close();
    };
    const m = modal(null, h('div', { class: 'fs-dialog' },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0, flex: 1 } }, `Kontury – ${t.productCode}`),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Esc – zamknij'), h('button', { class: 'btn', onclick: close }, 'Zamknij')),
      host), { wide: true, sticky: true });
    m.root.classList.add('fs');
    document.addEventListener('keydown', onKey, true);
    api2 = mountContours(host, ctx);
  }

  /** Karta narzędzia: kod, lokalizacja i zużycie; duży rysunek 2D, obracany 3D, parametry w kafelkach, części ze stanem; dodanie do zestawu. */
  function miniPreview(t) {
    const d = st.index && st.index.details(t.productCode);
    const lc = locColor(t.location), wear = T.wearPercent(t.wear), band = T.wearBand(wear);
    const wc = band === 'low' ? '#00c853' : band === 'medium' ? '#ffd600' : '#d50000';
    const one = st.index && st.index.stackTool(t);
    const stack = one ? G.buildStack([one], true, false) : null;
    const mesh = G.buildMesh([G.parseContour(d && d.columnAY)]);
    const params = [['Firma', t.columnP], ['Grupa', t.columnD], ['Rodzaj', t.columnE], ['Φ', t.columnF], ['Długość', String(t.columnJ ?? '').trim() ? t.columnJ + ' mm' : ''],
      ['r / α', [t.columnG, t.columnH].find((x) => String(x ?? '').trim()) || ''], ['Ms', t.columnM], ['Mk', t.columnN], ['Stan', t.status], ['Dostępne', t.available]];
    const opis = [t.name, t.columnO].filter((x) => String(x ?? '').trim()).join(' · ');
    const canAdd = shown().some((x) => x.productCode === t.productCode) && !st.selected.some((x) => x.productCode === t.productCode);
    const parts = st.index ? st.index.partRows([t.productCode]) : [];
    const m = fullScreen('Karta narzędzia', h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      h('div', { class: 'tcard-head' },
        h('span', { class: 'tcard-code' }, t.productCode),
        t.location ? h('span', { class: 'tcard-chip', style: { background: lc || '#eee', color: lc ? contrast(lc) : '#333' } }, t.location) : null,
        h('span', { class: 'muted' }, 'zużycie'), h('div', { class: 'tcard-wear', title: `Zużycie ${Math.round(wear)}%` }, h('div', { style: { width: wear + '%', height: '100%', background: wc } })), h('b', {}, Math.round(wear) + '%'),
        canAdd ? h('button', { class: 'btn primary', onclick: () => { m.close(); select(t); } }, st.selected.length ? '+ Dodaj do zestawu' : 'Wybierz jako pierwsze') : null),
      opis ? h('div', { style: { marginTop: '4px', fontSize: '14px' } }, opis) : null,
      h('div', { class: 'tcard-grid' },
        h('div', { class: 'tcard-pane' }, h('div', { class: 'muted' }, 'Rysunek 2D (płytki na czerwono)'), h('div', { style: { flex: 1, minHeight: 0 } }, stack ? stackSvg(stack, { labels: false, width: 500, height: 600 }) : h('p', { class: 'muted', style: { padding: '10px' } }, 'Brak konturu 2D.'))),
        h('div', { class: 'tcard-pane' }, h('div', { class: 'muted' }, 'Podgląd 3D – przeciągnij, aby obrócić; kółko: przybliżenie'), h('div', { style: { flex: 1, minHeight: 0 } }, view3d(mesh))),
        h('div', { class: 'tcard-pane', style: { overflow: 'auto' } }, h('div', { class: 'muted' }, 'Parametry'),
          h('div', { class: 'tcard-params' }, ...params.filter(([, v]) => String(v ?? '').trim()).map(([k, v]) => h('div', { class: 'tcard-param' }, h('span', {}, k), h('b', {}, String(v))))),
          h('div', { class: 'muted' }, `Części (${parts.length})`), h('div', { style: { padding: '0 6px 6px' } }, partsTable(parts))))));
  }

  function openSave() {
    if (!st.selected.length) { status.set('Najpierw wybierz narzędzie!', 'error'); return; }
    const sel = [...st.selected];
    const ro = (label, value) => h('label', { class: 'f' }, h('span', {}, label), h('input', { type: 'text', value, readonly: true }));
    const komis = h('input', { type: 'text' }), ktk = h('input', { type: 'text' }), op = h('input', { type: 'text' });
    const stack = st.index ? G.buildStack(sel.map((t) => st.index.stackTool(t)), false, true) : null;
    const mesh = st.index ? G.buildMesh(sel.map((t) => G.parseContour((st.index.details(t.productCode) || {}).columnAY))) : null;
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const codes = B.codesText(sel), path = B.selectionPath(sel), len = String(B.totalLength(sel));
      if (!codes.trim() || !path.trim() || !len.trim()) { await alertBox('ToolBuilder', 'Wszystkie pola nieedytowalne muszą być wypełnione!'); return; }
      save.disabled = true; save.textContent = 'Zapisywanie…';
      try {
        await api('saveToolDataToBN', [{ toolCodes: codes, selections: path, toolLength: len, toolKomis: komis.value.trim(), toolKtk: ktk.value.trim(), toolOperation: op.value.trim() }]);
        m.close(); await alertBox('ToolBuilder', 'Narzędzie zapisane!');
      } catch (e) {
        save.disabled = false; save.textContent = 'Zapisz';
        await alertBox('ToolBuilder', 'Błąd podczas zapisywania danych: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz BN, zanim spróbujesz ponownie.' : ''));
      }
    } }, 'Zapisz');
    const m = fullScreen('Zapis narzędzia', h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr 1fr', gap: '12px', height: '100%' } },
      h('div', {}, ro('Kod narzędzia', B.codesText(sel)), ro('Wartości wyboru', B.selectionPath(sel)), ro('Długość narzędzia', String(B.totalLength(sel))),
        h('label', { class: 'f' }, h('span', {}, 'Komis'), komis), h('label', { class: 'f' }, h('span', {}, 'Nr KTK'), ktk), h('label', { class: 'f' }, h('span', {}, 'Numer operacji'), op),
        h('div', { class: 'row', style: { marginTop: '8px' } }, save, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj')),
        h('button', { class: 'btn', style: { marginTop: '8px', width: '100%' }, onclick: () => coordinates(sel) }, 'Współrzędne')),
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, h('div', { class: 'muted' }, 'Podgląd 2D'),
        h('div', { style: { flex: 1, minHeight: '300px', border: '1px solid #ddd' } }, stack ? stackSvg(stack) : h('p', { class: 'muted' }, 'Brak danych konturu 2D.'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, h('div', { class: 'muted' }, 'Podgląd 3D'),
        h('div', { style: { flex: 1, minHeight: '300px', border: '1px solid #ddd' } }, view3d(mesh)))));
    komis.focus();
  }

  function coordinates(sel) {
    const text = G.coordinatesText(sel.map((t) => st.index.coordinatesTool(t)));
    fullScreen('Współrzędne narzędzia i płytki', h('pre', { style: { fontSize: '11px', userSelect: 'text', margin: 0 } }, text));
  }

  function dxf() {
    const missing = st.selected.filter((t) => !st.index || st.index.dxfTool(t).contour.length === 0);
    if (missing.length) { alertBox('ToolBuilder', 'Brak konturu DXF dla: ' + missing.map((t) => t.productCode).join(', ')); return; }
    const o = G.defaultNameOptions();
    const box = (k, label) => { const c = h('input', { type: 'checkbox', checked: o[k], onchange: () => { o[k] = c.checked; } }); return h('label', { class: 'row' }, c, label); };
    const manual = h('input', { type: 'text', placeholder: 'np. Correa_op10' });
    const m = modal('Nazwa pliku DXF', h('div', {}, box('codes', 'Kody narzędzi'), box('length', 'Długość całkowita'), box('diameter', 'Średnica narzędzia'), box('toolType', 'Rodzaj narzędzia'),
      box('company', 'Firma narzędzia'), box('date', 'Data'), h('label', { class: 'f' }, h('span', {}, 'Opis ręczny'), manual),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        o.manual = manual.value;
        const tools = st.selected, first = tools[0] || {};
        const name = G.dxfFileName(o, tools.map((t) => t.productCode), tools.reduce((s, t) => s + G.num(t.columnJ), 0), first.columnF || '', first.columnE || '', first.columnP || '', new Date().toISOString().slice(0, 10));
        const text = G.buildDxf(tools.map((t) => st.index.dxfTool(t)));
        m.close();
        const bytes = new TextEncoder().encode(text); let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const b64 = btoa(bin);
        try { const ok = await window.zks.saveFile(name, 'application/dxf', b64); if (ok) toast('Plik DXF został zapisany.'); } catch (e) { toast('Nie udało się zapisać pliku DXF: ' + e.message, true); }
      } }, 'Zapisz plik'))));
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'ToolBuilder'), h('span', { class: 'grow muted' }, 'Wybierz narzędzie tnące, potem kolejne pasujące mocowaniem (Mk = Ms). Ikonka narzędzia – Kontury; prawy przycisk – karta narzędzia.'), viewBtn, newBtn,
    h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), filtersBox, status, list);
  load(false);
}
