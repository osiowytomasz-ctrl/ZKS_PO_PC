import test from 'node:test';
import assert from 'node:assert/strict';
import { findIssues, issuesByOp, conflictPath } from '../src/renderer/js/logic/harmIssues.js';

// mała kopia sytuacji z produkcji: 850a czeka na 202b, a 202b (przez 850b) czeka na 850a – pętla
const ops = () => ({
  850: { preds: [] }, '850a': { preds: ['202b'], station: '2Un', hours: 70 }, '850b': { preds: [], station: '2Un', hours: 70 },
  202: { preds: [] }, '202a': { preds: ['850b'], station: '2Un', hours: 70 }, '202b': { preds: ['202a'], station: '2Un', hours: 80 },
  300: { preds: ['999'], station: 'XX', hours: 1, startManual: Date.UTC(2026, 10, 10), endManual: Date.UTC(2026, 10, 9) },
  '400a': { preds: [], station: '2Un', hours: 2 }, 500: { preds: [], station: '2Un' },
});

test('konflikty: pętla z podpowiedzią, brak poprzednika, daty, rodzic, czas, stanowisko', () => {
  const r = findIssues(ops(), { stations: new Set(['2Un']), noStart: new Set(['500']) });
  const cyc = r.filter((x) => x.kind === 'cycle');
  assert.ok(cyc.length >= 2);                                                  // 202b ← 202a to zbędna zależność (uwaga), nie ogniwo do usunięcia
  assert.ok(cyc.some((x) => x.lp === '850a' && x.fix && x.col === 'z1'));         // usunięcie 850a ← 202b rozwiązuje pętlę
  const kinds = new Set(r.map((x) => x.kind));
  for (const k of ['missing', 'dates', 'parent', 'hours', 'station', 'nostart']) assert.ok(kinds.has(k), k);
  assert.equal(r[0].level, 'error');
  const m = issuesByOp(r);
  assert.equal(m.get('300').level, 'error'); assert.equal(m.get('300').cols.get('endManual'), 'error');
  // po usunięciu powiązania pętla znika
  const o = ops(); o['850a'].preds = [];
  assert.equal(findIssues(o).filter((x) => x.kind === 'cycle').length, 0);
});

test('ścieżka konfliktu: łańcuch od powiązania z powrotem do operacji, z powodami', () => {
  const p = conflictPath(ops(), '850a', '202b');
  assert.deepEqual(p.map((s) => `${s.waiter}>${s.on}`), ['850a>202b', '202b>202a', '202a>850b', '850b>850a']);
  assert.ok(p[0].closing); assert.equal(p[3].kind, 'order'); assert.match(p[3].why, /kolejność w 850/);
  assert.deepEqual(conflictPath(ops(), '300', '999'), []);
});

test('zbędne zależności: wcześniejsza suboperacja (i jej potomki) – uwaga, blokada wpisu, lista wyboru bez nich', async () => {
  const M = await import('../src/renderer/js/logic/harmModel.js');
  const o = { 600: { preds: [] }, '600a': { preds: [] }, '600aa': { preds: [], hours: 5 }, '600ab': { preds: ['600aa'], hours: 3 },
    '600b': { preds: [] }, '600ba': { preds: ['600ab'], hours: 2 }, 700: { preds: ['600ab'], hours: 1 } };
  assert.deepEqual(M.redundantPreds(o, '600ab'), ['600aa']);
  assert.deepEqual(M.redundantPreds(o, '600ba'), ['600ab']);                   // 600b i tak czeka na całe 600a
  assert.deepEqual(M.redundantPreds(o, '700'), []);                            // inna operacja – zależność potrzebna
  const r = findIssues(o).filter((x) => x.kind === 'redundant');
  assert.deepEqual(r.map((x) => `${x.lp}<${x.pred}`).sort(), ['600ab<600aa', '600ba<600ab']);
  assert.ok(r.every((x) => x.level === 'warn'));
  assert.match(M.predError({ ...o, '600ab': { preds: [], hours: 3 } }, '600ab', 0, '600aa'), /Zbędne/);
  assert.ok(!M.predecessorChoices(o, '600ab', 0).includes('600aa'));
});
