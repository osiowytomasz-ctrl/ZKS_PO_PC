import { h, clear, api, toast, modal, field, alertBox } from '../ui.js';
import { toolCatalog } from '../catalog.js';
import * as B from '../logic/builder.js';

const LABELS = { code: 'Kod', location: 'Lokalizacja', group: 'Grupa', type: 'Rodzaj', company: 'Firma', diameter: 'Ø', length: 'Długość', rAlpha: 'r/α' };

export function mountBuilder(el, ctx) {
  const st = { all: [], listed: [], filters: B.emptyFilters(), selected: [] };
  const status = h('div', { class: 'muted', style: { minHeight: '18px' } });
  const filtersBox = h('div', { class: 'row' });
  const listBox = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0 } });
  const selBox = h('div', { class: 'panel' });

  async function load(force) {
    clear(listBox); listBox.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie katalogu narzędzi…'));
    try {
      const cat = await toolCatalog(force);
      st.all = (cat.tools || []).filter((t) => String(t.productCode ?? '').trim());
      st.listed = st.all.filter(B.isListed); st.selected = []; draw();
    } catch (e) { clear(listBox); listBox.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: () => load(true) }, 'Ponów'))); }
  }

  function draw() {
    const enabled = !st.selected.length;
    clear(filtersBox);
    if (enabled) {
      for (const f of B.FIELDS) {
        if (f === 'code') { const i = h('input', { type: 'search', placeholder: 'Kod…', value: st.filters.code, style: { padding: '4px 8px', width: '130px' }, oninput: () => { st.filters.code = i.value; drawList(); } }); filtersBox.append(i); continue; }
        const sel = h('select', { style: { padding: '4px' }, onchange: () => { st.filters[f] = sel.value; draw(); } }, h('option', { value: '' }, LABELS[f]), ...B.options(st.listed, st.filters, f).map((o) => h('option', { value: o, selected: String(st.filters[f]).toLowerCase() === o.toLowerCase() }, o)));
        filtersBox.append(sel);
      }
      filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = B.emptyFilters(); draw(); } }, 'Wyczyść'));
    } else filtersBox.append(h('span', { class: 'muted' }, 'Filtry są wyłączone, dopóki zestaw nie jest pusty. Lista pokazuje narzędzia pasujące do ostatniego mocowania.'));
    drawList(); drawSel();
  }

  function drawList() {
    const shown = B.sorted(st.selected.length ? B.nextCandidates(st.all, st.selected) : B.filterTools(st.listed, st.filters));
    const tbody = h('tbody', {});
    for (const t of shown.slice(0, 1500)) tbody.append(h('tr', { class: 'click', onclick: () => select(t) },
      h('td', { class: 'left', style: { fontWeight: 600 } }, t.productCode), h('td', { class: 'left' }, B.description(t)), h('td', {}, [t.columnD, t.columnE].filter(Boolean).join('/')),
      h('td', {}, t.columnF), h('td', {}, t.columnJ), h('td', {}, B.rAlphaText(t) ?? ''), h('td', {}, t.columnM), h('td', {}, t.columnN), h('td', {}, t.location)));
    clear(listBox);
    listBox.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...['Kod', 'Opis', 'Rodzaj', 'Ø', 'L', 'r/α', 'Ms', 'Mk', 'Lokalizacja'].map((x) => h('th', {}, x)))), tbody),
      !shown.length ? h('div', { class: 'muted', style: { padding: '10px' } }, st.selected.length ? 'Brak dalszych powiązanych narzędzi.' : 'Brak narzędzi dla wybranych filtrów.') : null);
  }

  function select(t) {
    if (st.selected.some((x) => x.productCode === t.productCode)) return;
    st.selected.push(t);
    status.textContent = !String(t.columnM ?? '').trim() ? 'Brak danych w kolumnie M dla wybranego narzędzia.' : '';
    draw();
  }

  function drawSel() {
    clear(selBox);
    selBox.append(h('div', { class: 'row' }, h('b', {}, `Zestaw: ${st.selected.length} · długość ${B.totalLength(st.selected)} mm`), h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => { if (!st.selected.length) { status.textContent = 'Brak narzędzi do usunięcia.'; return; } st.selected.pop(); status.textContent = 'Usunięto ostatnie narzędzie z zestawu.'; draw(); } }, 'Usuń ostatnie'),
      h('button', { class: 'btn', onclick: () => { st.selected = []; status.textContent = ''; draw(); } }, 'Nowe narzędzie'),
      h('button', { class: 'btn primary', onclick: openSave }, 'Zapisz do BN')),
      h('div', { style: { marginTop: '4px' } }, ...st.selected.map((t, i) => h('div', {}, `${i + 1}. `, h('b', {}, t.productCode), ' ', h('span', { class: 'muted' }, B.description(t))))));
  }

  function openSave() {
    if (!st.selected.length) { status.textContent = 'Najpierw wybierz narzędzie!'; status.className = 'err'; return; }
    status.className = 'muted';
    const komis = h('input', { type: 'text' }), ktk = h('input', { type: 'text' }), op = h('input', { type: 'text' });
    const err = h('div', { class: 'err' });
    let m; const save = h('button', { class: 'btn primary', onclick: async () => {
      const codes = B.codesText(st.selected), sel = B.selectionPath(st.selected), len = String(B.totalLength(st.selected));
      if (!codes.trim() || !sel.trim() || !len.trim()) { err.textContent = 'Wszystkie pola nieedytowalne muszą być wypełnione!'; return; }
      save.disabled = true;
      try {
        await api('saveToolDataToBN', [{ toolCodes: codes, selections: sel, toolLength: len, toolKomis: komis.value.trim(), toolKtk: ktk.value.trim(), toolOperation: op.value.trim() }]);
        m.close(); await alertBox('ToolBuilder', 'Narzędzie zapisane!');
      } catch (e) { save.disabled = false; err.textContent = 'Błąd podczas zapisywania danych: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz BN, zanim spróbujesz ponownie.' : ''); }
    } }, 'Zapisz');
    m = modal('Zapis do BN', h('div', {}, h('div', { class: 'muted' }, `Kody: ${B.codesText(st.selected)}\nŚcieżka: ${B.selectionPath(st.selected)}\nDługość: ${B.totalLength(st.selected)} mm`.replace(/\n/g, ' · ')),
      field('Komis', komis), field('KTK', ktk), field('Operacja', op), err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), save)));
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('span', { class: 'grow muted' }, 'Wybierz narzędzie tnące, potem kolejne pasujące mocowaniem (Mk = Ms).'), h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), filtersBox, status, listBox, selBox);
  load(false);
}
