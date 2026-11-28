// Ustawienia → Dostęp (tylko GOD): poziomy dostępu każdego użytkownika osobno dla każdego modułu.
// Dane: API api_listUserLevels (lista z poziomami wpisanymi i faktycznymi) i api_setUserLevel (zmiana jednego poziomu); zapis w kolumnach zakładki Uzytkownicy.
import { h, clear, api, toast, modal } from '../ui.js';
import { MODULE_LEVELS, ALL_LEVELS, HARM_LABELS } from '../logic/moduleLevels.js';
import { openUsersMigration } from './usersMigration.js';

const CHOICES = [...ALL_LEVELS].reverse();   // GOD … ---

export function accessPanel(ctx) {
  let users = [], q = '';
  const body = h('div', { class: 'table-wrap', style: { maxHeight: '60vh' } });
  const search = h('input', { type: 'search', placeholder: 'Szukaj użytkownika…', style: { width: '240px', padding: '4px 8px' }, oninput: () => { q = search.value.trim().toLowerCase(); draw(); } });
  const info = h('span', { class: 'muted' });

  async function change(u, key, sel) {
    const prev = u.levels[key].set;
    sel.disabled = true;
    try {
      await api('api_setUserLevel', [u.email, key, sel.value]);
      u.levels[key].set = sel.value;
      toast(`${u.name || u.email}: ${(MODULE_LEVELS.find(([k]) => k === key) || [])[1]} → ${sel.value ? HARM_LABELS[sel.value] : 'jak dotychczas'}`);
      await load(true);   // poziomy domyślne innych modułów mogły się zmienić
    } catch (e) { sel.value = prev; toast('Nie zapisano: ' + (e.message || e), true); }
    sel.disabled = false;
  }

  function draw() {
    clear(body);
    const rows = users.filter((u) => !q || (u.email + ' ' + u.name).toLowerCase().includes(q));
    if (!rows.length) { body.append(h('p', { class: 'muted', style: { padding: '8px' } }, users.length ? 'Brak pasujących użytkowników.' : 'Brak danych.')); return; }
    body.append(h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Użytkownik'), ...MODULE_LEVELS.map(([, label]) => h('th', {}, label)))),
      h('tbody', {}, ...rows.map((u) => h('tr', { style: u.active ? null : { opacity: 0.5 } },
        h('td', { class: 'left' }, h('div', { style: { fontWeight: 600 } }, u.name || u.email), h('div', { class: 'muted', style: { fontSize: '11px' } }, u.email + (u.active ? '' : ' · konto nieaktywne'))),
        ...MODULE_LEVELS.map(([key]) => {
          const lv = u.levels[key] || { set: '', effective: 'none' };
          const sel = h('select', { style: { padding: '3px', fontSize: '12px', background: lv.set ? '#e8f0fe' : '' }, title: lv.set ? 'Ustawione ręcznie' : 'Pusta komórka – poziom jak dotychczas' },
            h('option', { value: '' }, `(jak dotychczas: ${HARM_LABELS[lv.effective] || lv.effective})`),
            ...CHOICES.map((c) => h('option', { value: c }, HARM_LABELS[c])));
          sel.value = lv.set || '';
          sel.addEventListener('change', () => change(u, key, sel));
          return h('td', {}, sel);
        }))))));
  }

  async function load(quiet = false) {
    if (!quiet) { info.textContent = 'Wczytywanie…'; }
    try { users = (await api('api_listUserLevels', [])).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'pl')); info.textContent = `Użytkowników: ${users.length}`; draw(); }
    catch (e) { info.textContent = ''; clear(body).append(h('p', { class: 'err', style: { padding: '8px' } }, /UNKNOWN_FN|Nieznana funkcja/i.test(e.message || '') ? 'Serwer nie ma jeszcze poziomów modułów – wklej nowe Api.gs i Firebase.gs i wdróż nową wersję.' : (e.message || String(e)))); }
  }

  const node = h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Dostęp – poziomy modułów'),
    h('p', { class: 'muted' }, 'Każdy moduł ma własny poziom. GOD – zapis i odczyt oraz opcje zaawansowane (importy, kolory harmonogramu i stanowisk, ustawienia); MASTER – zapis i odczyt bez opcji zaawansowanych; CLERIK i TOURIST – jak dotychczas; PEASANT – nowy poziom (prawa do ustalenia; na razie bez dostępu do modułów poza Skanerem); „---” – brak dostępu. „(jak dotychczas)” = pusta komórka w arkuszu, poziom wynika ze starych ustawień. Zmiana działa od następnego wejścia użytkownika do programu (token odnawia się co godzinę).'),
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'center', marginBottom: '6px' } }, search, h('button', { class: 'btn small', onclick: () => load() }, 'Odśwież'), h('button', { class: 'btn small', title: 'Karta Uzytkownicy → baza Firebase: tryb, import, porównanie, eksport (tylko GOD)', onclick: () => openUsersMigration() }, '⇄ Migracja użytkowników'), info), body);
  load();
  return node;
}

/** Przycisk w Ustawieniach (GOD) otwierający tabelę poziomów w dużym oknie. */
export function accessButton(ctx) {
  return h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Dostęp – poziomy modułów'),
    h('p', { class: 'muted' }, 'Poziomy dostępu każdego użytkownika osobno dla każdego modułu (Skaner, Grafik, Plan, Harmonogram, Mistrz, Kompetencje, Narzędziownia, Zakupy, Tablica). Tylko GOD.'),
    h('button', { class: 'btn', onclick: () => {
      const m = modal('', accessPanel(ctx), { wide: true });
      m.root.style.maxWidth = '96vw'; m.root.style.width = '96vw';
      m.root.append(h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij')));
    } }, 'Poziomy dostępu…'));
}
