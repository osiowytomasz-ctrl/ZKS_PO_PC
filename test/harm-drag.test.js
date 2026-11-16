import test from 'node:test';
import assert from 'node:assert/strict';
import { planDrag, canDrag, isLocked, effStation } from '../src/renderer/js/logic/harmDrag.js';
import { buildCapacity, computeSchedule, DAY_MS } from '../src/renderer/js/logic/schedule.js';

const D0 = Date.UTC(2026, 10, 2);                 // poniedziałek
const H = 3600000;
const capOf = (h) => buildCapacity(Array.from({ length: 120 }, (_, i) => ({ date: D0 + i * DAY_MS, hours: h })));
const CAP = { A: capOf(24), B: capOf(24) };
const run = (ops) => computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), CAP);
const preds = (ops, lp) => ops[lp].preds || [];

// kolejka stanowiska A: 1 → 2 → 3 → 4 (po 10 h), technologicznie 10 (B) po 2
const base = () => ({
  1: { station: 'A', hours: 10, startManual: D0 + 6 * H, preds: [] },
  2: { station: 'A', hours: 10, preds: ['1'] },
  3: { station: 'A', hours: 10, preds: ['2'] },
  4: { station: 'A', hours: 10, preds: ['3'] },
  10: { station: 'B', hours: 5, preds: ['2'] },
});

test('przesunięcie w przód kolejki: zależności przepięte, start liczy silnik', () => {
  const ops = base(), r = run(ops);
  const p = planDrag(ops, r, '4', r.get('1').start + H);
  assert.ok(p.ok, p.reason);
  assert.equal(p.after, '1');
  assert.deepEqual(preds(p.ops, '4'), ['1']);
  assert.deepEqual(preds(p.ops, '2'), ['4']);                 // następca 1 czeka teraz na 4
  assert.deepEqual(preds(p.ops, '3'), ['2']);
  assert.equal(p.ops['4'].startManual, undefined);              // bez ręcznej daty
  const r2 = run(p.ops);
  assert.equal(r2.get('4').start, r.get('1').end);
  assert.equal(r2.get('2').start, r2.get('4').end);
  assert.deepEqual(preds(p.ops, '10'), ['2']);                  // zależność technologiczna bez zmian
  assert.deepEqual(p.changed.sort(), ['2', '4']);
});

test('przesunięcie na koniec: mostek nad wyjętą operacją', () => {
  const ops = base(), r = run(ops);
  const p = planDrag(ops, r, '2', r.get('4').start + 2 * H);
  assert.ok(p.ok, p.reason);
  assert.deepEqual(preds(p.ops, '3'), ['1']);                   // 3 czekało na 2 → czeka na poprzednika 2
  assert.deepEqual(preds(p.ops, '2'), ['4']);
  const r2 = run(p.ops);
  assert.equal(r2.get('3').start, r.get('1').end);
  assert.equal(r2.get('2').start, r2.get('4').end);
  assert.equal(r2.get('10').start, r2.get('2').end);            // B dalej czeka na 2 (przesunięte)
});

test('upuszczenie w tym samym miejscu nic nie zmienia', () => {
  const ops = base(), r = run(ops);
  const p = planDrag(ops, r, '3', r.get('3').start - H);
  assert.ok(p.ok);
  assert.deepEqual(p.patches, []);
});

test('ręczny start i koniec: zablokowana, nieprzepinana', () => {
  const ops = base();
  ops[3] = { ...ops[3], startManual: D0 + 30 * H, endManual: D0 + 40 * H };
  assert.ok(isLocked(ops[3]));
  assert.equal(canDrag(ops, '3').ok, false);
  const r = run(ops);
  const p = planDrag(ops, r, '4', r.get('1').start + H);
  assert.ok(p.ok, p.reason);
  assert.deepEqual(preds(p.ops, '2'), ['4']);
  assert.deepEqual(preds(p.ops, '3'), ['2']);                   // zablokowanej nie przepinamy
  assert.equal(run(p.ops).get('3').start, D0 + 30 * H);         // i stoi w miejscu
  const q = planDrag(ops, r, '2', r.get('4').start + H);        // 2 za 4, a zablokowana 3 nadal czeka na 2 → 4 → 3 → 2
  assert.equal(q.ok, false);
  assert.match(q.reason, /cykl/);
});

test('przed wszystkimi: pierwsza w kolejce z ręcznym startem', () => {
  const ops = base(), r = run(ops);
  const t = r.get('1').start - 5 * H;
  const p = planDrag(ops, r, '3', t);
  assert.ok(p.ok, p.reason);
  assert.equal(p.after, null);
  assert.deepEqual(preds(p.ops, '3'), []);
  assert.equal(p.ops['3'].startManual, t);
  assert.deepEqual(preds(p.ops, '4'), ['2']);
});

test('ręczny start (bez końca) przesuwa się z paskiem', () => {
  const ops = base(), r = run(ops);
  const p = planDrag(ops, r, '1', r.get('2').start + 3.4 * H);
  assert.ok(p.ok, p.reason);
  assert.equal(p.ops['1'].startManual, r.get('2').start + 3 * H);   // zaokrąglenie do pełnej godziny
  assert.deepEqual(preds(p.ops, '1'), ['2']);
  assert.deepEqual(preds(p.ops, '2'), []);
  assert.equal(p.ops['2'].startManual, undefined);
});

test('cykl przez inne stanowisko – odrzucone', () => {
  const ops = base();
  ops[20] = { station: 'B', hours: 5, preds: ['2'] };
  ops[5] = { station: 'A', hours: 5, preds: ['20'] };
  const r = run(ops);
  const p = planDrag(ops, r, '2', r.get('5').start + H);
  assert.equal(p.ok, false);
  assert.match(p.reason, /cykl/);
});

test('suboperacje: bez zbędnej zależności od wcześniejszej litery, stanowisko dziedziczone', () => {
  const ops = {
    1: { station: 'A', hours: 10, startManual: D0 + 6 * H, preds: [] },
    100: { station: 'A', preds: ['1'] }, '100a': { hours: 5, preds: [] }, '100b': { hours: 5, preds: [] },
  };
  assert.equal(effStation(ops, '100b'), 'A');
  assert.equal(canDrag(ops, '100').ok, false);                  // węzeł złożony z suboperacji
  const r = run(ops);
  const p = planDrag(ops, r, '100b', r.get('100a').start + H);
  assert.ok(p.ok, p.reason);
  assert.deepEqual(preds(p.ops, '100b'), []);                   // 100a i tak jest przed 100b
});

test('ponad 4 zależności – odrzucone', () => {
  const ops = base();
  for (const k of [30, 31, 32, 33]) ops[k] = { station: 'B', hours: 1, preds: [], startManual: D0 + 6 * H };
  ops[4] = { ...ops[4], preds: ['3', '30', '31', '32'] };
  ops[2] = { ...ops[2], preds: ['1', '33', '30', '31'] };
  const r = run(ops);
  const p = planDrag(ops, r, '4', r.get('1').start + H);       // 4: 30,31,32 + 1 = 4 OK; 2: 33,30,31 + 4 = 4 OK
  assert.ok(p.ok, p.reason);
  ops[2] = { ...ops[2], preds: ['1', '33', '30', '31'] };
  ops[3] = { ...ops[3], preds: ['2', '30', '31', '32'] };
  ops[4] = { ...ops[4], preds: ['3', '33'] };
  const r2 = run(ops);
  const p2 = planDrag(ops, r2, '1', r2.get('3').start + H);    // 2 traci 1 – ok; 4 czeka na 1 zamiast 3? (1 wstawione za 3)
  assert.ok(p2.ok, p2.reason);
  ops[4] = { ...ops[4], preds: ['3', '30', '31', '32'] };
  ops[2] = { ...ops[2], preds: ['1', '33', '32', '30'] };
  const r3 = run(ops);
  const p3 = planDrag(ops, r3, '3', r3.get('4').start + H);    // mostek: 4 czeka na poprzedników 3 z kolejki (2) – 4 zależności OK
  assert.ok(p3.ok, p3.reason);
  ops[3] = { ...ops[3], preds: ['2', '1'] };
  ops[4] = { ...ops[4], preds: ['3', '30', '31', '32'] };
  const r4 = run(ops);
  const p4 = planDrag(ops, r4, '3', r4.get('4').start + H);    // mostek dałby 4 → 2, 1, 30, 31, 32 = 5
  assert.equal(p4.ok, false);
  assert.match(p4.reason, /najwyżej 4/);
});
