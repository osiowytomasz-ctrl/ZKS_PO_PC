// Narzędziownia → Kontury: edytor / kreator konturów narzędzi. Użytkownik wpisuje połowę konturu (od osi na zewnątrz: Z wzdłuż osi,
// R – promień, opcjonalnie zaokrąglenie w punkcie), program rysuje cały kontur (odbicie lustrzane) obok dawnego z kolumny T i zapisuje go
// jako ścieżkę SVG w mm do kolumny V arkusza ND_CACHE (MASTER, GOD). Kolumna T się nie zmienia.
import { h, clear, api, toast, confirmBox, modal } from '../ui.js';
import { toolCatalog } from '../catalog.js';
import * as G from '../logic/toolGeometry.js';
import * as E from '../logic/contourEditor.js';
import { normCode, description } from '../logic/tooltrack.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { statusLine } from './toolViews.js';
import { fullContour, bodyContour, mounting } from '../logic/contourGen.js';

const PARAMS = [['D', 'Grupa narzędzi'], ['E', 'Rodzaj narzędzia'], ['F', 'Fi_mniejsze'], ['G', 'Pochylenie płytki'], ['H', 'Promień'], ['I', 'Fi_większe'],
  ['J', 'Długość 1'], ['K', 'Długość robocza'], ['L', 'Ząb / num. gwint. / zbieżność / ap'], ['M', 'Mocowanie początkowe'], ['N', 'Mocowanie końcowe']];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function mountContours(el, ctx) {
  const canSave = grafikAccess(grafikLevelOf(ctx.user)).manage;
  const st = { tools: [], details: new Map(), v: {}, mounts: {}, params: {}, q: '', only: '', tool: null, rows: [], dirty: false, full: null, fullLabel: '' };
  const status = statusLine();
  const listBox = h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, border: '1px solid #ccc', background: '#fff' } });
  const editBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0, overflow: 'auto' } });
  const preview = h('div', { style: { flex: 1, minHeight: '320px', background: '#fff', border: '1px solid #ccc' } });
  const info = h('div', { class: 'muted', style: { fontSize: '12px' } });
  const svgOut = h('textarea', { readonly: true, rows: 4, style: { width: '100%', fontFamily: 'monospace', fontSize: '11px' } });
  const errBox = h('div', { class: 'err', style: { fontSize: '12px', whiteSpace: 'pre-wrap' } });

  /** Dane generatora: PSWT D:N i zakładka „kontury” (Kontury.gs: ndContourData). Błąd zostaje widoczny w panelu parametrów. */
  async function loadData() {
    st.dataError = null;
    try {
      const cd = (await api('ndContourData', [], { timeoutMs: 180000 })) || {};
      st.mounts = cd.mounts || {}; st.params = cd.params || {};
      if (!Object.keys(st.params).length) st.dataError = 'serwer nie zwrócił żadnych narzędzi z arkusza PSWT (sprawdź nazwę karty „PSWT” i kolumny B:N).';
    } catch (e) {
      st.mounts = {}; st.params = {};
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
      try { st.v = (await api('ndContoursV', [])) || {}; } catch (e) { st.v = {}; status.set('Nie wczytano kolumny V (wdrożenie Apps Script: Kontury.gs, ndContoursV): ' + e.message, 'error'); }
      await loadData();
      drawList();
    } catch (e) { clear(listBox).append(h('div', { class: 'err', style: { padding: '8px' } }, 'Nie wczytano narzędzi: ' + e.message)); }
  }
  const tOf = (t) => (st.details.get(normCode(t.productCode)) || {}).columnAY || '';
  const vOf = (t) => st.v[normCode(t.productCode)] || '';
  /** Kontur z danych (PSWT D:N + mocowanie z zakładki „kontury”) w 0,1 mm albo null. */
  /** Parametry D:N narzędzia: z arkusza PSWT albo – dla wybranego narzędzia – zmienione do sprawdzenia (bez zapisu). */
  const paramsOf = (t) => (st.tool && t && st.tool.productCode === t.productCode && st.test ? st.test : st.params[normCode(t.productCode)]);
  const genOf = (t) => {
    const p = paramsOf(t);
    if (!p) return null;
    const pts = G.parseContour(fullContour(p, st.mounts) || '');
    return pts.length >= 3 && G.bounds(pts).maxX - G.bounds(pts).minX > 0 ? pts : null;
  };

  function drawList() {
    const q = st.q.toLowerCase();
    const items = st.tools.filter((t) => (!q || String(t.productCode).toLowerCase().includes(q) || description(t).toLowerCase().includes(q))
      && (!st.only || (st.only === 'T' ? tOf(t) : st.only === 'V' ? vOf(t) : st.only === 'G' ? genOf(t) : !tOf(t) && !vOf(t))));
    clear(listBox);
    for (const t of items.slice(0, 600)) {
      const on = st.tool && st.tool.productCode === t.productCode;
      listBox.append(h('div', { class: 'click', style: { padding: '3px 6px', borderBottom: '1px solid #eee', background: on ? '#d3e3fd' : '', cursor: 'pointer' }, onclick: () => pick(t) },
        h('b', {}, t.productCode), ' ', tOf(t) ? h('span', { title: 'Jest kontur w kolumnie T', style: { fontSize: '10px', color: '#666' } }, 'T') : null, ' ',
        vOf(t) ? h('span', { title: 'Jest kontur w kolumnie V', style: { fontSize: '10px', color: '#2e7d32', fontWeight: 700 } }, 'V') : null,
        h('div', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, description(t))));
    }
    if (items.length > 600) listBox.append(h('div', { class: 'muted', style: { padding: '6px' } }, `Pokazano 600 z ${items.length} – zawęź wyszukiwanie.`));
    if (!items.length) listBox.append(h('div', { class: 'muted', style: { padding: '6px' } }, 'Brak narzędzi.'));
  }

  async function pick(t) {
    if (st.dirty && !(await confirmBox('Kontury', 'Porzucić niezapisane zmiany konturu?', 'Porzuć'))) return;
    st.tool = t; st.dirty = false; st.test = null;
    const g = genOf(t), tp = G.parseContour(tOf(t));
    const src = vOf(t) ? [E.svgToContour(vOf(t)), 'kolumna V'] : tp.length >= 3 ? [tp, 'kolumna T'] : g ? [g, 'dane D:N'] : null;
    setFull(src && src[0], src && src[1]);
    if (!st.rows.length) st.rows = [{ z: '0', r: '', rad: '' }, { z: '', r: '', rad: '' }];
    status.set(src ? `Wczytano pełny kontur (${src[1]}) – bez zmian, z liniami rzutu bocznego. Zmiana punktów w tabeli przełącza na kontur z połowy (odbicie).` : 'Brak konturu – wpisz punkty od początku.', 'neutral');
    drawList(); drawEditor();
  }

  function drawEditor() {
    clear(editBox);
    const t = st.tool;
    if (!t) { editBox.append(h('p', { class: 'muted' }, 'Wybierz narzędzie z listy po lewej.')); drawPreview(); return; }
    editBox.append(h('div', {}, h('b', { style: { fontSize: '15px' } }, t.productCode), h('div', { class: 'muted', style: { fontSize: '12px' } }, description(t)),
      h('div', { style: { fontSize: '12px' } }, `Φ ${t.columnF || '—'} · L ${t.columnJ || '—'} · Ms ${t.columnM || '—'} · Mk ${t.columnN || '—'}`)));
    editBox.append(paramsPanel(t));
    editBox.append(h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '4px' } },
      h('button', { class: 'btn small', disabled: !tOf(t), title: 'Pełny kontur z kolumny T (bez zmian)', onclick: () => { setFull(G.parseContour(tOf(t)), 'kolumna T'); st.dirty = true; status.set('Wczytano pełny kontur z kolumny T (bez zmian).', 'neutral'); drawEditor(); } }, 'Z kolumny T'),
      h('button', { class: 'btn small', disabled: !vOf(t), onclick: () => { setFull(E.svgToContour(vOf(t)), 'kolumna V'); status.set('Wczytano pełny kontur z kolumny V.', 'neutral'); drawEditor(); } }, 'Z kolumny V'),
      h('button', { class: 'btn small', disabled: !genOf(t), title: 'Kontur policzony z kolumn D:N arkusza PSWT i mocowania z zakładki „kontury” (jak dawna formuła)', onclick: () => { setFull(genOf(t), 'dane D:N'); st.dirty = true; status.set('Wczytano pełny kontur policzony z danych (D:N) – z liniami rzutu bocznego.', 'neutral'); drawEditor(); } }, 'Z danych (D:N)'),
      h('button', { class: 'btn small', onclick: () => setRows([{ z: '0', r: '', rad: '' }, { z: '', r: '', rad: '' }], 'Wyczyszczono.') }, 'Od nowa'),
      h('button', { class: 'btn small', onclick: () => { st.rows.push({ z: '', r: '', rad: '' }); st.dirty = true; drawEditor(); } }, '+ punkt')));
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
      `Tryb: pełny kontur (${st.fullLabel}) zapisywany bez zmian – z liniami rzutu bocznego (np. nakrętka ER). Tabela pokazuje tylko obrys; zmiana punktu przełącza na kontur z połowy (odbicie lustrzane, bez linii wewnętrznych).`,
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
        + `Mocowanie ${p.M || '—'}: ${m ? (m.synthetic ? 'wyliczone ze wzoru (brak w zakładce „kontury”)' : 'z zakładki „kontury”') : 'brak w zakładce „kontury”'} · `
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
          if (g) { setFull(g, 'dane D:N'); st.dirty = true; showNote(); drawTable(); }
          refresh(); drawPreview();
        } });
      grid.append(h('span', { class: 'muted' }, `${k} · ${label}`), inp);
    }
    box.append(grid, sheetInfo, h('button', { class: 'btn small', style: { marginTop: '4px' }, onclick: () => { st.test = null; const g = genOf(t); if (g) setFull(g, 'dane D:N'); drawEditor(); } }, 'Przywróć z arkusza'));
    refresh();
    return box;
  }

  function setRows(rows, msg) { st.full = null; st.rows = rows.length ? rows : [{ z: '', r: '', rad: '' }]; st.dirty = true; status.set(msg, 'neutral'); drawEditor(); }
  /** Pełny kontur bez zmian (T / V / dane) – tabela pokazuje jego obrys (połowę) tylko do podglądu i ewentualnej edycji. */
  function setFull(points, label) {
    st.full = points && points.length >= 3 ? points : null; st.fullLabel = label || '';
    st.rows = st.full ? E.halfFromContour(st.full) : [];
  }

  function drawPreview() {
    const t = st.tool;
    const errs = t && !st.full ? E.validate(st.rows) : [];
    errBox.textContent = errs.join('\n');
    const svg = !t ? '' : st.full ? E.contourToSvg(st.full) : !errs.length ? E.toSvg(st.rows) : '';
    svgOut.value = svg;
    const layers = [];
    if (t && tOf(t)) layers.push({ pts: G.parseContour(tOf(t)), stroke: '#888', fill: 'none', dash: '6 4', label: 'kolumna T (dawny)' });
    if (t && genOf(t)) layers.push({ pts: genOf(t), stroke: '#ef6c00', fill: 'none', dash: '4 3', label: 'z danych D:N' });
    if (t && vOf(t)) layers.push({ pts: E.svgToContour(vOf(t)), stroke: '#2e7d32', fill: 'none', dash: '2 3', label: 'kolumna V (zapisany)' });
    if (svg) layers.push({ pts: E.svgToContour(svg), stroke: '#1565c0', fill: 'rgba(21,101,192,.18)', dash: '', label: 'nowy kontur' });
    const all = layers.flatMap((l) => l.pts);
    if (!all.length) { preview.innerHTML = '<p class="muted" style="padding:10px">Brak konturu do pokazania.</p>'; info.textContent = ''; return; }
    const b = G.bounds(all), W = 600, H = 600, pad = 30;
    const s = Math.min((W - 2 * pad) / Math.max(b.maxX - b.minX, 1), (H - 2 * pad) / Math.max(b.maxY - b.minY, 1));
    const X = (x) => (W / 2 + x * s).toFixed(2), Y = (y) => (pad + (b.maxY - y) * s).toFixed(2);
    let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
    out += `<line x1="${X(0)}" y1="4" x2="${X(0)}" y2="${H - 4}" stroke="#d50000" stroke-width="1" stroke-dasharray="10 4 2 4"/>`;
    for (const l of layers) out += `<polygon points="${l.pts.map((p) => X(p.x) + ',' + Y(p.y)).join(' ')}" fill="${l.fill}" stroke="${l.stroke}" stroke-width="${l.dash ? 1.2 : 1.6}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}/>`;
    // punkty wpisanej połowy z numerami
    if (svg && !st.full) E.fullPoints(st.rows).slice(0, st.rows.length).forEach((p, i) => { out += `<circle cx="${X(p.x * 10)}" cy="${Y(p.y * 10)}" r="3" fill="#1565c0"/><text x="${(+X(p.x * 10) + 5).toFixed(1)}" y="${(+Y(p.y * 10) - 4).toFixed(1)}" font-size="11" fill="#1565c0">${i + 1}</text>`; });
    out += layers.map((l, i) => `<text x="8" y="${16 + i * 14}" font-size="11" fill="${l.stroke}">— ${esc(l.label)}</text>`).join('') + '</svg>';
    preview.innerHTML = out;
    const d = svg ? (() => { const b2 = G.bounds(E.svgToContour(svg)); return { diameter: Math.max(Math.abs(b2.minX), Math.abs(b2.maxX)) / 5, length: (b2.maxY - b2.minY) / 10 }; })() : null;
    // składanie zestawu (ToolBuilder, Viewer): R = największe Y (od osi odniesienia Y = 0), M = głębokość poniżej zera (mocowanie)
    const rm = (pts) => { const b2 = G.bounds(pts); return b2 ? `R ${(b2.r / 10).toFixed(2)} · M ${(b2.m / 10).toFixed(2)} mm` : '—'; };
    const tPts = t && G.parseContour(tOf(t));
    info.textContent = d ? `Nowy kontur: największa średnica ${d.diameter.toFixed(2)} mm, długość ${d.length.toFixed(2)} mm · składanie: ${rm(E.svgToContour(svg))}`
      + (tPts && tPts.length >= 3 ? ` (kolumna T: ${rm(tPts)})` : '') + (t.columnF ? ` · katalog: Φ ${t.columnF}` : '') + (t.columnJ ? `, L ${t.columnJ}` : '') : '';
  }

  async function save(clearIt) {
    const t = st.tool;
    if (!t) return;
    const svg = clearIt ? '' : svgOut.value;
    if (!clearIt && !svg) { status.set('Popraw punkty – kontur ma błędy.', 'error'); return; }
    if (!(await confirmBox('Kolumna V', clearIt ? `Usunąć kontur z kolumny V narzędzia ${t.productCode}?` : `Zapisać nowy kontur narzędzia ${t.productCode} do kolumny V arkusza ND_CACHE? Kolumna T się nie zmienia.`, clearIt ? 'Usuń' : 'Zapisz'))) return;
    try {
      const r = await api('ndSaveContourV', [t.productCode, svg]);
      if (svg) st.v[normCode(t.productCode)] = svg; else delete st.v[normCode(t.productCode)];
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
          const items = Object.fromEntries(l.slice(i, i + 300).map((x) => [x.t.productCode, E.contourToSvg(x.g)]));
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
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Kontury narzędzi'), h('span', { class: 'grow muted' }, 'Wpisz połowę konturu – program tworzy cały kontur i zapisuje go w kolumnie V (SVG, mm).'),
    canSave ? h('button', { class: 'btn', title: 'Kontury z danych (PSWT D:N) dla wielu narzędzi naraz', onclick: () => bulk() }, 'Z danych hurtem…') : null,
    h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), status,
  h('div', { style: { display: 'grid', gridTemplateColumns: '260px minmax(330px, 420px) 1fr', gap: '10px', flex: 1, minHeight: 0 } },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minHeight: 0 } }, search, only, listBox),
    editBox,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 } }, preview, info,
      h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Kontur do kolumny V (SVG, mm):'), svgOut,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { try { await (window.zks.copyText ? window.zks.copyText(svgOut.value) : navigator.clipboard.writeText(svgOut.value)); toast('Skopiowano'); } catch (e) { toast(e.message, true); } } }, 'Kopiuj'),
        h('span', { class: 'grow' }),
        canSave ? h('button', { class: 'btn', onclick: () => save(true) }, 'Usuń z kolumny V') : null,
        canSave ? h('button', { class: 'btn primary', onclick: () => save(false) }, 'Zapisz do kolumny V') : h('span', { class: 'muted' }, 'Zapis do arkusza: MASTER lub GOD')))));
  drawEditor();
  load(false);
}
