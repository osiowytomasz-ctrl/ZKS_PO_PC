import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/renderer/js/logic/chat.js';

test('rozmowa prywatna ma ten sam identyfikator dla obu osób, dokument dnia', () => {
  assert.equal(C.dmId('b', 'a'), C.dmId('a', 'b')); assert.ok(C.dmId('a', 'b').startsWith('dm_')); assert.equal(C.docId('all', '2026-11-23'), 'all__2026-11-23');
  assert.equal(C.dayStart('2026-11-23'), new Date(2026, 10, 23).getTime());
});

test('wiadomość: tekst przycięty, pusta odrzucona; scalanie z okresem przechowywania 3 dni', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  assert.equal(C.makeMessage('u1', 'Jan', '   ', now), null);
  const m = C.makeMessage('u1', ' Jan K ', 'x'.repeat(600), now); assert.equal(m.msg.x.length, C.MAX_TEXT); assert.equal(m.msg.n, 'Jan K'); assert.ok(m.key.startsWith(String(now)));
  const docs = { a: { m: { k1: { u: 'u1', x: 'stara', ts: now - 4 * 86400000 }, k2: { u: 'u2', x: 'wczoraj', ts: now - 86400000 } } }, b: { m: { k3: { u: 'u1', x: 'dziś', ts: now - 1000 } } } };
  assert.deepEqual(C.mergeMessages(docs, now).map((x) => x.x), ['wczoraj', 'dziś'], 'starsze niż 3 dni niewidoczne, od najstarszej');
});

test('nieprzeczytane, etykiety dni, dni do wczytania i do usunięcia', () => {
  const msgs = [{ u: 'me', ts: 5 }, { u: 'x', ts: 6 }, { u: 'x', ts: 9 }];
  assert.equal(C.unreadCount(msgs, 'me', 0), 2); assert.equal(C.unreadCount(msgs, 'me', 6), 1);
  const now = new Date(2026, 10, 23, 12).getTime();
  assert.equal(C.dayLabel(now, now), 'Dzisiaj'); assert.equal(C.dayLabel(now - 86400000, now), 'Wczoraj'); assert.equal(C.dayLabel(now - 5 * 86400000, now), '18.11');
  assert.equal(C.readDays(now).length, 4); assert.equal(C.expiredDays(now)[0], '2026-11-19'); assert.equal(C.expiredDays(now).length, 7);
});
