import { h, clear, api, apiCached, toast, modal, field, confirmBox, alertBox } from '../ui.js';
import * as W from '../logic/workflow.js';
import { parseSheetColor } from '../logic/common.js';

const HEADERS = { A: 'Koniec', B: 'Start', C: 'Start', D: 'Data', E: 'Komis', F: 'Zadanie, informacja', G: 'Zlecający', H: 'Kategoria' };

// ---- edytor tekstu z formatowaniem (jak w Excelu / Arkuszach Google) ----
const emptyStyle = { bold: false, italic: false, underline: false, strike: false, color: null };

function runsToNodes(runs) {
  const frag = document.createDocumentFragment();
  for (const r of runs) {
    const span = h('span', { style: { fontWeight: r.bold ? 700 : '', fontStyle: r.italic ? 'italic' : '', textDecoration: [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ') || '', color: r.color || '' } });
    r.text.split('\n').forEach((line, i) => { if (i) span.append(document.createElement('br')); if (line) span.append(document.createTextNode(line)); });
    frag.append(span);
  }
  return frag;
}

/** Zawartość pola edycji → fragmenty z formatowaniem. */
export function domToRuns(root) {
  const out = [];
  const push = (text, st) => { if (text) out.push({ text, ...st }); };
  const endsNl = () => out.length > 0 && out[out.length - 1].text.endsWith('\n');
  const walk = (node, st) => {
    if (node.nodeType === 3) { push(node.nodeValue.replace(/ /g, ' '), st); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'BR') { push('\n', st); return; }
    const s = { ...st };
    const cs = node.style || {};
    if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(cs.fontWeight)) s.bold = true;
    if (tag === 'I' || tag === 'EM' || cs.fontStyle === 'italic') s.italic = true;
    const td = cs.textDecorationLine || cs.textDecoration || '';
    if (tag === 'U' || td.includes('underline')) s.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || td.includes('line-through')) s.strike = true;
    const col = tag === 'FONT' && node.getAttribute('color') ? node.getAttribute('color') : cs.color;
    if (col) { const hex = parseSheetColor(col, ''); if (hex) s.color = hex; }
    if ((tag === 'DIV' || tag === 'P') && out.length && !endsNl()) push('\n', st);
    node.childNodes.forEach((c) => walk(c, s));
  };
  root.childNodes.forEach((c) => walk(c, emptyStyle));
  while (out.length && /^\n+$/.test(out[out.length - 1].text)) out.pop();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\n+$/, '');
  return W.normalizeRuns(out);
}

function richEditor(initialRuns, { minHeight = 130 } = {}) {
  const area = h('div', { contenteditable: 'true', spellcheck: 'true', style: { minHeight: minHeight + 'px', border: '1px solid #888', borderRadius: '4px', padding: '6px 8px', background: '#fff', overflow: 'auto', whiteSpace: 'pre-wrap', maxHeight: '45vh' } });
  area.append(runsToNodes(initialRuns));
  area.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
  const cmd = (name, value) => { area.focus(); document.execCommand('styleWithCSS', false, true); document.execCommand(name, false, value); };
  const btn = (label, title, name, style) => h('button', { class: 'btn small', title, style: { minWidth: '28px', ...style }, onmousedown: (e) => { e.preventDefault(); cmd(name); } }, label);
  const color = h('input', { type: 'color', value: '#cc0000', title: 'Kolor tekstu', style: { width: '32px', height: '24px', padding: 0 }, oninput: () => cmd('foreColor', color.value) });
  const bar = h('div', { class: 'row', style: { gap: '4px', marginBottom: '4px' } },
    btn('B', 'Pogrubienie (Ctrl+B)', 'bold', { fontWeight: 700 }), btn('I', 'Kursywa (Ctrl+I)', 'italic', { fontStyle: 'italic' }),
    btn('U', 'Podkreślenie (Ctrl+U)', 'underline', { textDecoration: 'underline' }), btn('S', 'Przekreślenie', 'strikeThrough', { textDecoration: 'line-through' }),
    color, h('button', { class: 'btn small', title: 'Usuń formatowanie z zaznaczenia', onmousedown: (e) => { e.preventDefault(); cmd('removeFormat'); cmd('foreColor', '#000000'); } }, 'Wyczyść format'));
  return { node: h('div', {}, bar, area), getRuns: () => domToRuns(area), focus: () => area.focus() };
}

/** Opis nad polem bez elementu <label>: kliknięcie w <label> aktywowałoby jego pierwszy przycisk (np. „B” z paska formatowania). */
const block = (label, node) => h('div', { style: { margin: '6px 0' } }, h('div', { class: 'muted', style: { marginBottom: '2px' } }, label), node);

const PALETTE = ['#cc0000', '#e69138', '#38761d', '#1155cc', '#674ea7', '#666666', '#000000'];

/** Zakładka Workflow na ekranie głównym: karta Z, kolorowanie liczone lokalnie, edycja w tabeli (jak w arkuszu). */
export function createWorkflow() {
  const st = { headers: [], records: [], changes: new Map(), fresh: false, hideDone: false, newestFirst: true, search: '', saving: false, sel: null, editing: null, order: [] };
  const cells = new Map();      // `${wiersz}:${kolumna}` → <td>
  const recByRow = new Map();
  const info = h('span', { class: 'muted' });
  const body = h('div', { class: 'table-wrap', tabindex: '0', style: { maxHeight: 'calc(100vh - 400px)', minHeight: '200px', outline: 'none' } });
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: save }, 'Zapisz zmiany');
  const discardBtn = h('button', { class: 'btn', disabled: true, onclick: async () => { if (await confirmBox('Odrzucić zmiany?', `Niezapisane zmiany: ${st.changes.size}.`, 'Odrzuć')) { st.changes = new Map(); draw(); } } }, 'Odrzuć');
  const search = h('input', { type: 'search', placeholder: 'Szukaj…', style: { padding: '4px 8px', width: '160px' }, oninput: () => { st.search = search.value.trim().toLowerCase(); draw(); } });
  const canEdit = () => st.fresh && !st.saving;
  const key = (row, col) => `${row}:${col}`;

  // ---- pasek właściwości tekstu (widoczny podczas edycji komórki) ----
  const hint = h('div', { class: 'muted' }, 'Strzałki, Tab, Home/End: ruch po komórkach · Enter lub F2: edycja tekstu · Spacja lub x: ustaw status · Delete: wyczyść tekst');
  const fmtBtns = [];
  const exec = (name, value) => { document.execCommand('styleWithCSS', false, true); document.execCommand(name, false, value); updateFmt(); };
  const fmt = (label, title, name, style) => { const b = h('button', { class: 'btn small', title, style: { minWidth: '28px', ...style }, onmousedown: (e) => { e.preventDefault(); exec(name); } }, label); fmtBtns.push([b, name]); return b; };
  const updateFmt = () => { for (const [b, name] of fmtBtns) b.classList.toggle('primary', !!st.editing && document.queryCommandState(name)); };
  document.addEventListener('selectionchange', () => { if (st.editing) updateFmt(); });
  const toolbar = h('div', { class: 'row', style: { gap: '4px', display: 'none' } },
    fmt('B', 'Pogrubienie (Ctrl+B)', 'bold', { fontWeight: 700 }), fmt('I', 'Kursywa (Ctrl+I)', 'italic', { fontStyle: 'italic' }),
    fmt('U', 'Podkreślenie (Ctrl+U)', 'underline', { textDecoration: 'underline' }), fmt('S', 'Przekreślenie', 'strikeThrough', { textDecoration: 'line-through' }),
    h('span', { class: 'muted' }, 'Kolor:'),
    ...PALETTE.map((c) => h('button', { title: c === '#000000' ? 'Czarny (domyślny)' : c, style: { width: '20px', height: '20px', border: '1px solid #888', background: c, padding: 0, borderRadius: '3px', cursor: 'pointer' }, onmousedown: (e) => { e.preventDefault(); exec('foreColor', c); } })),
    h('button', { class: 'btn small', title: 'Usuń formatowanie z zaznaczenia', onmousedown: (e) => { e.preventDefault(); exec('removeFormat'); exec('foreColor', '#000000'); } }, 'Wyczyść format'),
    h('span', { class: 'muted' }, 'Enter: zapisz w komórce · Alt+Enter: nowa linia · Tab: następna komórka · Esc: anuluj'));
  const bar = h('div', { class: 'row', style: { minHeight: '32px', margin: '4px 0' } }, hint, toolbar);

  // ---- rysowanie tabeli ----
  function cellContent(eff, col, cs) {
    if (!W.TEXT_COLS.includes(col)) return eff[col];
    const frag = document.createDocumentFragment();
    for (const r of W.cellRuns(eff, col)) {
      const span = h('span', { style: { fontWeight: r.bold ? 700 : '', fontStyle: r.italic ? 'italic' : '', textDecoration: [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ') || '', color: cs && cs.color ? '' : (r.color || '') } });
      r.text.split('\n').forEach((line, i) => { if (i) span.append(document.createElement('br')); if (line) span.append(document.createTextNode(line)); });
      frag.append(span);
    }
    return frag;
  }

  function draw() {
    const sy = body.scrollTop, sx = body.scrollLeft;
    let recs = st.records.map((rec) => ({ rec, eff: W.effective(rec, st.changes.get(rec.row)) }));
    if (st.hideDone) recs = recs.filter((x) => W.statusOf(x.eff) !== 'A');
    if (st.search) recs = recs.filter((x) => [x.eff.E, x.eff.F, x.eff.G, x.eff.D].join(' ').toLowerCase().includes(st.search));
    if (st.newestFirst) recs = recs.slice().reverse();
    st.order = recs.map((x) => x.rec.row);
    cells.clear(); recByRow.clear();
    const tbody = h('tbody', {});
    for (const { rec, eff } of recs) {
      recByRow.set(rec.row, rec);
      const changed = st.changes.get(rec.row);
      const tr = h('tr', {});
      for (const col of W.COLS) {
        const s = W.cellStyle(eff, col, rec.row);
        const isStatus = W.STATUS_COLS.includes(col);
        const isText = W.TEXT_COLS.includes(col);
        const dirty = changed && ((isStatus && changed.status !== undefined) || (isText && changed.cells && changed.cells[col]));
        const style = { verticalAlign: 'top', textAlign: isStatus || col === 'D' || col === 'H' ? 'center' : 'left', whiteSpace: isText ? 'pre-wrap' : 'nowrap', cursor: isText ? 'cell' : 'default' };
        if (col === 'F') { style.minWidth = '320px'; style.maxWidth = '560px'; } else if (col === 'E') { style.maxWidth = '160px'; }
        if (isStatus) { style.width = '26px'; style.minWidth = '26px'; style.padding = '3px 2px'; }
        if (s) { style.background = s.background; if (s.color) style.color = s.color; if (s.bold) style.fontWeight = 700; if (s.italic) style.fontStyle = 'italic'; }
        if (dirty) { style.outline = '2px solid #e65100'; style.outlineOffset = '-2px'; }
        const auto = changed && eff[col] === '' && (col === 'D' || col === 'G');
        const td = h('td', { style, title: isStatus ? `Kliknij lub naciśnij Spację: ${W.STATUS_LABELS[col]}` : '', onmousedown: (e) => cellDown(rec.row, col, e) });
        if (auto) td.append(h('span', { class: 'muted', style: { fontStyle: 'italic' } }, '(auto)'));
        else if (isText) td.append(cellContent(eff, col, s)); else td.textContent = col === 'D' ? W.fmtDate(eff[col]) : eff[col];
        cells.set(key(rec.row, col), td);
        tr.append(td);
      }
      tbody.append(tr);
    }
    clear(body);
    body.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...W.COLS.map((c) => (W.STATUS_COLS.includes(c)
      ? h('th', { title: W.STATUS_LABELS[c], style: { width: '26px', minWidth: '26px', padding: '4px 2px', fontSize: '11px', verticalAlign: 'bottom' } }, h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'inline-block', whiteSpace: 'nowrap' } }, HEADERS[c]))
      : h('th', {}, HEADERS[c]))))), tbody));
    body.scrollTop = sy; body.scrollLeft = sx;
    const bad = W.mismatches(st.records).length;
    info.textContent = `Wierszy: ${recs.length}${recs.length !== st.records.length ? ' z ' + st.records.length : ''}` + (st.fresh ? '' : '  ·  dane z pamięci, odświeżanie… (edycja po odświeżeniu)') + (bad ? `  ·  niezgodne z kolumną H w arkuszu: ${bad}` : '');
    saveBtn.disabled = !canEdit() || !st.changes.size;
    discardBtn.disabled = !st.changes.size;
    saveBtn.textContent = st.changes.size ? `Zapisz zmiany (${st.changes.size})` : 'Zapisz zmiany';
    paintSel(false);
  }

  // ---- zaznaczenie i ruch strzałkami ----
  let selTd = null;
  function paintSel(scroll) {
    if (selTd) selTd.classList.remove('wf-sel');
    selTd = st.sel ? cells.get(key(st.sel.row, st.sel.col)) || null : null;
    if (!selTd) return;
    selTd.classList.add('wf-sel');
    if (scroll) {
      const head = body.querySelector('thead')?.offsetHeight || 0;
      const b = body.getBoundingClientRect(), r = selTd.getBoundingClientRect();
      if (r.top < b.top + head) body.scrollTop -= (b.top + head - r.top);
      else if (r.bottom > b.bottom) body.scrollTop += (r.bottom - b.bottom);
      if (r.left < b.left) body.scrollLeft -= (b.left - r.left); else if (r.right > b.right) body.scrollLeft += (r.right - b.right);
    }
  }
  function select(row, col, scroll = true) { st.sel = { row, col }; paintSel(scroll); }
  function move(dr, dc) {
    if (!st.order.length) return;
    if (!st.sel) { select(st.order[0], W.COLS[0]); return; }
    const ri = Math.max(0, Math.min(st.order.length - 1, st.order.indexOf(st.sel.row) + dr));
    const ci = Math.max(0, Math.min(W.COLS.length - 1, W.COLS.indexOf(st.sel.col) + dc));
    select(st.order[ri], W.COLS[ci]);
  }

  // ---- akcje na komórce ----
  function toggleStatusAt(row, col) {
    if (!canEdit()) { toast('Edycja po odświeżeniu danych.', true); return; }
    st.changes = W.stageStatus(st.changes, recByRow.get(row), col); draw();
  }
  function startEdit(row, col, replaceWith = null) {
    if (!canEdit()) { toast('Edycja po odświeżeniu danych.', true); return; }
    const rec = recByRow.get(row), td = cells.get(key(row, col));
    if (!rec || !td) return;
    const eff = W.effective(rec, st.changes.get(row));
    st.editing = { row, col, td };
    clear(td);
    td.append(runsToNodes(replaceWith === null ? W.cellRuns(eff, col) : []));
    td.contentEditable = 'true'; td.classList.add('wf-edit');
    td.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    td.addEventListener('focusout', () => { if (st.editing && st.editing.td === td) commitEdit(0, 0); });
    hint.style.display = 'none'; toolbar.style.display = 'flex';
    td.focus();
    const range = document.createRange(); range.selectNodeContents(td); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    if (replaceWith !== null) document.execCommand('insertText', false, replaceWith);
    updateFmt();
  }
  function endEditUi() { hint.style.display = ''; toolbar.style.display = 'none'; }
  function commitEdit(dr, dc) {
    const ed = st.editing; if (!ed) return;
    st.editing = null;
    const runs = domToRuns(ed.td);
    st.changes = W.stageText(st.changes, recByRow.get(ed.row), ed.col, runs);
    endEditUi(); draw();
    if (dr || dc) move(dr, dc); else paintSel(false);
    body.focus({ preventScroll: true });
  }
  function cancelEdit() {
    if (!st.editing) return;
    st.editing = null; endEditUi(); draw(); body.focus({ preventScroll: true });
  }
  function clearText(row, col) {
    if (!canEdit()) { toast('Edycja po odświeżeniu danych.', true); return; }
    st.changes = W.stageText(st.changes, recByRow.get(row), col, []); draw();
  }

  function cellDown(row, col, e) {
    if (st.editing) {
      if (st.editing.row === row && st.editing.col === col) return;          // kliknięcie w edytowaną komórkę: kursor jak w polu tekstowym
      e.preventDefault(); commitEdit(0, 0);
    }
    const wasSelected = st.sel && st.sel.row === row && st.sel.col === col;
    select(row, col, false);
    if (W.STATUS_COLS.includes(col)) { e.preventDefault(); toggleStatusAt(row, col); body.focus({ preventScroll: true }); }
    else if (W.TEXT_COLS.includes(col) && wasSelected) { e.preventDefault(); startEdit(row, col); }
  }

  body.addEventListener('keydown', (e) => {
    if (st.editing) {
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey || e.altKey) document.execCommand('insertLineBreak'); else commitEdit(1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); }
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const sel = st.sel;
    const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-10, 0], PageDown: [10, 0] }[e.key];
    if (nav) { e.preventDefault(); move(nav[0], nav[1]); return; }
    if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Home') { e.preventDefault(); if (sel) select(sel.row, W.COLS[0]); return; }
    if (e.key === 'End') { e.preventDefault(); if (sel) select(sel.row, W.COLS[W.COLS.length - 1]); return; }
    if (!sel) return;
    const isStatus = W.STATUS_COLS.includes(sel.col), isText = W.TEXT_COLS.includes(sel.col);
    if (isStatus && (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'x')) { e.preventDefault(); toggleStatusAt(sel.row, sel.col); }
    else if (isText && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); startEdit(sel.row, sel.col); }
    else if (isText && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); clearText(sel.row, sel.col); }
    else if (isText && e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.row, sel.col, e.key); }
  });

  function newTask() {
    const e = richEditor([], { minHeight: 36 });
    const f = richEditor([], { minHeight: 120 });
    const status = h('select', { style: { padding: '5px', width: '100%' } }, h('option', { value: '' }, '(bez statusu)'), ...W.STATUS_COLS.map((c) => h('option', { value: c, selected: c === 'B' }, W.STATUS_LABELS[c])));
    const err = h('div', { class: 'err' });
    const send = h('button', { class: 'btn primary', onclick: async () => {
      const item = W.newItem(e.getRuns(), f.getRuns(), status.value);
      if (!Object.keys(item.cells).length) { err.textContent = 'Wpisz komis albo treść zadania.'; return; }
      send.disabled = true;
      try {
        const r = await api('api_saveWorkflow', [[item]]);
        m.close(); toast((r && r.message) || 'Dodano zadanie.'); await load(true);
      } catch (ex) {
        send.disabled = false;
        err.textContent = 'Błąd zapisu: ' + ex.message + (ex.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : '');
      }
    } }, 'Dodaj');
    const m = modal('Nowe zadanie', h('div', {}, h('div', { class: 'muted' }, 'Data i zlecający uzupełnią się automatycznie.'),
      block('Komis', e.node), block('Zadanie, informacja', f.node), field('Status', status), err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), send)), { wide: true });
    f.focus();
  }

  async function save() {
    if (st.editing) commitEdit(0, 0);
    if (!canEdit() || !st.changes.size) return;
    const items = W.buildItems(st.changes, st.records);
    if (!(await confirmBox('Zapisać zmiany?', `Zmienione wiersze: ${items.length}. Data i zlecający uzupełnią się tylko tam, gdzie są puste.`, 'Zapisz'))) return;
    st.saving = true; draw();
    try {
      const r = await api('api_saveWorkflow', [items]);
      st.changes = new Map(); st.saving = false;
      toast((r && r.message) || 'Zapisano.'); await load(true);
    } catch (e) {
      st.saving = false; draw();
      await alertBox('Workflow', 'Błąd zapisu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : ''));
    }
  }

  const onData = (d, meta) => {
    st.headers = d.headers || [];
    st.records = (d.rows || []).map((r) => ({ ...W.toRecord(r.cells || [], r.runs || {}), row: r.row }));
    st.fresh = !meta.cached;
    if (st.fresh) st.changes = new Map();
    if (st.editing) { st.editing = null; endEditUi(); }
    draw();
  };

  async function load(skipCache = false) {
    info.textContent = 'Wczytywanie karty Z…';
    try {
      if (skipCache) { st.fresh = false; onData(await api('api_getWorkflow', [], { timeoutMs: 120000, cache: true }), { cached: false }); }
      else await apiCached('api_getWorkflow', [], onData, { timeoutMs: 120000 });
    } catch (e) {
      clear(body);
      const cfg = await window.zks.getSettings();
      const m = /\/s\/([^/]+)\//.exec(cfg.url || '');
      const dep = m ? m[1] : '';
      const tail = dep ? `…${dep.slice(-8)} (długość ${dep.length})` : '(nie rozpoznano adresu)';
      const missing = e.code === 'UNKNOWN_FN';
      body.append(h('div', { style: { padding: '12px' } },
        h('div', { class: missing ? '' : 'err' }, missing ? 'Serwer, z którym łączy się aplikacja, odpowiedział, że nie zna funkcji api_getWorkflow.' : 'Błąd: ' + e.message),
        h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } }, `Kod odpowiedzi: ${e.code || '—'}\nKomunikat serwera: ${e.message}\nWdrożenie, z którym łączy się aplikacja: ${tail}`),
        missing ? h('div', { class: 'muted', style: { marginTop: '8px' } }, 'Wklej kod z backend/Api.gs do Apps Script i wdróż Nową wersję tego wdrożenia (patrz docs/WORKFLOW_API.md).') : null));
      info.textContent = '';
    }
  }

  const check = (label, k) => h('label', { class: 'row muted', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: st[k], onchange: (ev) => { st[k] = ev.target.checked; draw(); } }), label);
  const node = h('div', { class: 'panel', style: { maxWidth: '1400px', margin: '0 auto' } },
    h('div', { class: 'row', style: { marginBottom: '4px' } }, h('h2', { style: { margin: 0 } }, 'Workflow'),
      h('button', { class: 'btn primary', onclick: newTask }, '+ Nowe zadanie'), saveBtn, discardBtn, search,
      check('Ukryj zakończone', 'hideDone'), check('Najnowsze na górze', 'newestFirst'),
      h('span', { class: 'grow' }), info,
      h('button', { class: 'btn', onclick: async () => { if (st.changes.size && !(await confirmBox('Odświeżyć?', 'Niezapisane zmiany zostaną utracone.', 'Odśwież'))) return; st.changes = new Map(); load(); } }, 'Odśwież')), bar, body);
  return { node, refresh: load };
}
