import { bellButton, startWfNotify } from './views/wfBell.js';
import { h, clear, api, apiCached, toast } from './ui.js';
import { preload } from './catalog.js';
import { permissionsSummary } from './logic/common.js';
import { grafikAccess, grafikLevelOf } from './logic/grafikAccess.js';
import { mountWeb } from './views/web.js';
import { mountPlaceholder } from './views/placeholder.js';
import { mountToolRoom } from './views/toolroom.js';

/**
 * Moduł ładowany dopiero przy otwarciu (szybszy start programu).
 * Zwraca funkcję sprzątającą, gdy moduł ją podał (także z obietnicy).
 */
const lazy = (load, name) => (el, c) => {
  let dead = false, inner = null;
  el.append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie…'));
  load().then((m) => {
    if (dead) return;
    clear(el);
    Promise.resolve(m[name](el, c)).then((r) => { if (typeof r === 'function') { if (dead) r(); else inner = r; } });
  }).catch((e) => { if (!dead) { clear(el); el.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano modułu: ' + e.message)); } });
  return () => { dead = true; if (inner) inner(); };
};
const mountHome = lazy(() => import('./views/home.js'), 'mountHome');
const mountSettings = lazy(() => import('./views/settings.js'), 'mountSettings');
const mountCompetence = lazy(() => import('./views/competence.js'), 'mountCompetence');
const mountMistrz = lazy(() => import('./views/mistrz.js'), 'mountMistrz');
const mountScanner = lazy(() => import('./views/scanner.js'), 'mountScanner');
const mountGrafik = lazy(() => import('./views/grafik.js'), 'mountGrafik');
const mountZakupy = lazy(() => import('./views/zakupy.js'), 'mountZakupy');
const mountToolTrack = lazy(() => import('./views/tooltrack.js'), 'mountToolTrack');
const mountContours = lazy(() => import('./views/contours.js'), 'mountContours');
const mountParts = lazy(() => import('./views/parts.js'), 'mountParts');
const mountHarmLive = lazy(() => import('./views/harmLive.js'), 'mountHarmLive');
const mountPlan = lazy(() => import('./views/plan.js'), 'mountPlan');
const mountHelp = lazy(() => import('./views/help.js'), 'mountHelp');
const mountBuilder = lazy(() => import('./views/builder.js'), 'mountBuilder');
const mountBn = lazy(() => import('./views/bn.js'), 'mountBn');
const mountDestroyed = lazy(() => import('./views/destroyed.js'), 'mountDestroyed');
const mountProducts = lazy(() => import('./views/products.js'), 'mountProducts');
const mountMeasuring = lazy(() => import('./views/measuring.js'), 'mountMeasuring');

/** Moduły w kolejności z ekranu głównego (jak w aplikacji na Androida). */
export const MODULES = [
  { id: 'skaner', title: 'Skaner', mount: mountScanner },
  { id: 'grafik', title: 'Grafik', style: 'green-outline', perm: 'grafik', mount: mountGrafik },
  { id: 'kompetencje', title: 'Kompetencje', perm: 'grafik', mount: mountCompetence, visible: () => grafikAccess(grafikLevelOf(ctx.user)).competence },
  // Mistrz PO: zakładki arkusza Mistrz_po z bazy Firebase (kolumny liczone liczy program); od CLERIK, import od MASTER
  { id: 'mistrz', title: 'Mistrz PO', perm: 'grafik', mount: mountMistrz, visible: () => grafikAccess(grafikLevelOf(ctx.user)).cells },
  { id: 'plan', title: 'Plan', perm: 'plan', mount: mountPlan },
  { id: 'narzedziownia', title: 'Narzędziownia', style: 'green', mount: mountToolRoom },
  { id: 'zakupy', title: 'Zakupy', style: 'accent', perm: 'zakupy', mount: mountZakupy },
  // Harmonogram z bazy Firebase (Grafik też z bazy – gr_meta, gr_days); dawny widok z arkusza Google usunięty.
  { id: 'harmonogram-fb', title: 'Harmonogram', mount: mountHarmLive },
  { id: 'help', title: 'Help', mount: mountHelp },
  { id: 'symulator', title: 'Symulator', inHelp: true, web: 'symulator.html' },
  { id: 'symulatornum', title: 'SymulatorNUM', inHelp: true, web: 'symulator-num.html' },
  { id: 'pomiary', title: 'Pomiary', inHelp: true, web: 'karta-pomiaru.html', gas: true },
  // Symulator, SymulatorNUM i Pomiary mają przyciski na ekranie Help (inHelp), nie na ekranie głównym.
  // Przyciski ekranu Narzędziownia (nie ma ich na ekranie głównym).
  { id: 'toolbuilder', title: 'ToolBuilder', style: 'green', inToolRoom: true, mount: mountBuilder },
  { id: 'assemtool', title: 'Assem.Tool', style: 'green', inToolRoom: true, mount: mountBn },
  { id: 'tooltrack', title: 'ToolTrack', style: 'green', inToolRoom: true, mount: mountToolTrack },
  { id: 'kontury', title: 'Kontury', style: 'green', inToolRoom: true, mount: mountContours },
  { id: 'czesci', title: 'Części', style: 'green', inToolRoom: true, mount: mountParts },
  { id: 'produkty', title: 'Produkty', style: 'green', inToolRoom: true, mount: mountProducts },
  { id: 'pomiarowe', title: 'Pomiarowe', style: 'green', inToolRoom: true, mount: mountMeasuring },
  { id: 'zniszczone', title: 'Zniszczone', style: 'green', inToolRoom: true, mount: mountDestroyed },
  { id: 'pomiarowka', title: 'Pomiarówka', style: 'green', inToolRoom: true, disabled: true },
];

export const ctx = {
  version: '',         // numer wersji programu PC (np. 1.1.0)
  user: null,          // { email, name, roles, permissions }
  homeTab: 'braki',    // ekran główny: Braki albo Workflow (przyciski w górnym pasku)
  userError: null,
  go,
  home: () => go('home'),
  /** [fresh] – z pominięciem pamięci (sprawdzenie połączenia w Ustawieniach, bez przebudowy ekranu). */
  async loadUser({ fresh = false } = {}) {
    try {
      // najpierw dane z pamięci (szybki start), potem świeże z serwera: gdy uprawnienia się zmieniły (np. poziom „Grafik dostęp”),
      // pasek i bieżący ekran są budowane od nowa – inaczej obowiązywałyby stare uprawnienia do następnego uruchomienia
      await apiCached('api_whoami', [], (u, meta) => {
        if (fresh) { ctx.user = u; return; }
        const before = JSON.stringify(ctx.user || null);
        ctx.user = u;
        if (meta && !meta.cached && current && before !== 'null' && before !== JSON.stringify(u || null)) go(current);
      }, { force: fresh });
      ctx.userError = null;
    } catch (e) {
      ctx.user = null;
      ctx.userError = e.message;
    }
    return ctx.user;
  },
  canWrite(perm) { return !!ctx.user && (!perm || (ctx.user.permissions || {})[perm] === 'write' || (!(perm in (ctx.user.permissions || {})) && false)); },
  level(perm) { return ctx.user ? (ctx.user.permissions || {})[perm] || 'none' : 'none'; },
  /** Uprawnienia w Grafiku i Kompetencjach (GOD / MASTER / CLERIK / TOURIST). */
  grafikAcc() { return grafikAccess(grafikLevelOf(ctx.user)); },
};

const root = document.getElementById('app');
let cleanup = null;
let current = 'home';

/** Moduły z Narzędziowni wracają do Narzędziowni, moduły z Helpu do Helpu, reszta do ekranu głównego. */
function backTarget(id) {
  const mod = MODULES.find((m) => m.id === id);
  if (mod && mod.inToolRoom) return 'narzedziownia';
  if (mod && mod.inHelp) return 'help';
  return 'home';
}

/**
 * Górny pasek: logo i przyciski modułów (dawniej na ekranie głównym) oraz zakładki Braki i Workflow – widoczne na każdym ekranie,
 * więc między modułami przechodzi się jednym kliknięciem. Moduły z Narzędziowni i Helpu mają dodatkowo „← Wróć” i swój tytuł.
 */
function topbar(title, showBack) {
  const who = (ctx.user ? `Zalogowano: ${ctx.user.name || ctx.user.email}` : '') + (ctx.version ? `${ctx.user ? '  ·  ' : ''}ZKS PO (PC) wersja ${ctx.version}` : '');
  const sub = MODULES.find((m) => m.id === current && (m.inToolRoom || m.inHelp));
  const activeMain = sub ? backTarget(current) : current;
  const navBtn = (label, onclick, { active = false, style = '', disabled = false, title: tip = '' } = {}) =>
    h('button', { class: 'nav ' + style + (active ? ' on' : ''), disabled, title: tip || label, onclick }, label);
  const nav = h('div', { class: 'nav-bar' });
  for (const m of MODULES.filter((x) => !x.inToolRoom && !x.inHelp && (!x.visible || x.visible()))) {
    const denied = m.perm === 'grafik' ? !!ctx.user && !grafikAccess(grafikLevelOf(ctx.user)).view : m.perm && ctx.user && (ctx.user.permissions || {})[m.perm] === 'none';
    nav.append(navBtn(m.title, () => go(m.id), { active: activeMain === m.id, style: m.style || '', disabled: !!denied, title: denied ? `${m.title}: brak uprawnień` : m.title }));
  }
  nav.append(h('span', { class: 'nav-sep' }));
  for (const [tab, label] of [['braki', 'Braki'], ['workflow', 'Workflow']]) {
    nav.append(navBtn(label, () => { ctx.homeTab = tab; go('home'); }, { active: current === 'home' && (ctx.homeTab || 'braki') === tab, title: label === 'Braki' ? 'Braki części' : 'Workflow – zadania' }));
  }
  return h('div', { class: 'topbar' },
    h('img', { class: 'brand', src: 'img/logo.png', alt: 'ZKS PO', title: 'ZKS PO – Braki części', onclick: () => { ctx.homeTab = 'braki'; go('home'); } }),
    nav,
    sub ? h('span', { class: 'sub' }, h('button', { onclick: () => go(backTarget(current)), title: 'Wróć' }, '← Wróć'), h('b', {}, title)) : null,
    h('span', { class: 'grow' }),
    ctx.user ? bellButton(ctx) : null,
        h('span', { class: 'who' }, who),
    current !== 'settings' ? h('button', { onclick: () => go('settings') }, 'Ustawienia') : null);
}

export function go(id) {
  try { sessionStorage.setItem('zks.current', id); } catch { /* bez pamięci sesji */ }
  if (cleanup) { try { cleanup(); } catch (e) { /* ignorujemy */ } cleanup = null; }
  current = id;
  clear(root);
  const screen = h('div', { class: 'screen' });
  let title = 'ZKS PO';
  let mount;
  if (id === 'home') { mount = mountHome; }
  else if (id === 'settings') { title = 'Ustawienia'; mount = mountSettings; }
  else {
    const mod = MODULES.find((m) => m.id === id);
    title = mod ? mod.title : id;
    if (mod && mod.visible && !mod.visible()) mount = (el) => el.append(h('div', { class: 'panel' }, `${mod.title}: brak dostępu.`));
    else if (mod && mod.mount) mount = mod.mount;
    else if (mod && mod.web) mount = (el, c) => mountWeb(el, c, mod);
    else mount = (el, c) => mountPlaceholder(el, c, mod);
  }
  root.append(topbar(title, id !== 'home'), screen);
  document.title = id === 'home' ? 'ZKS PO' : `${title} – ZKS PO`;
  const result = mount(screen, ctx);
  if (typeof result === 'function') cleanup = result;
}

window.addEventListener('unhandledrejection', (e) => { toast('Błąd: ' + (e.reason && e.reason.message || e.reason), true); });

(async () => {
  const cfg = await window.zks.getSettings();
  try { ctx.version = (await window.zks.appVersion?.()) || ''; } catch { ctx.version = ''; }
  if (cfg.url && cfg.key) await ctx.loadUser();
  // po naprawie pamięci bazy (fb.js: resetFirestoreCache – przeładowanie) wracamy do tego samego modułu
  let reopen = null;
  try { const t = Number(sessionStorage.getItem('zks.fb.cacheReset') || 0); if (t && Date.now() - t < 60000) reopen = sessionStorage.getItem('zks.current'); } catch { /* bez pamięci sesji */ }
  go(cfg.url && cfg.key ? (reopen && reopen !== 'settings' ? reopen : 'home') : 'settings');
  if (reopen) setTimeout(() => toast('Naprawiono pamięć lokalną bazy – dane pobrane z serwera od nowa'), 500);
  if (cfg.url && cfg.key) {
    preload(); apiCached('getProductCodes', [], () => {}).catch(() => {});
    startWfNotify(ctx);   // dzwoneczek Workflow
    import('./views/presence.js').then(({ mountPresence }) => mountPresence(ctx)).catch(() => {});   // status i dostępność pracowników (prawy dolny róg)
    import('./prefetch.js').then(({ startBackgroundRefresh }) => startBackgroundRefresh(() => !ctx.user || (ctx.user.permissions || {}).grafik !== 'none')).catch(() => {});
  }
})();
