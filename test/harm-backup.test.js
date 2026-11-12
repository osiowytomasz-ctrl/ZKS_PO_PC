import test from 'node:test';
import assert from 'node:assert/strict';
import { backupData, backupText, parseBackup, backupDiff, backupFileName } from '../src/renderer/js/logic/harmBackup.js';

const ops = { 100: { preds: [], komis: 'K1', element: 'A', station: '1Si', hours: 8, startManual: 1, extra: 'x' }, '100a': { preds: [], element: 'sub', hours: 2 }, 200: { preds: ['100'], element: 'B', status: '' } };
const cfg = { stations: [{ name: '4Fr', bg: '#ff0000', color: '#000', sum: true }], komisColors: [{ komis: 'K1', bg: '#ff66ff', color: '#000', bold: true }], holidays: [{ date: '2026-11-11', name: 'Św.' }], other: 1 };

test('kopia: eksport i odczyt dają te same operacje i ustawienia', () => {
  const d = backupData(ops, cfg, { app: 'PC 1.7.0', user: 'T', nowMs: Date.UTC(2026, 10, 12) });
  assert.equal(d.format, 'zks-harmonogram'); assert.equal(d.count, 3);
  assert.equal(d.ops[100].extra, undefined); assert.equal(d.ops[200].status, undefined);   // tylko znane, niepuste pola
  const p = parseBackup(backupText(d));
  assert.deepEqual(p.errors, []); assert.deepEqual(p.ops, d.ops); assert.deepEqual(p.config, d.config);
  assert.equal(p.config.stations[0].sum, true); assert.equal(p.meta.app, 'PC 1.7.0');
  assert.match(backupFileName(), /^harmonogram_kopia_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
});

test('kopia: kontrola pliku i porównanie z bazą', () => {
  assert.match(parseBackup('xx').errors[0], /JSON/);
  assert.match(parseBackup('{"a":1}').errors[0], /znacznika/);
  const bad = parseBackup(JSON.stringify({ format: 'zks-harmonogram', version: 1, ops: { 'x-1': {}, '300a': { preds: [] }, 400: { hours: 'dużo', preds: ['999'] } } }));
  assert.ok(bad.errors.some((e) => e.includes('x-1'))); assert.ok(bad.errors.some((e) => e.includes('300a'))); assert.ok(bad.errors.some((e) => e.includes('hours')));
  assert.ok(bad.warnings.some((w) => w.includes('999')));
  const d = backupDiff(ops, { 100: ops[100], 200: { ...ops[200], element: 'C' }, 300: { preds: [] } });
  assert.deepEqual(d, { added: ['300'], changed: ['200'], removed: ['100a'], unchanged: 1 });
});
