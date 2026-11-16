// Kompetencje operatorów (Firebase kp/main): dane podstawowe, uprawnienia z datami i matryca umiejętności z wagami i punktami –
// jak arkusz „MK”. Obsługa jak w Excelu: klik / Shift / przeciąganie – zaznaczenie, strzałki, Tab, Enter, pisanie w komórce, F2 / dwuklik,
// Delete, Ctrl+C / Ctrl+V (zgodne z Excelem), Ctrl+Z / Ctrl+Y. Filtry i sortowanie jak w Harmonogramie. Nazwisko w kolorze stanowiska
// z Grafiku (miejsce pracy → stanowisko Harmonogramu). Czyta i zmienia osoba z prawem do Grafiku (odczyt / zapis).
import { h, clear, toast, modal, confirmBox, columnFilterDialog } from '../ui.js';
import * as K from '../logic/competence.js';
import { placeStation } from '../logic/grafikFb.js';
import { stationList } from '../logic/harmModel.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { readXlsx } from '../logic/xlsxRead.js';
import { iconSvg } from './harmIcons.js';
import { watchCompetence, setFields, savePerson, deletePerson, saveDefs, importCompetence, loadGrafikPlaces } from '../competenceStore.js';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci */ } };
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GROUP = { base: ['Dane podstawowe', '#bfbfbf'], perms: ['Uprawnienia', '#bdd6ee'], skills: ['Umiejętności', '#c5e0b3'] };

export function mountCompetence(el, ctx) {
  const canWrite = ctx.level('grafik') === 'write';
  const saved = lsGet('kp.filters', {}) || {};
  const st = {
    data: null, grafik: { people: [], cfg: null }, sel: null, editing: null, undo: [], redo: [], zoom: lsGet('kp.zoom', 100),
    groups: { base: true, perms: false, skills: true, ...lsGet('kp.groups', {}) },
    filters: Object.fromEntries(Object.entries(saved.filters || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, new Set(v)])),
    sorts: Array.isArray(saved.sorts) ? saved.sorts : [],
  };
  const saveFilters = () => lsSet('kp.filters', { filters: Object.fromEntries(Object.entries(st.filters).map(([k, v]) => [k, [...v]])), sorts: st.sorts });
  const body = h('div', { tabindex: '0', style: { flex: 1, minHeight: 0, overflow: 'auto', outline: 'none', background: '#fff', position: 'relative' } });
  const info = h('span', { class: 'muted' });
  const zoomLabel = h('button', { class: 'btn small', title: 'Kliknij: 100%', onclick: () => setZoom(100) }, '100%');
  const groupBtns = [['base', 'Dane', 'Dane podstawowe: wydział, komis, maszyna, stanowisko wg umowy'], ['perms', 'Uprawnienia', 'Szkolenia, badania, uprawnienia (suwnica, spawanie, wózki…) z datami'], ['skills', 'Umiejętności', 'Matryca umiejętności z wagami i punktami']]
    .map(([k, label, title]) => { const b = h('button', { class: 'btn small', title, onclick: () => { st.groups[k] = !st.groups[k]; lsSet('kp.groups', st.groups); draw(); } }, label); b.dataset.g = k; return b; });

  // ---------- model ----------
  const skills = () => (st.data && st.data.skills) || [];
  const perms = () => (st.data && st.data.perms) || [];
  const peopleMap = () => (st.data && st.data.people) || {};
  const grafikById = () => { const m = new Map(); for (const p of st.grafik.people) if (p && !p.sep) { if (p.nr) m.set(K.cleanId(String(p.nr).toUpperCase()), p); m.set(p.id, p); } return m; };
  const columns = (g = st.groups) => [
    { key: 'lp', title: 'Lp', w: 34, ro: true },
    { key: 'name', title: 'Nazwisko i imię', w: 180, path: 'name' },
    { key: 'nr', title: 'Nr ew.', full: 'Numer ewidencyjny (z wydziałem łączy osobę z Grafikiem, np. PO + 12007)', w: 60, path: 'nr' },
    { key: 'place', title: 'Miejsce', full: 'Miejsce pracy z Grafiku (kolor stanowiska jak w Harmonogramie)', w: 56, ro: true },
    ...(g.base ? K.BASIC.map((b) => ({ ...b, path: b.key, group: 'base' })) : []),
    ...(g.perms ? perms().map((p) => ({ key: p.key, title: p.name, full: p.name + (p.expiry ? ' – czerwone, gdy minęła lub mija w ciągu 30 dni' : ''), w: 86, path: 'perms.' + p.key, perm: p, group: 'perms', vertical: true })) : []),
    ...(g.skills ? [{ key: 'pts', title: 'Punkty', full: 'Punkty = Σ poziom × waga umiejętności', w: 56, ro: true, group: 'skills' },
      ...skills().map((s) => ({ key: s.key, title: s.name, full: `${s.name} – waga ${s.weight}. Poziom 0–100 (%)`, w: 34, path: 'skills.' + s.key, skill: s, group: 'skills', vertical: true }))] : []),
  ];
  const allColumns = () => columns({ base: true, perms: true, skills: true });
  const raw = (p, c) => {
    if (c.key === 'lp') return p.lp ?? '';
    if (c.key === 'place') { const g = grafikById().get(p.id); return g ? g.place || '' : ''; }
    if (c.key === 'pts') return K.points(p, skills());
    if (c.perm) return (p.perms || {})[c.key] ?? '';
    if (c.skill) return (p.skills || {})[c.key] ?? '';
    return p[c.key] ?? '';
  };
  const value = (p, c) => { const v = raw(p, c); return c.perm ? K.fmtPerm(v) : String(v); };

  // ---------- dane na żywo ----------
  let unsub = null;
  async function start() {
    body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie kompetencji…'));
    loadGrafikPlaces().then((g) => { st.grafik = g; draw(); }, () => {});
    try {
      unsub = await watchCompetence((d) => { st.data = d || { skills: [], perms: [], people: {} }; st.empty = !d; draw(); },
        (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy kompetencji: ' + (e.code === 'permission-denied' ? 'brak uprawnień (prawo do Grafiku; opublikuj reguły Firestore: kp)' : e.message || e))); });
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message || String(e))); }
  }

  // ---------- rysowanie ----------
  let grid = [], cols = [];
  function draw() {
    if (!st.data) return;
    for (const b of groupBtns) b.className = 'btn small' + (st.groups[b.dataset.g] ? ' primary' : '');
    if (st.empty && !Object.keys(peopleMap()).length) {
      clear(body);
      body.append(h('div', { style: { padding: '14px' } }, h('p', {}, 'Matrycy kompetencji nie ma jeszcze w bazie.'),
        canWrite ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: doImport }, 'Import z pliku Excel (.xlsx)'), h('button', { class: 'btn', onclick: () => addPerson() }, 'Dodaj pracownika')) : h('p', { class: 'muted' }, 'Import robi osoba z prawem zapisu w Grafiku.')));
      return;
    }
    cols = columns();
    const fcols = allColumns();
    for (const k of Object.keys(st.filters)) if (!fcols.some((c) => c.key === k)) delete st.filters[k];
    st.sorts = st.sorts.filter((x) => fcols.some((c) => c.key === x.key));
    const pm = peopleMap(), getV = (id, c) => (pm[id] ? value({ id, ...pm[id] }, c) : '');
    let ids = Object.keys(pm).sort((a, b) => (Number(pm[a].lp) || 1e9) - (Number(pm[b].lp) || 1e9) || String(pm[a].name).localeCompare(String(pm[b].name), 'pl'));
    ids = visibleRows(ids, fcols, st.filters, getV);
    if (st.sorts.length) ids = sortRows(ids, fcols, st.sorts, getV);
    const rows = ids.map((id) => ({ id, ...pm[id] }));
    const stList = stationList(st.grafik.cfg), gmap = grafikById(), t = isoToday();
    const z = st.zoom / 100, FIX = 3;
    const widths = cols.map((c) => Math.round((c.w || 40) * z));
    const leftOf = (i) => widths.slice(0, i).reduce((a, b) => a + b, 0);
    const sy = body.scrollTop, sx = body.scrollLeft;
    clear(body);
    const table = h('table', { class: 't', style: { fontSize: 13 * z + 'px', borderCollapse: 'separate', borderSpacing: 0 } });
    const thBase = { position: 'sticky', padding: '2px 3px', fontWeight: 700, borderRight: '1px solid #999', borderBottom: '1px solid #999', color: '#000' };
    const gH = Math.round(18 * z);
    // wiersz grup (jak scalone komórki w wierszu 1 arkusza)
    const head0 = h('tr', {}), head1 = h('tr', {});
    head0.append(h('th', { colspan: 4, style: { ...thBase, top: 0, left: 0, zIndex: 6, height: gH + 'px', background: '#e4e4e4', textAlign: 'left' } }, `Pracowników: ${rows.length}`));
    for (let i = 4; i < cols.length;) {
      const g = cols[i].group; let n = 1; while (i + n < cols.length && cols[i + n].group === g) n++;
      head0.append(h('th', { colspan: n, style: { ...thBase, top: 0, zIndex: 3, height: gH + 'px', background: (GROUP[g] || ['', '#eee'])[1], textAlign: 'left', whiteSpace: 'nowrap' } }, (GROUP[g] || [''])[0]));
      i += n;
    }
    const sortLabel = (key) => { const i = st.sorts.findIndex((x) => x.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
    cols.forEach((c, i) => {
      const filt = !!st.filters[c.key], mark = (filt ? ' ▼' : '') + (sortLabel(c.key) ? ' ' + sortLabel(c.key) : '');
      const bg = filt ? '#ffb74d' : c.skill ? c.skill.color : c.perm ? (c.perm.expiry ? '#f4b183' : '#ddebf7') : '#e4e4e4';
      const label = c.vertical ? h('div', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', margin: '0 auto', lineHeight: 1.1, maxHeight: 150 * z + 'px', overflow: 'hidden' } }, c.title + mark)
        : h('span', {}, c.title + mark);
      head1.append(h('th', { title: (c.full || c.title) + '. Kliknij: filtr i sortowanie', onclick: () => openFilter(c),
        style: { ...thBase, top: gH + 'px', zIndex: i < FIX ? 5 : 3, cursor: 'pointer', background: bg, whiteSpace: 'normal', lineHeight: 1.1, fontSize: 11 * z + 'px', verticalAlign: 'bottom',
          minWidth: widths[i] + 'px', maxWidth: widths[i] + 'px', ...(i < FIX ? { left: leftOf(i) + 'px' } : {}) } },
      label, c.skill ? h('div', { style: { fontWeight: 400, fontSize: 10 * z + 'px', borderTop: '1px solid rgba(0,0,0,.25)', marginTop: '2px' } }, '×' + c.skill.weight) : null));
    });
    const tbody = h('tbody', {});
    grid = rows;
    rows.forEach((p, ri) => {
      const tr = h('tr', {});
      const g = gmap.get(p.id), stn = g ? placeStation(g.place, stList) : null;
      cols.forEach((c, ci) => {
        const txt = value(p, c);
        let style = { borderRight: '1px solid #c8c8c8', borderBottom: '1px solid #c8c8c8', padding: '1px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          minWidth: widths[ci] + 'px', maxWidth: widths[ci] + 'px', textAlign: c.key === 'name' || (c.group === 'base' && c.key !== 'dept') ? 'left' : 'center', background: '#fff', cursor: canWrite && !c.ro ? 'cell' : 'default' };
        if ((c.key === 'name' || c.key === 'place') && stn) style = { ...style, background: stn.bg, color: stn.color, fontWeight: 700 };
        else if (c.key === 'name') style = { ...style, fontWeight: 600 };
        if (c.key === 'pts') style = { ...style, fontWeight: 700, background: '#e2efda' };
        if (c.skill) { const bg = K.levelColor(raw(p, c)); if (bg) style = { ...style, background: bg }; }
        if (c.perm && c.perm.expiry) { const a = K.permAlert(raw(p, c), t); if (a) style = { ...style, background: '#ff0000', color: '#fff', fontWeight: 700 }; }
        if (ci < FIX) style = { ...style, position: 'sticky', left: leftOf(ci) + 'px', zIndex: 2 };
        const td = h('td', { style, 'data-r': ri, 'data-c': ci }, txt);
        if (c.key === 'name') td.title = `${p.name}${p.nr ? ' · ' + p.dept + ' ' + p.nr : ''}${g ? ' · Grafik: ' + (g.place || 'bez miejsca') : ''}. Dwuklik: karta pracownika`;
        else if (c.perm && c.perm.expiry && K.permAlert(raw(p, c), t)) td.title = K.permAlert(raw(p, c), t) === 'expired' ? 'Termin minął' : 'Termin mija w ciągu 30 dni';
        else if (txt.length > 10) td.title = txt;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(h('thead', {}, head0, head1), tbody);
    body.append(table);
    body.scrollTop = sy; body.scrollLeft = sx;
    paintSel();
    info.textContent = (canWrite ? 'zmiany zapisują się od razu' : 'tylko odczyt') + (Object.keys(st.filters).length ? ` · filtry: ${Object.keys(st.filters).length}` : '') + (st.undo.length ? ` · cofnij: ${st.undo.length}` : '');
  }

  // ---------- zaznaczenie i klawiatura ----------
  const cellEl = (r, c) => body.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  function paintSel() {
    body.querySelectorAll('td.gsel').forEach((td) => { td.classList.remove('gsel'); td.style.outline = ''; td.style.boxShadow = ''; });
    if (!st.sel) return;
    const { r0, c0, r1, c1 } = st.sel;
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) { const td = cellEl(r, c); if (td) { td.classList.add('gsel'); td.style.boxShadow = 'inset 0 0 0 999px rgba(26,115,232,.18)'; } }
    const a = cellEl(r1, c1); if (a) { a.style.outline = '2px solid #0b57d0'; a.style.outlineOffset = '-2px'; a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function setSel(r, c, extend) {
    if (!grid.length) return;
    r = Math.max(0, Math.min(grid.length - 1, r)); c = Math.max(0, Math.min(cols.length - 1, c));
    st.sel = extend && st.sel ? { ...st.sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c };
    paintSel();
  }
  const posOf = (e) => { const td = e.target.closest && e.target.closest('td[data-r]'); return td ? { r: +td.dataset.r, c: +td.dataset.c } : null; };
  let dragging = false;
  body.addEventListener('mousedown', (e) => { if (st.editing) return; const p = posOf(e); if (!p || e.button !== 0) return; e.preventDefault(); body.focus(); setSel(p.r, p.c, e.shiftKey); dragging = true; });
  body.addEventListener('mousemove', (e) => { if (!dragging || !(e.buttons & 1)) { dragging = false; return; } const p = posOf(e); if (p && st.sel && (p.r !== st.sel.r1 || p.c !== st.sel.c1)) { st.sel = { ...st.sel, r1: p.r, c1: p.c }; paintSel(); } });
  body.addEventListener('dblclick', (e) => { const p = posOf(e); if (!p) return; setSel(p.r, p.c); if (cols[p.c].key === 'name' || cols[p.c].ro) personCard(grid[p.r]); else beginEdit(null); });
  body.addEventListener('contextmenu', (e) => { const p = posOf(e); if (!p) return; e.preventDefault(); setSel(p.r, p.c); contextMenu(e, grid[p.r]); });
  body.addEventListener('keydown', (e) => {
    if (st.editing || !st.data) return;
    const ctrl = e.ctrlKey || e.metaKey, s = st.sel;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(st.undo, st.redo); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); undoRedo(st.redo, st.undo); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); st.sel = { r0: 0, c0: 0, r1: grid.length - 1, c1: cols.length - 1 }; paintSel(); return; }
    if (!s) { if (e.key.startsWith('Arrow')) { e.preventDefault(); setSel(0, 1); } return; }
    const mv = (dr, dc, ext) => { e.preventDefault(); setSel(s.r1 + dr, s.c1 + dc, ext); };
    switch (e.key) {
      case 'ArrowDown': return mv(1, 0, e.shiftKey);
      case 'ArrowUp': return mv(-1, 0, e.shiftKey);
      case 'ArrowRight': return mv(0, 1, e.shiftKey);
      case 'ArrowLeft': return mv(0, -1, e.shiftKey);
      case 'Tab': return mv(0, e.shiftKey ? -1 : 1, false);
      case 'Enter': return mv(e.shiftKey ? -1 : 1, 0, false);
      case 'Home': e.preventDefault(); return setSel(s.r1, 0, e.shiftKey);
      case 'End': e.preventDefault(); return setSel(s.r1, cols.length - 1, e.shiftKey);
      case 'F2': e.preventDefault(); return beginEdit(null);
      case 'Delete': case 'Backspace': e.preventDefault(); return clearSel();
      default: if (!ctrl && !e.altKey && e.key.length === 1) { e.preventDefault(); beginEdit(e.key); }
    }
  });
  const selCells = () => { const { r0, c0, r1, c1 } = st.sel, out = []; for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (!cols[c].ro && grid[r]) out.push({ p: grid[r], c: cols[c] }); return out; };

  // ---------- zapis, cofanie ----------
  /** [items] = [{p, c, text}] → kontrola wpisu (poziom 0–100, daty) i jeden zapis. */
  async function apply(items, label) {
    if (!canWrite) { toast('Kompetencje: tylko odczyt (zapis: prawo zapisu w Grafiku)'); return; }
    const changes = [], before = [];
    for (const { p, c, text } of items) {
      if (c.ro) continue;
      let v = String(text ?? '').trim();
      if (c.skill) { v = K.parseLevel(v); if (v === null) { toast(`${c.title}: wpisz poziom 0–100 („${text}”)`, true); return; } }
      else if (c.perm) v = K.parsePermValue(v);
      if (c.key === 'name' && !v) { toast('Nazwisko nie może być puste'); return; }
      const old = raw(p, c);
      if (String(old) === String(v)) continue;
      changes.push({ id: p.id, path: c.path, value: v }); before.push({ id: p.id, path: c.path, value: old });
    }
    if (!changes.length) return;
    try { await setFields(changes); st.undo.push({ label, before, after: changes }); if (st.undo.length > 100) st.undo.shift(); st.redo = []; }
    catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
  }
  async function undoRedo(from, to) {
    const step = from.pop(); if (!step) return;
    try { await setFields(from === st.undo ? step.before : step.after); to.push(step); toast((from === st.undo ? 'Cofnięto: ' : 'Ponowiono: ') + step.label); }
    catch (e) { from.push(step); toast('Nie zapisano: ' + (e.message || e), true); }
  }
  function clearSel() { const items = selCells().filter((x) => x.c.key !== 'name' && String(raw(x.p, x.c)) !== '').map((x) => ({ ...x, text: '' })); if (items.length) apply(items, `Wyczyszczenie: ${items.length}`); }

  function beginEdit(typed) {
    if (!st.sel) return;
    const c = cols[st.sel.c1], p = grid[st.sel.r1];
    if (!p) return;
    if (c.ro) { personCard(p); return; }
    if (!canWrite) { toast('Kompetencje: tylko odczyt'); return; }
    const td = cellEl(st.sel.r1, st.sel.c1); if (!td) return;
    const r = td.getBoundingClientRect(), b = body.getBoundingClientRect();
    const input = h('input', { value: typed != null ? typed : value(p, c), style: { position: 'absolute', zIndex: 10, left: r.left - b.left + body.scrollLeft + 'px', top: r.top - b.top + body.scrollTop + 'px', width: Math.max(r.width, c.perm ? 110 : 70) + 'px', height: r.height + 'px', boxSizing: 'border-box', border: '2px solid #0b57d0', font: 'inherit', padding: '0 3px' } });
    st.editing = input; body.append(input); input.focus();
    if (typed == null) input.select();
    const finish = (commit, move) => {
      if (st.editing !== input) return;
      st.editing = null; const v = input.value; input.remove(); body.focus();
      if (commit) apply([{ p, c, text: v }], `${p.name} · ${c.title}`);
      if (move) move();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); finish(true, () => setSel(st.sel.r1 + (e.shiftKey ? -1 : 1), st.sel.c1)); }
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
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) { const row = []; for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) row.push(value(grid[r], cols[c])); out.push(row.map(tsvCell).join('\t')); }
    e.clipboardData.setData('text/plain', out.join('\r\n'));
  }
  function onCut(e) { if (!active()) return; onCopy(e); clearSel(); }
  function onPaste(e) {
    if (!active()) return; e.preventDefault();
    const data = parseTsv(e.clipboardData.getData('text/plain')); if (!data.length) return;
    const { r0, c0, r1, c1 } = st.sel, items = [];
    if (data.length === 1 && data[0].length === 1 && (r0 !== r1 || c0 !== c1)) { for (const x of selCells()) items.push({ ...x, text: data[0][0] }); }
    else data.forEach((row, i) => { const p = grid[Math.min(r0, r1) + i]; if (!p) return; row.forEach((v, j) => { const c = cols[Math.min(c0, c1) + j]; if (c && !c.ro) items.push({ p, c, text: v }); }); });
    apply(items, `Wklejenie: ${items.length}`);
  }
  document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);

  // ---------- menu, karta pracownika, dodawanie ----------
  function contextMenu(e, p) {
    document.querySelectorAll('.gr-menu').forEach((m) => m.remove());
    const items = [['Karta pracownika…', () => personCard(p)]];
    if (canWrite) items.push(['Dodaj pracownika…', () => addPerson()], ['Usuń pracownika…', () => removePerson(p)], ['Kolumny umiejętności i uprawnień…', defsDialog]);
    const menu = h('div', { class: 'gr-menu', style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', zIndex: 9999, background: '#fff', border: '1px solid #888', boxShadow: '0 3px 10px rgba(0,0,0,.3)', minWidth: '220px' } },
      ...items.map(([label, fn]) => h('div', { style: { padding: '6px 12px', cursor: 'pointer' }, onmouseenter: (ev) => { ev.target.style.background = '#e8f0fe'; }, onmouseleave: (ev) => { ev.target.style.background = ''; }, onmousedown: (ev) => { ev.preventDefault(); menu.remove(); fn(); } }, label)));
    document.body.append(menu);
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
  function personCard(p) {
    if (!p) return;
    const t = isoToday(), g = grafikById().get(p.id);
    const row = (k, v, style = {}) => h('tr', {}, h('td', { style: { padding: '2px 8px', color: '#555' } }, k), h('td', { style: { padding: '2px 8px', fontWeight: 600, ...style } }, String(v ?? '')));
    const sk = skills().map((s) => ({ s, v: Number((p.skills || {})[s.key]) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v * b.s.weight - a.v * a.s.weight);
    modal(`${p.name}${p.nr ? ' – ' + p.dept + ' ' + p.nr : ''}`, h('div', {},
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '18px' } },
        h('table', {}, h('tbody', {}, row('Wydział', p.dept), row('Nr ewidencyjny', p.nr), row('Miejsce w Grafiku', g ? g.place || '—' : 'brak w Grafiku'), row('Komis wewnętrzny', p.komis),
          row('Maszyna / stanowisko', p.machine), row('Stanowisko wg umowy', p.position), row('Punkty', K.points(p, skills()), { fontSize: '16px' }))),
        h('table', {}, h('tbody', {}, ...perms().filter((x) => (p.perms || {})[x.key]).map((x) => { const v = p.perms[x.key], a = x.expiry ? K.permAlert(v, t) : '';
          return row(x.name, K.fmtPerm(v) + (a === 'expired' ? ' – minął' : a === 'soon' ? ' – mija wkrótce' : ''), a ? { color: '#c00000' } : {}); })))),
      h('h3', { style: { margin: '10px 0 4px' } }, 'Umiejętności'),
      sk.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } }, ...sk.map(({ s, v }) => h('span', { title: `waga ${s.weight} · punkty ${v * s.weight}`, style: { border: '1px solid #999', borderLeft: `8px solid ${s.color}`, padding: '2px 6px', background: K.levelColor(v) || '#fff' } }, `${s.name}: ${v}%`)))
        : h('p', { class: 'muted' }, 'Brak wpisanych umiejętności.')), { wide: true });
  }
  function addPerson() {
    const inp = (ph, w = '160px') => h('input', { placeholder: ph, style: { width: w, padding: '4px' } });
    const name = inp('Nazwisko Imię', '220px'), dept = inp('PO', '60px'), nr = inp('12007', '90px'), machine = inp('np. Tokarz'), position = inp('np. Operator obrabiarek CNC', '220px');
    dept.value = 'PO';
    const m = modal('Nowy pracownik', h('div', {},
      h('div', { class: 'row' }, 'Nazwisko i imię:', name), h('div', { class: 'row', style: { marginTop: '6px' } }, 'Wydział:', dept, ' Nr ewidencyjny:', nr),
      h('div', { class: 'row', style: { marginTop: '6px' } }, 'Maszyna / stanowisko:', machine), h('div', { class: 'row', style: { marginTop: '6px' } }, 'Stanowisko wg umowy:', position),
      h('p', { class: 'muted' }, 'Wydział + numer ewidencyjny łączą osobę z Grafikiem (np. PO + 12007 = PO12007).'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) { toast('Wpisz nazwisko i imię'); return; }
        const pm = peopleMap(); let id = K.personId(dept.value, nr.value, Date.now()); if (pm[id]) { toast('Pracownik o tym numerze już jest'); return; }
        const lp = Math.max(0, ...Object.values(pm).map((x) => Number(x.lp) || 0)) + 1;
        try { await savePerson(id, { lp, name: name.value.trim(), dept: dept.value.trim().toUpperCase(), nr: nr.value.trim(), komis: '', machine: machine.value.trim(), position: position.value.trim(), perms: {}, skills: {} }); m.close(); toast('Dodano pracownika'); }
        catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
      } }, 'Dodaj'))));
    name.focus();
  }
  async function removePerson(p) {
    if (!(await confirmBox('Usuń pracownika', `Usunąć ${p.name} z matrycy kompetencji (wszystkie uprawnienia i umiejętności)?`, 'Usuń'))) return;
    try { await deletePerson(p.id); st.sel = null; toast('Usunięto'); } catch (e) { toast('Nie usunięto: ' + (e.message || e), true); }
  }
  /** Kolumny umiejętności (nazwa, waga, kolor grupy) i uprawnień (nazwa, pilnowanie terminu). */
  function defsDialog() {
    const sk = skills().map((s) => ({ ...s })), pr = perms().map((p) => ({ ...p }));
    const box = h('div', {});
    const render = () => {
      clear(box);
      const cell = (x, k, w, type = 'text') => { const i = h('input', { type, value: x[k] ?? '', style: { width: w, padding: '2px 4px' }, oninput: () => { x[k] = type === 'number' ? Number(i.value) : i.value; } }); return i; };
      box.append(h('h3', { style: { margin: '4px 0' } }, 'Umiejętności (punkty = poziom × waga)'),
        h('div', { style: { maxHeight: '300px', overflow: 'auto' } }, h('table', {}, h('tbody', {}, ...sk.map((x, i) => h('tr', {}, h('td', {}, cell(x, 'name', '140px')), h('td', {}, 'waga ', cell(x, 'weight', '60px', 'number')),
          h('td', {}, (() => { const c = h('input', { type: 'color', value: x.color || '#d9d9d9', oninput: () => { x.color = c.value; } }); return c; })()),
          h('td', {}, h('button', { class: 'btn small', onclick: () => { if (i > 0) { [sk[i - 1], sk[i]] = [sk[i], sk[i - 1]]; render(); } } }, '↑'), h('button', { class: 'btn small', onclick: () => { sk.splice(i, 1); render(); } }, 'Usuń'))))))),
        h('button', { class: 'btn small', onclick: () => { sk.push({ key: 's' + Date.now().toString(36), name: '', weight: 1, color: '#d9d9d9' }); render(); } }, 'Dodaj umiejętność'),
        h('h3', { style: { margin: '12px 0 4px' } }, 'Uprawnienia'),
        h('div', { style: { maxHeight: '220px', overflow: 'auto' } }, h('table', {}, h('tbody', {}, ...pr.map((x, i) => h('tr', {}, h('td', {}, cell(x, 'name', '240px')),
          h('td', {}, h('label', {}, (() => { const c = h('input', { type: 'checkbox', checked: !!x.expiry, onchange: () => { x.expiry = c.checked; } }); return c; })(), ' pilnuj terminu (30 dni)')),
          h('td', {}, h('button', { class: 'btn small', onclick: () => { pr.splice(i, 1); render(); } }, 'Usuń'))))))),
        h('button', { class: 'btn small', onclick: () => { pr.push({ key: 'p' + Date.now().toString(36), name: '' }); render(); } }, 'Dodaj uprawnienie'));
    };
    render();
    const m = modal('Kolumny matrycy kompetencji', h('div', {}, box, h('p', { class: 'muted' }, 'Usunięcie kolumny ukrywa ją; wpisane wartości zostają w danych pracowników.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        const skillsOut = sk.filter((x) => String(x.name).trim()).map((x) => ({ key: x.key, name: String(x.name).trim(), weight: Number(x.weight) || 0, color: x.color || '#d9d9d9' }));
        const permsOut = pr.filter((x) => String(x.name).trim()).map((x) => ({ key: x.key, name: String(x.name).trim(), ...(x.expiry ? { expiry: true } : {}) }));
        try { await saveDefs({ skills: skillsOut, perms: permsOut }); m.close(); toast('Zapisano kolumny'); } catch (e) { toast('Nie zapisano: ' + (e.message || e), true); }
      } }, 'Zapisz'))), { wide: true });
  }

  // ---------- filtry i sortowanie (zasady Harmonogramu) ----------
  function openFilter(c) {
    const fcols = allColumns(), pm = peopleMap(), ids = Object.keys(pm);
    const getV = (id, col) => (pm[id] ? value({ id, ...pm[id] }, col) : '');
    const cur = st.sorts.find((x) => x.key === c.key);
    const shown = new Set(cols.map((x) => x.key)), hidden = fcols.filter((x) => !shown.has(x.key));
    const sortLabel = (key) => { const i = st.sorts.findIndex((x) => x.key === key); return i < 0 ? '' : (st.sorts[i].ascending ? '↑' : '↓') + (st.sorts.length > 1 ? i + 1 : ''); };
    let dlg = null;
    const opt = (x) => h('option', { value: x.key }, `${x.title}${st.filters[x.key] ? ' ▼' : ''}${sortLabel(x.key) ? ' ' + sortLabel(x.key) : ''}`);
    const sel = h('select', { style: { width: '100%', padding: '4px' }, onchange: () => { const n = fcols.find((x) => x.key === sel.value); if (n && n.key !== c.key) { if (dlg) dlg.close(); openFilter(n); } } },
      h('optgroup', { label: 'Widoczne' }, ...cols.map(opt)), ...(hidden.length ? [h('optgroup', { label: 'Ukryte grupy' }, ...hidden.map(opt))] : []));
    sel.value = c.key;
    const picker = h('div', { style: { border: '1px solid #ccc', background: '#f6f8fc', padding: '6px', marginBottom: '6px' } }, h('div', { style: { fontWeight: 700, fontSize: '12px', marginBottom: '4px' } }, 'Kolumna do filtrowania (także ukryte):'), sel);
    dlg = columnFilterDialog({ top: picker, title: c.title + (shown.has(c.key) ? '' : ' (kolumna ukryta)'), options: filterOptions(ids, fcols, st.filters, getV, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
      onApply: (filter, sort) => {
        if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
        st.sorts = st.sorts.filter((x) => x.key !== c.key); if (sort !== null) st.sorts.unshift({ key: c.key, ascending: sort });
        saveFilters(); draw();
      } });
  }

  // ---------- import z Excela ----------
  function doImport() {
    const input = h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.remove(); if (!f) return;
      try {
        const sheets = await readXlsx(await f.arrayBuffer());
        const ws = sheets.find((s) => /^mk$/i.test(s.name)) || sheets[0];
        const r = K.parseCompetenceSheet(ws);
        const n = Object.keys(r.people).length;
        if (!(await confirmBox('Import matrycy kompetencji', `Plik „${f.name}”, arkusz „${ws.name}”: pracowników ${n}, uprawnień ${r.perms.length}, umiejętności ${r.skills.length}. Dane w bazie zostaną zastąpione. Kolumna „ur” (data urodzenia) nie jest przenoszona. Kontynuować?`, 'Importuj'))) return;
        await importCompetence(r, (ctx.user && (ctx.user.name || ctx.user.email)) || '');
        st.undo = []; st.redo = [];
        toast(`Zaimportowano: pracowników ${n}`);
      } catch (e) { toast('Import nieudany: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
    });
    document.body.append(input); input.click();
  }

  const setZoom = (v) => { st.zoom = Math.max(50, Math.min(200, v)); lsSet('kp.zoom', st.zoom); zoomLabel.textContent = st.zoom + '%'; draw(); };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });
  function cleanup() { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste); if (unsub) { unsub(); unsub = null; } }

  const broom = (() => { const t = 'Wyczyść filtry i sortowanie'; const b = h('button', { class: 'btn small', title: t, 'aria-label': t, style: { width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, onclick: () => { st.filters = {}; st.sorts = []; saveFilters(); draw(); } }); b.append(iconSvg('broom')); return b; })();
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Kompetencje'), ...groupBtns, broom,
    h('button', { class: 'btn small', title: 'Cofnij (Ctrl+Z)', onclick: () => undoRedo(st.undo, st.redo) }, '↶'), h('button', { class: 'btn small', title: 'Ponów (Ctrl+Y)', onclick: () => undoRedo(st.redo, st.undo) }, '↷'),
    canWrite ? h('button', { class: 'btn small', onclick: () => addPerson() }, 'Dodaj pracownika') : null,
    canWrite ? h('button', { class: 'btn small', onclick: defsDialog }, 'Kolumny…') : null,
    h('span', { class: 'grow' }), h('button', { class: 'btn small', onclick: () => setZoom(st.zoom - 10) }, '−'), zoomLabel, h('button', { class: 'btn small', onclick: () => setZoom(st.zoom + 10) }, '+'),
    canWrite ? h('button', { class: 'btn small', title: 'Zastąp matrycę w bazie danymi z pliku Excel (arkusz „MK”)', onclick: doImport }, 'Import z Excela') : null, info), body);
  zoomLabel.textContent = st.zoom + '%';
  start();
  return cleanup;
}
