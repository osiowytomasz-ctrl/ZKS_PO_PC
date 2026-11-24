// Dostęp do Narzędziowni wg poziomu użytkownika.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolroomAccess } from '../src/renderer/js/logic/toolroomAccess.js';

const ALL = ['toolbuilder', 'assemtool', 'tooltrack', 'kontury', 'czesci', 'produkty', 'pomiarowe', 'zniszczone', 'pomiarowka', 'zakupy'];
test('GOD: wszystko, w tym edycja konturów i płytek oraz adres API', () => {
  const a = toolroomAccess('god');
  assert.ok(a.enter && a.harmonogram && a.editContours && a.editPlates && a.zakupy && a.fullSettings && a.apiLink);
  assert.ok(ALL.every((id) => a.moduleVisible(id)));
});
test('MASTER: przegląda wszystko i zamawia, ale nie edytuje konturów ani płytek i nie widzi adresu API', () => {
  const a = toolroomAccess('master');
  assert.ok(a.enter && a.harmonogram && a.zakupy && a.fullSettings);
  assert.ok(!a.editContours && !a.editPlates && !a.apiLink);
  assert.ok(ALL.every((id) => a.moduleVisible(id)));
});
test('CLERIK: tylko ToolBuilder, Assem.Tool, ToolTrack i Części; bez Zakupów', () => {
  const a = toolroomAccess('clerik');
  assert.ok(a.enter && a.harmonogram && !a.zakupy && !a.editContours && !a.apiLink);
  assert.deepEqual(ALL.filter((id) => a.moduleVisible(id)), ['toolbuilder', 'assemtool', 'tooltrack', 'czesci']);
});
test('TOURIST i brak dostępu: bez Narzędziowni, Harmonogramu i pełnych Ustawień', () => {
  for (const lv of ['tourist', 'none', '---', undefined]) {
    const a = toolroomAccess(lv);
    assert.ok(!a.enter && !a.harmonogram && !a.zakupy && !a.fullSettings && !a.apiLink, String(lv));
    assert.ok(ALL.every((id) => !a.moduleVisible(id)));
  }
});
