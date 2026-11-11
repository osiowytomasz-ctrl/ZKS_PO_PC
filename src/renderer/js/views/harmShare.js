// Udostępnianie Harmonogramu: JPG (dobra jakość), obraz do schowka, Excel, PDF i wydruk. Na początku wybierasz, co ma być w raporcie:
// kolumny, wiersze (jak na ekranie, wszystkie, gałąź zaznaczonej operacji), poziomy III/II/I, wykres (od – do, interwał), tytuł i stronę.
import { h, clear, modal, toast } from '../ui.js';
import { reportSvg, reportPagesHtml, reportXlsx, layout } from '../logic/harmReport.js';
import { toBase64 } from '../logic/xlsx.js';
import { INTERVALS, intervalOf, buildCells } from '../logic/harmAxis.js';
import { parseDateTime } from '../logic/harmImport.js';
import { fmtDt } from '../logic/harmModel.js';

const LS_KEY = 'zks.harm.share';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } };
const lsSet = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* brak pamięci przeglądarki */ } };
const fmtDay = (ms) => fmtDt(ms).slice(0, 10);
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

/** SVG → płótno → JPG/PNG (base64). Skala ograniczona do rozmiarów, które przeglądarka potrafi narysować. */
export async function svgToImage(svg, width, height, { scale = 2, type = 'image/jpeg', quality = 0.95 } = {}) {
  const s = Math.max(0.2, Math.min(scale, 32000 / width, 32000 / height, Math.sqrt(200e6 / (width * height))));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s); canvas.height = Math.round(height * s);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { base64: canvas.toDataURL(type, quality).split(',')[1], scale: s, width: canvas.width, height: canvas.height };
}

/**
 * Okno udostępniania. ctx = { cols, shownKeys, rowsScreen, rowsAll, selectedId, levelsHidden, val, cellOf(row, col), rowStyle(row), barsOf(row),
 *   holidays, interval, axisStart, maxEnd, nowMs }.
 */
export function shareDialog(ctx) {
  const saved = lsGet();
  const st = {
    format: saved.format || 'jpg', rows: 'screen', komis: ctx.komisShown !== false, levels: new Set([1, 2, 3].filter((l) => !ctx.levelsHidden.has(l))),
    cols: new Set(ctx.shownKeys), chart: saved.chart !== false, interval: ctx.interval, title: saved.title || 'Harmonogram',
    pageSize: saved.pageSize || 'A4', landscape: saved.landscape !== false, scale: saved.scale || 2,
  };
  const descendantsOf = (id) => ctx.rowsAll.filter((r) => { for (let p = r.parent; p != null; p = parentOf(p)) if (p === id) return true; return false; });
  const parentOf = (id) => { const r = ctx.rowsAll.find((x) => x.id === id); return r ? r.parent : null; };
  const fromI = h('input', { type: 'text', value: fmtDay(ctx.axisStart), style: { width: '100px', padding: '3px' } });
  // domyślny zakres osi: od początku osi na ekranie, najwyżej 30 dni (czytelny raport); dalszy zakres wpisujesz ręcznie
  const toI = h('input', { type: 'text', value: fmtDay(Math.min(ctx.maxEnd, ctx.axisStart + 30 * 86400000)), style: { width: '100px', padding: '3px' } });
  const titleI = h('input', { type: 'text', value: st.title, style: { width: '320px', padding: '3px' }, oninput: () => { st.title = titleI.value; } });
  const info = h('div', { class: 'muted', style: { whiteSpace: 'pre-wrap', margin: '6px 0' } });

  // --- wybór wierszy, kolumn i osi → model raportu
  function pickRows() {
    const sel = ctx.selectedId, komisSel = sel && sel.startsWith('K:') ? sel.slice(2) : null;   // zaznaczony pasek komisu: cały komis
    const inBranch = (r) => r.id === sel || (komisSel != null ? String(r.komis || '').trim() === komisSel : descendantsOf(sel).includes(r));
    let rows = st.rows === 'all' ? ctx.rowsAll : st.rows === 'branch' && sel ? ctx.rowsAll.filter(inBranch) : ctx.rowsScreen;
    return rows.filter((r) => (r.komisRow ? st.komis : st.levels.has(r.level || 1)));
  }
  function buildModel() {
    const cols = ctx.cols.filter((c) => st.cols.has(c.key));
    const rows = pickRows();
    let chart = null;
    if (st.chart) {
      const from = parseDateTime(fromI.value.trim()), to = parseDateTime(toI.value.trim());
      if (from == null || to == null || to <= from) throw new Error('Wykres: wpisz poprawny zakres dat od – do (np. 10.11.2026 – 31.12.2026)');
      const iv = intervalOf(st.interval);
      const cells = buildCells(from, to + 86400000, st.interval, ctx.holidays).filter((c) => c.start < to + 86400000);
      chart = { cells, cellW: 18, nominalHours: iv.hours, nowMs: ctx.nowMs };
    }
    const sub = [`Wygenerowano: ${fmtDt(Date.now() - new Date().getTimezoneOffset() * 60000)}`, `wierszy: ${rows.length}`,
      st.chart ? `oś: ${fromI.value} – ${toI.value}, interwał ${intervalOf(st.interval).label}` : '', `poziomy: ${[3, 2, 1].filter((l) => st.levels.has(l)).map((l) => ['', 'I', 'II', 'III'][l]).join(', ')}`, st.komis ? 'z podsumowaniem komisów' : ''].filter(Boolean).join('   ·   ');
    return {
      title: st.title.trim(), subtitle: sub, font: 11, rowH: 22, chart,
      columns: cols.map((c) => ({ key: c.key, title: c.title, w: c.isDate ? 104 : c.key === 'element' ? 260 : Math.max(c.w, 34), vertical: !!c.vertical })),
      rows: rows.map((r) => ({ ...ctx.rowStyle(r), cells: cols.map((c) => ctx.cellOf(r, c)), ...ctx.barsOf(r) })),
    };
  }
  function refreshInfo() {
    try {
      const m = buildModel(), L = layout(m);
      const big = L.width * L.height > 60e6;
      info.className = 'muted';
      const paged = st.format === 'pdf' || st.format === 'print';
      const pageScale = paged ? reportPagesHtml(m, { pageSize: st.pageSize, landscape: st.landscape }) : null;
      info.textContent = `Wierszy: ${m.rows.length}, kolumn tabeli: ${m.columns.length}${m.chart ? `, kolumn osi: ${m.chart.cells.length}` : ''}. Rozmiar obrazu: ${L.width} × ${L.height} px`
        + (pageScale ? `\nStrony: ${pageScale.pages}, skala na stronie: ${Math.round(pageScale.scale * 100)}%` + (pageScale.scale < 0.55 ? ' – mało czytelne: zawęź zakres dat, wybierz dłuższy interwał, mniej kolumn albo A3' : '') : '')
        + (big ? '\nUwaga: bardzo duży raport – zawęź zakres dat, wybierz dłuższy interwał albo mniej wierszy.' : '');
    } catch (e) { info.className = 'err'; info.textContent = e.message; }
  }

  // --- elementy okna
  const radio = (name, value, label, cur, onchange, disabled) => h('label', { style: { marginRight: '12px', opacity: disabled ? 0.5 : 1 } },
    h('input', { type: 'radio', name, checked: cur === value, disabled, onchange: () => { onchange(value); refreshInfo(); renderParts(); } }), ' ' + label);
  const fmtBox = h('div', {}), rowBox = h('div', {}), lvlBox = h('div', {}), colBox = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px 14px', maxHeight: '140px', overflow: 'auto', border: '1px solid #ddd', padding: '4px' } });
  const pageBox = h('div', {}), imgBox = h('div', {});
  const intervalSel = h('select', { onchange: () => { st.interval = intervalSel.value; refreshInfo(); } }, ...INTERVALS.map((i) => h('option', { value: i.id }, i.label)));
  intervalSel.value = st.interval;
  const chartCb = h('input', { type: 'checkbox', checked: st.chart, onchange: () => { st.chart = chartCb.checked; refreshInfo(); } });
  fromI.addEventListener('change', refreshInfo); toI.addEventListener('change', refreshInfo);
  function renderParts() {
    clear(fmtBox); clear(rowBox); clear(lvlBox); clear(colBox); clear(pageBox); clear(imgBox);
    fmtBox.append(...[['jpg', 'JPG (dobra jakość)'], ['clip', 'Obraz do schowka'], ['xlsx', 'Excel'], ['pdf', 'PDF'], ['print', 'Wydruk']].map(([v, l]) => radio('fmt', v, l, st.format, (x) => { st.format = x; })));
    rowBox.append(radio('rows', 'screen', 'Jak na ekranie (filtry, zwinięte)', st.rows, (x) => { st.rows = x; }),
      radio('rows', 'all', 'Wszystkie operacje', st.rows, (x) => { st.rows = x; }),
      radio('rows', 'branch', ctx.selectedId ? (ctx.selectedId.startsWith('K:') ? `Zaznaczony komis ${ctx.selectedId.slice(2)} (wszystkie jego operacje)` : `Zaznaczona operacja ${ctx.selectedId} z gałęzią`) : 'Zaznaczona operacja z gałęzią (zaznacz linię)', st.rows, (x) => { st.rows = x; }, !ctx.selectedId));
    lvlBox.append(...[[3, 'III'], [2, 'II'], [1, 'I']].map(([l, name]) => h('label', { style: { marginRight: '12px' } },
      h('input', { type: 'checkbox', checked: st.levels.has(l), onchange: (e) => { if (e.target.checked) st.levels.add(l); else st.levels.delete(l); refreshInfo(); } }), ' ' + name)));
    lvlBox.append(h('label', { style: { marginLeft: '12px' } }, h('input', { type: 'checkbox', checked: st.komis, onchange: (e) => { st.komis = e.target.checked; refreshInfo(); } }), ' Podsumowanie komisów'));
    for (const c of ctx.cols) colBox.append(h('label', {}, h('input', { type: 'checkbox', checked: st.cols.has(c.key), onchange: (e) => { if (e.target.checked) st.cols.add(c.key); else st.cols.delete(c.key); refreshInfo(); } }), ` ${c.title} (${c.letter})`));
    const paged = st.format === 'pdf' || st.format === 'print';
    pageBox.style.display = paged ? '' : 'none';
    pageBox.append('Strona: ', ...['A4', 'A3'].map((p) => radio('ps', p, p, st.pageSize, (x) => { st.pageSize = x; })),
      radio('or', 'l', 'poziomo', st.landscape ? 'l' : 'p', () => { st.landscape = true; }), radio('or', 'p', 'pionowo', st.landscape ? 'l' : 'p', () => { st.landscape = false; }),
      h('span', { class: 'muted' }, 'Raport jest dopasowany do szerokości strony; wiersze dzielą się na strony, nagłówek powtarza się na każdej.'));
    imgBox.style.display = st.format === 'jpg' || st.format === 'clip' ? '' : 'none';
    imgBox.append('Jakość obrazu: ', ...[[1, 'standard (1×)'], [2, 'dobra (2×)'], [3, 'bardzo dobra (3×)']].map(([v, l]) => radio('sc', v, l, st.scale, (x) => { st.scale = x; })));
  }
  renderParts();
  const colQuick = h('div', { class: 'row', style: { gap: '6px', margin: '4px 0' } },
    h('button', { class: 'btn small', onclick: () => { st.cols = new Set(ctx.shownKeys); renderParts(); refreshInfo(); } }, 'Jak na ekranie'),
    h('button', { class: 'btn small', onclick: () => { st.cols = new Set(ctx.cols.map((c) => c.key)); renderParts(); refreshInfo(); } }, 'Wszystkie'),
    h('button', { class: 'btn small', onclick: () => { st.cols = new Set(['lp']); renderParts(); refreshInfo(); } }, 'Tylko lp.'));
  const section = (t, ...kids) => h('div', { style: { margin: '8px 0' } }, h('b', {}, t), h('div', { style: { marginTop: '3px' } }, ...kids));

  const go = h('button', { class: 'btn primary', onclick: async () => {
    let model;
    try { model = buildModel(); } catch (e) { toast(e.message); return; }
    if (!model.rows.length) { toast('Brak wierszy do pokazania (sprawdź wiersze i poziomy)'); return; }
    lsSet({ format: st.format, chart: st.chart, title: st.title, pageSize: st.pageSize, landscape: st.landscape, scale: st.scale });
    const base = `harmonogram_${stamp()}`;
    go.disabled = true; go.textContent = 'Przygotowuję…';
    try {
      if (st.format === 'xlsx') {
        const ok = await window.zks.saveFile(base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', toBase64(reportXlsx(model)));
        if (ok) toast('Zapisano plik Excel');
      } else if (st.format === 'pdf' || st.format === 'print') {
        const { html, pages } = reportPagesHtml(model, { pageSize: st.pageSize, landscape: st.landscape });
        const ok = st.format === 'pdf' ? await window.zks.savePdf(html, { name: base + '.pdf', pageSize: st.pageSize, landscape: st.landscape }) : await window.zks.printReport(html, { pageSize: st.pageSize, landscape: st.landscape });
        if (ok) toast(st.format === 'pdf' ? `Zapisano PDF (stron: ${pages})` : 'Wysłano do drukarki');
      } else {
        const { svg, width, height } = reportSvg(model);
        const img = await svgToImage(svg, width, height, { scale: st.scale, type: st.format === 'clip' ? 'image/png' : 'image/jpeg', quality: 0.95 });
        const note = img.scale < st.scale ? ` (zmniejszono do ${img.scale.toFixed(2)}× – raport jest bardzo duży)` : '';
        if (st.format === 'clip') { await window.zks.copyImage(img.base64); toast('Skopiowano obraz do schowka' + note); }
        else if (await window.zks.saveFile(base + '.jpg', 'image/jpeg', img.base64)) toast(`Zapisano JPG ${img.width} × ${img.height}` + note);
      }
      m.close();
    } catch (e) { toast('Nie udało się: ' + (e.message || e)); }
    finally { go.disabled = false; go.textContent = 'Udostępnij'; }
  } }, 'Udostępnij');

  const m = modal('Udostępnij harmonogram', h('div', {},
    section('Format', fmtBox),
    section('Tytuł raportu', titleI),
    section('Wiersze', rowBox),
    section('Poziomy', lvlBox),
    section('Kolumny', colQuick, colBox),
    section('Wykres', h('label', {}, chartCb, ' pokaż wykres'), h('span', { style: { marginLeft: '14px' } }, 'od '), fromI, ' do ', toI, h('span', { style: { marginLeft: '14px' } }, 'interwał '), intervalSel),
    pageBox, imgBox, info,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), go)), { wide: true });
  m.root.style.width = 'min(900px, 96vw)'; m.root.style.maxWidth = '96vw';
  refreshInfo();
}
