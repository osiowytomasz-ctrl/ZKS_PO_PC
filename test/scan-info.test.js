// Skaner na PC: podgląd z arkusza (dane wymyślone) – te same przypadki co ScanInfoTest w aplikacji na Androida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { opers, operTable, registered, details, history, pickCode, reticlePoints, inside, reticleSvg } from '../src/renderer/js/logic/scanInfo.js';

const op = (date, time, nr, status, operator = 'jan@x', archive = false) => ({ date, time, nr, status, operator, archive });

test('operacje przewodnika: tabela co 10, pominięte, postęp z dokumentu', () => {
  const ops = [op('23.03.2026', '07:00:00', '10', 'Start'), op('23.03.2026', '09:00', '10', 'Koniec'), op('24.03.2026', '07:00', '30', 'Start', 'ola@x'), op('24.03.2026', '08:00', '20', 'Usunięta')];
  const o = opers(ops, '30');
  assert.deepEqual(o.map((x) => [x.nr, x.status]), [['10', 'Koniec'], ['30', 'Start']]);
  assert.equal(o[0].start, '23.03.2026 07:00'); assert.equal(o[0].end, '23.03.2026 09:00'); assert.equal(o[1].operator, 'ola'); assert.equal(o[1].current, true);
  const t = operTable(o, { ilosc: '5' }, '30');
  assert.deepEqual(t.rows.map((r) => r.nr), [10, 20, 30, 40, 50]);
  assert.deepEqual(t.rows.map((r) => r.skipped), [false, true, false, false, false]);
  assert.equal(t.done, 1); assert.equal(t.total, 5); assert.equal(t.skipped, 1); assert.equal(t.rows[2].current, true);
  assert.deepEqual(operTable(o, null).rows.map((r) => r.nr), [10, 20, 30]);
});

test('dokument już zarejestrowany, wykonane detale, historia', () => {
  const docs = [{ komis: 'E3/25/803', nr: '4_2', date: '23.03.2026', time: '09:25', kto: 'Kumala', status: '1 / 3' }];
  assert.match(registered(docs, 'e3/25/803', '4_2'), /jest już zarejestrowany: 23\.03\.2026 09:25, Kumala, status 1 \/ 3/);
  assert.equal(registered(docs, 'E3/25/803', '4_3'), null);
  const d = details([{ date: '1.03.2026', time: '08:00', rysunek: 'R-1', poz: '1', kpl: '1', szt: '1', todo: '4' }, { date: '2.03.2026', time: '09:00', rysunek: 'R-1', poz: '1', kpl: '1', szt: '2', todo: '4' }],
    { rysunek: 'R-1', pozycja: '1', komplet: '1' });
  assert.equal(d.length, 1); assert.equal(d[0].done, 3); assert.equal(d[0].progress, 0.75); assert.equal(d[0].current, true); assert.equal(d[0].last, '2.03.2026 09:00');
  const h = history([op('19.11.2026', '06:32:00', '20', 'Start'), op('18.11.2026', '14:00:00', '10', 'Koniec', 'ola@x', true)]);
  assert.deepEqual(h.map((x) => [x.nr, x.time, x.who, x.archive]), [['10', '14:00', 'ola', true], ['20', '06:32', 'jan', false]]);
});

test('celownik: wybór kodu przy kilku w kadrze, kształt z logo', () => {
  const pts = reticlePoints([100, 100], 100);
  assert.equal(pts.length, 6); assert.deepEqual(pts[0].map((v) => Math.round(v)), [63, 127]);
  const big = { rawValue: 'A', corners: [[30, 30], [170, 30], [170, 170], [30, 170]] };
  const small = { rawValue: 'B', corners: [[95, 95], [105, 95], [105, 105], [95, 105]] };
  const far = { rawValue: 'C', corners: [[300, 300], [340, 300], [340, 340], [300, 340]] };
  assert.equal(pickCode([far, big], [100, 100], 100).rawValue, 'A');      // cały celownik na kodzie
  assert.equal(pickCode([far, small], [100, 100], 100).rawValue, 'B');    // kod pod środkiem celownika
  assert.equal(pickCode([far], [100, 100], 100).rawValue, 'C');           // jedyny kod w kadrze
  assert.equal(pickCode([far, { ...far, rawValue: 'D' }], [100, 100], 100), null);
  assert.equal(inside(big.corners, [100, 100]), true);
  assert.match(reticleSvg(60, true), /drop-shadow/); assert.doesNotMatch(reticleSvg(60, false), /drop-shadow/);
});
