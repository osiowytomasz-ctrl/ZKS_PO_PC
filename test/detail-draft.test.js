// Dodawanie pozycji do Listy detali: tabela szkicu, walidacja, zapis i odczyt.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/renderer/js/logic/detailDraft.js';

const row = (o) => ({ ...D.blankRow(), ...o });
const ok = { komis: '26/1', rysunek: 'R-1', pozycja: '2', komplet: '1', ilosc: '4' };

test('szkic: pusta tabela ma 10 wierszy, niepuste idą na górę', () => {
  assert.equal(D.emptyDraft().length, 10);
  const d = D.compactDraft([D.blankRow(), row(ok), D.blankRow(), row({ ...ok, pozycja: '3' })]);
  assert.deepEqual(d.map((r) => r.pozycja).slice(0, 3), ['2', '3', '']); assert.equal(d.length, 10); assert.equal(D.filledCount(d), 2);
});
test('walidacja: wymagane pola, ilość całkowita ≥ 1, brak powtórzeń w tabeli', () => {
  assert.equal(D.validateDraft(D.emptyDraft()), 'Tabela jest pusta.');
  assert.equal(D.validateDraft([row(ok)]), null);
  assert.match(D.validateDraft([row({ ...ok, komplet: '' })]), /Wiersz 1: uzupełnij pole „Komplet”/);
  assert.match(D.validateDraft([row(ok), row({ ...ok, ilosc: '0' })]), /Wiersz 2: ilość zlecona/);
  assert.match(D.validateDraft([row({ ...ok, ilosc: '2,5' })]), /całkowitą/);
  assert.match(D.validateDraft([row(ok), D.blankRow(), row(ok)]), /Wiersz 3: ten sam detal jest już w wierszu 1/);
  assert.equal(D.parseOrdered('4,0'), 4); assert.equal(D.parseOrdered(''), null);
});
test('zapis i odczyt szkicu, dane do API', () => {
  const back = D.parseDraft(JSON.stringify(D.compactDraft([row({ ...ok, nazwa: ' Tuleja ' })])));
  assert.equal(back.length, 10); assert.equal(back[0].nazwa, ' Tuleja ');
  assert.deepEqual(D.toForm(back[0]), { komis: '26/1', rysunek: 'R-1', pozycja: '2', komplet: '1', ilosc: '4', nazwa: 'Tuleja', uwagi: '' });
  assert.equal(D.parseDraft('zepsute').length, 10);
});
