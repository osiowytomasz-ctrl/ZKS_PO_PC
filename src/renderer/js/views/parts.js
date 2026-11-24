// Narzędziownia → Części: kontury płytek skrawających (arkusz PL_kontur, kolumna G – ścieżki SVG w mm) w kafelkach:
// kod, stan / zapas / dostępne (kolor braku jak w arkuszu), rysunek płytki i narzędzia, w których jest używana.
// Kliknięcie kafelka – duży rysunek, wymiary, kontur źródłowy (do skopiowania) i lista narzędzi.
import { h, clear, toast, modal, api } from '../ui.js';
import { toolCatalog, confirmedContoursQuick } from '../catalog.js';
import * as G from '../logic/toolGeometry.js';
import { parseSheetColor } from '../logic/common.js';
import { naturalCompare } from '../logic/common.js';
import { lazyFill, contrast, plateBase, savePlateBase, plateEdge, savePlateEdge } from './toolViews.js';
import { openPlateEditor } from './plateEditor.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { toolroomAccess, toolroomLevelOf } from '../logic/toolroomAccess.js';
import { ndLoad } from '../ndStore.js';
import { normCode } from '../logic/tooltrack.js';
import * as V from '../logic/partsView.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Rysunek płytki (SVG) dopasowany do pola [w]×[hgt]; [dims] – wymiary w mm pod rysunkiem. */
export function insertSvg(path, { w = 150, hgt = 120, dims = false } = {}) {
  const pts = G.parseInsertPath(path);
  if (pts.length < 2) return h('div', { class: 'muted', style: { width: w + 'px', height: hgt + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' } }, 'brak konturu');
  const b = G.bounds(pts), pad = 8, bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((w - 2 * pad) / bw, (hgt - 2 * pad - (dims ? 14 : 0)) / bh);
  const ox = (w - bw * s) / 2 - b.minX * s, oy = pad + b.maxY * s;   // rysunek odwrócony w pionie (Y w górę) – tak jak w podglądzie 3D i na narzędziu
  const poly = pts.map((p) => `${(ox + p.x * s).toFixed(1)},${(oy - p.y * s).toFixed(1)}`).join(' ');
  const el = h('div', { style: { width: w + 'px', height: hgt + 'px' } });
  el.innerHTML = `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polygon points="${poly}" fill="#c8a400" fill-opacity="0.85" stroke="#5d4a00" stroke-width="1"/>`
    + (dims ? `<text x="${w / 2}" y="${hgt - 3}" font-size="11" text-anchor="middle" fill="#444">${(bw / 10).toFixed(2)} × ${(bh / 10).toFixed(2)} mm</text>` : '') + '</svg>';
  return el;
}

export function mountParts(el, ctx) {
  const canSave = toolroomAccess(toolroomLevelOf(ctx.user)).editPlates;   // układ płytek i parametry – tylko GOD
  const st = { index: null, parts: [], q: '', onlyContour: true, company: '', u: '', t: '', sort: 'code', dir: 1, params: {}, stopFill: null };
  const grid = h('div', { class: 'tool-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' } });
  const info = h('span', { class: 'muted' });
  const companySel = h('select', { class: 'filter-dd', onchange: () => { st.company = companySel.value; companySel.classList.toggle('on', !!st.company); draw(); } });
  const colSel = (col, title) => { const s = h('select', { class: 'filter-dd', title, onchange: () => { st[col.toLowerCase()] = s.value; s.classList.toggle('on', !!s.value); draw(); } }); return s; };
  const uSel = colSel('U', 'Filtr: kolumna U arkusza PSWT narzędzi, w których jest część'), tSel = colSel('T', 'Filtr: kolumna T arkusza PSWT narzędzi, w których jest część');
  const sortSel = h('select', { title: 'Sortowanie części', onchange: () => { st.sort = sortSel.value; draw(); } }, ...V.SORTS.map(([v, l]) => h('option', { value: v }, 'Sortuj: ' + l)));
  const dirBtn = h('button', { class: 'btn', title: 'Kierunek sortowania', onclick: () => { st.dir = -st.dir; dirBtn.textContent = st.dir > 0 ? '↑' : '↓'; draw(); } }, '↑');
  const legend = h('span', { style: { display: 'inline-flex', gap: '8px', fontSize: '11px', alignItems: 'center' } }, ...Object.values(V.CATEGORIES).map((c) => h('span', {}, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: c.bg, border: '1px solid #888', marginRight: '3px' } }), c.label)));

  /** Parametry PSWT narzędzi części (Lrob, kolumny U i T) po zmianie [st.params]. */
  function applyParams() {
    for (const p of st.parts) {
      p.tools.forEach((x) => { x.params = st.params[normCode(x.code)] || null; x.info = V.toolInfo(x.tool, x.params); });
      p.plist = p.tools.map((x) => x.params).filter(Boolean);
    }
  }
  /** Filtry po kolumnach U i T arkusza PSWT (kolejność: U, T): zawsze widoczne; bez danych kolumn – komunikat w opisie. */
  function fillCols() {
    for (const [col, sel] of [['U', uSel], ['T', tSel]]) {
      const vals = [...new Set(st.parts.flatMap((p) => V.partValues(p.plist, col)))].sort(naturalCompare), keep = st[col.toLowerCase()];
      clear(sel).append(h('option', { value: '' }, vals.length ? col : col + ' – brak danych'), ...vals.map((v) => h('option', { value: v, selected: v === keep }, v)));
      if (!vals.includes(keep)) st[col.toLowerCase()] = '';
      sel.classList.toggle('on', !!st[col.toLowerCase()]); sel.disabled = !vals.length;
      sel.title = vals.length ? `Filtr: kolumna ${col} arkusza PSWT narzędzi, w których jest część` : `Brak wartości kolumny ${col} – wdróż Kontury.gs (odczyt PSWT T i U) i prześlij dane do bazy (Ustawienia → Narzędziownia)`;
    }
  }
  /** Gdy baza (Firebase) nie ma jeszcze kolumn U i T – dociągnięcie ich bezpośrednio z arkusza PSWT (Apps Script) w tle. */
  let colsTried = false;
  async function ensureColumns() {
    if (colsTried || st.parts.some((p) => p.plist.some((x) => x.U || x.T))) return;
    colsTried = true;
    try {
      const cd = await api('ndContourData', [], { timeoutMs: 180000 });
      let any = false;
      for (const [k, o] of Object.entries((cd && cd.params) || {})) { const key = normCode(k), cur = st.params[key]; if (cur && (o.T || o.U)) { cur.T = o.T || ''; cur.U = o.U || ''; any = true; } }
      if (any) { applyParams(); fillCols(); draw(); }
    } catch { /* stary backend albo brak dostępu – filtry zostają wyłączone */ }
  }
  async function load(force) {
    clear(grid).append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie części…'));
    try {
      const cat = await toolCatalog(force);
      st.index = G.toolIndex(cat, await confirmedContoursQuick());
      try { st.params = (await ndLoad({ manage: false, force })).params || {}; } catch { st.params = {}; }   // parametry PSWT narzędzi (K – długość robocza, kolumny T i U)
      st.parts = st.index.cuttingParts().map((code) => {
        const t = st.index.tool(code), uses = st.index.usages(code);
        // narzędzia, w których część skrawa: opis (Grupa / Rodzaj, Lrob, L), kategoria kafelka i parametry PSWT do filtrów U / T
        const tools = uses.map((u) => { const tl = st.index.tool(u.toolCode), pr = st.params[normCode(u.toolCode)] || null; return { code: u.toolCode, role: u.role, tool: tl, params: pr, info: V.toolInfo(tl, pr) }; });
        const cut = tools.filter((x) => x.role !== 'accessory');
        return { code, contour: st.index.insertContour(code), tool: t, uses, tools, cat: V.partCategory(cut.map((x) => x.tool)), types: [...new Set(cut.map((x) => x.info.group).filter(Boolean))].sort(naturalCompare).join(', '), plist: tools.map((x) => x.params).filter(Boolean) };
      }).sort((a, b) => naturalCompare(a.code, b.code));
      fillCols(); ensureColumns();
      const firms = [...new Set(st.parts.map((p) => String((p.tool && p.tool.columnP) || '').trim()).filter(Boolean))].sort(naturalCompare);
      clear(companySel).append(h('option', { value: '' }, 'Firma'), ...firms.map((f) => h('option', { value: f }, f)));
      draw();
    } catch (e) { clear(grid).append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano części: ' + e.message)); }
  }

  const stockLine = (t) => (t ? `Stan ${G.numberText(t.status || 0)} · Zapas ${G.numberText(t.stock || 0)} · Dostępne ${G.numberText(t.available || 0)}` : 'Brak w katalogu (stan nieznany)');
  function tile(p) {
    const t = p.tool, warn = t && String(t.partStatusColor || '').trim() && !/^#?fff(fff)?$/i.test(String(t.partStatusColor).trim());
    const cat0 = V.CATEGORIES[p.cat], bg = warn ? parseSheetColor(t.partStatusColor, '#ffffff') : (cat0 ? cat0.bg : '#f3f3f3');   // brak stanu – nagłówek w kolorze kategorii
    const cat = V.CATEGORIES[p.cat], body = cat ? cat.bg : '#fff';   // tło kafelka wg kategorii: piaskowy – wiertła, szary – frezy, niebieski – toczenie
    const shown = p.tools.slice(0, 6);
    return h('div', { class: 'tool-tile click', onclick: () => detail(p), style: { minHeight: '0', background: body } },
      h('div', { class: 'tile-head' }, h('div', { style: { flex: 1, padding: '4px 8px', fontWeight: 800, background: bg, color: warn ? contrast(bg) : '#000' } }, String(p.code).toUpperCase())),
      h('div', { style: { display: 'flex', justifyContent: 'center', margin: '4px 6px', padding: '4px', border: '2px solid #000', background: '#fff' } }, insertSvg(p.contour, { w: 200, hgt: 110, dims: true })),   // rejon rysunku płytki w ramce 2 px, białe tło bez zmian; kolor kategorii na reszcie kafelka
      h('div', { style: { padding: '3px 8px', fontSize: '12px', borderTop: '1px solid rgba(0,0,0,.25)' } }, stockLine(t)),
      h('div', { style: { padding: '0 8px 4px', fontSize: '11px', color: '#333' }, title: p.tools.map((x) => x.code + ' – ' + (V.toolInfoText(x.info) || 'brak danych')).join('\n') },
        h('div', { class: 'muted' }, `W narzędziach (${p.uses.length}):`),
        ...shown.map((x) => h('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, h('b', {}, x.code), x.role === 'accessory' ? ' (akc.)' : '', ' · ' + (V.toolInfoText(x.info) || '—'))),
        p.tools.length > shown.length ? h('div', { class: 'muted' }, `… i ${p.tools.length - shown.length} więcej (kliknij kafelek)`) : null));
  }

  /**
   * Kliknięcie kafelka otwiera edytor płytki (ten sam co w Konturach): kontur z łukami, punkt bazowy, krawędź skrawająca, parametry 3D, podgląd 3D, kopiowanie i zapis SVG
   * (MASTER / GOD – do arkusza PL_kontur). Nad edytorem – stan magazynowy i narzędzia, w których płytka jest używana.
   */
  function detail(p) {
    const t = p.tool, path = st.index.insertContour(p.code) || p.contour || '';
    const info = [t ? [t.columnP, t.name, t.columnO].filter((x) => String(x || '').trim()).join(' | ') : '', stockLine(t), `Używana w narzędziach (${p.uses.length}): ` + p.tools.map((x) => x.code + (x.role === 'accessory' ? ' (akcesorium)' : '') + ' [' + (V.toolInfoText(x.info) || 'brak danych') + ']').join('; ')].filter(Boolean).join(' · ');
    openPlateEditor({ code: p.code, path, tool: '', info, setup: { z: 2, draft: 7, thickness: 0 }, plate: null, base: plateBase(p.code), edge: plateEdge(p.code), autoCentral: false, canSave,
      save: async (code, svg) => { await api('plSaveContour', [code, svg]); },
      onApply: ({ path: np, base, edge }) => {
        savePlateBase(p.code, base); savePlateEdge(p.code, edge);
        if (np && np !== path) { st.index.setInsertContour(p.code, np); p.contour = np; }
        draw();
        toast(`Płytka ${String(p.code).toUpperCase()}: zastosowano zmiany${np !== path ? ' (kontur – do odświeżenia katalogu)' : ''}.`);
      } });
  }

  function draw() {
    const q = st.q.toLowerCase();
    let items = st.parts.filter((p) => (!st.onlyContour || p.contour) && (!q || p.code.toLowerCase().includes(q) || p.uses.some((u) => String(u.toolCode).toLowerCase().includes(q)))
      && (!st.company || String((p.tool && p.tool.columnP) || '').trim() === st.company) && V.matchesColumns(p.plist, { U: st.u, T: st.t }));
    items = V.sortParts(items, st.sort, st.dir);
    info.textContent = `Części: ${items.length} z ${st.parts.length} (z konturem: ${st.parts.filter((p) => p.contour).length})`;
    if (st.stopFill) st.stopFill();
    clear(grid);
    if (!items.length) grid.append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Brak części spełniających kryteria.'));
    st.stopFill = lazyFill(grid, items, tile, 120);
  }

  const search = h('input', { type: 'search', placeholder: 'Kod płytki albo narzędzia', style: { width: '220px', padding: '4px 8px' }, oninput: () => { st.q = search.value; draw(); } });
  const only = h('input', { type: 'checkbox', checked: true, onchange: () => { st.onlyContour = only.checked; draw(); } });
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Części – kontury płytek'), search, companySel, uSel, tSel, sortSel, dirBtn, legend, h('label', { class: 'row', style: { gap: '4px' } }, only, 'tylko z konturem'),
    h('span', { class: 'grow' }), info, h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), grid);
  load(false);
}
