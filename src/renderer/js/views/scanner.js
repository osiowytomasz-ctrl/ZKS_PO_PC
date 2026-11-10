import { h, clear, field, api, apiCached, toast, alertBox, confirmBox, modal } from '../ui.js';
import { resolveCode, filterCodes, parseQuantity, LOCK_SECONDS } from '../logic/scanner.js';
import {
  OPER_STATUSES, classify, parseDetailCode, parseOperCode, parseDocCode, parsePieces, parseOrdered, operationsText, filterRows,
} from '../logic/registers.js';

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

  const failText = (e) => 'Błąd: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz, zanim spróbujesz ponownie.' : '');

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

  function scanPanel() {
    const code = h('input', { type: 'text', placeholder: 'Zeskanuj kod (lub wpisz)', autocomplete: 'off', spellcheck: 'false', style: { width: '100%' } });
    const kindLabel = h('div', { style: { margin: '4px 0', fontWeight: 600, color: '#1565c0', minHeight: '1.3em' } });
    const section = h('div', {});
    const video = h('video', { style: { width: '100%', maxHeight: '260px', background: '#000', display: 'none' }, muted: true, playsinline: true });
    const camBtn = h('button', { class: 'btn', onclick: toggleCamera }, 'Skanuj kamerą');
    const msg = h('div', { style: { margin: '8px 0', whiteSpace: 'pre-wrap' } });
    let current = { reset() {}, sync() {} };
    syncCurrent = () => current.sync();
    refreshScan = () => { kind = 'none'; update(); };

    const say = (text, ok) => { msg.className = ok ? '' : 'err'; msg.style.color = ok ? '#1b5e20' : ''; msg.textContent = text; };
    const parsedNow = () => ({ detail: parseDetailCode, operation: parseOperCode, document: parseDocCode })[kind]?.(code.value.trim());
    /** Po udanym zapisie: czyści kod i pola, komunikat i blokada przycisku zapisu. */
    const finished = (r, lock) => {
      say((r && r.message && String(r.message).trim()) || 'Zapisano.', true);
      code.value = ''; update(); code.focus();
      if (lock) startLock();
    };

    /** Rozpoznaje rodzaj kodu i przełącza sekcję; pola poprzedniego kodu są czyszczone przy zmianie rodzaju. */
    function update() {
      const next = classify(code.value, codes);
      kindLabel.textContent = KIND_LABELS[next] ? 'Rozpoznano: ' + KIND_LABELS[next] : '';
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
          else section.append(h('p', { class: 'muted' }, 'Zeskanuj kod: Skaner sam rozpozna produkt, detal, operację albo dokument.'));
        }
      }
      current.sync();
    }
    /** Nowy kod (Enter ze skanera USB, kamera): czyści pola poprzedniego i ustawia kod. */
    function accept(text) {
      say('', true);
      current.reset();
      const resolved = resolveCode(text, codes);
      code.value = resolved || text;
      update();
    }
    code.addEventListener('input', () => { say('', true); update(); });
    code.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      accept(code.value.trim());
      current.focus?.();
    });

    // --- Produkt: pobranie części (kod z listy, ilość, zapis do ZP) ---
    function productSection() {
      const qty = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Ilość', value: '1' });
      const sugg = h('div', { class: 'opts', style: { maxHeight: '180px', background: '#fff' } });
      const save = h('button', { class: 'btn primary', onclick: submit }, 'Zapisz');
      const redraw = () => {
        clear(sugg);
        const list = code.value.trim() && codes.includes(code.value.trim()) ? [] : filterCodes(code.value, codes);
        sugg.style.display = list.length ? '' : 'none';
        for (const s of list.slice(0, 500)) sugg.append(h('div', { style: { padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid #eee' }, onclick: () => { code.value = s; update(); qty.focus(); qty.select(); } }, s));
      };
      qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      async function submit() {
        say('', true);
        const resolved = resolveCode(code.value, codes);
        if (!code.value.trim()) { say('Podaj kod produktu.'); return; }
        if (!resolved) { say('Tego kodu nie ma na liście produktów.'); return; }
        const q = parseQuantity(qty.value);
        if (!q) { say('Nieprawidłowa ilość (musi być większa od zera).'); return; }
        if (!(await confirmBox('Potwierdzić pobranie?', `Kod: ${resolved}\nIlość: ${q}`, 'Zapisz'))) return;
        save.disabled = true;
        try {
          const r = await api('processForm', [{ productCode: resolved, quantity: q }]);
          qty.value = '1'; finished(r, true);
          return;
        } catch (e) { say(failText(e)); }
        sync();
      }
      const sync = () => { redraw(); setSave(save, 'Zapisz', true); };
      section.append(sugg, field('Ilość', qty), h('div', { class: 'row', style: { marginTop: '8px' } }, save));
      return { sync, reset() { qty.value = '1'; }, focus() { qty.focus(); qty.select(); } };
    }

    // --- Detal ---
    function detailSection() {
      const info = infoBox();
      const pieces = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'szt.', style: { width: '90px' } });
      const save = h('button', { class: 'btn primary', disabled: true, onclick: submit }, 'Zapisz detal');
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
        info.show(p);
        setSave(save, 'Zapisz detal', !!(p && p.valid));
      }
      section.append(info.el, field('Ilość sztuk', pieces), h('div', { class: 'row', style: { marginTop: '8px' } }, save));
      return { sync, reset() { pieces.value = ''; }, focus() { pieces.focus(); pieces.select(); } };
    }

    // --- Operacja ---
    function operationSection() {
      const info = infoBox();
      const notes = h('input', { type: 'text', placeholder: 'Uwagi', style: { width: '100%' } });
      const statusBtns = OPER_STATUSES.map((s) => h('button', { class: 'btn primary', disabled: true, 'data-status': s, onclick: () => saveStatus(s) }, s));
      const showBtn = h('button', { class: 'btn', disabled: true, onclick: showOperations }, 'Wyświetl oper.');
      const changeBtn = h('button', { class: 'btn', disabled: true, onclick: changeStatus }, 'Zmień status');
      const deleteBtn = h('button', { class: 'btn', disabled: true, onclick: removeOperation }, 'Usuń operację');
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
      async function showOperations() {
        const p = parsedNow();
        try {
          const list = await api('mp_displayOperations', [p.fields.komis, p.fields.przewodnik]);
          modal(`Operacje: komis ${p.fields.komis}, przewodnik ${p.fields.przewodnik}`, h('div', {}, operationsTable(list)), { wide: true });
        } catch (e) { fail(e); }
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
          if (!(await confirmBox(`Usunąć operację (wierszy: ${list.length})?`, `${operationsText(list)}\n\nWiersze dostaną status „Usunięta” (dane zostają w arkuszu).`, 'Usuń'))) return;
          finished(await api('mp_deleteOperation', [{ productCode: raw() }]));
        } catch (e) { fail(e); }
      }
      function sync() {
        const p = parsedNow();
        const ok = !!(p && p.valid);
        info.show(p);
        statusBtns.forEach((b) => setSave(b, b.dataset.status, ok));
        showBtn.disabled = !ok;
        changeBtn.disabled = !ok; deleteBtn.disabled = !ok;
      }
      // Zmiana statusu i usuwanie tylko dla uprawnionych (kolumna C w Setup); serwer i tak to sprawdza.
      section.append(info.el, notes, h('div', { class: 'row', style: { marginTop: '8px' } }, ...statusBtns),
        h('div', { class: 'row', style: { marginTop: '8px' } }, showBtn, perms.manage ? changeBtn : null, perms.manage ? deleteBtn : null));
      return { sync, reset() { notes.value = ''; }, focus() { notes.focus(); } };
    }

    // --- Dokument ---
    function documentSection() {
      const info = infoBox();
      const save = h('button', { class: 'btn primary', disabled: true, onclick: submit }, 'Zapisz dokument');
      async function submit() {
        const p = parsedNow();
        if (!p || !p.valid) { say('Nieprawidłowy format kodu. Brak danych w kluczowych polach!'); return; }
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
        info.show(p);
        setSave(save, 'Zapisz dokument', !!(p && p.valid));
      }
      section.append(info.el, h('div', { class: 'row', style: { marginTop: '8px' } }, save));
      return { sync, reset() {}, focus() { save.focus(); } };
    }

    // --- Kamera ---
    async function toggleCamera() {
      if (stream) { stopCamera(); return; }
      if (!('BarcodeDetector' in window)) { toast('Ta wersja nie obsługuje skanowania kamerą. Użyj skanera USB lub wpisz kod.', true); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e) { toast('Brak dostępu do kamery.', true); return; }
      video.srcObject = stream; video.style.display = 'block'; await video.play(); camBtn.textContent = 'Zatrzymaj kamerę';
      const detector = new BarcodeDetector();
      const loop = async () => {
        if (!stream) return;
        try {
          const found = await detector.detect(video);
          if (found.length) { const raw = found[0].rawValue; stopCamera(); accept(raw); current.focus?.(); return; }
        } catch (e) { /* kolejna próba */ }
        camTimer = setTimeout(loop, 250);
      };
      loop();
    }

    kind = 'none';
    const panel = h('div', { class: 'panel', style: { maxWidth: '620px', margin: '12px auto' } },
      h('p', { class: 'muted' }, 'Zeskanuj kod (skaner USB działa jak klawiatura i kończy Enterem) albo wpisz go. Skaner sam rozpozna, czy to produkt, detal, operacja czy dokument.'),
      code, kindLabel, video, section, msg,
      h('div', { class: 'row' }, camBtn));
    update();
    queueMicrotask(() => code.focus());
    return panel;
  }

  /** Pole z podglądem pól kodu; show(parsed) ustawia tekst i kolor ramki (czerwona, gdy brak wymaganych pól). */
  function infoBox() {
    const pre = h('pre', { style: { margin: '6px 0', padding: '6px 8px', background: '#f3f3f3', border: '1px solid #ccc', borderRadius: '6px', minHeight: '4.5em', whiteSpace: 'pre-wrap' } });
    return { el: pre, show(p) { pre.textContent = p ? p.display : ''; pre.style.borderColor = p && !p.valid ? '#c62828' : '#ccc'; } };
  }

  function operationsTable(list) {
    if (!list.length) return h('p', {}, 'Brak operacji.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, ...['Ope.', 'Komis', 'Ktk', 'Klient', 'Operator', 'St.'].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((o) => h('tr', {}, ...[o.nr, o.komis, o.przewodnik, o.klient, o.operator, o.status].map((v) => h('td', {}, v)))))));
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
      if (!(await confirmBox('Usunąć wpis z rejestru?', `Komis: ${d.komis}\nPrzewodnik: ${d.przewodnik}\nTyp: ${d.typ}\nNazwa: ${d.nazwa}\nWiersz w arkuszu: ${d.row}\n\nWpis zostanie wyczyszczony w arkuszu (nie można tego cofnąć w aplikacji).`, 'Usuń'))) return;
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
  }
}
