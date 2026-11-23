// Dzwoneczek Workflow w górnym pasku: powiadomienia o nowych zadaniach, zmianach statusu (także moich zleceń) i zaległych zadaniach.
// Lista zdarzeń i ustawienia – w pamięci tego komputera (osobno dla użytkownika); zdarzenia powstają z porównania kolejnych stanów wf_tasks na żywo.
import { h, clear, toast } from '../ui.js';
import { watchWorkflow } from '../wfStore.js';
import * as N from '../logic/wfNotify.js';

const S = { ctx: null, key: '', settings: N.normSettings(), events: [], seen: 0, snap: null, started: false, bells: new Set(), menu: null };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci */ } };
const K = (n) => `zks.wfn.${S.key}.${n}`;
const unread = () => S.events.filter((e) => e.ts > S.seen).length;

function loadState() {
  const u = S.ctx && S.ctx.user, key = String((u && (u.email || u.name)) || 'anon').toLowerCase();
  if (S.key === key) return;
  S.key = key; S.settings = N.normSettings(lsGet(K('settings'), null)); S.events = lsGet(K('events'), []); S.seen = Number(lsGet(K('seen'), 0)) || 0;
  S.snap = lsGet(K('snap'), null) ? N.objToSnap(lsGet(K('snap'), null)) : null;
}
const saveEvents = () => { lsSet(K('events'), S.events.slice(0, 60)); lsSet(K('seen'), S.seen); };
function refreshBells() { for (const b of [...S.bells]) { if (!b.isConnected) { S.bells.delete(b); continue; } paintBell(b); } if (S.menu) paintMenu(); }
function paintBell(b) { const n = unread(); clear(b).append(...[h('span', {}, '🔔'), n ? h('span', { class: 'bell-badge' }, n > 9 ? '9+' : String(n)) : null].filter(Boolean)); b.title = n ? `Workflow: nieprzeczytane powiadomienia (${n})` : 'Powiadomienia Workflow'; }

function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 180); } catch { /* bez dźwięku */ } }
function announce(evs) {
  if (!evs.length) return;
  S.events = [...evs, ...S.events].slice(0, 60); saveEvents(); refreshBells();
  toast('🔔 ' + (evs.length === 1 ? evs[0].title : `Workflow: ${evs.length} nowych powiadomień`));
  if (S.settings.sound) beep();
  if (S.settings.system && typeof Notification !== 'undefined') {
    const fire = () => { try { new Notification('Workflow – ' + (evs.length === 1 ? evs[0].title : `${evs.length} powiadomień`), { body: evs.length === 1 ? evs[0].text : evs.map((e) => e.title).slice(0, 3).join('\n') }); } catch { /* bez powiadomień systemowych */ } };
    if (Notification.permission === 'granted') fire(); else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') fire(); });
  }
}
function onTasks(recs, meta) {
  if (meta && meta.fromCache) return;   // czekamy na dane z serwera (pamięć lokalna może być stara)
  const me = (S.ctx.user && (S.ctx.user.name || S.ctx.user.email)) || '', evs = N.diffTasks(S.snap, recs, me, S.settings);
  S.snap = N.snapshotOf(recs); lsSet(K('snap'), N.snapToObj(S.snap));
  const today = new Date().toDateString();
  if (S.settings.stale && lsGet(K('digest'), '') !== today) { const d = N.staleDigest(recs, S.settings); if (d) evs.push(d); lsSet(K('digest'), today); }   // przypomnienie raz dziennie
  announce(evs);
}
/** Start nasłuchu zadań Workflow (raz): wywołać po zalogowaniu użytkownika. */
export function startWfNotify(ctx) {
  S.ctx = ctx; loadState();
  if (S.started) return; S.started = true;
  watchWorkflow(onTasks, () => { /* brak dostępu – bez powiadomień */ }).catch(() => { S.started = false; });
}

function closeMenu() { if (S.menu) { S.menu.remove(); S.menu = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); } }
const outside = (e) => { if (S.menu && !S.menu.contains(e.target) && ![...S.bells].some((b) => b.contains(e.target))) closeMenu(); };
const onKey = (e) => { if (e.key === 'Escape' && S.menu) { e.stopPropagation(); closeMenu(); } };
function paintMenu() {
  const m = S.menu; if (!m) return; clear(m);
  const chk = (key, label, tip = '') => { const i = h('input', { type: 'checkbox', checked: !!S.settings[key], onchange: () => { S.settings[key] = i.checked; lsSet(K('settings'), S.settings); if (key === 'system' && i.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } }); return h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' }, title: tip }, i, label); };
  const num = (key, w = '46px') => { const i = h('input', { type: 'number', min: 1, max: 365, value: S.settings[key], style: { width: w }, onchange: () => { S.settings = N.normSettings({ ...S.settings, [key]: i.value }); lsSet(K('settings'), S.settings); i.value = S.settings[key]; } }); return i; };
  const list = h('div', { class: 'bell-list' });
  if (!S.events.length) list.append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Brak powiadomień. Pojawią się tu nowe zadania, zmiany statusu i zaległości w Workflow.'));
  for (const e of S.events) list.append(h('div', { class: 'bell-item' + (e.ts > S.seen ? ' new' : ''), onclick: () => { closeMenu(); S.ctx.homeTab = 'workflow'; S.ctx.go('home'); } },
    h('div', { style: { fontWeight: e.ts > S.seen ? 700 : 400 } }, (e.type === 'stale' ? '⏰ ' : e.type === 'new' ? '🆕 ' : '🔁 ') + e.title + (e.mine ? '  (moje)' : '')), e.text ? h('div', { class: 'muted', style: { fontSize: '11px' } }, e.text) : null,
    h('div', { class: 'muted', style: { fontSize: '10px' } }, new Date(e.ts).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))));
  m.append(h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('b', {}, 'Powiadomienia Workflow'), h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => { S.seen = Date.now(); saveEvents(); refreshBells(); } }, 'Przeczytane'), h('button', { class: 'btn', onclick: () => { S.events = []; saveEvents(); refreshBells(); } }, 'Wyczyść')), list,
    h('details', { style: { marginTop: '6px' } }, h('summary', {}, 'Ustawienia powiadomień'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' } },
        chk('newTasks', 'Nowe zadania'), chk('status', 'Zmiany statusu zadań'), chk('mineOnly', 'Zmiany statusu tylko moich zleceń', 'Zadania, w których jesteś zlecającym (kolumna G)'),
        h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, chk('stale', 'Raz dziennie: zaległe – wstrzymane >'), num('heldDays'), 'dni, w trakcie >', num('progressDays'), 'dni'),
        chk('sound', 'Dźwięk przy nowym powiadomieniu'), chk('system', 'Powiadomienia systemowe (Windows)'))));
}
/** Przycisk dzwonka do paska (każde przebudowanie paska tworzy nowy przycisk; stan jest wspólny). */
export function bellButton(ctx) {
  S.ctx = ctx; loadState();
  const b = h('button', { class: 'nav bell', onclick: () => {
    if (S.menu) { closeMenu(); return; }
    S.menu = h('div', { class: 'bell-menu' }); document.body.append(S.menu);
    const r = b.getBoundingClientRect(); S.menu.style.top = Math.round(r.bottom + 4) + 'px'; S.menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    paintMenu(); S.seenOnOpen = S.seen; S.seen = Date.now(); saveEvents();   // otwarcie = przeczytane (pogrubienie zostaje do zamknięcia)
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey, true); refreshBellsOnly();
  } });
  S.bells.add(b); paintBell(b);
  return b;
}
function refreshBellsOnly() { for (const b of [...S.bells]) { if (b.isConnected) paintBell(b); } }
