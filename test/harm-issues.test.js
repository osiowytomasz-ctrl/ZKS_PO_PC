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
  assert.ok(cyc.length >= 3);
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
