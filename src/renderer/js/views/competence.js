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
import { watchCompetence, setFields, savePerson, deletePerson, saveDefs, watchGrafikMeta } from '../competenceStore.js';
import { saveMeta } from '../grafikStore.js';
import { openPersonCard } from './personCard.js';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci */ } };
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const GROUP = { base: ['Dane podstawowe', '#bfbfbf'], med: ['Badania i BHP', '#f8cbad'], perms: ['Uprawnienia', '#bdd6ee'], skills: ['Umiejętności', '#c5e0b3'] };

export function mountCompetence(el, ctx) {
  // Kompetencje: tylko MASTER i GOD Grafiku (CLERIK i TOURIST nie widzą modułu)
  const acc = ctx.grafikAcc ? ctx.grafikAcc() : { competence: ctx.level('grafik') === 'write' };
  const canWrite = !!acc.competence;
  if (!acc.competence) { el.append(h('div', { class: 'panel' }, 'Kompetencje: brak dostępu (wymagany poziom MASTER lub GOD w kolumnie „Grafik dostęp”).')); return () => {}; }
  const saved = lsGet('kp.filters', {}) || {};
  const st = {
    data: null, grafik: { meta: null, cfg: null }, gReady: false, sel: null, editing: null, undo: [], redo: [], zoom: lsGet('kp.zoom', 100),
    groups: { base: true, med: true, perms: false, skills: true, ...lsGet('kp.groups', {}) },
    filters: Object.fromEntries(Object.entries(saved.filters || {}).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, new Set(v)])),
    sorts: Array.isArray(saved.sorts) ? saved.sorts : [],
  };
  const saveFilters = () => lsSet('kp.filters', { filters: Object.fromEntries(Object.entries(st.filters).map(([k, v]) => [k, [...v]])), sorts: st.sorts });
  const body = h('div', { tabindex: '0', style: { flex: 1, minHeight: 0, overflow: 'auto', outline: 'none', background: '#fff', position: 'relative' } });
  const info = h('span', { class: 'muted' });
  const groupBtns = [['base', 'Dane', 'Dane podstawowe: wydział, komis, maszyna, stanowisko wg umowy'], ['med', 'Badania i BHP', 'Badania lekarskie i szkolenie BHP: numer, data wydania, data ważności (pomarańczowe – mija w ciągu miesiąca, czerwone – minęło)'], ['perms', 'Uprawnienia', 'Uprawnienia (suwnica, spawanie, wózki…): numer, data wydania, data ważności (czerwone – do miesiąca, pomarańczowe – do 3 miesięcy, zielone – ważne)'], ['skills', 'Umiejętności', 'Matryca umiejętności z wagami i punktami']]
    .map(([k, label, title]) => { const b = h('button', { class: 'btn small', title, onclick: () => { st.groups[k] = !st.groups[k]; lsSet('kp.groups', st.groups); draw(); } }, label); b.dataset.g = k; return b; });

  // ---------- model ----------
  const skills = () => (st.data && st.data.skills) || [];
  // typy uprawnień: zapisane w bazie (nowy układ: numer, wydano, ważne do) albo domyślne (stary import miał osobne kolumny arkusza)
  // uprawnienia bez badań lekarskich i BHP (te mają własną grupę – stałe typy K.MED_TYPES)
  const perms = () => (st.data && K.isNewPermDefs(st.data.perms) ? st.data.perms : K.PERM_TYPES).filter((d) => !K.isMedKey(d.key));
  const permCols = (list, group) => list.flatMap((d) => K.PERM_FIELDS.map(([f, label]) => ({ key: `${d.key}.${f}`, title: label, full: `${d.name} – ${label}` + (f === 'valid' ? (d.med ? ' (pomarańczowe – mija w ciągu miesiąca, czerwone – minęło)' : ' (czerwone – do miesiąca, pomarańczowe – do 3 miesięcy, zielone – ważne)') + (d.validYears ? `; bez wpisu: wydano + ${d.validYears} lat` : '') : ''), w: f === 'nr' ? 100 : f === 'valid' ? 86 : 78, path: `perms.${d.key}.${f}`, perm: d, field: f, group })));
  // Pracownicy = lista Grafiku (gr_meta/main, ta sama kolejność i separatory pominięte) + dane kompetencji (kp/main.people[id]).
  // Osoby tylko w kompetencjach (np. z wcześniejszego importu, bez Grafiku) są na końcu z oznaczeniem „poza Grafikiem”.
  const gPeople = () => ((st.grafik.meta && st.grafik.meta.people) || []);
  const kpPeople = () => (st.data && st.data.people) || {};
  const deptOf = (nr, kp) => (kp && kp.dept) || (/^[A-Za-z]+/.exec(String(nr || '')) || [''])[0].toUpperCase();
  let peopleCache = null;
  function peopleList() {
    if (peopleCache) return peopleCache;
    const kp = kpPeople(), out = [], seen = new Set();
    let lp = 0;
    for (const g of gPeople()) {
      if (!g || g.sep) continue;
      const k = kp[g.id] || {}; seen.add(g.id);
      out.push({ ...k, id: g.id, lp: ++lp, name: g.name, nr: g.nr || '', place: g.place || '', dept: deptOf(g.nr, k), inGrafik: true, g });
    }
    for (const [id, k] of Object.entries(kp)) if (!seen.has(id)) out.push({ ...k, id, lp: ++lp, name: k.name || id, nr: (k.dept || '') + (k.nr || ''), place: '', dept: k.dept || '', inGrafik: false });
    return (peopleCache = out);
  }
  const peopleMap = () => Object.fromEntries(peopleList().map((p) => [p.id, p]));
  const columns = (g = st.groups) => [
    { key: 'lp', title: 'Lp', full: 'Kolejność (jak w Grafiku). Wpisz nowy numer, aby przesunąć pracownika – zmienia kolejność także w Grafiku', w: 34, lpCol: true },
    { key: 'name', title: 'Nazwisko i imię', full: 'Nazwisko i imię (wspólne z Grafikiem)', w: 180, path: 'g:name' },
    { key: 'nr', title: 'Nr ew.', full: 'Numer ewidencyjny (wspólny z Grafikiem, np. PO12007)', w: 70, path: 'g:nr' },
    { key: 'place', title: 'Stanowisko', full: 'Stanowisko / miejsce pracy w Grafiku (np. 1Si1) – kolor jak w Harmonogramie. Kliknij dwukrotnie: wybór z listy', w: 64, path: 'g:place', placeCol: true },
    ...(g.base ? K.BASIC.map((b) => (b.key === 'dept' ? { ...b, ro: true, full: 'Wydział (z numeru ewidencyjnego)', group: 'base' } : { ...b, path: b.key, group: 'base' })) : []),
    ...(g.med ? permCols(K.MED_TYPES, 'med') : []),
    ...(g.perms ? permCols(perms(), 'perms') : []),
    ...(g.skills ? [{ key: 'pts', title: 'Punkty', full: 'Punkty = Σ poziom × waga umiejętności', w: 56, ro: true, group: 'skills' },
      ...skills().map((s) => ({ key: s.key, title: s.name, full: `${s.name} – waga ${s.weight}. Poziom 0–100 (%)`, w: 34, path: 'skills.' + s.key, skill: s, group: 'skills', vertical: true }))] : []),
  ];
  const allColumns = () => columns({ base: true, med: true, perms: true, skills: true });
  const raw = (p, c) => {
    if (c.key === 'lp') return p.lp ?? '';
    if (c.key === 'place') return p.place || '';
    if (c.key === 'pts') return K.points(p, skills());
    if (c.perm) { const pv = K.permOf(p, c.perm.key); return c.field === 'valid' ? K.permValid(pv, c.perm).iso : pv[c.field] ?? ''; }
    if (c.skill) return (p.skills || {})[c.key] ?? '';
    return p[c.key] ?? '';
  };
  const value = (p, c) => { const v = raw(p, c); return (c.perm && c.field !== 'nr') || c.date ? K.fmtPerm(v) : String(v); };

  // ---------- dane na żywo ----------
  let unsub = null, unsubG = null;
  async function start() {
    body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie kompetencji…'));
    watchGrafikMeta((g) => { st.grafik = g; st.gReady = true; peopleCache = null; draw(); }).then((u) => { unsubG = u; }, () => { st.gReady = true; draw(); });
    try {
      unsub = await watchCompetence((d) => { st.data = d || { skills: [], perms: [], people: {} }; st.empty = !d; peopleCache = null; draw(); },
        (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy kompetencji: ' + (e.code === 'permission-denied' ? 'brak uprawnień (prawo do Grafiku; opublikuj reguły Firestore: kp)' : e.message || e))); });
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message || String(e))); }
  }

  // ---------- rysowanie ----------
  let grid = [], cols = [];
  function draw() {
    if (!st.data || !st.gReady) return;
    for (const b of groupBtns) b.className = 'btn small' + (st.groups[b.dataset.g] ? ' primary' : '');
    { const n = peopleList().filter((p) => K.personAlert(p, perms(), isoToday())).length; alertBtn.className = 'btn small' + (st.onlyAlerts ? ' primary' : ''); alertBtn.textContent = `⚠ Terminy (${n})`; }
    if (!peopleList().length) {
      clear(body);
      body.append(h('div', { style: { padding: '14px' } }, h('p', {}, 'Brak pracowników: zaimportuj Grafik z karty G (moduł Grafik → „Import z G”) albo dodaj pracownika.'),
        canWrite ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => addPerson() }, 'Dodaj pracownika'), h('button', { class: 'btn', onclick: doImport }, 'Umiejętności z pliku Excel…')) : h('p', { class: 'muted' }, 'Import robi osoba z prawem zapisu w Grafiku.')));
      return;
    }
    cols = columns();
    const fcols = allColumns();
    for (const k of Object.keys(st.filters)) if (!fcols.some((c) => c.key === k)) delete st.filters[k];
    st.sorts = st.sorts.filter((x) => fcols.some((c) => c.key === x.key));
    const pm = peopleMap(), getV = (id, c) => (pm[id] ? value(pm[id], c) : '');
    let ids = peopleList().map((p) => p.id);
    ids = visibleRows(ids, fcols, st.filters, getV);
    if (st.onlyAlerts) ids = ids.filter((id) => K.personAlert(pm[id], perms(), isoToday()));
    if (st.sorts.length) ids = sortRows(ids, fcols, st.sorts, getV);
    const rows = ids.map((id) => pm[id]);
    const stList = stationList(st.grafik.cfg), t = isoToday();
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
    // trzy wiersze: grupy, typy uprawnień (nad trzema polami: Nr, Wydano, Ważne do), nazwy kolumn; zwykłe kolumny zajmują dwa dolne wiersze
    const headT = h('tr', {});
    const colHead = (c, i, rowspan) => {
      const filt = !!st.filters[c.key], mark = (filt ? ' ▼' : '') + (sortLabel(c.key) ? ' ' + sortLabel(c.key) : '');
      const bg = filt ? '#ffb74d' : c.skill ? c.skill.color : c.perm ? (c.field === 'valid' ? '#f8cbad' : '#ddebf7') : '#e4e4e4';
      const label = c.vertical ? h('div', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', margin: '0 auto', lineHeight: 1.1, maxHeight: 150 * z + 'px', overflow: 'hidden' } }, c.title + mark)
        : h('span', {}, c.title + mark);
      return h('th', { ...(rowspan ? { rowspan } : {}), title: (c.full || c.title) + '. Kliknij: filtr i sortowanie', onclick: () => openFilter(c),
        style: { ...thBase, top: (rowspan ? gH : 2 * gH) + 'px', zIndex: i < FIX ? 5 : 3, cursor: 'pointer', background: bg, whiteSpace: 'normal', lineHeight: 1.1, fontSize: 11 * z + 'px', verticalAlign: 'bottom',
          minWidth: widths[i] + 'px', maxWidth: widths[i] + 'px', ...(i < FIX ? { left: leftOf(i) + 'px' } : {}) } },
      label, c.skill ? h('div', { style: { fontWeight: 400, fontSize: 10 * z + 'px', borderTop: '1px solid rgba(0,0,0,.25)', marginTop: '2px' } }, '×' + c.skill.weight) : null);
    };
    cols.forEach((c, i) => {
      if (!c.perm) { headT.append(colHead(c, i, 2)); return; }
      if (c.field === 'nr') headT.append(h('th', { colspan: 3, title: c.perm.name + (c.perm.validYears ? ` – ważne ${c.perm.validYears} lat od wydania` : ''),
        style: { ...thBase, top: gH + 'px', zIndex: 3, height: gH + 'px', background: '#bdd6ee', whiteSpace: 'nowrap', fontSize: 11 * z + 'px' } }, c.perm.name));
      head1.append(colHead(c, i, 0));
    });
    const tbody = h('tbody', {});
    grid = rows;
    rows.forEach((p, ri) => {
      const tr = h('tr', {});
      const stn = placeStation(p.place, stList);
      cols.forEach((c, ci) => {
        const txt = value(p, c);
        let style = { borderRight: '1px solid #c8c8c8', borderBottom: '1px solid #c8c8c8', padding: '1px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          minWidth: widths[ci] + 'px', maxWidth: widths[ci] + 'px', textAlign: c.key === 'name' || (c.group === 'base' && c.key !== 'dept') ? 'left' : 'center', background: '#fff', cursor: canWrite && !c.ro ? 'cell' : 'default' };
        if ((c.key === 'name' || c.key === 'place') && stn) style = { ...style, background: stn.bg, color: stn.color, fontWeight: 700 };
        else if (c.key === 'name') style = { ...style, fontWeight: 600, ...(p.inGrafik ? {} : { fontStyle: 'italic', color: '#888' }) };
        if (c.key === 'pts') style = { ...style, fontWeight: 700, background: '#e2efda' };
        if (c.skill) { const bg = K.levelColor(raw(p, c)); if (bg) style = { ...style, background: bg }; }
        if (c.perm && c.field === 'valid') {
          const pv = K.permValid(K.permOf(p, c.perm.key), c.perm), lv = K.validLevel(pv.iso, t, !!c.perm.med), ls = K.LEVEL_STYLE[lv];
          if (ls) style = { ...style, background: ls[0], color: ls[1], fontWeight: lv === 'green' ? 400 : 700 };
          if (pv.computed) style = { ...style, fontStyle: 'italic' };
        }
        if (ci < FIX) style = { ...style, position: 'sticky', left: leftOf(ci) + 'px', zIndex: 2 };
        const td = h('td', { style, 'data-r': ri, 'data-c': ci }, txt);
        if (c.key === 'name') td.title = `${p.name}${p.nr ? ' · ' + p.nr : ''}${p.inGrafik ? ' · stanowisko w Grafiku: ' + (p.place || 'brak') : ' · POZA GRAFIKIEM (prawy przycisk: dodaj do Grafiku)'}. Dwuklik: karta pracownika`;
        else if (c.perm && c.field === 'valid' && raw(p, c)) { const pv = K.permValid(K.permOf(p, c.perm.key), c.perm), lv = K.validLevel(pv.iso, t, !!c.perm.med); td.title = `${c.perm.name}: ważne do ${K.fmtPerm(pv.iso)}` + (pv.computed ? ` (wyliczone: wydano + ${c.perm.validYears} lat)` : '') + (lv ? ' – ' + K.levelText(lv, !!c.perm.med) : ''); }
        else if (txt.length > 10) td.title = txt;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(h('thead', {}, head0, headT, head1), tbody);
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
  body.addEventListener('dblclick', (e) => { const p = posOf(e); if (!p) return; setSel(p.r, p.c); if (cols[p.c].key === 'name' || (cols[p.c].ro && !cols[p.c].lpCol)) personCard(grid[p.r]); else beginEdit(null); });
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
  const selCells = () => { const { r0, c0, r1, c1 } = st.sel, out = []; for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (!cols[c].ro && !cols[c].lpCol && grid[r]) out.push({ p: grid[r], c: cols[c] }); return out; };

  // ---------- zapis, cofanie ----------
  /**
   * Zapis zmian [{id, path, value}]: ścieżki „g:pole” (nazwisko, nr ew., stanowisko) zmieniają pracownika w Grafiku (gr_meta/main),
   * pozostałe – dane kompetencji (kp/main). Osoba spoza Grafiku ma nazwisko i numer w kompetencjach.
   */
  async function writeChanges(changes) {
    const pm = peopleMap(), meta = [], kp = [];
    for (const ch of changes) {
      if (ch.path.startsWith('g:')) {
        const f = ch.path.slice(2);
        if (pm[ch.id] && pm[ch.id].inGrafik) meta.push({ ...ch, f }); else kp.push({ id: ch.id, path: f, value: ch.value });
      } else kp.push(ch);
    }
    if (meta.length) {
      const list = gPeople().map((g) => { const mine = meta.filter((m) => m.id === g.id); if (!mine.length) return g; const x = { ...g }; for (const m of mine) x[m.f] = m.value ?? ''; return x; });
      await saveMeta({ people: list });
    }
    if (kp.length) await setFields(kp);
  }
  /** [items] = [{p, c, text}] → kontrola wpisu (poziom 0–100, daty, stanowisko) i jeden zapis. */
  async function apply(items, label) {
    if (!canWrite) { toast('Kompetencje: tylko odczyt (zapis: prawo zapisu w Grafiku)'); return; }
    const changes = [], before = [];
    const lpItem = items.find((x) => x.c.lpCol);
    if (lpItem) { await moveTo(lpItem.p, lpItem.text); return; }
    for (const { p, c, text } of items) {
      if (c.ro || c.lpCol) continue;
      let v = String(text ?? '').trim();
      if (c.skill) { v = K.parseLevel(v); if (v === null) { toast(`${c.title}: wpisz poziom 0–100 („${text}”)`, true); return; } }
      else if (c.date) { v = K.parsePermValue(v); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast(`${c.full || c.title}: wpisz datę dd.mm.rrrr („${text}”)`, true); return; } }
      else if (c.perm && c.field !== 'nr') { v = K.parsePermValue(v); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast(`${c.perm.name} – ${c.title}: wpisz datę dd.mm.rrrr („${text}”)`, true); return; } }
      if (c.key === 'name' && !v) { toast('Nazwisko nie może być puste'); return; }
      if (c.placeCol && v && !placeStation(v, stationList(st.grafik.cfg))) { toast(`Stanowisko „${v}” nie pasuje do żadnego stanowiska Harmonogramu (np. 1Si1, 2Un2, Narz1)`, true); return; }
      if (c.perm) {
        // stary zapis uprawnienia (sam tekst) – zamieniany na {nr, issued, valid}
        const stored = ((p.perms || {})[c.perm.key]), pv = K.permOf(p, c.perm.key), old = pv[c.field] ?? '';
        if (String(old) === String(v)) continue;
        if (stored != null && typeof stored !== 'object') {
          const obj = { ...pv, [c.field]: v }; if (!v) delete obj[c.field];
          changes.push({ id: p.id, path: `perms.${c.perm.key}`, value: obj }); before.push({ id: p.id, path: `perms.${c.perm.key}`, value: stored });
        } else { changes.push({ id: p.id, path: c.path, value: v }); before.push({ id: p.id, path: c.path, value: old }); }
        continue;
      }
      const old = raw(p, c);
      if (String(old) === String(v)) continue;
      changes.push({ id: p.id, path: c.path, value: v }); before.push({ id: p.id, path: c.path, value: old });
    }
    if (!changes.length) return;
    try { await writeChanges(changes); st.undo.push({ label, before, after: changes }); if (st.undo.length > 100) st.undo.shift(); st.redo = []; }
    catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
  }
  async function undoRedo(from, to) {
    const step = from.pop(); if (!step) return;
    try { await writeChanges(from === st.undo ? step.before : step.after); to.push(step); toast((from === st.undo ? 'Cofnięto: ' : 'Ponowiono: ') + step.label); }
    catch (e) { from.push(step); toast('Nie zapisano: ' + (e.message || e), true); }
  }
  function clearSel() { const items = selCells().filter((x) => x.c.key !== 'name' && String(raw(x.p, x.c)) !== '').map((x) => ({ ...x, text: '' })); if (items.length) apply(items, `Wyczyszczenie: ${items.length}`); }

  function beginEdit(typed) {
    if (!st.sel) return;
    const c = cols[st.sel.c1], p = grid[st.sel.r1];
    if (!p) return;
    if (c.ro) { personCard(p); return; }
    if (!canWrite) { toast('Kompetencje: tylko odczyt'); return; }
    if (c.placeCol && typed == null) { placeDialog(p.place, (v) => apply([{ p, c, text: v }], `${p.name} · stanowisko`), p.id); return; }
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
    else data.forEach((row, i) => { const p = grid[Math.min(r0, r1) + i]; if (!p) return; row.forEach((v, j) => { const c = cols[Math.min(c0, c1) + j]; if (c && !c.ro && !c.lpCol) items.push({ p, c, text: v }); }); });
    apply(items, `Wklejenie: ${items.length}`);
  }
  document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);

  // ---------- menu, karta pracownika, dodawanie ----------
  function contextMenu(e, p) {
    document.querySelectorAll('.gr-menu').forEach((m) => m.remove());
    const items = [['Karta pracownika…', () => personCard(p)]];
    if (canWrite) { items.push(['Zmień stanowisko…', () => beginEditPlace(p)]); if (!p.inGrafik) items.push(['Dodaj do Grafiku…', () => addPerson(p)]); items.push(['Dodaj pracownika…', () => addPerson()], ['Usuń pracownika…', () => removePerson(p)], ['Kolumny umiejętności i uprawnień…', defsDialog]); }
    const menu = h('div', { class: 'gr-menu', style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', zIndex: 9999, background: '#fff', border: '1px solid #888', boxShadow: '0 3px 10px rgba(0,0,0,.3)', minWidth: '220px' } },
      ...items.map(([label, fn]) => h('div', { style: { padding: '6px 12px', cursor: 'pointer' }, onmouseenter: (ev) => { ev.target.style.background = '#e8f0fe'; }, onmouseleave: (ev) => { ev.target.style.background = ''; }, onmousedown: (ev) => { ev.preventDefault(); menu.remove(); fn(); } }, label)));
    document.body.append(menu);
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
  /** Karta pracownika – wspólna z Grafikiem i Planem (views/personCard.js): urlopy, godziny, absencje, badania, uprawnienia, umiejętności. */
  function personCard(p) {
    if (!p) return;
    const extra = canWrite ? [...(p.inGrafik ? [['Zmień stanowisko…', () => beginEditPlace(p)]] : []), ['Usuń pracownika…', () => removePerson(p)]] : [];
    openPersonCard({ id: p.id, name: p.name }, { access: ctx.grafikAcc ? ctx.grafikAcc() : { summary: true }, extra });
  }
  const beginEditPlace = (p) => { const c = cols.find((x) => x.placeCol) || columns().find((x) => x.placeCol); placeDialog(p.place, (v) => apply([{ p, c, text: v }], `${p.name} · stanowisko`), p.id); };
  /**
   * Wybór stanowiska (miejsca pracy w Grafiku): stanowisko z listy Harmonogramu (1Si, 2Un, 3Co…) i numer miejsca; przy każdym numerze
   * – kto je zajmuje. Domyślnie pierwsze wolne miejsce stanowiska. onPick('') = bez stanowiska.
   */
  function placeDialog(current, onPick, selfId = null) {
    const stList = stationList(st.grafik.cfg), taken = new Map();
    for (const g of gPeople()) if (g && !g.sep && g.place && g.id !== selfId) (taken.get(g.place.toLowerCase()) || taken.set(g.place.toLowerCase(), []).get(g.place.toLowerCase())).push(g.name);
    const cur = placeStation(current, stList);
    const stSel = h('select', { style: { padding: '4px', minWidth: '140px' } }, h('option', { value: '' }, '— bez stanowiska —'), ...stList.map((x) => h('option', { value: x.name }, x.name)));
    const slots = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' } });
    let picked = current || '';
    const renderSlots = () => {
      clear(slots);
      const name = stSel.value; if (!name) { picked = ''; return; }
      const stn = stList.find((x) => x.name === name);
      let firstFree = null;
      for (let n = 1; n <= 9; n++) {
        const place = name + n, who = taken.get(place.toLowerCase()) || [];
        if (!who.length && firstFree == null) firstFree = place;
        const b = h('button', { class: 'btn small', title: who.length ? 'Zajęte: ' + who.join(', ') : 'Wolne', style: { minWidth: '120px', textAlign: 'left', background: picked.toLowerCase() === place.toLowerCase() ? stn.bg : '', color: picked.toLowerCase() === place.toLowerCase() ? stn.color : '' },
          onclick: () => { picked = place; renderSlots(); } }, h('b', {}, place), ' ', h('span', { class: 'muted', style: { fontSize: '11px' } }, who.length ? who.join(', ') : 'wolne'));
        slots.append(b);
      }
      if (!placeStation(picked, [stn])) { picked = firstFree || name + '1'; renderSlots(); }
    };
    stSel.value = cur ? cur.name : '';
    stSel.addEventListener('change', () => { picked = ''; renderSlots(); });
    renderSlots();
    const m = modal('Stanowisko w Grafiku', h('div', {}, h('div', { class: 'row' }, 'Stanowisko:', stSel), slots,
      h('p', { class: 'muted' }, 'Miejsce pracy decyduje o godzinach stanowiska w Harmonogramie (graf_norm). Jedno miejsce – jedna osoba na zmianie; zajęte miejsca mają nazwisko.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: () => { m.close(); onPick(stSel.value ? picked : ''); } }, 'OK'))), { wide: true });
  }
  /**
   * Nowy pracownik: trafia do Grafiku (gr_meta/main – za ostatnią osobą tego samego stanowiska) i do kompetencji.
   * [from] – osoba spoza Grafiku, którą dopisujemy do Grafiku (z jej danymi).
   */
  function addPerson(from = null) {
    const inp = (ph, w = '160px', v = '') => { const i = h('input', { placeholder: ph, style: { width: w, padding: '4px' } }); i.value = v; return i; };
    const name = inp('Nazwisko Imię', '220px', from ? from.name : ''), nr = inp('np. PO12345', '110px', from ? from.nr : 'PO'), machine = inp('np. Tokarz', '160px', from ? from.machine || '' : ''), position = inp('np. Operator obrabiarek CNC', '220px', from ? from.position || '' : '');
    let place = '';
    const placeBtn = h('button', { class: 'btn small', onclick: () => placeDialog(place, (v) => { place = v; placeBtn.textContent = v || 'wybierz…'; }) }, 'wybierz…');
    const m = modal(from ? 'Dodaj do Grafiku' : 'Nowy pracownik', h('div', {},
      h('div', { class: 'row' }, 'Nazwisko i imię:', name), h('div', { class: 'row', style: { marginTop: '6px' } }, 'Nr ewidencyjny:', nr, ' Stanowisko (Grafik):', placeBtn),
      h('div', { class: 'row', style: { marginTop: '6px' } }, 'Maszyna / stanowisko:', machine), h('div', { class: 'row', style: { marginTop: '6px' } }, 'Stanowisko wg umowy:', position),
      h('p', { class: 'muted' }, 'Pracownik pojawi się od razu w Grafiku (za ostatnią osobą wybranego stanowiska) i w Kompetencjach. Nie ma go w karcie G arkusza – wpisy z Grafiku nie trafią do arkusza.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        const nm = name.value.trim(), nrv = nr.value.trim().toUpperCase();
        if (!nm) { toast('Wpisz nazwisko i imię'); return; }
        const list = gPeople();
        let id = from ? from.id : (/\d/.test(nrv) ? K.cleanId(nrv) : 'n' + Date.now().toString(36));
        if (list.some((g) => g.id === id || (nrv && /\d/.test(nrv) && String(g.nr || '').toUpperCase() === nrv))) { toast('Pracownik o tym numerze już jest w Grafiku'); return; }
        const person = { id, row: null, lp: '', name: nm, suffix: '', nr: nrv, place, sep: false, ut: {} };
        // za ostatnią osobą tego samego stanowiska (grupy jak w karcie G), inaczej na końcu
        const stn = placeStation(place, stationList(st.grafik.cfg));
        let at = list.length;
        if (stn) for (let i = list.length - 1; i >= 0; i--) if (!list[i].sep && placeStation(list[i].place, [stn])) { at = i + 1; break; }
        const next = [...list.slice(0, at), person, ...list.slice(at)];
        try {
          await saveMeta({ people: next });
          const k = from ? { ...kpPeople()[from.id] } : {};
          delete k.name; delete k.nr; delete k.dept; delete k.lp;
          await savePerson(id, { ...k, machine: machine.value.trim(), position: position.value.trim(), perms: k.perms || {}, skills: k.skills || {} });
          m.close(); toast(`Dodano: ${nm}${place ? ' – ' + place : ''} (Grafik i Kompetencje)`);
        } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
      } }, 'Dodaj'))));
    name.focus();
  }
  /**
   * Zmiana Lp: pracownik przechodzi na wskazane miejsce na liście Grafiku (kolejność wspólna dla Grafiku, Kompetencji, Planu) –
   * pomocne przy układaniu obsady maszyn (grupy stanowisk razem). Separatory zostają tam, gdzie są.
   */
  async function moveTo(p, text) {
    if (!p.inGrafik) { toast('Kolejność zmienia się tylko u osób z Grafiku'); return; }
    const n = Math.round(Number(String(text).trim()));
    const order = peopleList().filter((x) => x.inGrafik);
    if (!Number.isFinite(n) || n < 1) { toast('Wpisz numer porządkowy (1, 2, 3…)'); return; }
    const to = Math.min(n, order.length), from = order.findIndex((x) => x.id === p.id) + 1;
    if (to === from) return;
    const list = gPeople().slice(), i = list.findIndex((g) => g.id === p.id);
    const [me] = list.splice(i, 1);
    // miejsce: przed osobą, która ma teraz numer [to] (przy przesuwaniu w dół – za nią)
    const target = order[to - 1]; let j = list.findIndex((g) => g.id === target.id);
    if (to > from) j += 1;
    list.splice(j, 0, me);
    try { await saveMeta({ people: list }); toast(`${p.name}: Lp ${from} → ${to}`); }
    catch (e) { toast('Nie zapisano kolejności: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
  }
  /** Usuwanie pracownika: cztery kolejne potwierdzenia z ostrzeżeniami (na końcu trzeba wpisać nazwisko). */
  async function removePerson(p) {
    const steps = [
      ['Usuń pracownika (1/4)', `Czy na pewno usunąć ${p.name}${p.nr ? ' (' + p.nr + ')' : ''}?\n\n⚠ Osoba zniknie z Grafiku i z Kompetencji – u wszystkich użytkowników, na PC i na telefonach.`],
      ['Usuń pracownika (2/4)', `⚠ OSTRZEŻENIE: ${p.name} zniknie z tabel Grafiku (wiersz, kolory stanowiska, urlopy, plan urlopów) oraz z obsady stanowiska ${p.place || ''} w Harmonogramie i Planie.\n\n⚠ Wpisy zmian w Grafiku zostaną w bazie, ale nie będą nigdzie widoczne.`],
      ['Usuń pracownika (3/4)', `⚠ OSTRZEŻENIE: zostaną usunięte wszystkie dane kompetencji ${p.name}: badania lekarskie, BHP, uprawnienia z numerami i datami, umiejętności i punkty, data zatrudnienia.\n\n⚠ Tej operacji NIE MOŻNA cofnąć przyciskiem „Cofnij”.`],
    ];
    for (const [title, text] of steps) if (!(await confirmBox(title, text, 'Dalej'))) { toast('Usuwanie przerwane'); return; }
    const typed = await promptName(p.name);
    if (typed == null) { toast('Usuwanie przerwane'); return; }
    if (typed.trim().toLowerCase() !== String(p.name).trim().toLowerCase()) { toast('Nazwisko się nie zgadza – usuwanie przerwane', true); return; }
    try {
      if (p.inGrafik) await saveMeta({ people: gPeople().filter((g) => g.id !== p.id) });
      if (kpPeople()[p.id]) await deletePerson(p.id);
      st.sel = null; toast(`Usunięto: ${p.name}`);
    } catch (e) { toast('Nie usunięto: ' + (e.message || e), true); }
  }
  /** Ostatnie (4/4) potwierdzenie: wpisanie nazwiska. Zwraca wpisany tekst albo null (Anuluj). */
  function promptName(name) {
    return new Promise((resolve) => {
      const inp = h('input', { style: { width: '100%', padding: '6px' }, placeholder: name });
      let done = false; const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
      const m = modal('Usuń pracownika (4/4)', h('div', {},
        h('p', { class: 'err' }, `⚠ OSTATNIE OSTRZEŻENIE: usuwasz ${name} na stałe z Grafiku i Kompetencji.`),
        h('p', {}, 'Aby potwierdzić, wpisz dokładnie nazwisko i imię pracownika:'), inp,
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => fin(null) }, 'Anuluj'), h('button', { class: 'btn primary', style: { background: '#c00000', borderColor: '#c00000' }, onclick: () => fin(inp.value) }, 'Usuń na stałe'))),
        { onClose: () => fin(null) });
      setTimeout(() => inp.focus(), 50);
    });
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
          h('td', {}, 'ważne ', cell(x, 'validYears', '50px', 'number'), ' lat od wydania (0 – tylko wpisana data)'),
          h('td', {}, h('button', { class: 'btn small', onclick: () => { pr.splice(i, 1); render(); } }, 'Usuń'))))))),
        h('button', { class: 'btn small', onclick: () => { pr.push({ key: 'u' + Date.now().toString(36), name: '' }); render(); } }, 'Dodaj uprawnienie'),
        h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } }, h('span', { class: 'muted' }, 'Z pliku Excel (arkusz „MK”):'),
          h('button', { class: 'btn small', onclick: () => { m.close(); doImport(); } }, 'Umiejętności z Excela'), h('button', { class: 'btn small', onclick: () => { m.close(); doImportPerms(); } }, 'Uprawnienia z Excela')),
        h('p', { class: 'muted' }, 'Każde uprawnienie ma trzy kolumny: numer, data wydania, data ważności. Termin ważności jest czerwony, gdy minął, i pomarańczowy, gdy mija w ciągu 30 dni.'));
    };
    render();
    const m = modal('Kolumny matrycy kompetencji', h('div', {}, box, h('p', { class: 'muted' }, 'Usunięcie kolumny ukrywa ją; wpisane wartości zostają w danych pracowników.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        const skillsOut = sk.filter((x) => String(x.name).trim()).map((x) => ({ key: x.key, name: String(x.name).trim(), weight: Number(x.weight) || 0, color: x.color || '#d9d9d9' }));
        const permsOut = pr.filter((x) => String(x.name).trim()).map((x) => ({ key: x.key, name: String(x.name).trim(), ...(Number(x.validYears) > 0 ? { validYears: Number(x.validYears) } : {}) }));
        try { await saveDefs({ skills: skillsOut, perms: permsOut }); m.close(); toast('Zapisano kolumny'); } catch (e) { toast('Nie zapisano: ' + (e.message || e), true); }
      } }, 'Zapisz'))), { wide: true });
  }

  // ---------- filtry i sortowanie (zasady Harmonogramu) ----------
  function openFilter(c) {
    const fcols = allColumns(), pm = peopleMap(), ids = Object.keys(pm);
    const getV = (id, col) => (pm[id] ? value(pm[id], col) : '');
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
  /** Kolumny umiejętności (nazwy, wagi, kolory grup) i uprawnień z pliku Excel – bez pracowników i ich wartości. */
  function doImport() {
    const input = h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.remove(); if (!f) return;
      try {
        const sheets = await readXlsx(await f.arrayBuffer());
        const ws = sheets.find((x) => /^mk$/i.test(x.name)) || sheets[0];
        const r = K.parseCompetenceSheet(ws);
        // klucze kolumn z pliku (litery kolumn) – dotychczasowe wartości pracowników pod tymi samymi kluczami zostają
        if (!(await confirmBox('Umiejętności z pliku', `Plik „${f.name}”, arkusz „${ws.name}”: umiejętności ${r.skills.length} (z wagami i kolorami grup). Zastąpią obecne kolumny umiejętności. Pracownicy i ich poziomy nie są importowani. Kontynuować?`, 'Importuj'))) return;
        await saveDefs({ skills: r.skills });
        toast(`Zaimportowano umiejętności: ${r.skills.length}`);
      } catch (e) { toast('Import nieudany: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
    });
    document.body.append(input); input.click();
  }

  /**
   * Uprawnienia pracowników z pliku Excel (arkusz MK): numer, data wydania, data ważności każdego uprawnienia – dopasowanie osób
   * po wydziale i nr ew. (jak w Grafiku), a gdy brak numeru – po nazwisku. Daty „waż. …” trafiają do ważności, „wyd. …” do wydania.
   */
  function doImportPerms() {
    const input = h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.remove(); if (!f) return;
      try {
        const sheets = await readXlsx(await f.arrayBuffer());
        const ws = sheets.find((x) => /^mk$/i.test(x.name)) || sheets[0];
        const r = K.parsePermsSheet(ws, isoToday());
        const pm = peopleMap(), norm = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const byName = new Map(Object.values(pm).map((p) => [norm(p.name), p.id]));
        const changes = [], missed = [];
        for (const [id, x] of Object.entries(r.people)) {
          if (!Object.keys(x.perms).length) continue;
          const target = pm[id] ? id : byName.get(norm(x.name));
          if (!target) { missed.push(x.name); continue; }
          for (const [key, v] of Object.entries(x.perms)) changes.push({ id: target, path: `perms.${key}`, value: v });
        }
        const people = new Set(changes.map((c) => c.id)).size;
        if (!(await confirmBox('Uprawnienia z pliku', `Plik „${f.name}”, arkusz „${ws.name}”: uprawnienia ${people} pracowników (${changes.length} wpisów)` + (missed.length ? `; bez dopasowania w Grafiku: ${missed.length}` : '') + '. Zastąpią obecne wpisy tych uprawnień. Kontynuować?', 'Importuj'))) return;
        if (!K.isNewPermDefs(st.data && st.data.perms)) await saveDefs({ perms: K.PERM_TYPES });
        for (let i = 0; i < changes.length; i += 200) await setFields(changes.slice(i, i + 200));
        st.undo = []; st.redo = [];
        toast(`Zaimportowano uprawnienia: ${people} pracowników` + (missed.length ? ` (bez dopasowania: ${missed.length})` : ''));
      } catch (e) { toast('Import nieudany: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
    });
    document.body.append(input); input.click();
  }

  const setZoom = (v) => { st.zoom = Math.max(50, Math.min(200, v)); lsSet('kp.zoom', st.zoom); draw(); };   // Ctrl + kółko myszy
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });
  function cleanup() { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste); if (unsub) { unsub(); unsub = null; } if (unsubG) { unsubG(); unsubG = null; } }

  const broom = (() => { const t = 'Wyczyść filtry i sortowanie'; const b = h('button', { class: 'btn small', title: t, 'aria-label': t, style: { width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, onclick: () => { st.filters = {}; st.sorts = []; saveFilters(); draw(); } }); b.append(iconSvg('broom')); return b; })();
  // tylko osoby z uprawnieniem, którego termin minął albo mija w ciągu 30 dni
  const alertBtn = h('button', { class: 'btn small', title: 'Pokaż tylko pracowników z terminem do odnowienia: uprawnienia – do 3 miesięcy, badania i BHP – do miesiąca, albo po terminie', onclick: () => { st.onlyAlerts = !st.onlyAlerts; if (st.onlyAlerts) { st.groups.med = true; st.groups.perms = true; lsSet('kp.groups', st.groups); } draw(); } }, '⚠ Terminy');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Kompetencje'), ...groupBtns, alertBtn, broom,
    h('button', { class: 'btn small', title: 'Cofnij (Ctrl+Z)', onclick: () => undoRedo(st.undo, st.redo) }, '↶'), h('button', { class: 'btn small', title: 'Ponów (Ctrl+Y)', onclick: () => undoRedo(st.redo, st.undo) }, '↷'),
    canWrite ? h('button', { class: 'btn small', onclick: () => addPerson() }, 'Dodaj pracownika') : null,
    canWrite ? h('button', { class: 'btn small', onclick: defsDialog }, 'Kolumny…') : null,
    h('span', { class: 'grow' }), info), body);
  start();
  return cleanup;
}
