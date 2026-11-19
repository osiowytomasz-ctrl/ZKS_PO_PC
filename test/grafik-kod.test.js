// Grafik na telefonie (backend/GrafikKo.html + GrafikKod.gs): kolory jak w programie, kody i skróty jak na serwerze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as F from '../src/renderer/js/logic/grafikFb.js';
import { newCode, hashCode, codeRows, hashesOf, SALT } from '../src/renderer/js/logic/grafikCodes.js';

const html = readFileSync(new URL('../backend/GrafikKo.html', import.meta.url), 'utf8');
const gs = readFileSync(new URL('../backend/GrafikKod.gs', import.meta.url), 'utf8');

test('kolory strony telefonu = cellStyle / headerStyle programu', () => {
  const src = html.split('// <cellStyle>')[1].split('// </cellStyle>')[0].replace(/^[^\n]*\n/, '');
  const page = new Function(src + '; return { cellStyle, headerStyle };')();
  const codes = ['', 'a8', 'b8', 'c8', 'aa12', 'UT', 'L4', 'KW', 'BHP', 'BO', 'Op', 'Hdk', 'Nż', 'Ojc', 'OKL', 'x.w', 'V', 'sz', 'Egz', 'AUDIT', 'a?', '?', '!!', 'X*', 'zz'];
  const days = ['2026-11-18', '2026-11-19', '2026-11-21', '2026-11-22', '2026-11-25'];
  for (const c of codes) for (const iso of days) for (const hour of [5, 12, 18, 23]) for (const holiday of [false, true]) {
    const ctx = { todayIso: '2026-11-19', hour, holiday };
    assert.deepEqual(page.cellStyle(c, iso, ctx), F.cellStyle(c, iso, ctx), `${c} ${iso} ${hour}`);
  }
  for (const iso of days) for (const hol of [false, true]) assert.deepEqual(page.headerStyle(iso, hol), F.headerStyle(iso, hol));
});

test('kod: 8 cyfr, skrót jak grk_hash_ na serwerze', async () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^[1-9]\d{7}$/);
  assert.equal(newCode((n) => new Uint32Array(n)), '10000000');
  assert.ok(gs.includes(`var GRK_SALT = '${SALT}';`));
  assert.equal(await hashCode('12345678'), createHash('sha256').update(SALT + '12345678').digest('hex'));
});

test('wiersze okna kodów', () => {
  const people = [{ id: 's', name: 'ZMIANA', sep: true }, { id: 'a', name: 'Anna', place: '1Si1' }, { id: 'b', name: 'Bartek' }];
  const codes = { h1: { pid: 'a', at: 5 }, h2: { pid: 'x' } };
  const rows = codeRows(people, codes);
  assert.deepEqual(rows.map((r) => [r.pid, r.code && r.code.hash]), [['a', 'h1'], ['b', null]]);
  assert.deepEqual(hashesOf({ ...codes, h3: { pid: 'a' } }, 'a'), ['h1', 'h3']);
});

test('Użytkownicy i klucze: adres e-mail i tekst do przekazania', async () => {
  globalThis.window = globalThis.window || {};
  const { validEmail, shareText } = await import('../src/renderer/js/views/usersAdmin.js');
  assert.ok(validEmail(' Jan.K@firma.pl ')); assert.ok(!validEmail('jan@firma')); assert.ok(!validEmail('a b@c.pl'));
  assert.equal(shareText(' https://x/exec ', ' K1 '), 'Adres API: https://x/exec\nKlucz: K1');
});
