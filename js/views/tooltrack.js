// ToolTrack – jak w aplikacji na Androida (ToolTrackScreen.kt): wybór narzędzi z listy (filtry kaskadowe) albo skanerem (USB / wpisanie
// kodu), lokalizacja „Zapis do”, potwierdzenie i zapis wielu narzędzi naraz do arkusza N. Zestaw z ToolBuildera („→ ToolTrack”) trafia
// na listę wybranych.
import { h, clear, api, apiCached, alertBox, modal, toast, confirmBox } from '../ui.js';
import { toolCatalog, confirmedContoursQuick } from '../catalog.js';
import * as G from '../logic/toolGeometry.js';
import * as T from '../logic/tooltrack.js';
import { toolRow, toolTile, miniSvg, lazyFill, filterDropdown, statusLine } from './toolViews.js';
import { viewMemory } from '../logic/viewMemory.js';
import { tt } from '../logic/ttSession.js';
import { mirrorLocations, loadN, importN, nWho, dbLocations } from '../nStore.js';
import { getMode } from '../migrationStore.js';
import { compareN } from '../logic/nDb.js';
import { openMigrationDialog } from './migrationDialog.js';
import { moduleLevelOf } from '../logic/moduleLevels.js';

let pendingSelection = null;
/** Zestaw z ToolBuildera: zastępuje listę wybranych przy najbliższym otwarciu ToolTrack. */
export function setToolTrackSelection(tools) { pendingSelection = (tools || []).filter((t) => String(t.productCode ?? '').trim()); }

export function mountToolTrack(el, ctx) {
  const st = { all: [], listed: [], details: {}, byCode: new Map(), warnings: new Set(), filters: T.emptyFilters(), locations: T.DEFAULT_LOCATIONS, saving: false, index: null, view: 'list', stopFill: null };
  try { st.view = localStorage.getItem('zks.tooltrack.view') === 'tiles' ? 'tiles' : 'list'; } catch { /* domyślnie lista */ }
  // lista wybranych narzędzi i lokalizacja zapisu są wspólne ze Skanerem (moduł Skaner → Narzędzia)
  Object.defineProperty(st, 'selected', { get: () => tt.selected, set: (v) => { tt.selected = v; } });
  Object.defineProperty(st, 'saveLocation', { get: () => tt.location, set: (v) => { tt.location = v; } });
  const status = statusLine();
  const filtersBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
  const list = h('div', { class: 'tool-list' });
  // widok: lista albo kafelki (jak w ToolBuilderze – 5 w wierszu przy 1920 px, miniatura narzędzia, dorysowywanie przy przewijaniu)
  const viewBtn = h('button', { class: 'btn', title: 'Zmiana widoku: lista / kafelki', onclick: () => { st.view = st.view === 'tiles' ? 'list' : 'tiles'; try { localStorage.setItem('zks.tooltrack.view', st.view); } catch { /* bez pamięci */ } paintView(); drawList(); } });
  const paintView = () => { viewBtn.textContent = st.view === 'tiles' ? '☰ Lista' : '▦ Kafelki'; list.className = st.view === 'tiles' ? 'tool-grid' : 'tool-list'; };
  paintView();
  const bottom = h('div', { class: 'row' });

  if (pendingSelection) { st.selected = pendingSelection; pendingSelection = null; status.set(`Przekazano narzędzia z ToolBuildera: ${st.selected.length}`); }

  async function load(force) {
    clear(list).append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie narzędzi…'));
    try {
      const cat = await toolCatalog(force);
      try { const dl = await dbLocations(); if (dl) st.locations = dl; else await apiCached('getStAllowedLocations', [], (l) => { if (l && l.length) st.locations = l.filter((x) => String(x).trim()); }); } catch { /* domyślne */ }
      st.details = cat.detailsMap || {};
      st.all = (cat.tools || []).filter((t) => String(t.productCode || '').trim());
      st.byCode = new Map(st.all.map((t) => [T.normCode(t.productCode), t]));
      st.listed = st.all.filter(T.isListed);
      st.warnings = new Set(st.listed.filter((t) => T.hasPartWarning(t, st.details, st.byCode)).map((t) => t.productCode));
      try { st.index = G.toolIndex(cat, await confirmedContoursQuick()); } catch { st.index = null; }   // kontury do miniatur kafelków
      if (!st.locations.includes(st.saveLocation)) st.saveLocation = '';
      draw();
    } catch (e) {
      clear(list).append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano narzędzi: ' + e.message, ' ', h('button', { class: 'btn small', onclick: () => load(true) }, 'Ponów')));
    }
  }

  const mem = viewMemory('tooltrack', st, ['simpleFilters']);   // filtry zapamiętane na tym komputerze
  mem.load();
  function draw() { mem.save(); drawFilters(); drawList(); }
  function drawFilters() {
    clear(filtersBox);
    const mounting = T.dynamicIsMounting(st.filters.group);
    const code = h('input', { type: 'search', placeholder: 'Kod', value: st.filters.code, style: { width: '110px', padding: '4px 8px' }, oninput: () => { st.filters = T.withFilter(st.filters, 'code', code.value); drawList(); } });
    const dd = (field, label) => filterDropdown(label, st.filters[field], T.filterOptions(st.listed, st.filters, field), (v) => { st.filters = T.withFilter(st.filters, field, v); drawFilters(); drawList(); });
    filtersBox.append(code, dd('location', 'Lokal'), dd('group', 'Grupa'), dd('type', 'Rodzaj'), dd('company', 'Firma'));
    if (mounting !== null) filtersBox.append(dd('dynamic', mounting ? 'Mocowanie' : 'Φ'));
    if (Object.values(st.filters).some((v) => String(v).trim())) filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = T.emptyFilters(); drawFilters(); drawList(); } }, 'Wyczyść'));
  }

  const mini = (t) => miniSvg(st.index && G.buildMini(t, st.index.details(t.productCode), (c) => st.index.insertContour(c)), { w: 90, hgt: 110 });
  /** Narzędzie jako wiersz (kliknięcie) albo kafelek (przycisk „+ Dodaj do listy” / „Usuń z listy” zamiast kliknięcia). */
  const row = (t, onclick, kind) => {
    if (st.view !== 'tiles') return toolRow(t, { warning: st.warnings.has(t.productCode), onclick });
    const act = h('button', { class: 'btn small ' + (kind === 'remove' ? 'danger' : 'primary'), title: kind === 'remove' ? 'Usuń z listy wybranych' : 'Dodaj do listy wybranych', onclick: (e) => { e.stopPropagation(); onclick(); } }, kind === 'remove' ? 'Usuń z listy' : '+ Dodaj do listy');
    return toolTile(t, { warning: st.warnings.has(t.productCode), mini: mini(t), footer: h('div', { class: 'tile-act' }, act) });
  };
  function drawList() {
    mem.save();
    const items = T.filterTools(st.listed, st.filters);
    if (st.stopFill) st.stopFill();
    clear(list);
    if (st.selected.length) {
      list.append(h('div', { class: 'tool-title' }, `Wybrane (${st.selected.length}) — ${st.view === 'tiles' ? 'przycisk „Usuń z listy” na kafelku' : 'kliknij, aby usunąć'}`),
        ...st.selected.map((t) => row(t, () => { st.selected = st.selected.filter((x) => x.productCode !== t.productCode); drawList(); }, 'remove')),
        h('hr', { style: { width: '100%', border: 0, borderTop: '1px solid #ccc', margin: '4px 0' } }));
    }
    list.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Narzędzia: ' + items.length));
    if (!items.length && st.all.length) list.append(h('div', {}, 'Brak narzędzi spełniających kryteria.'));
    // wszystkie narzędzia dorysowywane porcjami przy przewijaniu (miniatury są kosztowne)
    st.stopFill = lazyFill(list, items, (t) => row(t, () => add(t), 'add'));
    drawBottom();
  }
  function drawBottom() {
    clear(bottom);
    if (!st.selected.length) return;
    bottom.append(h('button', { class: 'btn primary', style: { flex: 1 }, disabled: st.saving, onclick: requestSave }, st.saving ? 'Zapisywanie…' : 'ZAPISZ WYBRANE'),
      h('button', { class: 'btn', style: { flex: 1 }, disabled: st.saving, onclick: () => { st.selected = []; drawList(); } }, 'WYCZYŚĆ'));
  }

  function add(t) {
    if (st.selected.some((x) => x.productCode === t.productCode)) { status.set('To narzędzie jest już na liście.', 'neutral'); return; }
    st.selected.push(t); status.set('Dodano narzędzie do listy.'); drawList();
  }

  /** Lokalizacja zapisu jest wybierana w module Skaner (Narzędzia); tu – tylko gdy jej jeszcze nie wybrano. */
  function pickLocation(then) {
    const sel = h('select', { style: { padding: '6px', width: '100%' } }, h('option', { value: '' }, '— wybierz lokalizację —'), ...st.locations.map((l) => h('option', { value: l }, l)));
    const m = modal('Lokalizacja zapisu', h('div', {}, h('p', { class: 'muted' }, 'Lokalizację zapisu można też wybrać w module Skaner → Narzędzia.'), sel,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
        h('button', { class: 'btn primary', onclick: () => { if (!sel.value) return; st.saveLocation = sel.value; m.close(); then(); } }, 'Dalej'))));
  }
  function requestSave() {
    if (st.saving) return;
    if (!st.selected.length) { status.set('Nie wybrano żadnych narzędzi.', 'error'); return; }
    if (!st.saveLocation) { pickLocation(requestSave); return; }
    const m = modal('Czy zapisać wybrane narzędzia?', h('div', {}, h('div', {}, `Ilość: ${st.selected.length}`), h('div', {}, `Lokalizacja: ${st.saveLocation}`), h('hr', {}),
      ...st.selected.map((t) => h('div', { style: { fontSize: '12px' } }, `${t.productCode} — ${T.description(t)}`)),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { m.close(); status.set('Anulowano zapis.', 'neutral'); } }, 'ANULUJ'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); save(); } }, 'ZAPISZ'))));
  }
  async function save() {
    st.saving = true; status.set('Zapisywanie wybranych narzędzi…'); drawBottom();
    try {
      // Pole „kto” serwer ustawia z klucza, więc go nie wysyłamy.
      const items = st.selected.map((t) => ({ code: t.productCode, location: st.saveLocation }));
      const r = (await getMode('n')) === 'db' ? { message: 'Zapisano wybrane narzędzia w bazie.' } : await api('saveStSelectedToolsToN', [items]);   // tryb „tylko baza”: bez arkusza
      try { await mirrorLocations(items, nWho(ctx.user)); } catch (e2) { toast('Zapisano w arkuszu, ale nie w bazie Firebase (N): ' + (e2.message || e2), true); }
      st.selected = []; status.set('');
      await alertBox('ToolTrack', (r && r.message) || 'Zapisano wybrane narzędzia.');
    } catch (e) {
      status.set('');
      await alertBox('ToolTrack', 'Błąd zapisu: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz, zanim spróbujesz ponownie.' : ''));
    }
    st.saving = false; drawList();
  }

  const userName = () => (ctx.user && (ctx.user.name || ctx.user.email)) || '';
  /** Przejście karty N (dziennik lokalizacji) z arkusza do bazy – okno wspólne z innymi kartami, tylko GOD. */
  const migBtn = h('button', { class: 'btn small', style: { display: moduleLevelOf(ctx.user, 'narzedziownia') === 'god' ? '' : 'none' }, title: 'Dziennik lokalizacji (karta N): tryb, import, porównanie (tylko GOD)', onclick: () => openMigrationDialog({
    title: 'Migracja karty N (lokalizacje): arkusz → baza', domain: 'n', exportKey: 'N', user: userName(),
    dbWarning: 'Zapis lokalizacji (ToolTrack i Skaner → Narzędzia) trafi tylko do bazy; statusy (kol. Q w PSWT) liczą się z bazy.',
    intro: 'Kolejność: 1) Importuj, 2) Porównaj (musi być „Zgodne”), 3) tryb „Równolegle”: zapis lokalizacji idzie do arkusza i do bazy, a status (kol. Q) w PSWT liczy się z bazy. Wpisy z trybu równoległego nie mają numeru wiersza arkusza, więc porównanie zestawia je po czasie.',
    importFn: async () => {
      const d = await api('baseSheet', ['N'], { timeoutMs: 300000 }), vals = d.values || [];
      if (!(await confirmBox('Import karty N do bazy', `Zastąpić dziennik lokalizacji w bazie kartą N z arkusza (${Math.max(0, vals.length - 1)} wierszy)? Wpisy dodane w bazie po ostatnim imporcie przepadną.`, 'Importuj'))) return 'Anulowano.';
      return `Zaimportowano wpisów: ${await importN(vals, userName())}.`;
    },
    compareFn: async () => { const d = await api('baseSheet', ['N'], { timeoutMs: 300000 }); return compareN(d.values || [], await loadN()); } }) }, '⇄ Migracja N');
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  // jedna linia: filtry po lewej, przyciski widoku (lista / kafelki) i odświeżania po prawej; skaner narzędzi i wybór lokalizacji są w module Skaner
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap', alignItems: 'center', gap: '6px' } }, filtersBox, h('span', { class: 'grow' }), migBtn, viewBtn, h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')),
    status, list, bottom);
  load(false);
  // po powrocie do modułu trzymanego w tle: zestaw przekazany z ToolBuildera zastępuje listę wybranych
  return Object.assign(() => {}, { onShow: () => { if (pendingSelection) { st.selected = pendingSelection; pendingSelection = null; status.set(`Przekazano narzędzia z ToolBuildera: ${st.selected.length}`); drawList(); } } });
}
