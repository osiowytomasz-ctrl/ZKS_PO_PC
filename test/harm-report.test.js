import test from 'node:test';
import assert from 'node:assert/strict';
import { reportSvg, reportPagesHtml, reportXlsx, layout, fitText } from '../src/renderer/js/logic/harmReport.js';
import { buildXlsx, crc32, colName, excelDate } from '../src/renderer/js/logic/xlsx.js';
import { buildCells } from '../src/renderer/js/logic/harmAxis.js';

const D = (d, h = 0) => Date.UTC(2026, 10, d, h);
const model = (n = 3) => ({
  title: 'Harmonogram', subtitle: 'test', font: 11, rowH: 22,
  columns: [{ key: 'lp', title: 'lp.', w: 50 }, { key: 'hours', title: 'Czas [h]', w: 34, vertical: true }],
  chart: { cells: buildCells(D(10), D(14), 'd', new Map()), cellW: 18, nominalHours: 24, nowMs: D(11, 8) },
  rows: Array.from({ length: n }, (_, i) => ({ bg: '#ffffff', cells: [{ text: String(100 + i) }, { text: '8', value: 8 }], frame: null, bars: [{ start: D(10, 6), end: D(10, 14), color: '#0070c0' }], label: 'K - op' })),
});

test('xlsx: CRC32, nazwy kolumn, daty Excela', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(colName(0), 'A'); assert.equal(colName(25), 'Z'); assert.equal(colName(26), 'AA'); assert.equal(colName(701), 'ZZ');
  assert.equal(excelDate(Date.UTC(1900, 0, 1)), 2);
  const b = buildXlsx({ name: 'A', rows: [['x', 1, { v: D(10), style: { date: true } }]] });
  assert.equal(b[0], 0x50); assert.equal(b[1], 0x4b);                         // „PK” – archiwum ZIP
});

test('raport: SVG z tabelą, osią i paskami; strony PDF dzielą wiersze; Excel z wykresem w komórkach', () => {
  const m = model(3), L = layout(m);
  assert.equal(L.tableW, 84); assert.ok(L.chartW > 0);
  const { svg, width, height } = reportSvg(m);
  assert.match(svg, /^<svg/); assert.ok(svg.includes('fill="#0070c0"')); assert.ok(svg.includes('Harmonogram')); assert.equal(width, L.width); assert.equal(height, L.height);
  const big = model(200);
  const p = reportPagesHtml(big, { pageSize: 'A4', landscape: true });
  assert.ok(p.pages > 1); assert.equal((p.html.match(/class="page"/g) || []).length, p.pages); assert.ok(p.html.includes('size: A4 landscape'));
  assert.ok(reportPagesHtml(big, { pageSize: 'A3', landscape: true }).pages < p.pages);
  const x = reportXlsx(m);
  assert.equal(x[0], 0x50);
  assert.equal(fitText('abcdefghijklmnop', 40, 11), 'abcd…'); assert.equal(fitText('ab', 40, 11), 'ab');
});

test('raport: kolor operacji (komisu) na pasku – pasek maszyny z lewej, reszta w kolorze operacji; Excel tak samo', () => {
  const m = model(1);
  m.rows[0].bars = [{ start: D(10, 0), end: D(12, 0), color: '#0070c0', fill: '#ff66ff' }];
  const { svg } = reportSvg(m);
  assert.ok(svg.includes('fill="#ff66ff"')); assert.ok(svg.includes('fill="#0070c0"'));
  const x = reportXlsx(m);
  const txt = Buffer.from(x).toString('latin1');
  assert.ok(/FF66FF/i.test(txt)); assert.ok(/0070C0/i.test(txt));   // pierwsza komórka – kolor maszyny, kolejne – kolor operacji
});

test('raport HTML: samodzielna strona z tabelą, osią, paskami (kolor operacji) i nagłówkiem firmowym', async () => {
  const { reportHtml } = await import('../src/renderer/js/logic/harmReport.js');
  const m = model(2);
  m.rows[0].bars = [{ start: D(10, 0), end: D(12, 0), color: '#0070c0', fill: '#ff66ff' }];
  m.brand = { company: 'Firma <A>', dept: 'Wydział', sharer: 'Udostępnił: T', program: 'Program', owner: '', date: '12.11.2026' };
  const html = reportHtml(m, { generated: 'test' });
  assert.match(html, /^<!doctype html>/); assert.ok(html.includes('Firma &lt;A&gt;'));
  assert.ok(html.includes('linear-gradient(to right, #0070c0 0 10px, #ff66ff 10px)'));
  assert.equal((html.match(/<tr>/g) || []).length, 3);                     // nagłówek + 2 wiersze
  assert.ok(html.includes('class="ax"')); assert.ok(html.includes('id="q"'));
  assert.ok(!reportHtml({ ...m, chart: null }).includes('class="ax"'));
});
