import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/renderer/js/logic/presence.js';

test('historię widzą tylko Osiowy Tomasz, Kumała Łukasz, Skupnik Adam (bez względu na wielkość liter i polskie znaki)', () => {
  assert.ok(P.canSeeHistory('Osiowy Tomasz')); assert.ok(P.canSeeHistory('kumala łukasz')); assert.ok(P.canSeeHistory('Kumała Łukasz')); assert.ok(P.canSeeHistory('  SKUPNIK  Adam '));
  assert.ok(!P.canSeeHistory('Kowalski Jan')); assert.ok(!P.canSeeHistory('')); assert.ok(!P.canSeeHistory(null));
});

test('stan do zapisu i wpis dziennika', () => {
  const now = Date.UTC(2026, 10, 23, 10, 5);
  const s = P.makeState({ name: ' Jan Kowalski ', email: 'j@x.pl' }, { status: 'busy', note: ' cnc 3 ', until: '9.30' }, now);
  assert.deepEqual(s, { name: 'Jan Kowalski', email: 'j@x.pl', status: 'busy', note: 'cnc 3', until: '09:30', updatedAt: now });
  assert.equal(P.makeState({ name: 'X' }, { status: 'nie-ma' }), null);
  const l = P.makeLogEntry('abcdef123456', s, 'available');
  assert.equal(l.entry.prev, 'available'); assert.equal(l.entry.ts, now); assert.ok(l.key.endsWith('_abcdef12'));
  assert.ok(P.changed(null, s)); assert.ok(!P.changed(s, { ...s, updatedAt: now + 5 })); assert.ok(P.changed(s, { ...s, note: 'inna' }));
  assert.equal(P.untilText('25:00'), ''); assert.equal(P.untilText('7:05'), '07:05');
});

test('nieaktualny status, sortowanie listy, dni dziennika i wpisy', () => {
  const now = Date.now();
  assert.ok(P.isStale({ updatedAt: now - 13 * 3600 * 1000 }, now)); assert.ok(!P.isStale({ updatedAt: now - 3600 * 1000 }, now)); assert.ok(P.isStale(null, now));
  const list = [{ name: 'B', status: 'busy', updatedAt: now }, { name: 'C', status: 'available', updatedAt: now - 20 * 3600 * 1000 }, { name: 'A', status: 'available', updatedAt: now }];
  assert.deepEqual(P.sortPresence(list, now).map((p) => p.name), ['A', 'B', 'C']);
  const days = P.lastDays(Date.UTC(2026, 10, 23, 12), 3); assert.equal(days.length, 3); assert.equal(days[0], P.dayKey(Date.UTC(2026, 10, 23, 12)));
  const docs = { '2026-11-23': { e: { a: { name: 'A', ts: 5 }, b: { name: 'B', ts: 9 } } }, '2026-11-22': { e: { c: { name: 'A', ts: 2 } } } };
  assert.deepEqual(P.logEntries(docs).map((e) => e.ts), [9, 5, 2]); assert.deepEqual(P.logEntries(docs, 'A').map((e) => e.ts), [5, 2]);
});

test('wersja i urządzenie przy nazwisku: tylko Osiowy Tomasz; urządzenia osoby (PC przed Androidem), dawno nieużywane', () => {
  assert.ok(P.canSeeDevices('Osiowy Tomasz')); assert.ok(P.canSeeDevices(' osiowy  tomasz ')); assert.ok(!P.canSeeDevices('Skupnik Adam')); assert.ok(!P.canSeeDevices('Kumała Łukasz')); assert.ok(!P.canSeeDevices(''));
  const now = 1e12;
  assert.deepEqual(P.makeDevice({ name: 'Jan K', email: 'j@x.pl' }, 'pc', '1.93.0', now), { name: 'Jan K', email: 'j@x.pl', platform: 'pc', ver: '1.93.0', seenAt: now });
  assert.equal(P.makeDevice({ name: 'X' }, 'windows', '1'), null);
  assert.equal(P.makeDevice({ name: 'X', email: 'x@y.pl' }, 'ios', '2.0').platform, 'ios');   // wersja na iPhone'a
  assert.deepEqual(P.devicesFor('u1', { u1_ios: { platform: 'ios', ver: '1', seenAt: 5 }, u1_pc: { platform: 'pc', ver: '2', seenAt: 5 }, u1_android: { platform: 'android', ver: '3', seenAt: 5 } }, 6).map((d) => d.platform), ['pc', 'android', 'ios']);
  const devs = new Map([['u1_android', { platform: 'android', ver: '1.38.0', seenAt: now - 1000 }], ['u1_pc', { platform: 'pc', ver: '1.93.0', seenAt: now - 8 * 86400000 }], ['u2_pc', { platform: 'pc', ver: '1.0', seenAt: now }]]);
  const d = P.devicesFor('u1', devs, now);
  assert.deepEqual(d.map((x) => [x.platform, x.ver, x.stale]), [['pc', '1.93.0', true], ['android', '1.38.0', false]]);
  assert.deepEqual(P.devicesFor('u3', devs, now), []);
});
