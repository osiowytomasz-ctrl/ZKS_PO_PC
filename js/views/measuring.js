// Narzędziownia → Pomiarowe: baza narzędzi pomiarowych z karty POM (kod w kolumnie C, interwał badań w kolumnie H) połączona z kartą „Badania 2026” (kod w kolumnie A, daty).
// Dane z arkusza trafiają do bazy Firebase (klucze „pom” i „badania”) raz, potem na życzenie (przycisk). Status badania = upływ czasu od ostatniego badania
// proporcjonalnie do indywidualnego interwału (H), w sześciu stopniach – kolory ze statusów w kolumnie L (wiersze 6–11) karty Badania 2026.
import { h, clear, api, toast, modal } from '../ui.js';
import { getSnapshot, putSnapshot } from '../snapStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { toolroomAccess, toolroomLevelOf } from '../logic/toolroomAccess.js';
import { colName } from '../logic/planGrid.js';
import * as M from '../logic/measuring.js';
import { sheetTable } from './sheetTable.js';

const when = (m) => new Date(m.updatedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const FALLBACK = ['#43a047', '#9ccc65', '#fdd835', '#fb8c00', '#e53935', '#8e0000'];   // gdy karta nie ma kolorów w L6:L11
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* bez pamięci */ } };

export function mountMeasuring(el, ctx) {
  const canStore = toolroomAccess(toolroomLevelOf(ctx.user)).manage;
  const st = { pom: null, bad: null, meta: null, unit: lsGet('zks.pom.unit', 'auto'), flip: lsGet('zks.pom.flip', '0') === '1', loading: false };
  const status = h('span', { class: 'muted' }), legendBox = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
  const legendColor = (i) => { const l = st.bad && st.bad.legend && st.bad.legend[i]; return l && l.bg && !/^#?fff(fff)?$/i.test(l.bg) ? { bg: l.bg, fg: l.fg || '#000', text: l.text } : { bg: FALLBACK[i], fg: '#000', text: l ? l.text : '' }; };
  const table = sheetTable({
    storageKey: 'pomiarowe', defaultVisible: 12, onRow: (r) => details(r),
    cellStyle: (r, c) => (c.key === 'status' && r.idx != null ? { background: legendColor(r.idx).bg, color: legendColor(r.idx).fg, fontWeight: 700 } : null),
  });
  const unitSel = h('select', { title: 'Jednostka interwału z kolumny H, gdy nie podano jej w komórce', onchange: () => { st.unit = unitSel.value; lsSet('zks.pom.unit', st.unit); build(); } },
    ...[['auto', 'Interwał H: auto (≤ 60 mies., więcej dni)'], ['months', 'Interwał H: miesiące'], ['days', 'Interwał H: dni']].map(([v, l]) => h('option', { value: v, selected: v === st.unit }, l)));
  const flipChk = h('input', { type: 'checkbox', checked: st.flip, onchange: () => { st.flip = flipChk.checked; lsSet('zks.pom.flip', st.flip ? '1' : '0'); build(); } });
  const refreshBtn = h('button', { class: 'btn', title: 'Połącz z kartami POM i Badania 2026 w arkuszu' + (canStore ? ' (zapis w bazie Firebase)' : ' (zapis w bazie – MASTER / GOD)'), onclick: () => refresh() }, 'Odśwież z arkusza (POM + Badania 2026)');

  function paintLegend() {
    clear(legendBox).append(h('span', { class: 'muted' }, 'Status (wykorzystanie interwału):'));
    const labels = ['< 50%', '50–70%', '70–85%', '85–100%', '100–115%', '> 115%'];
    for (let i = 0; i < 6; i++) { const c = legendColor(i); legendBox.append(h('span', { style: { background: c.bg, color: c.fg, padding: '1px 8px', border: '1px solid #000', fontSize: '11px' }, title: c.text || '' }, `${i + 1}: ${labels[st.flip ? 5 - i : i]}${c.text ? ' · ' + c.text : ''}`)); }
  }
  function build() {
    if (!st.pom) return;
    const recs = M.joinPom(st.pom.values, (st.bad && st.bad.values) || [], { unit: st.unit, flip: st.flip }), head = st.pom.values[0] || [];
    const cols = head.map((t, i) => ({ key: 'c' + i, idx: i, title: `${colName(i)} · ${String(t || '').trim() || 'kolumna ' + colName(i)}` }));
    // kolumny wyliczone zaraz za kodem (C), żeby były widoczne bez przewijania
    cols.splice(M.POM_CODE_COL + 1, 0, { key: 'status', title: 'Status' }, { key: 'last', title: 'Ostatnie badanie', isDate: true }, { key: 'next', title: 'Następne badanie', isDate: true }, { key: 'interval', title: 'Interwał (dni)' }, { key: 'used', title: 'Wykorzystano' });
    const get = (r, c) => c.key === 'last' ? M.dateText(r.last) : c.key === 'next' ? M.dateText(r.next) : c.key === 'interval' ? (r.interval ? String(Math.round(r.interval)) : '')
      : c.key === 'used' ? (r.used == null ? '' : Math.round(r.used * 100) + '%') : c.key === 'status' ? (r.idx == null ? (r.bad.length ? 'brak daty / interwału' : 'brak w Badania 2026') : `${r.idx + 1}${legendColor(r.idx).text ? ' · ' + legendColor(r.idx).text : ''}`) : String(r.pom[c.idx] ?? '');
    table.setData(cols, recs, get, { defaultVisible: 14 });
    paintLegend();
    status.textContent = st.meta ? `Baza Firebase: ${when(st.meta)}${st.meta.updatedBy ? ', ' + st.meta.updatedBy : ''} · narzędzi: ${recs.length}` : `Dane z arkusza (tylko na tym komputerze) · narzędzi: ${recs.length}`;
  }
  function details(r) {
    const head = st.bad && st.bad.values[0] || [], pomHead = st.pom.values[0] || [];
    const kv = (hd, row) => h('table', { class: 't', style: { width: '100%' } }, h('tbody', {}, ...row.map((v, i) => (String(v ?? '').trim() ? h('tr', {}, h('th', { class: 'left', style: { width: '30%' } }, `${colName(i)} · ${String(hd[i] || '').trim()}`), h('td', { class: 'left' }, String(v))) : null)).filter(Boolean)));
    const m = modal(`Narzędzie pomiarowe ${r.id}`, h('div', {}, h('b', {}, 'POM'), kv(pomHead, r.pom), h('b', { style: { display: 'block', marginTop: '8px' } }, `Badania 2026 (wierszy: ${r.bad.length})`),
      ...(r.bad.length ? r.bad.map((b) => kv(head, b)) : [h('div', { class: 'muted' }, 'Brak wiersza z tym kodem w kolumnie A karty Badania 2026.')]), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  }
  async function loadStored() {
    try {
      const [p, b] = await Promise.all([getSnapshot('pom'), getSnapshot('badania')]);
      if (!p || !p.data) return false;
      st.pom = p.data; st.bad = b && b.data; st.meta = p.meta; build(); return true;
    } catch (e) { status.textContent = 'Baza Firebase: ' + (e.code === 'permission-denied' ? 'brak dostępu (opublikuj reguły z snap_meta / snap_rows)' : e.message); return false; }
  }
  async function refresh() {
    if (st.loading) return; st.loading = true; refreshBtn.disabled = true; status.textContent = 'Czytanie kart POM i Badania 2026…';
    try {
      const [p, b] = await Promise.all([api('baseSheet', ['POM'], { timeoutMs: 300000 }), api('baseSheet', ['BADANIA'], { timeoutMs: 300000 })]);
      st.pom = { sheet: p.sheet, values: p.values || [] }; st.bad = { sheet: b.sheet, values: b.values || [], legend: b.legend || [] }; st.meta = null;
      if (canStore) {
        const user = (ctx.user && (ctx.user.name || ctx.user.email)) || '';
        st.meta = await putSnapshot('pom', st.pom, { user, info: `wierszy: ${st.pom.values.length}` });
        await putSnapshot('badania', st.bad, { user, info: `wierszy: ${st.bad.values.length}` });
        toast('Narzędzia pomiarowe zapisane w bazie Firebase');
      }
      build();
    } catch (e) { status.textContent = 'Błąd: ' + (/Nieznana funkcja|UNKNOWN_FN/i.test(e.message || '') ? 'w Apps Script brak funkcji baseSheet – dodaj Baza.gs i wpis w Api.gs, wdróż nową wersję.' : e.message); }
    st.loading = false; refreshBtn.disabled = false;
  }
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px'; el.style.height = '100%';
  el.append(h('div', { class: 'row panel', style: { flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, h('b', {}, 'Narzędzia pomiarowe – POM + Badania 2026'), h('span', { class: 'grow' }), unitSel,
    h('label', { class: 'row', style: { gap: '4px' }, title: 'Gdy kolor 1 w L6 oznacza najgorszy stan, a nie najlepszy' }, flipChk, 'odwróć kolejność kolorów'), status, refreshBtn), legendBox, table.el);
  paintLegend();
  loadStored().then((ok) => { if (!ok && canStore) refresh(); else if (!ok) status.textContent = 'Brak danych w bazie – poproś MASTER / GOD o pobranie z arkusza albo użyj przycisku (dane tylko lokalnie).'; });
}
