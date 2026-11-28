import { bellButton, startWfNotify } from './views/wfBell.js';
import { h, clear, api, apiCached, toast } from './ui.js';
import { initTheme, themeMode, setThemeMode } from './theme.js';
import { watchAccessMatrix, loadCachedMatrix } from './accessMatrixStore.js';
import { resolveOn, getOverrides, onOverridesChange } from './logic/accessOverlay.js';
import { nextMode, THEME_LABELS } from './logic/theme.js';
import { preload, setContourGenAdmin } from './catalog.js';
import { permissionsSummary } from './logic/common.js';
import { grafikAccess, grafikLevelOf } from './logic/grafikAccess.js';
import { toolroomAccess, toolroomLevelOf, appAccess } from './logic/toolroomAccess.js';
import { moduleLevelOf } from './logic/moduleLevels.js';
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
    owner = el;                       // nasłuchy klawiatury modułu na dokumencie działają tylko, gdy jego ekran jest widoczny (patrz niżej)
    let res; try { res = m[name](el, c); } finally { owner = null; }
    Promise.resolve(res).then((r) => { if (typeof r === 'function') { if (dead) r(); else inner = r; } });
  }).catch((e) => { if (!dead) { clear(el); el.append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano modułu: ' + e.message)); } });
  const stop = () => { dead = true; if (inner) inner(); };
  stop.onShow = () => { if (inner && inner.onShow) inner.onShow(); };
  return stop;
};

// Moduły trzymane w tle przez całą sesję: po wyjściu ekran jest tylko ukrywany, po powrocie wraca w tym samym stanie (bez ponownego
// wczytywania, filtry, zaznaczenie, przewinięcie). Nasłuchy klawiatury i schowka, które moduł dodaje na `document`, są owijane tak,
// by ukryty moduł nie reagował na klawisze wciśnięte w innym module.
let owner = null;
const GUARDED = new Set(['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut']);
const wrappedListeners = new WeakMap();
{
  const add = document.addEventListener.bind(document), rm = document.removeEventListener.bind(document);
  document.addEventListener = function (type, listener, opts) {
    if (owner && GUARDED.has(type) && typeof listener === 'function') {
      const screen = owner;
      let w = wrappedListeners.get(listener);
      if (!w) { w = function (e) { if (screen.style.display === 'none') return undefined; return listener.call(this, e); }; wrappedListeners.set(listener, w); }
      return add(type, w, opts);
    }
    return add(type, listener, opts);
  };
  document.removeEventListener = function (type, listener, opts) { return rm(type, wrappedListeners.get(listener) || listener, opts); };
}
const KEEP_IDS = new Set(['grafik', 'plan', 'harmonogram-fb', 'mistrz', 'kompetencje', 'zakupy', 'toolbuilder', 'assemtool', 'tooltrack', 'czesci', 'produkty', 'pomiarowe', 'zniszczone', 'zuzycie']);
const kept = new Map();   // id modułu → { screen, cleanup }
/** Zamyka wszystkie moduły trzymane w tle (po zmianie użytkownika, uprawnień albo klucza – muszą się zbudować od nowa). */
export function purgeKept() {
  for (const k of kept.values()) { try { if (k.cleanup) k.cleanup(); } catch { /* ignorujemy */ } k.screen.remove(); }
  kept.clear();
}
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
const mountHelpFeed = lazy(() => import('./views/help.js'), 'mountHelpFeed');
const mountHelpChords = lazy(() => import('./views/help.js'), 'mountHelpChords');
const mountHelpCoords = lazy(() => import('./views/help.js'), 'mountHelpCoords');
const mountHelpLinear = lazy(() => import('./views/help.js'), 'mountHelpLinear');
const mountBuilder = lazy(() => import('./views/builder.js'), 'mountBuilder');
const mountBn = lazy(() => import('./views/bn.js'), 'mountBn');
const mountDestroyed = lazy(() => import('./views/destroyed.js'), 'mountDestroyed');
const mountProducts = lazy(() => import('./views/products.js'), 'mountProducts');
const mountMeasuring = lazy(() => import('./views/measuring.js'), 'mountMeasuring');
const mountSkrzynka = lazy(() => import('./views/skrzynka.js'), 'mountSkrzynka');
const mountZuzycie = lazy(() => import('./views/zuzycie.js'), 'mountZuzycie');

/**
 * Moduły w kolejności przycisków górnego paska: Skaner, Grafik, Plan, Harmonogram, Mistrz, Narzędziownia, Help (potem zakładki Braki i Tablica).
 * [color] – pastelowe tło przycisku w pasku. Kompetencje są w module Mistrz (inMistrz), Zakupy w Narzędziowni (inToolRoom).
 */
/** Dostęp do Narzędziowni i Zakupów wg poziomu z kolumny „Narzędziownia” (logic/toolroomAccess.js). */
export const tra = () => toolroomAccess(toolroomLevelOf(ctx.user));

export const MODULES = [
  { id: 'skaner', title: 'Skaner', color: '#ffd1dc', mount: mountScanner, lock: () => !!ctx.user && !resolveOn('skaner.enter', moduleLevelOf(ctx.user, 'skaner'), 'view', moduleLevelOf(ctx.user, 'skaner') !== 'none') },   // poziom „---” w Skanerze – przycisk niedostępny
  { id: 'grafik', title: 'Grafik', color: '#ffe0b2', perm: 'grafik', mount: mountGrafik },
  { id: 'plan', title: 'Plan', color: '#fff4b0', perm: 'plan', mount: mountPlan },
  // Harmonogram z bazy Firebase (Grafik też z bazy – gr_meta, gr_days); dawny widok z arkusza Google usunięty.
  { id: 'harmonogram-fb', title: 'Harmonogram', color: '#d4efb9', mount: mountHarmLive, lock: () => !appAccess(moduleLevelOf(ctx.user, 'harmonogram'), 'harmonogram').harmonogram },   // TOURIST – przycisk niedostępny
  // Mistrz: zakładki arkusza Mistrz_po z bazy Firebase (kolumny liczone liczy program); od CLERIK, import od MASTER; w środku przycisk Kompetencje
  { id: 'mistrz', title: 'Mistrz', color: '#b9ecd9', perm: 'grafik', mount: mountMistrz, visible: () => grafikAccess(moduleLevelOf(ctx.user, 'mistrz'), 'mistrz').cells },
  { id: 'narzedziownia', title: 'Narzędziownia', color: '#bfe3f7', mount: mountToolRoom, visible: () => tra().enter },   // TOURIST – bez przycisku i bez wejścia
  { id: 'help', title: 'Help', color: '#d6d2f8', mount: mountHelp },
  // Kompetencje: otwierane przyciskiem w module Mistrz (nie ma ich w górnym pasku)
  { id: 'kompetencje', title: 'Kompetencje', perm: 'grafik', inMistrz: true, mount: mountCompetence, visible: () => grafikAccess(moduleLevelOf(ctx.user, 'kompetencje'), 'kompetencje').competence },
  { id: 'symulator', title: 'Symulator', inHelp: true, web: 'symulator.html' },
  { id: 'symulatornum', title: 'SymulatorNUM', inHelp: true, web: 'symulator-num.html' },
  { id: 'pomiary', title: 'Pomiary', inHelp: true, web: 'karta-pomiaru.html', gas: true },
  // każdy kalkulator Help to osobny kafelek i osobna aplikacja
  { id: 'skrzynka', title: '📮 Skrzynka donosów', inHelp: true, mount: mountSkrzynka },
  { id: 'help-posuw', title: 'Posuw dla Rply i Ra', inHelp: true, mount: mountHelpFeed },
  { id: 'help-ciecwy', title: 'Cięciwy na podziale', inHelp: true, mount: mountHelpChords },
  { id: 'help-wspolrzedne', title: 'Współrzędne otworów', inHelp: true, mount: mountHelpCoords },
  { id: 'help-fmm', title: 'F° na Fmm', inHelp: true, mount: mountHelpLinear },
  // Symulator, SymulatorNUM i Pomiary mają przyciski na ekranie Help (inHelp), nie na ekranie głównym.
  // Przyciski ekranu Narzędziownia (nie ma ich na ekranie głównym).
  { id: 'toolbuilder', title: 'ToolBuilder', style: 'green', inToolRoom: true, mount: mountBuilder },
  { id: 'assemtool', title: 'Assem.Tool', style: 'green', inToolRoom: true, mount: mountBn },
  { id: 'tooltrack', title: 'ToolTrack', style: 'green', inToolRoom: true, mount: mountToolTrack },
  { id: 'kontury', title: 'Kontury', style: 'green', inToolRoom: true, viaBuilder: true, mount: mountContours },   // bez przycisku: dostępne tylko po kliknięciu obrazu narzędzia w ToolBuilderze
  { id: 'czesci', title: 'Części', style: 'green', inToolRoom: true, mount: mountParts },
  { id: 'produkty', title: 'Produkty', style: 'green', inToolRoom: true, mount: mountProducts },
  { id: 'pomiarowe', title: 'Pomiarowe', style: 'green', inToolRoom: true, mount: mountMeasuring },
  { id: 'zniszczone', title: 'Zniszczone', style: 'green', inToolRoom: true, mount: mountDestroyed },
  { id: 'zuzycie', title: 'Zużycie', style: 'green', inToolRoom: true, mount: mountZuzycie },   // rejestry ZP (płytki) i ZwG (wiertła, gwintowniki, trepany)
  { id: 'pomiarowka', title: 'Pomiarówka', style: 'green', inToolRoom: true, disabled: true },
  { id: 'zakupy', title: 'Zakupy', perm: 'zakupy', inToolRoom: true, mount: mountZakupy },
];

/** Kolory pastelowe zakładek Braki i Tablica (ekran główny). */
const TAB_COLORS = { braki: '#f8c8e8', workflow: '#e8d5b5' };

// widoczność modułów Narzędziowni wg poziomu (ToolBuilder, Assem.Tool, ToolTrack, Części – CLERIK; wszystko – MASTER, GOD)
for (const m of MODULES) if (m.inToolRoom) m.visible = m.id === 'zakupy' ? () => tra().enter && toolroomAccess(moduleLevelOf(ctx.user, 'zakupy'), 'zakupy').zakupy : () => tra().moduleVisible(m.id);   // Zakupy mają własny poziom

export const ctx = {
  version: '',         // numer wersji programu PC (np. 1.1.0)
  user: null,          // { email, name, roles, permissions }
  homeTab: 'workflow',    // ekran główny: po uruchomieniu Tablica (Workflow); Braki – przycisk w górnym pasku albo logo
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
        if (meta && !meta.cached && current && before !== 'null' && before !== JSON.stringify(u || null)) { purgeKept(); go(current); }
      }, { force: fresh });
      ctx.userError = null;
      setContourGenAdmin(toolroomAccess(toolroomLevelOf(ctx.user)).editContours);   // kontury z generatora: na stałe włączone, wyłączyć może tylko GOD
      try { localStorage.setItem('zks.level', grafikLevelOf(ctx.user)); } catch { /* bez pamięci */ }   // zapamiętany poziom (Ustawienia, gdy serwer nie odpowiada)
    } catch (e) {
      ctx.user = null;
      ctx.userError = e.message;
    }
    return ctx.user;
  },
  canWrite(perm) { return !!ctx.user && (!perm || (ctx.user.permissions || {})[perm] === 'write' || (!(perm in (ctx.user.permissions || {})) && false)); },
  level(perm) {
    if (!ctx.user) return 'none';
    if (perm === 'zakupy') return toolroomAccess(moduleLevelOf(ctx.user, 'zakupy'), 'zakupy').zakupy ? 'write' : 'none';   // Zakupy: MASTER i GOD – zamówienia i zatwierdzanie zakupów, niżej – bez Zakupów
    const have = (ctx.user.permissions || {})[perm] || 'none';
    if (perm === 'plan' && have === 'write' && !appAccess(moduleLevelOf(ctx.user, 'plan'), 'plan').editPlan) return 'read';   // CLERIK i TOURIST: Plan tylko do przeglądania
    return have;
  },
  /** Uprawnienia w Grafiku i Kompetencjach (GOD / MASTER / CLERIK / TOURIST). */
  grafikAcc() { return grafikAccess(grafikLevelOf(ctx.user), 'grafik'); },
  /** Uprawnienia (jak w Grafiku) wg poziomu użytkownika w module [key] – Mistrz, Kompetencje, Tablica… */
  acc(key) { return grafikAccess(moduleLevelOf(ctx.user, key), key); },
};

const root = document.getElementById('app');
let cleanup = null;
let current = 'home';

/** Moduły z Narzędziowni wracają do Narzędziowni, moduły z Helpu do Helpu, reszta do ekranu głównego. */
function backTarget(id) {
  const mod = MODULES.find((m) => m.id === id);
  if (mod && mod.inToolRoom) return 'narzedziownia';
  if (mod && mod.inHelp) return 'help';
  if (mod && mod.inMistrz) return 'mistrz';
  return 'home';
}

/**
 * Górny pasek: logo i przyciski modułów (dawniej na ekranie głównym) oraz zakładki Braki i Tablica – widoczne na każdym ekranie,
 * więc między modułami przechodzi się jednym kliknięciem. Moduły z Narzędziowni i Helpu mają dodatkowo „← Wróć” i swój tytuł.
 */
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
/** Przycisk motywu w pasku: jasny → ciemny → zgodnie z systemem. Pełny wybór jest też w Ustawieniach. */
function themeButton() {
  const paint = (b) => { const m = themeMode(); b.textContent = THEME_ICON[m]; b.title = `Motyw: ${THEME_LABELS[m]} (kliknij, aby zmienić)`; };
  const b = h('button', { class: 'theme-btn', onclick: () => { const n = nextMode(themeMode()); setThemeMode(n); paint(b); toast(`Motyw: ${THEME_LABELS[n]}`); } });
  paint(b);
  return b;
}

function topbar(title, showBack) {
  const who = (ctx.user ? `Zalogowano: ${ctx.user.name || ctx.user.email}` : '') + (ctx.version ? `${ctx.user ? '  ·  ' : ''}ZKS PO (PC) wersja ${ctx.version}` : '');
  const curMod = MODULES.find((m) => m.id === current);
  const sub = curMod && curMod.inHelp ? curMod : null;   // „← Wróć” i tytuł tylko w kafelkach Help; Mistrz i Narzędziownia mają przyciski w drugim rzędzie nagłówka
  const activeMain = curMod && (curMod.inToolRoom || curMod.inHelp || curMod.inMistrz) ? backTarget(current) : current;
  const navBtn = (label, onclick, { active = false, style = '', color = '', disabled = false, title: tip = '' } = {}) =>
    h('button', { class: 'nav ' + style + (active ? ' on' : ''), style: color ? { background: color } : {}, disabled, title: tip || label, onclick }, label);
  const nav = h('div', { class: 'nav-bar' });
  for (const m of MODULES.filter((x) => !x.inToolRoom && !x.inHelp && !x.inMistrz && (!x.visible || x.visible()))) {
    const denied = (m.lock && m.lock()) || (m.perm === 'grafik' ? !!ctx.user && !grafikAccess(grafikLevelOf(ctx.user)).view : m.perm && ctx.user && (ctx.user.permissions || {})[m.perm] === 'none');
    nav.append(navBtn(m.title, () => go(m.id), { active: activeMain === m.id, style: 'pastel', color: m.color, disabled: !!denied, title: denied ? `${m.title}: brak uprawnień` : m.title }));
  }
  for (const [tab, label, color] of [['braki', 'Braki', TAB_COLORS.braki], ['workflow', 'Tablica', TAB_COLORS.workflow]]) {
    nav.append(navBtn(label, () => { ctx.homeTab = tab; go('home'); }, { active: current === 'home' && (ctx.homeTab || 'braki') === tab, style: 'pastel', color, title: label === 'Braki' ? 'Braki części' : 'Tablica – zadania (Workflow)' }));
  }
  // nagłówek dwa razy wyższy: logo (90% wysokości) po lewej, po prawej dwa rzędy – moduły i (pod nimi) przyciski główne wybranego modułu
  ctx.nav2 = h('div', { class: 'nav-bar nav-bar2' });
  // Narzędziownia: przyciski podmodułów w drugim rzędzie (jak w Mistrzu), w kolorze przycisku modułu; wybrany – zielona poświata
  if (activeMain === 'narzedziownia') {
    for (const m of MODULES.filter((x) => x.inToolRoom && !x.viaBuilder && (!x.visible || x.visible()))) {
      const denied = m.perm && ctx.user && ctx.level(m.perm) === 'none';
      ctx.nav2.append(h('button', { class: 'btn small' + (m.id === current ? ' glow' : ''), disabled: !!m.disabled || !!denied, title: m.disabled ? 'Moduł w budowie' : denied ? `${m.title}: brak uprawnień` : m.title, onclick: () => go(m.id) }, m.title));
    }
  }
  return h('div', { class: 'topbar' },
    h('img', { class: 'brand', src: 'img/logo.png', alt: 'ZKS PO', title: 'ZKS PO – Braki części', onclick: () => { ctx.homeTab = 'braki'; go('home'); } }),
    h('div', { class: 'tb-main' },
      h('div', { class: 'tb-row' },
        nav,
        h('span', { class: 'grow' }),
        ctx.user ? bellButton(ctx) : null,
        ctx.presenceNode || null,   // status i komunikator (dawniej w prawym dolnym rogu) – teraz w górnym pasku
        h('span', { class: 'who' }, who),
        themeButton(),
        current !== 'settings' ? h('button', { onclick: () => go('settings') }, 'Ustawienia') : null),
      h('div', { class: 'tb-row' },
        sub ? h('span', { class: 'sub' }, h('button', { onclick: () => go(backTarget(current)), title: 'Wróć' }, '← Wróć'), h('b', {}, title)) : null,
        ctx.nav2)));
}

export function go(id) {
  // Narzędziownia otwiera ostatnio używany podmoduł (przyciski podmodułów są w nagłówku)
  if (id === 'narzedziownia') {
    let last = null; try { last = localStorage.getItem('zks.toolroom.last'); } catch { /* bez pamięci */ }
    const ok = (x) => MODULES.some((m) => m.id === x && m.inToolRoom && !m.disabled && !m.viaBuilder && (!m.visible || m.visible()));
    id = ok(last) ? last : (MODULES.find((m) => ok(m.id)) || { id: 'toolbuilder' }).id;
  }
  { const m = MODULES.find((x) => x.id === id); if (m && m.inToolRoom) { try { localStorage.setItem('zks.toolroom.last', id); } catch { /* bez pamięci */ } } }
  try { sessionStorage.setItem('zks.current', id); } catch { /* bez pamięci sesji */ }
  if (current === 'settings' && id !== 'settings') purgeKept();   // po Ustawieniach (nowy klucz, adres) moduły w tle budują się od nowa
  if (cleanup) { try { cleanup(); } catch (e) { /* ignorujemy */ } cleanup = null; }
  current = id;
  // moduły trzymane w tle zostają w drzewie (ukryte), reszta jest usuwana
  // (układ ekranu – np. flex ustawiony przez moduł – jest zapamiętany i przywracany po powrocie, inaczej tabela traci własne przewijanie)
  for (const c of [...root.children]) { if (c.dataset && c.dataset.kept) { if (c.style.display !== 'none') c.dataset.disp = c.style.display; c.style.display = 'none'; } else c.remove(); }
  const back = kept.get(id);
  const screen = back ? back.screen : h('div', { class: 'screen' });
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
  // przyciski w module mają kolor przycisku modułu (podmoduły Narzędziowni, Helpu i Mistrza – kolor modułu nadrzędnego)
  const own = MODULES.find((m) => m.id === id);
  const parent = own && (own.inToolRoom || own.inHelp || own.inMistrz) ? MODULES.find((m) => m.id === backTarget(id)) : own;
  const modColor = id === 'home' ? (ctx.homeTab === 'workflow' ? TAB_COLORS.workflow : TAB_COLORS.braki) : parent && parent.color;
  root.style.setProperty('--modcolor', modColor || '');
  if (modColor) screen.classList.add('themed'); else screen.classList.remove('themed');
  root.prepend(topbar(title, id !== 'home'));
  document.title = id === 'home' ? 'ZKS PO' : `${title} – ZKS PO`;
  if (back) {
    screen.style.display = screen.dataset.disp || '';
    if (!screen.isConnected) root.append(screen);
    try { if (back.cleanup && back.cleanup.onShow) back.cleanup.onShow(); } catch { /* ignorujemy */ }
    window.dispatchEvent(new Event('resize'));   // widoki liczące rozmiar (Plan) odświeżają się po ponownym pokazaniu
    return;
  }
  root.append(screen);
  const result = mount(screen, ctx);
  if (KEEP_IDS.has(id) && own && !(own.visible && !own.visible())) { screen.dataset.kept = '1'; kept.set(id, { screen, cleanup: typeof result === 'function' ? result : null }); }
  else if (typeof result === 'function') cleanup = result;
}

initTheme();
loadCachedMatrix();   // tabela uprawnień z poprzedniego uruchomienia – przyciski od razu zgodne z nią, zanim odpowie baza
{   // zmiana tabeli uprawnień na żywo (GOD zapisał ją na innym komputerze albo tu): widoki budują się od nowa z nowymi prawami
  let last = JSON.stringify(getOverrides());
  onOverridesChange((o) => {
    const j = JSON.stringify(o);
    if (j === last) return;
    last = j;
    if (!ctx.user) return;
    purgeKept(); toast('Zmieniono tabelę uprawnień – widok odświeżony'); go(current);
  });
}
window.addEventListener('unhandledrejection', (e) => { toast('Błąd: ' + (e.reason && e.reason.message || e.reason), true); });

(async () => {
  // adres API trzymany jest w bazie: przy starcie przyjmujemy nowszy (PC administratora go zapisuje) – patrz linkStore.js
  try { await window.zks.syncLink(false); } catch { /* bez połączenia zostaje adres lokalny */ }
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
    watchAccessMatrix();   // tabela uprawnień z bazy (na żywo)
    startWfNotify(ctx);   // dzwoneczek Workflow
    // administrator (GOD): lokalny adres API różny od zapisanego w bazie trafia do bazy (jedno miejsce prawdy dla PC i telefonów)
    if (ctx.user && grafikLevelOf(ctx.user) === 'god') import('./linkStore.js').then(({ publishIfDiffers }) => publishIfDiffers(cfg.url, ctx.user.name || ctx.user.email))
      .then((r) => { if (r && r.changed) toast(`Adres API zapisany w bazie (wersja ${r.ver}) – inne programy pobiorą go przy starcie`); }).catch(() => {});
    import('./views/presence.js').then(({ mountPresence }) => {
      mountPresence(ctx); ctx.presenceNode = document.getElementById('presence-widget');
      const row = document.querySelector('.topbar .tb-row'); if (row && ctx.presenceNode) row.insertBefore(ctx.presenceNode, row.querySelector('.who'));
    }).catch(() => {});   // status i dostępność pracowników (prawy dolny róg)
    import('./prefetch.js').then(({ startBackgroundRefresh }) => startBackgroundRefresh(() => !ctx.user || (ctx.user.permissions || {}).grafik !== 'none')).catch(() => {});
  }
})();
