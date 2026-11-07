import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalCompare, parseDate, formatDate, parseSheetColor, updateSorts, sortLabels } from '../src/renderer/js/logic/common.js';
import { resolveCode, suggestions, parseQuantity } from '../src/renderer/js/logic/scanner.js';
import { levelOf, filterParts } from '../src/renderer/js/logic/home.js';
import * as G from '../src/renderer/js/logic/grafik.js';
import * as Z from '../src/renderer/js/logic/zakupy.js';

test('naturalCompare: liczby jako liczby', () => {
  assert.ok(naturalCompare('a9', 'a10') < 0);
  assert.ok(naturalCompare('B', 'a') > 0);
  assert.equal(naturalCompare('x', 'X'), 0);
});

test('parseDate / formatDate', () => {
  assert.equal(formatDate('2026-11-07 10:30'), '07.11.2026');
  assert.equal(formatDate('7.1.26'), '07.01.2026');
  assert.equal(formatDate('abc'), 'abc');
  assert.equal(parseDate('31.02.2026'), null);
});

test('parseSheetColor', () => {
  assert.equal(parseSheetColor('#F00'), '#ff0000');
  assert.equal(parseSheetColor('rgb(255, 0, 10)'), '#ff000a');
  assert.equal(parseSheetColor('zły', '#123456'), '#123456');
});

test('sortowania się sumują, ponowny wybór zmienia kierunek, null usuwa', () => {
  let s = updateSorts([], 'a', true);
  s = updateSorts(s, 'b', false);
  assert.deepEqual(s, [{ key: 'a', ascending: true }, { key: 'b', ascending: false }]);
  s = updateSorts(s, 'a', false);
  assert.deepEqual(s[0], { key: 'a', ascending: false });
  assert.deepEqual(sortLabels(s), { a: '↓1', b: '↓2' });
  assert.deepEqual(updateSorts(s, 'a', null), [{ key: 'b', ascending: false }]);
});

test('Skaner: resolveCode, suggestions, parseQuantity', () => {
  const codes = ['Abc 1', 'abc 2', 'XYZ'];
  assert.equal(resolveCode('Abc 1', codes), 'Abc 1');
  assert.equal(resolveCode('  xyz ', codes), 'XYZ');
  assert.equal(resolveCode('nie ma', codes), null);
  assert.deepEqual(suggestions('abc', codes), ['Abc 1', 'abc 2']);
  assert.deepEqual(suggestions('XYZ', codes), []);
  assert.equal(parseQuantity('2,5'), '2.5');
  assert.equal(parseQuantity('0'), null);
  assert.equal(parseQuantity('-1'), null);
  assert.equal(parseQuantity('abc'), null);
});

test('Home: poziomy i filtry', () => {
  assert.equal(levelOf('#FF0000'), 'red');
  assert.equal(levelOf('#fff'), 'other');
  const parts = [{ partCode: 'AB1', color: '#ff0000' }, { partCode: 'CD2', color: '#00ff00' }];
  assert.equal(filterParts(parts, { code: 'cd' }).length, 1);
  assert.equal(filterParts(parts, { level: 'red' })[0].partCode, 'AB1');
});

const grData = {
  rows: [
    { name: 'Pracownik', value: 'Dysp' },
    { name: 'Kowalski Jan UT=5', value: 'R' },
    { name: '**** zmiana', value: '' },
    { name: 'Nowak Anna', value: 'W' },
    { name: 'Zet Adam', value: 'R' },
  ],
  extraValues: [['2026-11-02', '2026-11-03', 'razem'], ['1', '', '5'], ['', '', ''], ['2', '3', '7'], ['10', '', '1']],
};

test('Grafik: zakres, nazwiska, separatory', () => {
  const [s, e] = G.defaultRange(new Date(2026, 10, 7)); // sobota
  assert.equal(s, '2026-11-02');
  assert.equal(e, '2026-11-12');
  assert.equal(G.cleanName('Kowalski Jan UT=5'), 'Kowalski Jan');
  assert.deepEqual(G.visibleIndexes(['2026-11-02', '2026-11-03', 'razem'], '2026-11-03', '2026-11-03'), [1, 2]);
  assert.deepEqual(G.dataRows(grData), [1, 3, 4]);
});

test('Grafik: filtry kolumn się sumują, liczniki, sortowanie z pustymi na końcu', () => {
  const cols = G.columns(grData, [0, 1, 2]);
  const filters = { [G.KEY_VALUE]: new Set(['R']) };
  assert.deepEqual(G.gridVisibleRows(grData, cols, filters), [1, 4]);
  const opts = G.gridOptions(grData, cols, { [G.KEY_NAME]: new Set(['Nowak Ann']) }, cols[1]);
  assert.deepEqual(opts.map((o) => [o.value, o.count]), [['R', 0], ['W', 1]]);
  const d0 = cols[2];
  assert.deepEqual(G.gridSorted(grData, cols, [{ key: d0.key, ascending: false }], [1, 3, 4]), [4, 3, 1]);
  const d1 = cols[3];
  assert.deepEqual(G.gridSorted(grData, cols, [{ key: d1.key, ascending: false }], [1, 3, 4]), [3, 1, 4]);
});

const zrows = [
  { rowNumber: 2, columnB: '', columnC: 'K1', columnH: '2026-11-01', columnI: '5', columnJ: '', columnK: 'a' },
  { rowNumber: 3, columnB: '2026-11-03', columnC: 'K2', columnD: '3', columnE: 'PZ1', columnH: '2026-10-20', columnJ: 'X' },
  { rowNumber: 4, columnB: '', columnC: 'K10', columnH: '2026-09-01', columnI: '1', columnJ: '' },
];

test('Zakupy: widoki, sortowanie dat i naturalne', () => {
  assert.equal(Z.source(zrows, [], 'ordered').length, 2);
  assert.equal(Z.source(zrows, [], 'bought').length, 1);
  const ord = Z.shown(zrows, [], 'ordered', {}, [{ key: 'zamowiono', ascending: true }]);
  assert.deepEqual(ord.map((r) => r.columnC), ['K10', 'K1']);
  const byCode = Z.shown(zrows, [], 'ordered', {}, [{ key: 'kod', ascending: true }]);
  assert.deepEqual(byCode.map((r) => r.columnC), ['K1', 'K10']);
  assert.equal(Z.sortSummary('ordered', [{ key: 'kod', ascending: false }]), 'Kod ↓');
  assert.match(Z.shareText('ordered', ord), /^Zamówione\n\nData \| Kod \| Ilość \| ZMW \| Opis\n01\.09\.2026 \| K10/);
});
