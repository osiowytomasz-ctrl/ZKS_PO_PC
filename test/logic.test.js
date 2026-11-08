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

import * as T from '../src/renderer/js/logic/tooltrack.js';
test('ToolTrack: filtry kaskadowe, dynamiczny, ukryte, ostrzeżenia', () => {
  const tools = [
    { productCode: 'A 1', columnD: 'fre', columnE: 'wsp', columnF: '10', columnP: 'X', location: 'Correa' },
    { productCode: 'B 2', columnD: 'opr', columnE: 'wsp', columnN: 'HSK', columnP: 'Y', location: 'Union' },
    { productCode: 'C 3', columnD: 'gwi', columnE: 'wsp', location: 'Union' },
    { productCode: 'D 4', columnD: 'fre', columnE: 'wsp', location: 'Zapas' },
  ];
  assert.deepEqual(tools.filter(T.isListed).map((t) => t.productCode), ['A 1', 'B 2']);
  const listed = tools.filter(T.isListed);
  assert.equal(T.dynamicIsMounting('opr'), true);
  assert.equal(T.dynamicIsMounting(''), null);
  const f = T.withFilter(T.emptyFilters(), 'group', 'opr');
  assert.deepEqual(T.filterOptions(listed, f, 'dynamic'), ['HSK']);
  assert.deepEqual(T.filterTools(listed, f).map((t) => t.productCode), ['B 2']);
  assert.deepEqual(T.filterOptions(listed, f, 'group'), ['fre', 'opr']);
  assert.equal(T.findByCode(tools, ' a   1 ').productCode, 'A 1');
  const byCode = new Map(tools.map((t) => [T.normCode(t.productCode), { ...t, partStatusColor: '#ff0000' }]));
  assert.equal(T.hasPartWarning(tools[0], { 'a 1': { partsCutting: ['B 2'] } }, byCode), true);
  assert.equal(T.wearPercent(0.5), 50);
  assert.equal(T.wearBand(75), 'high');
  assert.equal(T.rAlphaText({ columnG: '', columnH: '0,4' }), '0.40');
});

import * as H from '../src/renderer/js/logic/harm.js';
test('Harmonogram: oś, realizacja, dostawa, zależności, sortowanie', () => {
  const data = {
    rows: [
      { lp: '1', komis: 'K2', stanowisko: 'S1', start: '2026-11-08 08:00', koniec: '2026-11-08 12:00', godziny: '4', dostawa: '2026-11-08 06:00', wysylka: '2026-11-08 10:00' },
      { lp: '2', z1: '1', komis: 'K10', stanowisko: 'S1', start: '2026-11-08 12:00', koniec: '2026-11-09 12:00', godziny: '24' },
      { lp: '3', komis: 'K1', stanowisko: 'S2', start: '', koniec: '' },
    ],
    rapData: { K2: { S1: 2 } },
  };
  const now = new Date(Date.UTC(2026, 10, 8, 9, 30));
  const c = H.buildChart(data, { komis: new Set(), station: new Set() }, H.emptySorts(), 0, now);
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].pct, 50);
  assert.deepEqual(c.items[0].delivery.map((d) => d.kind), ['green', 'red']);
  assert.equal(c.items[0].startHours, 0);           // przycięte do osi (09:00)
  assert.equal(c.deps.length, 1);
  assert.equal(c.firstDayHours, 15);
  const sorted = H.sortRows(data.rows, { komis: 'asc', start: null, station: null });
  assert.deepEqual(sorted.map((r) => r.komis), ['K1', 'K2', 'K10']);
  assert.equal(H.parseHours('4,5 h'), 4.5);
  assert.equal(H.shortDate('2026-11-08 08:30'), '08.11.26 08');
  assert.equal(H.dayKind(new Date(Date.UTC(2026, 10, 8)), new Set()), 'sun');
  assert.deepEqual(H.cycleSort(H.emptySorts(), 'komis').komis, 'asc');
});

import * as P from '../src/renderer/js/logic/plan.js';
test('Plan: bloki, linie z kolorami, HTML do zapisu', () => {
  const grid = { values: [['a'], ['b'], ['c'], ['d']], blocks: [{ id: 'z1', headerRow: 0, lastRow: 2 }] };
  assert.deepEqual(P.visibleRows(grid, new Set()), [0, 3]);
  assert.deepEqual(P.visibleRows(grid, new Set(['z1'])), [0, 1, 2, 3]);
  const old = P.splitLines([{ text: '1. a\n2. b', color: '#ff0000' }]);
  assert.equal(old.length, 2);
  const next = P.composeLines(old, '1. a\n2. zmiana\n3. nowa', '#0000ff');
  assert.equal(next[0][0].color, '#ff0000');
  assert.equal(next[1][0].color, '#0000ff');
  assert.equal(P.toHtml([[{ text: 'x<y', color: '#000000' }], []]), '<span style="color:#000000;">x‹y</span><br>');
  assert.equal(P.displayDate('2026-11-08'), '08-11-2026');
});

import * as K from '../src/renderer/js/logic/help.js';
test('Help: parser wyrażeń i kalkulatory', () => {
  assert.equal(K.evalExpr('2+3*4'), 14);
  assert.equal(K.evalExpr('2^3^2'), 512);
  assert.equal(K.evalExpr('2^-1'), 0.5);
  assert.ok(Math.abs(K.evalExpr('pi*100') - 314.159265) < 1e-5);
  assert.equal(K.evalExpr('sqrt(16)+abs(-1)'), 5);
  assert.equal(K.evalExpr('1,5*2'), 3);
  assert.equal(K.evalExpr('2+'), null);
  assert.equal(K.evalExpr('1/0'), null);
  assert.equal(K.evalExpr('nic(2)'), null);
  assert.equal(K.feed('1.6', '0.8').text, 'Ra = 1.6 µm, rε = 0.8 mm, Posuw F = 0.144 mm/obr'.replace('0.144', K.feed('1.6', '0.8').text.match(/F = (\S+)/)[1]));
  const c = K.chords('100', '8', false, '', ['2', '5', '9']);
  assert.equal(c.angleText, '45.000000');
  assert.equal(c.lines[0].text, '38.268');
  assert.equal(c.lines[1].text, '100.000');
  assert.equal(c.lines[2].isError, true);
  assert.match(K.chords('100', '8', true, '50', ['2']).error, /> 360°/);
  const p = K.coordinates('100', '4', '', false, '');
  assert.equal(p.lines[1], 'N2 X=0.000 Y=50.000 ; Kąt=90.000000');
  assert.equal(K.linearFeed('360', '100').text, 'F° = 360 °/min, Ø = 100 mm, Fmm = 314.159 mm/min');
});

import * as B from '../src/renderer/js/logic/builder.js';
test('ToolBuilder i BN: łańcuch mocowań, ścieżka, długość, filtry', () => {
  const all = [
    { productCode: 'TR9', columnD: 'fre', columnE: 'wsp', columnF: '10', columnJ: '50', columnM: 'HSK', columnP: 'X', location: 'Correa' },
    { productCode: 'OP 1', columnD: 'opr', columnE: 'hsk', columnN: 'hsk ', columnM: 'M63', columnJ: '100.4', location: 'Union' },
    { productCode: 'TR10', columnD: 'fre', columnE: 'wsp', columnF: '8', columnN: 'HSK', location: 'Zapas' },
  ];
  assert.equal(B.isListed(all[2]), false);
  assert.deepEqual(B.nextCandidates(all, [all[0]]).map((t) => t.productCode), ['OP 1', 'TR10']);
  assert.deepEqual(B.nextCandidates(all, [all[0], all[1]]).length, 0);
  assert.equal(B.selectionPath([all[0], all[1]]), 'fre/wsp/10/x');
  assert.equal(B.selectionPath([all[1]]), 'opr/hsk/hsk');
  assert.equal(B.codesText([all[0], all[1]]), 'TR9; OP 1');
  assert.equal(B.totalLength([all[0], all[1]]), 150);
  assert.deepEqual(B.sorted(all).map((t) => t.productCode), ['OP 1', 'TR9', 'TR10']);
  const f = { ...B.emptyFilters(), diameter: '10.0' };
  assert.deepEqual(B.filterTools(all, f).map((t) => t.productCode), ['TR9']);
  const rows = [{ columnJ: 'G', columnK: 'R', firstTool: { columnF: '10', teamTotalLength: '', columnJ: '50', code: 'A', bnTeamCode: 'A; B ' } }];
  assert.deepEqual(B.bnTeamCodes(rows[0]), ['A', 'B']);
  assert.equal(B.bnValue(rows[0], 'length'), '50');
  assert.equal(B.bnFilter(rows, { group: 'g', type: '', diameter: '', length: '' }).length, 1);
});
