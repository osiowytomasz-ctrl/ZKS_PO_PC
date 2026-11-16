import test from 'node:test';
import assert from 'node:assert/strict';
import { colName, rowKey, cleanLayout, toTsv, parseTsv, wrappedLines, autoRowHeight, offsets, rowAt, parseDateText, DEFAULT_FONT } from '../src/renderer/js/logic/planGrid.js';

test('nazwy kolumn jak w arkuszu', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(colName), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
});

test('klucz wiersza: numer operacji albo numer wiersza', () => {
  const g = { values: [['lp', 'x'], ['', 'Zmiana 1'], ['123', 'a'], ['12a', 'b']] };
  assert.deepEqual([0, 1, 2, 3].map((r) => rowKey(g, r)), ['r:0', 'r:1', 'n:123', 'n:12a']);
});

test('układ z bazy: zakresy i śmieci', () => {
  const l = cleanLayout({ cols: { 1: 5, 2: 150.4, x: 3, 3: 'abc' }, rows: { 'n:1': 9999, 'r:4': 40, bad: 10 }, font: 100 });
  assert.deepEqual(l, { cols: { 1: 24, 2: 150 }, rows: { 'n:1': 800, 'r:4': 40 }, font: 28 });
  assert.equal(cleanLayout(null).font, DEFAULT_FONT);
});

test('schowek: TSV jak w Excelu w obie strony', () => {
  const rows = [['a', 'b\nc', 'd"e'], ['', 'x\ty', 'z']];
  const t = toTsv(rows);
  assert.equal(t, 'a\t"b\nc"\t"d""e"\r\n\t"x\ty"\tz');
  assert.deepEqual(parseTsv(t), rows);
  assert.deepEqual(parseTsv('1\t2\r\n3\t4\r\n'), [['1', '2'], ['3', '4']]);       // Excel kończy nową linią
  assert.deepEqual(parseTsv('tekst "w środku"'), [['tekst "w środku"']]);
  assert.deepEqual(parseTsv(''), []);
});

test('zawijanie i wysokość wiersza', () => {
  const m = (s) => s.length * 10;               // 10 px na znak
  assert.equal(wrappedLines('abc', 100, m), 1);
  assert.equal(wrappedLines('aaaa bbbb cccc', 98, m), 2);           // miejsce 90 px: „aaaa bbbb ” + „cccc”
  assert.equal(wrappedLines('1. a\n2. b\n\n3. c', 200, m), 4);
  assert.equal(wrappedLines('x'.repeat(25), 108, m), 3);           // długie słowo łamane po znakach
  assert.equal(autoRowHeight(3, 13), 57);
});

test('wiersze na ekranie: sumy wysokości', () => {
  const o = offsets([20, 30, 10]);
  assert.deepEqual(o, [0, 20, 50, 60]);
  assert.deepEqual([0, 19, 20, 49, 50, 59, 100].map((y) => rowAt(o, y)), [0, 0, 1, 1, 2, 2, 2]);
});

test('data wpisana lub wklejona', () => {
  assert.equal(parseDateText('2026-11-5'), '2026-11-05');
  assert.equal(parseDateText('05-11-2026'), '2026-11-05');
  assert.equal(parseDateText('5.11.2026'), '2026-11-05');
  assert.equal(parseDateText('31.02.2026'), null);
  assert.equal(parseDateText('jutro'), null);
  assert.equal(parseDateText(' '), '');
});
