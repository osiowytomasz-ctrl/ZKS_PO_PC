// Mistrz PO – zakładki arkusza Mistrz_po w programie: te same kolumny i kolory co w pliku, ale dane z bazy Firebase,
// a kolumny liczone (formuły arkusza) liczy program (logic/mistrz.js). W bazie są tylko dane wpisywane.
// Okres przejściowy: wpisy dalej trafiają do arkusza (Skaner, ręcznie); „Import z arkusza” albo „Import z pliku” aktualizuje bazę.
// Dostęp: przeglądanie od CLERIK, import od MASTER (kolumna „Grafik dostęp”).
import { h, clear, toast, modal, columnFilterDialog, confirmBox, api } from '../ui.js';
import * as M from '../logic/mistrz.js';
import { drawMistrzNav } from './mistrzNav.js';
import { createCellGrid } from './cellGrid.js';
import * as DD from '../logic/detailDraft.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { loadMistrz, importFromSheet, importFromXlsx, exportToSheet, loadMarks, setMark, detailKey } from '../mistrzStore.js';
import { qrSvg } from '../logic/qr.js';
import { detailsPrintHtml } from '../logic/mistrzPrint.js';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci przeglądarki */ } };
const PAGE = 400;
/** Szerokości kolumn jak w pliku (znaki → piksele). */
const WIDTHS = {
  ops: { A: 10, B: 6, C: 11, D: 6, E: 6, F: 11, G: 20, H: 22, I: 8, J: 34, K: 8, L: 6, M: 8, O: 14, P: 10 },
  docs: { A: 10, B: 6, C: 11, D: 8, E: 7, F: 25, G: 22, H: 22, I: 7, J: 12, K: 12, L: 14, M: 7, N: 15, O: 7, P: 15 },
  dreg: { A: 10, B: 6, C: 9, D: 20, E: 10, F: 10, G: 6, H: 22, I: 8, J: 10, K: 9 },
  dlist: { A: 5, B: 10, C: 22, D: 16, E: 9, F: 10, G: 6, H: 7, _appr: 17, J: 18, K: 5, L: 8, M: 12, N: 15, O: 30 },
  zkom: { A: 10, B: 9, C: 30, D: 14, E: 22, F: 24, G: 24, H: 11, I: 14 },
};
WIDTHS.opsArch = WIDTHS.ops; WIDTHS.docsArch = WIDTHS.docs; WIDTHS.dlistArch = WIDTHS.dlist;

export function mountMistrz(el, ctx) {
  const acc = ctx.grafikAcc ? ctx.grafikAcc() : { cells: false, manage: false };
  if (!acc.cells) { el.append(h('div', { class: 'panel' }, 'Mistrz: brak dostępu (wymagany poziom CLERIK, MASTER lub GOD w kolumnie „Grafik dostęp”).')); return () => {}; }
  const st = { tab: M.tabInMenu(lsGet('mp.tab', 'ops')) ? lsGet('mp.tab', 'ops') : 'ops', meta: null, data: {}, calc: {}, marks: new Map(), loaded: false, error: '', search: '', shown: PAGE, filters: {}, sorts: [] };
  const user = (ctx.user && ctx.user.email) || '';
  const body = h('div', { style: { flex: '1', minHeight: 0, overflow: 'auto', background: '#fff', border: '1px solid var(--border)' } });
  const info = h('span', { class: 'muted', style: { fontSize: '12px' } });
  const printSlot = h('span');
  const tabs = h('div', { style: { display: 'inline-flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' } });
  const search = h('input', { type: 'search', placeholder: 'Szukaj w zakładce…', style: { width: '220px' }, oninput: () => { st.search = search.value; st.shown = PAGE; draw(); } });

  async function load() {
    st.error = ''; info.textContent = 'Wczytywanie z bazy…';
    try {
      const x = await loadMistrz();
      st.meta = x.meta; st.data = x.data; st.calc = M.computeAll(st.data); st.loaded = true;
      try { st.marks = await loadMarks(); } catch { st.marks = new Map(); }   // zatwierdzenia (bez reguł mp_marks – puste)
    } catch (e) { st.error = e.code === 'permission-denied' ? 'brak uprawnień do bazy (opublikuj reguły Firestore: mp_meta, mp_rows)' : (e.message || String(e)); }
    draw();
  }

  async function runImport(kind) {
    const go = async (fn) => {
      const wait = modal('Import Mistrz PO', h('p', {}, 'Import danych wpisywanych do bazy… (kolumny liczone liczy program)'), { sticky: true });
      try {
        const r = await fn();
        wait.close();
        toast('Zaimportowano: ' + Object.entries(r.counts).map(([k, n]) => `${M.sheetByKey(k).name} ${n}`).join(', '));
        await load();
      } catch (e) { wait.close(); toast('Import nieudany: ' + (e.message || e), 'error'); }
    };
    if (kind === 'sheet') return go(() => importFromSheet(user, st.tab));
    const input = h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.remove(); if (f) go(async () => importFromXlsx(await f.arrayBuffer(), user)); });
    document.body.append(input); input.click();
  }

  /** Przyciski główne w nagłówku (wspólne z Kompetencjami) i podrzędne w pasku narzędzi, obok pola szukania; wybrane – zielona poświata. */
  function drawTabs() {
    const group = M.groupOfTab(st.tab);
    drawMistrzNav(ctx, group, (g, tab) => { st.tab = tab; st.shown = PAGE; st.filters = {}; st.sorts = []; search.value = ''; st.search = ''; draw(); });
    clear(tabs);
    const g = M.MENU.find((x) => x.key === group);
    for (const [key, label] of g.tabs) {
      const n = (st.data[key] || []).length;
      tabs.append(h('button', { class: 'btn small' + (st.tab === key ? ' glow' : ''), title: `${label} – ${n} wierszy`,
        onclick: () => { st.tab = key; lsSet('mp.tab', key); lsSet('mp.tab.' + group, key); st.shown = PAGE; st.filters = {}; st.sorts = []; search.value = ''; st.search = ''; draw(); } }, label));
    }
  }

  /**
   * Import jednej zakładki z arkusza Google (tylko GOD): zastępuje dane tej zakładki w bazie danymi z arkusza – trzy pytania o zgodę.
   * Nowszych wpisów skanera, które nie zostały wyeksportowane do arkusza, nie da się potem odzyskać z bazy.
   */
  async function importTab() {
    const name = (M.sheetByKey(st.tab) || {}).name || st.tab;
    const ask = [
      ['Import z arkusza (1/3)', `Zastąpić dane zakładki „${name}” w bazie danymi z arkusza Google?\nWszystko, co w bazie jest w tej zakładce, zostanie usunięte.`],
      ['Import z arkusza (2/3)', `Czy na pewno? Wpisy dodane w bazie (np. skanerem) po ostatnim eksporcie do arkusza przepadną.\nZakładka: „${name}”.`],
      ['Import z arkusza (3/3)', `OSTATNIE POTWIERDZENIE: zastępuję zakładkę „${name}” w bazie danymi z arkusza.`],
    ];
    for (const [t, msg] of ask) if (!(await confirmBox(t, msg, 'Tak, dalej'))) return;
    await runImport('sheet');
  }
  /** Eksport jednej zakładki do arkusza Google (MASTER i GOD): wpisuje dane z bazy w kolumny wpisywane arkusza (formuły zostają). */
  async function exportTab() {
    const name = (M.sheetByKey(st.tab) || {}).name || st.tab;
    if (!(await confirmBox('Eksport do arkusza', `Wpisać dane zakładki „${name}” z bazy do arkusza Google?\nDotychczasowe dane wpisywane w tej zakładce arkusza zostaną zastąpione (formuły zostają).`, 'Eksportuj'))) return;
    const wait = modal('Eksport do arkusza', h('p', {}, 'Zapis w arkuszu Google… (to może potrwać kilkadziesiąt sekund)'), { sticky: true });
    try { const r = await exportToSheet(st.tab); wait.close(); toast((r && r.message) || 'Wyeksportowano do arkusza.'); }
    catch (e) { wait.close(); toast('Eksport nieudany: ' + (e.message || e), 'error'); }
  }

  // ---- Lista detali: dodawanie pozycji (tabela jak „Dodaj zakupy”) i edycja wiersza (PPM + potwierdzenie) ----
  let canList = !!acc.manage;   // uprawnienie do dodawania / edycji Listy detali (Setup „details” albo MASTER, GOD) – z API mp_getPermissions
  api('mp_getPermissions', []).then((p) => { canList = !!(p && (p.details || p.manage)) || !!acc.manage; draw(); }).catch(() => {});
  const DRAFT_KEY = 'zks_mp_detail_draft';
  const loadDraft = () => { try { return DD.parseDraft(localStorage.getItem(DRAFT_KEY) || '[]'); } catch { return DD.emptyDraft(); } };
  const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* bez zapisu tabela zostaje w pamięci */ } };

  function addDialog() {
    let draft = loadDraft();
    const widths = { komis: 110, rysunek: 140, pozycja: 80, komplet: 90, ilosc: 100, nazwa: 220, uwagi: 200 };
    const status = h('div', { class: 'muted', style: { minHeight: '18px' } });
    const body2 = h('div', { class: 'table-wrap', style: { maxHeight: '55vh', margin: '6px 0', position: 'relative' } });
    const cols = DD.DRAFT_FIELDS.map((f) => ({ key: f, title: DD.LABELS[f], left: f === 'nazwa' || f === 'uwagi' || f === 'rysunek' }));
    const dgrid = createCellGrid({
      body: body2,
      text: (row, col) => String(row[col.key] ?? ''),
      editable: () => true,
      commit: async (changes) => { for (const ch of changes) ch.row[ch.col.key] = ch.text; saveDraft(draft); paintStatus(); return changes.map((ch) => ({ ok: true, text: ch.text })); },
    });
    const paintStatus = () => { status.className = 'muted'; status.textContent = `Wypełnione wiersze: ${DD.filledCount(draft)}`; };
    const draw2 = () => { dgrid.render(cols, draft, h('tr', {}, ...cols.map((c) => h('th', { style: { width: widths[c.key] + 'px' } }, c.title)))); paintStatus(); };
    let m;
    const send = h('button', { class: 'btn primary', onclick: async () => {
      const problem = DD.validateDraft(draft);
      if (problem) { status.className = 'err'; status.textContent = problem; return; }
      if (!(await confirmBox('Dodać detale do listy?', `Dodać ${DD.filledCount(draft)} poz. do Listy detali?`, 'Dodaj'))) return;
      send.disabled = true;
      let sent = 0, failure = null;
      for (let i = 0; i < draft.length; i++) {
        const r = draft[i];
        if (DD.isBlankRow(r)) continue;
        try { await api('mp_addDetail', [DD.toForm(r)]); sent++; draft[i] = DD.blankRow(); saveDraft(draft); }   // wysłane znikają od razu – nic nie pójdzie drugi raz
        catch (e) { failure = `Wiersz ${i + 1}: ${e.message}` + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : ''); break; }
      }
      draft = DD.compactDraft(draft); saveDraft(draft); draw2(); send.disabled = false;
      if (sent > 0) load();
      if (failure) { status.className = 'err'; status.textContent = `Dodano pozycje: ${sent}. ${failure}`; } else { m.close(); toast(`Dodano pozycje do Listy detali: ${sent}.`); }
    } }, 'Dodaj do listy');
    m = modal('Dodaj detale do listy', h('div', {}, h('div', { class: 'muted' }, 'Tabela działa jak Arkusze Google (zaznaczanie, wpisywanie, Enter / Tab / strzałki, kopiuj / wklej, cofnij Ctrl+Z); wpisane dane są zapamiętywane i znikają dopiero po dodaniu albo wyczyszczeniu. Wymagane: komis, nr rysunku, nr poz., komplet i ilość zlecona (liczba całkowita ≥ 1); nazwa i uwagi są opcjonalne.'),
      body2, status, h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Wyczyścić tabelę?', 'Usunąć wszystkie wpisane dane z tabeli? Tego nie można cofnąć.', 'Usuń')) { draft = DD.emptyDraft(); saveDraft(draft); draw2(); } } }, 'Wyczyść'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'), send)), { wide: true, onClose: () => dgrid.destroy() });
    m.root.style.maxWidth = '94vw'; m.root.style.width = '1100px';
    draw2();
  }

  /** PPM na wierszu Listy detali: pytanie o edycję, potem okno edycji tego jednego wiersza (zapis przez API mp_updateDetail z kontrolą poprzedniej wartości). */
  async function editRow(row) {
    const v = row.v;
    if (!(await confirmBox('Edycja wiersza', `Edytować wiersz ${row.row} Listy detali?\nKomis: ${v.B ?? ''}  ·  rysunek: ${v.D ?? ''}  ·  poz.: ${v.E ?? ''}  ·  komplet: ${v.F ?? ''}`, 'Edytuj'))) return;
    const fields = [['B', 'Komis'], ['C', 'Nazwa elementu'], ['D', 'Nr rysunku'], ['E', 'Nr poz.'], ['F', 'Komplet'], ['G', 'Ilość zlecona (szt x kpl)'], ['O', 'Uwagi']];
    const inputs = Object.fromEntries(fields.map(([c]) => [c, h('input', { type: 'text', value: String(v[c] ?? ''), style: { width: '100%' } })]));
    const err = h('div', { class: 'err' });
    let m;
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const patch = {}, expect = {};
      for (const [c] of fields) { const now = inputs[c].value.trim(), before = String(v[c] ?? '').trim(); if (now !== before) { patch[c] = now; expect[c] = before; } }
      if (!Object.keys(patch).length) { m.close(); return; }
      save.disabled = true; err.textContent = '';
      try { const r = await api('mp_updateDetail', [{ row: row.row, patch, expect }]); m.close(); toast((r && r.message) || 'Zapisano zmiany.'); await load(); }
      catch (e) { save.disabled = false; err.textContent = 'Nie zapisano: ' + (e.message || e); }
    } }, 'Zapisz zmiany');
    m = modal(`Edycja wiersza ${row.row} – Lista detali`, h('div', {}, ...fields.map(([c, label]) => h('label', { class: 'f', style: { display: 'block', margin: '4px 0' } }, h('div', { class: 'muted' }, label), inputs[c])),
      err, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), save)), { wide: true });
  }
  const addBtn = h('button', { class: 'btn small primary', style: { display: 'none' }, title: 'Dodaj pozycje do Listy detali (tabela jak w „Dodaj zakupy”)', onclick: addDialog }, '+ Dodaj detale');

  /** Przeliczenie „szt zrobione” w Liście detali z Rejestru detali (sztuki zlicza i zapisuje w bazie program; MASTER, GOD). */
  async function recount() {
    const wait = modal('Przeliczanie sztuk', h('p', {}, 'Liczenie sztuk zrobionych z Rejestru detali…'), { sticky: true });
    try { const r = await api('mp_recountDetails', [], { timeoutMs: 240000 }); wait.close(); toast((r && r.message) || 'Przeliczono.'); await load(); }
    catch (e) { wait.close(); toast('Przeliczanie nieudane: ' + (e.message || e), 'error'); }
  }
  const recountBtn = h('button', { class: 'btn small', style: { display: 'none' }, title: 'Przelicza „szt zrobione” w Liście detali z Rejestru detali i zapisuje w bazie (sztuki zapisują się też same przy każdej rejestracji detalu skanerem)', onclick: recount }, 'Przelicz sztuki');

  function draw() {
    recountBtn.style.display = acc.manage && st.tab === 'dlist' ? '' : 'none';
    addBtn.style.display = canList && st.tab === 'dlist' ? '' : 'none';
    drawTabs();
    clear(body); clear(printSlot);
    const m = st.meta;
    info.textContent = m ? `Baza: import ${new Date(m.importedAt).toLocaleString('pl-PL')}${m.importedBy ? ' · ' + m.importedBy : ''}${m.source ? ' · z ' + (m.source === 'plik' ? 'pliku .xlsx' : 'arkusza') : ''}` : '';
    if (st.error) { body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy Mistrza: ' + st.error)); return; }
    if (!st.loaded) { body.append(h('p', { class: 'muted', style: { padding: '12px' } }, 'Wczytywanie…')); return; }
    if (!m) {
      body.append(h('div', { style: { padding: '14px' } }, h('p', {}, 'Danych Mistrz PO nie ma jeszcze w bazie.'),
        acc.importG ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: importTab }, 'Import z arkusza'))
          : h('p', { class: 'muted' }, 'Import z arkusza robi administrator (GOD).')));
      return;
    }
    const sh = M.sheetByKey(st.tab) || M.SHEETS[0];
    const isList = sh.key === 'dlist' || sh.key === 'dlistArch';
    // Lista detali: dodatkowa kolumna programu – zatwierdzenie wypuszczenia dokumentu przez mistrza (kolumna N arkusza = potwierdzenie wydruku)
    const cols = M.sheetColumns(sh);
    if (isList) cols.splice(cols.findIndex((c) => c.key === 'H') + 1, 0, { key: '_appr', title: 'zatwierdzenie wypuszczenia', full: 'Zatwierdzenie wypuszczenia dokumentu przez mistrza (dane programu; kolumna N arkusza to potwierdzenie wydruku)', prog: true });
    const rows = st.calc[sh.key] || [], src = st.data[sh.key] || [];
    const mark = (i) => (isList ? st.marks.get(detailKey(rows[i])) : null);
    const markText = (m) => (m ? `✔ ${new Date(m.at).toLocaleDateString('pl-PL')}${m.by ? ' · ' + m.by.split('@')[0] : ''}` : '');
    const text = (i, c) => (c.key === '_appr' ? markText(mark(i)) : M.cellText(sh.key, c.key, rows[i][c.key]));
    let ids = rows.map((_, i) => i);
    ids = visibleRows(ids, cols, st.filters, text);
    if (st.search.trim()) { const q = st.search.trim().toLowerCase(); ids = ids.filter((i) => cols.some((c) => text(i, c).toLowerCase().includes(q))); }
    if (st.sorts.length) ids = sortRows(ids, cols, st.sorts, text);
    const W = WIDTHS[sh.key] || {};
    const table = h('table', { class: 't', style: { fontSize: '12px', tableLayout: 'fixed', width: 'max-content' } });
    const colgroup = h('colgroup', {}, h('col', { style: { width: '44px' } }), ...cols.map((c) => h('col', { style: { width: (W[c.key] || 10) * 7 + 12 + 'px' } })));
    const sortMark = (k) => { const i = st.sorts.findIndex((x) => x.key === k); return i < 0 ? '' : (st.sorts[i].ascending ? ' ↑' : ' ↓'); };
    const thL = h('tr', {}, h('th', { style: { top: 0, fontSize: '10px', color: '#666' } }, ''), ...cols.map((c) => h('th', { style: { top: 0, fontSize: '10px', color: '#666', fontWeight: 400, height: '16px', padding: '0 4px' } }, c.prog ? 'program' : c.key)));
    const thT = h('tr', {}, h('th', { title: 'Numer wiersza w arkuszu', style: { top: '17px' } }, 'wiersz'), ...cols.map((c) => h('th', {
      class: 'click' + (st.filters[c.key] ? ' filtered' : ''), title: c.full + ' – kliknij: filtr i sortowanie',
      style: { top: '17px', whiteSpace: 'normal', lineHeight: 1.15, background: c.calc ? '#dfe8f7' : c.prog ? '#fff2cc' : '', fontStyle: c.calc ? 'italic' : 'normal' },
      onclick: () => openFilter(c, cols, rows.map((_, i) => i), text) }, (c.calc ? 'ƒ ' : '') + c.title + sortMark(c.key))));
    const tbody = h('tbody', {});
    // kolejność arkusza: kolor luki w numerach operacji porównuje z następnym wierszem pliku
    for (const i of ids.slice(0, st.shown)) {
      const r = rows[i], next = rows[i + 1] || null;
      tbody.append(h('tr', { title: canList && sh.key === 'dlist' ? 'PPM – edycja wiersza' : '', oncontextmenu: canList && sh.key === 'dlist' ? (e) => { e.preventDefault(); editRow(src[i]); } : undefined },
        h('td', { style: { color: '#888', fontSize: '10px' } }, String(src[i].row)), ...cols.map((c) => {
        const col = M.cellColor(sh.key, r, c.key, next), t = text(i, c);
        // kod QR: przy detalach niezatwierdzonych – obraz kodu; zatwierdzone – przycisk „QR” (kliknięcie – duży kod)
        if (c.key === 'H' && isList) {
          if (!t) return h('td', {});
          if (mark(i)) return h('td', {}, h('button', { class: 'btn small', style: { padding: '0 6px', fontSize: '11px' }, title: t, onclick: () => qrDialog(t) }, 'QR'));
          const box = h('div', { title: t + ' – kliknij: powiększ', style: { cursor: 'zoom-in', width: '46px', height: '46px', margin: '0 auto' }, onclick: () => qrDialog(t) });
          box.innerHTML = qrSvg(t, { px: 46, border: 1 });
          return h('td', { style: { padding: '1px', background: '#fff' } }, box);
        }
        if (c.key === '_appr') {
          const m = mark(i), key = detailKey(r);
          if (!acc.manage) return h('td', { class: 'left', style: { background: m ? '#d9ead3' : '' } }, t);
          return h('td', { class: 'left', style: { background: m ? '#d9ead3' : '', padding: '1px 4px' } }, m
            ? h('span', {}, t + ' ', h('button', { class: 'btn small', style: { padding: '0 4px', fontSize: '10px' }, title: 'Cofnij zatwierdzenie', onclick: () => toggleMark(key, false) }, '✕'))
            : h('button', { class: 'btn small', style: { padding: '0 6px', fontSize: '11px' }, title: 'Zatwierdź wypuszczenie dokumentu', onclick: () => toggleMark(key, true) }, 'Zatwierdź'));
        }
        return h('td', { class: typeof r[c.key] === 'number' ? '' : 'left', title: t.length > 18 ? t : '', style: { background: col ? col[0] : (c.calc ? '#f6f8fc' : ''), color: col && col[1] ? col[1] : '',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '1px 4px' } }, t);
      })));
    }
    table.append(colgroup, h('thead', {}, thL, thT), tbody);
    body.append(table);
    clear(printSlot);
    if (isList) printSlot.append(h('button', { class: 'btn small primary', title: 'Wydruk A4 jak karta DETALE arkusza – z kodami QR czytelnymi dla telefonu', onclick: () => printDialog(sh, ids) }, 'Drukuj detale (A4)…'));
    const more = ids.length > st.shown;
    body.append(h('div', { class: 'row', style: { padding: '6px', gap: '10px' } }, h('span', { class: 'muted' }, `Wierszy: ${ids.length}${ids.length !== rows.length ? ' z ' + rows.length : ''}`),
      more ? h('button', { class: 'btn small', onclick: () => { st.shown += PAGE; draw(); } }, `Pokaż kolejne (${Math.min(PAGE, ids.length - st.shown)})`) : null,
      more ? h('button', { class: 'btn small', onclick: () => { st.shown = ids.length; draw(); } }, 'Pokaż wszystkie') : null));
  }

  function openFilter(c, cols, all, text) {
    const cur = st.sorts.find((x) => x.key === c.key);
    columnFilterDialog({ title: `${c.key}: ${c.title}`, options: filterOptions(all, cols, st.filters, text, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
      onApply: (filter, sort) => {
        if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
        st.sorts = st.sorts.filter((x) => x.key !== c.key); if (sort !== null) st.sorts.unshift({ key: c.key, ascending: sort });
        st.shown = PAGE; draw();
      } });
  }

  async function toggleMark(key, on) {
    try { await setMark(key, on, user); if (on) st.marks.set(key, { by: user, at: Date.now() }); else st.marks.delete(key); draw(); }
    catch (e) { toast('Nie zapisano zatwierdzenia: ' + (e.code === 'permission-denied' ? 'brak uprawnień (reguły Firestore: mp_marks)' : e.message || e), 'error'); }
  }

  /** Wydruk A4 Listy detali (kody QR czytelne dla telefonu): wybór wierszy, potem drukarka albo PDF. */
  function printDialog(sh, ids) {
    const rows = st.calc[sh.key] || [];
    const sets = {
      visible: ['Wiersze widoczne w tabeli (po filtrach i wyszukiwaniu)', ids],
      unapproved: ['Niezatwierdzone (bez zatwierdzenia wypuszczenia)', ids.filter((i) => !st.marks.get(detailKey(rows[i])))],
      toPrint: ['Zatwierdzone, bez potwierdzenia wydruku (kolumna N pusta)', ids.filter((i) => st.marks.get(detailKey(rows[i])) && String(rows[i].N ?? '').trim() === '')],
    };
    let pick = 'visible';
    const radios = Object.entries(sets).map(([k, [label, list]]) => h('label', { style: { display: 'block', margin: '4px 0' } },
      h('input', { type: 'radio', name: 'mpPrint', checked: k === pick, onchange: () => { pick = k; } }), ` ${label} – ${list.length}`));
    const run = async (pdf) => {
      const list = sets[pick][1].map((i) => rows[i]).filter((r) => r.H || r.C);
      if (!list.length) { toast('Brak wierszy do wydruku'); return; }
      const html = detailsPrintHtml(list, { sheetKey: sh.key, footer: `ZKS PO · ${sh.name} · ${new Date().toLocaleString('pl-PL')} · wierszy: ${list.length}` });
      m.close();
      const ok = pdf ? await window.zks.savePdf(html, { name: 'detale.pdf', pageSize: 'A4', landscape: false }) : await window.zks.printReport(html, { pageSize: 'A4', landscape: false });
      if (ok) toast(pdf ? 'Zapisano PDF' : 'Wysłano do drukarki');
    };
    const m = modal('Wydruk detali (A4)', h('div', {}, h('p', { class: 'muted' }, 'Kod QR na wydruku: 26 mm, czytelny dla telefonu. Kolumna N arkusza (potwierdzenie wydruku) nie zmienia się.'), ...radios,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => run(true) }, 'Zapisz PDF…'), h('button', { class: 'btn primary', onclick: () => run(false) }, 'Drukuj…'), h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'))));
  }

  function qrDialog(code) {
    const img = h('div', { style: { width: '260px', height: '260px', margin: '0 auto' } }); img.innerHTML = qrSvg(code, { px: 260 });
    const m = modal('Kod QR detalu', h('div', {}, img, h('p', { class: 'muted' }, 'Treść kodu (jak w kolumnie H arkusza):'), h('pre', { style: { userSelect: 'text', whiteSpace: 'pre-wrap', fontSize: '14px' } }, code),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(code); toast('Skopiowano'); } }, 'Kopiuj'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))));
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'panel', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, h('b', {}, 'Mistrz'), search, tabs,
      h('button', { class: 'btn small', title: 'Wczytaj ponownie dane z bazy', onclick: load }, 'Odśwież'),
      acc.importG ? h('button', { class: 'btn small', title: 'Import tej zakładki z arkusza Google Mistrz_po do bazy (tylko GOD; zastępuje dane zakładki w bazie; trzy pytania o zgodę)', onclick: importTab }, 'Import z arkusza') : null,
      addBtn, recountBtn,
      acc.manage ? h('button', { class: 'btn small', title: 'Eksport tej zakładki z bazy do arkusza Google Mistrz_po (MASTER, GOD; zastępuje dane wpisywane w zakładce arkusza)', onclick: exportTab }, 'Eksport do arkusza') : null,
      printSlot, h('span', { class: 'grow' }), info),
    h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Kolumny ƒ liczy program z danych w bazie (jak formuły arkusza). Skaner i program zapisują tylko w bazie; arkusz Google aktualizuje się wyłącznie przyciskiem „Eksport do arkusza”.')),
    body);
  draw();
  load();
  return () => {};
}
