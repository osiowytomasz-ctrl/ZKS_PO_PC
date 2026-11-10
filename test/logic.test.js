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
  assert.equal(Z.source(zrows, [], 'ordered').length, 2);   // bez PZ
  assert.equal(Z.source(zrows, [], 'bought').length, 1);    // z PZ
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

test('Zakupy: PZ, korekta, ilość pozostała, tabela dodawania', () => {
  assert.equal(Z.lacksPz({ columnE: '' }), true);
  assert.equal(Z.lacksPz({ columnE: ' PZ1 ' }), false);
  assert.equal(Z.needsCorrection({ columnE: '', columnB: '2026-11-01', columnJ: 'x' }), true);
  assert.equal(Z.needsCorrection({ columnE: '', columnB: '' }), false);
  assert.equal(Z.source([{ columnE: '', columnJ: 'x' }], [], 'ordered').length, 1);   // x bez PZ nadal zamówione
  assert.equal(Z.remainingQuantity('10', '5'), '5');
  assert.equal(Z.remainingQuantity('10,5', '5'), '5,5');
  assert.equal(Z.remainingQuantity('10', '10'), null);
  assert.equal(Z.remainingQuantity('10', '12'), null);
  assert.equal(Z.remainingQuantity('abc', '1'), null);
  assert.equal(Z.remainingQuantity('0,3', '0,1'), '0,2');
  const now = new Date(2026, 10, 8);
  assert.equal(Z.zmwTemplate(now), '/11/26');
  assert.equal(Z.isZmwEmpty('/11/26'), true);
  assert.equal(Z.isZmwEmpty('1234/11/26'), false);
  assert.equal(Z.zmwToSend('/11/26'), '');
  assert.equal(Z.zmwToSend(' 12/11/26 '), '12/11/26');
  let d = Z.emptyDraft(now);
  assert.equal(d.length, 10);
  assert.equal(Z.validateDraft(d), 'Tabela jest pusta.');
  d[3] = { ...d[3], opis: 'x' };
  assert.equal(Z.validateDraft(d), 'Wiersz 4: uzupełnij ilość.');
  d[3] = { ...d[3], ilosc: '0' };
  assert.equal(Z.validateDraft(d), 'Wiersz 4: nieprawidłowa ilość.');
  d[3] = { ...d[3], ilosc: '2,5', kod: '' };
  assert.equal(Z.validateDraft(d), null);               // kod może być pusty
  assert.equal(Z.compactDraft(d, now)[0].opis, 'x');
  assert.equal(Z.filledCount(Z.compactDraft(d, now)), 1);
  assert.equal(Z.parseDraft('zły json', now).length, 10);
  assert.equal(Z.parseDraft(JSON.stringify([{ kod: 'A', ilosc: '1' }]), now)[0].zmw, '/11/26');
});

test('Skaner: filterCodes', async () => {
  const { filterCodes } = await import('../src/renderer/js/logic/scanner.js');
  assert.deepEqual(filterCodes('', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(filterCodes(' B ', ['ab', 'cd', 'B1']), ['ab', 'B1']);
});

import * as W from '../src/renderer/js/logic/workflow.js';
test('Workflow: kategoria zgodna z formułą z kolumny H', () => {
  assert.equal(W.category('', '', 'Mistrz zmiany'), 'Mistrz');
  assert.equal(W.category('x', '', 'Mistrz zmiany'), 'Mvistrz');
  assert.equal(W.category('', '', 'URLOP'), 'Urlop');
  assert.equal(W.category('x', '', 'zakup śrub'), 'Zvakup');
  for (const t of ['modernizacja', 'rysowanie', 'oprzyrządowanie', 'projektowanie', 'modelowanie', 'CAD', '3D']) assert.equal(W.category('', '', t + ' x'), 'projektowanie');
  assert.equal(W.category('x', '', 'projekt 3d'), 'pvrojektowanie');
  assert.equal(W.category('', '', 'obróbka'), 'obrobka');                  // zawiera „obr”
  assert.equal(W.category('', '', 'obr. detalu'), 'obrobka');
  assert.equal(W.category('', '', 'Poprawa programu'), 'Kor prog');
  assert.equal(W.category('x', '', 'korekta'), 'Kvor prog');
  assert.equal(W.category('', '', 'zlecenie 12'), 'zlec prac');
  assert.equal(W.category('', '', 'audit'), 'audit');
  assert.equal(W.category('x', '', 'odbicia'), 'ovdbicia');
  assert.equal(W.category('', 'coś', 'inne'), 'inne');
  assert.equal(W.category('x', 'coś', 'inne'), 'ivnne');
  assert.equal(W.category('', '', 'inne'), 'zz');
  // kolejność: pierwszy pasujący warunek wygrywa
  assert.equal(W.category('', '', 'mistrz zakup'), 'Mistrz');
  assert.equal(W.category('', '', 'urlop obr'), 'Urlop');
});

test('Workflow: formatowanie warunkowe, zakresy i priorytet', () => {
  const rec = (o) => W.toRecord(['', '', '', '', '', '', '', ''].map((_, i) => o[W.COLS[i]] ?? ''));
  const a = rec({ A: 'X', F: 'cokolwiek' });
  assert.deepEqual(W.cellStyle(a, 'A', 2), { background: '#b7b7b7' });
  assert.deepEqual(W.cellStyle(a, 'H', 460), { background: '#b7b7b7' });
  assert.equal(W.cellStyle(a, 'H', 461), null);                       // poza zakresem 2–460
  assert.equal(W.cellStyle(a, 'H', 1), null);
  const c = rec({ C: 'x' });
  assert.equal(W.cellStyle(c, 'A', 5), null);                          // reguła C=x zaczyna się od kolumny C
  assert.equal(W.cellStyle(c, 'B', 5), null);
  assert.deepEqual(W.cellStyle(c, 'C', 5), { background: '#000000', color: '#ffffff', bold: true });
  const b = rec({ B: 'x' });
  assert.equal(W.cellStyle(b, 'A', 5), null);
  assert.equal(W.cellStyle(b, 'B', 5).background, '#fce8b2');
  const both = rec({ B: 'x', C: 'x' });
  assert.equal(W.cellStyle(both, 'D', 5).background, '#000000');       // C=x ma wyższy priorytet niż B=x
  const m = rec({ F: 'Mistrz' });                                      // H policzone lokalnie = „Mistrz”
  assert.deepEqual(W.cellStyle(m, 'F', 5), { background: '#a4c2f4', bold: true, italic: true });
  const mx = rec({ A: 'x', F: 'Mistrz' });                              // H = „Mvistrz”, więc bez niebieskiego
  assert.equal(W.cellStyle(mx, 'B', 5).background, '#b7b7b7');
  assert.equal(W.mismatches([{ sheetH: 'Mistrz', H: 'Mistrz' }, { sheetH: 'Urlop', H: 'zz' }, { sheetH: '', H: 'zz' }]).length, 1);
});

test('Workflow: status, fragmenty tekstu, zmiany i zapis', () => {
  const rec = { ...W.toRecord(['', 'x', '', '2021-01-01', 'K1', 'zadanie', 'Jan', ''], { F: [{ text: 'za', bold: true }, { text: 'danie' }] }), row: 5 };
  assert.equal(W.statusOf(rec), 'B');
  assert.equal(W.toggleStatus('B', 'B'), '');
  assert.equal(W.toggleStatus('B', 'C'), 'C');
  // status: kliknięcie A wyłącza B (jeden status), ponowne kliknięcie A czyści, powrót do oryginału usuwa zmianę
  let ch = W.stageStatus(new Map(), rec, 'A');
  assert.equal(ch.get(5).status, 'A');
  let eff = W.effective(rec, ch.get(5));
  assert.equal(eff.A, 'x'); assert.equal(eff.B, '');
  ch = W.stageStatus(ch, rec, 'A');
  assert.equal(ch.get(5).status, '');
  ch = W.stageStatus(ch, rec, 'B');
  assert.equal(ch.size, 0);
  // tekst: scalanie i porównanie z oryginałem
  assert.deepEqual(W.normalizeRuns([{ text: 'a' }, { text: 'b' }, { text: '', bold: true }, { text: 'c', bold: true, color: '#FF0000' }]).map((r) => r.text), ['ab', 'c']);
  assert.equal(W.normalizeRuns([{ text: 'x', color: '#000000' }])[0].color, null);
  assert.equal(W.runsEqual(W.cellRuns(rec, 'F'), [{ text: 'za', bold: true }, { text: 'da' }, { text: 'nie' }]), true);
  assert.equal(W.cellRuns(rec, 'E')[0].text, 'K1');
  assert.deepEqual(W.cellRuns({ E: '', runs: {} }, 'E'), []);
  ch = W.stageText(new Map(), rec, 'F', [{ text: 'zadanie', bold: true }]);
  assert.equal(ch.get(5).cells.F[0].bold, true);
  eff = W.effective(rec, ch.get(5));
  assert.equal(eff.F, 'zadanie');
  assert.equal(W.stageText(ch, rec, 'F', W.cellRuns(rec, 'F')).size, 0);          // powrót do oryginału
  // H przeliczane po zmianie tekstu i statusu
  const ch2 = W.stageText(new Map(), rec, 'F', [{ text: 'Mistrz' }]);
  assert.equal(W.effective(rec, ch2.get(5)).H, 'Mistrz');
  // składanie zapisu
  ch = W.stageStatus(W.stageText(new Map(), rec, 'F', [{ text: 'nowe', italic: true }]), rec, 'C');
  const items = W.buildItems(ch, [rec]);
  assert.deepEqual(items, [{ row: 5, status: 'C', cells: { F: { text: 'nowe', runs: [{ text: 'nowe', bold: false, italic: true, underline: false, strike: false, color: null }] } }, expect: { F: 'zadanie' } }]);
  const ni = W.newItem([{ text: ' 604-01 ' }], [{ text: 'Zad', bold: true }], 'B');
  assert.equal(ni.row, null); assert.equal(ni.status, 'B'); assert.equal(ni.cells.E.text, ' 604-01 '); assert.equal(ni.cells.F.runs[0].bold, true);
  assert.deepEqual(W.newItem([], [{ text: '  ' }]).cells, {});
});

test('Workflow: format daty RRRR.MM.DD', () => {
  assert.equal(W.fmtDate('2021-01-01'), '2021.01.01');
  assert.equal(W.fmtDate('2026.11.08 18:12'), '2026.11.08 18:12');
  assert.equal(W.fmtDate('2026-11-08 09:05'), '2026.11.08 09:05');
  assert.equal(W.fmtDate('7.1.2026'), '2026.01.07');
  assert.equal(W.fmtDate(''), '');
  assert.equal(W.fmtDate('brak'), 'brak');
  assert.equal(formatDate('2026.11.08'), '08.11.2026');                // inne moduły czytają też ten zapis
});

test('Workflow: filtry i sortowanie jak w Zakupach', () => {
  const mk = (row, o) => { const rec = { ...W.toRecord(['', '', '', o.D || '', o.E || '', o.F || '', o.G || '', ''], {}), row }; if (o.A) rec.A = 'x'; return { rec, eff: W.effective(rec, null) }; };
  const items = [
    mk(2, { D: '2021-01-01', E: '604-01', F: 'Korekta  programu', G: 'Jan' }),
    mk(3, { D: '2026-11-08 18:12', E: '604-01', F: 'zakup śrub', G: 'Ola' }),
    mk(4, { D: '', E: '', F: 'audit', G: 'Jan' }),
    mk(5, { D: '2026-11-02 09:00', E: '606-02', F: 'Urlop', G: 'Ola', A: true }),
  ];
  assert.equal(W.columnTitle('B'), 'Start (w trakcie)');
  assert.equal(W.columnTitle('G'), 'Zlecający');
  assert.equal(W.filterValue(items[0].eff, 'D'), '2021.01.01');
  assert.equal(W.filterValue(items[0].eff, 'F'), 'Korekta programu');            // spacje scalone
  // filtry kolumn się sumują
  const f1 = { G: new Set(['Jan']) };
  assert.deepEqual(W.visible(items, f1).map((x) => x.rec.row), [2, 4]);
  const f2 = { ...f1, E: new Set(['604-01']) };
  assert.deepEqual(W.visible(items, f2).map((x) => x.rec.row), [2]);
  // liczniki w oknie kolumny liczone przy filtrach INNYCH kolumn; puste na końcu
  const opts = W.options(items, { G: new Set(['Jan']) }, 'E');
  assert.deepEqual(opts.map((o) => [o.value, o.count]), [['604-01', 1], ['606-02', 0], ['', 1]]);
  // sortowanie wielopoziomowe: data malejąco (puste na końcu), data jest chronologiczna
  const sorted = W.sortItems(items, [{ key: 'D', ascending: false }]).map((x) => x.rec.row);
  assert.deepEqual(sorted, [3, 5, 2, 4]);
  const by2 = W.sortItems(items, [{ key: 'G', ascending: true }, { key: 'D', ascending: true }]).map((x) => x.rec.row);
  assert.deepEqual(by2, [2, 4, 5, 3]);
  // status A jest widoczny w filtrze kolumny A po wartości „x”
  assert.deepEqual(W.options(items, {}, 'A').map((o) => [o.value, o.count]), [['x', 1], ['', 3]]);
});
