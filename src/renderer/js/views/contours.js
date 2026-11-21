// Narzędziownia → Kontury: edytor / kreator konturów narzędzi. Użytkownik wpisuje połowę konturu (od osi na zewnątrz: Z wzdłuż osi,
// R – promień, opcjonalnie zaokrąglenie w punkcie), program rysuje cały kontur (odbicie lustrzane) obok dawnego z kolumny T i zapisuje go
// jako ścieżkę SVG w mm do kolumny V arkusza ND_CACHE (MASTER, GOD). Kolumna T się nie zmienia.
import { h, clear, api, toast, confirmBox, modal } from '../ui.js';
import { toolCatalog, contourGenOn, invalidateConfirmed } from '../catalog.js';
import { ndLoad, ndPatch } from '../ndStore.js';
import * as G from '../logic/toolGeometry.js';
import * as E from '../logic/contourEditor.js';
import { normCode, description } from '../logic/tooltrack.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { statusLine, filterDropdown, lazyFill, view3d, insertSetup, saveInsertSetup, savedInsertZ } from './toolViews.js';
import * as B from '../logic/builder.js';

let pendingCode = null;
/** Otwarcie Konturów z wybranym narzędziem (ikonka narzędzia w ToolBuilderze). */
export function openContoursFor(code) { pendingCode = code; }
import { bodyContour, mounting } from '../logic/contourGen.js';

/** Rejony ostrze / oprawka jako tekst do arkusza (PSWT, kolumna BE): „ostrze 0–45; oprawka 45–60” (Z w mm). */
export const regionsText = (list) => (list || []).map((r) => `${r.role} ${String(r.z1).replace('.', ',')}–${String(r.z2).replace('.', ',')}`).join('; ');
export function parseRegions(text) {
  return String(text || '').split(';').map((x) => /^(ostrze|oprawka)\s+(-?[\d.,]+)\s*[–-]\s*(-?[\d.,]+)$/i.exec(x.trim())).filter(Boolean)
    .map((m) => ({ role: m[1].toLowerCase(), z1: Number(m[2].replace(',', '.')), z2: Number(m[3].replace(',', '.')) }));
}

const PARAMS = [['D', 'Grupa narzędzi'], ['E', 'Rodzaj narzędzia'], ['F', 'Fi_mniejsze'], ['G', 'Pochylenie płytki'], ['H', 'Promień'], ['I', 'Fi_większe'],
  ['J', 'Długość 1'], ['K', 'Długość robocza'], ['L', 'Ząb / num. gwint. / zbieżność / ap'], ['M', 'Mocowanie początkowe'], ['N', 'Mocowanie końcowe']];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Triada osi jak w SolidWorks (widok z przodu): X – czerwona w prawo, Z (oś narzędzia) – niebieska w górę, Y – zielona „do patrzącego”. */
function triad2d(x, y) {
  const arrow = (dx, dy, c, l) => { const x2 = x + dx, y2 = y + dy, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="2.2"/><polygon points="${x2 + ux * 7},${y2 + uy * 7} ${x2 - uy * 4},${y2 + ux * 4} ${x2 + uy * 4},${y2 - ux * 4}" fill="${c}"/>`
      + `<text x="${x2 + ux * 14 - 4}" y="${y2 + uy * 14 + 4}" font-size="12" font-weight="700" fill="${c}">${l}</text>`; };
  return `<g pointer-events="none">${arrow(-9, 9, '#2e7d32', 'Y')}${arrow(30, 0, '#d50000', 'X')}${arrow(0, -30, '#1565c0', 'Z')}<circle cx="${x}" cy="${y}" r="2.5" fill="#333"/></g>`;
}

export function mountContours(el, ctx) {
  const canSave = grafikAccess(grafikLevelOf(ctx.user)).manage;
  const st = { filters: B.emptyFilters(), stopFill: null, tools: [], details: new Map(), v: {}, mounts: {}, params: {}, q: '', only: '', tool: null, rows: [], dirty: false, full: null, fullLabel: '' };
  const status = statusLine();
  const listBox = h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, border: '1px solid #ccc', background: '#fff' } });
  const editBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0, overflow: 'auto' } });
  const preview = h('div', { style: { flex: 1, minHeight: '320px', background: '#fff', border: '1px solid #ccc', touchAction: 'none', userSelect: 'none' } });
  // rysowanie: siatka, przyciąganie, przeciąganie punktów i odcinków, rejony ostrze / oprawka
  let saveVBtn = null;
  const pv = { snap: true, step: 0, drag: null, view: null, sel: null, showIns: true, insSel: null, ptEdit: null };
  const snapI = h('input', { type: 'checkbox', checked: true, onchange: () => { pv.snap = snapI.checked; } });
  const stepSel = h('select', { onchange: () => { pv.step = Number(stepSel.value); drawPreview(); } }, ...[['0', 'siatka: auto'], ['0.5', '0,5 mm'], ['1', '1 mm'], ['2', '2 mm'], ['5', '5 mm'], ['10', '10 mm'], ['20', '20 mm']].map(([v, l]) => h('option', { value: v }, l)));
  const regionBar = h('span', { class: 'row', style: { gap: '4px' } });
  const prev3d = h('div', { style: { flex: 1, minHeight: '320px', border: '1px solid #ccc', display: 'none' } });
  const mode3d = h('button', { class: 'btn small', title: 'Podgląd 3D nowego konturu z płytkami', onclick: () => { pv.d3 = !pv.d3; mode3d.classList.toggle('primary', pv.d3); mode3d.textContent = pv.d3 ? '2D' : '3D'; drawPreview(); } }, '3D');
  // płytki w 3D: liczba zębów z= (kopie płytki co 360°/z) i pochylenie wyciągnięcia (przyłożenie z tyłu płytki) – zapamiętywane dla narzędzia
  const zI = h('input', { type: 'number', min: 1, max: 60, style: { width: '46px' }, title: 'Liczba płytek (zębów) na obwodzie – widok 3D', onchange: () => { if (st.tool) { saveInsertSetup(st.tool, { z: Number(zI.value) }); drawPreview(); } } });
  const drI = h('input', { type: 'number', min: 0, max: 30, step: 0.5, style: { width: '46px' }, title: 'Pochylenie ścian płytki (wyciągnięcie z przyłożeniem), °', onchange: () => { if (st.tool) { saveInsertSetup(st.tool, { draft: Number(drI.value) }); drawPreview(); } } });
  const insI = h('input', { type: 'checkbox', checked: true, onchange: () => { pv.showIns = insI.checked; pv.insSel = null; drawPreview(); } });
  const previewBar = h('div', { class: 'row', style: { gap: '8px', fontSize: '12px', flexWrap: 'wrap' } }, h('label', { class: 'row', style: { gap: '3px' } }, snapI, 'przyciągaj do siatki'), stepSel,
    h('label', { class: 'row', style: { gap: '3px' } }, insI, 'płytki'), h('label', { class: 'row', style: { gap: '3px' } }, 'z=', zI), h('label', { class: 'row', style: { gap: '3px' } }, 'pochylenie', drI, '°'), mode3d,
    h('span', { class: 'muted' }, 'Przeciągnij punkt albo odcinek; kliknij rejon, aby nadać funkcję.'), regionBar);
  const info = h('div', { class: 'muted', style: { fontSize: '12px' } });
  const svgOut = h('textarea', { readonly: true, rows: 4, style: { width: '100%', fontFamily: 'monospace', fontSize: '11px' } });
  const errBox = h('div', { class: 'err', style: { fontSize: '12px', whiteSpace: 'pre-wrap' } });

  /** Dane konturów: PSWT D:N, BH/BC/BE, zakładka „kontury” i kolumna V – z bazy Firebase (ndStore), gdy pusta – z arkusza. */
  async function loadData(force) {
    st.dataError = null;
    try {
      const cd = await ndLoad({ manage: canSave, user: (ctx.user && (ctx.user.name || ctx.user.email)) || '', force });
      st.mounts = cd.mounts || {}; st.params = cd.params || {}; st.v = cd.v || {}; st.dataSource = cd.source;
      if (!Object.keys(st.params).length) st.dataError = 'serwer nie zwrócił żadnych narzędzi z arkusza PSWT (sprawdź nazwę karty „PSWT” i kolumny B:N).';
    } catch (e) {
      st.mounts = {}; st.params = {}; st.v = {};
      st.dataError = /Nieznana funkcja|UNKNOWN_FN/i.test(e.message || '')
        ? 'w Apps Script nie ma jeszcze funkcji ndContourData – podmień Kontury.gs i Api.gs i wdróż nową wersję wdrożenia API.'
        : (e.message || String(e));
    }
  }
  async function load(force) {
    clear(listBox).append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Ładowanie narzędzi…'));
    try {
      const cat = await toolCatalog(force);
      st.tools = (cat.tools || []).filter((t) => String(t.productCode ?? '').trim()).sort((a, b) => String(a.productCode).localeCompare(String(b.productCode), 'pl', { numeric: true }));
      st.details = new Map(Object.entries(cat.detailsMap || {}).map(([k, d]) => [normCode(k), d]));
      await loadData(force);
      st.cat = cat; st.index = G.toolIndex(cat, overridesK());
      drawFilters(); drawList();
      if (pendingCode) { const t = st.tools.find((x) => normCode(x.productCode) === normCode(pendingCode)); pendingCode = null; if (t) pick(t); }
    } catch (e) { clear(listBox).append(h('div', { class: 'err', style: { padding: '8px' } }, 'Nie wczytano narzędzi: ' + e.message)); }
  }
  /** Kontury dla płytek i podglądów: zatwierdzone (BC), przy włączonym generatorze – V / generator zamiast T. */
  const overridesK = () => E.contourOverrides(st.params, st.mounts, { gen: contourGenOn(), v: st.v });
  const tOf = (t) => (st.details.get(normCode(t.productCode)) || {}).columnAY || '';
  const vOf = (t) => st.v[normCode(t.productCode)] || '';
  /** Potwierdzenie poprawności konturu z PSWT (kolumna BH) – tekst albo ''. */
  const okOf = (t) => ((st.params[normCode(t.productCode)] || {}).BH || '');
  /** Zatwierdzony kontur (PSWT, kolumna BC) – tylko gdy potwierdzony w BH. */
  const bcOf = (t) => (okOf(t) ? (st.params[normCode(t.productCode)] || {}).BC || '' : '');
  const fromSvg = (svg) => E.expandHalf(E.svgToContour(svg));   // zapis = prawa połowa → odbicie lustrzane
  /** Kontur z danych (PSWT D:N + mocowanie z zakładki „kontury”) w 0,1 mm albo null. */
  /** Parametry D:N narzędzia: z arkusza PSWT albo – dla wybranego narzędzia – zmienione do sprawdzenia (bez zapisu). */
  const paramsOf = (t) => (st.tool && t && st.tool.productCode === t.productCode && st.test ? st.test : st.params[normCode(t.productCode)]);
  const genOf = (t) => {
    const p = paramsOf(t);
    if (!p) return null;
    const half = E.generatedHalf(p, st.mounts);   // generator – sama prawa połowa; podgląd 2D = odbicie lustrzane
    if (half.length < 3) return null;
    const full = E.expandHalf(half);
    full.halfSvg = E.halfPathSvg(half);
    return full;
  };

  // filtry jak w ToolBuilderze (Lokal, Grupa, Rodzaj, Firma, Φ, L, r/α) – nad listą, na całą szerokość
  const FILTERS = [['location', 'Lokal'], ['group', 'Grupa'], ['type', 'Rodzaj'], ['company', 'Firma'], ['diameter', 'Φ'], ['length', 'L'], ['rAlpha', 'r/α']];
  const filtersBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
  function drawFilters() {
    clear(filtersBox).append(...FILTERS.map(([f, l]) => filterDropdown(l, st.filters[f], B.options(st.tools, st.filters, f), (v) => { st.filters[f] = v; drawFilters(); drawList(); })));
    if (Object.values(st.filters).some((v) => String(v).trim())) filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = B.emptyFilters(); drawFilters(); drawList(); } }, 'Wyczyść'));
  }
  function drawList() {
    const q = st.q.toLowerCase();
    const items = B.sorted(B.filterTools(st.tools, st.filters)).filter((t) => (!q || String(t.productCode).toLowerCase().includes(q) || description(t).toLowerCase().includes(q))
      && (!st.only || (st.only === 'T' ? tOf(t) : st.only === 'V' ? vOf(t) : st.only === 'G' ? genOf(t) : !tOf(t) && !vOf(t))));
    if (st.stopFill) st.stopFill();
    clear(listBox);
    listBox.append(h('div', { class: 'muted', style: { padding: '2px 6px', fontSize: '11px' } }, `Narzędzia: ${items.length}`));
    if (!items.length) listBox.append(h('div', { class: 'muted', style: { padding: '6px' } }, 'Brak narzędzi.'));
    st.stopFill = lazyFill(listBox, items, (t) => {
      const on = st.tool && st.tool.productCode === t.productCode;
      return h('div', { class: 'click', style: { padding: '3px 6px', borderBottom: '1px solid #eee', background: on ? '#d3e3fd' : '', cursor: 'pointer' }, onclick: () => pick(t) },
        h('b', {}, t.productCode), ' ', tOf(t) ? h('span', { title: 'Jest kontur w kolumnie T', style: { fontSize: '10px', color: '#666' } }, 'T') : null, ' ',
        vOf(t) ? h('span', { title: 'Jest kontur w kolumnie V', style: { fontSize: '10px', color: '#2e7d32', fontWeight: 700 } }, 'V') : null,
        okOf(t) ? h('span', { title: 'Kontur potwierdzony (PSWT, kolumna BH): ' + okOf(t), style: { fontSize: '11px', color: '#fff', background: '#2e7d32', borderRadius: '3px', padding: '0 3px', marginLeft: '3px' } }, '✓') : null,
        h('div', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, description(t)));
    }, 150);
  }

  async function pick(t) {
    if (st.dirty && !(await confirmBox('Kontury', 'Porzucić niezapisane zmiany konturu?', 'Porzuć'))) return;
    st.tool = t; st.dirty = false; st.test = null; pv.sel = null; pv.view = null; pv.insSel = null; pv.ptEdit = null; st.insAdj = {}; st.xf = { dx: 0, dz: 0, ang: 0 };
    st.regions = parseRegions((st.params[normCode(t.productCode)] || {}).BE);
    // narzędzie monolityczne bez zapisanych rejonów: ostrze wg długości roboczej (K) – ustawiane po narysowaniu konturu
    { const p = st.params[normCode(t.productCode)]; st.autoSplit = !st.regions.length && E.isMonolithic(p) && E.bladeLength(p) > 0; }
    const g = genOf(t), tp = G.parseContour(tOf(t));
    const src = bcOf(t) ? [fromSvg(bcOf(t)), 'kolumna BC – zatwierdzony', bcOf(t)] : vOf(t) ? [fromSvg(vOf(t)), 'kolumna V', vOf(t)]
      : contourGenOn() ? (g ? [g, 'wewnętrzny generator (D:N)', g.halfSvg] : tp.length >= 3 ? [tp, 'kolumna T'] : null)
        : tp.length >= 3 ? [tp, 'kolumna T'] : g ? [g, 'dane D:N', g.halfSvg] : null;
    setFull(src && src[0], src && src[1], src && src[2]);
    if (!st.rows.length) st.rows = [{ z: '0', r: '', rad: '' }, { z: '', r: '', rad: '' }];
    status.set(src ? `Wczytano kontur (${src[1]}).` : 'Brak konturu – wpisz punkty od początku.', 'neutral');
    drawList(); drawEditor();
  }

  function drawEditor() {
    clear(editBox);
    const t = st.tool;
    if (!t) { editBox.append(h('p', { class: 'muted' }, 'Wybierz narzędzie z listy po lewej.')); drawPreview(); return; }
    editBox.append(h('div', {}, h('b', { style: { fontSize: '15px' } }, t.productCode), h('div', { class: 'muted', style: { fontSize: '12px' } }, description(t)),
      h('div', { style: { fontSize: '12px' } }, `Φ ${t.columnF || '—'} · L ${t.columnJ || '—'} · Ms ${t.columnM || '—'} · Mk ${t.columnN || '—'}`)));
    editBox.append(confirmBox2(t));
    editBox.append(paramsPanel(t));
    editBox.append(h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px' } },
      h('button', { class: 'btn small', disabled: !tOf(t), title: 'Pełny kontur z kolumny T (bez zmian)', onclick: () => { setFull(G.parseContour(tOf(t)), 'kolumna T'); st.dirty = true; status.set('Wczytano pełny kontur z kolumny T (bez zmian).', 'neutral'); drawEditor(); } }, 'Z kolumny T'),
      h('button', { class: 'btn small', disabled: !bcOf(t), title: 'Zatwierdzony kontur z arkusza PSWT (kolumna BC)', onclick: () => { setFull(fromSvg(bcOf(t)), 'kolumna BC – zatwierdzony', bcOf(t)); status.set('Wczytano zatwierdzony kontur z PSWT (kolumna BC).', 'neutral'); drawEditor(); } }, 'Z kolumny BC'),
      h('button', { class: 'btn small', disabled: !vOf(t), onclick: () => { setFull(fromSvg(vOf(t)), 'kolumna V', vOf(t)); status.set('Wczytano pełny kontur z kolumny V.', 'neutral'); drawEditor(); } }, 'Z kolumny V'),
      h('button', { class: 'btn small', disabled: !genOf(t), title: 'Prawa połowa konturu z wewnętrznego generatora: korpus z kolumn D:N arkusza PSWT dorysowany do mocowania wg karty „kontury”', onclick: () => { { const g = genOf(t); setFull(g, 'dane D:N', g.halfSvg); } st.dirty = true; status.set('Wczytano pełny kontur policzony z danych (D:N) – z liniami rzutu bocznego.', 'neutral'); drawEditor(); } }, 'Z danych (D:N)'),
      h('button', { class: 'btn small', onclick: () => setRows([{ z: '0', r: '', rad: '' }, { z: '', r: '', rad: '' }], 'Wyczyszczono.') }, 'Od nowa'),
      h('button', { class: 'btn small', onclick: () => { st.rows.push({ z: '', r: '', rad: '' }); st.dirty = true; drawEditor(); } }, '+ punkt')));
    editBox.append(moveBox());
    editBox.append(h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Połowa konturu od osi na zewnątrz, w kolejności obrysu: Z – pozycja wzdłuż osi (mm, 0 jak w kolumnie T), R – promień od osi (mm), Zaokr. – promień zaokrąglenia w tym punkcie (mm, puste – ostry narożnik). Druga połowa powstaje sama (odbicie lustrzane).'));
    st.noteHost = h('div', {});
    st.tableHost = h('div', {});
    editBox.append(st.noteHost, st.tableHost, errBox);
    showNote();
    drawTable();
    drawPreview();
  }
  /** Informacja o trybie pełnego konturu (źródło: kolumna T / V / dane D:N). */
  function showNote() {
    if (!st.noteHost) return;
    clear(st.noteHost);
    st.noteEl = null;
    if (st.full) st.noteHost.append(st.noteEl = h('div', { style: { background: '#fff3e0', border: '1px solid #ef6c00', padding: '4px 6px', fontSize: '12px' } },
      `Pełny kontur (${st.fullLabel}). Zapisywana jest prawa połowa – obrys i linie krawędzi elementów (rzut boczny). Tabela pokazuje tylko obrys; zmiana punktu w tabeli przełącza na kontur z połowy bez linii wewnętrznych.`,
      ' ', h('button', { class: 'btn small', onclick: () => { st.full = null; st.dirty = true; status.set('Przełączono na kontur z połowy (odbicie).', 'neutral'); drawEditor(); } }, 'Użyj połowy z tabeli')));
  }
  function drawTable() {
    if (!st.tableHost) return;
    const tb = h('tbody', {});
    st.rows.forEach((r, i) => {
      const inp = (k, w) => h('input', { type: 'text', value: r[k] ?? '', inputmode: 'decimal', style: { width: w, padding: '2px 4px' }, oninput: (e) => { r[k] = e.target.value; st.dirty = true; if (st.full) { st.full = null; if (st.noteEl) st.noteEl.remove(); } drawPreview(); } });
      tb.append(h('tr', {}, h('td', { class: 'muted' }, String(i + 1)), h('td', {}, inp('z', '70px')), h('td', {}, inp('r', '70px')), h('td', {}, inp('rad', '60px')),
        h('td', { style: { whiteSpace: 'nowrap' } },
          h('button', { class: 'btn small', title: 'W górę', disabled: i === 0, onclick: () => { [st.rows[i - 1], st.rows[i]] = [st.rows[i], st.rows[i - 1]]; st.dirty = true; drawEditor(); } }, '↑'),
          h('button', { class: 'btn small', title: 'W dół', disabled: i === st.rows.length - 1, onclick: () => { [st.rows[i + 1], st.rows[i]] = [st.rows[i], st.rows[i + 1]]; st.dirty = true; drawEditor(); } }, '↓'),
          h('button', { class: 'btn small', title: 'Wstaw punkt poniżej', onclick: () => { st.rows.splice(i + 1, 0, { z: '', r: '', rad: '' }); st.dirty = true; drawEditor(); } }, '+'),
          h('button', { class: 'btn small', title: 'Usuń punkt', onclick: () => { st.rows.splice(i, 1); st.dirty = true; drawEditor(); } }, '✕'))));
    });
    clear(st.tableHost).append(h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['#', 'Z [mm]', 'R [mm]', 'Zaokr.', ''].map((x) => h('th', {}, x)))), tb));
  }
  /** Potwierdzenie poprawności konturu: zapis w PSWT, kolumna BH („OK data kto”); MASTER / GOD. */
  function confirmBox2(t) {
    const ok = okOf(t), inPswt = !!st.params[normCode(t.productCode)];
    const box = h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '4px 6px', borderRadius: '6px', border: '1px solid ' + (ok ? '#2e7d32' : '#bbb'), background: ok ? '#e8f5e9' : '#fafafa' } },
      h('b', { style: { color: ok ? '#2e7d32' : '#666' } }, ok ? '✓ Kontur potwierdzony' : 'Kontur niepotwierdzony'), ok ? h('span', { class: 'muted', style: { fontSize: '12px' } }, ok) : null);
    const who = (ctx.user && (ctx.user.name || ctx.user.email)) || '';
    const save = async (value) => {
      try {
        // zatwierdzony nowy kontur → PSWT kolumna BC (SVG, mm), rejony ostrze / oprawka → kolumna BE
        const tre = E.isTrepan(st.params[normCode(t.productCode)]);   // wiertło rurowe: własne linie w sylwecie
        let bc = value ? (tre ? svgOut.value : E.addEdgeLines(svgOut.value)) : null;   // + linie krawędzi części obrotowej
        if (bc && !tre) for (const r of (st.regions || []).slice(0, -1)) bc = E.addLineAt(bc, r.z2);   // + linie podziału ostrze / oprawka
        await api('ndConfirmContour', [t.productCode, value, bc, value ? regionsText(st.regions) : null]);
        st.params[normCode(t.productCode)] = { ...(st.params[normCode(t.productCode)] || {}), BH: value, ...(value ? { BC: bc, BE: regionsText(st.regions) } : {}) };
        ndPatch(t.productCode, st.params[normCode(t.productCode)], st.v[normCode(t.productCode)]); invalidateConfirmed();   // baza Firebase
        status.set(value ? `Potwierdzono kontur ${t.productCode} (PSWT, kolumna BH).` : `Cofnięto potwierdzenie konturu ${t.productCode}.`);
        if (st.cat) st.index = G.toolIndex(st.cat, overridesK());
        drawList(); drawEditor();
      } catch (e) { status.set('Nie zapisano potwierdzenia: ' + e.message, 'error'); }
    };
    if (canSave && inPswt) {
      if (!ok) box.append(h('button', { class: 'btn small primary', title: 'Zapisuje w arkuszu PSWT (kolumna BH) potwierdzenie, że kontur narzędzia jest poprawny', onclick: async () => {
        if (!(await confirmBox('Potwierdzenie konturu', `Potwierdzić poprawność konturu ${t.productCode}? Do arkusza PSWT trafi: potwierdzenie (kolumna BH), nowy kontur – prawa połowa (kolumna BC, SVG w mm) i rejony ostrze / oprawka (kolumna BE).`, 'Potwierdź'))) return;
        const d = new Date(), dd = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
        save(`OK ${dd}${who ? ' ' + who : ''}`);
      } }, '✓ Potwierdź poprawność konturu'));
      else box.append(h('button', { class: 'btn small', onclick: async () => { if (await confirmBox('Potwierdzenie konturu', `Cofnąć potwierdzenie konturu ${t.productCode}?`, 'Cofnij')) save(''); } }, 'Cofnij potwierdzenie'));
    } else if (!inPswt) box.append(h('span', { class: 'muted', style: { fontSize: '11px' } }, '(brak narzędzia w PSWT albo dane nie wczytane)'));
    return box;
  }

  /** Parametry D:N z PSWT – do wglądu; zmiana tylko do sprawdzenia konturu (nie zapisuje się w arkuszu). */
  function paramsPanel(t) {
    const base = st.params[normCode(t.productCode)];
    const box = h('details', { open: true, style: { border: '1px solid #ccc', borderRadius: '6px', padding: '4px 6px', background: '#fafafa' } });
    const sheetInfo = h('div', { style: { fontSize: '11px' } });
    const refresh = () => {
      const p = paramsOf(t) || {};
      const m = mounting(st.mounts, p.M, p.C);
      const body = bodyContour(p, (m && m.left) || '');
      sheetInfo.textContent = (st.test ? 'Zmienione do sprawdzenia (arkusz bez zmian). ' : '')
        + `Mocowanie ${p.M || '—'}: ${m ? (m.formula ? (m.synthetic ? 'wg wzoru karty „kontury” (rozmiar spoza tabeli – wyliczony)' : 'wg wzoru karty „kontury”') : 'z danych zakładki „kontury”') : 'brak (kod spoza karty „kontury”)'} · `
        + (body ? 'reguła korpusu: jest' : `brak reguły korpusu dla ${p.D || '?'} / ${p.E || '?'}`);
      sheetInfo.style.color = body || m ? '#1b5e20' : '#c62828';
    };
    box.append(h('summary', { style: { cursor: 'pointer', fontWeight: 600, fontSize: '12px' } }, 'Parametry z arkusza PSWT (D:N) – do sprawdzenia, bez zapisu'));
    if (!base) {
      box.append(st.dataError
        ? h('div', { class: 'err', style: { fontSize: '12px' } }, 'Nie wczytano danych z arkusza PSWT: ' + st.dataError, ' ',
          h('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; e.target.textContent = 'Wczytywanie…'; await loadData(); drawList(); drawEditor(); } }, 'Wczytaj ponownie'))
        : h('div', { class: 'muted', style: { fontSize: '12px' } }, `Brak narzędzia ${t.productCode} w kolumnie B arkusza PSWT (wczytano ${Object.keys(st.params).length} narzędzi).`));
      return box;
    }
    if (base.C) box.append(h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Opis: ' + base.C));
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 6px', alignItems: 'center', fontSize: '12px' } });
    for (const [k, label] of PARAMS) {
      const cur = (st.test || base)[k] ?? '';
      const inp = h('input', { type: 'text', value: cur, style: { padding: '1px 4px', width: '100%', background: st.test && st.test[k] !== base[k] ? '#fff3e0' : '' },
        oninput: (e) => {
          st.test = st.test || { ...base };
          st.test[k] = e.target.value;
          e.target.style.background = st.test[k] !== base[k] ? '#fff3e0' : '';
          // nowy kontur zawsze z wpisanych danych (bez przebudowy pól – kursor zostaje w polu)
          const g = genOf(t);
          if (g) { setFull(g, 'dane D:N', g.halfSvg); st.dirty = true; showNote(); drawTable(); }
          refresh(); drawPreview();
        } });
      grid.append(h('span', { class: 'muted' }, `${k} · ${label}`), inp);
    }
    box.append(grid, sheetInfo, h('button', { class: 'btn small', style: { marginTop: '4px' }, onclick: () => { st.test = null; const g = genOf(t); if (g) setFull(g, 'dane D:N', g.halfSvg); drawEditor(); } }, 'Przywróć z arkusza'));
    refresh();
    return box;
  }

  /** Przesunięcie / obrót całego konturu razem z płytkami – wartości bezwzględne (względem konturu przed przesunięciem):
   *  X, Z w mm, kąt w ° (dodatni – przeciwnie do wskazówek zegara, wokół punktu 0,0). „Zeruj” wraca do położenia wyjściowego. */
  function moveBox() {
    const xf = st.xf || { dx: 0, dz: 0, ang: 0 };
    const inp = (v) => h('input', { type: 'text', value: String(v).replace('.', ','), style: { width: '58px', padding: '1px 4px' } });
    const ix = inp(xf.dx), iz = inp(xf.dz), ia = inp(xf.ang);
    const n = (i) => { const v = Number(String(i.value || '0').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
    const apply = (nx) => {
      if ([nx.dx, nx.dz, nx.ang].some(Number.isNaN)) { status.set('Wpisz liczby (mm, °).', 'error'); return; }
      const old = st.xf || { dx: 0, dz: 0, ang: 0 };
      if (!st.full && !old.dx && !old.ang && !nx.dx && !nx.ang) {   // tylko Z w trybie połowy – zachowuje zaokrąglenia
        const d = (nx.dz - old.dz) * 10;
        for (const r of st.rows) if (String(r.z).trim() !== '') r.z = fmtMm(Number(String(r.z).replace(',', '.')) * 10 + d);
      } else {
        const errs = st.full ? [] : E.validate(st.rows);
        if (errs.length) { status.set('Najpierw popraw tabelę: ' + errs[0], 'error'); return; }
        const pts = st.full ? st.full.map((p) => ({ ...p })) : E.svgToContour(E.toSvg(st.rows));
        const base = pts.map((p) => unXf(p, old));   // kontur przed dotychczasowym przesunięciem
        const moved = base.map((p) => { const q = doXf(p, nx); return { x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 }; });
        const label = String(st.fullLabel || '').replace(/, przesunięty$/, '');
        setFull(moved, nx.dx || nx.dz || nx.ang ? (label ? label + ', ' : '') + 'przesunięty' : label);
      }
      st.xf = { ...nx }; st.dirty = true; pv.view = null;
      status.set(`Położenie konturu z płytkami: X ${nx.dx} mm, Z ${nx.dz} mm, obrót ${nx.ang}° (względem położenia wyjściowego).`, 'neutral');
      drawEditor();
    };
    return h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap', fontSize: '12px', background: '#f4f6f8', padding: '4px', borderRadius: '4px' } },
      h('b', {}, 'Cały kontur z płytkami:'), 'X', ix, 'Z', iz, 'mm · obrót', ia, '°',
      h('button', { class: 'btn small', onclick: () => apply({ dx: n(ix), dz: n(iz), ang: n(ia) }) }, 'Ustaw'),
      h('button', { class: 'btn small', onclick: () => apply({ dx: 0, dz: 0, ang: 0 }) }, 'Zeruj'));
  }
  /** Przesunięcie konturu (0,1 mm): obrót wokół 0,0 o ang°, potem przesunięcie o dx, dz (mm); unXf – odwrotnie. */
  const doXf = (p, f) => { const c = Math.cos((f.ang * Math.PI) / 180), s = Math.sin((f.ang * Math.PI) / 180); return { x: p.x * c - p.y * s + f.dx * 10, y: p.x * s + p.y * c + f.dz * 10 }; };
  const unXf = (p, f) => { const x = p.x - f.dx * 10, y = p.y - f.dz * 10, c = Math.cos((f.ang * Math.PI) / 180), s = Math.sin((f.ang * Math.PI) / 180); return { x: x * c + y * s, y: -x * s + y * c }; };

  function setRows(rows, msg) { st.full = null; st.rows = rows.length ? rows : [{ z: '', r: '', rad: '' }]; st.dirty = true; status.set(msg, 'neutral'); drawEditor(); }
  /** Pełny kontur bez zmian (T / V / dane) – tabela pokazuje jego obrys (połowę) tylko do podglądu i ewentualnej edycji. */
  function setFull(points, label, srcHalf = null) {
    st.full = points && points.length >= 3 ? points : null; st.fullLabel = label || '';
    st.srcHalf = st.full && srcHalf && E.isHalf(E.svgToContour(srcHalf)) ? srcHalf : null;   // niezmieniona połowa z BC / V – zapis bez rozbijania łuków
    st.rows = st.full ? E.halfFromContour(st.full) : [];
  }

  function drawPreview() {
    const t = st.tool;
    const errs = t && !st.full ? E.validate(st.rows) : [];
    errBox.textContent = errs.join('\n');
    const svg = !t ? '' : st.full ? E.contourToSvg(st.full) : !errs.length ? E.toSvg(st.rows) : '';
    // zapisywana jest tylko prawa połowa (od osi); podgląd 2D – odbicie lustrzane, 3D – obrót połowy
    if (t) { const set = insertSetup(t); if (document.activeElement !== zI) zI.value = set.z; if (document.activeElement !== drI) drI.value = set.draft; }
    svgOut.value = !t ? '' : st.full ? (st.srcHalf || E.halfPathSvg(st.full)) : !errs.length ? E.halfSvg(st.rows) : '';
    if (saveVBtn) { const ok = t && okOf(t); saveVBtn.disabled = !!ok; saveVBtn.title = ok ? 'Kontur zatwierdzony – jest w PSWT (kolumna BC), zapis w kolumnie V niepotrzebny.' : 'Wersja robocza konturu (prawa połowa) w ND_CACHE, kolumna V.'; }
    preview.style.display = pv.d3 ? 'none' : ''; prev3d.style.display = pv.d3 ? '' : 'none';
    if (pv.d3) {
      clear(prev3d);
      const f0 = st.xf || { dx: 0, dz: 0, ang: 0 };   // bryła z konturu przed przesunięciem, przesunięcie / obrót całości w scenie
      const tre = !!t && E.isTrepan(st.params[normCode(t.productCode)]);   // wiertło rurowe: kielich i płytki ostrza wg Ø
      const trd = tre && svg ? G.trepanDrawingFor(t.columnF, t.columnJ, E.svgToContour(svg).map((p) => unXf(p, f0))) : null;   // kielich: wnęka z wymiarów
      const hlN = t && !tre && String((st.params[normCode(t.productCode)] || {}).D || '').trim().toLowerCase() === 'opr' ? (st.params[normCode(t.productCode)] || {}).N : '';
      const hld = hlN && svg ? G.holeDrawingFor(hlN, E.svgToContour(svg).map((p) => unXf(p, f0))) : null;   // oprawka gwintująca: otwór
      const mesh = svg ? G.buildMesh([E.svgToContour(svg).map((p) => unXf(p, f0))], 36, [trd ? trd.cavity : hld ? hld.cavity : null]) : null;
      if (mesh) mesh.regions = [(st.regions || []).map((r) => (f0.ang ? r : { ...r, z1: r.z1 - f0.dz, z2: r.z2 - f0.dz }))];   // część robocza w kolorze płytek
      if (mesh && hlN && svg) mesh.nut = [G.nutDrawingFor(hlN, E.svgToContour(svg).map((p) => unXf(p, f0)))];   // nakrętka ER – ciemniejsza część bryły
      if (mesh) mesh.trepan = [trd ? G.trepanBlade(t.columnF, mesh.regions[0], savedInsertZ(t)) : null];
      const set = insertSetup(t);
      const ins = t && pv.showIns && !tre ? insertsOf(t).map((q) => ({ poly: q.local, z: set.z, draft: set.draft })) : [];
      prev3d.append(mesh || ins.length ? view3d(mesh, ins, { xf: f0 }) : h('p', { class: 'muted', style: { padding: '10px' } }, 'Brak konturu do pokazania w 3D.'));
    }
    const layers = [];
    if (t && tOf(t)) layers.push({ pts: G.parseContour(tOf(t)), stroke: '#888', fill: 'none', dash: '6 4', label: 'kolumna T (dawny)' });
    if (t && genOf(t)) layers.push({ pts: genOf(t), stroke: '#ef6c00', fill: 'none', dash: '4 3', label: 'z danych D:N' });
    if (t && vOf(t)) layers.push({ pts: fromSvg(vOf(t)), stroke: '#2e7d32', fill: 'none', dash: '2 3', label: 'kolumna V (roboczy)' });
    if (t && bcOf(t)) layers.push({ pts: fromSvg(bcOf(t)), stroke: '#6a1b9a', fill: 'none', dash: '8 3 2 3', label: 'kolumna BC (zatwierdzony)' });
    if (svg) layers.push({ pts: E.svgToContour(svg), stroke: '#1565c0', fill: 'rgba(21,101,192,.18)', dash: '', label: 'nowy kontur' });
    // płytki skrawające: rozmieszczenie jak w zestawie (algorytm ToolBuildera) + korekta prawej płytki (lewa – odbicie lustrzane)
    const ins = t && pv.showIns ? insertsOf(t) : [];
    const all = [...layers.flatMap((l) => l.pts), ...ins.flatMap((q) => [...q.right, ...q.left])];
    if (!all.length) { preview.innerHTML = '<p class="muted" style="padding:10px">Brak konturu do pokazania.</p>'; info.textContent = ''; drawRegionBar(); return; }
    const W = 600, H = 600, pad = 30;
    // widok zamrożony w czasie przeciągania (żeby rysunek nie „uciekał” spod kursora)
    if (!pv.drag || !pv.view) {
      const b = G.bounds(all);
      const sc = Math.min((W - 2 * pad) / Math.max(b.maxX - b.minX, 1), (H - 2 * pad) / Math.max(b.maxY - b.minY, 1));
      pv.view = { b, s: sc, W, H, pad };
    }
    const { b, s: sc } = pv.view;
    const X = (x) => (W / 2 + x * sc), Y = (y) => (pad + (b.maxY - y) * sc);
    const f2 = (v) => v.toFixed(2);
    // siatka (krok w mm; auto – ok. 15 linii na rysunek)
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 10;
    const step = pv.step || [0.5, 1, 2, 5, 10, 20, 50, 100].find((q) => span / q <= 18) || 100;
    pv.gridStep = step;
    const xMin = (0 - W / 2) / sc, xMax = (W - W / 2) / sc, yMax = b.maxY + pad / sc, yMin = b.maxY - (H - pad) / sc;
    let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
    for (let g = Math.ceil(xMin / (step * 10)) * step * 10; g <= xMax; g += step * 10) out += `<line x1="${f2(X(g))}" y1="0" x2="${f2(X(g))}" y2="${H}" stroke="#e6e6e6" stroke-width="${Math.abs(g % (step * 50)) < 1e-6 ? 1 : 0.5}"/>`;
    for (let g = Math.ceil(yMin / (step * 10)) * step * 10; g <= yMax; g += step * 10) out += `<line x1="0" y1="${f2(Y(g))}" x2="${W}" y2="${f2(Y(g))}" stroke="#e6e6e6" stroke-width="${Math.abs(g % (step * 50)) < 1e-6 ? 1 : 0.5}"/>`;
    // rejony ostrze / oprawka – pasy Z przycięte do nowego konturu
    const trePv = !!t && E.isTrepan(st.params[normCode(t.productCode)]);
    const nPts = svg ? E.svgToContour(svg) : [];
    if (nPts.length >= 3) out += `<defs><clipPath id="kclip"><polygon points="${nPts.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ')}"/></clipPath></defs>`;
    for (const r of st.regions || []) {
      if (r.role === 'ostrze' && trePv) continue;   // wiertło rurowe: ostrze to tylko płytki w ściankach (rysowane niżej), nie cały pas
      const col = r.role === 'ostrze' ? '#c8a400' : '#616161';   // ostrze zawsze w kolorze płytek (złoty)
      out += `<rect x="0" y="${f2(Y(r.z2 * 10))}" width="${W}" height="${f2((r.z2 - r.z1) * 10 * sc)}" fill="${col}" fill-opacity="${r.role === 'ostrze' ? 0.8 : 0.35}" clip-path="url(#kclip)"/>`
        + `<text x="${W - 6}" y="${f2((Y(r.z1 * 10) + Y(r.z2 * 10)) / 2 + 4)}" font-size="11" text-anchor="end" fill="${col}" font-weight="700">${r.role}</text>`;
    }
    if (pv.sel) out += `<rect x="0" y="${f2(Y(pv.sel.z2 * 10))}" width="${W}" height="${f2((pv.sel.z2 - pv.sel.z1) * 10 * sc)}" fill="none" stroke="#ff9800" stroke-width="2" stroke-dasharray="6 3"/>`;
    // układ współrzędnych: X – czerwona, Z – ciemnoniebieska
    // układ współrzędnych jak w SolidWorks: oś obrotu – linia osiowa (kreska-kropka), początek – czerwone strzałki, triada X/Y/Z w rogu
    out += `<line x1="${f2(X(0))}" y1="0" x2="${f2(X(0))}" y2="${H}" stroke="#555" stroke-width="0.9" stroke-dasharray="14 3 2 3" pointer-events="none"/>`;
    { const ox = X(0), oy = Y(0), L = 22;
      out += `<g pointer-events="none" stroke="#d50000" fill="#d50000" stroke-width="1.6"><line x1="${f2(ox)}" y1="${f2(oy)}" x2="${f2(ox + L)}" y2="${f2(oy)}"/><polygon points="${f2(ox + L + 6)},${f2(oy)} ${f2(ox + L)},${f2(oy - 3)} ${f2(ox + L)},${f2(oy + 3)}"/>`
        + `<line x1="${f2(ox)}" y1="${f2(oy)}" x2="${f2(ox)}" y2="${f2(oy - L)}"/><polygon points="${f2(ox)},${f2(oy - L - 6)} ${f2(ox - 3)},${f2(oy - L)} ${f2(ox + 3)},${f2(oy - L)}"/><circle cx="${f2(ox)}" cy="${f2(oy)}" r="2.2"/></g>`; }
    out += triad2d(14, H - 26);
    for (const l of layers) out += `<polygon points="${l.pts.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ')}" fill="${l.fill}" stroke="none" pointer-events="none"/>`
      + `<path d="${G.outlinePath(l.pts, (p) => [X(p.x), Y(p.y)])}" fill="none" stroke="${l.stroke}" stroke-width="${l.dash ? 1.2 : 1.6}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''} pointer-events="none"/>`;
    { const pr = (t && st.params[normCode(t.productCode)]) || {};   // oprawka gwintująca: otwór pod chwyt gwintownika – przerywana linia 1 px
      const hd = svg && !trePv && String(pr.D || '').trim().toLowerCase() === 'opr' ? G.holeDrawingFor(pr.N, E.svgToContour(svg)) : null;
      const nd = svg && !trePv && String(pr.D || '').trim().toLowerCase() === 'opr' ? G.nutDrawingFor(pr.N, E.svgToContour(svg)) : null;   // nakrętka ER: ciemniejszy pas + wcięcia pod klucz
      if (nd) { const nc = E.svgToContour(svg), pp2 = (pts) => pts.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ');
        out += `<clipPath id="nutclip"><rect x="0" y="${f2(Y(nd.z2))}" width="${W}" height="${f2((nd.z2 - nd.z1) * sc)}"/></clipPath><polygon points="${pp2(nc)}" fill="#000" fill-opacity="0.35" clip-path="url(#nutclip)" pointer-events="none"/>`
          + nd.slots.map((q) => `<polyline points="${pp2(q)}" fill="none" stroke="#333" stroke-width="1" pointer-events="none"/>`).join(''); }
      if (hd) out += hd.hidden.map((q) => `<polyline points="${q.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ')}" fill="none" stroke="#1565c0" stroke-width="1" stroke-dasharray="5 4" pointer-events="none"/>`).join(''); }
    if (trePv && svg) {   // wiertło rurowe: płytki w ściankach (żółte), wnęka i środek linii płytki – przerywana 1 px
      const d = G.trepanDrawingFor(t.columnF, t.columnJ, E.svgToContour(svg)), pp = (pts) => pts.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ');
      if (d) out += d.plates.map((q) => `<polygon points="${pp(q)}" fill="#c8a400" fill-opacity="0.85" stroke="none" pointer-events="none"/>`).join('')
        + d.hidden.map((q) => `<polyline points="${pp(q)}" fill="none" stroke="#1565c0" stroke-width="1" stroke-dasharray="5 4" pointer-events="none"/>`).join('');
    }
    const poly = (pts) => pts.map((p) => f2(X(p.x)) + ',' + f2(Y(p.y))).join(' ');
    ins.forEach((q, j) => {
      const on = pv.insSel === j;
      out += `<polygon points="${poly(q.left)}" fill="#c8a400" fill-opacity="0.35" stroke="#8a6d00" stroke-width="1" stroke-dasharray="4 2" pointer-events="none"/>`;
      out += `<polygon data-ins="${j}" points="${poly(q.right)}" fill="#c8a400" fill-opacity="${on ? 0.8 : 0.65}" stroke="${on ? '#ff6d00' : '#8a6d00'}" stroke-width="${on ? 2.2 : 1.3}" style="cursor:move"/>`;
      out += `<circle cx="${f2(X(q.right[0].x))}" cy="${f2(Y(q.right[0].y))}" r="3" fill="#ff6d00" pointer-events="none"/>`;
    });
    // uchwyty: odcinki i punkty nowego konturu (połowa – prawa strona; pełny kontur – wszystkie punkty)
    const hp = st.full ? st.full.map((p) => ({ x: p.x, y: p.y })) : (svg ? E.fullPoints(st.rows).slice(0, st.rows.length).map((p) => ({ x: p.x * 10, y: p.y * 10 })) : []);
    const closed = !!st.full;
    for (let k = 0; k < hp.length - (closed ? 0 : 1); k++) {
      const a = hp[k], c = hp[(k + 1) % hp.length];
      out += `<line data-seg="${k}" x1="${f2(X(a.x))}" y1="${f2(Y(a.y))}" x2="${f2(X(c.x))}" y2="${f2(Y(c.y))}" stroke="transparent" stroke-width="9" style="cursor:move"/>`;
    }
    hp.forEach((p, k) => { out += `<circle data-pt="${k}" cx="${f2(X(p.x))}" cy="${f2(Y(p.y))}" r="${st.full ? 3.5 : 4.5}" fill="#1565c0" stroke="#fff" stroke-width="1" style="cursor:grab"/>`
      + (st.full ? '' : `<text x="${f2(X(p.x) + 6)}" y="${f2(Y(p.y) - 5)}" font-size="11" fill="#1565c0" pointer-events="none">${k + 1}</text>`); });
    out += layers.map((l, i) => `<text x="8" y="${16 + i * 14}" font-size="11" fill="${l.stroke}" pointer-events="none">— ${esc(l.label)}</text>`).join('')
      + `<text x="70" y="${H - 8}" font-size="10" fill="#888" pointer-events="none">siatka ${String(step).replace('.', ',')} mm</text></svg>`;
    preview.innerHTML = out;
    preview._ins = ins;
    drawOverlays();
    drawRegionBar();
    const d = svg ? (() => { const b2 = G.bounds(E.svgToContour(svg)); return { diameter: Math.max(Math.abs(b2.minX), Math.abs(b2.maxX)) / 5, length: (b2.maxY - b2.minY) / 10 }; })() : null;
    // składanie zestawu (ToolBuilder, Viewer): R = największe Y (od osi odniesienia Y = 0), M = głębokość poniżej zera (mocowanie)
    const rm = (pts) => { const b2 = G.bounds(pts); return b2 ? `R ${(b2.r / 10).toFixed(2)} · M ${(b2.m / 10).toFixed(2)} mm` : '—'; };
    const tPts = t && G.parseContour(tOf(t));
    info.textContent = d ? `Nowy kontur: największa średnica ${d.diameter.toFixed(2)} mm, długość ${d.length.toFixed(2)} mm · składanie: ${rm(E.svgToContour(svg))}`
      + (tPts && tPts.length >= 3 ? ` (kolumna T: ${rm(tPts)})` : '') + (t.columnF ? ` · katalog: Φ ${t.columnF}` : '') + (t.columnJ ? `, L ${t.columnJ}` : '') : '';
  }

  // ---------- przeciąganie punktów i odcinków; kliknięcie – wybór rejonu ----------
  const world = (e) => {
    const svgEl = preview.querySelector('svg'); if (!svgEl || !pv.view) return null;
    const pt = svgEl.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    return { x: (q.x - pv.view.W / 2) / pv.view.s, y: pv.view.b.maxY - (q.y - pv.view.pad) / pv.view.s };   // 0,1 mm
  };
  const snapV = (v) => { if (!pv.snap) return v; const g = (pv.gridStep || 1) * 10; return Math.round(v / g) * g; };
  const fmtMm = (v) => String(Math.round(v * 100) / 1000);
  const setPoint = (k, x, y) => {
    if (st.full) { st.full[k] = { x, y }; st.srcHalf = null; }
    else if (st.rows[k]) { st.rows[k].z = fmtMm(y); st.rows[k].r = fmtMm(Math.abs(x)); }
  };
  const getPoint = (k) => (st.full ? { ...st.full[k] } : { x: Number(String(st.rows[k].r).replace(',', '.')) * 10, y: Number(String(st.rows[k].z).replace(',', '.')) * 10 });
  preview.addEventListener('pointerdown', (e) => {
    if (!st.tool) return;
    const w = world(e); if (!w) return;
    const ptEl = e.target.closest('[data-pt]'), segEl = e.target.closest('[data-seg]'), insEl = e.target.closest('[data-ins]');
    if (insEl) {
      const j = Number(insEl.dataset.ins), a = adjOf(j);
      pv.drag = { ins: j, start: w, orig: { ...a }, moved: false };
      preview.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    if (ptEl || segEl) {
      const k = Number((ptEl || segEl).dataset.pt ?? segEl.dataset.seg);
      const n = st.full ? st.full.length : st.rows.length;
      const idx = ptEl ? [k] : [k, (k + 1) % n];
      pv.drag = { idx, start: w, orig: idx.map(getPoint), moved: false };
      preview.setPointerCapture(e.pointerId); e.preventDefault();
    } else pv.drag = { click: w, moved: false };
  });
  preview.addEventListener('pointermove', (e) => {
    const d = pv.drag; if (!d || d.click) return;
    const w = world(e); if (!w) return;
    if (d.ins != null) {   // przesuwanie płytki w całości (bez deformacji); lewa płytka – odbicie
      const sn = (v) => (pv.snap ? Math.round(v / (pv.gridStep || 1)) * (pv.gridStep || 1) : v);
      st.insAdj[d.ins] = { ...d.orig, dx: round3(d.orig.dx + sn((w.x - d.start.x) / 10)), dz: round3(d.orig.dz + sn((w.y - d.start.y) / 10)) };
      d.moved = true; pv.insSel = d.ins; drawPreview(); return;
    }
    let dx = w.x - d.start.x, dy = w.y - d.start.y;
    if (d.idx.length === 1) { d.idx.forEach((k, j) => setPoint(k, snapV(d.orig[j].x + dx), snapV(d.orig[j].y + dy))); }
    else { dx = pv.snap ? snapV(dx) : dx; dy = pv.snap ? snapV(dy) : dy; d.idx.forEach((k, j) => setPoint(k, d.orig[j].x + dx, d.orig[j].y + dy)); }
    d.moved = true; st.dirty = true; drawPreview();
  });
  preview.addEventListener('pointerup', (e) => {
    const d = pv.drag; pv.drag = null;
    if (!d) return;
    if (d.click) { pv.ptEdit = null; pv.insSel = null; pickRegion(d.click.y / 10); return; }
    if (d.ins != null) { pv.insSel = d.ins; pv.ptEdit = null; drawPreview(); return; }
    if (d.moved) { drawTable(); drawPreview(); return; }
    if (d.idx && d.idx.length === 1) { pv.ptEdit = d.idx[0]; pv.insSel = null; drawPreview(); }   // kliknięcie w punkt – okienko z parametrami
  });
  // ---------- płytki: rozmieszczenie z algorytmu i korekta ----------
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const adjOf = (j) => (st.insAdj && st.insAdj[j]) || { dx: 0, dz: 0, ang: 0 };
  /** Płytki narzędzia w układzie konturu (0,1 mm): auto – jak w zestawie ToolBuildera; right – po korekcie (dX, dZ, kąt wokół środka), left – odbicie. */
  function insertsOf(t) {
    if (!st.index) return [];
    const stt = st.index.stackTool(t);
    if (!stt || !stt.inserts.length || stt.contour.length < 3) return [];
    const stack = G.buildStack([stt], true, false);
    if (!stack) return [];
    const bT = G.bounds(stt.contour), conv = (pts) => pts.map((p) => ({ x: p.x, y: bT.maxY - p.y }));
    const det = st.index.details(t.productCode) || {}, codes = (det.insertContours || []).filter((x) => G.parseInsertPath(x.contour).length >= 2).map((x) => String(x.code || '').toUpperCase());
    const out = [], raw = stack.layers[0].inserts;
    for (let j = 0; j * 2 + 1 < raw.length; j++) {
      const auto = conv(raw[j * 2 + 1]), a = adjOf(j);
      const cx = auto.reduce((s2, p) => s2 + p.x, 0) / auto.length, cy = auto.reduce((s2, p) => s2 + p.y, 0) / auto.length;
      const right = auto.map((p) => { const r = G.rotateAround(p, { x: cx, y: cy }, -a.ang); return { x: r.x + a.dx * 10, y: r.y + a.dz * 10 }; });
      const f = st.xf || { dx: 0, dz: 0, ang: 0 }, tx = (pts) => pts.map((p) => doXf(p, f));   // płytki przesuwają się razem z konturem
      out.push({ code: codes[j] || 'płytka ' + (j + 1), auto: tx(auto), right: tx(right), left: tx(right.map((p) => ({ x: -p.x, y: p.y }))), local: right });
    }
    return out;
  }
  /** Okienka przy rysunku: parametry klikniętego punktu albo korekta wybranej płytki. */
  function drawOverlays() {
    preview.style.position = 'relative';
    const svgEl = preview.querySelector('svg');
    const at = (sel) => { const el = preview.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(), pr = preview.getBoundingClientRect(); return { x: r.left - pr.left + r.width / 2, y: r.top - pr.top + r.height / 2 }; };
    const box = (x, y, ...kids) => preview.append(h('div', { style: { position: 'absolute', left: Math.min(x + 12, preview.clientWidth - 250) + 'px', top: Math.max(4, y - 10) + 'px', zIndex: 3, background: '#fff', border: '1px solid #1565c0', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,.25)', padding: '6px 8px', fontSize: '12px', minWidth: '210px' },
      onpointerdown: (e) => e.stopPropagation() }, ...kids));
    const num = (v, on) => h('input', { type: 'text', value: String(v).replace('.', ','), style: { width: '70px', padding: '1px 4px' }, onchange: (e) => on(Number(String(e.target.value).replace(',', '.'))) });
    const rowI = (label, inp, unit = 'mm') => h('div', { class: 'row', style: { gap: '4px', margin: '2px 0' } }, h('span', { style: { width: '78px' } }, label), inp, h('span', { class: 'muted' }, unit));
    const closeBtn = (fn) => h('button', { class: 'btn small', style: { float: 'right' }, onclick: fn }, '✕');
    if (!svgEl) return;
    if (pv.ptEdit != null) {
      const k = pv.ptEdit, pos = at(`[data-pt="${k}"]`);
      if (pos) {
        const p = getPoint(k);
        const kids = [closeBtn(() => { pv.ptEdit = null; drawPreview(); }), h('b', {}, st.full ? `Punkt ${k + 1}` : `Punkt ${k + 1} (połowa)`),
          rowI(st.full ? 'X' : 'X (promień)', num(round3(p.x / 10), (v) => { if (Number.isFinite(v)) { setPoint(k, v * 10, p.y); st.dirty = true; drawTable(); drawPreview(); } })),
          rowI('Z', num(round3(p.y / 10), (v) => { if (Number.isFinite(v)) { setPoint(k, p.x, v * 10); st.dirty = true; drawTable(); drawPreview(); } }))];
        if (!st.full) kids.push(rowI('Łuk – promień R', num(st.rows[k].rad || 0, (v) => { if (Number.isFinite(v) && v >= 0) { st.rows[k].rad = v ? String(v) : ''; st.dirty = true; drawTable(); drawPreview(); } })),
          h('div', { class: 'muted', style: { fontSize: '10px' } }, 'R > 0 – zaokrąglenie narożnika w tym punkcie (łuk styczny).'));
        else kids.push(h('div', { class: 'muted', style: { fontSize: '10px' } }, 'Pełny kontur: łuki są odcinkami. Promień zmienisz w trybie połowy („Użyj połowy z tabeli”).'));
        box(pos.x, pos.y, ...kids);
      }
    }
    const ins = preview._ins || [];
    if (pv.insSel != null && ins[pv.insSel]) {
      const j = pv.insSel, q = ins[j], a = adjOf(j), pos = at(`[data-ins="${j}"]`) || { x: 20, y: 20 };
      const set = (patch) => { st.insAdj[j] = { ...adjOf(j), ...patch }; drawPreview(); };
      const mm = (p) => `X ${round3(p.x / 10)} · Z ${round3(p.y / 10)}`.replace(/\./g, ',');
      const report = `Narzędzie ${st.tool.productCode}, płytka ${q.code}: korekta ΔX=${a.dx} mm, ΔZ=${a.dz} mm, obrót ${a.ang}° · punkt bazowy z algorytmu ${mm(q.auto[0])} → po korekcie ${mm(q.right[0])} (mm)`;
      box(pos.x, pos.y, closeBtn(() => { pv.insSel = null; drawPreview(); }), h('b', {}, `Płytka ${q.code}`),
        h('div', { class: 'muted', style: { fontSize: '10px' } }, 'Prawa – przesuwana (przeciągnij albo wpisz), lewa – odbicie lustrzane.'),
        rowI('Korekta ΔX', num(a.dx, (v) => Number.isFinite(v) && set({ dx: v }))), rowI('Korekta ΔZ', num(a.dz, (v) => Number.isFinite(v) && set({ dz: v }))), rowI('Obrót', num(a.ang, (v) => Number.isFinite(v) && set({ ang: v })), '°'),
        h('div', { style: { fontSize: '11px', margin: '3px 0' } }, 'Punkt bazowy (●): z algorytmu ', h('b', {}, mm(q.auto[0])), h('br', {}), 'po korekcie ', h('b', {}, mm(q.right[0]))),
        h('div', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'btn small', onclick: () => set({ dx: 0, dz: 0, ang: 0 }) }, 'Zeruj'),
          h('button', { class: 'btn small primary', onclick: async () => { try { await (window.zks.copyText ? window.zks.copyText(report) : navigator.clipboard.writeText(report)); toast('Skopiowano opis korekty'); } catch (e2) { toast(e2.message, true); } } }, 'Kopiuj opis korekty')));
    }
  }

  /** Rejony: pasy między kolejnymi poziomami Z nowego konturu (zamknięte przekrojem konturu). */
  function zLevels() {
    const pts = svgOut.value ? E.svgToContour(svgOut.value) : [];
    return [...new Set(pts.map((p) => Math.round(p.y) / 10))].sort((a, b) => a - b);
  }
  function pickRegion(z) {
    const lv = zLevels(); pv.sel = null;
    for (let i = 0; i < lv.length - 1; i++) if (z >= lv[i] && z <= lv[i + 1]) { pv.sel = { z1: lv[i], z2: lv[i + 1] }; break; }
    drawPreview();
  }
  function setRole(role) {
    if (!pv.sel) return;
    const { z1, z2 } = pv.sel;
    let list = (st.regions || []).filter((r) => r.z2 <= z1 || r.z1 >= z2);   // nowy rejon zastępuje nakładające się
    if (role) list.push({ z1, z2, role });
    list.sort((a, b) => a.z1 - b.z1);
    const merged = [];
    for (const r of list) { const l = merged[merged.length - 1]; if (l && l.role === r.role && Math.abs(l.z2 - r.z1) < 1e-6) l.z2 = r.z2; else merged.push({ ...r }); }
    st.regions = merged; st.dirty = true; pv.sel = null; drawPreview();
  }
  function drawRegionBar() {
    clear(regionBar);
    const p = st.tool && st.params[normCode(st.tool.productCode)], k = E.bladeLength(p), tre = E.isTrepan(p);
    if (st.autoSplit && svgOut.value) {
      st.autoSplit = false;
      const s = E.workSplit(svgOut.value, k);
      if (s) { st.regions = s.regions; setTimeout(drawPreview, 0); status.set(`Narzędzie monolityczne: ostrze – ${String(k).replace('.', ',')} mm od czubka (${tre ? 'węglik wiertła rurowego' : 'długość robocza, kolumna K'}), reszta – oprawka. Zapis przy potwierdzeniu konturu.`, 'neutral'); }
    }
    if (k > 0 && svgOut.value && !pv.sel) regionBar.append(h('button', { class: 'btn small', title: (tre ? 'Ostrze – węglik 7 mm od czubka' : 'Ostrze od czubka na długości roboczej (PSWT, kolumna K)') + ', reszta konturu – oprawka. Kontur się nie zmienia, dochodzi linia podziału.', onclick: () => {
      const s = E.workSplit(svgOut.value, k);
      if (!s) { status.set('Długość robocza nie mieści się w konturze.', 'error'); return; }
      st.regions = s.regions; st.dirty = true; drawPreview();
    } }, (tre ? `Ostrze – węglik (${String(k).replace('.', ',')} mm)` : `Podziel wg L roboczej (${String(k).replace('.', ',')} mm)`)));
    if (pv.sel) regionBar.append(h('b', {}, `Rejon Z ${String(pv.sel.z1).replace('.', ',')}–${String(pv.sel.z2).replace('.', ',')} mm:`),
      h('button', { class: 'btn small', style: { background: '#c8a400', color: '#fff' }, onclick: () => setRole('ostrze') }, 'Ostrze'),
      h('button', { class: 'btn small', style: { background: '#616161', color: '#fff' }, onclick: () => setRole('oprawka') }, 'Oprawka'),
      h('button', { class: 'btn small', onclick: () => setRole(null) }, 'Brak'));
    else if ((st.regions || []).length) regionBar.append(h('span', { class: 'muted' }, 'Rejony: ' + regionsText(st.regions)));
  }

  async function save(clearIt) {
    const t = st.tool;
    if (!t) return;
    const svg = clearIt ? '' : svgOut.value;
    if (!clearIt && !svg) { status.set('Popraw punkty – kontur ma błędy.', 'error'); return; }
    if (!(await confirmBox('Kolumna V', clearIt ? `Usunąć kontur z kolumny V narzędzia ${t.productCode}?` : `Zapisać roboczo prawą połowę konturu narzędzia ${t.productCode} do kolumny V arkusza ND_CACHE? Kolumna T się nie zmienia. Kontur zatwierdzony trafia do PSWT (kolumna BC) – wtedy kolumna V nie jest potrzebna.`, clearIt ? 'Usuń' : 'Zapisz'))) return;
    try {
      const r = await api('ndSaveContourV', [t.productCode, svg]);
      if (svg) st.v[normCode(t.productCode)] = svg; else delete st.v[normCode(t.productCode)];
      ndPatch(t.productCode, st.params[normCode(t.productCode)] || {}, svg);   // baza Firebase
      st.dirty = false; status.set(clearIt ? `Usunięto kontur z kolumny V (wiersz ${r.row}).` : `Zapisano w kolumnie V (wiersz ${r.row}).`);
      toast('Kontur zapisany'); drawList(); drawPreview();
    } catch (e) { status.set('Nie zapisano: ' + e.message, 'error'); }
  }

  /** Hurtem: kontury z danych dla narzędzi bez konturu w kolumnie V – podgląd liczby i zapis do V. */
  async function bulk() {
    const scope = h('select', {}, h('option', { value: 'noV' }, 'bez konturu w kolumnie V'), h('option', { value: 'none' }, 'bez konturu w T i w V'));
    const info2 = h('div', { style: { whiteSpace: 'pre-wrap', fontSize: '13px', margin: '8px 0' } });
    const pickList = () => st.tools.filter((t) => !vOf(t) && (scope.value === 'noV' || !(tOf(t) && G.parseContour(tOf(t)).length >= 3))).map((t) => ({ t, g: genOf(t) })).filter((x) => x.g);
    const count = () => {
      const l = pickList(), by = {};
      for (const x of l) { const k = `${x.t.columnD || '?'} / ${x.t.columnE || '?'}`; by[k] = (by[k] || 0) + 1; }
      info2.textContent = `Do zapisania: ${l.length} konturów.\n` + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join('\n');
      go.disabled = !l.length;
    };
    const go = h('button', { class: 'btn primary', onclick: async () => {
      const l = pickList();
      if (!(await confirmBox('Kolumna V', `Zapisać ${l.length} konturów policzonych z danych do kolumny V arkusza ND_CACHE?`, 'Zapisz'))) return;
      go.disabled = true;
      let saved = 0;
      try {
        for (let i = 0; i < l.length; i += 300) {
          const items = Object.fromEntries(l.slice(i, i + 300).map((x) => [x.t.productCode, x.g.halfSvg || E.halfPathSvg(x.g)]));
          const r = await api('ndSaveContoursV', [items], { timeoutMs: 180000 });
          saved += r.saved || 0;
          for (const [c, v] of Object.entries(items)) st.v[normCode(c)] = v;
          info2.textContent = `Zapisano ${saved} z ${l.length}…`;
        }
        m.close(); status.set(`Zapisano ${saved} konturów z danych w kolumnie V.`); drawList(); drawPreview();
      } catch (e) { info2.textContent += '\nBłąd: ' + e.message; go.disabled = false; }
    } }, 'Zapisz do kolumny V');
    scope.onchange = count;
    const m = modal('Kontury z danych – hurtem', h('div', {}, h('p', { style: { margin: 0 } }, 'Program liczy kontur z kolumn D:N arkusza PSWT i mocowania z zakładki „kontury” (tak jak dawna formuła w PSWT, bez obciążania arkusza) i zapisuje go do kolumny V jako SVG w mm – cały, bez zmian, z liniami rzutu bocznego.'),
      h('label', { class: 'row' }, 'Narzędzia: ', scope), info2,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), go)), { wide: true });
    count();
  }

  const search = h('input', { type: 'search', placeholder: 'Szukaj kodu / opisu', style: { width: '100%', padding: '4px 8px' }, oninput: (e) => { st.q = e.target.value; drawList(); } });
  const only = h('select', { style: { width: '100%' }, onchange: (e) => { st.only = e.target.value; drawList(); } },
    h('option', { value: '' }, 'Wszystkie narzędzia'), h('option', { value: 'T' }, 'z konturem w kolumnie T'), h('option', { value: 'V' }, 'z konturem w kolumnie V'), h('option', { value: '-' }, 'bez konturu'), h('option', { value: 'G' }, 'z konturem z danych (D:N)'));
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Kontury narzędzi'), h('span', { class: 'grow muted' }, 'Wpisz prawą połowę konturu – zapisywana jest tylko połowa (SVG, mm); podgląd 2D – odbicie lustrzane, 3D – obrót. Zatwierdzony kontur → PSWT BC (zastępuje kolumnę T w całym programie).'),
    canSave ? h('button', { class: 'btn', title: 'Kontury z danych (PSWT D:N) dla wielu narzędzi naraz', onclick: () => bulk() }, 'Z danych hurtem…') : null,
    h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), filtersBox, status,
  h('div', { style: { display: 'grid', gridTemplateColumns: '260px minmax(330px, 420px) 1fr', gap: '10px', flex: 1, minHeight: 0 } },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minHeight: 0 } }, search, only, listBox),
    editBox,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 } }, previewBar, preview, prev3d, info,
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Kontur do zapisu – prawa połowa (SVG, mm; zatwierdzenie → PSWT BC, roboczo → ND_CACHE V):'), svgOut,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { try { await (window.zks.copyText ? window.zks.copyText(svgOut.value) : navigator.clipboard.writeText(svgOut.value)); toast('Skopiowano'); } catch (e) { toast(e.message, true); } } }, 'Kopiuj'),
        h('span', { class: 'grow' }),
        canSave ? h('button', { class: 'btn', onclick: () => save(true) }, 'Usuń z kolumny V') : null,
        canSave ? (saveVBtn = h('button', { class: 'btn', onclick: () => save(false) }, 'Zapisz roboczo (ND_CACHE V)')) : h('span', { class: 'muted' }, 'Zapis do arkusza: MASTER lub GOD')))));
  drawEditor();
  load(false);
  return { dirty: () => st.dirty };
}
