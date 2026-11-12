import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { harmAccess, legacyLevel, normLevel, treePlanBlock } from '../src/renderer/js/logic/harmAccess.js';
import { treeFromOps, addChild, removeNode, renameNode, planTree } from '../src/renderer/js/logic/harmTree.js';

test('poziomy dostępu: uprawnienia', () => {
  assert.deepEqual(['god', 'master', 'clerik', 'tourist', 'none'].map((l) => { const a = harmAccess(l); return [a.view, a.add, a.edit, a.del, a.style].map(Number).join(''); }),
    ['11111', '11100', '11000', '10000', '00000']);
  assert.equal(normLevel('GOD'), 'god'); assert.equal(normLevel('---'), 'none'); assert.equal(normLevel('xyz'), null);
  assert.equal(harmAccess('xyz').level, 'none');
  assert.equal(legacyLevel({ plan: 'write' }), 'god'); assert.equal(legacyLevel({ grafik: 'read' }), 'tourist'); assert.equal(legacyLevel({}), 'none');
});

const ops = () => ({ 600: { element: 'Zespół', preds: [] }, '600a': { element: 'Cz.d', station: '2Un', hours: 5, preds: [] }, 700: { element: 'Inna', preds: [] } });
const plan = (o, nodes, root) => planTree(o, treeFromOps(o, root).map((n) => n.orig), nodes, { stations: ['2Un'], parseNum: Number });

test('edytor gałęzi: CLERIK tylko dodaje, MASTER bez usuwania', () => {
  const o = ops(), t = treeFromOps(o, '600');
  const added = addChild(t, t[0].key, o).nodes; added[added.length - 1].element = 'nowa'; added[added.length - 1].station = '2Un'; added[added.length - 1].hours = '2';
  const pAdd = plan(o, added, '600');
  assert.deepEqual(pAdd.errors, []);
  assert.equal(treePlanBlock(pAdd, o, harmAccess('clerik')), null);
  assert.ok(treePlanBlock(pAdd, o, harmAccess('tourist')));
  const edited = treeFromOps(o, '600'); edited[1].element = 'zmiana';
  const pEdit = plan(o, edited, '600');
  assert.match(treePlanBlock(pEdit, o, harmAccess('clerik')), /tylko dodawać/);
  assert.equal(treePlanBlock(pEdit, o, harmAccess('master')), null);
  const pRen = plan(o, renameNode(treeFromOps(o, '600'), treeFromOps(o, '600')[1].key, '600b'), '600');
  assert.equal(treePlanBlock(pRen, o, harmAccess('master')), null);   // zmiana numeru to edycja, nie usuwanie
  const pDel = plan(o, removeNode(t, t[1].key), '600');
  assert.deepEqual(pDel.deleted, ['600a']);
  assert.match(treePlanBlock(pDel, o, harmAccess('master')), /usuwanie/);
  assert.equal(treePlanBlock(pDel, o, harmAccess('god')), null);
});

test('Firebase.gs: poziom z kolumny „Harmonogram” i domyślne', () => {
  const rows = [['E-mail', 'Klucz', 'Aktywny', 'Imię', 'Plan', 'Grafik', 'Harmonogram'],
    ['a@x.pl', 'k', 'TAK', 'A', 'odczyt', 'odczyt', 'GOD'], ['b@x.pl', 'k', 'TAK', 'B', '', '', 'clerik'], ['c@x.pl', 'k', 'TAK', 'C', '', '', '---'],
    ['d@x.pl', 'k', 'TAK', 'D', '', '', ''], ['e@x.pl', 'k', 'TAK', 'E', '', '', 'cokolwiek']];
  const store = {};
  const ctx = vm.createContext({
    API_USERS_SHEET: 'Uzytkownicy', API_ADMIN_EMAIL: 'admin@x.pl',
    CacheService: { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({ getLastRow: () => rows.length, getLastColumn: () => rows[0].length, getRange: () => ({ getValues: () => rows }) }) }) },
  });
  vm.runInContext(fs.readFileSync(new URL('../backend/Firebase.gs', import.meta.url), 'utf8'), ctx);
  const lv = (email, permissions = {}) => ctx.api_harmLevel_({ email, permissions });
  assert.equal(lv('A@x.pl'), 'god'); assert.equal(lv('b@x.pl', { plan: 'write' }), 'clerik'); assert.equal(lv('c@x.pl', { plan: 'write' }), 'none');
  assert.equal(lv('d@x.pl', { plan: 'write' }), 'master'); assert.equal(lv('d@x.pl', { grafik: 'read' }), 'tourist'); assert.equal(lv('d@x.pl'), 'none');
  assert.equal(lv('e@x.pl', { plan: 'write' }), 'none'); assert.equal(lv('admin@x.pl'), 'god');
  assert.ok(store.harm_levels_v1);   // pamięć podręczna
});
