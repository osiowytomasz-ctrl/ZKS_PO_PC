import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../src/renderer/js/logic/wfNotify.js';

const rec = (row, st, extra = {}) => ({ row, A: st === 'A' ? 'x' : '', B: st === 'B' ? 'x' : '', C: st === 'C' ? 'x' : '', D: '', E: 'komis', F: 'opis zadania', G: 'Jan Nowak', ...extra });

test('status zadania i rozpoznanie zlecającego', () => {
  assert.equal(N.taskStatus(rec(1, 'B')), 'B'); assert.equal(N.taskStatus(rec(1, '')), '');
  assert.ok(N.isMine('Nowak Jan', 'Jan Nowak')); assert.ok(N.isMine('J. Kumała', 'Kumala Łukasz')); assert.ok(!N.isMine('Kowalski', 'Jan Nowak')); assert.ok(!N.isMine('', 'Jan Nowak'));
});

test('zdarzenia: pierwsze wczytanie bez zdarzeń, nowe zadanie, zmiana statusu, tylko moje', () => {
  const recs = [rec(1, 'B'), rec(2, '')], snap = N.snapshotOf(recs);
  assert.deepEqual(N.diffTasks(null, recs, 'Jan Nowak'), []);
  const next = [rec(1, 'A'), rec(2, ''), rec(3, 'B', { G: 'Kowalski A' })];
  const ev = N.diffTasks(snap, next, 'Jan Nowak', undefined, 1000);
  assert.deepEqual(ev.map((e) => e.type + e.row), ['status1', 'new3']); assert.match(ev[0].title, /W trakcie → Zakończone/); assert.ok(ev[0].mine);
  assert.deepEqual(N.diffTasks(snap, next, 'Jan Nowak', { newTasks: false }, 1).map((e) => e.type), ['status']);
  assert.deepEqual(N.diffTasks(snap, [rec(1, 'A', { G: 'Kowalski' })], 'Jan Nowak', { mineOnly: true }, 1), []);
  assert.deepEqual(N.diffTasks(snap, next, 'Jan Nowak', { status: false, newTasks: false }, 1), []);
});

test('migawka do zapisu i przypomnienie o zaległych', () => {
  const recs = [rec(1, 'B'), rec(2, 'C', { G: 'a|b' })];
  assert.deepEqual([...N.objToSnap(N.snapToObj(N.snapshotOf(recs))).entries()], [...N.snapshotOf(recs).entries()]);
  const now = new Date(2026, 10, 23, 12).getTime(), d = (days) => { const t = new Date(now - days * 86400000); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}.${p(t.getMonth() + 1)}.${p(t.getDate())} 08:00`; };
  const list = [rec(1, 'C', { D: d(10) }), rec(2, 'C', { D: d(2) }), rec(3, 'B', { D: d(20) }), rec(4, 'B', { D: d(3) }), rec(5, 'A', { D: d(50) }), rec(6, 'C', { D: '' })];
  const e = N.staleDigest(list, undefined, now);
  assert.equal(e.type, 'stale'); assert.match(e.text, /wstrzymane ponad 7 dni: 1/); assert.match(e.text, /w trakcie ponad 14 dni: 1/);
  assert.equal(N.staleDigest(list, { stale: false }, now), null); assert.equal(N.staleDigest([rec(1, 'A', { D: d(90) })], undefined, now), null);
  assert.equal(N.normSettings({ heldDays: 0, sound: 1 }).heldDays, 7); assert.equal(N.normSettings({ sound: 1 }).sound, true);
});
