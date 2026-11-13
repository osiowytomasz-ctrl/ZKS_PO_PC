import test from 'node:test';
import assert from 'node:assert/strict';
import { treeFromOps, renameNode, moveNode, addChild, removeNode, descriptionsToText, descriptionsFromText, planTree, emptyNode } from '../src/renderer/js/logic/harmTree.js';

const ops = () => ({
  600: { element: 'Zespół', komis: '26/934', preds: [], startManual: 1, status: '' },
  '600a': { element: 'Cz.d', station: '2Un', preds: [] }, '600aa': { element: 'ust1', station: '2Un', hours: 110, preds: [] }, '600ab': { element: 'ust2', station: '2Un', hours: 16, preds: ['600aa'] },
  '600b': { element: 'Cz.g', station: '2Un', preds: [] }, '600ba': { element: 'UST1', station: '2Un', hours: 150, preds: [] },
  700: { element: 'Inna', preds: ['600ab'] }, 800: { element: 'Obca', preds: [] },
});
const lps = (nodes) => nodes.map((n) => n.lp);

test('drzewo z bazy, przesuwanie i zmiana numeru z potomkami', () => {
  const t = treeFromOps(ops(), '600');
  assert.deepEqual(lps(t), ['600', '600a', '600aa', '600ab', '600b', '600ba']);
  const moved = moveNode(t, t[1].key, 1);                       // 600a w dół: zamienia litery z 600b, dzieci idą razem
  assert.deepEqual(lps(moved), ['600', '600a', '600aa', '600b', '600ba', '600bb']);
  assert.equal(moved.find((n) => n.lp === '600bb').preds, '600ba');   // zależność w gałęzi poprawiona
  assert.equal(moved.find((n) => n.lp === '600a').element, 'Cz.g');
  const r = renameNode(t, t[1].key, '600c');
  assert.deepEqual(lps(r), ['600', '600b', '600ba', '600c', '600ca', '600cb']);
  assert.equal(r.find((n) => n.lp === '600cb').preds, '600ca');
});

test('dodawanie i usuwanie węzłów', () => {
  const t = treeFromOps(ops(), '600');
  const a = addChild(t, t[0].key, ops());
  assert.equal(a.nodes.find((n) => n.key === a.key).lp, '600c');
  const b = addChild(a.nodes, a.nodes.find((n) => n.lp === '600b').key, ops());
  assert.equal(b.nodes.find((n) => n.key === b.key).lp, '600bb'); assert.equal(b.nodes.find((n) => n.key === b.key).station, '2Un');
  assert.ok(addChild(t, t[2].key).error);                         // subsuboperacja nie ma dzieci
  assert.deepEqual(lps(removeNode(t, t[1].key)), ['600', '600b', '600ba']);
});

test('notatnik: tylko opisy, linia na operację', () => {
  const t = treeFromOps(ops(), '600');
  const txt = descriptionsToText(t);
  assert.equal(txt, 'Zespół\nCz.d\nust1\nust2\nCz.g\nUST1');
  const e = descriptionsFromText(txt.replace('ust2', 'ust2 – podział pionowy') + '\r\n', t);
  assert.deepEqual(e.errors, []); assert.equal(e.nodes[3].element, 'ust2 – podział pionowy'); assert.equal(e.nodes[3].lp, '600ab'); assert.equal(e.nodes[3].hours, '16');
  assert.match(descriptionsFromText(txt + '\nnadmiarowa', t).errors[0], /dokładnie 6 linii.*jest 7/);
  assert.match(descriptionsFromText('Zespół\nCz.d', t).errors[0], /jest 2/);
  assert.equal(descriptionsFromText('\n\n\n\n\n', t).nodes[0].element, '');      // puste opisy też się liczą
});

test('plan zapisu: zmiany, zmiana numeru, odwołania z zewnątrz, usuwanie', () => {
  const o = ops(), t = treeFromOps(o, '600');
  const ids = t.map((n) => n.orig);
  // bez zmian
  assert.deepEqual(planTree(o, ids, t).changes, []);
  // opis i czas
  const e1 = t.map((n) => (n.lp === '600ab' ? { ...n, element: 'ust2 nowe', hours: '18' } : n));
  const p1 = planTree(o, ids, e1, { stations: ['2Un'] });
  assert.deepEqual(p1.errors, []); assert.deepEqual(p1.changes, ['600ab: opis „ust2” → „ust2 nowe”', '600ab: czas „16” → „18”']);
  assert.deepEqual(p1.sets.map(([lp, op]) => [lp, op.hours, op.element]), [['600ab', 18, 'ust2 nowe']]); assert.deepEqual(p1.remove, ['600ab']);
  // zmiana numeru 600ab → 600ac: operacja 700 z zewnątrz dostaje poprawioną zależność
  const p2 = planTree(o, ids, renameNode(t, t[3].key, '600ac'));
  assert.deepEqual(p2.errors, []); assert.ok(p2.changes.includes('Zmiana numeru 600ab → 600ac'));
  assert.deepEqual(p2.sets.find(([lp]) => lp === '700')[1].preds, ['600ac']); assert.ok(p2.remove.includes('600ab'));
  // usunięcie 600ab blokuje zależność 700
  const p3 = planTree(o, ids, removeNode(t, t[3].key));
  assert.ok(p3.errors.some((x) => x.includes('700 zależy od usuwanej 600ab')));
  // pole startManual i inne zostają przy operacji
  assert.equal(planTree(o, ids, t.map((n) => (n.lp === '600' ? { ...n, element: 'Z' } : n))).sets[0][1].startManual, 1);
});

test('plan zapisu: kontrola numerów, poziomów i zależności', () => {
  const o = ops(), t = treeFromOps(o, '600'), ids = t.map((n) => n.orig);
  const err = (nodes) => planTree(o, ids, nodes).errors.join('\n');
  assert.match(err([...t, { ...emptyNode('800'), element: 'x' }]), /800 ma już inna operacja/);
  assert.match(err([...t, emptyNode('600a')]), /600a powtarza się/);
  assert.match(err([...t, emptyNode('600zzz')]), /liczba \+ dwie litery/);
  assert.match(err([...t, emptyNode('600ca')]), /wymaga suboperacji 600c/);
  assert.match(err(t.map((n) => (n.lp === '600aa' ? { ...n, preds: '600a' } : n))), /operacja nadrzędna/);
  assert.match(err(t.map((n) => (n.lp === '600a' ? { ...n, preds: '600ab' } : n))), /własna suboperacja/);
  assert.match(err(t.map((n) => (n.lp === '600aa' ? { ...n, preds: '700' } : n))), /cykl/);
  assert.match(err(t.map((n) => (n.lp === '600aa' ? { ...n, preds: '999' } : n))), /nie ma takiej operacji/);
  assert.match(err(t.map((n) => (n.lp === '600aa' ? { ...n, hours: 'abc' } : n))), /liczba godzin/);
  // nowe drzewo
  const fresh = [{ ...emptyNode('900'), element: 'Nowa', komis: 'K9' }, { ...emptyNode('900a'), station: '1Si', hours: '8' }, { ...emptyNode('900b'), station: '2Un', hours: '4', preds: '900a, 800' }];
  const p = planTree(o, [], fresh, { stations: ['1Si', '2Un'] });
  assert.deepEqual(p.errors, []); assert.equal(p.sets.length, 3); assert.deepEqual(p.remove, []);
  assert.deepEqual(p.sets[2][1].preds, ['800']);                               // 900a pominięte: 900b i tak startuje po 900a
  assert.ok(p.warnings.some((w) => w.includes('zbędne zależności 900a')));
  assert.ok(planTree(o, [], [{ ...emptyNode('901'), station: 'XYZ' }], { stations: ['1Si'] }).warnings[0].includes('XYZ'));
});
