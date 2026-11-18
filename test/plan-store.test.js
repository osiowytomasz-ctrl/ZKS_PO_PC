import test from 'node:test';
import assert from 'node:assert/strict';

test('Plan w bazie: wiersze JSON, siatka, zmiany w wierszach', async () => {
  globalThis.window = globalThis.window || { zks: {} };
  const S = await import('../src/renderer/js/planStore.js');
  const g = { values: [['', 'Kto', 'Komis'], ['1', 'Nowak Jan', 'A'], ['', '17-11-2026', 'Zmiana b - KARTA PRACY']], backgrounds: [['#fff', '#fff', '#fff'], ['#fff', '#eee', '#fff'], ['#fff', '#fff', '#fff']],
    fontColors: [['#000', '#000', '#000'], ['#000', '#000', '#00f'], ['#000', '#000', '#000']], kinds: [['hidden', 'header', 'header'], ['hidden', 'worker', 'edit'], ['hidden', 'date', 'edit']],
    runs: [[null, null, null], [null, null, [{ text: 'A', color: '#00f' }]], [null, null, [{ text: 'Zmiana b - KARTA PRACY', color: '#000' }]]] };
  const rows = { r: { 0: S.rowToJson(g, 0), 1: S.rowToJson(g, 1), 2: S.rowToJson(g, 2) } };
  const back = S.gridFromDocs({ nRows: 3, workers: ['Nowak Jan'], userColors: { 'a@b': '#c00000' } }, [rows], 'A@B');
  assert.deepEqual(back.values, g.values); assert.equal(back.userColor, '#c00000');
  assert.deepEqual(back.dateCells, [{ row: 2, col: 1, value: '2026-11-17' }]);
  assert.deepEqual(back.runs[1][2], [{ text: 'A', color: '#00f' }]);
  const t = S.applyToRows(back, [{ row: 1, col: 2, entry: { type: 'text', lines: [[{ text: 'A', color: '#00f' }], [{ text: 'B', color: '#c00000' }]] } }, { row: 2, col: 1, entry: { type: 'plain', value: '2026-11-18', display: '18-11-2026' } }]);
  assert.equal(t.get(1).v[2], 'A\nB'); assert.deepEqual(t.get(1).runs[2], [{ text: 'A', color: '#00f' }, { text: '\n', color: '#000000' }, { text: 'B', color: '#c00000' }]);
  assert.equal(t.get(2).v[1], '18-11-2026');
  assert.equal(back.values[1][2], 'A');   // kopia – siatka bez zmian do czasu zapisu
});
