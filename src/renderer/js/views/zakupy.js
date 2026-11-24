import { h, clear, api, apiCached, toast, modal, field, filterHeader, columnFilterDialog, confirmBox, choiceBox } from '../ui.js';
import * as Z from '../logic/zakupy.js';
import { updateSorts, sortLabels, formatDate, parseDate } from '../logic/common.js';
import { filterCodes, parseQuantity } from '../logic/scanner.js';
import { createCellGrid } from './cellGrid.js';

export function mountZakupy(el, ctx) {
  const level = ctx.level('zakupy');
  const canWrite = level === 'write';
  const st = { rows: [], archive: [], exactRows: false, view: 'ordered', filters: {}, sorts: [], codes: null, archiveLoaded: false };
  const info = h('span', { class: 'muted' });
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0 } });
  const tabs = h('div', { class: 'tabs' });
  const notice = h('div', { class: 'muted' });
  const canEdit = () => canWrite && st.exactRows && st.fresh;   // edycja komórek: prawo zapisu, serwer z numerami wierszy, dane świeże (nie z pamięci)
  const codeList = h('datalist', { id: 'zk-codes' });
  const grid = createCellGrid({
    body, listId: 'zk-codes',
    text: (row, col) => Z.display(col.key, Z.value(row, col.key)),
    editable: (row, col) => canEdit() && Z.editableView(st.view) && !!Z.EDIT_COLS[col.key],
    onRowHeader: (row) => openRow(row, true),
    readOnlyNote: canWrite ? (st.exactRows ? 'Dane z pamięci – poczekaj na odświeżenie' : 'Serwer bez dokładnych numerów wierszy – zaktualizuj skrypt') : 'Uprawnienia: tylko odczyt',
    commit: commitCells,
  });

  /** Zapis komórek w arkuszu (updateZakupyCells) z kontrolą poprzedniej wartości; wynik na każdą zmianę. */
  async function commitCells(changes) {
    const out = changes.map(() => null), items = [];
    changes.forEach((ch, i) => {
      const n = Z.normalizeEdit(ch.col.key, ch.text);
      if (!n.ok) { out[i] = { ok: false, error: n.error }; return; }
      items.push({ i, body: { rowNumber: ch.row.rowNumber, col: Z.EDIT_COLS[ch.col.key], value: n.value, expect: ch.expect } });
    });
    if (items.length) {
      let r;
      try { r = await api('updateZakupyCells', [items.map((x) => x.body)]); }
      catch (e) { const msg = /nieznan|unknown|not found|Brak funkcji/i.test(e.message || '') ? 'serwer (Apps Script) ma starą wersję – wdróż nowy Api.gs' : e.message; items.forEach((x) => { out[x.i] = { ok: false, error: msg }; }); return out; }
      const res = (r && r.results) || [];
      items.forEach((x, k) => {
        const z = res[k] || {}, ch = changes[x.i];
        if (z.s === 'ok') { Z.setValue(ch.row, ch.col.key, z.now); out[x.i] = { ok: true, text: Z.display(ch.col.key, z.now) }; }
        else if (z.s === 'conflict') { Z.setValue(ch.row, ch.col.key, z.now || ''); out[x.i] = { ok: false, error: 'komórka zmieniona w arkuszu – pokazuję aktualną wartość' }; }
        else out[x.i] = { ok: false, error: z.s === 'badrow' ? 'brak takiego wiersza w arkuszu' : z.s === 'badcol' ? 'ta kolumna nie jest edytowalna' : 'serwer nie potwierdził zapisu (stara wersja skryptu?)' };
      });
    }
    return out;
  }

  async function load() {
    clear(body); body.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie zakupów…'));
    try {
      st.fresh = false;
      await apiCached('getZakupyData', [], (data, meta) => {
        st.rows = data.rows || []; st.exactRows = !!data.exactRows; st.fresh = !meta.cached;
        notice.textContent = canWrite && !st.exactRows ? 'Serwer nie podaje dokładnych numerów wierszy: zapisy są wyłączone (tylko odczyt). Zaktualizuj wdrożenie skryptu.' : '';
        draw();
      });
    } catch (e) {
      clear(body); body.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: load }, 'Ponów')));
    }
  }

  async function ensureArchive() {
    if (st.archiveLoaded) return;
    try { await apiCached('getZakupyArchiveData', [], (d) => { st.archive = d.rows || []; st.archiveLoaded = true; if (st.view === 'archive') draw(); }); }
    catch (e) { toast('Błąd archiwum: ' + e.message, true); }
  }

  async function ensureCodes() {
    if (st.codes) return;
    try { await apiCached('getZakupyProductCodes', [], (l) => { st.codes = (l || []).filter((c) => String(c).trim()); codeList.replaceChildren(...st.codes.slice(0, 3000).map((c) => h('option', { value: c }))); }); } catch (e) { st.codes = []; }
  }

  function drawTabs() {
    clear(tabs);
    for (const [id, label] of Object.entries(Z.VIEWS)) {
      tabs.append(h('button', { class: st.view === id ? 'on' : '', onclick: async () => {
        st.view = id; st.filters = {}; st.sorts = [];
        if (id === 'archive') await ensureArchive();
        if (Z.editableView(id)) ensureCodes();
        grid.clearHistory();
        draw();
      } }, label));
    }
  }

  function draw() {
    drawTabs();
    const cols = Z.columns(st.view);
    const src = Z.source(st.rows, st.archive, st.view);
    const rows = Z.shown(st.rows, st.archive, st.view, st.filters, st.sorts);
    const labels = sortLabels(st.sorts);
    const thead = h('tr', {}, ...cols.map((c) => filterHeader(c, {
      filtered: !!st.filters[c.key], label: labels[c.key],
      onclick: () => {
        const cur = st.sorts.find((s) => s.key === c.key);
        columnFilterDialog({
          title: c.title, options: Z.options(src, st.view, st.filters, c), activeFilter: st.filters[c.key], activeSort: cur ? cur.ascending : null,
          onApply: (filter, sort) => {
            if (filter) st.filters[c.key] = filter; else delete st.filters[c.key];
            st.sorts = updateSorts(st.sorts, c.key, sort); draw();
          },
        });
      },
    })));
    if (Z.editableView(st.view)) {
      // edycja komórek jak w arkuszu Google (Zakupione, Odebrane bez PZ)
      grid.render(cols.map((c) => ({ ...c, left: c.key === 'opis' || c.key === 'kod', list: c.key === 'kod' })), rows, thead);
      info.textContent = (st.fresh ? '' : 'Dane z pamięci, odświeżanie… (edycja po odświeżeniu)  ·  ') + `Pozycji: ${rows.length}` + (rows.length !== src.length ? ` z ${src.length}` : '')
        + (canEdit() ? '  ·  edycja jak w arkuszu Google, zmiany zapisują się od razu; pozycja zmieni widok po odświeżeniu' : '');
      return;
    }
    const tbody = h('tbody', {});
    for (const r of rows) {
      const flagged = st.view === 'ordered' && Z.needsCorrection(r);
      tbody.append(h('tr', { class: 'click', onclick: () => openRow(r), style: flagged ? { background: '#c62828', color: '#fff' } : null },
        ...cols.map((c) => h('td', { class: c.key === 'opis' || c.key === 'kod' ? 'left' : '', style: flagged ? { background: '#c62828', color: '#fff' } : null }, Z.display(c.key, Z.value(r, c.key))))));
    }
    clear(body);
    body.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, thead), tbody));
    info.textContent = (st.fresh ? '' : 'Dane z pamięci, odświeżanie… (zapis po odświeżeniu)  ·  ') + `Pozycji: ${rows.length}` + (rows.length !== src.length ? ` z ${src.length}` : '') + (st.sorts.length ? '  ·  Sortowanie: ' + Z.sortSummary(st.view, st.sorts) : '');
  }

  function openRow(row, details = false) {
    // Realizacja: pozycje bez PZ (też z x i datą zakupu, jeśli wymagają korekty) w widoku Zamówione.
    const editable = !details && canWrite && st.exactRows && st.fresh && st.view === 'ordered' && Z.lacksPz(row);
    if (editable) { ensureCodes().then(() => realizeDialog(row)); return; }
    const m = modal(st.view === 'archive' ? 'Archiwum: szczegóły' : Z.isNoPz(row) ? 'Odebrane bez PZ: szczegóły' : !Z.lacksPz(row) ? 'Zakupione: szczegóły' : 'Zamówione: szczegóły', h('div', {},
      orderFrame(row), purchaseFrameReadOnly(row), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }

  const frame = (title, ...c) => h('div', { style: { border: '1px solid #bbb', borderRadius: '0', padding: '6px 10px', margin: '6px 0' } }, h('b', { class: 'muted' }, title), ...c);
  const cell = (label, v, grow = 1) => h('div', { style: { flex: grow, minWidth: 0 } }, h('div', { class: 'muted' }, label), h('div', { style: { minHeight: '18px', whiteSpace: 'pre-wrap' } }, v || '—'));
  const orderFrame = (row) => frame('Zamówienie', h('div', { class: 'row', style: { alignItems: 'flex-start' } }, cell('Opis produktu', row.columnK, 3)),
    h('div', { class: 'row', style: { alignItems: 'flex-start' } }, cell('Data', formatDate(row.columnH)), cell('Ilość', row.columnI, 0.7), cell('ZMW', row.columnG)));
  const purchaseFrameReadOnly = (row) => frame('Zakup', h('div', { class: 'row', style: { alignItems: 'flex-start' } }, cell('Data zakupu', formatDate(row.columnB)), cell('Kod produktu', row.columnC, 1.2), cell('Ilość', row.columnD, 0.9)),
    h('div', { class: 'row', style: { alignItems: 'flex-start' } }, cell('Cena jednostkowa', row.columnF), cell('PZ', row.columnE, 1.2), cell('', '', 0.9)), cell('Uwagi', row.columnL));

  /** Lista kodów pod polem: przewijana, filtrowana wpisanym tekstem. */
  function codeField(initial) {
    const input = h('input', { type: 'text', value: initial, autocomplete: 'off' });
    const list = h('div', { class: 'opts', style: { maxHeight: '120px', display: 'none' } });
    const render = () => {
      clear(list);
      const items = input.value.trim() && (st.codes || []).includes(input.value.trim()) ? [] : filterCodes(input.value, st.codes || []).slice(0, 200);
      list.style.display = items.length && document.activeElement === input ? '' : 'none';
      for (const c of items) list.append(h('div', { style: { padding: '2px 6px', cursor: 'pointer' }, onmousedown: (e) => { e.preventDefault(); input.value = c; render(); } }, c));
    };
    input.addEventListener('input', render); input.addEventListener('focus', render); input.addEventListener('blur', () => { list.style.display = 'none'; });
    return { input, node: h('div', {}, field('Kod produktu', input), list) };
  }

  function realizeDialog(row) {
    const kod = codeField(row.columnC);
    const mk = (v) => h('input', { type: 'text', value: v });
    const ilosc = mk(row.columnD), zakup = h('input', { type: 'date', value: toIsoDate(row.columnB) || todayIso() }), cena = mk(row.columnF), pz = mk(row.columnE);
    pz.placeholder = 'numer PZ albo x (odebrane bez PZ)';
    const uwagi = h('textarea', { rows: 2 }, row.columnL);
    const err = h('div', { class: 'err' });
    let m;
    const col = (n, label, input) => h('div', { style: { flex: n, minWidth: 0 } }, field(label, input));
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      err.textContent = '';
      const orderedQty = String(row.columnI || row.columnD).trim();
      const remaining = Z.remainingQuantity(orderedQty, ilosc.value);
      const zakupText = zakup.value ? isoToPl(zakup.value) : '';
      let text = `Kod: ${kod.input.value.trim()}` + (pz.value.trim() ? `\nPZ: ${pz.value.trim()}` : '') + (ilosc.value.trim() ? `\nIlość zakupiona: ${ilosc.value.trim()}` : '');
      let createRest = false;
      if (remaining !== null) {
        text += `\n\nZamówiono ${orderedQty}, zakupiono ${ilosc.value.trim()}. Utworzyć nową pozycję z pozostałą ilością ${remaining}` + (row.columnG.trim() ? ` (ZMW ${row.columnG.trim()})` : '') + '? Bez PZ i daty zakupu.';
        const choice = await choiceBox('Potwierdzić zapis?', text, [['Anuluj', null], ['Zapisz bez nowej pozycji', false], ['Zapisz i utwórz pozycję', true]]);
        if (choice === null) return;
        createRest = choice;
      } else if (!(await confirmBox('Potwierdzić zapis?', text, 'Zapisz'))) return;
      saveBtn.disabled = true;
      try {
        const v = (x) => x.value.trim();
        const r = await api('updateZakupyItem', [{
          rowNumber: row.rowNumber, expectKod: row.columnC, zakup: zakupText, kod: kod.input.value.trim(),
          ilosc: v(ilosc), iloscKupiona: v(ilosc), pz: v(pz), cena: v(cena), zmw: row.columnG.trim(), opis: row.columnK.trim(), uwagi: v(uwagi),
        }]);
        if (r && r.success === false) throw new Error(r.message || 'Serwer odrzucił zapis.');
        let note = '';
        if (createRest) {
          const rest = { kod: kod.input.value.trim(), ilosc: remaining, zmw: row.columnG.trim(), opis: row.columnK.trim(), uwagi: v(uwagi) };
          if (v(cena)) rest.cena = v(cena);
          try { await api('addZakupyItem', [rest]); note = ` Dodano nową pozycję z ilością ${remaining}.`; }
          catch (e2) { note = ` Nie udało się dodać pozycji z pozostałą ilością ${remaining}: ${e2.message}`; }
        }
        m.close(); toast(((r && r.message) || 'Zapisano realizację zakupu.') + note); load();
      } catch (e) {
        saveBtn.disabled = false;
        err.textContent = 'Błąd zapisu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : '');
      }
    } }, 'Zapisz jako zakupione');
    m = modal('Zamówione: realizacja zakupu', h('div', {}, orderFrame(row),
      frame('Zakup', h('div', { class: 'row', style: { alignItems: 'flex-start' } }, col(1, 'Data zakupu', zakup), h('div', { style: { flex: 1.2, minWidth: 0 } }, kod.node), col(0.9, 'Ilość zakupiona', ilosc)),
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, col(1, 'Cena jednostkowa', cena), col(1.2, 'PZ', pz), h('div', { style: { flex: 0.9 } })), field('Uwagi', uwagi)),
      h('div', { class: 'muted' }, 'Zapis oznacza pozycję jako zakupioną (znak x w kolumnie J). W polu PZ wpisz numer PZ albo „x”, jeśli towar odebrano, a PZ jeszcze nie ma (pozycja trafi do Odebrane bez PZ). Puste pola zostaną zapisane jako puste.'),
      err, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), saveBtn)), { wide: true });
  }

  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // data zakupu uzupełnia się sama (dziś)
  const toIsoDate = (raw) => { const d = parseDate(raw); return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` : ''; };
  const isoToPl = (iso) => { const [y, mo, d] = iso.split('-'); return `${d}.${mo}.${y}`; };

  // ---- tabela dodawania: 10 wierszy zapamiętywanych między uruchomieniami ----
  const DRAFT_KEY = 'zks_zakupy_draft';
  const loadDraft = () => { try { return Z.parseDraft(localStorage.getItem(DRAFT_KEY) || '[]'); } catch (e) { return Z.emptyDraft(); } };
  const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* bez zapisu tabela zostaje w pamięci */ } };

  async function addDialog() {
    await ensureCodes();
    let draft = loadDraft();
    const widths = { kod: 150, ilosc: 80, zmw: 120, opis: 300, uwagi: 240 };
    const labels = { kod: 'Kod', ilosc: 'Ilość', zmw: 'ZMW', opis: 'Opis', uwagi: 'Uwagi' };
    const status = h('div', { class: 'muted', style: { minHeight: '18px' } });
    const dl = h('datalist', { id: 'draftcodes' }, ...(st.codes || []).slice(0, 3000).map((c) => h('option', { value: c })));
    // tabela jak w Arkuszach Google (bez filtrowania i sortowania): zaznaczanie, strzałki / Tab / Enter, wpisanie znaku zaczyna edycję, F2 / dwuklik,
    // Delete, Ctrl+C / X / V (także wklejanie bloku z arkusza), Ctrl+Z / Y; wiersz z zaznaczeniem ma zieloną poświatę
    const body = h('div', { class: 'table-wrap', style: { maxHeight: '55vh', margin: '6px 0', position: 'relative' } });
    const cols = Z.DRAFT_FIELDS.map((f) => ({ key: f, title: labels[f], left: f === 'kod' || f === 'opis' || f === 'uwagi', list: f === 'kod',
      // ZMW: wpisywany numer ląduje przed „/MM/RR”, o ile komórka ma jeszcze sam szablon
      ...(f === 'zmw' ? { start: (cur, typed) => (Z.isZmwEmpty(cur) ? { value: (typed || '') + cur, caret: typed ? typed.length : 0 } : { value: typed != null ? typed : cur, caret: typed != null ? -1 : null }) } : {}) }));
    const dgrid = createCellGrid({
      body, listId: 'draftcodes',
      text: (row, col) => String(row[col.key] ?? ''),
      editable: () => true,
      commit: async (changes) => {
        for (const ch of changes) ch.row[ch.col.key] = ch.text;
        saveDraft(draft); status.className = 'muted'; status.textContent = `Wypełnione wiersze: ${Z.filledCount(draft)}`;
        return changes.map((ch) => ({ ok: true, text: ch.text }));
      },
    });
    const draw = () => {
      dgrid.render(cols, draft, h('tr', {}, ...cols.map((c) => h('th', { style: { width: widths[c.key] + 'px' } }, c.title))));
      status.className = 'muted'; status.textContent = `Wypełnione wiersze: ${Z.filledCount(draft)}`;
    };
    let m;
    const send = h('button', { class: 'btn primary', onclick: async () => {
      const problem = Z.validateDraft(draft);
      if (problem) { status.className = 'err'; status.textContent = problem; return; }
      status.className = 'muted';
      if (!(await confirmBox('Dodać pozycje?', `Dodać ${Z.filledCount(draft)} poz. do arkusza zakupów?`, 'Wyślij'))) return;
      send.disabled = true;
      let sent = 0, failure = null;
      for (let i = 0; i < draft.length; i++) {
        const r = draft[i];
        if (Z.isBlankRow(r)) continue;
        const q = parseQuantity(r.ilosc); if (!q) continue;
        try {
          await api('addZakupyItem', [{ kod: r.kod.trim(), ilosc: q, zmw: Z.zmwToSend(r.zmw), opis: r.opis.trim(), uwagi: r.uwagi.trim() }]);
          sent++; draft[i] = Z.blankRow(); saveDraft(draft);   // wysłane znikają od razu, więc nic nie pójdzie drugi raz
        } catch (e) {
          failure = `Błąd dodawania pozycji w wierszu ${i + 1}: ${e.message}` + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : '');
          break;
        }
      }
      draft = Z.compactDraft(draft); saveDraft(draft); draw(); send.disabled = false;
      const summary = failure ? `Dodano pozycje: ${sent}. ${failure}` : `Dodano pozycje: ${sent}.`;
      if (sent > 0) load();
      if (failure) { status.className = 'err'; status.textContent = summary; } else { m.close(); toast(summary); }
    } }, 'Wyślij');
    m = modal('Dodaj zakupy', h('div', {}, h('div', { class: 'muted' }, 'Tabela działa jak Arkusze Google (zaznaczanie, wpisywanie, Enter / Tab / strzałki, kopiuj / wklej, cofnij Ctrl+Z). Wpisane dane są zapamiętywane i znikają dopiero po wysłaniu albo wyczyszczeniu. Kod może być pusty; wymagana jest ilość. ZMW: dopisz numer przed „/MM/RR”.'),
      body, dl,
      status, h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Wyczyścić tabelę?', 'Usunąć wszystkie wpisane dane z tabeli? Tego nie można cofnąć.', 'Usuń')) { draft = Z.emptyDraft(); saveDraft(draft); draw(); } } }, 'Wyczyść'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'), send)), { wide: true, onClose: () => dgrid.destroy() });
    m.root.style.maxWidth = '94vw'; m.root.style.width = '1000px';
    draw();
  }

  async function share() {
    const rows = Z.shown(st.rows, st.archive, st.view, st.filters, st.sorts);
    await window.zks.copyText(Z.shareText(st.view, rows));
    toast('Skopiowano tabelę do schowka');
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '8px';
  el.append(h('div', { class: 'row' },
    canWrite ? h('button', { class: 'btn primary', onclick: addDialog }, '+ Dodaj') : h('span', { class: 'muted' }, 'Uprawnienia: tylko odczyt'),
    h('button', { class: 'btn', onclick: async () => { st.archiveLoaded = false; st.codes = null; if (st.view === 'archive') await ensureArchive(); load(); } }, 'Odśwież'),
    h('button', { class: 'btn', onclick: () => { st.filters = {}; st.sorts = []; draw(); } }, 'Wyczyść filtry i sortowanie'),
    h('button', { class: 'btn', onclick: share }, 'Kopiuj tabelę'), info),
    notice, tabs, body, codeList);
  load();
  return () => grid.destroy();
}
