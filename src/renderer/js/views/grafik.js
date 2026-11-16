// Grafik z Firebase: kody zmian i nieobecności pracowników na każdy dzień, na żywo u wszystkich. Kolory, „UT=”, urlopy, godziny
// i nieobecności liczone w programie tak jak w karcie G arkusza (logic/grafikFb.js). Obsługa jak w Excelu: klik / Shift / przeciąganie
// – zaznaczenie, strzałki, Tab, Enter, pisanie w komórce, F2 / dwuklik, Delete, Ctrl+C / Ctrl+V (zgodne z Excelem), Ctrl+Z / Ctrl+Y.
// Komentarz do komórki: prawy przycisk → „Komentarz…” (znaczek w rogu komórki, treść po najechaniu). Każda zmiana zapisuje się od razu
// w bazie, a w okresie przejściowym także w karcie G (graf_norm, wersja webowa).
import { h, clear, toast, modal, confirmBox, columnFilterDialog } from '../ui.js';
import * as F from '../logic/grafikFb.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { iconSvg } from './harmIcons.js';
import { watchGrafik, saveCells, saveMeta, importFromSheet } from '../grafikStore.js';
import { mountGrafikSheet } from './grafikSheet.js';
import { stationList } from '../logic/harmModel.js';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci */ } };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const plDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const sheetDate = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;   // format nagłówka karty G
const MON3 = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const WD = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so'];

// Filtry i sortowanie zapamiętane na tym komputerze (jak w Harmonogramie): wartości filtra jako listy
function loadFilters() {
  const saved = lsGet('grafik.filters', {}) || {};
  const filters = {};
  for (const [k, v] of Object.entries(saved.filters || {})) if (Array.isArray(v)) filters[k] = new Set(v);
  return { filters, sorts: Array.isArray(saved.sorts) ? saved.sorts.filter((x) => x && x.key) : [] };
}
const saveFilters = (st) => lsSet('grafik.filters', { filters: Object.fromEntries(Object.entries(st.filters).map(([k, v]) => [k, [...v]])), sorts: st.sorts });

export function mountGrafik(el, ctx) {
  const canWrite = ctx.level('grafik') === 'write';
  const today = () => isoOf(new Date());
  const st = {
    from: addDays(today(), -3), to: addDays(today(), 7), meta: null, months: {}, codes: {}, notes: {}, sel: null, editing: null,
    filters: {}, sorts: [], ...loadFilters(), zoom: lsGet('grafik.zoom', 100), groups: { ut: true, hours: false, abs: false, ...lsGet('grafik.groups', {}) }, undo: [], redo: [], watcher: null, ready: false, cfg: null,
  };
  const body = h('div', { tabindex: '0', class: 'gr', style: { flex: 1, minHeight: 0, overflow: 'auto', outline: 'none', background: '#fff', position: 'relative' } });
  const info = h('span', { class: 'muted' });
  const fromIn = h('input', { type: 'date', value: st.from, onchange: () => setRange(fromIn.value, toIn.value) });
  const toIn = h('input', { type: 'date', value: st.to, onchange: () => setRange(fromIn.value, toIn.value) });
  const zoomLabel = h('button', { class: 'btn small', title: 'Kliknij: 100%', onclick: () => setZoom(100) }, '100%');
  // grupy kolumn jak w karcie G: urlopy (AP–AT, C, D), godziny w miesiącach (AD–AO), absencje (AU–BE)
  const groupBtns = [['ut', 'Urlopy', 'Kolumny urlopów: plan, UT z lat, wykorzystane, zaplanowane, dostępny, pozostały'], ['hours', 'Godziny', 'Godziny przepracowane w każdym miesiącu'], ['abs', 'Absencje', 'Liczba nieobecności: NŻ, v, L4, OP, Ojc, OKL, HDK, BO, BHP, SZ, Sł']]
    .map(([k, label, title]) => { const b = h('button', { class: 'btn small', title, onclick: () => { st.groups[k] = !st.groups[k]; lsSet('grafik.groups', st.groups); draw(); } }, label); b.dataset.g = k; return b; });

  // ---------- dane na żywo ----------
  const neededMonths = () => [...new Set([...F.monthsBetween(st.from, st.to), ...F.monthsBetween(`${st.to.slice(0, 4)}-01-01`, `${st.to.slice(0, 4)}-12-31`)])];
  async function start() {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie grafiku…'));
    try {
      st.watcher = await watchGrafik(neededMonths(), ({ meta, months, cfg }) => {
        st.meta = meta; st.months = months; st.cfg = cfg || null; const u = F.unpackMonths(months); st.codes = u.codes; st.notes = u.notes; st.ready = true; draw();
      }, (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy Grafiku: ' + (e.code === 'permission-denied' ? 'brak uprawnień (opublikuj reguły Firestore: gr_days, gr_meta)' : e.message || e)), sheetBtn()); });
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message || String(e)), sheetBtn()); }
  }
  const sheetBtn = () => h('button', { class: 'btn', style: { margin: '0 12px' }, onclick: openSheet }, 'Grafik z arkusza (dawny)');
  function setRange(a, b) {
    if (!a || !b) return;
    if (b < a) [a, b] = [b, a];
    st.from = a; st.to = b; fromIn.value = a; toIn.value = b; st.sel = null;
    if (st.watcher) st.watcher.setMonths(neededMonths());
    draw();
  }
  const preset = (label, fn, title) => h('button', { class: 'btn small', title, onclick: () => { const [a, b] = fn(today()); setRange(a, b); } }, label);

  // ---------- model ekranu ----------
  const people = () => ((st.meta && st.meta.people) || []);
  // święta: wspólna lista programu (Ustawienia, config/main) + daty z karty i (import)
  const holidays = () => new Set([...((st.cfg && st.cfg.holidays) || []).map((x) => (typeof x === 'string' ? x : x && x.date)), ...((st.meta && st.meta.holidays) || [])]);
  const stations = () => stationList(st.cfg);
  const code = (pid, iso) => ((st.codes[pid] || {})[iso] ?? '');
  const note = (pid, iso) => ((st.notes[pid] || {})[iso] ?? '');
  const year = () => st.to.slice(0, 4);
  const summaries = () => { const m = new Map(), t = today(); for (const p of people()) if (!p.sep) m.set(p.id, F.personSummary(p, st.codes[p.id] || {}, year(), t)); return m; };
  const dates = () => F.daysBetween(st.from, st.to);
  const columns = (g = st.groups) => {
    const y = year();
    return [
      { key: 'name', title: 'Pracownik', w: 170 }, { key: 'place', title: 'Miejsce', w: 52 },
      ...(g.ut ? [
        { key: 's:plan', title: 'Plan', full: `Plan urlopu ${y} (suma miesięcy)`, sum: 'planned' },
        { key: 's:prev', title: `UT ${Number(y) - 1}`, full: `Urlop z ${Number(y) - 1} (wpisywany ręcznie – kliknij i wpisz)`, edit: 'prev' },
        { key: 's:cur', title: `UT ${y}`, full: `Urlop ${y} (wpisywany ręcznie – kliknij i wpisz)`, edit: 'cur' },
        { key: 's:used', title: 'Wykorz.', full: 'Wykorzystane do dziś (UT + NŻ)', sum: 'used' },
        { key: 's:fut', title: 'Zaplan.', full: 'Zaplanowane (UT po dziś)', sum: 'future' },
        { key: 's:avail', title: 'Dostęp.', full: 'UT dostępny (poprzedni + bieżący − wykorzystany)', sum: 'available' },
        { key: 's:rem', title: 'Pozost.', full: 'UT pozostały (dostępny − zaplanowany)', sum: 'remaining' }] : []),
      ...(g.hours ? [...MON3.map((m, i) => ({ key: 'h:' + i, title: m, full: `Godziny przepracowane – ${F.MONTHS[i]} ${y}`, hours: i })), { key: 'h:sum', title: 'Razem', full: `Godziny ${y} razem`, hours: 'sum', w: 50 }] : []),
      ...(g.abs ? F.ABSENCES.map(([k, label]) => ({ key: 'a:' + k, title: k, full: `${label} (${k}) – liczba dni w ${y}`, abs: k, w: 38 })) : []),
      ...dates().map((iso) => ({ key: 'd:' + iso, iso, title: iso })),
    ];
  };
  let sums = new Map();
  const value = (p, col) => {
    if (col.key === 'name') return p.name;
    if (col.key === 'place') return p.place || '';
    const s = sums.get(p.id);
    if (col.edit) { const ut = (p.ut || {})[year()] || {}; return String(Number(ut[col.edit]) || 0); }
    if (col.sum) return s ? String(s[col.sum]) : '';
    if (col.hours !== undefined) { if (!s) return ''; const v = col.hours === 'sum' ? s.hoursToMonth[11] : s.hoursByMonth[col.hours]; return v ? String(v) : ''; }
    if (col.abs) { const v = s ? s.absences[col.abs] : 0; return v ? String(v) : ''; }
    return code(p.id, col.iso);
  };

  // ---------- rysowanie ----------
  let grid = [], cols = [], rows = [];
  function draw() {
    if (!st.ready) return;
    for (const b of groupBtns) b.className = 'btn small' + (st.groups[b.dataset.g] ? ' primary' : '');
    if (!st.meta) {
      clear(body);
      body.append(h('div', { style: { padding: '14px' } }, h('p', {}, 'Grafiku nie ma jeszcze w bazie.'),
        canWrite ? h('button', { class: 'btn primary', onclick: doImport }, 'Import z arkusza G') : h('p', { class: 'muted' }, 'Import robi osoba z prawem zapisu w Grafiku.'), ' ', sheetBtn()));
      return;
    }
    sums = summaries();
    cols = columns();
    // filtry i sortowanie działają też na kolumnach ukrytych grup (jak ukryte kolumny w Harmonogramie)
    const fcols = columns({ ut: true, hours: true, abs: true });
    for (const k of Object.keys(st.filters)) if (!fcols.some((c) => c.key === k)) delete st.filters[k];
    st.sorts = st.sorts.filter((x) => fcols.some((c) => c.key === x.key));
    const getV = (pid, c) => { const p = people().find((x) => x.id === pid); return p ? value(p, c) : ''; };
    const all = people().filter((p) => !p.sep).map((p) => p.id);
    const filtered = visibleRows(all, fcols, st.filters, getV);
    const sorted = st.sorts.length ? sortRows(filtered, fcols, st.sorts, getV) : filtered;
    // separatory zostają w swoim miejscu, gdy nie ma sortowania (grupy jak w arkuszu)
    rows = st.sorts.length ? sorted.map((id) => people().find((p) => p.id === id)) : people().filter((p) => p.sep ? !Object.keys(st.filters).length : sorted.includes(p.id));
    const hol = holidays(), t = today(), hour = new Date().getHours(), labels = Object.fromEntries(st.sorts.map((x) => [x.key, sortLabel(x.key)])), stList = stations();
    const sy = body.scrollTop, sx = body.scrollLeft;
    clear(body);
    const z = st.zoom / 100;
    const table = h('table', { class: 't', style: { fontSize: 13 * z + 'px', borderCollapse: 'separate', borderSpacing: 0 } });
    const fixed = FIXED;
    const widths = cols.map((c) => Math.round((c.w || 46) * z));
    const leftOf = (i) => widths.slice(0, i).reduce((a, b) => a + b, 0);
    const weekH = Math.round(17 * z);
    // nagłówek: wiersz tygodni (ISO) nad datami, pod nim daty w pionie „dd-mm-rrrr” jak w karcie G
    const headM = h('tr', {}), head1 = h('tr', {}), head2 = h('tr', {});
    const thBase = { position: 'sticky', cursor: 'pointer', padding: '2px 3px', fontWeight: 700, borderRight: '1px solid #999', borderBottom: '1px solid #999' };
    cols.forEach((c, i) => {
      if (c.iso) return;
      const filt = !!st.filters[c.key];
      headM.append(h('th', { rowspan: 3, title: (c.full || c.title) + '. Kliknij: filtr i sortowanie', onclick: () => openFilter(c),
        style: { ...thBase, top: 0, zIndex: i < fixed ? 5 : 3, background: filt ? '#ffb74d' : c.edit ? '#fff2cc' : '#e4e4e4', color: '#000', whiteSpace: 'normal', lineHeight: 1.1,
          fontSize: (i >= 2 ? 11 : 12) * z + 'px', minWidth: widths[i] + 'px', maxWidth: widths[i] + 'px', ...(i < fixed ? { left: leftOf(i) + 'px' } : {}) } },
      c.title + (filt ? ' ▼' : '') + (labels[c.key] ? ' ' + labels[c.key] : '')));
    });
    const dcols = cols.filter((c) => c.iso);
    // wiersz miesięcy nad tygodniami
    for (let i = 0; i < dcols.length;) {
      const mk = dcols[i].iso.slice(0, 7); let n = 1;
      while (i + n < dcols.length && dcols[i + n].iso.slice(0, 7) === mk) n++;
      const mi = Number(mk.slice(5, 7)) - 1, label = `${F.MONTHS[mi]} ${mk.slice(0, 4)}`;
      headM.append(h('th', { colspan: n, title: label, style: { ...thBase, cursor: 'default', top: 0, zIndex: 3, height: weekH + 'px', padding: '0 4px', fontSize: 11 * z + 'px', textAlign: 'left',
        background: mi % 2 ? '#fce4d6' : '#fff2cc', color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: n * 34 * z + 'px' } }, n >= 3 ? label : n === 2 ? MON3[mi] : MON3[mi].slice(0, 1)));
      i += n;
    }
    for (let i = 0; i < dcols.length;) {
      const wk = F.isoWeek(dcols[i].iso); let n = 1;
      while (i + n < dcols.length && F.isoWeek(dcols[i + n].iso) === wk) n++;
      head1.append(h('th', { colspan: n, title: `Tydzień ${wk} (ISO)`, style: { ...thBase, cursor: 'default', top: weekH + 'px', zIndex: 3, height: weekH + 'px', padding: '0 2px', fontSize: 11 * z + 'px', background: wk % 2 ? '#d9e1f2' : '#eef2f9', color: '#000', whiteSpace: 'nowrap' } },
        n >= 2 ? `tydz. ${wk}` : String(wk)));
      i += n;
    }
    for (const c of dcols) {
      const hs = F.headerStyle(c.iso, hol.has(c.iso)), filt = !!st.filters[c.key], wd = WD[new Date(c.iso + 'T00:00:00Z').getUTCDay()];
      head2.append(h('th', { title: `${sheetDate(c.iso)} (${wd}), tydzień ${F.isoWeek(c.iso)}. Kliknij: filtr i sortowanie`, onclick: () => openFilter(c),
        style: { ...thBase, top: 2 * weekH + 'px', zIndex: 3, padding: '3px 0', minWidth: 34 * z + 'px', fontSize: 11 * z + 'px', fontWeight: 400,
          background: filt ? '#ffb74d' : c.iso === t ? '#00b050' : hs.bg, color: filt || c.iso === t ? '#000' : hs.color } },
      h('div', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', margin: '0 auto', lineHeight: 1 } }, sheetDate(c.iso) + (filt ? ' ▼' : '') + (labels[c.key] ? ' ' + labels[c.key] : ''))));
    }
    const tbody = h('tbody', {});
    grid = [];
    rows.forEach((p, ri) => {
      const tr = h('tr', {});
      if (p.sep) {
        tr.append(h('td', { colspan: cols.length, style: { background: '#444', color: '#fff', height: 6 * z + 'px', padding: 0, fontSize: '1px' } }, ''));
        tbody.append(tr); grid.push(null); return;
      }
      const s = sums.get(p.id);
      grid.push(p);
      cols.forEach((c, ci) => {
        const fixedCell = ci < fixed;
        let txt = value(p, c), style = { borderRight: '1px solid #c8c8c8', borderBottom: '1px solid #c8c8c8', padding: '1px 4px', whiteSpace: 'nowrap', textAlign: c.key === 'name' ? 'left' : 'center' };
        if (c.key === 'name') { txt = F.displayName(p, s ? s.remaining : 0); style = { ...style, fontWeight: 600 }; }
        if (c.key === 'place') { const stn = F.placeStation(p.place, stList); if (stn) style = { ...style, background: stn.bg, color: stn.color, fontWeight: 700 }; }
        if (c.sum === 'remaining' || c.sum === 'available') { if (Number(txt) < 0) style.background = '#ff0000'; }
        if (c.edit) style = { ...style, background: '#fffbe6', cursor: canWrite ? 'cell' : 'default' };
        if (c.hours !== undefined) style = { ...style, background: '#e2efda' };
        if (c.abs) style = { ...style, color: txt ? '#000' : '#999' };
        if (c.iso) {
          const cs = F.cellStyle(txt, c.iso, { todayIso: t, hour, holiday: hol.has(c.iso), utNegative: s && s.remaining < 0 });
          style = { ...style, background: cs.bg, color: cs.color, fontWeight: cs.bold ? 700 : 400, fontStyle: cs.italic ? 'italic' : 'normal', position: 'relative', cursor: canWrite ? 'cell' : 'default' };
        }
        if (fixedCell) style = { ...style, position: 'sticky', left: leftOf(ci) + 'px', zIndex: 2, background: style.background || '#fff', overflow: 'hidden', textOverflow: 'ellipsis' };
        if (!c.iso) style = { ...style, minWidth: widths[ci] + 'px', maxWidth: widths[ci] + 'px' };
        const td = h('td', { style, 'data-r': ri, 'data-c': ci }, txt);
        const n = c.iso ? note(p.id, c.iso) : '';
        if (n) { td.title = 'Komentarz: ' + n; td.append(h('span', { style: { position: 'absolute', right: 0, top: 0, width: 0, height: 0, borderTop: '7px solid #ff6d00', borderLeft: '7px solid transparent' } })); }
        if (c.key === 'name') td.title = `${p.name}${p.nr ? ' · ' + p.nr : ''}. Dwuklik / prawy przycisk: podsumowanie urlopów i godzin`;
        if (c.key === 'place') { const stn = F.placeStation(p.place, stList); td.title = stn ? `Stanowisko ${stn.name} (kolor jak w Harmonogramie)` : 'Miejsce pracy bez stanowiska w Harmonogramie'; }
        if (c.hours !== undefined && typeof c.hours === 'number' && s) td.title = `${F.MONTHS[c.hours]}: ${s.hoursByMonth[c.hours]} h · narastająco do końca miesiąca: ${s.hoursToMonth[c.hours]} h`;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(h('thead', {}, headM, head1, head2), tbody);
    body.append(table);
    body.scrollTop = sy; body.scrollLeft = sx;
    paintSel();
    info.textContent = `Pracowników: ${grid.filter(Boolean).length}` + (canWrite ? '' : ' · tylko odczyt') + ' · zmiany zapisują się od razu' + (Object.keys(st.filters).length ? ` · filtry: ${Object.keys(st.filters).length}` : '') + (st.undo.length ? ` · cofnij: ${st.undo.length}` : '');
  }

  // ---------- zaznaczenie i klawiatura (jak w Excelu) ----------
  const FIXED = 2;   // przyklejone kolumny: pracownik i miejsce
  const fixedCount = () => Math.max(FIXED, cols.findIndex((c) => c.iso));
  const cellEl = (r, c) => body.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  function paintSel() {
    body.querySelectorAll('td.gsel').forEach((td) => { td.classList.remove('gsel'); td.style.outline = ''; td.style.boxShadow = ''; });
    if (!st.sel) return;
    const { r0, c0, r1, c1 } = st.sel, ra = Math.min(r0, r1), rb = Math.max(r0, r1), ca = Math.min(c0, c1), cb = Math.max(c0, c1);
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) { const td = cellEl(r, c); if (td) { td.classList.add('gsel'); td.style.boxShadow = 'inset 0 0 0 999px rgba(26,115,232,.18)'; } }
    const a = cellEl(r1, c1); if (a) { a.style.outline = '2px solid #0b57d0'; a.style.outlineOffset = '-2px'; a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  const dataRow = (r, d) => { let x = r + d; while (x >= 0 && x < grid.length && !grid[x]) x += d > 0 ? 1 : -1; return x >= 0 && x < grid.length && grid[x] ? x : r; };
  function setSel(r, c, extend) {
    if (!grid.length) return;
    c = Math.max(0, Math.min(cols.length - 1, c));
    if (r < 0 || r >= grid.length || !grid[r]) return;
    st.sel = extend && st.sel ? { ...st.sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c };
    paintSel();
  }
  const posOf = (e) => { const td = e.target.closest && e.target.closest('td[data-r]'); return td ? { r: +td.dataset.r, c: +td.dataset.c } : null; };
  let dragging = false;
  body.addEventListener('mousedown', (e) => {
    if (st.editing) return;
    const p = posOf(e); if (!p || e.button !== 0) return;
    e.preventDefault(); body.focus(); setSel(p.r, p.c, e.shiftKey); dragging = true;
  });
  body.addEventListener('mousemove', (e) => { if (!dragging || !(e.buttons & 1)) { dragging = false; return; } const p = posOf(e); if (p && st.sel && (p.r !== st.sel.r1 || p.c !== st.sel.c1) && grid[p.r]) { st.sel = { ...st.sel, r1: p.r, c1: p.c }; paintSel(); } });
  body.addEventListener('dblclick', (e) => { const p = posOf(e); if (!p) return; setSel(p.r, p.c); if (cols[p.c].key === 'name') personDialog(grid[p.r]); else beginEdit(null); });
  body.addEventListener('contextmenu', (e) => { const p = posOf(e); if (!p) return; e.preventDefault(); setSel(p.r, p.c); contextMenu(e, p); });
  body.addEventListener('keydown', (e) => {
    if (st.editing || !st.meta) return;
    const ctrl = e.ctrlKey || e.metaKey, s = st.sel;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(st.undo, st.redo); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); undoRedo(st.redo, st.undo); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); st.sel = { r0: 0, c0: fixedCount(), r1: grid.length - 1, c1: cols.length - 1 }; paintSel(); return; }
    if (!s) { if (e.key.startsWith('Arrow')) { e.preventDefault(); setSel(dataRow(-1, 1), fixedCount()); } return; }
    const mv = (dr, dc, ext) => { e.preventDefault(); setSel(dr ? dataRow(s.r1, dr) : s.r1, s.c1 + dc, ext); };
    switch (e.key) {
      case 'ArrowDown': return mv(1, 0, e.shiftKey);
      case 'ArrowUp': return mv(-1, 0, e.shiftKey);
      case 'ArrowRight': return mv(0, 1, e.shiftKey);
      case 'ArrowLeft': return mv(0, -1, e.shiftKey);
      case 'Tab': return mv(0, e.shiftKey ? -1 : 1, false);
      case 'Enter': return mv(e.shiftKey ? -1 : 1, 0, false);
      case 'Home': e.preventDefault(); return setSel(s.r1, fixedCount(), e.shiftKey);
      case 'End': e.preventDefault(); return setSel(s.r1, cols.length - 1, e.shiftKey);
      case 'F2': e.preventDefault(); return beginEdit(null);
      case 'Delete': case 'Backspace': e.preventDefault(); return clearSel();
      default: if (!ctrl && !e.altKey && e.key.length === 1) { e.preventDefault(); beginEdit(e.key); }
    }
  });
  const selCells = () => { const { r0, c0, r1, c1 } = st.sel, out = []; for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) { if (!grid[r]) continue; for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (cols[c].iso) out.push({ p: grid[r], iso: cols[c].iso }); } return out; };

  // ---------- zapis (od razu do bazy), cofanie ----------
  async function apply(items, label) {
    if (!canWrite) { toast('Grafik: tylko odczyt (prawo zapisu ustawia administrator w zakładce Uzytkownicy, kolumna „Grafik”)'); return; }
    const changes = [], before = [];
    for (const it of items) {
      const ch = { pid: it.p.id, iso: it.iso };
      if (it.code !== undefined) { const v = F.cleanCode(it.code); if (v === code(it.p.id, it.iso)) continue; ch.code = v; }
      if (it.note !== undefined) { if (it.note === note(it.p.id, it.iso)) continue; ch.note = it.note; }
      if (ch.code === undefined && ch.note === undefined) continue;
      before.push({ pid: ch.pid, iso: ch.iso, ...(ch.code !== undefined ? { code: code(ch.pid, ch.iso) } : {}), ...(ch.note !== undefined ? { note: note(ch.pid, ch.iso) } : {}) });
      changes.push(ch);
    }
    if (!changes.length) return;
    try {
      const rowsMap = Object.fromEntries(people().filter((p) => p.row).map((p) => [p.id, p.row]));
      const r = await saveCells(changes, rowsMap);
      st.undo.push({ label, before, after: changes }); if (st.undo.length > 100) st.undo.shift(); st.redo = [];
      if (r.sheet) r.sheet.then((x) => { if (x && x.error) toast('Zapisano w bazie, ale nie w karcie G: ' + x.error, true); });
    } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
  }
  async function undoRedo(from, to) {
    const step = from.pop(); if (!step) return;
    const rowsMap = Object.fromEntries(people().filter((p) => p.row).map((p) => [p.id, p.row]));
    try { await saveCells(from === st.undo ? step.before : step.after, rowsMap); to.push(step); toast((from === st.undo ? 'Cofnięto: ' : 'Ponowiono: ') + step.label); }
    catch (e) { from.push(step); toast('Nie zapisano: ' + (e.message || e), true); }
  }
  /** Urlop z poprzedniego / bieżącego roku wpisany w tabeli (kolumny „UT rrrr”) – zapis w danych pracownika. */
  async function saveUt(p, field, text) {
    const n = Number(String(text).replace(',', '.').trim() || 0);
    if (!Number.isFinite(n)) { toast('Wpisz liczbę dni urlopu'); return; }
    const y = year(), cur = (p.ut || {})[y] || {};
    if ((Number(cur[field]) || 0) === n) return;
    const list = people().map((x) => x.id !== p.id ? x : { ...x, ut: { ...(x.ut || {}), [y]: { prev: 0, cur: 0, plan: [], ...cur, [field]: n } } });
    try { await saveMeta({ people: list }); toast(`${p.name}: UT ${field === 'prev' ? Number(y) - 1 : y} = ${n}`); } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
  }
  function clearSel() { const items = selCells().filter((x) => code(x.p.id, x.iso) !== '').map((x) => ({ ...x, code: '' })); if (items.length) apply(items, `Wyczyszczenie: ${items.length}`); }

  // ---------- edycja w komórce ----------
  function beginEdit(typed) {
    if (!st.sel) return;
    const c = cols[st.sel.c1], p = grid[st.sel.r1];
    if (!p) return;
    if (c.key === 'name') { personDialog(p); return; }
    if (!c.iso && !c.edit) return;
    if (!canWrite) { toast('Grafik: tylko odczyt'); return; }
    const td = cellEl(st.sel.r1, st.sel.c1); if (!td) return;
    const r = td.getBoundingClientRect(), b = body.getBoundingClientRect();
    const input = h('input', { value: typed != null ? typed : c.edit ? value(p, c) : code(p.id, c.iso), style: { position: 'absolute', zIndex: 10, left: r.left - b.left + body.scrollLeft + 'px', top: r.top - b.top + body.scrollTop + 'px', width: Math.max(r.width, 70) + 'px', height: r.height + 'px', boxSizing: 'border-box', border: '2px solid #0b57d0', font: 'inherit', padding: '0 3px' } });
    st.editing = input; body.append(input); input.focus();
    if (typed == null) input.select();
    const finish = (commit, move) => {
      if (st.editing !== input) return;
      st.editing = null; const v = input.value; input.remove(); body.focus();
      if (commit) { if (c.edit) saveUt(p, c.edit, v); else apply([{ p, iso: c.iso, code: v }], `${p.name} ${plDate(c.iso)}`); }
      if (move) move();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); finish(true, () => setSel(dataRow(st.sel.r1, e.shiftKey ? -1 : 1), st.sel.c1)); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, () => setSel(st.sel.r1, st.sel.c1 + (e.shiftKey ? -1 : 1))); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---------- schowek (zgodny z Excelem) ----------
  const tsvCell = (t) => { const s = String(t ?? ''); return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function parseTsv(text) {
    const s = String(text ?? '').replace(/\r\n?/g, '\n'), out = []; let row = [], cell = '', q = false, start = true;
    for (let i = 0; i < s.length; i++) { const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && start) { q = true; start = false; continue; }
      if (ch === '\t') { row.push(cell); cell = ''; start = true; continue; }
      if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; start = true; continue; }
      cell += ch; start = false; }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out;
  }
  const active = () => { if (!el.isConnected) { cleanup(); return false; } return document.activeElement === body && st.sel && !st.editing; };
  function onCopy(e) {
    if (!active()) return; e.preventDefault();
    const { r0, c0, r1, c1 } = st.sel, out = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) { if (!grid[r]) continue; const row = []; for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) row.push(value(grid[r], cols[c])); out.push(row.map(tsvCell).join('\t')); }
    e.clipboardData.setData('text/plain', out.join('\r\n'));
  }
  function onCut(e) { if (!active()) return; onCopy(e); clearSel(); }
  function onPaste(e) {
    if (!active()) return; e.preventDefault();
    const data = parseTsv(e.clipboardData.getData('text/plain')); if (!data.length) return;
    const { r0, c0, r1, c1 } = st.sel, items = [];
    if (data.length === 1 && data[0].length === 1 && (r0 !== r1 || c0 !== c1)) { for (const x of selCells()) items.push({ ...x, code: data[0][0] }); }
    else {
      let r = Math.min(r0, r1);
      for (const row of data) { while (r < grid.length && !grid[r]) r++; if (r >= grid.length) break;
        row.forEach((v, j) => { const c = cols[Math.min(c0, c1) + j]; if (c && c.iso) items.push({ p: grid[r], iso: c.iso, code: v }); }); r++; }
    }
    apply(items, `Wklejenie: ${items.length}`);
  }
  document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);

  // ---------- komentarze, menu, podsumowanie pracownika ----------
  function contextMenu(e, pos) {
    document.querySelectorAll('.gr-menu').forEach((m) => m.remove());
    const c = cols[pos.c], p = grid[pos.r]; if (!p) return;
    const items = [];
    if (c.iso) {
      const n = note(p.id, c.iso);
      if (canWrite) items.push([n ? 'Edytuj komentarz…' : 'Komentarz…', () => noteDialog(p, c.iso)]);
      if (canWrite && n) items.push(['Usuń komentarz', () => apply([{ p, iso: c.iso, note: '' }], 'Usunięcie komentarza')]);
    }
    items.push(['Podsumowanie pracownika…', () => personDialog(p)]);
    const menu = h('div', { class: 'gr-menu', style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', zIndex: 9999, background: '#fff', border: '1px solid #888', boxShadow: '0 3px 10px rgba(0,0,0,.3)', minWidth: '200px' } },
      ...items.map(([label, fn]) => h('div', { style: { padding: '6px 12px', cursor: 'pointer' }, onmouseenter: (ev) => { ev.target.style.background = '#e8f0fe'; }, onmouseleave: (ev) => { ev.target.style.background = ''; }, onmousedown: (ev) => { ev.preventDefault(); menu.remove(); fn(); } }, label)));
    document.body.append(menu);
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
  function noteDialog(p, iso) {
    const ta = h('textarea', { rows: 4, style: { width: '100%', padding: '6px' } }); ta.value = note(p.id, iso);
    const m = modal(`Komentarz – ${p.name}, ${plDate(iso)}`, h('div', {}, ta, h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); apply([{ p, iso, note: ta.value.trim() }], 'Komentarz'); } }, 'OK'))));
    ta.focus();
  }
  function personDialog(p) {
    const s = F.personSummary(p, st.codes[p.id] || {}, year(), today()), ut = (p.ut || {})[year()] || {};
    const row = (k, v, red) => h('tr', {}, h('td', { style: { padding: '2px 8px' } }, k), h('td', { style: { padding: '2px 8px', fontWeight: 700, textAlign: 'right', color: red ? '#c00000' : '#000' } }, String(v)));
    const mt = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Miesiąc', 'UT wykorzystane', 'Plan UT', 'Godziny', 'Godziny narastająco'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...F.MONTHS.map((mn, i) => h('tr', {}, h('td', { class: 'left' }, mn), h('td', { style: { background: s.monthPlanMet[i] ? '#ff9900' : '' } }, s.utByMonth[i] || ''), h('td', {}, s.plan[i] || ''), h('td', {}, s.hoursByMonth[i] || ''), h('td', {}, s.hoursToMonth[i] || '')))));
    const abs = h('table', { class: 't' }, h('tbody', {}, ...F.ABSENCES.map(([k, label]) => h('tr', {}, h('td', { class: 'left' }, `${label} (${k})`), h('td', {}, s.absences[k] || 0)))));
    const m = modal(`${p.name} – ${year()}`, h('div', {},
      h('table', {}, h('tbody', {}, row(`UT z ${Number(year()) - 1}`, ut.prev || 0), row(`UT ${year()}`, ut.cur || 0), row(`Wykorzystane do dziś (UT + NŻ)`, s.used), row('Zaplanowane (UT po dziś)', s.future),
        row('Dostępny (UT poprz. + bieżący − wykorzystane)', s.available, s.available < 0), row('Pozostało (dostępny − zaplanowane)', s.remaining, s.remaining < 0), row('Plan urlopu (suma)', s.planned), row(`Godziny ${year()}`, s.hoursToMonth[11]))),
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '14px', marginTop: '8px' } }, mt, abs),
      h('p', { class: 'muted' }, `Miejsce pracy: ${p.place || '—'}${p.nr ? ' · Nr ew.: ' + p.nr : ''}. Godziny przepracowane = suma godzin zmian z wpisów (a8 = 8, a8b2 = 10, b2c6 = 8; UT, L4 i inne nieobecności = 0).`),
      h('div', { class: 'actions' }, canWrite ? h('button', { class: 'btn', onclick: () => { m.close(); personEdit(p); } }, 'Zmień dane…') : null, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }
  function personEdit(p) {
    const y = year(), ut = (p.ut || {})[y] || {};
    const inp = (v, w = '70px') => h('input', { value: v ?? '', style: { width: w, padding: '3px' } });
    const place = inp(p.place, '90px'), suffix = inp(p.suffix, '120px'), prev = inp(ut.prev ?? 0), cur = inp(ut.cur ?? 0);
    const plan = F.MONTHS.map((_, i) => inp((ut.plan || [])[i] || '', '40px'));
    const m = modal(`${p.name} – dane`, h('div', {},
      h('div', { class: 'row' }, 'Miejsce pracy (np. 1Si1):', place, ' Dopisek przy nazwisku:', suffix),
      h('div', { class: 'row', style: { marginTop: '6px' } }, `UT z ${Number(y) - 1}:`, prev, ` UT ${y}:`, cur),
      h('div', { style: { marginTop: '6px' } }, `Plan urlopu ${y}: `, ...plan.flatMap((x, i) => [h('span', { class: 'muted' }, ' ' + (i + 1) + ':'), x])),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
        h('button', { class: 'btn primary', onclick: async () => {
          const list = people().map((x) => x.id !== p.id ? x : { ...x, place: place.value.trim(), suffix: suffix.value.trim(),
            ut: { ...(x.ut || {}), [y]: { prev: Number(prev.value) || 0, cur: Number(cur.value) || 0, plan: plan.map((q) => Number(q.value) || 0) } } });
          try { await saveMeta({ people: list }); m.close(); toast('Zapisano dane pracownika'); } catch (e) { toast('Nie zapisano: ' + (e.message || e), true); }
        } }, 'Zapisz'))));
  }

  // ---------- filtry i sortowanie (jak autofiltr) ----------
  const sortLabel = (key) => { const i = st.sorts.findIndex((x) => x.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
  /**
   * Filtr i sortowanie kolumny – zasady Harmonogramu: lista wartości z liczbą wierszy (z uwzględnieniem pozostałych filtrów),
   * ostatnio wybrane sortowanie jest pierwszym poziomem (kolejne kolumny – następne poziomy, numer przy strzałce),
   * na górze okna wybór innej kolumny, także z ukrytych grup; filtry i sortowanie zapamiętane na tym komputerze.
   */
  function openFilter(c) {
    const fcols = columns({ ut: true, hours: true, abs: true });
    const getV = (pid, col) => { const p = people().find((x) => x.id === pid); return p ? value(p, col) : ''; };
    const all = people().filter((p) => !p.sep).map((p) => p.id);
    const cur = st.sorts.find((x) => x.key === c.key);
    const shown = new Set(cols.map((x) => x.key)), hidden = fcols.filter((x) => !shown.has(x.key));
    const label = (x) => x.iso ? `${sheetDate(x.iso)} (${WD[new Date(x.iso + 'T00:00:00Z').getUTCDay()]})` : (x.full || x.title);
    let dlg = null;
    const opt = (x) => h('option', { value: x.key }, `${label(x)}${st.filters[x.key] ? ' ▼' : ''}${sortLabel(x.key) ? ' ' + sortLabel(x.key) : ''}`);
    const sel = h('select', { style: { width: '100%', padding: '4px' }, onchange: () => { const n = fcols.find((x) => x.key === sel.value); if (n && n.key !== c.key) { if (dlg) dlg.close(); openFilter(n); } } },
      h('optgroup', { label: 'Widoczne' }, ...cols.map(opt)), ...(hidden.length ? [h('optgroup', { label: 'Ukryte (Urlopy / Godziny / Absencje)' }, ...hidden.map(opt))] : []));
    sel.value = c.key;
    const others = Object.keys(st.filters).filter((k) => k !== c.key).map((k) => fcols.find((x) => x.key === k)).filter(Boolean);
    const picker = h('div', { style: { border: '1px solid #ccc', background: '#f6f8fc', padding: '6px', marginBottom: '6px' } },
      h('div', { style: { fontWeight: 700, fontSize: '12px', marginBottom: '4px' } }, 'Kolumna do filtrowania (także ukryte):'), sel,
      others.length ? h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, 'Inne filtry: ' + others.map((x) => x.iso ? sheetDate(x.iso) : x.title).join(', ')) : null);
    dlg = columnFilterDialog({ top: picker, title: label(c) + (shown.has(c.key) ? '' : ' (kolumna ukryta)'), options: filterOptions(all, fcols, st.filters, getV, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
      onApply: (filter, sort) => {
        if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
        st.sorts = st.sorts.filter((x) => x.key !== c.key); if (sort !== null) st.sorts.unshift({ key: c.key, ascending: sort });
        saveFilters(st); draw();
      } });
  }

  // ---------- import, dawny grafik ----------
  async function doImport() {
    if (!(await confirmBox('Import z arkusza G', 'Grafik w bazie zostanie zastąpiony danymi z karty G (pracownicy, miejsca pracy, urlopy, kody, komentarze, święta). Kontynuować?', 'Importuj'))) return;
    toast('Import z karty G…');
    try { const r = await importFromSheet((ctx.user && (ctx.user.name || ctx.user.email)) || ''); st.undo = []; st.redo = []; toast(`Zaimportowano: pracowników ${r.people}, miesięcy ${r.months}, wpisów ${r.cells}, komentarzy ${r.notes}` + (r.holidays ? `, nowych świąt ${r.holidays}` : '')); }
    catch (e) { toast('Import nieudany: ' + (e.code === 'permission-denied' ? 'brak uprawnień (reguły Firestore)' : e.message || e), true); }
  }
  function openSheet() { cleanup(); clear(el); mountGrafikSheet(el, ctx); }

  const setZoom = (v) => { st.zoom = Math.max(50, Math.min(200, v)); lsSet('grafik.zoom', st.zoom); zoomLabel.textContent = st.zoom + '%'; draw(); };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });
  const tick = setInterval(() => { if (!el.isConnected) { cleanup(); return; } if (!st.editing) draw(); }, 5 * 60000);   // kolory „teraz” i „minione”
  function cleanup() {
    document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste);
    clearInterval(tick); if (st.watcher) { st.watcher.stop(); st.watcher = null; }
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, 'Od', fromIn, 'do', toIn,
    preset('Teraz', (t) => [addDays(t, -3), addDays(t, 7)], 'Od 3 dni wstecz do 7 dni naprzód (jak w arkuszu)'),
    preset('Miesiąc', (t) => [t.slice(0, 8) + '01', F.daysBetween(t.slice(0, 8) + '01', addDays(t.slice(0, 8) + '28', 4)).filter((d) => d.slice(0, 7) === t.slice(0, 7)).pop()]),
    preset('Rok', (t) => [t.slice(0, 4) + '-01-01', t.slice(0, 4) + '-12-31']),
    h('button', { class: 'btn small', title: 'Cofnij (Ctrl+Z)', onclick: () => undoRedo(st.undo, st.redo) }, '↶'), h('button', { class: 'btn small', title: 'Ponów (Ctrl+Y)', onclick: () => undoRedo(st.redo, st.undo) }, '↷'),
    ...groupBtns, (() => { const t = 'Wyczyść filtry i sortowanie'; const b = h('button', { class: 'btn small', title: t, 'aria-label': t, style: { width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, onclick: () => { st.filters = {}; st.sorts = []; saveFilters(st); draw(); } }); b.append(iconSvg('broom')); return b; })(),
    h('span', { class: 'grow' }), h('button', { class: 'btn small', onclick: () => setZoom(st.zoom - 10) }, '−'), zoomLabel, h('button', { class: 'btn small', onclick: () => setZoom(st.zoom + 10) }, '+'),
    canWrite ? h('button', { class: 'btn small', title: 'Zastąp grafik w bazie danymi z karty G arkusza', onclick: doImport }, 'Import z G') : null,
    h('button', { class: 'btn small', onclick: openSheet, title: 'Dawny widok: wprost z karty G arkusza' }, 'Arkusz'), info), body);
  zoomLabel.textContent = st.zoom + '%';
  start();
  return cleanup;
}
