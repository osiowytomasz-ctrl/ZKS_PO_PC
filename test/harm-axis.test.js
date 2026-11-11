import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCells, axisStartMs, holidayMap, intervalOf, INTERVALS } from '../src/renderer/js/logic/harmAxis.js';

const D = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h);

test('początek osi: pełna godzina teraz + przesunięcie dodatnie (przyszłość) albo ujemne (przeszłość)', () => {
  const now = D(2026, 11, 10, 14) + 25 * 60000;
  assert.equal(axisStartMs(now, 0), D(2026, 11, 10, 14));
  assert.equal(axisStartMs(now, -3), D(2026, 11, 7, 14));
  assert.equal(axisStartMs(now, 30), D(2026, 12, 10, 14));
});

test('kolumny dzienne: pierwsza niepełna, soboty, niedziele, święta', () => {
  const hol = holidayMap([{ date: '2026-11-11', name: 'Święto Niepodległości' }, '2026-12-25', { date: 'zła' }]);
  assert.equal(hol.size, 2);
  const c = buildCells(D(2026, 11, 10, 14), D(2026, 11, 16), 'd', hol);
  assert.equal(c[0].hours, 10); assert.equal(c[0].label, '10.11.2026'); assert.equal(c[0].kind, 'work');
  assert.equal(c[1].hours, 24); assert.equal(c[1].kind, 'holiday'); assert.equal(c[1].holidayName, 'Święto Niepodległości');
  assert.equal(c.find((x) => x.label === '14.11.2026').kind, 'sat'); assert.equal(c.find((x) => x.label === '15.11.2026').kind, 'sun');
  assert.ok(c[c.length - 1].start > D(2026, 11, 16));                       // zapas za końcem
});

test('kolumny godzinowe, tygodniowe i miesięczne', () => {
  const h4 = buildCells(D(2026, 11, 10, 14), D(2026, 11, 11), '4h', new Map());
  assert.equal(h4[0].hours, 2); assert.equal(h4[0].label, '10.11 14:00'); assert.equal(h4[1].start, D(2026, 11, 10, 16)); assert.equal(h4[1].hours, 4);
  const h1 = buildCells(D(2026, 11, 14, 22), D(2026, 11, 15, 2), '1h', new Map());
  assert.equal(h1[0].kind, 'sat'); assert.equal(h1[2].kind, 'sun'); assert.equal(h1[0].hours, 1);
  const w = buildCells(D(2026, 11, 10, 14), D(2026, 12, 1), 'w', new Map());       // 10.11.2026 to wtorek
  assert.equal(w[1].start, D(2026, 11, 16)); assert.equal(w[1].hours, 168); assert.equal(w[1].label, 'tydz. 16.11.2026'); assert.equal(w[1].kind, 'span');
  const m = buildCells(D(2026, 11, 10, 14), D(2027, 2, 1), 'm', new Map());
  assert.equal(m[1].start, D(2026, 12, 1)); assert.equal(m[1].hours, 31 * 24); assert.equal(m[1].label, '12.2026'); assert.equal(m[3].hours, 28 * 24);   // luty 2027
  assert.equal(buildCells(D(2026, 1, 1), D(2030, 1, 1), '1h', new Map(), 500).length, 500);       // ograniczenie liczby kolumn
  assert.equal(intervalOf('nieznany').id, 'd'); assert.equal(INTERVALS.length, 13);
  const d3 = buildCells(D(2026, 11, 10, 14), D(2026, 11, 25), '3d', new Map());
  assert.ok(d3.slice(1).every((c) => c.hours === 72)); assert.equal(d3[1].kind, 'span'); assert.equal((d3[1].start / 86400000) % 3, 0);
});
