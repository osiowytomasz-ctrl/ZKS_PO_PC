// Okno „Kody iPhone” (Grafik, MASTER i GOD): osobiste kody pracowników do Grafiku do wglądu w przeglądarce telefonu.
// Baza: gr_codes/main { codes: { <skrót>: { pid, name, by, at, last } } } – sam kod pokazujemy tylko raz, przy nadaniu.
import { h, clear, toast, modal, confirmBox, alertBox } from '../ui.js';
import { firebase } from '../fb.js';
import { newCode, hashCode, codeRows, hashesOf } from '../logic/grafikCodes.js';

const when = (ms) => (ms ? new Date(ms).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Adres aplikacji na iPhone'a (Skaner i Chat; GitHub Pages z katalogu iphone/ – patrz iphone/README.md). */
export const IPHONE_APP_URL = 'https://osiowytomasz-ctrl.github.io/ZKS_PO_PC/';

export async function openGrafikCodes({ people, user }) {
  const { sdk, db } = await firebase();
  const ref = sdk.doc(db, 'gr_codes', 'main');
  let cfg = {};
  try { cfg = (await window.zks.getSettings()) || {}; } catch { /* bez adresu */ }
  const link = cfg.url ? String(cfg.url).replace(/\?.*$/, '') + '?p=grafik' : '';
  let codes = {}, q = '';
  const list = h('div', { style: { maxHeight: '60vh', overflow: 'auto' } });
  const search = h('input', { type: 'search', placeholder: 'Szukaj nazwiska', style: { width: '220px' }, oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });

  const draw = () => {
    const rows = codeRows(people(), codes).filter((r) => !q || r.name.toLowerCase().includes(q));
    clear(list).append(h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ...['Pracownik', 'Miejsce', 'Kod nadany', 'Ostatnio użyty', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((r) => h('tr', {},
        h('td', {}, r.name), h('td', {}, r.place),
        h('td', {}, r.code ? `${when(r.code.at)}${r.code.by ? ' · ' + r.code.by : ''}` : '—'),
        h('td', {}, r.code ? when(r.code.last) : '—'),
        h('td', { style: { whiteSpace: 'nowrap' } },
          h('button', { class: 'btn small' + (r.code ? '' : ' primary'), onclick: () => give(r) }, r.code ? 'Nowy kod' : 'Nadaj kod'), ' ',
          r.code ? h('button', { class: 'btn small', onclick: () => take(r) }, 'Odbierz') : null))))));
  };
  const write = async (pid, add) => {
    const patch = {};
    for (const k of hashesOf(codes, pid)) patch[k] = sdk.deleteField();
    if (add) patch[add.hash] = add.item;
    await sdk.setDoc(ref, { codes: patch, updatedAt: Date.now() }, { merge: true });
  };
  const give = async (r) => {
    if (r.code && !(await confirmBox('Nowy kod', `${r.name} ma już kod. Nadać nowy? Stary przestanie działać.`, 'Nadaj nowy'))) return;
    const code = newCode();
    try {
      await write(r.pid, { hash: await hashCode(code), item: { pid: r.pid, name: r.name, by: (user && (user.name || user.email)) || '', at: Date.now() } });
      await alertBox('Kod dostępu do Grafiku', `${r.name}\n\nKod: ${code.slice(0, 4)} ${code.slice(4)}\n\n`
        + (link ? `Grafik i Plan do wglądu (kod 8 cyfr) – adres strony (Safari / Chrome na telefonie):\n${link}\n\n` : '')
        + `Skaner i Chat (klucz użytkownika, nie ten kod) – aplikacja na iPhone'a:\n${IPHONE_APP_URL}\n\n`
        + 'Zapisz albo przekaż kod teraz – później nie będzie można go odczytać (w bazie jest tylko skrót). Na telefonie: Udostępnij → Do ekranu początkowego.');
    } catch (e) { toast('Nie zapisano kodu: ' + (e.message || e), true); }
  };
  const take = async (r) => {
    if (!(await confirmBox('Odbierz dostęp', `Odebrać ${r.name} dostęp do Grafiku na telefonie?`, 'Odbierz'))) return;
    try { await write(r.pid, null); toast('Dostęp odebrany: ' + r.name); } catch (e) { toast('Nie zapisano: ' + (e.message || e), true); }
  };

  const m = modal('Kody iPhone – Grafik i Plan do wglądu na telefonie', h('div', {},
    h('p', { style: { margin: '0 0 6px', fontSize: '13px' } }, 'Kody z listy poniżej dotyczą tylko podglądu Grafiku i Planu. Każdy pracownik ma osobny kod (8 cyfr). Po wpisaniu kodu widzi cały grafik (zmiany i komentarze, bez urlopów, godzin i absencji) i Plan – bez możliwości zmian.'),
    h('p', { style: { margin: '0 0 6px', fontSize: '13px' } }, h('b', {}, 'Aplikacja na iPhone\'a – Skaner i Chat'), ' (logowanie kluczem użytkownika, jak w aplikacji na Androida; w Safari: Udostępnij → Do ekranu początkowego):', h('br'), h('code', { style: { userSelect: 'all' } }, IPHONE_APP_URL), ' ',
      h('button', { class: 'btn small', onclick: async () => { await window.zks.copyText(IPHONE_APP_URL); toast('Skopiowano adres aplikacji'); } }, 'Kopiuj')),
    link ? h('p', { style: { margin: '0 0 6px', fontSize: '13px' } }, h('b', {}, 'Grafik i Plan do wglądu'), ' (kod z poniższej listy): ', h('code', { style: { userSelect: 'all' } }, link), ' ',
      h('button', { class: 'btn small', onclick: async () => { await window.zks.copyText(link); toast('Skopiowano adres'); } }, 'Kopiuj')) : null,
    h('div', { class: 'row' }, search), list,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))), { wide: true, onClose: () => stop() });
  const stop = sdk.onSnapshot(ref, (s) => { codes = (s.exists() && s.data().codes) || {}; draw(); },
    (e) => { clear(list).append(h('p', { style: { color: '#c00' } }, 'Brak dostępu do kodów (reguły Firestore: gr_codes; poziom MASTER lub GOD): ' + (e.message || e))); });
  draw();
}
