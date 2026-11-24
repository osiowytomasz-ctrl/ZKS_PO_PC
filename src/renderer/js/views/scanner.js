import { h, clear, field, api, apiCached, toast, alertBox, confirmBox, modal } from '../ui.js';
import { resolveCode, filterCodes, parseQuantity, LOCK_SECONDS } from '../logic/scanner.js';
import {
  OPER_STATUSES, classify, parseDetailCode, parseOperCode, parseDocCode, parsePieces, parseOrdered, operationsText, filterRows,
} from '../logic/registers.js';
import * as SI from '../logic/scanInfo.js';
import { cellColor } from '../logic/mistrz.js';

const KIND_LABELS = {
  product: 'produkt (pobranie części)',
  detail: 'detal (rejestr detali)',
  operation: 'operacja (rejestr operacji)',
  document: 'dokument (rejestr dokumentacji)',
};

/**
 * Skaner: jeden ekran dla całego skanowania. Kod ze skanera USB (działa jak klawiatura i kończy Enterem), z kamery albo
 * wpisany jest rozpoznawany po znakach rozdzielających i Skaner sam przełącza się na właściwą opcję: pobranie części
 * (kod z listy), rejestr detali, rejestr operacji albo rejestr dokumentacji. Uprawnieni mają też „Listę detali” i „Dokumentację”.
 */
export function mountScanner(el, ctx) {
  let codes = [];
  let perms = { manage: false, details: false, docs: false };
  let mode = 'scan';
  let kind = 'none';
  let stream = null;
  let camTimer = null;

  const modeBar = h('div', { class: 'tabs' });
  const body = h('div', {});

  const drawModes = () => {
    clear(modeBar);
    const items = [['scan', 'Skanuj'], ...(perms.details ? [['list', 'Lista detali']] : []), ...(perms.docs ? [['docs', 'Dokumentacja']] : [])];
    if (items.length < 2) return;
    for (const [id, label] of items) modeBar.append(h('button', { class: id === mode ? 'on' : '', onclick: () => setMode(id) }, label));
  };
  const setMode = (m) => { stopCamera(); mode = m; syncCurrent = () => {}; refreshScan = () => {}; drawModes(); drawBody(); };
  function drawBody() {
    clear(body);
    if (mode === 'scan') body.append(scanPanel());
    else if (mode === 'list') body.append(listPanel());
    else body.append(docsPanel());
  }

  const failText = (e) => 'Błąd: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Odśwież podgląd i sprawdź, zanim spróbujesz ponownie.' : '');

  /**
   * Blokada przycisków zapisu po udanym zapisie (ochrona przed podwójnym skanem), wspólna dla wszystkich opcji,
   * jak w telefonie. Odliczanie widać na przyciskach zapisu bieżącej opcji.
   */
  let lockLeft = 0;
  let lockTimer = null;
  let syncCurrent = () => {};
  let refreshScan = () => {};
  function startLock() {
    lockLeft = LOCK_SECONDS;
    clearTimeout(lockTimer);
    const tick = () => {
      lockLeft = Math.max(0, lockLeft - 1);
      syncCurrent();
      if (lockLeft > 0) lockTimer = setTimeout(tick, 1000);
    };
    syncCurrent();
    lockTimer = setTimeout(tick, 1000);
  }
  /** Przycisk zapisu: aktywny, gdy opcja jest gotowa i nie trwa blokada; w czasie blokady pokazuje odliczanie. */
  function setSave(btn, label, ready) {
    btn.disabled = !ready || lockLeft > 0;
    btn.textContent = lockLeft > 0 ? `${label} (${lockLeft} s)` : label;
  }

  // ---------------------------------------------------------------- Skanowanie

  /** Ustawienia kamery na tym komputerze: wysokość obszaru (wyświetlany = skanowany), zoom, celownik i jego wielkość. */
  const PREFS_KEY = 'scanner.prefs';
  const loadPrefs = () => { try { return { height: 300, zoom: 1, reticle: true, size: 70, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) }; } catch { return { height: 300, zoom: 1, reticle: true, size: 70 }; } };
  const savePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* bez pamięci */ } };
  // podgląd z bazy (świeże dane): klucz → odpowiedź API
  const liveCache = new Map();
  async function live(fn, args, key, force = false) {
    if (!force && liveCache.has(key)) return liveCache.get(key);
    const r = await api(fn, args, { timeoutMs: 60000 });
    liveCache.set(key, r);
    return r;
  }
  const colorRow = (c) => (c ? { background: c[0], color: c[1] || '#000' } : { background: '#fff', color: '#000' });
  /** Tabela jak w module Mistrz PO (mała czcionka, siatka); pierwsza kolumna przyklejona, reszta przewijana w poziomie. */
  function smallTable(headers, rows) {
    const cell = (t, st = {}, first = false) => h('td', { style: { padding: '1px 6px', border: '1px solid #c8c8c8', whiteSpace: 'nowrap', fontSize: '11px', ...(first ? { position: 'sticky', left: 0, zIndex: 1, textAlign: 'right' } : {}), ...st } }, t);
    return h('div', { style: { overflowX: 'auto', maxWidth: '100%' } }, h('table', { style: { borderCollapse: 'collapse', fontSize: '11px' } },
      h('thead', {}, h('tr', {}, ...headers.map((x, i) => h('th', { style: { padding: '1px 6px', border: '1px solid #c8c8c8', background: '#ddd', fontWeight: 500, fontSize: '11px', whiteSpace: 'nowrap', ...(i === 0 ? { position: 'sticky', left: 0, zIndex: 2 } : {}) } }, x)))),
      h('tbody', {}, ...rows.map((r) => h('tr', { style: r.current ? { outline: '2px solid #00c853', outlineOffset: '-2px' } : {} },
        ...r.cells.map((v, i) => cell(v, colorRow(r.color), i === 0)))))));
  }
  const greenBtn = (label, onclick, color = ['#6aa84f', '#fff']) => h('button', { class: 'btn', style: { background: color[0], color: color[1], border: 'none', fontWeight: 500, padding: '4px 10px' }, onclick }, label);

  function scanPanel() {
    const code = h('input', { type: 'text', placeholder: 'Zeskanuj kod (lub wpisz)', autocomplete: 'off', spellcheck: 'false', style: { width: '100%', height: '30px', fontSize: '14px' } });
    const kindLabel = h('div', { style: { margin: '2px 0', color: '#1565c0', fontSize: '12px', minHeight: '1.2em' } });
    const section = h('div', {});
    const infoArea = h('div', { style: { marginTop: '6px' } });
    const camBtn = h('button', { class: 'btn small', onclick: toggleCamera }, 'Skanuj kamerą');
    const gearBtn = h('button', { class: 'btn small', title: 'Ustawienia kamery: wysokość obszaru, zoom, celownik', onclick: prefsDialog }, '⚙');
    const msg = h('div', { style: { margin: '6px 0', whiteSpace: 'pre-wrap', fontSize: '13px' } });
    let current = { reset() {}, sync() {} };
    syncCurrent = () => current.sync();
    refreshScan = () => { kind = 'none'; update(); };
    let lastSaved = '';

    const say = (text, ok) => { msg.className = ok ? '' : 'err'; msg.style.color = ok ? '#1b5e20' : ''; msg.textContent = text; };
    const parsedNow = () => ({ detail: parseDetailCode, operation: parseOperCode, document: parseDocCode })[kind]?.(code.value.trim());
    /** Po udanym zapisie: czyści kod i pola, komunikat, blokada przycisku zapisu; podgląd zostaje dla zapisanego kodu (odświeżony z bazy). */
    const finished = (r, lock, saved = code.value.trim(), refresh = null) => {
      say((r && r.message && String(r.message).trim()) || 'Zapisano.', true);
      lastSaved = saved; code.value = ''; update(); code.focus();
      if (lock) startLock();
      showInfo(saved, true, refresh);
    };

    /** Rozpoznaje rodzaj kodu i przełącza sekcję; pola poprzedniego kodu są czyszczone przy zmianie rodzaju. */
    function update() {
      const next = classify(code.value, codes);
      // przy części opis jest w bloku wyniku („Produkt – pobranie części” obok ilości)
      kindLabel.textContent = KIND_LABELS[next] && next !== 'product' ? KIND_LABELS[next][0].toUpperCase() + KIND_LABELS[next].slice(1) : '';
      if (next !== kind) {
        kind = next;
        clear(section);
        if (kind === 'product') current = productSection();
        else if (kind === 'detail') current = detailSection();
        else if (kind === 'operation') current = operationSection();
        else if (kind === 'document') current = documentSection();
        else {
          current = { reset() {}, sync() {} };
          if (kind === 'unknown') section.append(h('p', { class: 'err' }, 'Nie rozpoznano rodzaju kodu. Zeskanuj kod jeszcze raz albo wpisz go poprawnie.'));
          else if (!lastSaved) section.append(h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Zeskanuj kod: Skaner sam rozpozna produkt, detal, operację albo dokument.'));
        }
      }
      current.sync();
      if (code.value.trim()) showInfo(code.value.trim());
    }
    /** Nowy kod (Enter ze skanera USB, kamera): czyści pola poprzedniego i ustawia kod. */
    function accept(text) {
      say('', true);
      current.reset();
      const resolved = resolveCode(text, codes);
      code.value = resolved || text;
      lastSaved = '';
      update();
    }
    code.addEventListener('input', () => { say('', true); update(); });
    code.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      accept(code.value.trim());
      current.focus?.();
    });

    // ---------- podgląd pod spodem (z bazy): część, detale, operacje, dokumenty ----------
    let infoToken = 0, infoFor = '';
    async function showInfo(raw, force = false, opNr = null) {
      if (!force && raw === infoFor) return;
      infoFor = raw;
      const t = ++infoToken;
      const k = classify(raw, codes);
      try {
        if (k === 'product') {
          const c = resolveCode(raw, codes); if (!c) return;
          const r = await live('scanPartInfo', [c], 'p|' + c, force);
          if (t === infoToken) renderPart(r, c);
        } else if (k === 'detail') {
          const d = parseDetailCode(raw); if (!d.fields.komis) return;
          const r = await live('mp_scanInfo', [{ detailKomis: d.fields.komis }], '||' + d.fields.komis, force);
          if (t === infoToken) renderDetails(r, d.fields);
        } else if (k === 'operation') {
          const o = parseOperCode(raw); if (!o.fields.komis || !o.fields.przewodnik) return;
          const r = await live('mp_scanInfo', [{ komis: o.fields.komis, przewodnik: o.fields.przewodnik }], `${o.fields.komis}|${o.fields.przewodnik}|`, force);
          if (t === infoToken) renderOpers(r, o.fields);
        } else if (k === 'document') {
          const d = parseDocCode(raw); if (!d.fields.komis) return;
          const r = await live('mp_scanInfo', [{ komis: d.fields.komis, przewodnik: d.fields.przewodnik }], `${d.fields.komis}|${d.fields.przewodnik}|`, force);
          if (t === infoToken) { renderDocs(r, d.fields); current.sync(); }
        } else clear(infoArea);
      } catch (e) { if (t === infoToken) clear(infoArea); /* podgląd pomocniczy – bez komunikatu (np. API jeszcze niewdrożone) */ }
    }
    const title = (t) => h('div', { style: { color: '#1565c0', fontSize: '12px', fontWeight: 500, margin: '6px 0 2px' } }, t);
    function renderPart(r, c) {
      clear(infoArea);
      const p = r.part;
      if (p) {
        const loc = section.querySelector('[data-loc]'); if (loc) loc.textContent = p.location ? 'Lokalizacja: ' + p.location : '';
        const st = (l, v, col) => h('span', { style: { marginRight: '12px', fontSize: '12px' } }, h('span', { class: 'muted' }, l + ': '), h('b', { style: { fontSize: '14px', padding: '0 3px', background: col && col !== '#ffffff' ? col : '' } }, v || '–'));
        infoArea.append(h('div', {}, st('Stan', p.stan, p.color), st('Zapas', p.zapas), st('Dostępne', p.dostepne)));
      }
      infoArea.append(title(`Pasuje do narzędzi (${r.tools.length})`));
      if (r.tools.length) infoArea.append(smallTable(['Narzędzie', 'Lokalizacja', 'Stan', 'Dost.', 'Zużycie'], r.tools.slice(0, 200).map((t) => ({
        cells: [String(t.code).toUpperCase(), t.location, t.stan, t.dostepne, t.wear], color: t.color && t.color !== '#ffffff' ? [t.color, t.color === '#ff0000' ? '#fff' : '#000'] : null }))));
    }
    function renderDetails(r, cur) {
      clear(infoArea);
      const list = SI.details(r.dreg, cur);
      infoArea.append(title(`Wykonane elementy komisu ${cur.komis} (${list.length})`));
      if (!list.length) { infoArea.append(h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Nie zarejestrowano jeszcze detali tego komisu.')); return; }
      infoArea.append(smallTable(['Poz.', 'Rys.', 'Data', 'Szt', 'Kpl'], list.map((x) => ({ cells: [x.pozycja, x.rysunek, x.last, `${x.done} / ${x.todo ?? '?'}`, x.komplet], color: x.color, current: x.current }))));
    }
    function renderOpers(r, cur) {
      clear(infoArea);
      const doc = r.docs.find((d) => eqv(d.nr, cur.przewodnik) && !d.archive) || r.docs.find((d) => eqv(d.nr, cur.przewodnik)) || null;
      const t = SI.operTable(SI.opers(r.ops, cur.nr), doc, cur.nr);
      if (!t.rows.length) { infoArea.append(h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Brak operacji tego przewodnika w bazie.')); return; }
      infoArea.append(smallTable(['Oper.', 'Start', 'Koniec', 'Kto'], t.rows.map((x) => ({ cells: [String(x.nr), x.skipped ? 'pominięto' : x.start, x.skipped ? 'pominięto' : x.end, x.operator],
        color: x.skipped ? SI.SKIPPED_COLOR : SI.statusColor(x.status), current: x.current }))));
      const hist = SI.history(r.ops);
      infoArea.append(h('button', { class: 'btn small', style: { marginTop: '4px', width: '100%' }, disabled: !hist.length, onclick: () => modal(`Historia: komis ${cur.komis}, przewodnik ${cur.przewodnik}`,
        smallTable(['Oper.', 'Data', 'Godz.', 'Kto'], hist.map((x) => { const del = eqv(x.status, 'usunięta');
          return { cells: [x.nr, x.date + (x.archive ? ' (arch.)' : ''), x.time, x.who + (del ? ' (usunięta)' : '')], color: del ? ['#eeeeee', '#888'] : SI.statusColor(x.status) }; }))) },
      `Historia rejestrowania przewodnika (${hist.length})`));
    }
    let lastDocs = null;
    function renderDocs(r, cur) {
      clear(infoArea);
      lastDocs = { key: `${cur.komis}|${cur.przewodnik}`, docs: r.docs };
      infoArea.append(title(`Dokumenty komisu ${cur.komis} (${r.docs.length})`));
      if (r.docs.length) infoArea.append(smallTable(['Nr', 'Rodzaj', 'Nazwa', 'Status', 'Postęp', 'Start'], r.docs.map((d) => ({
        cells: [d.nr, d.typ, d.nazwa + (d.archive ? ' (archiwum)' : ''), d.status, d.progress == null ? '' : Math.round(d.progress * 100) + '%', d.start],
        color: cellColor('docs', { C: d.komis, K: d.status, M: d.progress }, 'A'), current: eqv(d.nr, cur.przewodnik) }))));
    }
    const eqv = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

    // --- Produkt: po lewej „Produkt – pobranie części” i lokalizacja, po prawej ilość i Zapisz (kod z listy, zapis do ZP) ---
    function productSection() {
      const qty = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ilość', value: '1', style: { color: '#000', background: '#fff', fontWeight: 600, fontSize: '14px', width: '70px', height: '30px' } });
      const sugg = h('div', { class: 'opts', style: { maxHeight: '180px', background: '#fff' } });
      const save = h('button', { class: 'btn primary', style: { height: '30px' }, onclick: submit }, 'Zapisz');
      const redraw = () => {
        clear(sugg);
        const list = code.value.trim() && codes.includes(code.value.trim()) ? [] : filterCodes(code.value, codes);
        sugg.style.display = list.length ? '' : 'none';
        for (const s of list.slice(0, 500)) sugg.append(h('div', { style: { padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid #eee' }, onclick: () => { code.value = s; update(); qty.focus(); qty.select(); } }, s));
      };
      qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      async function submit() {
        say('', true);
        const resolved = resolveCode(code.value || lastSaved, codes);
        if (!resolved) { say('Tego kodu nie ma na liście produktów.'); return; }
        const q = parseQuantity(qty.value);
        if (!q) { say('Nieprawidłowa ilość (musi być większa od zera).'); return; }
        if (!(await confirmBox('Potwierdzić pobranie?', `Kod: ${resolved}\nIlość: ${q}`, 'Zapisz'))) return;
        save.disabled = true;
        try {
          const r = await api('processForm', [{ productCode: resolved, quantity: q }]);
          qty.value = '1'; finished(r, true, resolved);
          return;
        } catch (e) { say(failText(e)); }
        sync();
      }
      const sync = () => { redraw(); setSave(save, 'Zapisz', true); };
      section.append(sugg, h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        h('div', { style: { flex: 1, lineHeight: 1.25 } }, h('div', { style: { color: '#1565c0', fontSize: '12px' } }, 'Produkt – pobranie części'), h('div', { 'data-loc': '1', style: { fontSize: '12px', fontWeight: 600 } }, '')),
        qty, save));
      return { sync, reset() { qty.value = '1'; }, focus() { qty.focus(); qty.select(); } };
    }

    // --- Detal: odkodowany kod (komis, kpl / rysunek, pozycja), obok ilość sztuk i zapis ---
    function detailSection() {
      const decoded = h('div', { style: { flex: 1, border: '1px solid #999', padding: '2px 6px', lineHeight: 1.25, minHeight: '30px' } });
      const pieces = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'szt', style: { color: '#000', background: '#fff', fontWeight: 600, fontSize: '14px', width: '64px', height: '30px' } });
      const save = h('button', { class: 'btn primary', style: { height: '30px' }, disabled: true, onclick: submit }, 'Zapisz detal');
      pieces.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      async function submit() {
        const p = parsedNow();
        if (!p || !p.valid) { say('Zeskanuj poprawny kod detalu.'); return; }
        const q = parsePieces(pieces.value);
        if (!q) { say("Pole 'Ilość sztuk' musi być większe lub równe 1."); return; }
        if (!(await confirmBox('Zapisać detal?', `${p.display}\nIlość sztuk: ${q}`, 'Zapisz'))) return;
        save.disabled = true;
        try {
          const r = await api('mp_saveDetail', [{ productCode: code.value.trim(), extraNotes: q }]);
          pieces.value = ''; finished(r, true);
          return;
        } catch (e) { say(failText(e)); }
        sync();
      }
      function sync() {
        const p = parsedNow();
        clear(decoded);
        if (p) decoded.append(h('div', { style: { fontSize: '11px' } }, `Komis ${p.fields.komis} · kpl ${p.fields.komplet}`), h('div', { style: { fontSize: '13px', fontWeight: 600 } }, `rys. ${p.fields.rysunek} · poz. ${p.fields.pozycja}`));
        decoded.style.borderColor = p && !p.valid ? '#c62828' : '#999';
        setSave(save, 'Zapisz detal', !!(p && p.valid));
      }
      section.append(h('div', { style: { display: 'flex', alignItems: 'stretch', gap: '6px' } }, decoded, pieces, save));
      return { sync, reset() { pieces.value = ''; }, focus() { pieces.focus(); pieces.select(); } };
    }

    // --- Operacja: zwięzły opis, uwagi, przyciski w kolorach statusów (Start – bordo, W toku – pomarańcz, Koniec – zielony) ---
    function operationSection() {
      const info = h('div', { style: { border: '1px solid #ccc', padding: '2px 6px', fontSize: '12px' } });
      const notes = h('input', { type: 'text', placeholder: 'Uwagi', style: { width: '100%', height: '28px', marginTop: '4px' } });
      const COL = { Start: ['#980000', '#fff'], 'W toku': ['#f1c232', '#000'], Koniec: ['#6aa84f', '#fff'] };
      const statusBtns = OPER_STATUSES.map((s) => { const b = greenBtn(s, () => saveStatus(s), COL[s]); b.dataset.status = s; b.style.flex = '1'; b.disabled = true; return b; });
      const changeBtn = h('button', { class: 'btn small', disabled: true, style: { flex: 1 }, onclick: changeStatus }, 'Zmień status');
      const deleteBtn = h('button', { class: 'btn small', disabled: true, style: { flex: 1 }, onclick: removeOperation }, 'Usuń operację');
      const raw = () => code.value.trim();
      const fail = (e) => say(failText(e));

      async function saveStatus(status) {
        const p = parsedNow();
        if (!p || !p.valid) return;
        let pending = [];
        try { pending = await api('mp_pendingOperations', [p.fields.komis]); } catch (e) { fail(e); return; }
        const text = `Zaległe operacje komisu ${p.fields.komis}:\n${operationsText(pending)}\n\n${p.display}\nStatus: ${status}\nUwagi: ${notes.value.trim() || 'brak'}`;
        if (!(await confirmBox(`Zapisać operację (${status})?`, text, 'Zapisz'))) return;
        statusBtns.forEach((b) => { b.disabled = true; });
        try {
          const r = await api('mp_saveOperation', [{ productCode: raw(), status, notes: notes.value.trim() }]);
          notes.value = '';
          finished(r, true);
          return;
        } catch (e) { fail(e); }
        sync();
      }
      async function changeStatus() {
        const p = parsedNow();
        try {
          const list = await api('mp_findOperations', [p.fields.komis, p.fields.przewodnik, p.fields.nr]);
          const ended = list.filter((o) => o.status === 'Koniec');
          if (!ended.length) { await alertBox('Zmiana statusu', "Nie znaleziono operacji ze statusem 'Koniec' dla podanych parametrów!"); return; }
          if (ended.length > 1) { await alertBox('Zmiana statusu', "Znaleziono więcej niż jedną operację ze statusem 'Koniec'. Skontaktuj się z administratorem!"); return; }
          const o = ended[0];
          if (!(await confirmBox("Zmienić status na 'W toku'?", `Operacja: ${o.nr}\nKomis: ${o.komis}\nPrzewodnik: ${o.przewodnik}\nKlient: ${o.klient}\nOperator: ${o.operator}\nStatus: ${o.status}`, 'Zmień'))) return;
          finished(await api('mp_changeOperationStatus', [{ productCode: raw() }]));
        } catch (e) { fail(e); }
      }
      async function removeOperation() {
        const p = parsedNow();
        try {
          const list = await api('mp_findOperations', [p.fields.komis, p.fields.przewodnik, p.fields.nr]);
          if (!list.length) { await alertBox('Usuwanie operacji', 'Nie znaleziono aktywnych operacji o podanych parametrach.'); return; }
          if (!(await confirmBox(`Usunąć operację (wierszy: ${list.length})?`, `${operationsText(list)}\n\nWiersze dostaną status „Usunięta” (dane zostają w bazie).`, 'Usuń'))) return;
          finished(await api('mp_deleteOperation', [{ productCode: raw() }]));
        } catch (e) { fail(e); }
      }
      function sync() {
        const p = parsedNow();
        const ok = !!(p && p.valid);
        info.textContent = p ? `Komis ${p.fields.komis} · przewodnik ${p.fields.przewodnik} · oper. ${p.fields.nr} · ${p.fields.klient} · rys. ${p.fields.rysunek}` : '';
        info.style.borderColor = p && !p.valid ? '#c62828' : '#ccc';
        statusBtns.forEach((b) => setSave(b, b.dataset.status, ok));
        changeBtn.disabled = !ok; deleteBtn.disabled = !ok;
      }
      // Zmiana statusu i usuwanie – od poziomu MASTER w kolumnie „Mistrz dostęp” (bez kolumny – lista z Setup); serwer i tak to sprawdza.
      section.append(info, notes, h('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } }, ...statusBtns),
        perms.manage ? h('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } }, changeBtn, deleteBtn) : null);
      return { sync, reset() { notes.value = ''; }, focus() { notes.focus(); } };
    }

    // --- Dokument: zwięzły opis; już zarejestrowany – zielona informacja i nieaktywny zapis ---
    function documentSection() {
      const info = h('div', { style: { border: '1px solid #ccc', padding: '2px 6px', fontSize: '12px' } });
      const already = h('div', { style: { display: 'none', background: '#e8f5e9', border: '1px solid #00c853', color: '#1b5e20', padding: '4px 6px', fontSize: '12px', marginTop: '4px' } });
      const save = h('button', { class: 'btn primary', disabled: true, style: { marginTop: '4px', width: '100%' }, onclick: submit }, 'Zapisz dokument');
      const reg = (p) => (p && p.valid && lastDocs && lastDocs.key === `${p.fields.komis}|${p.fields.przewodnik}` ? SI.registered(lastDocs.docs, p.fields.komis, p.fields.przewodnik) : null);
      async function submit() {
        const p = parsedNow();
        if (!p || !p.valid) { say('Nieprawidłowy format kodu. Brak danych w kluczowych polach!'); return; }
        const r0 = reg(p); if (r0) { say(r0); return; }
        if (!(await confirmBox('Zapisać dokument?', p.display, 'Zapisz'))) return;
        save.disabled = true;
        try {
          const r = await api('mp_saveDocument', [{ productCode: code.value.trim() }]);
          finished(r, true);
          return;
        } catch (e) { say(failText(e)); }
        sync();
      }
      function sync() {
        const p = parsedNow();
        info.textContent = p ? `Komis ${p.fields.komis} · przewodnik ${p.fields.przewodnik} · ${p.fields.typ} · ${p.fields.nazwa} · rys. ${p.fields.rysunek} · id ${p.fields.id} · oper. ${p.fields.ilosc}` : '';
        info.style.borderColor = p && !p.valid ? '#c62828' : '#ccc';
        const r = reg(p);
        already.style.display = r ? '' : 'none'; already.textContent = r ? '✔ ' + r : '';
        if (r) { save.disabled = true; save.textContent = 'Już zarejestrowany'; } else setSave(save, 'Zapisz dokument', !!(p && p.valid));
      }
      section.append(info, already, save);
      return { sync, reset() {}, focus() { save.focus(); } };
    }

    // --- Kamera: obszar o regulowanej wysokości (skanowane jest tylko to, co widać), zoom, celownik z logo z czerwoną poświatą przy odczycie ---
    let prefs = loadPrefs();
    const video = h('video', { muted: true, playsinline: true, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transformOrigin: 'center' } });
    const overlay = h('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } });
    const reticle = h('div', { style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' } });
    const camBox = h('div', { style: { position: 'relative', overflow: 'hidden', background: '#000', height: prefs.height + 'px' } }, video, overlay, reticle);
    const handle = h('div', { title: 'Przeciągnij: wysokość obszaru wyświetlania i skanowania', style: { height: '12px', background: '#e0e0e0', cursor: 'ns-resize', display: 'flex', justifyContent: 'center', alignItems: 'center' } },
      h('div', { style: { width: '48px', height: '4px', background: '#999' } }));
    const camArea = h('div', { style: { display: 'none', marginBottom: '6px' } }, camBox, handle);
    const applyPrefs = () => {
      camBox.style.height = prefs.height + 'px';
      video.style.transform = `scale(${prefs.zoom})`;
      reticle.innerHTML = prefs.reticle ? SI.reticleSvg(prefs.size, false) : '';
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); const y0 = e.clientY, h0 = prefs.height;
      const mv = (ev) => { prefs.height = Math.max(160, Math.min(700, h0 + ev.clientY - y0)); camBox.style.height = prefs.height + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); savePrefs(prefs); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    function prefsDialog() {
      const row = (label, input) => h('label', { style: { display: 'block', margin: '6px 0', fontSize: '13px' } }, label, h('br'), input);
      const rng = (k, min, max, step) => { const i = h('input', { type: 'range', min, max, step, value: prefs[k], style: { width: '100%' } }); i.oninput = () => { prefs[k] = Number(i.value); applyPrefs(); savePrefs(prefs); lbl[k].textContent = i.value; }; return i; };
      const lbl = { height: h('b', {}, String(prefs.height)), zoom: h('b', {}, String(prefs.zoom)), size: h('b', {}, String(prefs.size)) };
      const chk = h('input', { type: 'checkbox', checked: prefs.reticle, onchange: () => { prefs.reticle = chk.checked; applyPrefs(); savePrefs(prefs); } });
      const m = modal('Ustawienia kamery', h('div', {},
        row(h('span', {}, 'Wysokość obszaru (wyświetlany = skanowany): ', lbl.height, ' px'), rng('height', 160, 700, 10)),
        row(h('span', {}, 'Zoom: ', lbl.zoom, '×'), rng('zoom', 1, 4, 0.1)),
        h('label', { style: { display: 'block', margin: '6px 0', fontSize: '13px' } }, chk, ' Celownik – przy kilku kodach w kadrze odczytuje kod pod celownikiem'),
        row(h('span', {}, 'Wielkość celownika: ', lbl.size, ' px'), rng('size', 30, 180, 5)),
        h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { prefs = { height: 300, zoom: 1, reticle: true, size: 70 }; applyPrefs(); savePrefs(prefs); m.close(); } }, 'Domyślne'),
          h('button', { class: 'btn primary', onclick: () => m.close() }, 'Gotowe'))));
    }
    async function toggleCamera() {
      if (stream) { stopCamera(); camArea.style.display = 'none'; camBtn.textContent = 'Skanuj kamerą'; return; }
      if (!('BarcodeDetector' in window)) { toast('Ta wersja nie obsługuje skanowania kamerą. Użyj skanera USB lub wpisz kod.', true); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (e) { toast('Brak dostępu do kamery.', true); return; }
      camArea.style.display = ''; applyPrefs();
      video.srcObject = stream; await video.play(); camBtn.textContent = 'Zatrzymaj kamerę';
      const detector = new BarcodeDetector();
      const ctx2 = overlay.getContext('2d');
      const loop = async () => {
        if (!stream) return;
        let picked = null;
        try {
          const W = camBox.clientWidth, H = camBox.clientHeight, vw = video.videoWidth || 1, vh = video.videoHeight || 1;
          // współrzędne kodu w obrazie kamery → na ekranie (object-fit: cover i zoom); tylko kody w całości widoczne
          const s = Math.max(W / vw, H / vh) * prefs.zoom, ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
          const found = (await detector.detect(video)).map((b) => ({ rawValue: b.rawValue, corners: (b.cornerPoints || []).map((p) => [p.x * s + ox, p.y * s + oy]) }))
            .filter((b) => b.rawValue && b.corners.length && b.corners.every(([x, y]) => x >= 0 && y >= 0 && x <= W && y <= H));
          picked = SI.pickCode(found, [W / 2, H / 2], prefs.reticle ? prefs.size : 0);
          overlay.width = W; overlay.height = H; ctx2.clearRect(0, 0, W, H);
          if (picked) {
            ctx2.beginPath(); picked.corners.forEach(([x, y], i) => (i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y))); ctx2.closePath();
            ctx2.fillStyle = 'rgba(0,200,83,0.33)'; ctx2.fill(); ctx2.lineWidth = 4; ctx2.strokeStyle = '#00c853'; ctx2.stroke();
            if (picked.rawValue.trim() !== code.value.trim() && picked.rawValue.trim() !== lastSaved) { accept(picked.rawValue); current.focus?.(); }
          }
        } catch (e) { /* kolejna próba */ }
        if (prefs.reticle) reticle.innerHTML = SI.reticleSvg(prefs.size, !!picked);
        camTimer = setTimeout(loop, 200);
      };
      loop();
    }

    kind = 'none';
    const panel = h('div', { class: 'panel', style: { maxWidth: '620px', margin: '12px auto' } },
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', marginBottom: '6px' } }, h('span', { class: 'muted', style: { flex: 1, fontSize: '12px' } }, 'Skaner USB działa jak klawiatura (kończy Enterem). Skaner sam rozpozna produkt, detal, operację albo dokument.'), camBtn, gearBtn),
      camArea, code, kindLabel, section, msg, infoArea);
    update();
    queueMicrotask(() => code.focus());
    return panel;
  }

  // ---------------------------------------------------------------- Lista detali (kolumna D w Setup)

  function listPanel() {
    const inputs = {
      komis: h('input', { type: 'text' }), rysunek: h('input', { type: 'text' }), pozycja: h('input', { type: 'text' }),
      komplet: h('input', { type: 'text' }), ilosc: h('input', { type: 'text', inputmode: 'numeric', style: { width: '90px' } }),
    };
    const msg = h('div', { style: { margin: '8px 0', whiteSpace: 'pre-wrap' } });
    const add = h('button', { class: 'btn primary', onclick: submit }, 'Dodaj do listy');
    const tableBox = h('div', {});
    let rows = [];
    const filter = h('input', { type: 'text', placeholder: 'Szukaj na liście…', style: { width: '240px' } });

    async function submit() {
      msg.className = ''; msg.style.color = ''; msg.textContent = '';
      const v = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
      if (!v.komis || !v.rysunek || !v.pozycja || !v.komplet) { msg.className = 'err'; msg.textContent = 'Uzupełnij komis, nr rysunku, nr pozycji i nr kompletu.'; return; }
      if (!parseOrdered(v.ilosc)) { msg.className = 'err'; msg.textContent = 'Ilość zlecona musi być liczbą całkowitą większą lub równą 1.'; return; }
      if (!(await confirmBox('Dodać detal do listy?', `Komis: ${v.komis}\nNr rysunku: ${v.rysunek}\nNr pozycji: ${v.pozycja}\nNr kompletu: ${v.komplet}\nIlość zlecona: ${v.ilosc}`, 'Dodaj'))) return;
      add.disabled = true;
      try {
        const r = await api('mp_addDetail', [v]);
        msg.style.color = '#1b5e20'; msg.textContent = (r && r.message) || 'Dodano.';
        Object.values(inputs).forEach((i) => { i.value = ''; }); inputs.komis.focus(); load();
      } catch (e) { msg.className = 'err'; msg.textContent = failText(e); }
      add.disabled = false;
    }
    const draw = () => {
      clear(tableBox);
      const shown = filterRows(rows, filter.value, ['komis', 'rysunek', 'pozycja', 'komplet']);
      tableBox.append(h('div', { class: 'row', style: { margin: '10px 0 6px' } }, h('strong', {}, `Lista detali (${shown.length})`), filter));
      tableBox.append(h('div', { class: 'table-wrap', style: { maxHeight: '45vh' } }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, ...['Wiersz', 'Komis', 'Nr rysunku', 'Nr pozycji', 'Nr kompletu', 'Ilość zlecona'].map((t) => h('th', {}, t)))),
        h('tbody', {}, shown.map((d) => h('tr', {}, ...[d.row, d.komis, d.rysunek, d.pozycja, d.komplet, d.ilosc].map((x) => h('td', {}, x))))))));
    };
    async function load() {
      try { rows = await api('mp_listDetails', []); draw(); } catch (e) { clear(tableBox); tableBox.append(h('p', { class: 'err' }, failText(e))); }
    }
    filter.addEventListener('input', draw);
    load();
    return h('div', { class: 'panel', style: { margin: '12px auto', maxWidth: '900px' } },
      h('p', { class: 'muted' }, 'Tworzenie listy detali: nowa pozycja trafia do zakładki „Lista detali” (kolumny B i D:G). Tych pozycji szukają później rejestry detali.'),
      h('div', { class: 'row' }, field('Komis', inputs.komis), field('Nr rysunku', inputs.rysunek), field('Nr pozycji', inputs.pozycja),
        field('Nr kompletu', inputs.komplet), field('Ilość zlecona', inputs.ilosc), add),
      msg, tableBox);
  }

  // ---------------------------------------------------------------- Dokumentacja: wykaz i usuwanie (kolumna E w Setup)

  function docsPanel() {
    const registry = h('div', {});
    let rows = [];
    const filter = h('input', { type: 'text', placeholder: 'Szukaj (komis, przewodnik, nazwa…)', style: { width: '280px' } });
    const drawRegistry = () => {
      clear(registry);
      const shown = filterRows(rows, filter.value, ['komis', 'przewodnik', 'typ', 'nazwa', 'rysunek', 'id', 'operator']);
      registry.append(h('div', { class: 'row', style: { margin: '10px 0 6px' } }, h('strong', {}, `Rejestr dokumentacji (${shown.length})`), filter,
        h('button', { class: 'btn small', onclick: loadRegistry }, 'Odśwież')));
      if (!shown.length) { registry.append(h('p', { class: 'muted' }, 'Brak wpisów.')); return; }
      registry.append(h('div', { class: 'table-wrap', style: { maxHeight: '60vh' } }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, ...['Data', 'Godz.', 'Komis', 'Przewodnik', 'Typ', 'Nazwa', 'Rysunek', 'Id', 'Oper.', 'Operator', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, shown.map((d) => h('tr', {}, ...[d.date, d.time, d.komis, d.przewodnik, d.typ, d.nazwa, d.rysunek, d.id, d.ilosc, d.operator].map((v) => h('td', {}, v)),
          h('td', {}, h('button', { class: 'btn small', onclick: () => removeDoc(d) }, 'Usuń'))))))));
    };
    async function loadRegistry() {
      try { rows = await api('mp_listDocuments', [{}]); drawRegistry(); } catch (e) { clear(registry); registry.append(h('p', { class: 'err' }, failText(e))); }
    }
    async function removeDoc(d) {
      if (!(await confirmBox('Usunąć wpis z rejestru?', `Komis: ${d.komis}\nPrzewodnik: ${d.przewodnik}\nTyp: ${d.typ}\nNazwa: ${d.nazwa}\nWiersz w bazie: ${d.row}\n\nWpis zostanie usunięty z bazy (nie można tego cofnąć w aplikacji).`, 'Usuń'))) return;
      try { const r = await api('mp_deleteDocument', [{ row: d.row, komis: d.komis, przewodnik: d.przewodnik }]); toast((r && r.message) || 'Usunięto.'); loadRegistry(); }
      catch (e) { toast(failText(e), true); }
    }
    filter.addEventListener('input', drawRegistry);
    loadRegistry();
    return h('div', { class: 'panel', style: { margin: '12px auto' } }, registry);
  }

  el.append(h('div', { class: 'screen-inner' }, modeBar, body));
  drawModes(); drawBody();

  apiCached('getProductCodes', [], (list) => { codes = (list || []).filter((c) => String(c).trim()); refreshScan(); })
    .catch((e) => toast('Nie wczytano listy kodów: ' + e.message, true));
  api('mp_getPermissions', []).then((p) => { perms = p || perms; drawModes(); refreshScan(); })
    .catch(() => { /* brak uprawnień rejestrów nie blokuje pobierania części; zapisy sprawdza serwer */ });

  return () => { clearTimeout(lockTimer); clearTimeout(camTimer); stopCamera(); };

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    clearTimeout(camTimer);
  }
}
