import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/renderer/js/logic/partsView.js';

test('kategoria narzędzia i części z grupy narzędzi', () => {
  assert.equal(V.toolCategory({ columnD: 'wie' }), 'wie'); assert.equal(V.toolCategory({ columnD: 'tre' }), 'wie'); assert.equal(V.toolCategory({ columnD: 'fre' }), 'fre');
  assert.equal(V.toolCategory({ columnD: 'opr' }), ''); assert.equal(V.toolCategory({ columnD: '' }), ''); assert.equal(V.toolCategory({ columnD: 'noz' }), 'tok');
  assert.equal(V.partCategory([{ columnD: 'fre' }, { columnD: 'fre' }, { columnD: 'wie' }]), 'fre');
  assert.equal(V.partCategory([{ columnD: 'fre' }, { columnD: 'wie' }]), 'wie', 'remis – wiertła przed frezami');
  assert.equal(V.partCategory([{ columnD: 'opr' }]), '');
});

test('opis narzędzia przy części: Grupa / Rodzaj, Lrob (K z PSWT), L', () => {
  const i = V.toolInfo({ columnD: 'fre', columnE: 'jez', columnJ: '60' }, { K: '55' });
  assert.deepEqual(i, { group: 'fre / jez', lrob: '55', len: '60' }); assert.equal(V.toolInfoText(i), 'fre / jez · Lrob 55 · L 60');
  assert.equal(V.toolInfoText(V.toolInfo({ columnD: 'wie' }, null)), 'wie');
});

test('filtry po kolumnach U i T: wartości i dopasowanie (U i T dla tego samego narzędzia)', () => {
  const pl = [{ U: 'b', T: 'x' }, { U: 'a', T: 'y' }, { U: '', T: 'y' }];
  assert.deepEqual(V.partValues(pl, 'U'), ['a', 'b']); assert.deepEqual(V.partValues(pl, 'T'), ['x', 'y']);
  assert.ok(V.matchesColumns(pl, {})); assert.ok(V.matchesColumns(pl, { U: 'a' })); assert.ok(V.matchesColumns(pl, { U: 'a', T: 'y' })); assert.ok(!V.matchesColumns(pl, { U: 'a', T: 'x' }));
  assert.ok(!V.matchesColumns([], { T: 'x' }));
});

test('sortowanie części: kod, stan / dostępne, liczba narzędzi, grupa', () => {
  const p = (code, avail, uses, cat, types) => ({ code, tool: avail == null ? null : { available: avail, status: 0, stock: 0 }, uses: Array(uses).fill({}), cat, types });
  const parts = [p('B2', 5, 1, 'fre', 'pal'), p('A10', 0, 3, 'wie', 'ply'), p('A9', 2, 2, 'tok', ''), p('Z', null, 9, '', '')];
  assert.deepEqual(V.sortParts(parts, 'code').map((x) => x.code), ['A9', 'A10', 'B2', 'Z']);
  assert.deepEqual(V.sortParts(parts, 'stock').map((x) => x.code), ['A10', 'A9', 'B2', 'Z'], 'braki na górze, bez katalogu na końcu');
  assert.deepEqual(V.sortParts(parts, 'uses').map((x) => x.code), ['Z', 'A10', 'A9', 'B2']);
  assert.deepEqual(V.sortParts(parts, 'group').map((x) => x.code), ['A10', 'B2', 'A9', 'Z']);
  assert.deepEqual(V.sortParts(parts, 'code', -1).map((x) => x.code), ['Z', 'B2', 'A10', 'A9']);
});
