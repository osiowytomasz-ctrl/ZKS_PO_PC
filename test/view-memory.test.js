// Pamięć filtrów, sortowania i szukania modułów (logic/viewMemory.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewMemory, packFilters, unpackFilters } from '../src/renderer/js/logic/viewMemory.js';
import { rangeFilter } from '../src/renderer/js/logic/tableFilter.js';

const withStorage = (fn) => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try { return fn(m); } finally { delete globalThis.localStorage; }
};

test('filtry kolumn: zbiór wartości i zakres dat przeżywają zapis i odczyt', () => {
  const packed = packFilters({ a: new Set(['x', 'y']), d: rangeFilter(1000, 2000), t: 'tekst', puste: '' });
  assert.deepEqual(packed, { a: ['x', 'y'], d: { range: true, from: 1000, to: 2000 }, t: 'tekst' });
  const back = unpackFilters(JSON.parse(JSON.stringify(packed)));
  assert.ok(back.a instanceof Set && back.a.has('x') && !back.a.has('z'));
  assert.equal(back.d.range, true); assert.equal(back.d.from, 1000); assert.equal(back.d.to, 2000);
  assert.equal(back.t, 'tekst');
});

test('viewMemory: filtry, sortowanie i szukanie wracają po ponownym otwarciu widoku (osobno dla każdego klucza)', () => withStorage(() => {
  const a = { filters: { kol: new Set(['A']) }, sorts: [{ key: 'kol', ascending: false }], search: 'abc' };
  viewMemory('mistrz', a, ['filters', 'sorts', 'search']).save('mistrz.ops');
  const b = { filters: {}, sorts: [], search: '' };
  assert.equal(viewMemory('mistrz', b, ['filters', 'sorts', 'search']).load('mistrz.ops'), true);
  assert.deepEqual([...b.filters.kol], ['A']); assert.deepEqual(b.sorts, [{ key: 'kol', ascending: false }]); assert.equal(b.search, 'abc');
  const c = { filters: { z: 1 }, sorts: [], search: '' };
  assert.equal(viewMemory('mistrz', c, ['filters', 'sorts', 'search']).load('mistrz.docs'), false);   // inna zakładka – nic nie zapisano
  assert.deepEqual(c.filters, { z: 1 });
}));

test('viewMemory: proste filtry-teksty dopisują się do pustego zestawu pól; nieznane kolumny są pomijane przy „valid”', () => withStorage(() => {
  const empty = () => ({ group: '', type: '', diameter: '' });
  const a = { filters: { ...empty(), group: 'G1', diameter: '12' } };
  viewMemory('bn', a, ['simpleFilters']).save();
  const b = { filters: empty() };
  viewMemory('bn', b, ['simpleFilters']).load();
  assert.deepEqual(b.filters, { group: 'G1', type: '', diameter: '12' });
  const c = { filters: { x: new Set(['1']), y: new Set(['2']) }, sorts: [{ key: 'y', ascending: true }, { key: 'x', ascending: true }] };
  viewMemory('v', c, ['filters', 'sorts']).save();
  const d = { filters: {}, sorts: [] };
  viewMemory('v', d, ['filters', 'sorts'], ['x']).load();
  assert.deepEqual(Object.keys(d.filters), ['x']); assert.deepEqual(d.sorts.map((s) => s.key), ['x']);
}));

test('viewMemory: zwykłe pola (q, sort, dir, wartości logiczne) i brak pamięci nie psują działania', () => {
  withStorage(() => {
    const a = { q: 'kod', sort: 'date', dir: -1, noPct: true };
    viewMemory('destroyed', a, ['q', 'sort', 'dir', 'noPct']).save();
    const b = { q: '', sort: 'code', dir: 1, noPct: false };
    viewMemory('destroyed', b, ['q', 'sort', 'dir', 'noPct']).load();
    assert.deepEqual(b, a);
  });
  assert.equal(viewMemory('x', {}, ['q']).load(), false);   // bez localStorage (np. tryb prywatny) – tylko brak zapisanych danych
  assert.doesNotThrow(() => viewMemory('x', { q: '1' }, ['q']).save());
});

test('moduły trzymane w tle w sesji (app.js): wszystkie identyfikatory z listy istnieją w MODULES, a Skaner (kamera) i Ustawienia nie są trzymane', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/renderer/js/app.js', import.meta.url), 'utf8');
  const keep = (src.match(/const KEEP_IDS = new Set\(\[([^\]]*)\]\)/) || [, ''])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  assert.ok(keep.length > 5);
  for (const id of keep) assert.ok(src.includes(`id: '${id}'`), id);
  assert.ok(!keep.includes('skaner') && !keep.includes('home') && !keep.includes('settings'));
});

test('moduły w tle: po ponownym pokazaniu ekran odzyskuje swój układ (display ustawiony przez moduł), inaczej tabela traci własne przewijanie', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/renderer/js/app.js', import.meta.url), 'utf8');
  assert.match(src, /dataset\.disp = c\.style\.display/);
  assert.match(src, /screen\.style\.display = screen\.dataset\.disp \|\| ''/);
});
