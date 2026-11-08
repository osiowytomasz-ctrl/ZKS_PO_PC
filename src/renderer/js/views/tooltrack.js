import { h, clear, api, apiCached, toast, confirmBox, alertBox } from '../ui.js';
import { toolCatalog } from '../catalog.js';
import * as T from '../logic/tooltrack.js';
import { parseSheetColor } from '../logic/common.js';

export function mountToolTrack(el, ctx) {
  const st = { all: [], listed: [], details: {}, byCode: new Map(), warnings: new Set(), filters: T.emptyFilters(), selected: [], locations: T.DEFAULT_LOCATIONS, saveLocation: '', saving: false };
  const status = h('div', { style: { minHeight: '20px', margin: '4px 0' } });
  const listBox = h('div', { class: 'table-wrap', style: { flex: 1, minHeight: 0 } });
  const selBox = h('div', {});
  const filtersBox = h('div', { class: 'row' });
  const setStatus = (text, kind = 'ok') => { status.textContent = text || ''; status.className = kind === 'error' ? 'err' : kind === 'neutral' ? 'muted' : ''; status.style.color = kind === 'ok' ? '#1b5e20' : ''; };

  async function load(force) {
    clear(listBox); listBox.append(h('div', { style: { padding: '12px' } }, 'Wczytywanie katalogu narzędzi…'));
    try {
      const cat = await toolCatalog(force);
      try { await apiCached('getStAllowedLocations', [], (l) => { if (l && l.length) st.locations = l.filter((x) => String(x).trim()); }); } catch (e) { /* domyślne */ }
      st.details = cat.detailsMap || {};
      st.all = (cat.tools || []).filter((t) => String(t.productCode || '').trim());
      st.byCode = new Map(st.all.map((t) => [T.normCode(t.productCode), t]));
      st.listed = st.all.filter(T.isListed);
      st.warnings = new Set(st.listed.filter((t) => T.hasPartWarning(t, st.details, st.byCode)).map((t) => t.productCode));
      drawFilters(); drawList(); drawSel();
    } catch (e) {
      clear(listBox); listBox.append(h('div', { class: 'err', style: { padding: '12px' } }, e.message, ' ', h('button', { class: 'btn small', onclick: () => load(true) }, 'Ponów')));
    }
  }

  const select = (field, label) => {
    const opts = T.filterOptions(st.listed, st.filters, field);
    const sel = h('select', { style: { padding: '4px' }, onchange: () => { st.filters = T.withFilter(st.filters, field, sel.value); drawFilters(); drawList(); } },
      h('option', { value: '' }, label), ...opts.map((o) => h('option', { value: o, selected: T.norm(st.filters[field]) === T.norm(o) }, o)));
    return sel;
  };
  function drawFilters() {
    clear(filtersBox);
    const mounting = T.dynamicIsMounting(st.filters.group);
    const code = h('input', { type: 'search', placeholder: 'Kod…', value: st.filters.code, style: { padding: '4px 8px', width: '160px' }, oninput: () => { st.filters = T.withFilter(st.filters, 'code', code.value); drawList(); } });
    filtersBox.append(select('location', 'Lokalizacja'), code, select('group', 'Grupa'), select('type', 'Rodzaj'), select('company', 'Firma'));
    if (mounting !== null) filtersBox.append(select('dynamic', mounting ? 'Mocowanie' : 'Średnica'));
    filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = T.emptyFilters(); drawFilters(); drawList(); } }, 'Wyczyść'));
  }

  function add(tool) {
    if (st.selected.some((t) => t.productCode === tool.productCode)) { setStatus('To narzędzie jest już na liście.', 'neutral'); return; }
    st.selected.push(tool); setStatus('Dodano narzędzie do listy.'); drawSel();
  }

  function drawList() {
    const shown = T.filterTools(st.listed, st.filters);
    const tbody = h('tbody', {});
    for (const t of shown.slice(0, 1500)) {
      const lc = T.locationColor(t.location);
      const wear = T.wearPercent(t.wear);
      const band = T.wearBand(wear);
      tbody.append(h('tr', { class: 'click', onclick: () => add(t) },
        h('td', { class: 'left', style: { borderLeft: '6px solid ' + (lc || 'transparent'), outline: st.warnings.has(t.productCode) ? '2px solid #d50000' : '', outlineOffset: '-2px', fontWeight: 600 } }, t.productCode),
        h('td', { class: 'left' }, T.description(t)), h('td', {}, [t.columnD, t.columnE].filter(Boolean).join('/')), h('td', {}, t.columnF), h('td', {}, T.rAlphaText(t)),
        h('td', {}, t.location), h('td', { style: { color: band === 'high' ? '#c62828' : band === 'medium' ? '#ef6c00' : '#2e7d32', fontWeight: 600 } }, Math.round(wear) + '%')));
    }
    clear(listBox);
    listBox.append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...['Kod', 'Opis', 'Rodzaj', 'Ø', 'R/α', 'Lokalizacja', 'Zużycie'].map((x) => h('th', {}, x)))), tbody),
      shown.length > 1500 ? h('div', { class: 'muted', style: { padding: '6px' } }, `Pokazano 1500 z ${shown.length}. Zawęź filtry.`) : null,
      !shown.length ? h('div', { class: 'muted', style: { padding: '10px' } }, 'Brak narzędzi dla wybranych filtrów.') : null);
  }

  function drawSel() {
    clear(selBox);
    const locSel = h('select', { style: { padding: '5px' }, onchange: () => { st.saveLocation = locSel.value; } },
      h('option', { value: '' }, 'Wybierz lokalizację…'), ...st.locations.map((l) => h('option', { value: l, selected: st.saveLocation === l }, l)));
    const items = st.selected.map((t) => h('div', { class: 'row', style: { background: '#fff', border: '1px solid #ccc', borderRadius: '4px', padding: '2px 8px', margin: '2px 0' } },
      h('b', {}, t.productCode), h('span', { class: 'muted grow' }, T.description(t)), h('button', { class: 'btn small', onclick: () => { st.selected = st.selected.filter((x) => x !== t); drawSel(); } }, '✕')));
    selBox.append(h('div', { class: 'panel' },
      h('div', { class: 'row' }, h('b', {}, `Wybrane narzędzia: ${st.selected.length}`), h('span', { class: 'grow' }), locSel,
        h('button', { class: 'btn', onclick: () => { st.selected = []; drawSel(); } }, 'Wyczyść'),
        h('button', { class: 'btn primary', disabled: st.saving, onclick: save }, 'ZAPISZ WYBRANE')),
      h('div', { style: { maxHeight: '140px', overflow: 'auto', marginTop: '4px' } }, ...items)));
  }

  async function save() {
    if (st.saving) return;
    if (!st.saveLocation) { setStatus('Najpierw wybierz lokalizację.', 'error'); return; }
    if (!st.selected.length) { setStatus('Nie wybrano żadnych narzędzi.', 'error'); return; }
    if (!(await confirmBox('Zapisać narzędzia?', `Lokalizacja: ${st.saveLocation}\nNarzędzia (${st.selected.length}):\n` + st.selected.map((t) => t.productCode).join(', '), 'Zapisz'))) { setStatus('Anulowano zapis.', 'neutral'); return; }
    st.saving = true; setStatus('Zapisywanie wybranych narzędzi…'); drawSel();
    try {
      // Pole „kto” serwer ustawia z klucza, więc go nie wysyłamy.
      const r = await api('saveStSelectedToolsToN', [st.selected.map((t) => ({ code: t.productCode, location: st.saveLocation }))]);
      st.selected = []; setStatus('');
      await alertBox('ToolTrack', (r && r.message) || 'Zapisano wybrane narzędzia.');
    } catch (e) {
      setStatus('');
      await alertBox('ToolTrack', 'Błąd zapisu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz, zanim spróbujesz ponownie.' : ''));
    }
    st.saving = false; drawSel();
  }

  // Skaner USB: wpisanie kodu + Enter dodaje narzędzie do listy.
  const scan = h('input', { type: 'text', placeholder: 'Zeskanuj lub wpisz kod i Enter', style: { padding: '4px 8px', width: '260px' },
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const code = scan.value; scan.value = '';
      const t = T.findByCode(st.all, code);
      if (!st.all.length) setStatus('Lista narzędzi nie jest jeszcze wczytana.', 'error');
      else if (!t) setStatus(`Nie znaleziono narzędzia: ${code.trim()}`, 'error');
      else if (T.isBlockedLocation(t.location)) setStatus(`Narzędzie ${t.productCode} ma zablokowaną lokalizację.`, 'error');
      else add(t);
    } });

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, scan, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), filtersBox, status, listBox, selBox);
  load(false); scan.focus();
}
