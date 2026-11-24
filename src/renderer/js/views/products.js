// Narzędziownia → Produkty: baza produktów z karty PSWT arkusza. Dane czytane z arkusza raz i zapisane w bazie Firebase (snap_meta / snap_rows, klucz „pswt”),
// potem odświeżane na życzenie przyciskiem „Odśwież z arkusza PSWT” (zapis w bazie: MASTER / GOD). Wszystkie kolumny karty, nagłówki z wiersza 1.
import { h, clear, api, toast } from '../ui.js';
import { getSnapshot, putSnapshot } from '../snapStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { toolroomAccess, toolroomLevelOf } from '../logic/toolroomAccess.js';
import { colName } from '../logic/planGrid.js';
import { sheetTable } from './sheetTable.js';

const when = (m) => new Date(m.updatedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function mountProducts(el, ctx) {
  const canStore = toolroomAccess(toolroomLevelOf(ctx.user)).manage;
  const table = sheetTable({ storageKey: 'products', defaultVisible: 14 });
  const status = h('span', { class: 'muted' });
  const refreshBtn = h('button', { class: 'btn', title: 'Połącz z kartą PSWT w arkuszu i pobierz aktualne dane' + (canStore ? ' (zapis w bazie Firebase)' : ' (zapis w bazie – MASTER / GOD)'), onclick: () => refresh() }, 'Odśwież z arkusza PSWT');
  let loading = false;

  function show(data, meta) {
    const headers = data.headers || [], BLANK = { 0: 'Nr', 1: 'Kod produktu' };   // kolumny A i B karty PSWT nie mają nagłówka
    const clean = (t) => String(t || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();   // nagłówki z zawijaniem wierszy
    const cols = headers.map((t, i) => ({ key: String(i), idx: i, title: `${colName(i)} · ${clean(t) || BLANK[i] || 'kolumna ' + colName(i)}` }));
    table.setData(cols, data.rows || [], (r, c) => String(r[c.idx] ?? '').replace(/\r\n?/g, '\n'), { defaultVisible: cols.length });   // wszystkie kolumny karty (A–AU i dalej) widoczne od razu
    status.textContent = meta ? `Baza Firebase: ${when(meta)}${meta.updatedBy ? ', ' + meta.updatedBy : ''} · ${meta.info || ''}` : `Dane z arkusza (tylko na tym komputerze) · produktów: ${(data.rows || []).length}, kolumn: ${headers.length} (A–${colName(headers.length - 1)})`;
  }
  async function loadStored() {
    try { const snap = await getSnapshot('pswt'); if (snap && snap.data) { show(snap.data, snap.meta); return true; } } catch (e) { status.textContent = 'Baza Firebase: ' + (e.code === 'permission-denied' ? 'brak dostępu (opublikuj reguły z snap_meta / snap_rows)' : e.message); }
    return false;
  }
  async function refresh() {
    if (loading) return; loading = true; refreshBtn.disabled = true; status.textContent = 'Czytanie karty PSWT… (to może potrwać)';
    try {
      const d = await api('baseSheet', ['PSWT'], { timeoutMs: 300000 }), v = d.values || [];
      const data = { sheet: d.sheet, headers: (v[0] || []).map(String), rows: v.slice(1) };
      if (canStore) {
        const meta = await putSnapshot('pswt', data, { user: (ctx.user && (ctx.user.name || ctx.user.email)) || '', info: `produktów: ${data.rows.length}, kolumn: ${data.headers.length}` });
        show(data, meta); toast('Produkty zapisane w bazie Firebase');
      } else show(data, null);
    } catch (e) { status.textContent = 'Błąd: ' + (/Nieznana funkcja|UNKNOWN_FN/i.test(e.message || '') ? 'w Apps Script brak funkcji baseSheet – dodaj Baza.gs i wpis w Api.gs, wdróż nową wersję.' : e.message); }
    loading = false; refreshBtn.disabled = false;
  }
  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px'; el.style.height = '100%';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'Produkty – karta PSWT'), h('span', { class: 'grow' }), status, refreshBtn), table.el);
  loadStored().then((ok) => { if (!ok && canStore) refresh(); else if (!ok) status.textContent = 'Brak danych w bazie – poproś MASTER / GOD o pobranie z arkusza albo użyj przycisku (dane tylko lokalnie).'; });
}
