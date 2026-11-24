// Adres API w bazie: składnia, przyjmowanie z bazy, odczyt REST (fetch podstawiony).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../src/main/apiLink.cjs');

const GOOD = 'https://script.google.com/macros/s/AKfycbyAAAAAAAAAAAAAAAAAAAAAAAAAA/exec';

test('składnia adresu: poprawny, z końcówką / zapytaniem, błędne', () => {
  assert.deepEqual(L.checkLink(` ${GOOD}/?x=1#a `), { ok: true, url: GOOD });
  assert.deepEqual(L.checkLink('https://script.google.com/a/macros/firma.pl/s/AKfycbyAAAAAAAAAAAAAAAAAAAAAAAAAA/exec').ok, true);
  assert.equal(L.checkLink('').ok, false);
  assert.match(L.checkLink('http://script.google.com/macros/s/x/exec').error, /https/);
  assert.match(L.checkLink('https://script.google.com/macros/s/AKfycbyAAAAAAAAAAAAAAAAAAAAAAAAAA/dev').error, /exec/);
  assert.equal(L.checkLink('https://example.com/macros/s/AKfycbyAAAAAAAAAAAAAAAAAAAAAAAAAA/exec').ok, false);
});
test('przyjmowanie adresu z bazy: tylko nowszy albo gdy lokalnie brak; force po błędzie połączenia', () => {
  const remote = { url: GOOD, ver: 3 };
  assert.equal(L.shouldAdopt(remote, { url: '', linkVer: 0 }), true);                          // pierwszy start
  assert.equal(L.shouldAdopt(remote, { url: GOOD + '/', linkVer: 3 }), false);                  // ten sam adres
  assert.equal(L.shouldAdopt(remote, { url: 'https://stary', linkVer: 2 }), true);             // nowsza wersja
  assert.equal(L.shouldAdopt(remote, { url: 'https://script.google.com/macros/s/BBBBBBBBBBBBBBBBBBBBBBBBBBBBB/exec', linkVer: 3 }), false); // administrator wpisał nowy, jeszcze nie zapisał
  assert.equal(L.shouldAdopt(remote, { url: 'https://script.google.com/macros/s/BBBBBBBBBBBBBBBBBBBBBBBBBBBBB/exec', linkVer: 3 }, true), true);   // po błędzie połączenia
  assert.equal(L.shouldAdopt({ url: 'zły', ver: 9 }, { url: '', linkVer: 0 }), false);          // zepsuty wpis w bazie nie jest przyjmowany
});
test('odczyt z bazy (REST): wpis, brak wpisu, błąd', async () => {
  const doc = { fields: { url: { stringValue: GOOD }, ver: { integerValue: '4' }, updatedAt: { integerValue: '1700000000000' }, updatedBy: { stringValue: 'Admin' } } };
  const ok = await L.fetchRemoteLink(async (u) => { assert.match(u, /app_config\/api\?key=/); return { status: 200, ok: true, json: async () => doc }; });
  assert.deepEqual(ok, { ok: true, link: { url: GOOD, ver: 4, updatedAt: 1700000000000, updatedBy: 'Admin' } });
  assert.deepEqual(await L.fetchRemoteLink(async () => ({ status: 404, ok: false })), { ok: true, link: null });
  assert.deepEqual(await L.fetchRemoteLink(async () => { throw new Error('offline'); }), { ok: false });
  assert.deepEqual(await L.fetchRemoteLink(async () => ({ status: 403, ok: false })), { ok: false });
});
