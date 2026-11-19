// Okno „Użytkownicy i klucze” (Ustawienia, administrator): konta z zakładki Uzytkownicy, klucze dostępu do programu, nowi użytkownicy.
// Te same funkcje API co w aplikacji na Androida (api_listUsers, api_addUser, api_userKey, api_newUserKey); serwer wpuszcza tylko
// administratora (API_ADMIN_EMAIL w Api.gs). Klucz widać tylko w oknie z kluczem – lista go nie zawiera.
import { h, clear, api, toast, modal, confirmBox } from '../ui.js';
import { permissionLabel } from '../logic/common.js';

const MODULES = [['grafik', 'Grafik'], ['plan', 'Plan'], ['zakupy', 'Zakupy']];
const DEFAULTS = { grafik: 'read', plan: 'read', zakupy: 'none' };
const LEVELS = ['none', 'read', 'write'];
const norm = (s) => String(s || '').trim().toLowerCase();
export const validEmail = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(norm(s));
export const shareText = (apiUrl, key) => `Adres API: ${String(apiUrl || '').trim()}\nKlucz: ${String(key || '').trim()}`;
const summary = (p) => MODULES.map(([k, l]) => `${l}: ${permissionLabel((p || {})[k] || DEFAULTS[k])}`).join(' · ');

export async function openUsersAdmin() {
  let cfg = {};
  try { cfg = (await window.zks.getSettings()) || {}; } catch { /* bez adresu */ }
  let users = [], q = '';
  const list = h('div', { style: { maxHeight: '55vh', overflow: 'auto' } }, h('p', { class: 'muted' }, 'Wczytywanie…'));
  const search = h('input', { type: 'search', placeholder: 'Szukaj (e-mail, nazwa)', style: { width: '240px' }, oninput: (e) => { q = norm(e.target.value); draw(); } });

  const showKey = (title, r) => {
    const text = shareText(cfg.url, r.key);
    const m = modal(title, h('div', {},
      h('p', {}, r.email + (r.active === false ? ' – konto nieaktywne (kolumna „aktywny” w arkuszu)' : '')),
      h('pre', { style: { userSelect: 'all', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f4f4f4', padding: '8px', borderRadius: '6px' } }, text),
      h('p', { class: 'muted' }, 'Przekaż adres i klucz użytkownikowi – wpisuje je w Ustawieniach programu PC albo aplikacji na telefonie. Nie wysyłaj klucza publicznie.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => { try { await (window.zks.copyText ? window.zks.copyText(text) : navigator.clipboard.writeText(text)); toast('Skopiowano'); } catch (e) { toast('Nie skopiowano: ' + e.message, true); } } }, 'Kopiuj'),
        h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))));
  };
  const current = async (u) => { try { showKey('Klucz użytkownika', await api('api_userKey', [u.email])); } catch (e) { toast(e.message, true); } };
  const renew = async (u) => {
    if (!(await confirmBox('Nowy klucz', `Wygenerować nowy klucz dla ${u.email}? Stary przestanie działać (po najwyżej 5 minutach) na wszystkich urządzeniach tej osoby.`, 'Generuj'))) return;
    try { showKey('Nowy klucz', await api('api_newUserKey', [u.email])); load(); } catch (e) { toast(e.message, true); }
  };

  const draw = () => {
    const rows = users.filter((u) => !q || norm(u.email).includes(q) || norm(u.name).includes(q));
    clear(list).append(rows.length ? h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ...['Użytkownik', 'Uprawnienia', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((u) => h('tr', {},
        h('td', {}, h('div', { style: { fontWeight: 600 } }, u.name || u.email), h('div', { class: 'muted' }, u.email),
          u.active ? null : h('div', { class: 'err' }, 'Konto nieaktywne')),
        h('td', { class: 'muted' }, summary(u.permissions)),
        h('td', { style: { whiteSpace: 'nowrap' } },
          u.hasKey ? h('button', { class: 'btn small', onclick: () => current(u) }, 'Pokaż klucz') : null, ' ',
          h('button', { class: 'btn small', onclick: () => renew(u) }, 'Nowy klucz')))))) : h('p', { class: 'muted' }, 'Brak użytkowników.'));
  };
  const load = async () => {
    try { users = (await api('api_listUsers', [])).slice().sort((a, b) => norm(a.email).localeCompare(norm(b.email))); draw(); }
    catch (e) { clear(list).append(h('p', { class: 'err' }, e.code === 'FORBIDDEN' ? 'Użytkownikami zarządza tylko administrator (API_ADMIN_EMAIL w Api.gs).' : 'Błąd: ' + e.message)); }
  };

  // dodawanie użytkownika
  const email = h('input', { type: 'email', placeholder: 'adres@e-mail', style: { width: '220px' } });
  const name = h('input', { type: 'text', placeholder: 'Imię i nazwisko', style: { width: '200px' } });
  const sel = Object.fromEntries(MODULES.map(([k]) => [k, h('select', {}, ...LEVELS.map((l) => h('option', { value: l, selected: l === DEFAULTS[k] }, permissionLabel(l))))]));
  const add = async () => {
    if (!validEmail(email.value)) { toast('Wpisz poprawny adres e-mail', true); return; }
    if (users.some((u) => norm(u.email) === norm(email.value))) { toast('Taki użytkownik już jest', true); return; }
    try {
      const r = await api('api_addUser', [{ email: norm(email.value), name: name.value.trim(), permissions: Object.fromEntries(MODULES.map(([k]) => [k, sel[k].value])) }]);
      email.value = ''; name.value = '';
      showKey('Dodano użytkownika', r); load();
    } catch (e) { toast(e.message, true); }
  };
  const form = h('div', { style: { marginTop: '10px', borderTop: '1px solid #ddd', paddingTop: '8px' } },
    h('h4', { style: { margin: '0 0 6px' } }, 'Nowy użytkownik'),
    h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } }, email, name,
      ...MODULES.flatMap(([k, l]) => [h('span', { class: 'muted' }, l), sel[k]]),
      h('button', { class: 'btn primary', onclick: add }, 'Dodaj i wygeneruj klucz')),
    h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Poziomy „Grafik dostęp”, „Harmonogram” i aktywność konta ustawia się w zakładce Uzytkownicy arkusza.'));

  const m = modal('Użytkownicy i klucze dostępu', h('div', {},
    h('div', { class: 'row' }, search, h('button', { class: 'btn small', onclick: load }, 'Odśwież')), list, form,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  load();
}
