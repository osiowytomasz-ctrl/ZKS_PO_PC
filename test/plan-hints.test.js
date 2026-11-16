import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrid, blockOf, shiftOfText, withShift, normShift, workerKey, workersForShift, komisFragment, komisHistory, komisSuggestions, isKomisColumn } from '../src/renderer/js/logic/planHints.js';

test('blok i zmiana z nagłówka', () => {
  const g = { blocks: [{ id: 'b1', shift: '1', headerRow: 1, lastRow: 5 }, { id: 'b2', shift: '2', headerRow: 6, lastRow: 9 }] };
  assert.equal(blockOf(g, 3).id, 'b1');
  assert.equal(blockOf(g, 6).id, 'b2');
  assert.equal(blockOf(g, 0), null);
  assert.equal(shiftOfText('Zmiana b - KARTA PRACY'), 'b');
  assert.equal(shiftOfText('zmiana C-karta pracy'), 'c');
  assert.equal(shiftOfText('Zmiana 2 - KARTA PRACY'), 'b');          // dawny zapis cyfrą
  assert.equal(shiftOfText('Zmiana d - KARTA PRACY'), null);
  assert.equal(shiftOfText('Opis'), null);
  assert.equal(withShift('Zmiana a - KARTA PRACY (hala B)', 'c'), 'Zmiana c - KARTA PRACY (hala B)');
  assert.equal(withShift('Zmiana 1 - KARTA PRACY', 'b'), 'Zmiana b - KARTA PRACY');   // cyfra zamienia się na literę
  assert.deepEqual(['1', '2', '3', 'a', 'B', 'x', ''].map(normShift), ['a', 'b', 'c', 'a', 'b', null, null]);
});

test('pracownicy wg Grafiku dnia i zmiany', () => {
  assert.equal(workerKey('Kowalski Jan'), 'kowalski jan');
  assert.equal(workerKey('KOWALSKI Janusz UT=3'), 'kowalski jan');
  const workers = ['Kowalski Jan', 'Nowak Ann', 'Wiśniewski Pio', 'Zając Tom', 'Lis Ewa'];
  const people = [
    { fullName: 'Kowalski Janusz', text: 'a8' }, { fullName: 'Nowak Anna', text: 'b8' }, { fullName: 'Wiśniewski Piotr', text: 'UT' }, { fullName: 'Zając Tomasz', text: 'a4b4' },
  ];
  const g = workersForShift(workers, people, 'a');
  assert.deepEqual(g.on.map((x) => x.name), ['Kowalski Jan', 'Zając Tom']);
  assert.deepEqual(g.other.map((x) => [x.name, x.code]), [['Nowak Ann', 'b8']]);
  assert.deepEqual(g.away.map((x) => x.name), ['Wiśniewski Pio']);
  assert.deepEqual(g.rest.map((x) => x.name), ['Lis Ewa']);
  assert.equal(g.on[1].hours, 4);
  assert.deepEqual(workersForShift(workers, people, 'b').on.map((x) => x.name), ['Nowak Ann', 'Zając Tom']);
  assert.deepEqual(workersForShift(workers, people, '2').on.map((x) => x.name), ['Nowak Ann', 'Zając Tom']);   // dawne 2 = b
});

test('historyczne komisy i podpowiedzi', () => {
  const grid = { values: [
    ['', 'Pracownik', 'Opis', 'Komis'],
    ['', '', '1. toczenie 26/934 wałek', '1. 26/934\n2. 25/112'],
    ['', '', 'frez', '1. 26/934\n2. K-SERWIS'],
    ['', '', '24/77 stare', ''],
  ] };
  assert.equal(isKomisColumn(grid, 3), true);
  assert.equal(komisFragment('12. 26/9'), '26/9');
  const h = komisHistory(grid, ['26/1001']);
  assert.equal(h[0], '26/934');
  assert.ok(h.includes('K-SERWIS') && h.includes('24/77') && h.includes('25/112') && h.includes('26/1001'));
  assert.deepEqual(komisSuggestions(h, '26/'), ['26/934', '26/1001']);
  assert.deepEqual(komisSuggestions(h, 'serw'), ['K-SERWIS']);
  assert.deepEqual(komisSuggestions(h, '26/934'), []);           // już wpisany w całości – bez podpowiedzi
});

test('bloki i daty liczone w programie (także gdy serwer zna tylko 1/2/3)', () => {
  const g = normalizeGrid({
    values: [
      ['', 'Data', 'Opis'],
      ['', '16-11-2026', 'Zmiana 1 - KARTA PRACY'],
      ['12', 'Kowalski Jan', 'toczenie'],
      ['', '', 'Zmiana b – KARTA PRACY'],
      ['13', 'Nowak Ann', 'frez'],
      ['14', '', 'wiercenie'],
    ],
    kinds: [['hidden', 'header', 'header'], ['hidden', 'date', 'edit'], ['hidden', 'worker', 'edit'], ['hidden', 'edit', 'edit'], ['hidden', 'worker', 'edit'], ['hidden', 'worker', 'edit']],
    runs: [[], [null, null, []], [], [null, [], []], [], []],
    dateCells: [{ row: 1, col: 1, value: '2026-11-16' }],
    blocks: [{ id: 'shiftBlock_1', shift: '1', headerRow: 1, lastRow: 5 }],          // stary serwer: blok „b” niewidoczny
  });
  assert.deepEqual(g.blocks, [{ id: 'shiftBlock_1', shift: 'a', headerRow: 1, lastRow: 2 }, { id: 'shiftBlock_2', shift: 'b', headerRow: 3, lastRow: 5 }]);
  assert.equal(g.kinds[3][1], 'date');
  assert.equal(g.runs[3][1], null);
  assert.deepEqual(g.dateCells, [{ row: 1, col: 1, value: '2026-11-16' }, { row: 3, col: 1, value: '' }]);
  assert.equal(blockOf(g, 5).shift, 'b');
});
