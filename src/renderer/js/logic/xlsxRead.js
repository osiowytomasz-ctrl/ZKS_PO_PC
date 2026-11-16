// Odczyt plików Excel (.xlsx) bez bibliotek: archiwum ZIP (metody „stored” i „deflate” – DecompressionStream), wspólne teksty,
// wartości komórek, wypełnienia (kolor tła) i rozpoznanie dat po formacie liczby. Wystarcza do importu tabel (matryca kompetencji).

const dec = new TextDecoder();
const unesc = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Pliki z archiwum ZIP: Map nazwa → Uint8Array (po centralnym katalogu, więc działa też z deskryptorami danych). */
export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('To nie jest plik .xlsx (brak archiwum ZIP).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const lstart = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = u8.subarray(lstart, lstart + csize);
    files.set(name, method === 0 ? data : method === 8 ? await inflate(data) : null);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFmt = (code) => /(^|[^\\"])[dmyhs]/i.test(String(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')) && !/^general$/i.test(code);
/** Liczba dni Excela → 'RRRR-MM-DD'. */
export const excelToIso = (n) => new Date(Math.round((Number(n) - 25569) * 86400000)).toISOString().slice(0, 10);

/**
 * Arkusze pliku: [{ name, cells: Map('A1' → {v, fill, date}) , maxRow, maxCol }]. v – tekst albo liczba; date – komórka ma format daty
 * (wtedy v to liczba dni Excela; excelToIso zamienia ją na datę); fill – kolor tła '#rrggbb' (wprost w stylu; bez kolorów motywu).
 */
export async function readXlsx(buf) {
  const files = await unzip(buf);
  const text = (n) => (files.get(n) ? dec.decode(files.get(n)) : '');
  const shared = [];
  for (const si of text('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(unesc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  // style: cellXfs → fillId, numFmtId
  const st = text('xl/styles.xml'), fmts = new Map(), fills = [], xfs = [];
  for (const m of st.match(/<numFmt [^>]*\/>/g) || []) fmts.set(Number(attr(m, 'numFmtId')), attr(m, 'formatCode'));
  const fillsBlock = (/<fills[^>]*>([\s\S]*?)<\/fills>/.exec(st) || [])[1] || '';
  for (const f of fillsBlock.match(/<fill>[\s\S]*?<\/fill>|<fill\/>/g) || []) { const m = /<fgColor [^>]*rgb="([0-9A-Fa-f]{8})"/.exec(f); fills.push(m && !/patternType="none"/.test(f) ? '#' + m[1].slice(2).toLowerCase() : null); }
  const xfBlock = (/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st) || [])[1] || '';
  for (const x of xfBlock.match(/<xf [^>]*?(\/>|>)/g) || []) { const nf = Number(attr(x, 'numFmtId') || 0); xfs.push({ fill: fills[Number(attr(x, 'fillId') || 0)] || null, date: DATE_FMT_IDS.has(nf) || (fmts.has(nf) && isDateFmt(fmts.get(nf))) }); }
  // arkusze w kolejności z workbook.xml
  const rels = new Map();
  for (const r of text('xl/_rels/workbook.xml.rels').match(/<Relationship [^>]*\/>/g) || []) rels.set(attr(r, 'Id'), attr(r, 'Target'));
  const out = [];
  for (const s of text('xl/workbook.xml').match(/<sheet [^>]*\/>/g) || []) {
    let target = rels.get(attr(s, 'r:id')) || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = text(target), cells = new Map();
    let maxRow = 0, maxCol = 0;
    for (const m of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = ' ' + m[1], ref = attr(tag, 'r'), t = attr(tag, 't'), sIdx = Number(attr(tag, 's') || 0), inner = m[2] || '';
      if (!ref) continue;
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let v = null;
      if (t === 's') v = vm ? shared[Number(vm[1])] ?? '' : '';
      else if (t === 'inlineStr') v = unesc((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join(''));
      else if (t === 'str' || t === 'e') v = vm ? unesc(vm[1]) : '';
      else if (t === 'b') v = vm ? vm[1] === '1' : null;
      else if (vm) v = Number(vm[1]);
      const xf = xfs[sIdx] || {};
      if (v === null && !xf.fill) continue;
      const { row, col } = cellPos(ref);
      maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
      cells.set(ref, { v, fill: xf.fill || null, date: !!xf.date && typeof v === 'number' });
    }
    out.push({ name: attr(s, 'name'), cells, maxRow, maxCol });
  }
  return out;
}

/** 'AB12' → { row: 12, col: 28 } (od 1). */
export function cellPos(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]), col };
}
