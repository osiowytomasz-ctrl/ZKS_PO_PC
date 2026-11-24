// Dostęp do Narzędziowni (kolumna „Narzędziownia”) i ogólny (Harmonogram, Ustawienia, adres API).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolroomAccess, appAccess, toolroomLevelOf } from '../src/renderer/js/logic/toolroomAccess.js';

const ALL = ['toolbuilder', 'assemtool', 'tooltrack', 'kontury', 'czesci', 'produkty', 'pomiarowe', 'zniszczone', 'pomiarowka', 'zakupy'];
test('GOD: wszystko w Narzędziowni, w tym edycja konturów i płytek', () => {
  const a = toolroomAccess('god');
  assert.ok(a.enter && a.manage && a.editContours && a.editPlates && a.zakupy);
  assert.ok(ALL.every((id) => a.moduleVisible(id)));
});
test('MASTER: przegląda wszystko i zamawia, ale nie edytuje konturów ani płytek', () => {
  const a = toolroomAccess('master');
  assert.ok(a.enter && a.manage && a.zakupy && !a.editContours && !a.editPlates);
  assert.ok(ALL.every((id) => a.moduleVisible(id)));
});
test('CLERIK: tylko ToolBuilder, Assem.Tool, ToolTrack i Części; bez Zakupów', () => {
  const a = toolroomAccess('clerik');
  assert.ok(a.enter && !a.manage && !a.zakupy && !a.editContours);
  assert.deepEqual(ALL.filter((id) => a.moduleVisible(id)), ['toolbuilder', 'assemtool', 'tooltrack', 'czesci']);
});
test('TOURIST i brak dostępu: bez Narzędziowni i Zakupów', () => {
  for (const lv of ['tourist', 'none', '---', undefined]) {
    const a = toolroomAccess(lv);
    assert.ok(!a.enter && !a.manage && !a.zakupy, String(lv));
    assert.ok(ALL.every((id) => !a.moduleVisible(id)));
  }
});
test('poziom Narzędziowni: osobna kolumna, a przy pustej komórce – poziom Grafiku', () => {
  assert.equal(toolroomLevelOf({ toolroomLevel: 'god', grafikLevel: 'tourist' }), 'god');            // narzędziowiec: GOD w Narzędziowni, TOURIST w Grafiku
  assert.equal(toolroomLevelOf({ toolroomLevel: 'tourist', grafikLevel: 'god' }), 'tourist');        // administrator Grafiku bez dostępu do Narzędziowni
  assert.equal(toolroomLevelOf({ toolroomLevel: null, grafikLevel: 'master' }), 'master');           // stary serwer / pusta komórka
  assert.equal(toolroomLevelOf(null), 'none');
});
test('dostęp ogólny wg Grafiku: Harmonogram, Ustawienia i adres API', () => {
  assert.ok(appAccess('god').apiLink && appAccess('god').harmonogram && appAccess('god').fullSettings);
  assert.ok(!appAccess('master').apiLink && appAccess('master').harmonogram && appAccess('master').fullSettings);
  for (const lv of ['tourist', 'none']) { const a = appAccess(lv); assert.ok(!a.harmonogram && !a.fullSettings && !a.apiLink); }
});
