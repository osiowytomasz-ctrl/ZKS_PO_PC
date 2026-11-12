import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeFilter, isRangeFilter, visibleRows } from '../src/renderer/js/logic/tableFilter.js';

test('filtr zakresu dat: od 00:00 do 23:59, otwarte końce, puste daty odpadają', () => {
  const f = rangeFilter(Date.UTC(2026, 10, 10), Date.UTC(2026, 10, 12));
  assert.ok(isRangeFilter(f));
  assert.equal(f.has('10.11.2026 06'), true); assert.equal(f.has('12.11.2026 23'), true);
  assert.equal(f.has('09.11.2026 23'), false); assert.equal(f.has('13.11.2026 00'), false); assert.equal(f.has(''), false);
  assert.equal(rangeFilter(null, Date.UTC(2026, 10, 12)).has('01.01.2020 06'), true);
  assert.equal(rangeFilter(Date.UTC(2026, 10, 10), null).has('01.01.2030 06'), true);
  const cols = [{ key: 'start', isDate: true }];
  const rows = [{ start: '09.11.2026 06' }, { start: '11.11.2026 14' }, { start: '' }];
  assert.deepEqual(visibleRows(rows, cols, { start: f }, (r, c) => r[c.key]), [rows[1]]);
});
