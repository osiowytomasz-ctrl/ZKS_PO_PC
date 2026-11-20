// Narzędziownia → Części: kontury płytek skrawających (arkusz PL_kontur, kolumna G – ścieżki SVG w mm) w kafelkach:
// kod, stan / zapas / dostępne (kolor braku jak w arkuszu), rysunek płytki i narzędzia, w których jest używana.
// Kliknięcie kafelka – duży rysunek, wymiary, kontur źródłowy (do skopiowania) i lista narzędzi.
import { h, clear, toast, modal } from '../ui.js';
import { toolCatalog } from '../catalog.js';
import * as G from '../logic/toolGeometry.js';
import { parseSheetColor } from '../logic/common.js';
import { naturalCompare } from '../logic/common.js';
import { lazyFill, contrast, view3d } from './toolViews.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Rysunek płytki (SVG) dopasowany do pola [w]×[hgt]; [dims] – wymiary w mm pod rysunkiem. */
export function insertSvg(path, { w = 150, hgt = 120, dims = false } = {}) {
  const pts = G.parseInsertPath(path);
  if (pts.length < 2) return h('div', { class: 'muted', style: { width: w + 'px', height: hgt + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' } }, 'brak konturu');
  const b = G.bounds(pts), pad = 8, bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((w - 2 * pad) / bw, (hgt - 2 * pad - (dims ? 14 : 0)) / bh);
  const ox = (w - bw * s) / 2 - b.minX * s, oy = pad - b.minY * s;
  const poly = pts.map((p) => `${(ox + p.x * s).toFixed(1)},${(oy + p.y * s).toFixed(1)}`).join(' ');
  const el = h('div', { style: { width: w + 'px', height: hgt + 'px' } });
  el.innerHTML = `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polygon points="${poly}" fill="#c8a400" fill-opacity="0.85" stroke="#5d4a00" stroke-width="1"/>`
    + (dims ? `<text x="${w / 2}" y="${hgt - 3}" font-size="11" text-anchor="middle" fill="#444">${(bw / 10).toFixed(2)} × ${(bh / 10).toFixed(2)} mm</text>` : '') + '</svg>';
  return el;
}

export function mountParts(el, ctx) {
  const st = { index: null, parts: [], q: '', onlyContour: true, company: '', stopFill: null };
  const grid = h('div', { class: 'tool-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' } });
  const info = h('span', { class: 'muted' });
  const companySel = h('select', { class: 'filter-dd', onchange: () => { st.company = companySel.value; companySel.classList.toggle('on', !!st.company); draw(); } });

  async function load(force) {
    clear(grid).append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie części…'));
    try {
      const cat = await toolCatalog(force);
      st.index = G.toolIndex(cat);
      st.parts = st.index.cuttingParts().map((code) => {
        const t = st.index.tool(code);
        return { code, contour: st.index.insertContour(code), tool: t, uses: st.index.usages(code) };
      }).sort((a, b) => naturalCompare(a.code, b.code));
      const firms = [...new Set(st.parts.map((p) => String((p.tool && p.tool.columnP) || '').trim()).filter(Boolean))].sort(naturalCompare);
      clear(companySel).append(h('option', { value: '' }, 'Firma'), ...firms.map((f) => h('option', { value: f }, f)));
      draw();
    } catch (e) { clear(grid).append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano części: ' + e.message)); }
  }

  const stockLine = (t) => (t ? `Stan ${G.numberText(t.status || 0)} · Zapas ${G.numberText(t.stock || 0)} · Dostępne ${G.numberText(t.available || 0)}` : 'Brak w katalogu (stan nieznany)');
  function tile(p) {
    const t = p.tool, warn = t && String(t.partStatusColor || '').trim() && !/^#?fff(fff)?$/i.test(String(t.partStatusColor).trim());
    const bg = warn ? parseSheetColor(t.partStatusColor, '#ffffff') : '#f3f3f3';
    return h('div', { class: 'tool-tile click', onclick: () => detail(p), style: { minHeight: '0' } },
      h('div', { class: 'tile-head' }, h('div', { style: { flex: 1, padding: '4px 8px', fontWeight: 800, background: bg, color: warn ? contrast(bg) : '#000' } }, String(p.code).toUpperCase())),
      h('div', { style: { display: 'flex', justifyContent: 'center', padding: '4px', background: '#fff' } }, insertSvg(p.contour, { w: 200, hgt: 110, dims: true })),
      h('div', { style: { padding: '3px 8px', fontSize: '12px', borderTop: '1px solid #eee' } }, stockLine(t)),
      h('div', { class: 'muted', style: { padding: '0 8px 4px', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
        `W narzędziach (${p.uses.length}): ` + p.uses.map((u) => u.toolCode).join(', ')));
  }

  function detail(p) {
    const t = p.tool;
    const m = modal(String(p.code).toUpperCase(), h('div', {},
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '14px' } },
        h('div', { style: { border: '1px solid #ddd', borderRadius: '8px' } }, insertSvg(p.contour, { w: 380, hgt: 300, dims: true })),
        p.contour && G.parseInsertPath(p.contour).length >= 3 ? h('div', { style: { border: '1px solid #ddd', borderRadius: '8px', width: '380px', height: '300px' } }, view3d(null, [G.parseInsertPath(p.contour)])) : null,
        h('div', { style: { minWidth: '220px' } },
          t ? h('div', { style: { fontWeight: 600 } }, [t.columnP, t.name, t.columnO].filter((x) => String(x || '').trim()).join(' | ')) : null,
          h('div', { style: { margin: '6px 0' } }, stockLine(t)),
          h('div', { class: 'muted', style: { fontSize: '12px' } }, `Używana w narzędziach (${p.uses.length}):`),
          h('div', { style: { maxHeight: '180px', overflow: 'auto', fontSize: '13px' } }, ...p.uses.map((u) => h('div', {}, h('b', {}, u.toolCode), u.role === 'accessory' ? ' (akcesorium)' : ''))))),
      p.contour ? h('div', { style: { marginTop: '8px' } }, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Kontur (SVG, mm – arkusz PL_kontur, kolumna G):'),
        h('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f4f4f4', padding: '6px', fontSize: '11px', maxHeight: '120px', overflow: 'auto', userSelect: 'text' } }, p.contour)) : null,
      h('div', { class: 'actions' },
        p.contour ? h('button', { class: 'btn', onclick: async () => { try { await (window.zks.copyText ? window.zks.copyText(p.contour) : navigator.clipboard.writeText(p.contour)); toast('Skopiowano'); } catch (e) { toast(e.message, true); } } }, 'Kopiuj kontur') : null,
        h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }

  function draw() {
    const q = st.q.toLowerCase();
    const items = st.parts.filter((p) => (!st.onlyContour || p.contour) && (!q || p.code.toLowerCase().includes(q) || p.uses.some((u) => String(u.toolCode).toLowerCase().includes(q)))
      && (!st.company || String((p.tool && p.tool.columnP) || '').trim() === st.company));
    info.textContent = `Części: ${items.length} z ${st.parts.length} (z konturem: ${st.parts.filter((p) => p.contour).length})`;
    if (st.stopFill) st.stopFill();
    clear(grid);
    if (!items.length) grid.append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Brak części spełniających kryteria.'));
    st.stopFill = lazyFill(grid, items, tile, 120);
  }

  const search = h('input', { type: 'search', placeholder: 'Kod płytki albo narzędzia', style: { width: '220px', padding: '4px 8px' }, oninput: () => { st.q = search.value; draw(); } });
  const only = h('input', { type: 'checkbox', checked: true, onchange: () => { st.onlyContour = only.checked; draw(); } });
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Części – kontury płytek'), search, companySel, h('label', { class: 'row', style: { gap: '4px' } }, only, 'tylko z konturem'),
    h('span', { class: 'grow' }), info, h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), grid);
  load(false);
}
