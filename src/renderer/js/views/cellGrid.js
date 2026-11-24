// Tabela z edycją komórek „jak w arkuszu Google”: zaznaczanie (klik, przeciąganie, Shift), strzałki / Tab / Enter, wpisanie znaku zaczyna edycję,
// F2 albo dwuklik – edycja istniejącej treści, Delete czyści, Ctrl+C / X / V (zgodne z arkuszem), Ctrl+Z / Y. Wiersz z zaznaczeniem jest
// podświetlony zieloną poświatą. Zapis komórek robi wywołujący ([commit]) – tabela pokazuje tylko to, co zatwierdził.
import { h, clear, toast } from '../ui.js';

const GLOW = 'inset 0 0 0 999px rgba(0,176,80,.10), inset 0 2px 0 rgba(0,176,80,.75), inset 0 -2px 0 rgba(0,176,80,.75)';
const SELECTED = 'inset 0 0 0 999px rgba(26,115,232,.20)';

const tsvCell = (t) => { const s = String(t ?? ''); return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** Tekst ze schowka (TSV jak z Excela / Arkuszy Google) → tablica wierszy. */
export function parseTsv(text) {
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

/**
 * [body] – przewijany kontener (tabela rysowana w środku). Opcje:
 *  - text(row, col) – tekst komórki; editable(row, col) – czy wolno edytować;
 *  - commit(changes) → Promise<[{ ok, text?, error? }]> – zapis; changes = [{ row, col, text, expect }] (expect – dotychczasowy tekst);
 *  - onRowHeader(row) – kliknięcie numeru wiersza; listId – id datalisty podpowiedzi dla kolumn z `list: true`.
 * Zwraca { render(cols, rows, thead), repaint(), active() }.
 */
export function createCellGrid({ body, text, editable, commit, onRowHeader, listId, readOnlyNote = 'Tylko odczyt' }) {
  const st = { cols: [], rows: [], sel: null, editing: null, undo: [], redo: [] };
  body.tabIndex = 0; body.style.outline = 'none';
  let chain = Promise.resolve();

  const cellEl = (r, c) => body.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  const rect = () => { const s = st.sel; return s ? { ra: Math.min(s.r0, s.r1), rb: Math.max(s.r0, s.r1), ca: Math.min(s.c0, s.c1), cb: Math.max(s.c0, s.c1) } : null; };

  function paintSel() {
    body.querySelectorAll('td[data-r]').forEach((td) => { td.style.boxShadow = ''; td.style.outline = ''; });
    const q = rect(); if (!q) return;
    for (let r = q.ra; r <= q.rb; r++) for (let c = 0; c < st.cols.length; c++) {
      const td = cellEl(r, c); if (!td) continue;
      td.style.boxShadow = c >= q.ca && c <= q.cb ? SELECTED + ', ' + GLOW : GLOW;   // wiersz z zaznaczeniem – zielona poświata, zaznaczone komórki – dodatkowo niebieskie
    }
    for (let r = q.ra; r <= q.rb; r++) { const rn = body.querySelector(`td.rn[data-r="${r}"]`); if (rn) rn.style.boxShadow = GLOW; }
    const a = cellEl(st.sel.r1, st.sel.c1); if (a) { a.style.outline = '2px solid #0b57d0'; a.style.outlineOffset = '-2px'; a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function paintValues() {
    st.rows.forEach((row, r) => st.cols.forEach((col, c) => { const td = cellEl(r, c); if (td && !(st.editing && st.editing.r === r && st.editing.c === c)) td.textContent = text(row, col); }));
  }
  function setSel(r, c, extend) {
    if (!st.rows.length) return;
    r = Math.max(0, Math.min(st.rows.length - 1, r)); c = Math.max(0, Math.min(st.cols.length - 1, c));
    st.sel = extend && st.sel ? { ...st.sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c };
    paintSel();
  }

  /** Zapis zmian (kolejkowany – jedna zmiana naraz). items: [{ r, c, text }]. */
  function apply(items, record = true) {
    const changes = [];
    for (const it of items) {
      const row = st.rows[it.r], col = st.cols[it.c];
      if (!row || !col || !editable(row, col)) continue;
      const before = text(row, col);
      if (String(it.text) === before) continue;
      changes.push({ row, col, text: String(it.text), expect: before });
    }
    if (!changes.length) return Promise.resolve();
    chain = chain.then(async () => {
      let res;
      try { res = await commit(changes); } catch (e) { toast('Nie zapisano: ' + (e.message || e), true); paintValues(); return; }
      const done = [], errors = [];
      changes.forEach((ch, i) => { const x = res[i] || { ok: false, error: 'Brak odpowiedzi serwera.' }; if (x.ok) done.push({ row: ch.row, col: ch.col, before: ch.expect, after: x.text }); else errors.push(x.error); });
      if (record && done.length) { st.undo.push(done); if (st.undo.length > 100) st.undo.shift(); st.redo = []; }
      paintValues(); paintSel();
      if (errors.length) toast(`Nie zapisano ${errors.length} z ${changes.length}: ${[...new Set(errors)].slice(0, 2).join(' · ')}`, true);
    });
    return chain;
  }
  function historyStep(from, to, key) {
    const step = from.pop(); if (!step) return;
    const items = step.map((x) => ({ r: st.rows.indexOf(x.row), c: st.cols.indexOf(x.col), text: x[key] })).filter((x) => x.r >= 0 && x.c >= 0);
    // przy cofaniu „oczekiwany” tekst to wartość po zmianie – apply bierze go z bieżącej komórki
    apply(items, false).then(() => { to.push(step); paintValues(); });
  }

  function beginEdit(typed) {
    const s = st.sel; if (!s) return;
    const row = st.rows[s.r1], col = st.cols[s.c1];
    if (!row || !col) return;
    if (!editable(row, col)) { toast(readOnlyNote); return; }
    const td = cellEl(s.r1, s.c1); if (!td) return;
    const r = td.getBoundingClientRect(), b = body.getBoundingClientRect();
    const input = h('input', { value: typed != null ? typed : text(row, col), list: col.list ? listId : null, autocomplete: 'off', style: {
      position: 'absolute', zIndex: 10, left: r.left - b.left + body.scrollLeft + 'px', top: r.top - b.top + body.scrollTop + 'px',
      width: Math.max(r.width, 90) + 'px', height: r.height + 'px', boxSizing: 'border-box', border: '2px solid #0b57d0', padding: '0 4px', font: 'inherit', background: '#fff' } });
    st.editing = { r: s.r1, c: s.c1, input };
    body.style.position = body.style.position || 'relative';
    body.append(input); input.focus();
    if (typed == null) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
    const finish = (commitIt, move) => {
      if (!st.editing || st.editing.input !== input) return;
      const { r: rr, c: cc } = st.editing; st.editing = null; const v = input.value; input.remove(); body.focus();
      if (commitIt) apply([{ r: rr, c: cc, text: v }]);
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

  const selItems = (fn) => { const q = rect(), out = []; if (!q) return out; for (let r = q.ra; r <= q.rb; r++) for (let c = q.ca; c <= q.cb; c++) out.push(fn(r, c)); return out; };
  const selText = () => { const q = rect(); if (!q) return ''; const lines = []; for (let r = q.ra; r <= q.rb; r++) { const cells = []; for (let c = q.ca; c <= q.cb; c++) cells.push(tsvCell(text(st.rows[r], st.cols[c]))); lines.push(cells.join('\t')); } return lines.join('\n'); };
  const clearSel = () => apply(selItems((r, c) => ({ r, c, text: '' })));

  // ---- zdarzenia ----
  const posOf = (e) => { const td = e.target.closest && e.target.closest('td[data-c]'); return td ? { r: +td.dataset.r, c: +td.dataset.c } : null; };
  let dragging = false;
  body.addEventListener('mousedown', (e) => {
    if (st.editing || e.button !== 0) return;
    const p = posOf(e); if (!p) return;
    e.preventDefault(); body.focus(); setSel(p.r, p.c, e.shiftKey); dragging = true;
  });
  body.addEventListener('mousemove', (e) => { if (!dragging || !(e.buttons & 1)) { dragging = false; return; } const p = posOf(e); if (p && st.sel && (p.r !== st.sel.r1 || p.c !== st.sel.c1)) { st.sel = { ...st.sel, r1: p.r, c1: p.c }; paintSel(); } });
  const onUp = () => { dragging = false; };
  document.addEventListener('mouseup', onUp);
  body.addEventListener('dblclick', (e) => { const p = posOf(e); if (!p) return; setSel(p.r, p.c); beginEdit(null); });
  body.addEventListener('click', (e) => { const rh = e.target.closest && e.target.closest('td.rn'); if (rh && onRowHeader) onRowHeader(st.rows[+rh.dataset.r]); });
  body.addEventListener('keydown', (e) => {
    if (st.editing || !st.sel) return;
    const ctrl = e.ctrlKey || e.metaKey, s = st.sel;
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); st.sel = { r0: 0, c0: 0, r1: st.rows.length - 1, c1: st.cols.length - 1 }; paintSel(); return; }
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); historyStep(st.undo, st.redo, 'before'); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); historyStep(st.redo, st.undo, 'after'); return; }
    if (ctrl) return;   // Ctrl+C / X / V obsługują zdarzenia schowka
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) { e.preventDefault(); const [dr, dc] = arrows[e.key]; setSel(s.r1 + dr, s.c1 + dc, e.shiftKey); return; }
    if (e.key === 'Tab') { e.preventDefault(); setSel(s.r1, s.c1 + (e.shiftKey ? -1 : 1)); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel(); return; }
    if (e.key === 'Home') { e.preventDefault(); setSel(s.r1, 0, e.shiftKey); return; }
    if (e.key === 'End') { e.preventDefault(); setSel(s.r1, st.cols.length - 1, e.shiftKey); return; }
    if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); setSel(s.r1 + (e.key === 'PageDown' ? 15 : -15), s.c1, e.shiftKey); return; }
    if (e.key.length === 1 && !e.altKey) { e.preventDefault(); beginEdit(e.key); }
  });
  const active = () => document.activeElement === body && st.sel && !st.editing && body.isConnected;
  const onCopy = (e) => { if (!active()) return; e.preventDefault(); e.clipboardData.setData('text/plain', selText()); };
  const onCut = (e) => { if (!active()) return; e.preventDefault(); e.clipboardData.setData('text/plain', selText()); clearSel(); };
  const onPaste = (e) => {
    if (!active()) return;
    e.preventDefault();
    const data = parseTsv(e.clipboardData.getData('text/plain'));
    if (!data.length) return;
    const q = rect(), items = [];
    if (data.length === 1 && data[0].length === 1 && (q.ra !== q.rb || q.ca !== q.cb)) { for (let r = q.ra; r <= q.rb; r++) for (let c = q.ca; c <= q.cb; c++) items.push({ r, c, text: data[0][0] }); }   // jedna wartość wypełnia zaznaczenie
    else data.forEach((line, i) => line.forEach((t, j) => { const r = q.ra + i, c = q.ca + j; if (r < st.rows.length && c < st.cols.length) items.push({ r, c, text: t }); }));
    apply(items);
  };
  document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);

  return {
    /** Zdejmuje nasłuch schowka i myszy (przy zamknięciu widoku). */
    destroy() { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste); document.removeEventListener('mouseup', onUp); },
    /** Rysuje tabelę: [cols] ({key, title, left?, list?}), [rows], [thead] – wiersz nagłówka (bez kolumny numerów, dodawana tu). */
    render(cols, rows, thead) {
      st.cols = cols; st.rows = rows; st.editing = null;
      if (st.sel) { st.sel.r0 = Math.min(st.sel.r0, rows.length - 1); st.sel.r1 = Math.min(st.sel.r1, rows.length - 1); if (st.sel.r1 < 0) st.sel = null; }
      const sx = body.scrollLeft, sy = body.scrollTop;
      thead.prepend(h('th', { style: { width: '36px' }, title: 'Numer pozycji – kliknij, aby zobaczyć szczegóły' }, '#'));
      const tbody = h('tbody', {});
      rows.forEach((row, r) => tbody.append(h('tr', {}, h('td', { class: 'rn click', 'data-r': r, style: { color: '#666', cursor: 'pointer' } }, String(r + 1)),
        ...cols.map((col, c) => h('td', { 'data-r': r, 'data-c': c, class: col.left ? 'left' : '', style: { userSelect: 'none', cursor: 'cell' } }, text(row, col))))));
      clear(body);
      body.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, thead), tbody));
      body.scrollLeft = sx; body.scrollTop = sy; paintSel();
    },
    repaint() { paintValues(); paintSel(); },
    clearHistory() { st.undo = []; st.redo = []; },
  };
}
