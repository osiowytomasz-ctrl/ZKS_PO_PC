// Narzędziownia → Zużycie: rejestry zużycia ZP (płytki skrawające – zapisuje je też Skaner przy pobraniu części) i ZwG (wiertła, gwintowniki, trepany).
// Źródło danych zależy od trybu przejścia z arkusza do bazy (migrationStore: sheet / dual / db): „arkusz” – odczyt karty z arkusza, „równolegle” i „tylko baza” – baza Firebase,
// bez kolumn liczonych arkusza (stan, rodzaj, koszt – niepotrzebne). Przejście: tylko GOD, okno „⇄ Migracja” (import, porównanie, tryb).
import { h, clear, api, toast, modal, confirmBox } from '../ui.js';
import { pswtSnapshot } from '../pswtSnap.js';
import { getMode, MODES } from '../migrationStore.js';
import { loadReg, appendReg, importReg, deleteReg } from '../regStore.js';
import { REGISTERS, entriesFromSheet, displayRows, compareRegister, makeRegEntry, makeManualEntry } from '../logic/regDb.js';
import { sheetTable } from './sheetTable.js';
import { openMigrationDialog } from './migrationDialog.js';
import { moduleLevelOf, atLeast } from '../logic/moduleLevels.js';

export function mountZuzycie(el, ctx) {
  const st = { key: 'zp', modes: {}, loading: false };
  const userName = () => (ctx.user && (ctx.user.name || ctx.user.email)) || '';
  const isGod = () => moduleLevelOf(ctx.user, 'narzedziownia') === 'god';
  const canAdd = () => atLeast(ctx.user, 'narzedziownia', 'master');
  const status = h('span', { class: 'muted' });
  const tables = {};
  const holder = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  const tabs = h('div', { class: 'tabs' });
  const cfg = () => REGISTERS[st.key];
  const modeOf = () => st.modes[st.key] || 'sheet';

  // zaznaczony wiersz (kliknięcie) – do usunięcia przez GOD-a; tabela nie jest edytowalna
  const sel = { key: '', n: null };
  const isSel = (r) => r && r._n != null && sel.key === st.key && sel.n === r._n;
  const tableFor = (key) => (tables[key] = tables[key] || sheetTable({ storageKey: 'zuzycie_' + key, defaultVisible: 12,
    rowStyle: (r) => (isSel(r) ? { background: '#d3e3fd' } : null),
    onRow: (r) => { if (!isGod() || modeOf() === 'sheet' || r._n == null) return; if (isSel(r)) { sel.n = null; } else { sel.key = st.key; sel.n = r._n; sel.row = r; } paintTabs(); tableFor(st.key).redraw(); } }));
  const addBtn = h('button', { class: 'btn primary', style: { display: 'none' }, onclick: () => addDialog() }, '+ Dodaj wpis ZwG');
  // tylko GOD (tryby „równolegle” i „tylko baza”): ręczny wpis jak ze Skanera (z dopiskiem „wpis ręczny” przy nazwisku) i usunięcie zaznaczonego wpisu (bez śladu zmiany)
  const plusBtn = h('button', { class: 'btn small', style: { display: 'none' }, onclick: () => manualDialog() }, '＋ Wpis ręczny');
  const minusBtn = h('button', { class: 'btn small danger', style: { display: 'none' }, onclick: () => deleteSelected() }, '− Usuń zaznaczony wpis');
  const reloadBtn = h('button', { class: 'btn', onclick: () => load() }, 'Odśwież');
  const migBtn = h('button', { class: 'btn small', style: { display: 'none' }, title: 'Przejście rejestru z arkusza do bazy: tryb, import, porównanie (tylko GOD)', onclick: () => migration() }, '⇄ Migracja');

  function paintTabs() {
    clear(tabs);
    for (const k of Object.keys(REGISTERS)) tabs.append(h('button', { class: st.key === k ? 'on' : '', onclick: () => { st.key = k; paintTabs(); show(); load(); } }, REGISTERS[k].name));
    addBtn.style.display = st.key === 'zwg' && modeOf() !== 'sheet' && canAdd() ? '' : 'none';
    migBtn.style.display = isGod() ? '' : 'none';
    for (const b of [plusBtn, minusBtn]) b.style.display = isGod() ? '' : 'none';
    const sheet = modeOf() === 'sheet', picked = sel.key === st.key && sel.n != null;
    plusBtn.disabled = sheet; minusBtn.disabled = sheet || !picked;
    plusBtn.title = sheet ? 'Dostępne w trybie „równolegle” albo „tylko baza” (Migracja)' : 'Dopisz wpis jak ze Skanera, z dopiskiem „wpis ręczny” przy nazwisku (tylko GOD)';
    minusBtn.title = sheet ? 'Dostępne w trybie „równolegle” albo „tylko baza” (Migracja)' : picked ? 'Usuń zaznaczony wpis z bazy – bez śladu zmiany (tylko GOD)' : 'Najpierw kliknij wiersz, który ma zostać usunięty';
  }
  function show() { clear(holder).append(tableFor(st.key).el); }

  /** Kolumny tabeli: tytuły z cfg.heads, klucz = numer kolumny. */
  const colsOf = (c) => c.heads.map((t, i) => ({ key: String(i), idx: i, title: t }));

  async function load() {
    if (st.loading) return; st.loading = true; reloadBtn.disabled = true;
    const c = cfg(), t = tableFor(st.key);
    try {
      st.modes[st.key] = await getMode(c.key, true); paintTabs();
      let rows = [];
      if (modeOf() === 'sheet') {
        status.textContent = `Czytanie karty ${c.short} z arkusza…`;
        const d = await api('baseSheet', [c.short], { timeoutMs: 300000 });
        rows = (d.values || []).slice(c.dataStart - 1).filter((r) => String(r[c.cols.code] ?? '').trim()).map((r) => c.heads.map((_, i) => String(r[i] ?? '')));
        status.textContent = `Karta ${c.short} z arkusza (${MODES.sheet}) · wpisów: ${rows.length}`;
      } else {
        status.textContent = `Wczytywanie ${c.short} z bazy…`;
        const entries = await loadReg(c.key);
        rows = displayRows(c, entries, { extraWho: true });
        status.textContent = `${c.short} z bazy Firebase (${MODES[modeOf()]}) · wpisów: ${entries.length}`;
      }
      sel.n = null;
      const cols = colsOf(c); if (modeOf() !== 'sheet' && c.cols.who == null) cols.push({ key: String(cols.length), idx: cols.length, title: 'Dodał (baza)' });
      t.setData(cols, rows.reverse(), (r, col) => String(r[col.idx] ?? ''), { defaultVisible: cols.length });   // najnowsze na górze
      paintTabs();
    } catch (e) { status.textContent = 'Błąd: ' + (e.code === 'permission-denied' ? 'brak uprawnień (opublikuj reguły Firestore: reg_zp, reg_zwg)' : /Nieznana karta|UNKNOWN_FN/i.test(e.message || '') ? 'w Apps Script brak karty w Baza.gs – wgraj nowy Baza.gs i wdróż API.' : e.message || e); }
    st.loading = false; reloadBtn.disabled = false;
  }

  function migration() {
    const c = cfg();
    openMigrationDialog({ title: `Migracja rejestru ${c.short}: arkusz → baza`, domain: c.key, exportKey: c.key.toUpperCase(), user: userName(),
      dbWarning: c.key === 'zp' ? 'Pobranie części w Skanerze (PC) zapisze się tylko w bazie, a dostępną ilość program liczy z bazy (PSWT, Zakupy, ZP, ZwG, ZN).' : 'Wpisy ZwG zapisują się tylko w bazie.',
      importFn: async () => {
        const d = await api('baseSheet', [c.short], { timeoutMs: 300000 }), entries = entriesFromSheet(c, d.values || []);
        if (!(await confirmBox(`Import ${c.short} do bazy`, `Zastąpić wpisy ${c.short} w bazie wpisami z arkusza (${entries.length})? Wpisy dodane w bazie po ostatnim imporcie przepadną.`, 'Importuj'))) return 'Anulowano.';
        await importReg(c.key, entries, userName()); await load();
        return `Zaimportowano wpisów: ${entries.length}.`;
      },
      compareFn: async () => {
        const d = await api('baseSheet', [c.short], { timeoutMs: 300000 }), entries = await loadReg(c.key);
        return compareRegister(c, d.values || [], entries);
      },
      onMode: async () => { await load(); } });
  }

  /** Nowy wpis ZwG (tylko w trybach z bazą): w trybie „równolegle” najpierw karta ZwG w arkuszu (numer wiersza), potem baza. */
  function addDialog() {
    const c = REGISTERS.zwg;
    const codes = [];
    pswtSnapshot().then((snap) => { for (const r of ((snap && snap.data && snap.data.rows) || [])) { const code = String(r[1] ?? '').trim(); if (code && Number(r[0]) >= 2000 && Number(r[0]) < 4000) codes.push(code); } list.replaceChildren(...codes.slice(0, 3000).map((x) => h('option', { value: x }))); }).catch(() => {});
    const list = h('datalist', { id: 'zwg-codes' });
    const code = h('input', { type: 'text', list: 'zwg-codes', placeholder: 'np. Φ6,8 Lr30', style: { width: '100%' }, autocomplete: 'off' });
    const qty = h('input', { type: 'number', min: 1, step: 1, value: '1', style: { width: '90px' } });
    const date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const note = h('div', { class: 'muted', style: { minHeight: '18px', fontSize: '12px' } });
    const row = (label, el2) => h('label', { style: { display: 'block', margin: '6px 0' } }, h('div', { class: 'muted', style: { fontSize: '12px' } }, label), el2);
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const r = makeRegEntry({ code: code.value, qty: qty.value, date: date.value, who: userName() });
      if (r.error) { note.textContent = r.error; note.style.color = '#c62828'; return; }
      save.disabled = true; note.style.color = ''; note.textContent = 'Zapisywanie…';
      try {
        let n = null;
        if (modeOf() === 'dual') { const res = await api('zwgAddEntry', [{ code: r.entry.code, qty: r.entry.qty, date: r.entry.at }]); n = res && res.row; }
        await appendReg('zwg', r.entry, n);
        m.close(); toast('Dodano wpis ZwG' + (n ? ` (wiersz ${n})` : '')); await load();
      } catch (e) { save.disabled = false; note.style.color = '#c62828'; note.textContent = /Nieznana funkcja|UNKNOWN_FN/i.test(e.message || '') ? 'W Apps Script brak funkcji zwgAddEntry – wgraj nowe Baza.gs i Api.gs oraz wdróż API.' : 'Błąd zapisu: ' + (e.message || e); }
    } }, 'Zapisz');
    const m = modal('Dodaj wpis ZwG (zużycie wiertła / gwintownika / trepana)', h('div', {}, list, row('Wymiary / symbol z PSWT', code), row('Ilość', qty), row('Data pobrania', date), note,
      h('div', { class: 'actions' }, save, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'))), { wide: true });
    setTimeout(() => code.focus(), 0);
  }

  /**
   * Ręczny wpis zużycia (tylko GOD): taki sam jak ze Skanera (symbol, ilość, data i godzina, osoba), a przy nazwisku dopisek „wpis ręczny”.
   * Zapis tylko w bazie – w trybie „równolegle” trafia do arkusza dopiero z eksportu (okno Migracji).
   */
  function manualDialog() {
    if (!isGod() || modeOf() === 'sheet') return;
    const c = cfg(), key = st.key;
    const codes = [];
    const list = h('datalist', { id: 'man-codes' });
    pswtSnapshot().then((snap) => {
      for (const r of ((snap && snap.data && snap.data.rows) || [])) { const code = String(r[1] ?? '').trim(), a = Number(r[0]); if (code && (key === 'zp' ? a < 1000 : a >= 2000 && a < 4000)) codes.push(code); }
      list.replaceChildren(...codes.slice(0, 3000).map((x) => h('option', { value: x })));
    }).catch(() => {});
    const code = h('input', { type: 'text', list: 'man-codes', placeholder: key === 'zp' ? 'symbol płytki / oprzyrządowania' : 'np. Φ6,8 Lr30', style: { width: '100%' }, autocomplete: 'off' });
    const qty = h('input', { type: 'number', min: 1, step: 'any', value: '1', style: { width: '90px' } });
    const note = h('div', { class: 'muted', style: { minHeight: '18px', fontSize: '12px' } });
    const row = (label, el2) => h('label', { style: { display: 'block', margin: '6px 0' } }, h('div', { class: 'muted', style: { fontSize: '12px' } }, label), el2);
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const r = makeManualEntry({ code: code.value, qty: qty.value, who: userName() });
      if (r.error) { note.textContent = r.error; note.style.color = '#c62828'; return; }
      if (codes.length && !codes.some((x) => x.toLowerCase() === r.entry.code.toLowerCase())) { note.textContent = 'Nie ma takiego symbolu w PSWT – wybierz z listy podpowiedzi.'; note.style.color = '#c62828'; return; }
      save.disabled = true; note.style.color = ''; note.textContent = 'Zapisywanie…';
      try { await appendReg(key, r.entry, null); m.close(); toast(`Dopisano wpis ręczny ${r.entry.code} (${c.short})`); await load(); }
      catch (e) { save.disabled = false; note.style.color = '#c62828'; note.textContent = 'Błąd zapisu: ' + (e.message || e); }
    } }, 'Dodaj wpis');
    const m = modal(`Wpis ręczny – ${c.short}`, h('div', {}, list,
      h('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 6px' } }, 'Wpis jak ze Skanera: data i godzina z chwili zapisu, osoba z dopiskiem „wpis ręczny”. Zapis tylko w bazie' + (modeOf() === 'dual' ? ' – w trybie „równolegle” przenieś go do arkusza eksportem z okna Migracji (inaczej kolejny import z arkusza go usunie).' : '.')),
      row(key === 'zp' ? 'Symbol płytki / oprzyrządowania (z PSWT)' : 'Wymiary / symbol z PSWT', code), row('Ilość', qty), note,
      h('div', { class: 'actions' }, save, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'))), { wide: true });
    setTimeout(() => code.focus(), 0);
  }

  /** Odjęcie zużycia = usunięcie zaznaczonego wpisu z bazy (tylko GOD): bez wpisu korygującego i bez śladu zmiany. */
  async function deleteSelected() {
    if (!isGod() || modeOf() === 'sheet' || sel.key !== st.key || sel.n == null) return;
    const c = cfg(), r = sel.row, txt = r ? c.heads.map((x, i) => `${x}: ${String(r[i] ?? '') || '—'}`).join(' · ') : '#' + sel.n;
    if (!(await confirmBox(`Usuń wpis ${c.short}`, `Usunąć z bazy zaznaczony wpis?\n${txt}\nZużycie w PSWT zmniejszy się o jego ilość. Nie zostanie żaden ślad zmiany.` + (modeOf() === 'dual' ? '\nW trybie „równolegle” wiersz w arkuszu zostaje – usuń go tam osobno, inaczej kolejny import go przywróci.' : ''), 'Usuń'))) return;
    try { await deleteReg(st.key, sel.n); sel.n = null; toast(`Usunięto wpis ${c.short}`); await load(); }
    catch (e) { toast('Nie usunięto: ' + (e.message || e), true); }
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px'; el.style.height = '100%';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap', gap: '6px', alignItems: 'center' } }, tabs, migBtn, h('span', { class: 'grow' }), status, plusBtn, minusBtn, addBtn, reloadBtn), holder);
  paintTabs(); show(); load();
}
