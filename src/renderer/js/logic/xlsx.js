// Minimalny zapis plików Excel (.xlsx) bez bibliotek: arkusz z wartościami, stylami (wypełnienie, czcionka, obramowanie, obrót tekstu, format daty),
// szerokościami kolumn, wysokościami wierszy, scaleniami i zamrożeniem nagłówka. Plik to archiwum ZIP (bez kompresji) z plikami XML.

const enc = new TextEncoder();
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// ---------- ZIP (metoda „stored”) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameB = enc.encode(name), bytes = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true); local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameB, bytes);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, bytes.length, true); cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, nameB.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + bytes.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ---------- XLSX ----------
export const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Data (ms „czasu ściennego” jak UTC) jako numer seryjny Excela. */
export const excelDate = (ms) => (ms - EXCEL_EPOCH) / 86400000;
const argb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? 'FF' + m[1].toUpperCase() : null; };

/**
 * Tworzy plik .xlsx. [sheet] = { name, rows: [[cell]], colWidths: [szer.], rowHeights: {wiersz: wys.}, merges: ['A1:D1'], freeze: {row, col} }.
 * Komórka: null | wartość | { v, style: { bg, color, bold, italic, underline, rotate, date, wrap, border, align, size } } (v: tekst, liczba albo ms daty przy style.date).
 */
export function buildXlsx(sheet) {
  const fonts = ['<font><sz val="10"/><name val="Calibri"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border><left style="thin"><color rgb="FF8C8C8C"/></left><right style="thin"><color rgb="FF8C8C8C"/></right><top style="thin"><color rgb="FF8C8C8C"/></top><bottom style="thin"><color rgb="FF8C8C8C"/></bottom><diagonal/></border>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const fontIdx = new Map(), fillIdx = new Map(), xfIdx = new Map();
  const styleId = (st) => {
    if (!st) return 0;
    const fKey = [st.bold, st.italic, st.underline, argb(st.color), st.size].join('|');
    if (!fontIdx.has(fKey)) {
      fontIdx.set(fKey, fonts.length);
      fonts.push(`<font>${st.bold ? '<b/>' : ''}${st.italic ? '<i/>' : ''}${st.underline ? '<u/>' : ''}<sz val="${st.size || 10}"/>${argb(st.color) ? `<color rgb="${argb(st.color)}"/>` : ''}<name val="Calibri"/></font>`);
    }
    const bg = argb(st.bg);
    let fill = 0;
    if (bg) { if (!fillIdx.has(bg)) { fillIdx.set(bg, fills.length); fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor indexed="64"/></patternFill></fill>`); } fill = fillIdx.get(bg); }
    const font = fontIdx.get(fKey), border = st.border ? 1 : 0, numFmt = st.date ? 164 : 0;
    const align = st.rotate || st.wrap || st.align ? `<alignment${st.rotate ? ` textRotation="${st.rotate}"` : ''}${st.wrap ? ' wrapText="1"' : ''}${st.align ? ` horizontal="${st.align}"` : ''} vertical="center"/>` : '';
    const key = [font, fill, border, numFmt, align].join('|');
    if (!xfIdx.has(key)) {
      xfIdx.set(key, xfs.length);
      xfs.push(`<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`);
    }
    return xfIdx.get(key);
  };
  const strings = [], strIdx = new Map();
  const sIdx = (t) => { if (!strIdx.has(t)) { strIdx.set(t, strings.length); strings.push(t); } return strIdx.get(t); };
  const rowsXml = sheet.rows.map((row, r) => {
    const ht = sheet.rowHeights && sheet.rowHeights[r];
    const cells = row.map((cell, c) => {
      if (cell == null || cell === '') return '';
      const obj = typeof cell === 'object' ? cell : { v: cell };
      const ref = colName(c) + (r + 1), s = styleId(obj.style);
      const sAttr = s ? ` s="${s}"` : '';
      if (obj.v == null || obj.v === '') return s ? `<c r="${ref}"${sAttr}/>` : '';
      if (obj.style && obj.style.date) return `<c r="${ref}"${sAttr}><v>${excelDate(obj.v)}</v></c>`;
      if (typeof obj.v === 'number' && Number.isFinite(obj.v)) return `<c r="${ref}"${sAttr}><v>${obj.v}</v></c>`;
      return `<c r="${ref}"${sAttr} t="s"><v>${sIdx(String(obj.v))}</v></c>`;
    }).join('');
    return `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  const cols = (sheet.colWidths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const fr = sheet.freeze;
  const pane = fr && (fr.row || fr.col) ? `<sheetViews><sheetView workbookViewId="0"><pane${fr.col ? ` xSplit="${fr.col}"` : ''}${fr.row ? ` ySplit="${fr.row}"` : ''} topLeftCell="${colName(fr.col || 0)}${(fr.row || 0) + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : '';
  const merges = sheet.merges && sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml}</sheetData>${merges}<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`;
  const name = esc(String(sheet.name || 'Arkusz1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/sharedStrings.xml', data: sst },
  ]);
}

/** Bajty jako base64 (do zapisu przez proces główny). */
export function toBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
