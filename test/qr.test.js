// Generator QR: wersja, wzory stałe, bity formatu (BCH) – pełny odczyt sprawdzony dekoderami poza testami (OpenCV, jsQR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../src/renderer/js/logic/qr.js';
import { detailsPrintHtml } from '../src/renderer/js/logic/mistrzPrint.js';

const formatOk = (q) => {
  // pierwsza kopia bitów formatu (wokół lewego górnego wzoru) → poziom M (00) i maska; suma kontrolna BCH
  const m = q.modules, b = [];
  for (let i = 0; i <= 5; i++) b[i] = m[i][8]; b[6] = m[7][8]; b[7] = m[8][8]; b[8] = m[8][7];
  for (let i = 9; i < 15; i++) b[i] = m[8][14 - i];
  const bits = b.reduce((a, v, i) => a | ((v ? 1 : 0) << i), 0) ^ 0x5412, data = bits >>> 10;
  let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return { ok: ((data << 10) | rem) === bits, ecl: data >>> 3, mask: data & 7 };
};

test('QR: najmniejsza wersja, wzory pozycjonujące, bity formatu', () => {
  const q = qrMatrix('*25/803*$HTGD464826$⍵105⍵^1^@5@');
  assert.equal(q.version, 3); assert.equal(q.size, 29);
  for (const [x, y] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) { assert.equal(q.modules[y][x], true); assert.equal(q.modules[y + 1][x + 1], false); assert.equal(q.modules[y + 3][x + 3], true); }
  const f = formatOk(q); assert.equal(f.ok, true); assert.equal(f.ecl, 0); assert.equal(f.mask, q.mask);
  assert.equal(qrMatrix('A').version, 1); assert.equal(qrMatrix('x'.repeat(180)).version, 9); assert.equal(qrMatrix('x'.repeat(181)).version, 10); assert.equal(qrMatrix('x'.repeat(412)).version, 15);   // pojemność M w bajtach wg normy
  assert.throws(() => qrMatrix('x'.repeat(3000)));
  assert.match(qrSvg('abc', { mm: 26 }), /width="26mm"/);
});

test('Wydruk A4 detali: tytuł, kolumny, kod QR jako SVG w mm, kolory wiersza', () => {
  const html = detailsPrintHtml([{ A: 1, B: '26/1', C: 'Kołnierz <A>', D: 'R-1', E: '2', F: 1, G: 4, H: '*26/1*$R-1$⍵2⍵^1^@4@', L: 1 }, { A: 2, B: '', C: 'x', H: '' }]);
  assert.match(html, /size: A4 portrait/); assert.match(html, /DETALE/); assert.match(html, /Kołnierz &lt;A&gt;/);
  assert.equal((html.match(/<svg /g) || []).length, 1); assert.match(html, /width="26mm"/); assert.match(html, /background:#93c47d/); assert.match(html, /brak danych do kodu/);
});
