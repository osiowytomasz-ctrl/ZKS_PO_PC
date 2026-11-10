import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chunkId, parseGrafikText, grafikDocs, buildHarmData, fmtDt } from '../src/renderer/js/logic/harmModel.js';
import { importOperations } from '../src/renderer/js/logic/harmImport.js';

test('chunkId: operacje po 50 numerów, nienumeryczne do cx', () => {
  assert.equal(chunkId('0'), 'c0000'); assert.equal(chunkId('49'), 'c0000'); assert.equal(chunkId('50'), 'c0001'); assert.equal(chunkId('2000'), 'c0040'); assert.equal(chunkId('A1'), 'cx');
});

test('grafik z tekstu → dokumenty miesięczne; harmonogram liczy koniec z kodów', () => {
  const head = ['', '1Si', '2Un', '', '', '', '', '', '1Si1', '1Si2'].join('\t');
  const day = (d, a, b) => ['', 0, 0, 0, 0, 0, 0, d, a, b].join('\t');
  const text = [head, day('02-11-2026', 'a8', 'b8'), day('03-11-2026', 'a8', 'b8'), day('04-11-2026', 'a8', 'b8')].join('\n');
  const p = parseGrafikText(text);
  assert.equal(p.days.length, 3);
  const docs = grafikDocs(p.days);
  assert.deepEqual(Object.keys(docs), ['2026-11']);
  const days = Object.assign({}, docs['2026-11'].days);
  const ops = { 1: { preds: [], station: '1Si', hours: 8, startManual: Date.UTC(2026, 10, 2, 6), komis: 'K1', element: 'E1' } };
  const d = buildHarmData(ops, days, null, Date.UTC(2026, 10, 2));
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].start, '02.11.2026 06:00');
  assert.equal(d.rows[0].koniec, '02.11.2026 14:00');
  assert.equal(fmtDt(null), '');
});

const GRAF = new URL('./fixtures/graf-norm.txt', import.meta.url).pathname;
const EXPORT = new URL('./fixtures/harm-export.txt', import.meta.url).pathname;
const SAMPLE = new URL('./fixtures/harm-sample.json', import.meta.url).pathname;
test('prawdziwe dane: model buduje wiersze zgodne z arkuszem', { skip: !(fs.existsSync(GRAF) && fs.existsSync(EXPORT) && fs.existsSync(SAMPLE)) && 'brak danych' }, () => {
  const g = parseGrafikText(fs.readFileSync(GRAF, 'utf8'));
  const daysByKey = Object.assign({}, ...Object.values(grafikDocs(g.days)).map((d) => d.days));
  const imp = importOperations(fs.readFileSync(EXPORT, 'utf8'));
  const opsByLp = {}; for (const { lp, ...o } of imp.operations) if (!(lp in opsByLp)) opsByLp[lp] = o;
  const data = buildHarmData(opsByLp, daysByKey, null, Date.UTC(2026, 10, 10));
  const want = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const byLp = new Map(data.rows.map((r) => [r.lp, r]));
  const bad = want.filter((w) => { const r = byLp.get(w.lp); return !r || r.start !== (w.startCalc || '').slice(0, 16) || r.koniec !== (w.endCalc || '').slice(0, 16); }).map((w) => w.lp);
  assert.deepEqual(bad.slice(0, 5), []);
});
