// Narzędziownia → Produkty: baza produktów z karty PSWT arkusza. Dane czytane z arkusza raz i zapisane w bazie Firebase (snap_meta / snap_rows, klucz „pswt”),
// potem odświeżane na życzenie przyciskiem „Odśwież z arkusza PSWT” (zapis w bazie: MASTER / GOD). Wszystkie kolumny karty, nagłówki z wiersza 1.
import { h, clear, api, toast, confirmBox, modal } from '../ui.js';
import { getSnapshot, putSnapshot } from '../snapStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { toolroomAccess, toolroomLevelOf } from '../logic/toolroomAccess.js';
import { colName } from '../logic/planGrid.js';
import { sheetTable } from './sheetTable.js';
import { getMode, MODES } from '../migrationStore.js';
import { invalidateCatalog } from '../catalog.js';
import { importPlKonturDb } from '../plStore.js';
import { openMigrationDialog } from './migrationDialog.js';
import { moduleLevelOf } from '../logic/moduleLevels.js';
import { loadPswtDb, importPswtDb, importZakupyArDb, updatePswtCellDb, compareAllDb, addPswtDb } from '../pswtStore.js';
import { tableRows, colLetter, DATA_COLS } from '../logic/pswtDb.js';
import { toLogicalValues, displayOrder, physIndex, COLUMN_SECTIONS, EXTRA_HEADERS } from '../logic/pswtLayout.js';
import { COMPUTED } from '../logic/pswtEngine.js';

const when = (m) => new Date(m.updatedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function mountProducts(el, ctx) {
  const canStore = toolroomAccess(toolroomLevelOf(ctx.user)).manage;
  let current = null;   // { data, meta, view: { headers, rows }, layout } – data: dane w układzie fizycznym karty (do migawki w bazie), view: te same dane w układzie logicznym (tabela); edycja zmienia oba
  let saveTimer = null;
  let mode = 'sheet', dbState = null;   // tryb przejścia (sheet | dual | db); dbState = { entries, ctx, numbers, headers } – dane z bazy (tryby dual i db)
  const userName = () => (ctx.user && (ctx.user.name || ctx.user.email)) || '';
  /** Zapis zmiany komórki w arkuszu (karta PSWT; kolumny z formułami serwer odrzuca) i – po chwili – w migawce bazy Firebase. */
  async function editCell(row, col, text, old) {
    const rows = current && current.view ? current.view.rows : [];
    const i = rows.indexOf(row);
    if (i < 0) throw new Error('Nie znaleziono wiersza – odśwież dane z arkusza.');
    if (mode !== 'sheet') return editCellDb(row, i, col, text, old);
    const p = physIndex(col.idx, current.layout);   // kolumna tabeli (układ logiczny) → kolumna karty (stary / nowy układ)
    if (p < 0) throw new Error('Tej kolumny nie ma jeszcze w arkuszu (stary układ karty) – zmiana możliwa po przejściu na tryb z bazą.');
    const sheetRow = ((current.data && current.data.firstRow) || 2) + i;   // migawki z wcześniejszych wersji (bez firstRow) zaczynały się od wiersza 2
    const res = await api('updateBaseCells', ['PSWT', [{ row: sheetRow, col: p + 1, value: text, expect: old }]]);
    const r0 = res && res.results && res.results[0];
    if (!r0 || !r0.ok) throw new Error((r0 && r0.error) || 'Serwer nie zapisał zmiany.');
    row[col.idx] = text; if (current.data.rows[i]) current.data.rows[i][p] = text;
    toast(`Zapisano w arkuszu: ${colName(p)}${sheetRow}`);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { current.meta = await putSnapshot('pswt', current.data, { user: (ctx.user && (ctx.user.name || ctx.user.email)) || '', info: `produktów: ${current.data.rows.length}, kolumn: ${current.data.headers.length}` }); }
      catch (e) { toast('Zmiana jest w arkuszu, ale nie w bazie Firebase: ' + (e.message || e), true); }
    }, 2500);
  }
  /** Edycja w trybach z bazą: kolumny liczone (ƒ) są chronione; tryb równoległy najpierw zapisuje w arkuszu (jak dotąd), potem w bazie; zmiany przeliczają stany. */
  async function editCellDb(row, i, col, text, old) {
    const letter = colLetter(col.idx), n = dbState.numbers[i];
    if (COMPUTED.includes(letter)) throw new Error(`Kolumna ${letter} (ƒ) jest liczona przez program – nie edytuje się jej ręcznie.`);
    if (mode === 'dual') {
      const res = await api('updateBaseCells', ['PSWT', [{ row: n, lcol: col.idx, value: text, expect: old }]]);   // serwer sam przelicza kolumnę logiczną na układ karty (stary / nowy)
      const r0 = res && res.results && res.results[0];
      if (!r0 || !r0.ok) throw new Error((r0 && r0.error) || 'Serwer nie zapisał zmiany w arkuszu.');
    }
    await updatePswtCellDb(n, letter, text);
    const e = dbState.entries.find((x) => x.n === n);
    if (e) { const v = { ...(e.v || {}) }; if (String(text).trim() === '') delete v[letter]; else v[letter] = text; e.v = v; if (letter === 'AJ') delete e.aj; }
    toast(`Zapisano ${mode === 'dual' ? 'w arkuszu i w bazie' : 'w bazie'}: ${letter}${n}`);
    row[col.idx] = text; showDb();   // przeliczone stany po zmianie
    return true;
  }
  const table = sheetTable({ storageKey: 'products', defaultVisible: 14, onEdit: canStore ? editCell : null,
    sections: COLUMN_SECTIONS.map((sec) => ({ id: sec.id, label: sec.label, test: (c) => sec.test(c.idx), sub: (sec.sub || []).map((x) => ({ id: x.id, label: x.label, test: (c) => x.test(c.idx) })) })) });   // przyciski sekcji kolumn: A:C, D:N, O:U, płytki i części (osobno płytki / części), AH:AU   // edycja komórek: MASTER i GOD w Narzędziowni
  const status = h('span', { class: 'muted' });
  const refreshBtn = h('button', { class: 'btn', title: 'Połącz z kartą PSWT w arkuszu i pobierz aktualne dane' + (canStore ? ' (zapis w bazie Firebase)' : ' (zapis w bazie – MASTER / GOD)'), onclick: () => refresh() }, 'Odśwież z arkusza PSWT');
  let loading = false;

  function showDb() {
    const t = tableRows(dbState.entries, dbState.ctx);
    dbState.numbers = t.numbers;
    show({ sheet: 'PSWT', headers: dbState.headers, rows: t.rows }, null, `Baza Firebase (${MODES[mode]}) · produktów: ${t.rows.length} · kolumny ƒ liczy program z rejestrów zużycia i zakupów`, true);
  }
  async function loadDb() {
    status.textContent = 'Wczytywanie produktów z bazy…';
    try {
      dbState = await loadPswtDb();
      if (!dbState.entries.length) { status.textContent = 'Baza PSWT jest pusta – GOD: „⇄ Migracja” → Importuj z arkusza.'; return; }
      showDb();
    } catch (e) { status.textContent = 'Błąd: ' + (e.code === 'permission-denied' ? 'brak uprawnień (opublikuj reguły Firestore: reg_pswt, reg_zakupy_ar)' : e.message || e); }
  }
  /** Pokazuje dane: [logical] = true – dane z bazy (układ logiczny), inaczej z karty arkusza (układ fizyczny – stary albo nowy – przeliczany na logiczny). */
  function show(data, meta, text = '', logical = false) {
    let view, layout;
    if (logical) { view = { headers: data.headers || [], rows: data.rows || [] }; layout = (dbState && dbState.meta && dbState.meta.layout) || 'old'; }
    else { const t = toLogicalValues([data.headers || [], ...(data.rows || [])]); view = { headers: t.values[0] || [], rows: t.values.slice(1) }; layout = t.layout; }
    current = { data, meta, view, layout };
    const headers = view.headers, BLANK = { 0: 'Nr', 1: 'Kod produktu' };   // kolumny A i B karty PSWT nie mają nagłówka
    const clean = (t) => String(t || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();   // nagłówki z zawijaniem wierszy
    let last = 46; for (let i = 99; i > 46; i--) if (clean(headers[i])) { last = i; break; }
    const showExtras = logical || layout === 'new';   // dodatkowe miejsca (płytki 8–10, części 6–10) są w arkuszu dopiero w nowym układzie karty; w bazie zawsze
    const order = displayOrder(last).filter((i) => i < 100 || showExtras);
    const cols = order.map((i) => {
      const p = physIndex(i, layout), letter = p >= 0 ? colName(p) : '+';
      return { key: String(i), idx: i, title: `${letter}${i < 100 && COMPUTED.includes(colName(i)) ? ' ƒ' : ''} · ${clean(headers[i]) || BLANK[i] || EXTRA_HEADERS[i] || 'kolumna ' + letter}` };
    });
    table.setData(cols, view.rows, (r, c) => String(r[c.idx] ?? '').replace(/\r\n?/g, '\n'), { defaultVisible: cols.length });   // wszystkie kolumny karty widoczne od razu
    status.textContent = text ? text : meta ? `Baza Firebase: ${when(meta)}${meta.updatedBy ? ', ' + meta.updatedBy : ''} · ${meta.info || ''}` : `Dane z arkusza (tylko na tym komputerze) · produktów: ${view.rows.length}, kolumn: ${headers.length} (układ karty: ${layout === 'new' ? 'nowy, 10 + 10 miejsc' : 'dotychczasowy'})`;
  }
  async function loadStored() {
    try { const snap = await getSnapshot('pswt'); if (snap && snap.data && (snap.data.firstRow || 2) === 2) { show(snap.data, snap.meta); return true; } }   // migawka z błędnym układem (firstRow 3 – wersje 1.131.1–1.135.1) jest pomijana: dane zostaną pobrane od nowa
     catch (e) { status.textContent = 'Baza Firebase: ' + (e.code === 'permission-denied' ? 'brak dostępu (opublikuj reguły z snap_meta / snap_rows)' : e.message); }
    return false;
  }
  async function refresh() {
    if (loading) return;
    if (mode !== 'sheet') { loading = true; refreshBtn.disabled = true; await loadDb(); loading = false; refreshBtn.disabled = false; return; } loading = true; refreshBtn.disabled = true; status.textContent = 'Czytanie karty PSWT… (to może potrwać)';
    try {
      const d = await api('baseSheet', ['PSWT'], { timeoutMs: 300000 }), v = d.values || [];
      const data = { sheet: d.sheet, headers: (v[0] || []).map(String), rows: v.slice(1), firstRow: 2 };   // wiersz 1 = nagłówki, produkty od wiersza 2
      if (canStore) {
        const meta = await putSnapshot('pswt', data, { user: (ctx.user && (ctx.user.name || ctx.user.email)) || '', info: `produktów: ${data.rows.length}, kolumn: ${data.headers.length}` });
        show(data, meta); toast('Produkty zapisane w bazie Firebase');
      } else show(data, null);
    } catch (e) { status.textContent = 'Błąd: ' + (/Nieznana funkcja|UNKNOWN_FN/i.test(e.message || '') ? 'w Apps Script brak funkcji baseSheet – dodaj Baza.gs i wpis w Api.gs, wdróż nową wersję.' : e.message); }
    loading = false; refreshBtn.disabled = false;
  }
  const modeTag = h('span', { class: 'muted', style: { fontSize: '12px' } });
  const god = moduleLevelOf(ctx.user, 'narzedziownia') === 'god';
  const migBtn = h('button', { class: 'btn small', style: { display: god ? '' : 'none' }, title: 'Przejście PSWT (stany, zużycie, status liczone przez program) z arkusza do bazy: tryb, import, porównanie (tylko GOD)', onclick: () => migration() }, '⇄ Migracja');
  function migration() {
    openMigrationDialog({ title: 'Migracja PSWT (silnik stanów): arkusz → baza', domain: 'pswt', exportKey: 'PSWT', user: userName(),
      dbWarning: 'Zmiany i nowe produkty zapiszą się tylko w bazie. Katalog narzędzi (ToolTrack, ToolBuilder, Assem.Tool, BN, Części) nadal czyta arkusz – zobaczy zmiany dopiero po „Eksportuj do arkusza”.',
      intro: 'Najpierw muszą być zaimportowane do bazy ZN, ZP, ZwG i Zakupy (stany liczą się z nich). Kolejność: 1) Importuj (PSWT + archiwum Zakupy_ar), 2) Porównaj (kolumny ƒ policzone przez program mają być takie same jak w arkuszu), 3) tryb „Równolegle”: Produkty czytają z bazy, a zmiany idą do arkusza i bazy. Po przeniesieniu pozycji do archiwum zakupów zrób ponowny import.',
      importFn: async () => {
        const d = await api('baseSheet', ['PSWT'], { timeoutMs: 300000 });
        if (!(await confirmBox('Import PSWT do bazy', `Zastąpić produkty w bazie kartą PSWT z arkusza (${Math.max(0, (d.values || []).length - 1)} wierszy) oraz archiwum zakupów? Zmiany wpisane w bazie po ostatnim imporcie przepadną.`, 'Importuj'))) return 'Anulowano.';
        const imp = await importPswtDb(d, userName()), n = imp.count, ovr = Object.entries(imp.overrides).map(([l, c]) => `${l}: ${c}`).join(', ');
        const ar = await api('baseSheet', ['ZAKUPY_AR'], { timeoutMs: 300000 }), na = await importZakupyArDb(ar.values || [], userName());
        let npl = 0; try { npl = await importPlKonturDb((await api('baseSheet', ['PL_KONTUR'], { timeoutMs: 300000 })).values || [], userName()); } catch { /* bez karty PL_kontur – bez konturów płytek */ }
        invalidateCatalog();
        if (mode !== 'sheet') await loadDb();
        return `Zaimportowano produktów: ${n}, pozycji archiwum zakupów: ${na}, płytek z PL_kontur: ${npl}.` + (ovr ? ` Stałe wpisane w arkuszu zamiast formuł (kolumna: wierszy): ${ovr}.` : '') + (imp.carried ? ` Zachowano dane tylko z bazy (typ narzędzia, dodatkowe miejsca części): ${imp.carried}.` : '');
      },
      compareFn: () => compareAllDb(),   // kolumny liczone PSWT + katalog (karta ND_CACHE)
      onMode: async (v) => { mode = v; paintMode(); if (v === 'sheet') { dbState = null; await loadStored(); } else await loadDb(); } });
  }
  /** Nowy produkt (tryby z bazą): formularz ze wszystkimi kolumnami wpisywanymi karty PSWT (A–AU bez liczonych ƒ); w trybie równoległym najpierw wiersz w arkuszu, potem baza. */
  function addProduct() {
    if (!dbState) return;
    const inputs = {}, note = h('div', { class: 'muted', style: { minHeight: '18px', fontSize: '12px' } });
    const clean = (t) => String(t || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 12px', maxHeight: '55vh', overflow: 'auto', padding: '2px' } });
    for (const i of DATA_COLS.slice().sort((x, y) => displayOrder(46).indexOf(x) - displayOrder(46).indexOf(y))) {   // kolejność jak w tabeli: płytki 1–10, części 1–10, dalej reszta
      const l = colLetter(i); if (COMPUTED.includes(l)) continue;
      const p = physIndex(i, (current && current.layout) || 'old'), shown = i < 100 ? (p >= 0 ? colName(p) : l) : (p >= 0 ? colName(p) : '+');
      const inp = h('input', { type: 'text', style: { width: '100%' }, autocomplete: 'off' }); inputs[l] = inp;
      grid.append(h('label', { style: { display: 'block' } }, h('div', { class: 'muted', style: { fontSize: '11px' } }, `${shown} · ${clean((dbState.headers || [])[i]) || EXTRA_HEADERS[i] || (i === 0 ? 'Nr' : i === 1 ? 'Kod produktu' : 'kolumna ' + shown)}${l === 'A' || l === 'B' ? ' *' : ''}`), inp));
    }
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const values = {}; for (const [l, inp] of Object.entries(inputs)) if (inp.value.trim() !== '') values[l] = inp.value.trim();
      const bad = (m) => { note.textContent = m; note.style.color = '#c62828'; };
      if (!values.A || !values.B) return bad('Podaj numer (A) i symbol (B) produktu.');
      if (dbState.entries.some((e) => String((e.v || {}).B ?? '').trim().toLowerCase() === values.B.toLowerCase())) return bad(`Produkt „${values.B}” już istnieje.`);
      save.disabled = true; note.style.color = ''; note.textContent = 'Zapisywanie…';
      try {
        const n = mode === 'dual' ? Number((await api('pswtAddProduct', [values])).row) || null : null;
        dbState.entries.push(await addPswtDb(values, n));
        showDb(); invalidateCatalog(); m.close(); toast(`Dodano produkt ${values.B}${n ? ' (wiersz ' + n + ' w arkuszu)' : ''}`);
      } catch (e) { save.disabled = false; bad(String(e.message || e)); }
    } }, 'Dodaj');
    const m = modal('Nowy produkt', h('div', {}, h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Kolumny liczone przez program (ƒ: stan, zużycie, status…) wypełnią się same. Wymagane: numer (A) i symbol (B).'), grid, note,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), save)), { wide: true });
    inputs.A.focus();
  }
  const addBtn = h('button', { class: 'btn small', style: { display: 'none' }, title: 'Dodaje nowy produkt do karty PSWT (baza' + ' i arkusz w trybie równoległym)', onclick: () => addProduct() }, '＋ Dodaj produkt');
  const paintMode = () => { modeTag.textContent = mode === 'sheet' ? '' : `Źródło: baza Firebase (${MODES[mode]})`; addBtn.style.display = canStore && mode !== 'sheet' ? '' : 'none'; };
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px'; el.style.height = '100%';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Produkty – karta PSWT'), canStore ? h('span', { class: 'muted', title: 'Dwuklik w komórce: edycja i zapis w arkuszu (kolumny z formułami są chronione)' }, '✎ edycja: dwuklik w komórce') : null, h('span', { class: 'grow' }), modeTag, status, addBtn, migBtn, refreshBtn), table.el);
  const start = async () => { mode = await getMode('pswt'); paintMode(); if (mode !== 'sheet') return loadDb(); return loadStored().then((ok) => { if (!ok && canStore) refresh(); else if (!ok) status.textContent = 'Brak danych w bazie – poproś MASTER / GOD o pobranie z arkusza albo użyj przycisku (dane tylko lokalnie).'; }); };
  start();
}
