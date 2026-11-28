// Ustawienia → Dostęp → „⇄ Migracja użytkowników” (tylko GOD / administrator): przejście karty Uzytkownicy do bazy Firebase (backend/UsersDb.gs, API usersAdmin).
// Tryby: Karta (jak dotąd) · Równolegle (odczyt z karty, zmiany przepisywane do bazy) · Tylko baza (odczyt i zapis w bazie, karta jest kopią). Wycofanie: tryb „Karta”.
import { h, clear, api, modal, toast, confirmBox } from '../ui.js';

const MODES = { sheet: 'Karta Uzytkownicy (jak dotąd)', dual: 'Równolegle (odczyt z karty, zmiany także w bazie)', db: 'Tylko baza (karta jest kopią zapasową)' };

export function openUsersMigration() {
  const status = h('div', { style: { fontSize: '13px', margin: '6px 0' } });
  const out = h('div', { style: { fontSize: '13px', maxHeight: '40vh', overflow: 'auto', margin: '8px 0' } });
  let mode = 'sheet';
  const when = (ms) => (ms ? new Date(ms).toLocaleString('pl-PL') : '—');
  const radios = Object.entries(MODES).map(([k, label]) => h('label', { style: { display: 'block', margin: '4px 0' } }, h('input', { type: 'radio', name: 'usr-mode', value: k }), ' ' + label));
  const paint = (s) => {
    mode = s.mode;
    status.textContent = `Tryb: ${MODES[s.mode]} · w karcie: ${s.sheetUsers} · w bazie: ${s.dbUsers}${s.dbUsable ? '' : ' (baza pusta lub bez aktywnego użytkownika)'} · ostatni zapis w bazie: ${when(s.updatedAt)}${s.updatedBy ? ', ' + s.updatedBy : ''}${s.error ? ' · błąd: ' + s.error : ''}`;
    for (const r of radios) r.querySelector('input').checked = r.querySelector('input').value === s.mode;
    lockInfo.textContent = s.lockdown ? `🔒 BLOKADA DOSTĘPU WŁĄCZONA – dostęp mają tylko: administrator${(s.lockdownAllow || []).length ? ', ' + s.lockdownAllow.join(', ') : ''}.` : 'Blokada dostępu: wyłączona (wszyscy z kontem mają dostęp wg poziomów).';
    lockInfo.style.color = s.lockdown ? '#c62828' : '';
  };
  const busy = async (label, fn) => { out.textContent = label + '…'; out.style.color = ''; try { await fn(); } catch (e) { out.textContent = 'Błąd: ' + (e.message || e); out.style.color = '#c62828'; } };
  const refresh = () => api('usersAdmin', ['status']).then(paint);
  const importBtn = h('button', { class: 'btn', onclick: () => busy('Import', async () => {
    if (!(await confirmBox('Import użytkowników do bazy', 'Zastąpić użytkowników w bazie zawartością karty Uzytkownicy (łącznie z kluczami i poziomami)? Zmiany zrobione tylko w bazie przepadną.', 'Importuj'))) { out.textContent = 'Anulowano.'; return; }
    paint(await api('usersAdmin', ['import'])); out.textContent = 'Zaimportowano.';
  }) }, 'Importuj kartę do bazy');
  const cmpBtn = h('button', { class: 'btn', onclick: () => busy('Porównywanie', async () => {
    const r = await api('usersAdmin', ['compare']);
    clear(out);
    out.append(h('div', { style: { fontWeight: 700, color: r.ok ? '#1b5e20' : '#c62828' } }, r.ok ? `✔ Zgodne: ${r.sheetUsers} użytkowników w karcie i w bazie, wszystkie kolumny takie same.` : `✖ Różnice: karta ${r.sheetUsers}, baza ${r.dbUsers}; tylko w karcie: ${r.onlySheet.length}, tylko w bazie: ${r.onlyDb.length}, różnych pól: ${r.diffs.length}`));
    if (r.onlySheet.length) out.append(h('div', {}, 'Tylko w karcie: ' + r.onlySheet.join(', ')));
    if (r.onlyDb.length) out.append(h('div', {}, 'Tylko w bazie: ' + r.onlyDb.join(', ')));
    if (r.diffs.length) out.append(h('table', { class: 't', style: { width: '100%', marginTop: '6px' } }, h('thead', {}, h('tr', {}, ...['użytkownik', 'kolumna', 'karta', 'baza'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...r.diffs.slice(0, 100).map((x) => h('tr', {}, h('td', {}, x.email), h('td', {}, x.column), h('td', { class: 'left' }, x.sheet), h('td', { class: 'left' }, x.db))))));
  }) }, 'Porównaj kartę z bazą');
  const exportBtn = h('button', { class: 'btn', onclick: () => busy('Eksport', async () => {
    if (!(await confirmBox('Eksport użytkowników do karty', 'Wpisać do karty Uzytkownicy dane z bazy (nadpisze wartości w karcie)?', 'Eksportuj'))) { out.textContent = 'Anulowano.'; return; }
    paint(await api('usersAdmin', ['export'])); out.textContent = 'Karta zaktualizowana z bazy.';
  }) }, 'Eksportuj bazę do karty');
  const saveBtn = h('button', { class: 'btn primary', onclick: () => busy('Zapis trybu', async () => {
    const v = (radios.map((l) => l.querySelector('input')).find((i) => i.checked) || {}).value;
    if (!v || v === mode) { out.textContent = 'Bez zmian.'; return; }
    if (v === 'db' && !(await confirmBox('Tryb „Tylko baza”', 'Logowanie, klucze i poziomy dostępu będą czytane i zapisywane w bazie; karta Uzytkownicy staje się kopią (po każdej zmianie przepisywaną z bazy). Gdy baza będzie niedostępna lub pusta, serwer awaryjnie użyje karty. Włączyć?', 'Włącz'))) { out.textContent = 'Anulowano.'; return; }
    paint(await api('usersAdmin', [{ mode: v }])); out.textContent = `Tryb: ${MODES[v]}. Zmiana obowiązuje od razu (pamięć podręczna serwera została wyczyszczona).`; toast('Zapisano tryb użytkowników');
  }) }, 'Zapisz tryb');
  // Blokada dostępu: serwer odrzuca wszystkie wywołania poza administratorem i wskazanymi osobami (działa także dla programów w starych wersjach; wydane wcześniej tokeny bazy wygasają w ciągu godziny)
  const lockMsg = h('input', { type: 'text', placeholder: 'Komunikat dla użytkowników', style: { width: '100%' }, value: 'Program jest chwilowo niedostępny – trwa przenoszenie danych. Skontaktuj się z administratorem.' });
  const lockAllow = h('input', { type: 'text', placeholder: 'Dodatkowe osoby z dostępem (e-maile po przecinku)', style: { width: '100%' } });
  const lockInfo = h('div', { style: { fontSize: '13px', margin: '4px 0' } });
  const lockBtn = (on) => h('button', { class: 'btn' + (on ? ' primary' : ''), onclick: () => busy(on ? 'Włączanie blokady' : 'Wyłączanie blokady', async () => {
    if (on && !(await confirmBox('Blokada dostępu', 'Wszyscy użytkownicy poza Tobą i osobami z listy przestaną mieć dostęp do programu (Apps Script odrzuci ich wywołania). Włączyć blokadę?', 'Zablokuj'))) { out.textContent = 'Anulowano.'; return; }
    const s = await api('usersAdmin', [{ lockdown: { on, message: lockMsg.value, allow: lockAllow.value.split(/[,;\s]+/).filter(Boolean) } }]); paint(s); out.textContent = on ? 'Blokada włączona.' : 'Blokada wyłączona.';
  }) }, on ? 'Zablokuj dostęp pozostałym' : 'Odblokuj');
  const m = modal('Użytkownicy: migracja do bazy i blokada dostępu', h('div', {},
    h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Kolejność: 1) Importuj kartę do bazy, 2) Porównaj (musi być „Zgodne”), 3) tryb „Równolegle” (zmiany w Ustawieniach → Dostęp i nowe konta idą też do bazy), 4) tryb „Tylko baza”. Klucze logowania są w dokumencie dostępnym tylko dla serwera (konto usługi); przeglądarka ich nie czyta.'),
    status, ...radios, h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, saveBtn, importBtn, cmpBtn, exportBtn), out,
    h('hr', {}), h('b', {}, 'Blokada dostępu'), lockInfo, lockMsg, lockAllow, h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, lockBtn(true), lockBtn(false)),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  busy('Wczytywanie stanu', async () => { await refresh(); out.textContent = ''; });
}
