import test from 'node:test';
import assert from 'node:assert/strict';
import { grafikAccess, grafikLevelOf } from '../src/renderer/js/logic/grafikAccess.js';

test('poziomy Grafiku i Kompetencji', () => {
  const g = grafikAccess('god'), m = grafikAccess('master'), c = grafikAccess('clerik'), t = grafikAccess('tourist'), n = grafikAccess('none');
  assert.ok(g.importG && g.competence && g.groups && g.sheet);
  assert.ok(!m.importG && m.competence && m.groups && !m.sheet && m.cells && m.manage);   // dawny widok z arkusza (pobieranie) – tylko GOD
  assert.ok(c.cells && !c.groups && !c.importG && !c.sheet && !c.competence && !c.manage);
  assert.ok(t.view && !t.cells && !t.groups && !t.summary && !t.competence);
  assert.ok(!n.view);
  assert.equal(grafikLevelOf({ grafikLevel: 'CLERIK', permissions: { grafik: 'write' } }), 'clerik');   // kolumna „Grafik dostęp” ma pierwszeństwo
  assert.equal(grafikLevelOf({ permissions: { grafik: 'write' } }), 'master');                       // stary serwer
  assert.equal(grafikLevelOf({ permissions: { grafik: 'read' } }), 'tourist');
  assert.equal(grafikLevelOf(null), 'none');
});
