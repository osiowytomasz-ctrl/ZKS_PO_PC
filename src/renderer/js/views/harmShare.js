// Udostępnianie Harmonogramu: JPG (dobra jakość), obraz do schowka, Excel, PDF i wydruk. Na początku wybierasz, co ma być w raporcie:
// kolumny, wiersze (jak na ekranie, wszystkie, gałąź zaznaczonej operacji), poziomy III/II/I, wykres (od – do, interwał), tytuł i stronę.
import { h, clear, modal, toast } from '../ui.js';
import { reportSvg, reportPagesHtml, reportXlsx, reportHtml, layout, pagePlan } from '../logic/harmReport.js';
import { toBase64 } from '../logic/xlsx.js';
import { INTERVALS, intervalOf, buildCells } from '../logic/harmAxis.js';
import { parseDateTime } from '../logic/harmImport.js';
import { fmtDt } from '../logic/harmModel.js';
import { calendarButton } from './datePicker.js';

const LS_KEY = 'zks.harm.share';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } };
const lsSet = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* brak pamięci przeglądarki */ } };
const fmtDay = (ms) => fmtDt(ms).slice(0, 10);
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

/** Logo programu (img/logo.png) zmniejszone do 128 px jako data URI – do nagłówka raportu. Raz na sesję. */
let logoCache = null;
export function loadLogo() {
  if (!logoCache) logoCache = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = 128; c.height = 128; c.getContext('2d').drawImage(img, 0, 0, 128, 128); resolve(c.toDataURL('image/png')); } catch { resolve(null); } };
    img.onerror = () => resolve(null);
    img.src = 'img/logo.png';
  });
  return logoCache;
}

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
    inRange: saved.inRange !== false,
    // strona PDF/wydruku: dopasowanie, skala własna [%], wyrównanie w poziomie, margines [mm]
    fit: saved.fit || 'width', scalePct: saved.scalePct || 100, align: saved.align || 'center', marginMm: saved.marginMm ?? 10,
    openAfter: saved.openAfter !== false,   // otwórz gotowy dokument po zapisaniu   // wiersze tylko z operacjami trwającymi w zakresie dat
    // nagłówek firmowy (zapamiętany na tym komputerze); osoba udostępniająca = zalogowany użytkownik
    brand: saved.brand !== false, company: saved.company ?? 'ZKS Ferrum', dept: saved.dept ?? 'Wydział Obróbki Mechanicznej',
    program: saved.program ?? 'ZKS PO – Harmonogram produkcji', owner: saved.owner ?? '', sharer: ctx.user || '',
  };
  let logo = null;   // logo programu jako obraz w raporcie (data URI, 128 px)
  loadLogo().then((d) => { logo = d; schedule(); });
  const descendantsOf = (id) => ctx.rowsAll.filter((r) => { for (let p = r.parent; p != null; p = parentOf(p)) if (p === id) return true; return false; });
  const parentOf = (id) => { const r = ctx.rowsAll.find((x) => x.id === id); return r ? r.parent : null; };
  const fromI = h('input', { type: 'text', value: fmtDay(ctx.axisStart), style: { width: '100px', padding: '3px' } });
  // domyślny zakres osi: od początku osi na ekranie, najwyżej 30 dni (czytelny raport); dalszy zakres wpisujesz ręcznie
  const toI = h('input', { type: 'text', value: fmtDay(Math.min(ctx.maxEnd, ctx.axisStart + 30 * 86400000)), style: { width: '100px', padding: '3px' } });
  const titleI = h('input', { type: 'text', value: st.title, style: { width: '320px', padding: '3px' }, oninput: () => { st.title = titleI.value; schedule(); } });
  const info = h('div', { class: 'muted', style: { whiteSpace: 'pre-wrap', margin: '6px 0' } });

  const pageOpts = () => ({ pageSize: st.pageSize, landscape: st.landscape, fit: st.fit, scalePct: st.scalePct, align: st.align, marginMm: st.marginMm });

  // --- wybór wierszy, kolumn i osi → model raportu
  function pickRows() {
    const sel = ctx.selectedId, komisSel = sel && sel.startsWith('K:') ? sel.slice(2) : null;   // zaznaczony pasek komisu: cały komis
    const inBranch = (r) => r.id === sel || (komisSel != null ? String(r.komis || '').trim() === komisSel : descendantsOf(sel).includes(r));
    let rows = st.rows === 'all' ? ctx.rowsAll : st.rows === 'branch' && sel ? ctx.rowsAll.filter(inBranch) : ctx.rowsScreen;
    return rows.filter((r) => (r.komisRow ? st.komis : st.levels.has(r.level || 1)));
  }
  function buildModel() {
    const cols = ctx.cols.filter((c) => st.cols.has(c.key));
    let rows = pickRows();
    let chart = null;
    const useRange = st.chart || st.inRange;
    const from = useRange ? parseDateTime(fromI.value.trim()) : null, to = useRange ? parseDateTime(toI.value.trim()) : null;
    if (useRange && (from == null || to == null || to < from)) throw new Error('Zakres dat: wpisz poprawne daty od – do (np. 10.11.2026 – 31.12.2026)');
    // tylko operacje, które w zakresie trwają (zaczęły się przed końcem i kończą po początku); bez terminów – pomijane
    if (st.inRange) rows = rows.filter((r) => { const b = ctx.barsOf(r), span = b.frame || b.bars[0]; return span && span.start < to + 86400000 && span.end > from; });
    if (st.chart) {
      const iv = intervalOf(st.interval);
      const cells = buildCells(from, to + 86400000, st.interval, ctx.holidays).filter((c) => c.start < to + 86400000);
      chart = { cells, cellW: 18, nominalHours: iv.hours, nowMs: ctx.nowMs };
    }
    const now = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const brand = st.brand ? { logo, company: st.company.trim(), dept: st.dept.trim(), sharer: st.sharer.trim() ? 'Udostępnił: ' + st.sharer.trim() : '',
      program: st.program.trim() + (ctx.version ? ` · wersja ${ctx.version} (PC)` : ''), owner: st.owner.trim() ? 'Twórca programu: ' + st.owner.trim() : '', date: `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}` } : null;
    const stampText = `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
    return {
      // tytuł z datą („Harmonogram z dnia: 12.11.2026 12:12”); bez linii podsumowania pod tytułem
      title: st.title.trim() ? `${st.title.trim()} z dnia: ${stampText}` : '', subtitle: '', font: 11, rowH: 22, chart, brand,
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
      const pageScale = paged ? pagePlan(m, pageOpts()) : null;
      info.textContent = `Wierszy: ${m.rows.length}, kolumn tabeli: ${m.columns.length}${m.chart ? `, kolumn osi: ${m.chart.cells.length}` : ''}. Rozmiar obrazu: ${L.width} × ${L.height} px`
        + (pageScale ? `\nStrony: ${pageScale.pages}, skala na stronie: ${Math.round(pageScale.scale * 100)}%` + (pageScale.overflow ? ' – raport szerszy niż strona, prawa część zostanie ucięta (zmniejsz skalę albo wybierz dopasowanie)' : '') + (pageScale.scale < 0.55 ? ' – mało czytelne: zawęź zakres dat, wybierz dłuższy interwał, mniej kolumn albo A3' : '') : '')
        + (big ? '\nUwaga: bardzo duży raport – zawęź zakres dat, wybierz dłuższy interwał albo mniej wierszy.' : '');
      renderPreview(m);
    } catch (e) { info.className = 'err'; info.textContent = e.message; clear(preview); }
  }
  // podgląd na żywo: pierwsze wiersze raportu (PDF/wydruk: pierwsza strona), dopasowany do szerokości okna
  const preview = h('div', { style: { border: '1px solid #ccc', background: '#fff', maxHeight: '64vh', overflow: 'auto', margin: '6px 0' } });
  function renderPreview(m) {
    const paged = st.format === 'pdf' || st.format === 'print';
    const P = paged ? pagePlan(m, pageOpts()) : null;
    const n = paged ? P.perPage : 40;
    const { svg } = reportSvg(m, { from: 0, to: Math.min(m.rows.length, n), page: paged ? `Strona 1 z ${P.pages}` : '' });
    if (paged) {
      // cała strona (format, marginesy), raport dopasowany do szerokości i wyśrodkowany – jak w PDF i na wydruku
      const pct = (v) => (v / P.pw * 100).toFixed(3) + '%';
      // strona z marginesami (przerywana linia), raport w miejscu i skali jak w PDF
      preview.innerHTML = `<div style="background:#8a8a8a;padding:14px"><div style="position:relative;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4);aspect-ratio:${P.pw}/${P.ph};overflow:hidden">`
        + `<div style="position:absolute;left:${pct(P.margin)};right:${pct(P.margin)};top:${(P.margin / P.ph * 100).toFixed(3)}%;bottom:${(P.margin / P.ph * 100).toFixed(3)}%;outline:1px dashed #bbb"></div>`
        + svg.replace('<svg ', `<svg style="position:absolute;left:${pct(P.left)};top:${(P.margin / P.ph * 100).toFixed(3)}%;width:${pct(P.width * P.scale)};height:auto" `) + '</div></div>';
      return;
    }
    preview.innerHTML = svg.replace('<svg ', '<svg style="width:100%;height:auto;display:block" ');
    if (m.rows.length > n) preview.append(h('div', { class: 'muted', style: { padding: '4px 8px', fontSize: '12px' } }, `Podgląd: ${n} z ${m.rows.length} wierszy${paged ? ' (pierwsza strona)' : ''}.`));
  }
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refreshInfo, 200); };

  // --- elementy okna
  const radio = (name, value, label, cur, onchange, disabled) => h('label', { style: { marginRight: '12px', opacity: disabled ? 0.5 : 1 } },
    h('input', { type: 'radio', name, checked: cur === value, disabled, onchange: () => { onchange(value); refreshInfo(); renderParts(); } }), ' ' + label);
  const fmtBox = h('div', {}), rowBox = h('div', {}), lvlBox = h('div', {}), colBox = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px 14px', maxHeight: '140px', overflow: 'auto', border: '1px solid #ddd', padding: '4px' } });
  const pageBox = h('div', {}), imgBox = h('div', {});
  const intervalSel = h('select', { onchange: () => { st.interval = intervalSel.value; refreshInfo(); } }, ...INTERVALS.map((i) => h('option', { value: i.id }, i.label)));
  intervalSel.value = st.interval;
  const chartCb = h('input', { type: 'checkbox', checked: st.chart, onchange: () => { st.chart = chartCb.checked; refreshInfo(); } });
  fromI.addEventListener('change', refreshInfo); toI.addEventListener('change', refreshInfo); fromI.addEventListener('input', schedule); toI.addEventListener('input', schedule);
  const openCb = h('input', { type: 'checkbox', checked: st.openAfter, onchange: () => { st.openAfter = openCb.checked; } });
  const inRangeCb = h('input', { type: 'checkbox', checked: st.inRange, onchange: () => { st.inRange = inRangeCb.checked; refreshInfo(); } });
  // pola nagłówka firmowego
  const brandCb = h('input', { type: 'checkbox', checked: st.brand, onchange: () => { st.brand = brandCb.checked; brandFields.style.display = st.brand ? '' : 'none'; refreshInfo(); } });
  const bf = (key, label, ph, w = '200px') => { const i = h('input', { type: 'text', value: st[key], placeholder: ph, style: { width: w, padding: '3px' }, oninput: () => { st[key] = i.value; schedule(); } }); return h('label', { style: { display: 'inline-flex', flexDirection: 'column', fontSize: '12px', marginRight: '10px' } }, label, i); };
  const brandFields = h('div', { style: { display: st.brand ? '' : 'none', marginTop: '4px' } },
    bf('company', 'Firma', 'ZKS Ferrum'), bf('dept', 'Wydział', 'Wydział Obróbki Mechanicznej'), bf('sharer', 'Udostępnia', 'imię i nazwisko'),
    bf('program', 'Program', 'nazwa programu'), bf('owner', 'Twórca programu', 'imię i nazwisko'));
  function renderParts() {
    clear(fmtBox); clear(rowBox); clear(lvlBox); clear(colBox); clear(pageBox); clear(imgBox);
    fmtBox.append(...[['jpg', 'JPG (dobra jakość)'], ['clip', 'Obraz do schowka'], ['xlsx', 'Excel'], ['html', 'HTML (przeglądarka)'], ['pdf', 'PDF'], ['print', 'Wydruk']].map(([v, l]) => radio('fmt', v, l, st.format, (x) => { st.format = x; })));
    rowBox.append(radio('rows', 'screen', 'Jak na ekranie (filtry, zwinięte)', st.rows, (x) => { st.rows = x; }),
      radio('rows', 'all', 'Wszystkie operacje', st.rows, (x) => { st.rows = x; }),
      radio('rows', 'branch', ctx.selectedId ? (ctx.selectedId.startsWith('K:') ? `Zaznaczony komis ${ctx.selectedId.slice(2)} (wszystkie jego operacje)` : `Zaznaczona operacja ${ctx.selectedId} z gałęzią`) : 'Zaznaczona operacja z gałęzią (zaznacz linię)', st.rows, (x) => { st.rows = x; }, !ctx.selectedId));
    lvlBox.append(...[[3, 'III'], [2, 'II'], [1, 'I']].map(([l, name]) => h('label', { style: { marginRight: '12px' } },
      h('input', { type: 'checkbox', checked: st.levels.has(l), onchange: (e) => { if (e.target.checked) st.levels.add(l); else st.levels.delete(l); refreshInfo(); } }), ' ' + name)));
    lvlBox.append(h('label', { style: { marginLeft: '12px' } }, h('input', { type: 'checkbox', checked: st.komis, onchange: (e) => { st.komis = e.target.checked; refreshInfo(); } }), ' Podsumowanie komisów'));
    for (const c of ctx.cols) colBox.append(h('label', {}, h('input', { type: 'checkbox', checked: st.cols.has(c.key), onchange: (e) => { if (e.target.checked) st.cols.add(c.key); else st.cols.delete(c.key); refreshInfo(); } }), ` ${c.title} (${c.letter})`));
    const paged = st.format === 'pdf' || st.format === 'print';
    pageBox.style.display = paged ? '' : 'none';
    pageBox.style.border = '1px solid #cfd8e3'; pageBox.style.background = '#f5f8fc'; pageBox.style.padding = '6px'; pageBox.style.margin = '4px 0';
    pageBox.append(h('b', {}, 'Strona (PDF i wydruk)'), h('br'), 'Format: ', ...['A4', 'A3'].map((p) => radio('ps', p, p, st.pageSize, (x) => { st.pageSize = x; })),
      radio('or', 'l', 'poziomo', st.landscape ? 'l' : 'p', () => { st.landscape = true; }), radio('or', 'p', 'pionowo', st.landscape ? 'l' : 'p', () => { st.landscape = false; }),
      h('div', { style: { marginTop: '4px' } }, 'Dopasowanie: ', ...[['width', 'do szerokości strony'], ['page', 'cały raport na jednej stronie'], ['actual', '100%'], ['custom', 'własna skala']].map(([v, l]) => radio('fit', v, l, st.fit, (x) => { st.fit = x; })),
        st.fit === 'custom' ? h('input', { type: 'number', min: 10, max: 400, step: 5, value: st.scalePct, style: { width: '64px', padding: '2px' }, oninput: (e) => { st.scalePct = Math.max(10, Math.min(400, Number(e.target.value) || 100)); schedule(); } }) : null, st.fit === 'custom' ? ' %' : null),
      h('div', { style: { marginTop: '4px' } }, 'Wyrównanie: ', ...[['left', 'do lewej'], ['center', 'do środka'], ['right', 'do prawej']].map(([v, l]) => radio('al', v, l, st.align, (x) => { st.align = x; }))),
      h('div', { style: { marginTop: '4px' } }, 'Marginesy: ', ...[[0, 'brak'], [5, '5 mm'], [10, '10 mm'], [15, '15 mm'], [20, '20 mm'], [25, '25 mm']].map(([v, l]) => radio('mg', v, l, st.marginMm, (x) => { st.marginMm = x; }))),
      h('div', { class: 'muted', style: { marginTop: '2px' } }, 'Wiersze dzielą się na strony, nagłówek tabeli powtarza się na każdej; przerywana linia w podglądzie to marginesy.'));
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
    lsSet({ format: st.format, chart: st.chart, title: st.title, pageSize: st.pageSize, landscape: st.landscape, scale: st.scale, inRange: st.inRange, fit: st.fit, scalePct: st.scalePct, align: st.align, marginMm: st.marginMm, openAfter: st.openAfter, brand: st.brand, company: st.company, dept: st.dept, program: st.program, owner: st.owner });
    const base = `harmonogram_${stamp()}`;
    go.disabled = true; go.textContent = 'Przygotowuję…';
    try {
      if (st.format === 'xlsx') {
        const ok = await window.zks.saveFile(base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', toBase64(reportXlsx(model)));
        if (ok) { toast('Zapisano plik Excel'); if (st.openAfter) await window.zks.openLastSaved?.(); }
      } else if (st.format === 'html') {
        const html = reportHtml(model, { generated: `${ctx.user ? 'Udostępnił: ' + ctx.user + ' · ' : ''}ZKS PO (PC) ${ctx.version || ''}`.trim() });
        const bytes = new TextEncoder().encode(html); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const ok = await window.zks.saveFile(base + '.html', 'text/html', btoa(bin));
        if (ok) { toast('Zapisano plik HTML (otwiera się w przeglądarce)'); if (st.openAfter) await window.zks.openLastSaved?.(); }
      } else if (st.format === 'pdf' || st.format === 'print') {
        const { html, pages } = reportPagesHtml(model, pageOpts());
        const ok = st.format === 'pdf' ? await window.zks.savePdf(html, { name: base + '.pdf', pageSize: st.pageSize, landscape: st.landscape }) : await window.zks.printReport(html, { pageSize: st.pageSize, landscape: st.landscape });
        if (ok) toast(st.format === 'pdf' ? `Zapisano PDF (stron: ${pages})` : 'Wysłano do drukarki');
        if (ok && st.format === 'pdf' && st.openAfter) await window.zks.openLastSaved?.();
      } else {
        const { svg, width, height } = reportSvg(model);
        const img = await svgToImage(svg, width, height, { scale: st.scale, type: st.format === 'clip' ? 'image/png' : 'image/jpeg', quality: 0.95 });
        const note = img.scale < st.scale ? ` (zmniejszono do ${img.scale.toFixed(2)}× – raport jest bardzo duży)` : '';
        if (st.format === 'clip') { await window.zks.copyImage(img.base64); toast('Skopiowano obraz do schowka' + note); }
        else if (await window.zks.saveFile(base + '.jpg', 'image/jpeg', img.base64)) { toast(`Zapisano JPG ${img.width} × ${img.height}` + note); if (st.openAfter) await window.zks.openLastSaved?.(); }
      }
      m.close();
    } catch (e) { toast('Nie udało się: ' + (e.message || e)); }
    finally { go.disabled = false; go.textContent = 'Udostępnij'; }
  } }, 'Udostępnij');

  // dwie kolumny: z lewej opcje, z prawej podgląd na żywo (cały czas widoczny)
  const m = modal('Udostępnij harmonogram', h('div', {}, h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } }, h('div', { style: { flex: '1 1 460px', minWidth: '420px', maxHeight: '74vh', overflow: 'auto', paddingRight: '6px' } },
    section('Format', fmtBox),
    pageBox, imgBox,
    section('Tytuł raportu', titleI),
    section('Wiersze', rowBox),
    section('Poziomy', lvlBox),
    section('Kolumny', colQuick, colBox),
    section('Zakres dat', 'od ', fromI, calendarButton(fromI, { title: 'Początek zakresu – kalendarz', holidays: ctx.holidays }), ' do ', toI, calendarButton(toI, { title: 'Koniec zakresu – kalendarz', holidays: ctx.holidays }), h('label', { style: { marginLeft: '14px' } }, chartCb, ' pokaż wykres'), h('span', { style: { marginLeft: '14px' } }, 'interwał '), intervalSel,
      h('div', { style: { marginTop: '4px' } }, h('label', {}, inRangeCb, ' tylko operacje trwające w tym zakresie (bez zakończonych wcześniej i jeszcze nierozpoczętych)'))),
    section('Nagłówek raportu', h('label', {}, brandCb, ' logo, firma, wydział i osoba udostępniająca z lewej; program i twórca z prawej'), brandFields),
    section('Po zapisaniu', h('label', {}, openCb, ' otwórz gotowy dokument (JPG, Excel, PDF) w domyślnym programie'))),
    h('div', { style: { flex: '1 1 520px', minWidth: '420px', position: 'sticky', top: 0 } }, h('b', {}, 'Podgląd na żywo'), info, preview)),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), go)), { wide: true });
  m.root.style.width = 'min(1500px, 97vw)'; m.root.style.maxWidth = '97vw';
  refreshInfo();
}
