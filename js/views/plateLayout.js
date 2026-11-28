// Płytki na narzędziu (Narzędziownia → Kontury → „Płytki…”): panel po lewej stronie rysunku (nie zasłania rejonu kreślenia). Wybór rodzaju płytki
// (centralna na osi / obwodowa przy krawędzi / nieregularna), wiele płytek na jednym narzędziu i ich położenie (ΔX, ΔZ, obrót, kąt na obwodzie φ,
// liczba kopii). Każda zmiana w tabeli od razu zmienia kształt i położenie płytki na rysunku; wybrana płytka ma czerwony kontur.
// Układ zapisuje się dla narzędzia na tym komputerze; „Układ automatyczny” wraca do płytek z katalogu (pierwsza płytka wiertła ISCAR / AMEC – centralna).
import { h, clear } from '../ui.js';
import { PLATE_MODES, normPlate, normPlates, withManual } from '../logic/plateLayout.js';

const comma = (v) => String(Math.round(v * 1000) / 1000).replace('.', ',');
const num = (t) => Number(String(t).replace(',', '.'));

/**
 * o: { tool (kod), plates: układ do edycji [{ code, mode, dx, dz, ang, phi, z }] (rozwiązany – także gdy automatyczny), autoPlates (układ automatyczny),
 *      allCodes (kody płytek PRZYPISANYCH do narzędzia), toolCentral,
 *      onChange: (lista | null) => void – po każdej zmianie (null – układ automatyczny), onSelect: (numer | null) => void – wybór płytki (czerwony kontur),
 *      onEdit: (numer) => void – pełny edytor płytki, onClose: () => void }.
 * Wynik: element panelu z metodami sync(plates, selected) – odświeżenie po zmianie z zewnątrz (przeciągnięcie płytki, okienko danych) i select(j).
 */
export function mountPlateLayout(o) {
  let rows = (o.plates || []).map((p) => normPlate(p)), sel = null;
  const tbody = h('tbody', {});
  const toolCentral = !!o.toolCentral;
  const kind = (p, j) => (p.mode === 'irregular' ? 'nieregularna' : p.mode === 'central' || (p.mode === 'auto' && j === 0 && toolCentral) ? 'centralna' : 'obwodowa');
  /** Zmiana w tabeli: od razu na rysunek. */
  const apply = () => o.onChange(normPlates(rows));
  const choose = (j) => { sel = j; markSel(); o.onSelect(j); };
  const markSel = () => [...tbody.children].forEach((tr, k) => { tr.style.outline = k === sel ? '2px solid #e00000' : ''; tr.style.background = k === sel ? '#ffecec' : ''; });
  const off = () => (o.angOffset ? o.angOffset() : 0);
  const shown = (key, v) => (key === 'ang' && o.angOffset ? Math.round((v - off()) * 1000) / 1000 || 0 : v);   // frezy: kąt względem krawędzi skrawającej narzędzia (0° = krawędź płytki w jej linii)
  const field = (j, key, w = '44px') => {
    const inp = h('input', { type: 'text', value: comma(shown(key, rows[j][key])), style: { width: w, padding: '1px 3px' },
      onfocus: () => choose(j),
      oninput: () => { const v = num(inp.value); if (!Number.isFinite(v) || inp.value.trim() === '') return; rows[j] = normPlate(withManual(rows[j], key === 'ang' && o.angOffset ? { ang: v + off(), angRel: v } : { [key]: key === 'z' ? Math.round(v) : v })); apply(); },
      onchange: () => { const v = num(inp.value); if (!Number.isFinite(v)) inp.value = comma(shown(key, rows[j][key])); } });
    return inp;
  };
  function draw() {
    clear(tbody);
    rows.forEach((p, j) => {
      const code = h('select', { style: { width: '62px' }, onfocus: () => choose(j), onchange: () => { rows[j] = normPlate({ ...rows[j], code: code.value }); apply(); } },
        ...[...new Set([...(o.allCodes || []), p.code])].map((c) => h('option', { value: c, selected: c === p.code }, c)));
      const mode = h('select', { style: { width: '104px', fontSize: '11px' }, onfocus: () => choose(j), onchange: () => { rows[j] = normPlate({ ...rows[j], mode: mode.value }); apply(); draw(); } }, ...PLATE_MODES.map(([v, l]) => h('option', { value: v, selected: p.mode === v }, l)));
      tbody.append(h('tr', { onclick: () => choose(j) }, h('td', {}, String(j + 1)), h('td', {}, code), h('td', {}, mode, h('div', { class: 'muted', style: { fontSize: '10px' } }, kind(p, j))),
        h('td', {}, field(j, 'dx')), h('td', {}, field(j, 'dz')), h('td', {}, field(j, 'ang')), h('td', {}, field(j, 'phi')), h('td', {}, field(j, 'z', '32px')),
        h('td', { style: { whiteSpace: 'nowrap' } }, h('button', { class: 'btn small', title: 'Pełny edytor tej płytki', onclick: (e) => { e.stopPropagation(); o.onEdit(j); } }, '✎'),
          h('button', { class: 'btn small', title: 'Usuń płytkę z narzędzia', onclick: (e) => { e.stopPropagation(); rows = rows.filter((_, k) => k !== j); sel = null; o.onSelect(null); apply(); draw(); } }, '✕'))));
    });
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'Brak płytek – dodaj płytkę albo wróć do układu automatycznego.')));
    markSel();
    refreshG();
    pivotBtn.style.display = o.onPivot && (!o.canPivot || o.canPivot()) && rows.length > 1 ? '' : 'none';
  }
  const add = () => { const used = new Set(rows.map((r) => r.code)), code = (o.allCodes || []).find((c) => !used.has(c)) || (o.allCodes || [])[0] || ''; if (!code) return; rows.push(normPlate({ code, mode: rows.length ? 'edge' : 'auto' })); apply(); draw(); choose(rows.length - 1); };
  const pivotBtn = h('button', { class: 'btn small', title: 'Punkt, wokół którego obraca się cała grupa płytek (kąt skrawania): wybierany spośród punktów wszystkich płytek i czterech skrajnych punktów grupy', onclick: () => o.onPivot && o.onPivot() }, '⊕ Punkt obrotu grupy…');
  const gx = h('input', { type: 'text', style: { width: '62px', padding: '1px 3px' }, title: 'X punktu obrotu grupy od osi narzędzia, mm' }), gz = h('input', { type: 'text', style: { width: '62px', padding: '1px 3px' }, title: 'Z punktu obrotu grupy od Z = 0, mm' });
  const gRow = h('div', { class: 'row', style: { gap: '4px', alignItems: 'center', flexWrap: 'wrap', display: 'none' } }, h('span', { title: 'Wpisz, gdzie ma leżeć czerwony punkt obrotu grupy – cała grupa płytek przesunie się razem. Można też przeciągnąć czerwony punkt na rysunku albo płytkę z klawiszem Shift.' }, 'Przesuń grupę – punkt obrotu: X'), gx, 'Z', gz, h('span', { class: 'muted' }, 'mm'));
  const applyG = () => { const x = num(gx.value), z = num(gz.value); if (Number.isFinite(x) && Number.isFinite(z) && o.setPivotPos) o.setPivotPos(x, z); };
  gx.onchange = applyG; gz.onchange = applyG;
  const refreshG = () => {
    const p = o.pivotPos && o.pivotPos(), show = !!p && o.onPivot && (!o.canPivot || o.canPivot()) && rows.length > 1;
    gRow.style.display = show ? '' : 'none';
    if (show && document.activeElement !== gx && document.activeElement !== gz) { gx.value = comma(p.x); gz.value = comma(p.z); }
  };
  const root = h('div', { class: 'plate-panel', style: { width: '520px', flex: 'none', display: 'flex', flexDirection: 'column', gap: '6px', background: '#fff', border: '1px solid #c8a400', padding: '6px 8px', fontSize: '12px', overflow: 'auto', minHeight: 0 } },
    h('style', {}, '.plate-panel th, .plate-panel td { padding: 2px 3px !important; } .plate-panel .btn.small { padding: 1px 5px; }'),
    h('div', { class: 'row' }, h('b', { style: { flex: 1 } }, `Płytki – ${o.tool}`), h('button', { class: 'btn small', onclick: () => o.onClose() }, 'Zamknij')),
    h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Do wyboru tylko płytki przypisane do narzędzia. Rodzaj: centralna – jedna na osi (wiertła ISCAR / AMEC), obwodowa – para przy krawędzi, nieregularna – jedna w dowolnym miejscu (np. Komet). '
      + 'ΔX, ΔZ w mm (ΔZ w górę osi), obrót w ° (frezy: kąt względem krawędzi skrawającej narzędzia, 0° = krawędź płytki w jej linii), φ – kąt pierwszej płytki na obwodzie (3D), z – liczba kopii (0 – wg narzędzia). Grupa płytek w rzędach (jeż, frez płytkowy) obraca się wokół czerwonego punktu na rysunku – punktu bazowego pierwszej płytki. Zmiany widać od razu na rysunku; wybrana płytka ma czerwony kontur.'),
    gRow,
    h('div', { class: 'table-wrap', style: { overflow: 'auto' } }, h('table', { class: 't', style: { width: 'auto', fontSize: '11px' } }, h('thead', {}, h('tr', {}, ...['Lp', 'Płytka', 'Rodzaj', 'ΔX', 'ΔZ', o.angOffset ? 'Kąt' : 'Obrót', 'φ', 'z', ''].map((t) => h('th', {}, t)))), tbody)),
    h('div', { class: 'row', style: { gap: '6px' } },
      h('button', { class: 'btn small', onclick: add, title: 'Dodaj kolejną płytkę (wiele płytek na narzędziu)' }, '+ Dodaj płytkę'),
      pivotBtn,
      h('button', { class: 'btn small', onclick: () => { rows = (o.autoPlates || []).map((p) => normPlate(p)); sel = null; o.onSelect(null); o.onChange(null); draw(); }, title: 'Płytki z katalogu narzędzia, bez własnych ustawień' }, 'Układ automatyczny')));
  /** Odświeżenie z zewnątrz (nie przeszkadza w pisaniu w tabeli). */
  root.sync = (plates, selected) => {
    sel = selected == null ? null : selected;
    refreshG();
    const next = (plates || []).map((p) => normPlate(p));
    if (JSON.stringify(next) !== JSON.stringify(rows) && !root.contains(document.activeElement)) { rows = next; draw(); } else markSel();
  };
  root.select = (j) => { sel = j; markSel(); };
  draw();
  return root;
}
