// Wydruk A4 (pionowo) Listy detali jak karta „DETALE” arkusza: lp., komis, nazwa, nr rysunku, nr poz., kpl/partia, szt x kpl
// i kod QR czytelny dla telefonu (SVG, stały rozmiar w milimetrach). Kolory wierszy jak w arkuszu (postęp L).
import { qrSvg } from './qr.js';
import { cellColor, display } from './mistrz.js';

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cell = (v) => esc(display(v)).replace(/\n/g, '<br>');

/**
 * Strona HTML do druku. [rows] – wiersze Listy detali z kolumnami liczonymi (computeDetailList: H – treść kodu QR).
 * [qrMm] – bok kodu QR w mm (domyślnie 26 mm – pewny odczyt telefonem z kilkudziesięciu cm).
 */
export function detailsPrintHtml(rows, { title = 'DETALE', qrMm = 26, sheetKey = 'dlist', footer = '' } = {}) {
  const tr = rows.map((r) => {
    const col = cellColor(sheetKey, r, 'A'), st = col ? ` style="background:${col[0]};${col[1] ? 'color:' + col[1] : ''}"` : '';
    const qr = r.H ? qrSvg(r.H, { mm: qrMm, ecl: 'M', border: 2 }) : '<span class="brak">brak danych do kodu</span>';
    return `<tr${st}><td class="c">${cell(r.A)}</td><td>${cell(r.B)}</td><td>${cell(r.C)}</td><td>${cell(r.D)}</td><td class="c">${cell(r.E)}</td><td class="r">${cell(r.F)}</td><td class="r">${cell(r.G)}</td><td class="qr">${qr}</td></tr>`;
  }).join('');
  const rowH = qrMm + 2;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4 portrait; margin: 12mm 10mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; margin: 0; color: #000; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 1px solid #000; padding: 1mm 1.2mm; vertical-align: middle; overflow: hidden; word-wrap: break-word; }
thead th.tytul { font-size: 18pt; height: 16mm; letter-spacing: .5px; }
thead th { font-size: 8pt; font-weight: 700; background: #fff; }
th.v { height: 22mm; padding: 0; }
th.v div { transform: rotate(-90deg); white-space: nowrap; width: 6mm; margin: 0 auto; }
tbody tr { height: ${rowH}mm; page-break-inside: avoid; break-inside: avoid; }
td.c { text-align: center; } td.r { text-align: right; }
td.qr { padding: 0.5mm; text-align: center; background: #fff; }
td.qr svg { display: block; margin: 0 auto; }
.brak { font-size: 7pt; color: #c00; }
.stopka { margin-top: 3mm; font-size: 7pt; color: #555; }
</style></head><body>
<table>
<colgroup><col style="width:9mm"><col style="width:17mm"><col><col style="width:34mm"><col style="width:12mm"><col style="width:16mm"><col style="width:10mm"><col style="width:${qrMm + 3}mm"></colgroup>
<thead><tr><th class="tytul" colspan="8">${esc(title)}</th></tr>
<tr><th>lp.</th><th>Komis<br>(xx/yyy)</th><th>Nazwa elementu</th><th>nr rysunku</th><th class="v"><div>nr poz.</div></th><th class="v"><div>kpl/partia</div></th><th class="v"><div>szt x kpl</div></th><th>qr-code</th></tr></thead>
<tbody>${tr}</tbody></table>
${footer ? `<div class="stopka">${esc(footer)}</div>` : ''}
</body></html>`;
}
