import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/renderer/js/logic/measuring.js';

test('interwał z kolumny H w dniach', () => {
  const m = 30.4375;
  assert.equal(M.parseInterval('12'), 12 * m); assert.equal(M.parseInterval('365'), 365); assert.equal(M.parseInterval('90 dni'), 90); assert.equal(M.parseInterval('2 lata'), 2 * 365.25);
  assert.equal(M.parseInterval('6 mies.'), 6 * m); assert.equal(M.parseInterval('12', 'days'), 12); assert.equal(M.parseInterval('12', 'months'), 12 * m);
  assert.equal(M.parseInterval(''), null); assert.equal(M.parseInterval('brak'), null); assert.equal(M.parseInterval('0'), null);
});

test('daty z wiersza Badań i stopnie statusu proporcjonalnie do interwału', () => {
  const now = new Date(2026, 10, 23).getTime();
  const d = M.rowDates(['TP1', '15.03.2026', '01.01.2025', '30.12.2026', 'opis', ''], now, new Set([0]));
  assert.equal(d.last, parseDateLocal('2026-03-15')); assert.equal(d.future, parseDateLocal('2026-12-30')); assert.equal(d.all, 3);
  assert.deepEqual([0, 0.49, 0.5, 0.7, 0.85, 1, 1.15, 3].map((u) => M.statusIndex(u)), [0, 0, 1, 2, 3, 4, 5, 5]);
  assert.deepEqual([0, 3].map((u) => M.statusIndex(u, true)), [5, 0]);
});
function parseDateLocal(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }

test('połączenie POM (C) z Badania 2026 (A): ostatnie badanie, następne, wykorzystanie interwału', () => {
  const now = Date.UTC(2026, 10, 23);
  const pom = [['a', 'b', 'Kod', 'd', 'e', 'f', 'g', 'Interwał'], ['', '', 'MK-1', '', '', '', '', '12'], ['', '', 'MK-2', '', '', '', '', '6'], ['', '', '', '', '', '', '', '12'], ['', '', 'MK-3', '', '', '', '', '12']];
  const bad = [['Kod', 'Data'], ['mk-1', '23.05.2026', '01.01.2025'], ['MK-2', '01.01.2026']];
  const r = M.joinPom(pom, bad, { now });
  assert.equal(r.length, 3); assert.deepEqual(r.map((x) => x.id), ['MK-1', 'MK-2', 'MK-3']);
  assert.equal(r[0].last, Date.UTC(2026, 4, 23)); assert.ok(Math.abs(r[0].used - 184 / 365.25) < 0.01); assert.equal(r[0].idx, 1);
  assert.ok(r[1].used > 1.1 && r[1].idx >= 4, 'przeterminowane');
  assert.equal(r[2].last, null); assert.equal(r[2].idx, null, 'bez badania – bez statusu');
  assert.equal(M.dateText(Date.UTC(2026, 4, 23) + 3600000 * 12).length, 10);
});
