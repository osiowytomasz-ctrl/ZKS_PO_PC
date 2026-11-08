import { h, clear, api, apiCached, toast, modal, field, filterHeader, columnFilterDialog, confirmBox } from '../ui.js';
import * as Z from '../logic/zakupy.js';
import { updateSorts, sortLabels, formatDate } from '../logic/common.js';
import { resolveCode, parseQuantity } from '../logic/scanner.js';

export function mountZakupy(el, ctx) {
  const level = ctx.level('zakupy');
  const canWrite = level === 'write';
  const st = { rows: [], archive: [], exactRows: false, view: 'ordered', filters: {}, sorts: [], codes: null, archiveLoaded: false };
  const info = h('span', { class: 'muted' });
  const body = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0 } });
  const tabs = h('div', { class: 'tabs' });
  const notice = h('div', { class: 'muted' });

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
    try { await apiCached('getZakupyProductCodes', [], (l) => { st.codes = (l || []).filter((c) => String(c).trim()); }); } catch (e) { st.codes = []; }
  }

  function drawTabs() {
    clear(tabs);
    for (const [id, label] of Object.entries(Z.VIEWS)) {
      tabs.append(h('button', { class: st.view === id ? 'on' : '', onclick: async () => {
        st.view = id; st.filters = {}; st.sorts = [];
        if (id === 'archive') await ensureArchive();
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
    const tbody = h('tbody', {});
    for (const r of rows) {
      tbody.append(h('tr', { class: 'click', onclick: () => openRow(r) },
        ...cols.map((c) => h('td', { class: c.key === 'opis' || c.key === 'kod' ? 'left' : '' }, Z.display(c.key, Z.value(r, c.key))))));
    }
    clear(body);
    body.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, thead), tbody));
    info.textContent = (st.fresh ? '' : 'Dane z pamięci, odświeżanie… (zapis po odświeżeniu)  ·  ') + `Pozycji: ${rows.length}` + (rows.length !== src.length ? ` z ${src.length}` : '') + (st.sorts.length ? '  ·  Sortowanie: ' + Z.sortSummary(st.view, st.sorts) : '');
  }

  function openRow(row) {
    const editable = canWrite && st.exactRows && st.fresh && st.view === 'ordered' && !Z.isBought(row);
    if (editable) { ensureCodes().then(() => realizeDialog(row)); return; }
    const ro = (label, v) => h('div', { class: 'row', style: { margin: '3px 0' } }, h('b', { style: { width: '150px' } }, label), h('span', {}, v || '—'));
    const m = modal(st.view === 'archive' ? 'Archiwum: szczegóły' : Z.isBought(row) ? 'Zakupione: szczegóły' : 'Zamówione: szczegóły', h('div', {},
      ro('Data zamówienia', formatDate(row.columnH)), ro('Ilość zamówiona', row.columnI), ro('Kod produktu', row.columnC), ro('Ilość', row.columnD),
      ro('Data zakupu', formatDate(row.columnB)), ro('Cena jednostkowa', row.columnF), ro('PZ', row.columnE), ro('ZMW', row.columnG),
      ro('Opis produktu', row.columnK), ro('Uwagi', row.columnL),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))));
  }

  function codeField(initial) {
    const listId = 'codes' + Math.random().toString(36).slice(2);
    const input = h('input', { type: 'text', value: initial, list: listId, autocomplete: 'off' });
    const dl = h('datalist', { id: listId }, ...(st.codes || []).slice(0, 3000).map((c) => h('option', { value: c })));
    return { input, node: h('div', {}, field('Kod produktu', input), dl) };
  }

  function realizeDialog(row) {
    const kod = codeField(row.columnC);
    const f = (label, v, multi) => ({ label, input: multi ? h('textarea', { rows: 2 }, v) : h('input', { type: 'text', value: v }) });
    const ilosc = f('Ilość zakupiona', row.columnD);
    const zakup = f('Data zakupu', row.columnB);
    const cena = f('Cena jednostkowa', row.columnF);
    const pz = f('PZ', row.columnE);
    const zmw = f('ZMW', row.columnG);
    const opis = f('Opis produktu', row.columnK, true);
    const uwagi = f('Uwagi', row.columnL, true);
    const today = h('button', { class: 'btn small', onclick: () => { const d = new Date(); zakup.input.value = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; } }, 'Dziś');
    const err = h('div', { class: 'err' });
    let m;
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      if (!kod.input.value.trim()) { err.textContent = 'Uzupełnij kod produktu.'; return; }
      const text = `Kod: ${kod.input.value.trim()}` + (pz.input.value.trim() ? `\nPZ: ${pz.input.value.trim()}` : '') + (ilosc.input.value.trim() ? `\nIlość zakupiona: ${ilosc.input.value.trim()}` : '');
      if (!(await confirmBox('Potwierdzić zapis?', text, 'Zapisz'))) return;
      saveBtn.disabled = true;
      try {
        const v = (x) => x.input.value.trim();
        const r = await api('updateZakupyItem', [{
          rowNumber: row.rowNumber, expectKod: row.columnC, zakup: v(zakup), kod: kod.input.value.trim(),
          ilosc: v(ilosc), iloscKupiona: v(ilosc), pz: v(pz), cena: v(cena), zmw: v(zmw), opis: v(opis), uwagi: v(uwagi),
        }]);
        if (r && r.success === false) throw new Error(r.message || 'Serwer odrzucił zapis.');
        m.close(); toast((r && r.message) || 'Zapisano realizację zakupu.'); load();
      } catch (e) {
        saveBtn.disabled = false;
        err.textContent = 'Błąd zapisu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : '');
      }
    } }, 'Zapisz jako zakupione');
    m = modal('Zamówione: realizacja zakupu', h('div', {},
      h('div', { class: 'muted' }, `Data zamówienia: ${formatDate(row.columnH)} · Ilość zamówiona: ${row.columnI || '—'}`),
      kod.node, field(ilosc.label, ilosc.input), h('div', { class: 'row', style: { alignItems: 'flex-end' } }, h('div', { class: 'grow' }, field(zakup.label, zakup.input)), today),
      field(cena.label, cena.input), field(pz.label, pz.input), field(zmw.label, zmw.input), field(opis.label, opis.input), field(uwagi.label, uwagi.input),
      h('div', { class: 'muted' }, 'Zapis oznacza pozycję jako zakupioną (znak x w kolumnie J). Puste pola zostaną zapisane jako puste.'),
      err, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), saveBtn)), { wide: true });
  }

  async function addDialog() {
    await ensureCodes();
    const kod = codeField('');
    const ilosc = h('input', { type: 'text', inputmode: 'decimal' });
    const zmw = h('input', { type: 'text' });
    const opis = h('textarea', { rows: 2 });
    const uwagi = h('textarea', { rows: 2 });
    const err = h('div', { class: 'err' });
    let m;
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      const q = parseQuantity(ilosc.value);
      if (!kod.input.value.trim() || !ilosc.value.trim()) { err.textContent = 'Uzupełnij kod produktu i ilość.'; return; }
      if (!q) { err.textContent = 'Nieprawidłowa ilość.'; return; }
      saveBtn.disabled = true;
      try {
        const r = await api('addZakupyItem', [{ kod: kod.input.value.trim(), ilosc: q, zmw: zmw.value.trim(), opis: opis.value.trim(), uwagi: uwagi.value.trim() }]);
        if (r && r.success === false) throw new Error(r.message || 'Serwer odrzucił zapis.');
        m.close(); toast((r && r.message) || 'Dodano pozycję zakupu.'); load();
      } catch (e) {
        saveBtn.disabled = false;
        err.textContent = 'Błąd dodawania zakupu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież listę i sprawdź, zanim spróbujesz ponownie.' : '');
      }
    } }, 'Zapisz');
    m = modal('Dodaj zakup', h('div', {}, kod.node,
      h('div', { class: 'muted', id: 'codewarn' }),
      field('Ilość', ilosc), field('ZMW', zmw), field('Opis rzeczowy produktu', opis), field('Uwagi', uwagi), err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), saveBtn)), { wide: true });
    const warn = m.root.querySelector('#codewarn');
    kod.input.addEventListener('input', () => {
      warn.textContent = st.codes.length && kod.input.value.trim() && !resolveCode(kod.input.value, st.codes) ? 'Tego kodu nie ma na liście produktów. Można go dodać, ale sprawdź pisownię.' : '';
    });
    kod.input.focus();
  }

  async function share() {
    const rows = Z.shown(st.rows, st.archive, st.view, st.filters, st.sorts);
    await window.zks.copyText(Z.shareText(st.view, rows));
    toast('Skopiowano tabelę do schowka');
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '8px';
  el.append(h('div', { class: 'row' },
    canWrite ? h('button', { class: 'btn primary', onclick: addDialog }, '+ Dodaj zakup') : h('span', { class: 'muted' }, 'Uprawnienia: tylko odczyt'),
    h('button', { class: 'btn', onclick: async () => { st.archiveLoaded = false; st.codes = null; if (st.view === 'archive') await ensureArchive(); load(); } }, 'Odśwież'),
    h('button', { class: 'btn', onclick: () => { st.filters = {}; st.sorts = []; draw(); } }, 'Wyczyść filtry i sortowanie'),
    h('button', { class: 'btn', onclick: share }, 'Kopiuj tabelę'), info),
    notice, tabs, body);
  load();
}
