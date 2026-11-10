import { h, clear, api, apiCached, toast } from './ui.js';
import { preload } from './catalog.js';
import { startBackgroundRefresh } from './prefetch.js';
import { permissionsSummary } from './logic/common.js';
import { mountHome } from './views/home.js';
import { mountSettings } from './views/settings.js';
import { mountScanner } from './views/scanner.js';
import { mountGrafik } from './views/grafik.js';
import { mountZakupy } from './views/zakupy.js';
import { mountWeb } from './views/web.js';
import { mountPlaceholder } from './views/placeholder.js';
import { mountToolTrack } from './views/tooltrack.js';
import { mountHarm } from './views/harm.js';
import { mountPlan } from './views/plan.js';
import { mountHelp } from './views/help.js';
import { mountBuilder } from './views/builder.js';
import { mountBn } from './views/bn.js';
import { mountToolRoom } from './views/toolroom.js';

/** Moduły w kolejności z ekranu głównego (jak w aplikacji na Androida). */
export const MODULES = [
  { id: 'skaner', title: 'Skaner', mount: mountScanner },
  { id: 'grafik', title: 'Grafik', style: 'green-outline', perm: 'grafik', mount: mountGrafik },
  { id: 'plan', title: 'Plan', perm: 'plan', mount: mountPlan },
  { id: 'narzedziownia', title: 'Narzędziownia', style: 'green', mount: mountToolRoom },
  { id: 'zakupy', title: 'Zakupy', style: 'accent', perm: 'zakupy', mount: mountZakupy },
  { id: 'harmonogram', title: 'Harmonogram', mount: mountHarm },
  { id: 'help', title: 'Help', mount: mountHelp },
  { id: 'symulator', title: 'Symulator', inHelp: true, web: 'symulator.html' },
  { id: 'symulatornum', title: 'SymulatorNUM', inHelp: true, web: 'symulator-num.html' },
  { id: 'pomiary', title: 'Pomiary', inHelp: true, web: 'karta-pomiaru.html', gas: true },
  // Symulator, SymulatorNUM i Pomiary mają przyciski na ekranie Help (inHelp), nie na ekranie głównym.
  // Przyciski ekranu Narzędziownia (nie ma ich na ekranie głównym).
  { id: 'toolbuilder', title: 'ToolBuilder', style: 'green', inToolRoom: true, mount: mountBuilder },
  { id: 'assemtool', title: 'Assem.Tool', style: 'green', inToolRoom: true, mount: mountBn },
  { id: 'tooltrack', title: 'ToolTrack', style: 'green', inToolRoom: true, mount: mountToolTrack },
  { id: 'zniszczone', title: 'Zniszczone', style: 'green', inToolRoom: true, disabled: true },
  { id: 'pomiarowka', title: 'Pomiarówka', style: 'green', inToolRoom: true, disabled: true },
];

export const ctx = {
  user: null,          // { email, name, roles, permissions }
  userError: null,
  go,
  home: () => go('home'),
  async loadUser() {
    try {
      await apiCached('api_whoami', [], (u) => { ctx.user = u; });
      ctx.userError = null;
    } catch (e) {
      ctx.user = null;
      ctx.userError = e.message;
    }
    return ctx.user;
  },
  canWrite(perm) { return !!ctx.user && (!perm || (ctx.user.permissions || {})[perm] === 'write' || (!(perm in (ctx.user.permissions || {})) && false)); },
  level(perm) { return ctx.user ? (ctx.user.permissions || {})[perm] || 'none' : 'none'; },
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

function topbar(title, showBack) {
  const who = ctx.user ? `Zalogowano: ${ctx.user.name || ctx.user.email}` : '';
  return h('div', { class: 'topbar' },
    showBack ? h('button', { onclick: () => go(backTarget(current)), title: 'Wróć' }, '← Wróć') : null,
    h('h1', {}, title),
    h('span', { class: 'who' }, who),
    current !== 'settings' ? h('button', { onclick: () => go('settings') }, 'Ustawienia') : null);
}

export function go(id) {
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
    if (mod && mod.mount) mount = mod.mount;
    else if (mod && mod.web) mount = (el, c) => mountWeb(el, c, mod);
    else mount = (el, c) => mountPlaceholder(el, c, mod);
  }
  root.append(topbar(title, id !== 'home'), screen);
  const result = mount(screen, ctx);
  if (typeof result === 'function') cleanup = result;
}

window.addEventListener('unhandledrejection', (e) => { toast('Błąd: ' + (e.reason && e.reason.message || e.reason), true); });

(async () => {
  const cfg = await window.zks.getSettings();
  if (cfg.url && cfg.key) await ctx.loadUser();
  go(cfg.url && cfg.key ? 'home' : 'settings');
  if (cfg.url && cfg.key) {
    preload(); apiCached('getProductCodes', [], () => {}).catch(() => {});
    startBackgroundRefresh(() => !ctx.user || (ctx.user.permissions || {}).grafik !== 'none');
  }
})();
