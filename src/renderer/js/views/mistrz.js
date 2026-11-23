// Mistrz PO – zakładki arkusza Mistrz_po w programie: te same kolumny i kolory co w pliku, ale dane z bazy Firebase,
// a kolumny liczone (formuły arkusza) liczy program (logic/mistrz.js). W bazie są tylko dane wpisywane.
// Okres przejściowy: wpisy dalej trafiają do arkusza (Skaner, ręcznie); „Import z arkusza” albo „Import z pliku” aktualizuje bazę.
// Dostęp: przeglądanie od CLERIK, import od MASTER (kolumna „Grafik dostęp”).
import { h, clear, toast, modal, columnFilterDialog } from '../ui.js';
import * as M from '../logic/mistrz.js';
import { visibleRows, filterOptions, sortRows } from '../logic/tableFilter.js';
import { loadMistrz, importFromSheet, importFromXlsx, loadMarks, setMark, detailKey } from '../mistrzStore.js';
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
  const st = { tab: lsGet('mp.tab', 'ops'), meta: null, data: {}, calc: {}, marks: new Map(), loaded: false, error: '', search: '', shown: PAGE, filters: {}, sorts: [] };
  const user = (ctx.user && ctx.user.email) || '';
  const body = h('div', { style: { flex: '1', minHeight: 0, overflow: 'auto', background: '#fff', border: '1px solid var(--border)' } });
  const info = h('span', { class: 'muted', style: { fontSize: '12px' } });
  const printSlot = h('span');
  const tabs = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } });
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
    if (kind === 'sheet') return go(() => importFromSheet(user));
    const input = h('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.remove(); if (f) go(async () => importFromXlsx(await f.arrayBuffer(), user)); });
    document.body.append(input); input.click();
  }

  function drawTabs() {
    clear(tabs);
    for (const sh of M.SHEETS) {
      const n = (st.data[sh.key] || []).length;
      tabs.append(h('button', { class: 'btn small' + (st.tab === sh.key ? ' primary' : ''), title: `Zakładka „${sh.name}” – ${n} wierszy`,
        onclick: () => { st.tab = sh.key; lsSet('mp.tab', sh.key); st.shown = PAGE; st.filters = {}; st.sorts = []; search.value = ''; st.search = ''; draw(); } }, `${sh.name} (${n})`));
    }
  }

  function draw() {
    drawTabs();
    clear(body); clear(printSlot);
    const m = st.meta;
    info.textContent = m ? `Baza: import ${new Date(m.importedAt).toLocaleString('pl-PL')}${m.importedBy ? ' · ' + m.importedBy : ''}${m.source ? ' · z ' + (m.source === 'plik' ? 'pliku .xlsx' : 'arkusza') : ''}` : '';
    if (st.error) { body.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Błąd bazy Mistrz PO: ' + st.error)); return; }
    if (!st.loaded) { body.append(h('p', { class: 'muted', style: { padding: '12px' } }, 'Wczytywanie…')); return; }
    if (!m) {
      body.append(h('div', { style: { padding: '14px' } }, h('p', {}, 'Danych Mistrz PO nie ma jeszcze w bazie.'),
        acc.manage ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => runImport('sheet') }, 'Import z arkusza'), h('button', { class: 'btn', onclick: () => runImport('file') }, 'Import z pliku .xlsx…'))
          : h('p', { class: 'muted' }, 'Import robi osoba z poziomem MASTER lub GOD.')));
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
      tbody.append(h('tr', {}, h('td', { style: { color: '#888', fontSize: '10px' } }, String(src[i].row)), ...cols.map((c) => {
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
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, h('b', {}, 'Mistrz'), search,
      acc.competence ? h('button', { class: 'btn small', title: 'Kompetencje, uprawnienia i dane pracowników', onclick: () => ctx.go('kompetencje') }, 'Kompetencje') : null,
      h('button', { class: 'btn small', title: 'Wczytaj ponownie dane z bazy', onclick: load }, 'Odśwież'),
      acc.manage ? h('button', { class: 'btn small', title: 'Dane wpisywane z arkusza Google Mistrz_po do bazy (zastępuje dane w bazie)', onclick: () => runImport('sheet') }, 'Import z arkusza') : null,
      acc.manage ? h('button', { class: 'btn small', title: 'Dane wpisywane z pobranego pliku .xlsx do bazy (zastępuje dane zakładek z pliku)', onclick: () => runImport('file') }, 'Import z pliku .xlsx…') : null,
      printSlot, h('span', { class: 'grow' }), info),
    tabs,
    h('div', { class: 'muted', style: { fontSize: '11px' } }, 'Kolumny ƒ liczy program z danych w bazie (jak formuły arkusza). Wpisy na razie robi się w arkuszu – potem import aktualizuje bazę.')),
    body);
  draw();
  load();
  return () => {};
}
