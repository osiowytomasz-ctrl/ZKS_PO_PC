import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSimValue, applySim, fmtDelta, changesCsv, loadPrefs, savePrefs, PREF_KEY, FEATURES } from '../src/renderer/js/report/runtime.js';
import { interactiveHtml } from '../src/renderer/js/logic/harmReport.js';
import { RUNTIME } from '../src/renderer/js/report/runtime.bundle.js';

const ops = () => ({ 100: { preds: [], hours: 8, station: '1Si' }, 200: { preds: ['100'], hours: 4 }, '200a': { preds: [], hours: 1 } });

test('symulacja: wartości z pól, zmiany, cofanie danych i lista zmian', () => {
  assert.deepEqual(parseSimValue(ops(), '100', 'hours', '7,5'), { value: 7.5 });
  assert.ok(parseSimValue(ops(), '100', 'hours', 'abc').error);
  assert.equal(parseSimValue(ops(), '100', 'startManual', '14.11.2026 14:00').value, Date.UTC(2026, 10, 14, 14));
  assert.ok(parseSimValue(ops(), '100', 'endManual', '31.02.2026').error);
  assert.match(parseSimValue(ops(), '100', 'pred', '200', 0).error, /cykl/);   // 200 czeka na 100 – pętla
  assert.deepEqual(parseSimValue(ops(), '200', 'pred', '', 0), { field: 'preds', value: [] });
  const { ops: o2, change } = applySim(ops(), '100', 'hours', 20);
  assert.equal(o2[100].hours, 20); assert.equal(ops()[100].hours, 8); assert.deepEqual(change, { id: '100', field: 'hours', old: 8, value: 20 });
  assert.equal(applySim(ops(), '100', 'hours', null).ops[100].hours, undefined);
  assert.equal(fmtDelta(26 * 3600000), '+1 d 2 h'); assert.equal(fmtDelta(-3 * 3600000), '−3 h'); assert.equal(fmtDelta(0), '');
  const csv = changesCsv([change], new Map([['100', { end: 0 }]]), new Map([['100', { end: 12 * 3600000 }]]));
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /"100";"Czas \[h\]";"8";"20"/); assert.match(csv, /\+12 h/);
});

test('ustawienia: jeden wpis w przeglądarce, wspólny dla wszystkich plików (nadpisywany)', () => {
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadPrefs(store), null);
  savePrefs(store, { zoom: 1.2 }); savePrefs(store, { zoom: 0.8, hidden: ['client'] });
  assert.equal(mem.size, 1); assert.ok(mem.has(PREF_KEY)); assert.deepEqual(loadPrefs(store).hidden, ['client']); assert.equal(loadPrefs(store).zoom, 0.8);
  savePrefs(store, { big: 'x'.repeat(30000) }); assert.equal(loadPrefs(store).zoom, 0.8);              // za duże – nie zapisuje (bez zapychania pamięci)
  assert.ok(FEATURES.length >= 25);
});

test('plik HTML: dane bezpieczne w <script>, skrypt dołączony, bez „</script” w środku', () => {
  const html = interactiveHtml({ title: 'T <b>', ops: { 1: { element: '</script><b>' } } }, RUNTIME);
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(html.includes('id="zks-data"')); assert.ok(html.includes('\\u003c/script>')); assert.ok(html.includes('<title>T &lt;b&gt;</title>'));
  assert.ok(RUNTIME.length > 20000 && !/<\/script/i.test(RUNTIME));
});

test('funkcje pliku: wybór autora blokuje na stałe, oglądający może tylko wyłączać, dodatki symulacji idą za symulacją', async () => {
  const { effectiveFeatures, featureLocked } = await import('../src/renderer/js/report/runtime.js');
  const all = effectiveFeatures(null, null);
  assert.ok(Object.values(all).every(Boolean));
  const f = effectiveFeatures({ csv: false, sim: false }, { csv: true, zoom: false, sim: true });
  assert.equal(f.csv, false); assert.equal(f.sim, false); assert.equal(f.simAdd, false); assert.equal(f.compare, false); assert.equal(f.zoom, false); assert.equal(f.search, true);
  assert.ok(featureLocked({ sim: false }, 'simSave')); assert.ok(!featureLocked({ sim: false }, 'search')); assert.ok(!featureLocked(null, 'csv'));
});
