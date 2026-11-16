import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx } from '../src/renderer/js/logic/xlsx.js';
import { readXlsx, excelToIso } from '../src/renderer/js/logic/xlsxRead.js';
import { parseCompetenceSheet, points, parseLevel, permAlert, personId, parsePermValue, fmtPerm, levelColor } from '../src/renderer/js/logic/competence.js';

test('odczyt .xlsx i import matrycy (nagłówki w wierszu 3, wagi i kolory grup w wierszu 2)', async () => {
  const D = (iso) => ({ v: Date.parse(iso + 'T00:00:00Z'), style: { date: true } });
  const head = ['lp.', '', 'Nazwisko i Imię pracownika', 'Komis wewnętrzny', 'Obsługiwana maszyna, stanowisko', 'Stanowisko wg. umowy', 'ewid. ZKS', 'Badania ważne do', 'Suwnica Nr uprawnień', 'ur', 'Punkty', 'CNC', 'Piła'];
  const rows = [
    ['Dane podstawowe'],
    [null, null, null, null, null, null, null, null, null, null, null, { v: 3, style: { bg: '#92d050' } }, { v: 1, style: { bg: '#ffc000' } }],
    head,
    [1, 'po', 'Testowy Jan', '606-01', 'Tokarz', 'Operator', 12007, D('2026-12-01'), 'O/09/1', D('1980-01-01'), null, 50, 100],
    [2, 'PL', 'Próbny Adam', '', 'Piła', '', '', 'x', '', null, null, '', 25],
  ];
  const bytes = buildXlsx({ name: 'MK', rows });
  const sheets = await readXlsx(bytes);
  assert.equal(sheets[0].name, 'MK');
  const r = parseCompetenceSheet(sheets[0]);
  assert.deepEqual(r.skills.map((s) => [s.name, s.weight, s.color]), [['CNC', 3, '#92d050'], ['Piła', 1, '#ffc000']]);
  assert.deepEqual(r.perms.map((p) => [p.name, !!p.expiry]), [['Badania ważne do', true], ['Suwnica Nr uprawnień', false]]);   // bez „ur”
  const p = r.people.PO12007;
  assert.equal(p.name, 'Testowy Jan'); assert.equal(p.machine, 'Tokarz');
  assert.equal(Object.values(p.perms)[0], '2026-12-01');
  assert.equal(points(p, r.skills), 50 * 3 + 100 * 1);
  assert.ok(r.people.k5, 'bez numeru – identyfikator z wiersza');
  assert.equal(excelToIso(46357), '2026-12-01');
});

test('wpisy poziomów, dat i terminy uprawnień', () => {
  assert.equal(parseLevel('50'), 50); assert.equal(parseLevel('75%'), 75); assert.equal(parseLevel('0,5'), 50); assert.equal(parseLevel(''), '');
  assert.equal(parseLevel('abc'), null); assert.equal(parseLevel('120'), null);
  assert.equal(parsePermValue('3.3.2025'), '2025-03-03'); assert.equal(parsePermValue('O/09/01631/12'), 'O/09/01631/12');
  assert.equal(fmtPerm('2025-03-03'), '03.03.2025');
  assert.equal(permAlert('2026-11-10', '2026-11-16'), 'expired'); assert.equal(permAlert('2026-12-01', '2026-11-16'), 'soon'); assert.equal(permAlert('2027-01-01', '2026-11-16'), ''); assert.equal(permAlert('x', '2026-11-16'), '');
  assert.equal(personId('po', '12007', 4), 'PO12007'); assert.equal(personId('PO', '', 9), 'k9');
  assert.equal(levelColor(0), null); assert.equal(levelColor(100), '#57bb8a');
});
