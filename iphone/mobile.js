// Wersja ZKS PO na iPhone'a: Skaner i Chat (status + komunikator) – ten sam kod i te same zasady co w programie PC i aplikacji na Androida.
// Strona działa w Safari (po „Dodaj do ekranu początkowego” – jak aplikacja). Klucz użytkownika i adres API jak w aplikacji na Androida:
// adres pobiera się sam z bazy, wpisuje się tylko klucz.
import { createZks } from './shim.js';
import { installBarcodeDetector } from './barcode-shim.js';
import { VERSION } from './version.js';

window.zks = createZks({ storage: window.localStorage, version: VERSION });
installBarcodeDetector(window);   // Safari nie ma BarcodeDetector – odczyt kodów robi ZXing

const { h, clear, api, toast, modal } = await import('./js/ui.js');

const root = document.getElementById('app');
const ctx = { user: null, version: VERSION, platform: 'ios', go() {}, canWrite: () => true };
// poziomy jak w programie PC (ctx.level używają m.in. widoki skanera)
ctx.level = (perm) => (ctx.user ? (ctx.user.permissions || {})[perm] || 'none' : 'none');

/** Ekran logowania: klucz użytkownika (adres API zwykle pobiera się z bazy; gdy go nie ma – pole adresu). */
async function loginView(message = '') {
  const cfg = await window.zks.getSettings();
  const needUrl = !cfg.url;
  const url = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: cfg.url, autocapitalize: 'off', spellcheck: 'false' });
  const key = h('input', { type: 'password', placeholder: 'Klucz użytkownika', value: cfg.key, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const err = h('div', { class: 'err', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } }, message);
  const go = async () => {
    err.textContent = '';
    if (needUrl) { const c = await window.zks.checkLink(url.value); if (!c.ok) { err.textContent = c.error; return; } url.value = c.url; }
    await window.zks.saveSettings({ url: url.value, key: key.value });
    start();
  };
  clear(root).append(h('div', { class: 'm-main' }, h('div', { class: 'm-login' },
    h('div', { style: { textAlign: 'center', marginBottom: '8px' } }, h('img', { src: 'img/logo.png', style: { height: '64px', background: '#fff', padding: '3px' } })),
    h('h2', { style: { margin: '4px 0 8px' } }, 'ZKS PO – logowanie'),
    h('p', { class: 'muted' }, needUrl ? 'Wpisz adres API i swój klucz użytkownika (klucz dostajesz od administratora).' : 'Wpisz swój klucz użytkownika (dostajesz go od administratora). Adres API pobiera się sam.'),
    needUrl ? h('div', { style: { marginBottom: '8px' } }, url) : null, key,
    h('button', { class: 'btn primary', onclick: go }, 'Zaloguj'), err)));
}

async function shell() {
  const scanEl = h('div', { style: { minHeight: '100%' } });
  const main = h('div', { class: 'm-main' }, scanEl);
  const badge = h('span', { class: 'm-badge', style: { display: 'none' } });
  const scanBtn = h('button', { class: 'on', onclick: () => select('scan') }, 'Skaner');
  const chatBtn = h('button', { onclick: () => select('chat') }, 'Chat', badge);
  const wfBtn = h('button', { onclick: () => select('wf') }, 'Tablica');
  const head = h('div', { class: 'm-head' }, h('img', { src: 'img/logo.png', alt: 'ZKS PO' }),
    h('div', { class: 'm-title' }, h('b', {}, (ctx.user && (ctx.user.name || ctx.user.email)) || ''), h('span', {}, `ZKS PO · iPhone · wersja ${VERSION}`)),
    h('span', { id: 'm-bell' }),
    h('button', { onclick: menu, title: 'Ustawienia' }, '⚙'));
  const wfEl = h('div', { class: 'm-main m-tab-wf', style: { display: 'none' } });
  clear(root).append(head, main, wfEl, h('div', { class: 'm-nav' }, scanBtn, wfBtn, chatBtn));

  // Tablica (Workflow) i powiadomienia – ten sam kod i te same zasady co w programie PC (zmiany tylko MASTER i GOD, inni przeglądają)
  const { createWorkflow } = await import('./js/views/workflow.js');
  const { startWfNotify, bellButton } = await import('./js/views/wfBell.js');
  const wf = createWorkflow(ctx);
  wfEl.append(h('div', { class: 'panel', style: { margin: '8px', padding: '6px' } }, wf.node));
  document.getElementById('m-bell').append(bellButton(ctx));
  // licznik nieprzeczytanych powiadomień także na ikonie aplikacji (iOS 16.4+, aplikacja dodana do ekranu początkowego)
  const bellHost = document.getElementById('m-bell');
  const paintAppBadge = () => { const n = parseInt((bellHost.querySelector('.bell-badge') || {}).textContent, 10) || 0; try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()); } catch { /* bez licznika na ikonie */ } };
  new MutationObserver(paintAppBadge).observe(bellHost, { childList: true, subtree: true, characterData: true });
  startWfNotify(ctx);                                  // nasłuch zadań: dzwonek, wyskakujące komunikaty, powiadomienia systemowe (gdy aplikacja otwarta)
  let wfLoaded = false;

  const { mountScanner } = await import('./js/views/scanner.js');
  mountScanner(scanEl, ctx);
  const { mountPresence } = await import('./js/views/presence.js');
  const presence = mountPresence(ctx);   // okno statusu i komunikatora (tu: pełny ekran po wybraniu „Chat”)
  presence.toggle(false);

  // licznik nieprzeczytanych i dostępnych z „pigułki” okna statusu przenosimy na przycisk Chat
  const pill = document.querySelector('.presence-pill');
  const mirror = () => { const un = pill && pill.querySelector('.presence-unread'); badge.textContent = un ? un.textContent : ''; badge.style.display = un ? '' : 'none'; };
  if (pill) new MutationObserver(mirror).observe(pill, { childList: true, subtree: true, characterData: true });
  mirror();

  function select(what) {
    const chat = what === 'chat', tab = what === 'wf';
    scanBtn.className = what === 'scan' ? 'on' : ''; wfBtn.className = tab ? 'on' : ''; chatBtn.className = chat ? 'on' : '';
    main.style.display = what === 'scan' || chat ? '' : 'none';
    main.style.visibility = chat ? 'hidden' : 'visible';   // przy Chacie układ zostaje (dolny pasek na swoim miejscu), kamera i pola Skanera ukryte
    wfEl.style.display = tab ? '' : 'none';
    if (tab && !wfLoaded) { wfLoaded = true; wf.refresh(); }
    presence.toggle(chat);
  }
  ctx.go = () => select('wf');                         // kliknięcie powiadomienia w dzwonku otwiera Tablicę
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wfLoaded) wf.refresh(); });   // po powrocie do aplikacji – świeże dane
  select('scan');

  function menu() {
    const out = h('div', {},
      h('p', {}, `Zalogowano: ${(ctx.user && (ctx.user.name || ctx.user.email)) || '—'}`),
      h('p', { class: 'muted' }, `Wersja ${VERSION}. Skaner i komunikator działają jak w aplikacji na Androida.`),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: () => location.reload() }, 'Odśwież aplikację'),
        h('button', { class: 'btn', onclick: async () => { await window.zks.saveSettings({ url: (await window.zks.getSettings()).url, key: '' }); location.reload(); } }, 'Wyloguj (usuń klucz)')));
    const mm = modal('Ustawienia', h('div', {}, out, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => mm.close() }, 'Zamknij'))));
  }
}

async function start() {
  try { await window.zks.syncLink(false); } catch { /* bez połączenia z bazą zostaje adres lokalny */ }
  const cfg = await window.zks.getSettings();
  if (!cfg.key || !cfg.url) { await loginView(); return; }
  clear(root).append(h('div', { class: 'm-main' }, h('p', { style: { color: '#fff', padding: '16px' } }, 'Łączenie…')));
  try { ctx.user = await api('api_whoami', []); }
  catch (e) { await loginView('Nie zalogowano: ' + (e.message || e)); return; }
  await shell();
}

// Safari na iPhone'ie nie wysyła „dblclick” przy podwójnym stuknięciu – dodajemy je (edycja komórek tabel jak dwuklik na komputerze)
let lastTap = { t: 0, el: null };
document.addEventListener('touchend', (e) => {
  const el = e.target, now = Date.now();
  if (lastTap.el === el && now - lastTap.t < 350 && el.closest && el.closest('td, th')) {
    const t = e.changedTouches[0];
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
    lastTap = { t: 0, el: null };
  } else lastTap = { t: now, el };
}, { passive: true });

window.addEventListener('unhandledrejection', (e) => { try { toast('Błąd: ' + ((e.reason && e.reason.message) || e.reason), true); } catch { /* bez komunikatu */ } });
start();
