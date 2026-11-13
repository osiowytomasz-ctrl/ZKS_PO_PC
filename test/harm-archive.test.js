import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveCandidates } from '../src/renderer/js/logic/harmArchive.js';

const D = (d) => Date.UTC(2026, 0, d);
const ops = () => ({
  100: { preds: [], status: 'zak.', endManual: D(5) },                                           // stare, zakończone – do archiwum
  200: { preds: [] }, '200a': { preds: [], status: 'zak.', endManual: D(6) }, '200b': { preds: [], status: 'zak.', endManual: D(7) },   // całe drzewo zakończone
  300: { preds: [] }, '300a': { preds: [], status: 'zak.', endManual: D(6) }, '300b': { preds: [], hours: 5 },                         // niezakończone dziecko – zostaje
  400: { preds: [], status: 'zak.', endManual: D(8) }, 500: { preds: ['400'], hours: 3 },                                              // 500 zależy od 400 – 400 zostaje
  600: { preds: [], status: 'zak.', endManual: D(200) },                                                                               // za świeże
});

test('archiwum: tylko całe zakończone drzewa, starsze niż data, bez zależnych operacji', () => {
  const c = archiveCandidates(ops(), new Map(), D(100));
  assert.deepEqual(c.map((x) => x.root), ['100', '200']);
  assert.deepEqual(c.find((x) => x.root === '200').lps.sort(), ['200', '200a', '200b']);
  assert.equal(c[0].end, D(5));
  assert.deepEqual(archiveCandidates(ops(), new Map(), D(1)), []);
  // zależność od suboperacji drzewa też je zatrzymuje
  const o = ops(); o[500].preds = ['200b'];
  assert.deepEqual(archiveCandidates(o, new Map(), D(100)).map((x) => x.root), ['100', '400']);
});

test('limit dokumentu bazy: ostrzeżenie, gdy paczka zbliża się do 1 MB', async () => {
  globalThis.window = globalThis.window || {};
  const { chunkSizeWarning } = await import('../src/renderer/js/harmStore.js').catch(() => ({}));
  if (!chunkSizeWarning) return;   // moduł wymaga przeglądarki – sprawdzane w teście e2e
  assert.equal(chunkSizeWarning(['100'], { 100: { element: 'x' } }), null);
  assert.match(chunkSizeWarning(['100'], { 100: { element: 'x'.repeat(800 * 1024) } }), /limitu 1 MB/);
});
