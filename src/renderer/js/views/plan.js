// Plan: arkusz PLAN jak w Excelu. Tabela rysuje tylko widoczne wiersze (przewijanie bez przebudowy całości), zmiana komórki
// odświeża tylko widoczny fragment. Obsługa jak w Excelu:
//  - klik zaznacza komórkę, Shift+klik / przeciągnięcie – zakres, Ctrl+A – wszystko; strzałki, Tab, Enter, Home/End, PageUp/PageDown, Ctrl+Home/End;
//  - pisanie zaczyna edycję w komórce, F2 / dwuklik – edycja z dotychczasowym tekstem; Alt+Enter – nowa linia; Enter/Tab – zatwierdź, Esc – anuluj;
//  - Ctrl+C / Ctrl+X / Ctrl+V – schowek zgodny z Excelem i Arkuszami Google (także wiele komórek; jedna komórka wklejona w zakres wypełnia zakres);
//  - Delete – czyści zaznaczone komórki; Ctrl+Z / Ctrl+Y – cofnij / ponów (zmiany czekają na „Zapisz zmiany”, jak dotąd);
//  - przeciągnięcie krawędzi nagłówka kolumny (litery) albo numeru wiersza zmienia rozmiar, dwuklik na krawędzi – dopasowanie do tekstu.
// Szerokości kolumn są osobiste (zapisywane na tym komputerze); wysokości wierszy i czcionka – wspólne (Firestore plan_layout/main, na żywo).
// Dane planu są w bazie Firebase (planStore.js), a każdy zapis trafia też do karty PLAN arkusza. Wiersz edytowanej komórki ma zawsze zieloną poświatę.
import { h, clear, api, apiCached, toast, confirmBox, alertBox } from '../ui.js';
import * as P from '../logic/plan.js';
import * as G from '../logic/planGrid.js';
import { parseSheetColor } from '../logic/common.js';
import { watchPlanLayout, savePlanLayout } from '../planLayout.js';
import { watchPlan, savePlan, importPlanFromSheet } from '../planStore.js';
import { openPersonCard } from './personCard.js';
import { normalizeGrid, blockOf, shiftOfText, withShift, SHIFT_NAMES, SHIFT_ROMAN, SHIFTS, normShift, workersForShift, komisHistory, komisSuggestions, komisFragment, isKomisColumn } from '../logic/planHints.js';
import { firebaseDayPeople } from '../logic/harmDay.js';
import { syncButton } from '../syncStore.js';
import { firebase } from '../fb.js';
import * as GF from '../logic/grafikFb.js';
import { grafikLevelOf } from '../logic/grafikAccess.js';
import { datePickerDialog } from './datePicker.js';

const LETTERS_H = 22, GUTTER_W = 46, HANDLE = 5;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci */ } };

export function mountPlan(el, ctx) {
  const st = {
    grid: null, fresh: false, expanded: new Set(), changes: new Map(), saving: false,
    zoom: lsGet('plan.zoom', 100), layout: G.cleanLayout(null), local: { cols: {}, rows: {} },
    vis: [], cols: [], autoW: [], myCols: lsGet('plan.cols', {}) || {}, glow: true, autoH: new Map(), offs: [0], heights: [],
    sel: null, editing: null, undo: [], redo: [], unwatch: null, layoutErr: '',
  };
  const body = h('div', { tabindex: '0', style: { flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', outline: 'none', background: '#e9e9e9' } });
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: save }, 'Zapisz zmiany');
  const zoomLabel = h('button', { class: 'btn small', title: 'Powiększenie (tylko u Ciebie). Kliknij: 100%', onclick: () => setZoom(100) }, '100%');
  const fontLabel = h('span', { class: 'muted', title: 'Wielkość czcionki tabeli – wspólna dla wszystkich' });
  const info = h('span', { class: 'muted' });

  // ---------- dane: z bazy Firebase na żywo (karta PLAN dostaje kopię każdego zapisu) ----------
  let unwatchPlan = null;
  async function load() {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie planu…'));
    if (unwatchPlan) { unwatchPlan(); unwatchPlan = null; }
    try {
      unwatchPlan = await watchPlan((g, info = {}) => {
        if (!g) { st.grid = null; clear(body); body.append(h('div', { style: { padding: '14px' } }, h('p', {}, 'Planu nie ma jeszcze w bazie.'),
          h('p', { class: 'muted' }, info.rowDocs ? `W bazie są wiersze planu (plan_rows: ${info.rowDocs}), ale brak dokumentu plan_meta/main – import nie dokończył się. Zaimportuj ponownie.`
            : info.server ? 'Serwer Firebase potwierdza: brak plan_meta/main i plan_rows.' : 'Nie udało się potwierdzić na serwerze – sprawdź połączenie z internetem.'),
          isGod() ? h('button', { class: 'btn primary', onclick: doImport }, 'Import z karty PLAN arkusza') : h('p', { class: 'muted' }, 'Import z arkusza robi osoba z poziomem GOD (kolumna „Grafik dostęp”).'))); syncInfo(); return; }
        st.grid = normalizeGrid(g); st.grid.canEdit = ctx.level('plan') === 'write'; st.fresh = true;
        rebuild();
      }, (e) => { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy Planu: ' + (e.code === 'permission-denied' ? 'brak uprawnień (opublikuj reguły Firestore: plan_meta, plan_rows)' : e.message || e), ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów'))); },
      (ctx.user && ctx.user.email) || '');
    } catch (e) { clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów'))); }
  }
  // prawy przycisk na komórce z pracownikiem – karta pracownika (Grafik: urlopy, godziny; Kompetencje: badania, uprawnienia, umiejętności)
  body.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest && e.target.closest('[data-r][data-c]'); if (!cell || !st.grid) return;
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    if (kind(r, c) !== 'worker') return;
    const name = cellText(r, c).trim(); if (!name) return;
    e.preventDefault();
    openPersonCard({ name }, { access: ctx.grafikAcc ? ctx.grafikAcc() : { summary: true } });
  });
  const lvl = () => grafikLevelOf(ctx.user);
  const isGod = () => lvl() === 'god';
  const isMaster = () => lvl() === 'god' || lvl() === 'master';
  /** Pracownicy z wpisem w Grafiku w dniu [iso] – z bazy Firebase (kształt jak dawniej z karty G). */
  async function grafikDayFb(iso) {
    const { sdk, db } = await firebase();
    const [meta, month] = await Promise.all([sdk.getDoc(sdk.doc(db, 'gr_meta', 'main')), sdk.getDoc(sdk.doc(db, 'gr_days', iso.slice(0, 7)))]);
    const codes = GF.unpackMonths({ [iso.slice(0, 7)]: month.exists() ? month.data() : {} }).codes;
    return firebaseDayPeople(meta.exists() ? meta.data().people : [], codes, iso, [], GF.cellStyle, GF.placeStation);
  }
  async function doImport() {
    if (!(await confirmBox('Import z arkusza', 'Plan w bazie zostanie zastąpiony zawartością karty PLAN arkusza (wartości, kolory, formatowanie). Niezapisane zmiany przepadną. Kontynuować?', 'Importuj'))) return;
    toast('Import karty PLAN…');
    try { const r = await importPlanFromSheet(user()); st.changes = new Map(); st.undo = []; st.redo = []; toast(`Zaimportowano plan: wierszy ${r.rows}`); }
    catch (e) { toast('Import nieudany: ' + (e.code === 'permission-denied' ? 'brak uprawnień (reguły Firestore)' : e.message || e), true); }
  }
  // wspólny układ: na żywo z bazy
  (async () => {
    try { st.unwatch = await watchPlanLayout((l) => { st.layout = l; st.local = { cols: {}, rows: {} }; st.layoutErr = ''; if (st.grid) relayout(); }, (e) => { st.layoutErr = 'układ wspólny niedostępny (' + (e.code || e.message) + ')'; syncInfo(); }); }
    catch (e) { st.layoutErr = 'układ wspólny niedostępny'; syncInfo(); }
  })();

  const key = (r, c) => r + ':' + c;
  const kind = (r, c) => st.grid.kinds?.[r]?.[c] || 'static';
  const canEdit = () => !!st.grid && !!st.grid.canEdit && ctx.level('plan') === 'write' && st.fresh;
  const editable = (r, c) => canEdit() && ['edit', 'date', 'worker'].includes(kind(r, c));
  const originalLines = (r, c) => {
    const runs = st.grid.runs?.[r]?.[c];
    if (runs) return P.splitLines(runs);
    const text = String(st.grid.values[r]?.[c] ?? '');
    return P.splitLines(text ? [{ text, color: st.grid.fontColors?.[r]?.[c] || '#000000' }] : []);
  };
  const currentLines = (r, c) => { const e = st.changes.get(key(r, c)); return e && e.type === 'text' ? e.lines : originalLines(r, c); };
  /** Tekst komórki (do schowka, wysokości i edycji): po zmianach, data jak w arkuszu. */
  const cellText = (r, c) => {
    const e = st.changes.get(key(r, c));
    if (e) return e.type === 'text' ? P.plainText(e.lines) : e.display;
    return kind(r, c) === 'edit' ? P.plainText(originalLines(r, c)) : String(st.grid.values[r]?.[c] ?? '');
  };

  // ---------- układ: kolumny, wiersze, wysokości ----------
  let measureCtx = null; const mcache = new Map(); let mfont = '';
  const measure = (s) => {
    const f = `${st.layout.font}px ${getComputedStyle(document.body).fontFamily}`;
    if (f !== mfont) { mfont = f; mcache.clear(); measureCtx = measureCtx || document.createElement('canvas').getContext('2d'); measureCtx.font = f; }
    let w = mcache.get(s); if (w == null) { w = measureCtx.measureText(s).width; mcache.set(s, w); } return w;
  };
  // szerokości kolumn: własne (zapisane na tym komputerze) → dawne wspólne → dopasowanie do tekstu
  const baseColW = (c) => st.myCols[c] ?? st.layout.cols[c] ?? st.autoW[c] ?? 80;
  const rk = (r) => G.rowKey(st.grid, r);
  const ownRowH = (r) => st.local.rows[rk(r)] ?? st.layout.rows[rk(r)];
  const autoRow = (r) => {
    let v = st.autoH.get(r);
    if (v == null) {
      let lines = 1;
      for (const c of st.cols) lines = Math.max(lines, G.wrappedLines(cellText(r, c), baseColW(c), measure));
      v = G.autoRowHeight(lines, st.layout.font); st.autoH.set(r, v);
    }
    return v;
  };
  const baseRowH = (r) => ownRowH(r) ?? autoRow(r);
  const Z = () => st.zoom / 100;
  const colW = (c) => Math.round(baseColW(c) * Z());
  const rowH = (r) => Math.round(baseRowH(r) * Z());
  const font = () => st.layout.font * Z();

  function rebuild() {
    const g = st.grid;
    const n = Math.max(0, ...g.values.map((r) => r.length));
    st.cols = []; for (let c = g.firstVisibleCol ?? 1; c < n; c++) if (kind(0, c) !== 'hidden') st.cols.push(c);
    const w = P.columnWidths(g); st.autoW = w.map((x) => Math.round(x * st.layout.font / G.DEFAULT_FONT));
    st.sel = st.sel && st.sel.r1 < 1e9 ? st.sel : null;
    relayout();
  }
  /** Po zmianie szerokości, czcionki, powiększenia, zwinięcia bloków albo treści: wysokości od nowa i rysowanie. */
  function relayout({ keepAuto = false } = {}) {
    if (!st.grid) return;
    if (!keepAuto) st.autoH = new Map();
    st.vis = P.visibleRows(st.grid, st.expanded).filter((r) => r > 0);
    st.heights = st.vis.map(rowH); st.offs = G.offsets(st.heights);
    if (st.sel) { const max = st.vis.length - 1; for (const k of ['r0', 'r1']) st.sel[k] = Math.max(0, Math.min(max, st.sel[k])); }
    frame();
  }

  // ---------- rysowanie ----------
  let inner = null, rowsLayer = null, selLayer = null, headRow = null, painted = '';
  const headH = () => LETTERS_H + rowH(0);
  const colLeft = (ci) => { let x = GUTTER_W; for (let i = 0; i < ci; i++) x += colW(st.cols[i]); return x; };
  const totalW = () => colLeft(st.cols.length);

  function frame() {
    const sy = body.scrollTop, sx = body.scrollLeft;
    clear(body);
    inner = h('div', { style: { position: 'relative', width: totalW() + 'px', height: headH() + st.offs[st.offs.length - 1] + 'px', fontSize: font() + 'px', lineHeight: '1.3', userSelect: 'none' } });
    rowsLayer = h('div', { style: { position: 'absolute', left: 0, top: 0 } });
    selLayer = h('div', { style: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 3 } });
    headRow = buildHead();
    inner.append(rowsLayer, selLayer, headRow);
    body.append(inner);
    body.scrollTop = sy; body.scrollLeft = sx;
    painted = ''; paint(); paintSel(); syncInfo();
  }
  // nagłówek: litery kolumn (z uchwytem zmiany szerokości) i pierwszy wiersz arkusza – przyklejone u góry
  function buildHead() {
    const head = h('div', { style: { position: 'sticky', top: 0, zIndex: 5, width: totalW() + 'px', height: headH() + 'px' } });
    const corner = h('div', { title: 'Zaznacz wszystko (Ctrl+A)', onmousedown: (e) => { e.preventDefault(); selectAll(); }, style: { position: 'sticky', left: 0, zIndex: 6, width: GUTTER_W + 'px', height: headH() + 'px', background: '#d9d9d9', borderRight: '1px solid #aaa', borderBottom: '1px solid #aaa', boxSizing: 'border-box', float: 'left' } });
    head.append(corner);
    st.cols.forEach((c, ci) => {
      const x = colLeft(ci), w = colW(c), own = (st.myCols[c] ?? st.layout.cols[c]) != null;
      const letter = h('div', { onmousedown: (e) => { if (e.target === letter) { e.preventDefault(); selectCol(ci, e.shiftKey); } },
        title: `Kolumna ${G.colName(c)}${own ? ' (szerokość ustawiona ręcznie)' : ''}. Przeciągnij prawą krawędź: szerokość, dwuklik na krawędzi: dopasuj`,
        style: { position: 'absolute', left: x + 'px', top: 0, width: w + 'px', height: LETTERS_H + 'px', lineHeight: LETTERS_H + 'px', textAlign: 'center', fontSize: '12px', background: '#e6e6e6', borderRight: '1px solid #aaa', borderBottom: '1px solid #aaa', boxSizing: 'border-box', color: own ? '#0b57d0' : '#333', fontWeight: own ? 700 : 400 } }, G.colName(c));
      const grip = h('div', { title: 'Przeciągnij: szerokość kolumny (Twoja, zapisywana na tym komputerze). Dwuklik: dopasuj do tekstu', style: { position: 'absolute', right: '-3px', top: 0, width: HANDLE + 1 + 'px', height: '100%', cursor: 'col-resize', zIndex: 2 },
        onmousedown: (e) => startResize(e, 'col', c), ondblclick: (e) => { e.stopPropagation(); setColWidth(c, null); } });
      letter.append(grip);
      head.append(letter);
      const tmp = h('div', {}); tmp.innerHTML = cellHtml(0, c, w, rowH(0), x, LETTERS_H);
      head.append(tmp.firstChild);
    });
    return head;
  }
  function cellHtml(r, c, w, hgt, left, top = 0) {
    const g = st.grid, k = kind(r, c), changed = st.changes.has(key(r, c));
    const bg = parseSheetColor(g.backgrounds?.[r]?.[c], '#ffffff'), fg = parseSheetColor(g.fontColors?.[r]?.[c], '#000000');
    let inner = '';
    if (k === 'edit' && !changed && g.runs?.[r]?.[c] || (k === 'edit' && changed)) {
      inner = currentLines(r, c).map((line) => line.map((run) => `<span style="color:${esc(parseSheetColor(run.color, '#000'))}">${esc(run.text)}</span>`).join('')).join('<br>');
    } else inner = esc(cellText(r, c)).replace(/\n/g, '<br>');
    const block = P.blockHeadedBy(g, r);
    if (block && k === 'edit' && /KARTA PRACY/i.test(String(g.values[r]?.[c] ?? ''))) inner = `<b data-toggle="${esc(block.id)}" style="cursor:pointer;margin-right:4px">${st.expanded.has(block.id) ? '▼' : '▶'}</b>` + inner;
    const style = `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${hgt}px;box-sizing:border-box;border-right:1px solid #c8c8c8;border-bottom:1px solid #c8c8c8;padding:2px 4px;overflow:hidden;white-space:pre-wrap;word-break:break-word;background:${esc(bg)};color:${esc(fg)};${changed ? 'box-shadow:inset 0 0 0 2px #e65100;' : ''}`;
    return `<div data-r="${r}" data-c="${c}" style="${style}">${inner}</div>`;
  }
  // tylko wiersze w oknie (z zapasem); przy przewijaniu dorysowywane
  function paint(force) {
    if (!rowsLayer || !st.vis.length) { if (rowsLayer) clear(rowsLayer); return; }
    const top = Math.max(0, body.scrollTop - headH()), vh = body.clientHeight || 800;
    const i0 = Math.max(0, G.rowAt(st.offs, top) - 5), i1 = Math.min(st.vis.length - 1, G.rowAt(st.offs, top + vh) + 5);
    const tag = i0 + ':' + i1;
    if (!force && tag === painted) return;
    painted = tag;
    const parts = [];
    const lefts = st.cols.map((_, ci) => colLeft(ci)), ws = st.cols.map(colW);
    for (let i = i0; i <= i1; i++) {
      const r = st.vis[i], y = headH() + st.offs[i], hgt = st.heights[i], own = ownRowH(r) != null;
      parts.push(`<div style="position:absolute;left:0;top:${y}px;width:${totalW()}px;height:${hgt}px">`);
      st.cols.forEach((c, ci) => parts.push(cellHtml(r, c, ws[ci], hgt, lefts[ci])));
      parts.push(`<div data-gutter="${i}" title="Wiersz ${r + 1}. Przeciągnij dolną krawędź: wysokość (wspólna), dwuklik na krawędzi: dopasuj" style="position:sticky;left:0;z-index:2;width:${GUTTER_W}px;height:${hgt}px;box-sizing:border-box;background:#e6e6e6;border-right:1px solid #aaa;border-bottom:1px solid #aaa;font-size:12px;text-align:center;padding-top:2px;color:${own ? '#0b57d0' : '#333'};font-weight:${own ? 700 : 400}">${r + 1}<div data-rowgrip="${i}" style="position:absolute;left:0;right:0;bottom:-3px;height:${HANDLE + 1}px;cursor:row-resize"></div></div>`);
      parts.push('</div>');
    }
    rowsLayer.innerHTML = parts.join('');
  }
  body.addEventListener('scroll', () => requestAnimationFrame(() => paint()));
  const onResize = () => paint(true);
  window.addEventListener('resize', onResize);

  // ---------- zaznaczenie ----------
  const selRect = () => { const s = st.sel; return { ra: Math.min(s.r0, s.r1), rb: Math.max(s.r0, s.r1), ca: Math.min(s.c0, s.c1), cb: Math.max(s.c0, s.c1) }; };
  function paintSel() {
    if (!selLayer) return;
    clear(selLayer);
    if (!st.sel || !st.vis.length) return;
    const { ra, rb, ca, cb } = selRect();
    // podświetlenie (lekka zielona poświata) wiersza, w którym jest aktywna komórka – zawsze włączone
    if (st.glow) { const gy = headH() + st.offs[st.sel.r1];
      selLayer.append(h('div', { style: { position: 'absolute', left: GUTTER_W + 'px', top: gy + 'px', width: Math.max(0, totalW() - GUTTER_W) + 'px', height: st.heights[st.sel.r1] + 'px',
        background: 'rgba(0,176,80,.10)', boxShadow: '0 0 8px 2px rgba(0,176,80,.55), inset 0 0 0 1px rgba(0,176,80,.7)', boxSizing: 'border-box' } })); }
    const x = colLeft(ca), y = headH() + st.offs[ra], w = colLeft(cb + 1) - x, hh = st.offs[rb + 1] - st.offs[ra];
    selLayer.append(h('div', { style: { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', border: '2px solid #1a73e8', background: ra !== rb || ca !== cb ? 'rgba(26,115,232,.10)' : 'transparent', boxSizing: 'border-box' } }));
    const ax = colLeft(st.sel.c1), ay = headH() + st.offs[st.sel.r1];
    selLayer.append(h('div', { style: { position: 'absolute', left: ax + 'px', top: ay + 'px', width: colW(st.cols[st.sel.c1]) + 'px', height: st.heights[st.sel.r1] + 'px', border: '2px solid #0b57d0', boxSizing: 'border-box' } }));
  }
  function setSel(r, c, extend) {
    if (!st.vis.length || !st.cols.length) return;
    r = Math.max(0, Math.min(st.vis.length - 1, r)); c = Math.max(0, Math.min(st.cols.length - 1, c));
    st.sel = extend && st.sel ? { ...st.sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c };
    paintSel(); ensureVisible(r, c); syncInfo();
  }
  const selectAll = () => { if (!st.vis.length) return; st.sel = { r0: 0, c0: 0, r1: st.vis.length - 1, c1: st.cols.length - 1 }; paintSel(); };
  const selectCol = (ci, ext) => { if (!st.vis.length) return; st.sel = ext && st.sel ? { ...st.sel, r1: st.vis.length - 1, c1: ci } : { r0: 0, c0: ci, r1: st.vis.length - 1, c1: ci }; paintSel(); body.focus(); };
  function ensureVisible(i, ci) {
    const y = headH() + st.offs[i], hh = st.heights[i];
    if (y - headH() < body.scrollTop) body.scrollTop = y - headH();
    else if (y + hh > body.scrollTop + body.clientHeight) body.scrollTop = y + hh - body.clientHeight;
    const x = colLeft(ci), w = colW(st.cols[ci]);
    if (x - GUTTER_W < body.scrollLeft) body.scrollLeft = x - GUTTER_W;
    else if (x + w > body.scrollLeft + body.clientWidth) body.scrollLeft = x + w - body.clientWidth;
  }
  const cellFromEvent = (e) => { const d = e.target.closest && e.target.closest('[data-r]'); if (!d || !rowsLayer || !rowsLayer.contains(d)) return null; const r = +d.dataset.r, c = +d.dataset.c; return { i: st.vis.indexOf(r), ci: st.cols.indexOf(c) }; };
  let dragSel = false;
  body.addEventListener('mousedown', (e) => {
    if (st.editing && !st.editing.wrap.contains(e.target)) { st.editing.finish(true); return; }
    if (e.button !== 0 || st.editing || !rowsLayer) return;
    const t = e.target;
    if (t.dataset && t.dataset.toggle) { e.preventDefault(); const id = t.dataset.toggle; st.expanded.has(id) ? st.expanded.delete(id) : st.expanded.add(id); relayout({ keepAuto: true }); return; }
    if (t.dataset && t.dataset.rowgrip != null) { e.preventDefault(); startResize(e, 'row', st.vis[+t.dataset.rowgrip]); return; }
    const g = t.closest && t.closest('[data-gutter]');
    if (g && rowsLayer.contains(g)) { e.preventDefault(); const i = +g.dataset.gutter; st.sel = e.shiftKey && st.sel ? { ...st.sel, r1: i, c1: st.cols.length - 1 } : { r0: i, c0: 0, r1: i, c1: st.cols.length - 1 }; paintSel(); body.focus(); return; }
    const p = cellFromEvent(e); if (!p || p.i < 0) return;
    e.preventDefault(); body.focus();
    setSel(p.i, p.ci, e.shiftKey); dragSel = true;
  });
  body.addEventListener('mousemove', (e) => { if (!dragSel || !(e.buttons & 1)) { dragSel = false; return; } const p = cellFromEvent(e); if (p && p.i >= 0 && st.sel && (p.i !== st.sel.r1 || p.ci !== st.sel.c1)) { st.sel = { ...st.sel, r1: p.i, c1: p.ci }; paintSel(); } });
  const onUp = () => { dragSel = false; };
  document.addEventListener('mouseup', onUp);
  body.addEventListener('dblclick', (e) => {
    if (e.target.dataset && (e.target.dataset.rowgrip != null)) { const r = st.vis[+e.target.dataset.rowgrip]; setRowHeight(r, null); return; }
    const p = cellFromEvent(e); if (!p || p.i < 0) return;
    setSel(p.i, p.ci, false); beginEdit(null);
  });

  // ---------- zmiana rozmiaru kolumn i wierszy (wspólna) ----------
  function startResize(e, what, id) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, base = what === 'col' ? baseColW(id) : baseRowH(id);
    const guide = h('div', { style: { position: 'fixed', zIndex: 9999, background: '#1a73e8', pointerEvents: 'none', ...(what === 'col' ? { top: body.getBoundingClientRect().top + 'px', bottom: 0, width: '2px', left: x0 + 'px' } : { left: body.getBoundingClientRect().left + 'px', right: 0, height: '2px', top: y0 + 'px' }) } });
    const tip = h('div', { style: { position: 'fixed', zIndex: 9999, background: '#333', color: '#fff', font: '12px sans-serif', padding: '2px 6px', borderRadius: '0', pointerEvents: 'none' } });
    document.body.append(guide, tip);
    let v = base;
    const move = (ev) => {
      const d = (what === 'col' ? ev.clientX - x0 : ev.clientY - y0) / Z();
      v = Math.round(Math.max(what === 'col' ? G.MIN_COL : G.MIN_ROW, Math.min(what === 'col' ? G.MAX_COL : G.MAX_ROW, base + d)));
      if (what === 'col') guide.style.left = ev.clientX + 'px'; else guide.style.top = ev.clientY + 'px';
      Object.assign(tip.style, { left: ev.clientX + 12 + 'px', top: ev.clientY + 12 + 'px' }); tip.textContent = `${what === 'col' ? 'Szerokość' : 'Wysokość'}: ${v} px`;
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); guide.remove(); tip.remove(); if (v !== base) (what === 'col' ? setColWidth(id, v) : setRowHeight(id, v)); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  const user = () => (ctx.user && (ctx.user.name || ctx.user.email)) || '';
  /** Szerokość kolumny – ustawienie własne, zapisywane automatycznie na tym komputerze (null – dopasowanie do tekstu). */
  function setColWidth(c, v) {
    if (v == null) { delete st.myCols[c]; delete st.layout.cols[c]; } else st.myCols[c] = v;
    lsSet('plan.cols', st.myCols);
    relayout();
  }
  function setRowHeight(r, v) {
    const k = rk(r);
    st.local.rows[k] = v; if (v == null) { st.local.rows[k] = undefined; delete st.layout.rows[k]; }
    relayout({ keepAuto: true });
    savePlanLayout({ rows: { [k]: v } }, user()).catch((e) => toast('Nie zapisano układu dla wszystkich: ' + (e.code === 'permission-denied' ? 'brak uprawnień (reguły Firestore)' : e.message || e), true));
  }
  function setFont(v) {
    const f = Math.max(8, Math.min(28, v));
    st.layout = { ...st.layout, font: f }; rebuild();
    savePlanLayout({ font: f }, user()).catch((e) => toast('Nie zapisano czcionki dla wszystkich: ' + (e.message || e), true));
  }
  const setZoom = (z) => { st.zoom = Math.max(40, Math.min(250, Math.round(z))); lsSet('plan.zoom', st.zoom); zoomLabel.textContent = st.zoom + '%'; if (st.grid) relayout({ keepAuto: true }); };
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

  // ---------- zmiany komórek (czekają na „Zapisz zmiany”), cofanie ----------
  /** Wpis zmiany dla komórki z tekstu albo powód odmowy (string). */
  function entryFor(r, c, text) {
    const k = kind(r, c);
    if (!editable(r, c)) return 'tylko do odczytu';
    if (k === 'edit') {
      const clean = String(text ?? '').replace(/\r/g, '');
      const orig = P.plainText(originalLines(r, c));
      if (clean === orig || (clean === P.FIRST_ITEM && orig === '')) return null;
      const lines = P.composeLines(currentLines(r, c), clean, st.grid.userColor || '#000000');
      return { type: 'text', lines, get display() { return P.plainText(this.lines); } };
    }
    if (k === 'worker') {
      const t = String(text ?? '').trim(), orig = String(st.grid.values[r]?.[c] ?? '');
      const w = t ? (st.grid.workers || []).find((x) => x.toLowerCase() === t.toLowerCase()) : '';
      if (w == null) return `„${t}” nie ma na liście pracowników`;
      return w === orig ? null : { type: 'plain', value: w, display: w };
    }
    if (k === 'date') {
      const iso = G.parseDateText(text), orig = st.grid.dateCells?.find((d) => d.row === r && d.col === c)?.value || '';
      if (iso == null) return `„${text}” to nie data (dd-mm-rrrr)`;
      return iso === orig ? null : { type: 'plain', value: iso, display: P.displayDate(iso) };
    }
    return 'tylko do odczytu';
  }
  /** Zmiany wielu komórek naraz (jeden krok cofania). [items]: [{r, c, text}]. Zwraca {done, skipped: [powody]}. */
  function applyCells(items, label) {
    const before = new Map(), skipped = [];
    for (const { r, c, text } of items) {
      const res = entryFor(r, c, text);
      if (typeof res === 'string') { skipped.push(`${G.colName(c)}${r + 1}: ${res}`); continue; }
      const k = key(r, c);
      if (!before.has(k)) before.set(k, st.changes.get(k));
      if (res == null) st.changes.delete(k); else st.changes.set(k, res);
      st.autoH.delete(r);
    }
    const done = [...before.keys()].filter((k) => before.get(k) !== st.changes.get(k));
    if (done.length) { st.undo.push({ label, before }); if (st.undo.length > 100) st.undo.shift(); st.redo = []; contentChanged(); }
    return { done: done.length, skipped };
  }
  function contentChanged() { st.heights = st.vis.map(rowH); st.offs = G.offsets(st.heights); if (inner) inner.style.height = headH() + st.offs[st.offs.length - 1] + 'px'; paint(true); paintSel(); syncInfo(); }
  function undoRedo(from, to) {
    const step = from.pop(); if (!step) return;
    const back = new Map();
    for (const [k, v] of step.before) { back.set(k, st.changes.get(k)); if (v === undefined) st.changes.delete(k); else st.changes.set(k, v); st.autoH.delete(+k.split(':')[0]); }
    to.push({ label: step.label, before: back });
    contentChanged(); toast((from === st.undo ? 'Cofnięto: ' : 'Ponowiono: ') + step.label);
  }

  // ---------- edycja w komórce ----------
  // lista podpowiedzi pod polem edycji (pracownicy z Grafiku, komisy): strzałki ↑ ↓ wybierają, Enter albo klik wstawia
  function suggestList(onPick) {
    const el = h('div', { style: { position: 'absolute', zIndex: 9, background: '#fff', border: '1px solid #888', boxShadow: '0 3px 10px rgba(0,0,0,.3)', maxHeight: '280px', overflowY: 'auto', fontSize: '13px', lineHeight: '1.35', display: 'none', minWidth: '220px' } });
    let items = [], hi = -1;
    const render = () => {
      clear(el);
      items.forEach((it, i) => {
        if (it.head) { el.append(h('div', { style: { padding: '3px 8px', background: '#eef2f7', color: '#334', fontWeight: 700, fontSize: '12px' } }, it.head)); return; }
        const row = h('div', { onmousedown: (e) => { e.preventDefault(); onPick(it); }, onmousemove: () => { if (hi !== i) { hi = i; render(); } },
          style: { padding: '3px 8px', cursor: 'pointer', display: 'flex', gap: '10px', justifyContent: 'space-between', background: i === hi ? '#d2e3fc' : 'transparent', color: it.dim ? '#888' : '#000' } },
        h('span', {}, it.label), it.note ? h('span', { style: { color: it.noteColor || '#555', fontSize: '12px' } }, it.note) : null);
        el.append(row);
        if (i === hi) setTimeout(() => row.scrollIntoView({ block: 'nearest' }), 0);
      });
      el.style.display = items.some((x) => !x.head) || items.some((x) => x.head && x.always) ? 'block' : 'none';
    };
    const pickable = (i) => items[i] && !items[i].head;
    return {
      el,
      set(list, autoHi = false) { items = list; hi = autoHi ? list.findIndex((x, i) => pickable(i)) : -1; render(); },
      move(d) { if (el.style.display === 'none') return false; let i = hi; do { i += d; } while (i >= 0 && i < items.length && !pickable(i)); if (pickable(i)) { hi = i; render(); } return true; },
      current() { return pickable(hi) ? items[hi] : null; },
      pick(it) { onPick(it); },
      visible() { return el.style.display !== 'none'; },
      place(input) { el.style.left = input.offsetLeft + 'px'; el.style.top = input.offsetTop + input.offsetHeight + 2 + 'px'; },
    };
  }
  // Grafik dnia (pracownicy z wpisami) – pobierany raz na dzień
  const grCache = new Map();
  // podpowiedzi pracowników: Grafik z bazy Firebase (gr_meta, gr_days) – bez arkusza
  const grafikDay = (iso) => { if (!grCache.has(iso)) grCache.set(iso, grafikDayFb(iso).catch((e) => { grCache.delete(iso); throw e; })); return grCache.get(iso); };
  /** Data (rrrr-mm-dd) i zmiana ('a'|'b'|'c') bloku, w którym jest wiersz [r] – z uwzględnieniem niezapisanych zmian. */
  function blockDayShift(r) {
    const b = blockOf(st.grid, r); if (!b) return { iso: '', shift: null };
    const dc = (st.grid.dateCells || []).find((d) => d.row === b.headerRow);
    const ch = dc && st.changes.get(key(dc.row, dc.col));
    const iso = ch ? ch.value : dc ? dc.value : '';
    let shift = null;
    for (const c of st.cols) { const sh = shiftOfText(cellText(b.headerRow, c)); if (sh) { shift = sh; break; } }
    return { iso, shift: shift || normShift(b.shift) };
  }
  let komisHist = null, komisGrid = null;
  const komisy = () => { if (komisGrid !== st.grid) { komisGrid = st.grid; komisHist = komisHistory(st.grid, lsGet('plan.komisy', [])); } return komisHist; };
  const rememberKomisy = (texts) => {
    const found = []; for (const t of texts) for (const line of String(t).split('\n')) { const f = komisFragment(line); if (/^\d{2}\/\d{1,5}/.test(f)) found.push(f); }
    if (!found.length) return;
    const list = [...new Set([...found, ...lsGet('plan.komisy', [])])].slice(0, 400); lsSet('plan.komisy', list); komisGrid = null;
  };

  function beginEdit(typed) {
    if (!st.sel || st.editing) return;
    const r = st.vis[st.sel.r1], c = st.cols[st.sel.c1], k = kind(r, c);
    st.sel = { r0: st.sel.r1, c0: st.sel.c1, r1: st.sel.r1, c1: st.sel.c1 }; paintSel();
    if (!editable(r, c)) { toast(!canEdit() ? (st.fresh ? 'Plan: tylko odczyt' : 'Poczekaj na odświeżenie danych – potem edycja') : 'Ta komórka jest tylko do odczytu'); return; }
    const x = colLeft(st.sel.c1), y = headH() + st.offs[st.sel.r1], w = colW(c), hh = st.heights[st.sel.r1];
    const cur = cellText(r, c);
    const box = { position: 'absolute', left: x + 'px', top: y + 'px', minWidth: w + 'px', minHeight: hh + 'px', zIndex: 8, boxSizing: 'border-box', border: '2px solid #0b57d0', font: 'inherit', lineHeight: '1.3', padding: '2px 4px', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.25)' };
    const wrap = h('div', {});            // pole edycji + dodatki (lista, kalendarz) – usuwane razem
    let input, list = null, hold = false, onType = null;
    const shiftCell = k === 'edit' && shiftOfText(cur) != null && blockOf(st.grid, r) && blockOf(st.grid, r).headerRow === r;
    if (shiftCell && typed == null) {
      // nagłówek bloku: zmiana z listy rozwijanej (reszta tekstu bez zmian); „Edytuj tekst…” – zwykła edycja
      input = h('select', { style: { ...box, width: Math.max(w, 230) + 'px', height: Math.max(hh, 26) + 'px', padding: '1px' } },
        ...SHIFTS.map((n) => h('option', { value: withShift(cur, n), selected: shiftOfText(cur) === n }, `Zmiana ${n} – ${SHIFT_NAMES[n]}`)),
        h('option', { value: '\u0000text' }, 'Edytuj tekst…'));
      input.addEventListener('change', () => {
        if (input.value === '\u0000text') { finish(false); st.sel = { r0: st.sel.r1, c0: st.sel.c1, r1: st.sel.r1, c1: st.sel.c1 }; beginEdit(cur); return; }
        finish(true);
      });
    } else if (k === 'worker') {
      input = h('input', { value: typed != null ? typed : cur, placeholder: 'pracownik', style: { ...box, width: Math.max(w, 200) + 'px', height: hh + 'px' } });
      const { iso, shift } = blockDayShift(r);
      let groups = null, note = iso ? 'Grafik: wczytywanie…' : 'Brak daty zmiany – cała lista';
      list = suggestList((it) => { input.value = it.value; finish(true); });
      let typedYet = typed != null;     // lista zawęża się dopiero po wpisaniu (otwarta na istniejącej wartości pokazuje wszystkich)
      const refresh = (auto) => {
        const f = typedYet ? input.value.trim().toLowerCase() : '', m = (n) => !f || n.toLowerCase().includes(f);
        const items = [];
        const day = iso ? P.displayDate(iso) : '';
        if (groups) {
          const sec = (head, arr, color, dim) => { const a = arr.filter((x) => m(x.name)); if (a.length) { items.push({ head }); a.forEach((x) => items.push({ label: x.name, value: x.name, note: x.code ? x.code + (x.hours ? ` · ${x.hours} h` : '') : '', noteColor: color, dim })); } };
          const zm = shift ? SHIFT_ROMAN[shift] + ` (${shift}) ` : '';
          if (!groups.on.some((x) => m(x.name))) items.push({ head: `Na zmianie ${zm}${day}: nikogo w Grafiku`, always: true });
          sec(`Na zmianie ${zm}${day} (Grafik)`, groups.on, '#137333');
          sec(`Tego dnia na innej zmianie`, groups.other, '#b06000');
          sec('Bez wpisu w Grafiku', groups.rest, '#555');
          sec('Nieobecni (urlop, L4, wolne)', groups.away, '#a00000', true);
        } else {
          items.push({ head: note, always: true });
          (st.grid.workers || []).filter(m).forEach((n) => items.push({ label: n, value: n }));
        }
        list.set(items, auto && !!f);
      };
      onType = (e) => { if (e && e.type === 'input') typedYet = true; refresh(true); };
      if (iso) grafikDay(iso).then((people) => { groups = workersForShift(st.grid.workers || [], people, shift); if (st.editing && st.editing.input === input) refresh(false); })
        .catch((e) => { note = 'Grafik niedostępny: ' + (e.message || e); if (st.editing && st.editing.input === input) refresh(false); });
      setTimeout(() => refresh(false), 0);
    } else if (k === 'date') {
      input = h('input', { value: typed != null ? typed : cur, placeholder: 'dd-mm-rrrr', style: { ...box, width: Math.max(w, 130) + 'px', height: hh + 'px' } });
      const cal = h('button', { class: 'btn small', title: 'Kalendarz', style: { position: 'absolute', zIndex: 9, left: x + Math.max(w, 130) + 2 + 'px', top: y + 'px', padding: '2px 6px' },
        onmousedown: (e) => e.preventDefault(),
        onclick: () => {
          hold = true;
          const iso = G.parseDateText(input.value);
          datePickerDialog({ title: 'Data zmiany', withTime: false, value: iso ? Date.parse(iso + 'T00:00:00Z') : null,
            onPick: (ms) => { hold = false; input.value = ms == null ? '' : P.displayDate(new Date(ms).toISOString().slice(0, 10)); finish(true); } });
        } }, '📅');
      wrap.append(cal);
    } else {
      input = h('textarea', { style: { ...box, width: Math.max(w, 220) + 'px', height: Math.max(hh, 60) + 'px', resize: 'both' } });
      input.value = typed != null ? typed : (cur === '' ? P.FIRST_ITEM : cur);
      // komisy: w kolumnie „Komis” zawsze, w innych – gdy linia zaczyna się jak komis (np. 26/…)
      const komisCol = isKomisColumn(st.grid, c);
      list = suggestList((it) => {
        const v = input.value, pos = input.selectionStart, ls = v.lastIndexOf('\n', pos - 1) + 1, le = v.indexOf('\n', pos) < 0 ? v.length : v.indexOf('\n', pos);
        const line = v.slice(ls, le), prefix = (/^\s*\d+\.\s*/.exec(line) || [''])[0];
        input.value = v.slice(0, ls) + prefix + it.value + v.slice(le);
        const np = ls + prefix.length + it.value.length; input.setSelectionRange(np, np); list.set([]);
      });
      onType = () => {
        const v = input.value, pos = input.selectionStart, ls = v.lastIndexOf('\n', pos - 1) + 1;
        const frag = komisFragment(v.slice(ls, pos));
        if (!frag || (!komisCol && !/^\d{2}\//.test(frag))) { list.set([]); return; }
        const sug = komisSuggestions(komisy(), frag);
        list.set(sug.length ? [{ head: 'Komisy (z planu)' }, ...sug.map((x) => ({ label: x, value: x }))] : [], true);
      };
    }
    st.editing = { r, c, input, wrap, finish: (cm) => finish(cm) };
    wrap.append(input); if (list) wrap.append(list.el);
    inner.append(wrap); input.focus();
    if (list) list.place(input);
    if (typed == null && (k === 'worker' || k === 'date') && input.select) input.select();          // pisanie zastępuje wartość
    else if (typed == null && input.setSelectionRange) { const n = input.value.length; input.setSelectionRange(n, n); }
    if (typed != null && onType) setTimeout(onType, 0);
    function finish(commit, move) {
      if (!st.editing || st.editing.input !== input) return;
      const v = input.value; st.editing = null; wrap.remove();
      if (commit && k === 'edit') rememberKomisy([v]);
      if (commit) { const res = applyCells([{ r, c, text: v }], `${G.colName(c)}${r + 1}`); if (res.skipped.length) toast(res.skipped[0], true); }
      body.focus();
      if (move) move();
    }
    if (onType) { input.addEventListener('input', onType); input.addEventListener('click', onType); }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (input.tagName === 'SELECT') { if (e.key === 'Escape') { e.preventDefault(); finish(false); } else if (e.key === 'Enter') { e.preventDefault(); finish(true, () => setSel(st.sel.r1 + 1, st.sel.c1)); } return; }
      if (list && list.visible() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); list.move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (list && list.visible() && e.key === 'Enter' && !e.altKey && list.current()) {
        e.preventDefault(); const it = list.current();
        if (k === 'worker') { input.value = it.value; finish(true, () => setSel(st.sel.r1 + 1, st.sel.c1)); } else list.pick(it);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); if (list && list.visible() && k !== 'worker') { list.set([]); return; } finish(false); }
      else if (e.key === 'Enter' && e.altKey && k === 'edit') { e.preventDefault(); const s0 = input.selectionStart; input.value = input.value.slice(0, s0) + '\n' + input.value.slice(input.selectionEnd); input.selectionStart = input.selectionEnd = s0 + 1; }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true, () => setSel(st.sel.r1 + 1, st.sel.c1)); }
      else if (e.key === 'Enter' && e.shiftKey && k !== 'edit') { e.preventDefault(); finish(true, () => setSel(st.sel.r1 - 1, st.sel.c1)); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, () => setSel(st.sel.r1, st.sel.c1 + (e.shiftKey ? -1 : 1))); }
    });
    input.addEventListener('blur', () => { setTimeout(() => { if (!hold && st.editing && st.editing.input === input && document.activeElement !== input) finish(true); }, 0); });
  }

  // ---------- klawiatura i schowek ----------
  body.addEventListener('keydown', (e) => {
    if (st.editing || !st.grid) return;
    const ctrl = e.ctrlKey || e.metaKey, s = st.sel;
    const pageRows = Math.max(1, Math.floor((body.clientHeight - headH()) / (st.layout.font * 1.6 * Z())));
    const mv = (dr, dc, ext) => { e.preventDefault(); if (!s) { setSel(0, 0); return; } setSel(s.r1 + dr, s.c1 + dc, ext); };
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(st.undo, st.redo); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); undoRedo(st.redo, st.undo); return; }
    if (ctrl && e.key === 'Home') { e.preventDefault(); setSel(0, 0, e.shiftKey); return; }
    if (ctrl && e.key === 'End') { e.preventDefault(); setSel(st.vis.length - 1, st.cols.length - 1, e.shiftKey); return; }
    switch (e.key) {
      case 'ArrowDown': return mv(ctrl ? st.vis.length : 1, 0, e.shiftKey);
      case 'ArrowUp': return mv(ctrl ? -st.vis.length : -1, 0, e.shiftKey);
      case 'ArrowRight': return mv(0, ctrl ? st.cols.length : 1, e.shiftKey);
      case 'ArrowLeft': return mv(0, ctrl ? -st.cols.length : -1, e.shiftKey);
      case 'Tab': return mv(0, e.shiftKey ? -1 : 1, false);
      case 'Enter': return mv(e.shiftKey ? -1 : 1, 0, false);
      case 'PageDown': return mv(pageRows, 0, e.shiftKey);
      case 'PageUp': return mv(-pageRows, 0, e.shiftKey);
      case 'Home': e.preventDefault(); if (s) setSel(s.r1, 0, e.shiftKey); return;
      case 'End': e.preventDefault(); if (s) setSel(s.r1, st.cols.length - 1, e.shiftKey); return;
      case 'F2': e.preventDefault(); beginEdit(null); return;
      case 'Delete': case 'Backspace': e.preventDefault(); clearSelection(); return;
      default:
        if (!ctrl && !e.altKey && e.key.length === 1 && s) { e.preventDefault(); beginEdit(e.key); }
    }
  });
  const selCells = () => { const { ra, rb, ca, cb } = selRect(), out = []; for (let i = ra; i <= rb; i++) for (let j = ca; j <= cb; j++) out.push({ r: st.vis[i], c: st.cols[j] }); return out; };
  function clearSelection() {
    if (!st.sel) return;
    const items = selCells().filter(({ r, c }) => editable(r, c) && cellText(r, c) !== '').map(({ r, c }) => ({ r, c, text: '' }));
    if (!items.length) return;
    const res = applyCells(items, `Wyczyszczenie: ${items.length}`);
    toast(`Wyczyszczono komórek: ${res.done}`);
  }
  function copyText() {
    const { ra, rb, ca, cb } = selRect(), rows = [];
    for (let i = ra; i <= rb; i++) { const row = []; for (let j = ca; j <= cb; j++) row.push(cellText(st.vis[i], st.cols[j])); rows.push(row); }
    return G.toTsv(rows);
  }
  document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);
  function active() { if (!el.isConnected) { cleanup(); return false; } return document.activeElement === body && st.sel && !st.editing; }
  function onCopy(e) { if (!active()) return; e.preventDefault(); e.clipboardData.setData('text/plain', copyText()); const { ra, rb, ca, cb } = selRect(); toast(`Skopiowano komórek: ${(rb - ra + 1) * (cb - ca + 1)}`); }
  function onCut(e) { if (!active()) return; onCopy(e); clearSelection(); }
  function onPaste(e) {
    if (!active()) return;
    e.preventDefault();
    const data = G.parseTsv(e.clipboardData.getData('text/plain'));
    if (!data.length) return;
    const { ra, rb, ca, cb } = selRect(), items = [];
    if (data.length === 1 && data[0].length === 1 && (ra !== rb || ca !== cb)) {             // jedna komórka w zakres – wypełnia zakres
      for (const { r, c } of selCells()) items.push({ r, c, text: data[0][0] });
    } else {
      data.forEach((row, di) => row.forEach((text, dj) => { const i = ra + di, j = ca + dj; if (i < st.vis.length && j < st.cols.length) items.push({ r: st.vis[i], c: st.cols[j], text }); }));
      st.sel = { r0: ra, c0: ca, r1: Math.min(st.vis.length - 1, ra + data.length - 1), c1: Math.min(st.cols.length - 1, ca + Math.max(...data.map((x) => x.length)) - 1) };
    }
    const res = applyCells(items, `Wklejenie: ${items.length}`);
    paintSel();
    toast(`Wklejono komórek: ${res.done}` + (res.skipped.length ? `; pominięto ${res.skipped.length} (${res.skipped.slice(0, 2).join('; ')}${res.skipped.length > 2 ? '; …' : ''})` : ''), res.skipped.length > 0 && !res.done);
  }

  // ---------- zapis ----------
  function syncInfo() {
    const n = st.changes.size;
    saveBtn.disabled = st.saving || !n || !canEdit();
    saveBtn.textContent = n ? `Zapisz zmiany (${n})` : 'Zapisz zmiany';
    fontLabel.textContent = `czcionka ${st.layout.font}`;
    const s = st.sel ? (() => { const { ra, rb, ca, cb } = selRect(); return `${G.colName(st.cols[ca])}${st.vis[ra] + 1}` + (ra !== rb || ca !== cb ? `:${G.colName(st.cols[cb])}${st.vis[rb] + 1}` : ''); })() : '';
    info.textContent = [s, !st.grid ? '' : !st.fresh ? 'dane z pamięci, odświeżanie… (edycja po odświeżeniu)' : canEdit() ? '' : 'tylko odczyt', st.layoutErr].filter(Boolean).join(' · ');
  }
  async function save() {
    if (st.saving || !st.changes.size) return;
    if (!(await confirmBox('Zapisać plan?', `Zmienione komórki: ${st.changes.size}.`, 'Zapisz'))) return;
    const list = [...st.changes].map(([k, e]) => { const [row, col] = k.split(':').map(Number); return { row, col, entry: e }; });
    st.saving = true; syncInfo();
    try {
      const r = await savePlan(st.grid, list, user());
      st.saving = false; st.changes = new Map(); st.undo = []; st.redo = []; if (st.grid) rebuild(); else syncInfo();
      if (r.sheetError) toast('Zapisano w bazie, ale nie w karcie PLAN: ' + r.sheetError, true); else toast('Zmiany zapisane (baza i karta PLAN).');
    } catch (e) {
      st.saving = false; syncInfo();
      await alertBox('Plan', 'Błąd zapisu planu w bazie: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e) + '. Zmiany zostają na ekranie.');
    }
  }

  // ---------- pasek narzędzi ----------
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, saveBtn,
    h('button', { class: 'btn', title: 'Wczytaj plan z bazy od nowa', onclick: async () => { if (st.changes.size && !(await confirmBox('Odświeżyć?', 'Niezapisane zmiany zostaną utracone.', 'Odśwież'))) return; st.changes = new Map(); st.undo = []; st.redo = []; load(); } }, 'Odśwież'),
    // pobieranie z arkusza – tylko GOD; wysyłka do karty PLAN – na żądanie (MASTER, GOD), przycisk świeci, gdy są zmiany
    isGod() ? h('button', { class: 'btn small', title: 'Zastąp plan w bazie zawartością karty PLAN arkusza', onclick: doImport }, 'Import z arkusza') : null,
    isMaster() ? syncButton('plan', 'PLAN', { h, toast, confirmBox }) : null,
    h('button', { class: 'btn small', title: 'Cofnij (Ctrl+Z)', onclick: () => undoRedo(st.undo, st.redo) }, '↶'),
    h('button', { class: 'btn small', title: 'Ponów (Ctrl+Y)', onclick: () => undoRedo(st.redo, st.undo) }, '↷'),
    h('span', { class: 'muted', style: { marginLeft: '8px' } }, 'Powiększenie:'),
    h('button', { class: 'btn small', onclick: () => setZoom(st.zoom - 10) }, '−'), zoomLabel, h('button', { class: 'btn small', onclick: () => setZoom(st.zoom + 10) }, '+'),
    h('span', { class: 'muted', style: { marginLeft: '8px' } }, 'Tabela (wspólne):'),
    h('button', { class: 'btn small', title: 'Mniejsza czcionka tabeli – dla wszystkich', onclick: () => setFont(st.layout.font - 1) }, 'A−'), fontLabel,
    h('button', { class: 'btn small', title: 'Większa czcionka tabeli – dla wszystkich', onclick: () => setFont(st.layout.font + 1) }, 'A+'),
    h('button', { class: 'btn small', title: 'Wszystkie kolumny i wiersze: dopasowanie do tekstu (dla wszystkich)', onclick: resetLayout }, 'Dopasuj wszystko'),
    info), body);
  async function resetLayout() {
    if (!(await confirmBox('Dopasować wszystko?', 'Szerokości kolumn i wysokości wierszy ustawione ręcznie wrócą do dopasowania automatycznego – dla wszystkich użytkowników.', 'Dopasuj'))) return;
    const cols = Object.fromEntries(Object.keys(st.layout.cols).map((k) => [k, null])), rows = Object.fromEntries(Object.keys(st.layout.rows).map((k) => [k, null]));
    st.layout = { ...st.layout, cols: {}, rows: {} }; st.local = { cols: {}, rows: {} }; st.myCols = {}; lsSet('plan.cols', {}); rebuild();
    savePlanLayout({ cols, rows }, user()).catch((e) => toast('Nie zapisano układu: ' + (e.message || e), true));
  }
  // sprzątanie po wyjściu z modułu (przy pierwszym zdarzeniu po odłączeniu widoku i co minutę)
  function cleanup() {
    document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste);
    document.removeEventListener('mouseup', onUp); window.removeEventListener('resize', onResize);
    if (st.unwatch) { st.unwatch(); st.unwatch = null; }
    if (unwatchPlan) { unwatchPlan(); unwatchPlan = null; }
    clearInterval(gc);
  }
  const gc = setInterval(() => { if (!el.isConnected) cleanup(); }, 60000);
  setZoom(st.zoom); load();
}
