// Płytki na narzędziu (Narzędziownia → Kontury → „Płytki…”): wybór rodzaju płytki (centralna na osi / obwodowa przy krawędzi), wiele płytek na jednym
// narzędziu i ich położenie (ΔX, ΔZ, obrót, kąt na obwodzie φ, liczba kopii). Układ zapisuje się dla narzędzia na tym komputerze;
// „Układ automatyczny” wraca do płytek z katalogu (pierwsza płytka wiertła ISCAR / AMEC – centralna).
import { h, clear, modal } from '../ui.js';
import { PLATE_MODES, normPlate, normPlates } from '../logic/plateLayout.js';

const comma = (v) => String(Math.round(v * 1000) / 1000).replace('.', ',');
const num = (t) => Number(String(t).replace(',', '.'));

/**
 * o: { tool (kod), plates: układ do edycji [{ code, mode, dx, dz, ang, phi, z }] (rozwiązany – także gdy automatyczny), custom (czy jest własny układ),
 *      allCodes (kody płytek do wyboru), toolCentral, onApply: (lista | null) => void, onEdit: (numer płytki) => void }.
 */
export function openPlateLayout(o) {
  let rows = (o.plates || []).map((p) => normPlate(p));
  const tbody = h('tbody', {});
  const toolCentral = !!o.toolCentral;
  const kind = (p, j) => (p.mode === 'irregular' ? 'nieregularna' : p.mode === 'central' || (p.mode === 'auto' && j === 0 && toolCentral) ? 'centralna' : 'obwodowa');
  const field = (j, key, w = '60px') => { const inp = h('input', { type: 'text', value: comma(rows[j][key]), style: { width: w, padding: '1px 4px' }, onchange: () => { const v = num(inp.value); if (!Number.isFinite(v)) { inp.value = comma(rows[j][key]); return; } rows[j] = normPlate({ ...rows[j], [key]: key === 'z' ? Math.round(v) : v }); inp.value = comma(rows[j][key]); } }); return inp; };
  function draw() {
    clear(tbody);
    rows.forEach((p, j) => {
      const code = h('select', { onchange: () => { rows[j] = normPlate({ ...rows[j], code: code.value }); } }, ...[...new Set([...(o.allCodes || []), p.code])].map((c) => h('option', { value: c, selected: c === p.code }, c)));
      const mode = h('select', { onchange: () => { rows[j] = normPlate({ ...rows[j], mode: mode.value }); draw(); } }, ...PLATE_MODES.map(([v, l]) => h('option', { value: v, selected: p.mode === v }, l)));
      tbody.append(h('tr', {}, h('td', {}, String(j + 1)), h('td', {}, code), h('td', {}, mode, h('div', { class: 'muted', style: { fontSize: '10px' } }, kind(p, j))),
        h('td', {}, field(j, 'dx')), h('td', {}, field(j, 'dz')), h('td', {}, field(j, 'ang')), h('td', {}, field(j, 'phi')), h('td', {}, field(j, 'z', '44px')),
        h('td', {}, h('button', { class: 'btn small', title: 'Zastosuj i otwórz pełny edytor tej płytki', onclick: () => { o.onApply(normPlates(rows)); m.close(); o.onEdit(j); } }, 'Edytor…'),
          h('button', { class: 'btn small', title: 'Usuń płytkę z narzędzia', onclick: () => { rows = rows.filter((_, k) => k !== j); draw(); } }, '✕'))));
    });
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'Brak płytek – dodaj płytkę albo wróć do układu automatycznego.')));
  }
  const add = () => { const used = new Set(rows.map((r) => r.code)), code = (o.allCodes || []).find((c) => !used.has(c)) || (o.allCodes || [])[0] || ''; if (!code) return; rows.push(normPlate({ code, mode: rows.length ? 'edge' : 'auto' })); draw(); };
  const m = modal(null, h('div', { class: 'fs-dialog', style: { minWidth: '760px' } },
    h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0, flex: 1 } }, `Płytki na narzędziu – ${o.tool}`), h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij')),
    h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' } }, 'Rodzaj: centralna – jedna płytka na osi narzędzia (wiertła ISCAR / AMEC), obwodowa – para przy krawędzi (frezy; w 3D z kopii co 360° / z), nieregularna – jedna płytka w dowolnym miejscu (np. Komet; start na osi, położenie ΔX / ΔZ / obrotem). '
      + 'ΔX, ΔZ w mm (ΔZ w górę wzdłuż osi), obrót płytki w °, φ – kąt pierwszej płytki na obwodzie narzędzia (3D), z – liczba kopii na obwodzie (0 – wg ustawienia narzędzia).'),
    h('div', { class: 'table-wrap', style: { maxHeight: '45vh' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Lp', 'Płytka (kod)', 'Rodzaj', 'ΔX', 'ΔZ', 'Obrót', 'φ', 'z', ''].map((t) => h('th', {}, t)))), tbody)),
    h('div', { class: 'row', style: { gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn', onclick: add, title: 'Dodaj kolejną płytkę (wiele płytek na narzędziu)' }, '+ Dodaj płytkę'),
      h('button', { class: 'btn', onclick: () => { rows = (o.autoPlates || []).map((p) => normPlate(p)); draw(); }, title: 'Płytki z katalogu narzędzia, bez własnych ustawień' }, 'Układ automatyczny'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => { o.onApply(normPlates(rows), rows.length === 0 || (o.autoPlates && sameAsAuto(rows, o.autoPlates))); m.close(); } }, 'Zastosuj'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'))), { wide: true, sticky: true });
  m.root.classList.add('fs');
  draw();
  return m;
}
/** Czy lista płytek jest identyczna z układem automatycznym (wtedy nie trzeba zapisywać własnego). */
function sameAsAuto(rows, auto) { return rows.length === auto.length && rows.every((r, i) => JSON.stringify(normPlate(r)) === JSON.stringify(normPlate(auto[i]))); }
