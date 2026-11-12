// Raport Harmonogramu do udostępnienia: obraz (SVG → JPG/PNG), strony PDF i wydruku (HTML z SVG na każdej stronie) oraz plik Excel.
// Model raportu buduje widok (views/harmLive.js) z wybranych kolumn, wierszy, poziomów i zakresu osi; tu jest tylko rysowanie i zapis.
import { buildXlsx } from './xlsx.js';

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Nagłówek firmowy raportu: z lewej logo, firma, wydział i osoba udostępniająca; z prawej nazwa programu i właściciel.
const BRAND_H = 66, BRAND_MIN_W = 760;
const FRAME = 10;   // odstęp treści od ramki
const BRAND_RED = '#d71920', BRAND_DARK = '#2b2b2b';
function brandSvg(out, b, W, text) {
  out.push(`<rect x="0" y="0" width="${W}" height="${BRAND_H - 6}" fill="#ffffff"/>`);
  if (b.logo) out.push(`<image href="${b.logo}" x="6" y="6" width="48" height="48" preserveAspectRatio="xMidYMid meet"/>`);
  const lx = b.logo ? 62 : 8;
  if (b.company) text(lx, 22, b.company, { size: 17, bold: true, color: BRAND_DARK });
  if (b.dept) text(lx, 39, b.dept, { size: 12, bold: true, color: BRAND_RED });
  if (b.sharer) text(lx, 54, b.sharer, { size: 11, color: '#555' });
  if (b.program) text(W - 8, 24, b.program, { size: 15, bold: true, color: BRAND_DARK, anchor: 'end' });
  if (b.owner) text(W - 8, 41, b.owner, { size: 11, color: '#555', anchor: 'end' });
  if (b.date) text(W - 8, 55, b.date, { size: 10, color: '#888', anchor: 'end' });
  out.push(`<rect x="0" y="${BRAND_H - 6}" width="${W}" height="3" fill="${BRAND_RED}"/><rect x="0" y="${BRAND_H - 3}" width="${W}" height="1.5" fill="${BRAND_DARK}"/>`);
}

const DAY_BG = { work: '#00b050', sat: '#00b0f0', sun: '#ff0000', holiday: '#800000', span: '#00b050' };
const GRID = '#8c8c8c';

/** Tekst przycięty do szerokości (szacunkowo, czcionka proporcjonalna). */
const BAR_STRIP = 10;   // szerokość paska koloru maszyny przy kolorze operacji [px raportu]
export function fitText(text, widthPx, fontPx) {
  const t = String(text ?? ''), max = Math.max(0, Math.floor((widthPx - 6) / (fontPx * 0.56)));
  return t.length <= max ? t : max <= 1 ? '' : t.slice(0, max - 1) + '…';
}

/**
 * Geometria raportu. model = { title, subtitle, columns: [{title, w, vertical, text(row)}], rows: [{cells: [{text, bg, color, bold, italic, underline}],
 * bg, bars: [{start, end, color, fill?}] (fill – kolor operacji/komisu: z lewej STRIP px koloru stanowiska, reszta fill), frame: {start, end} | null, label}], chart: null | {cells: [{start, end, hours, label, kind}], cellW, nowMs}, rowH, font }.
 */
export function layout(model) {
  const font = model.font || 11, rowH = model.rowH || 22;
  const tableW = model.columns.reduce((a, c) => a + c.w, 0);
  const chart = model.chart;
  const pxH = chart ? chart.cellW / chart.nominalHours : 0;
  const chartW = chart ? Math.ceil(chart.cells.reduce((a, c) => a + c.hours, 0) * pxH) : 0;
  const labelLen = Math.max(10, ...(chart ? chart.cells.map((c) => c.label.length) : [0]), ...model.columns.filter((c) => c.vertical).map((c) => c.title.length));
  const headH = Math.ceil(labelLen * font * 0.58) + 14;
  const brandH = model.brand ? BRAND_H : 0;
  const titleH = brandH + (model.title ? (model.subtitle ? 46 : 30) : 0);
  // ramka wokół treści raportu (pod nagłówkiem firmowym); treść wyśrodkowana w poziomie
  const innerW = tableW + chartW + 2;
  const width = Math.max(innerW + 2 * FRAME, model.brand ? BRAND_MIN_W : 0);
  return { font, rowH, tableW, chartW, pxH, headH, titleH, brandH, innerW, ox: (width - innerW) / 2, width, height: titleH + headH + model.rows.length * rowH + 2 + 2 * FRAME };
}

/** SVG raportu dla wierszy [from, to) (domyślnie wszystkich). */
export function reportSvg(model, { from = 0, to = model.rows.length, page = '' } = {}) {
  const L = layout(model), { font, rowH, tableW, chartW, pxH, headH, titleH } = L;
  const rows = model.rows.slice(from, to), n = rows.length;
  const H = titleH + headH + n * rowH + 2 + 2 * FRAME + (page ? 16 : 0), W = L.width;
  const out = [];
  const text = (x, y, t, o = {}) => out.push(`<text x="${x}" y="${y}" font-size="${o.size || font}" font-family="Arial, Helvetica, sans-serif"${o.bold ? ' font-weight="700"' : ''}${o.italic ? ' font-style="italic"' : ''}${o.underline ? ' text-decoration="underline"' : ''} fill="${o.color || '#000'}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.rotate ? ` transform="rotate(-90 ${x} ${y})"` : ''}>${esc(t)}</text>`);
  const rect = (x, y, w, h, fill, stroke, sw = 1) => out.push(`<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill || 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`);
  rect(0, 0, W, H, '#ffffff');
  const bH = L.brandH;
  if (model.brand) brandSvg(out, model.brand, W, text);
  out.push(`<g transform="translate(${L.ox} ${FRAME})">`);   // treść w ramce, wyśrodkowana
  if (model.title) { text(4, bH + 20, model.title, { size: font + 6, bold: true }); if (model.subtitle) text(4, bH + 38, model.subtitle, { size: font, color: '#444' }); }
  const y0 = titleH, yRows = titleH + headH;
  // nagłówek tabeli
  let x = 0;
  for (const c of model.columns) {
    rect(x, y0, c.w, headH, '#e4e4e4', GRID);
    if (c.vertical) text(x + c.w / 2 + font / 3, y0 + headH - 6, c.title, { bold: true, rotate: true });
    else text(x + 3, y0 + headH - 6, fitText(c.title, c.w, font), { bold: true });
    x += c.w;
  }
  // nagłówek osi
  if (model.chart) {
    let cx = tableW;
    for (const c of model.chart.cells) {
      const w = c.hours * pxH;
      rect(cx, y0, w, headH, DAY_BG[c.kind] || DAY_BG.work, '#555', 0.5);
      if (w >= font * 0.9) text(cx + w / 2 + font / 3, y0 + headH - 6, c.label, { color: c.kind === 'sat' ? '#000' : '#fff', bold: c.kind === 'holiday', rotate: true, size: Math.min(font, Math.max(6, w - 2)) });
      cx += w;
    }
  }
  // tło wykresu: dni robocze szare, weekend i święta białe, teraz zielone
  if (model.chart) {
    rect(tableW, yRows, chartW, n * rowH, '#f2f2f2');
    let cx = tableW;
    for (const c of model.chart.cells) {
      const w = c.hours * pxH;
      if (c.kind === 'sat' || c.kind === 'sun' || c.kind === 'holiday') rect(cx, yRows, w, n * rowH, '#ffffff');
      if (model.chart.nowMs >= c.start && model.chart.nowMs < c.end) rect(cx, yRows, w, n * rowH, 'rgba(0,176,80,0.18)');
      cx += w;
    }
  }
  // wiersze
  const startMs = model.chart ? model.chart.cells[0].start : 0;
  const px = (ms) => tableW + Math.max(0, (ms - startMs) / 3600000) * pxH;
  rows.forEach((r, i) => {
    const y = yRows + i * rowH;
    let cx = 0;
    model.columns.forEach((c, k) => {
      const cell = r.cells[k] || {};
      rect(cx, y, c.w, rowH, cell.bg || r.bg || '#ffffff', GRID, 0.6);
      text(cx + 3, y + rowH / 2 + font / 2.8, fitText(cell.text, c.w, font), cell);
      cx += c.w;
    });
    if (!model.chart) return;
    // pasek: kolor stanowiska; z kolorem operacji (fill) – z lewej STRIP px koloru stanowiska, reszta w kolorze operacji
    const paintBar = (x, w, sg) => { if (!sg.fill) { rect(x, y + 2, w, rowH - 4, sg.color); return; } const sw = Math.min(BAR_STRIP, w / 3); rect(x, y + 2, w, rowH - 4, sg.fill); rect(x, y + 2, sw, rowH - 4, sg.color); };
    const end = tableW + chartW;
    const clipX = (v) => Math.min(end, v);
    if (r.frame && r.frame.end >= startMs) {
      const a = px(r.frame.start), b = clipX(px(r.frame.end));
      rect(a, y + 2, Math.max(1, b - a), rowH - 4, '#ffffff');
      for (const sg of r.bars) { const sa = px(sg.start), sb = clipX(px(sg.end)); if (sb > sa) paintBar(sa, Math.max(1, sb - sa - 1), sg); }
      rect(a, y + 2, Math.max(1, b - a), rowH - 4, null, '#000', 1);
      if (r.label) text(a + 3, y + rowH / 2 + font / 2.8, r.label, { bold: true });
    } else if (r.bars.length && r.bars[0].end >= startMs) {
      const sg = r.bars[0], a = px(sg.start), b = clipX(px(sg.end));
      paintBar(a, Math.max(2, b - a), sg);
      rect(a, y + 2, Math.max(2, b - a), rowH - 4, null, '#000', 1);
      if (r.label) text(a + 3, y + rowH / 2 + font / 2.8, r.label, { bold: true });
    }
  });
  if (model.chart && model.chart.nowMs > startMs) { const nx = px(model.chart.nowMs); if (nx <= tableW + chartW) out.push(`<line x1="${nx}" y1="${yRows}" x2="${nx}" y2="${yRows + n * rowH}" stroke="#ff6600" stroke-width="2" stroke-dasharray="5 3"/>`); }
  out.push('</g>');
  const fb = H - (page ? 16 : 0);
  rect(2, bH + 2, W - 4, fb - bH - 4, null, '#000', 3);   // ramka wokół harmonogramu
  if (page) text(W - 4, H - 3, page, { size: font - 1, color: '#555', anchor: 'end' });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`, width: W, height: H };
}

const PAGE_PX = { A4: [794, 1123], A3: [1123, 1587] };   // 96 dpi, pionowo
const MM = 96 / 25.4;   // pikseli (96 dpi) na milimetr (marginesy strony)

/**
 * Strony do PDF i wydruku. Opcje strony: [fit] – 'width' dopasuj do szerokości (domyślnie; wąski raport powiększony najwyżej 2×),
 * 'page' cały raport na jednej stronie, 'actual' 100% (zmniejszony, gdy nie mieści się w szerokości), 'custom' – skala [scalePct] %;
 * [align] – 'left' | 'center' | 'right' (wyrównanie w poziomie); [marginMm] – margines strony w mm. Nagłówek tabeli powtarza się na każdej stronie.
 */
export function pagePlan(model, { pageSize = 'A4', landscape = true, fit = 'width', scalePct = 100, align = 'center', marginMm = 10 } = {}) {
  const [pw0, ph0] = PAGE_PX[pageSize] || PAGE_PX.A4;
  const [pw, ph] = landscape ? [ph0, pw0] : [pw0, ph0];
  const margin = Math.max(0, Math.min(40, Number(marginMm) || 0)) * MM;
  const L = layout(model);
  const availW = pw - 2 * margin, availH = ph - 2 * margin;
  const fixed = L.titleH + L.headH + 2 * FRAME + 20;
  let scale;
  if (fit === 'page') scale = Math.min(availW / L.width, availH / (fixed + model.rows.length * L.rowH));
  else if (fit === 'actual') scale = Math.min(1, availW / L.width);
  else if (fit === 'custom') scale = Math.max(0.1, Math.min(4, (Number(scalePct) || 100) / 100));
  else scale = Math.min(2, availW / L.width);
  const perPage = fit === 'page' ? Math.max(1, model.rows.length) : Math.max(1, Math.floor((availH / scale - fixed) / L.rowH));
  const pages = Math.max(1, Math.ceil(model.rows.length / perPage));
  const w = L.width * scale;
  const left = margin + (align === 'left' ? 0 : align === 'right' ? availW - w : (availW - w) / 2);
  return { pw, ph, margin, scale, perPage, pages, left, width: L.width, overflow: w > availW + 0.5 };
}

export function reportPagesHtml(model, opts = {}) {
  const { pageSize = 'A4', landscape = true, marginMm = 10 } = opts;
  const P = pagePlan(model, opts);
  const out = [];
  for (let p = 0; p < P.pages; p++) {
    const { svg } = reportSvg(model, { from: p * P.perPage, to: Math.min(model.rows.length, (p + 1) * P.perPage), page: `Strona ${p + 1} z ${P.pages}` });
    out.push(`<div class="page">${svg.replace('<svg ', `<svg style="display:block;margin-left:${(P.left - P.margin).toFixed(1)}px;width:${(P.width * P.scale).toFixed(1)}px;height:auto" `)}</div>`);
  }
  const css = `@page { size: ${pageSize} ${landscape ? 'landscape' : 'portrait'}; margin: ${Math.max(0, Math.min(40, Number(marginMm) || 0))}mm; } html, body { margin: 0; padding: 0; background: #fff; } .page { overflow: hidden; page-break-after: always; break-after: page; } .page:last-child { page-break-after: auto; break-after: auto; }`;
  return { ...P, html: `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(model.title || 'Harmonogram')}</title><style>${css}</style></head><body>${out.join('')}</body></html>` };
}

/**
 * Plik Excel: tabela (wartości: tekst, liczby, daty jako daty Excela) i – gdy jest oś – wykres w komórkach: jedna kolumna na kolumnę osi,
 * komórka wypełniona kolorem stanowiska, gdy operacja w niej trwa (węzeł złożony z dzieci w kolorach dzieci).
 */
export function reportXlsx(model) {
  const rows = [], merges = [], rowHeights = {};
  const nCols = model.columns.length, chartCells = model.chart ? model.chart.cells : [];
  const b = model.brand;
  if (b) {
    rows.push([{ v: [b.company, b.dept].filter(Boolean).join(' · '), style: { bold: true, size: 14 } }]);
    rows.push([{ v: [b.sharer, b.date].filter(Boolean).join(' · '), style: { italic: true, color: '#555555' } }]);
    rows.push([{ v: [b.program, b.owner].filter(Boolean).join(' · '), style: { bold: true, color: BRAND_RED } }]);
  }
  const top = rows.length;
  rows.push([{ v: model.title || 'Harmonogram', style: { bold: true, size: 14 } }]);
  rows.push([{ v: model.subtitle || '', style: { italic: true, color: '#444444' } }]);
  const head = model.columns.map((c) => ({ v: c.title, style: { bold: true, bg: '#e4e4e4', border: true, rotate: c.vertical ? 90 : 0, wrap: !c.vertical } }));
  for (const c of chartCells) head.push({ v: c.label, style: { bold: c.kind === 'holiday', bg: DAY_BG[c.kind] || DAY_BG.work, color: c.kind === 'sat' ? '#000000' : '#ffffff', rotate: 90, border: true, size: 8 } });
  rows.push(head);
  rowHeights[top + 2] = Math.min(150, Math.max(40, Math.ceil(Math.max(10, ...chartCells.map((c) => c.label.length), ...model.columns.filter((c) => c.vertical).map((c) => c.title.length)) * 5.6)));
  // komórka osi w kolorze paska; z kolorem operacji (fill): pierwsza komórka paska w kolorze stanowiska, kolejne w kolorze operacji
  const covers = (bars, c) => { for (const b of bars) if (b.start < c.end && b.end > c.start) return b.fill && b.start < c.start ? b.fill : b.color; return null; };
  for (const r of model.rows) {
    const line = model.columns.map((c, k) => {
      const cell = r.cells[k] || {};
      const style = { border: true, bg: cell.bg || r.bg, color: cell.color, bold: cell.bold, italic: cell.italic, underline: cell.underline };
      if (cell.date != null) return { v: cell.date, style: { ...style, date: true } };
      if (typeof cell.value === 'number') return { v: cell.value, style };
      return { v: cell.text || '', style };
    });
    for (const c of chartCells) {
      const color = covers(r.bars, c);
      const off = c.kind === 'sat' || c.kind === 'sun' || c.kind === 'holiday';
      line.push({ v: '', style: { bg: color || (off ? '#ffffff' : '#f2f2f2'), border: !!color } });
    }
    rows.push(line);
  }
  merges.push(`A${top + 1}:${colLetter(Math.max(0, nCols - 1))}${top + 1}`);
  const colWidths = [...model.columns.map((c) => Math.max(4, Math.round(c.w / 7))), ...chartCells.map(() => 2.6)];
  return buildXlsx({ name: 'Harmonogram', rows, rowHeights, merges, colWidths, freeze: { row: top + 3, col: nCols } });
}
const colLetter = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
