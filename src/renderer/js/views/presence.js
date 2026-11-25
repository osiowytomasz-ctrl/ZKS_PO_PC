// Status i dostępność pracowników – menu rozwijane w prawym dolnym rogu programu (widoczne na każdym ekranie).
// Każdy ustawia własny status (dostępny, przy maszynie, zajęty …) z notatką i godziną „do”; lista pokazuje stan bieżący wszystkich.
// Każda zmiana trafia do dziennika (presence_log); historię widzą tylko osoby z listy w logic/presence.js (Osiowy Tomasz, Kumała Łukasz, Skupnik Adam).
import { h, clear, toast } from '../ui.js';
import { firebase, fbUid } from '../fb.js';
import * as P from '../logic/presence.js';
import * as C from '../logic/chat.js';

const dot = (color, size = 10) => h('span', { style: { display: 'inline-block', width: size + 'px', height: size + 'px', borderRadius: '50%', background: color, flex: 'none' } });

export function mountPresence(ctx) {
  const old = document.getElementById('presence-widget');
  if (old) return old._api;
  const st = { open: false, tab: 'list', states: new Map(), error: '', uid: '', sdk: null, db: null, form: { status: '', note: '', until: '' }, formDirty: false, hist: { range: 7, name: '', rows: null, loading: false },
    devs: new Map(),
    chat: { conv: C.GENERAL, docs: new Map(), watching: new Set(), inbox: {}, seen: new Set(), ready: false, text: '', cleaned: false, read: {} } };
  const READ_KEY = 'zks.chat.read';
  try { st.chat.read = JSON.parse(localStorage.getItem(READ_KEY) || '{}') || {}; } catch { st.chat.read = {}; }
  const user = () => ctx.user || {};
  const mayHistory = () => P.canSeeHistory(user().name);
  const mayDevices = () => P.canSeeDevices(user().name);   // wersja oprogramowania i rodzaj urządzenia przy nazwisku – tylko wskazana osoba
  const root = h('div', { id: 'presence-widget', class: 'presence' });
  const panel = h('div', { class: 'presence-panel', style: { display: 'none' } });
  const pill = h('button', { class: 'presence-pill', title: 'Status i dostępność pracowników', onclick: () => toggle() });
  root.append(panel, pill);
  document.body.append(root);

  const mine = () => st.states.get(st.uid) || null;
  function paintPill() {
    const m = mine(), s = P.statusOf(m && !P.isStale(m) ? m.status : ''), free = [...st.states.values()].filter((p) => !P.isStale(p) && P.statusOf(p.status).free).length;
    const un = unreadTotal();
    clear(pill).append(...[dot(s.color, 11), h('span', {}, m ? s.label : 'Ustaw status'), h('span', { class: 'presence-count', title: 'Dostępni teraz' }, String(free)), un ? h('span', { class: 'presence-unread', title: 'Nieprzeczytane wiadomości' }, '✉ ' + un) : null, h('span', {}, st.open ? '▾' : '▴')].filter(Boolean));
  }
  function toggle(force) {
    st.open = force != null ? force : !st.open;
    panel.style.display = st.open ? '' : 'none';
    if (st.open) { const m = mine(); if (!st.formDirty) st.form = { status: (m && m.status) || '', note: (m && m.note) || '', until: (m && m.until) || '' }; paintPanel(); }
    paintPill();
  }

  async function save() {
    const state = P.makeState(user(), st.form);
    if (!state) { toast('Wybierz status.', true); return; }
    try {
      const { sdk, db } = st.sdk ? { sdk: st.sdk, db: st.db } : await firebase();
      const uid = st.uid || fbUid(); st.uid = uid;
      const prev = st.states.get(uid) || null;
      await sdk.setDoc(sdk.doc(db, 'presence', uid), state);
      if (P.changed(prev, state)) {   // dziennik zmian (dokument dnia, mapa wpisów) – tylko przy rzeczywistej zmianie
        const l = P.makeLogEntry(uid, state, prev && prev.status);
        await sdk.setDoc(sdk.doc(db, 'presence_log', P.dayKey(state.updatedAt)), { e: { [l.key]: l.entry } }, { merge: true });
      }
      st.formDirty = false; toast('Status zapisany');
    } catch (e) { toast('Nie zapisano statusu: ' + (e.code === 'permission-denied' ? 'brak dostępu do bazy (reguły Firestore – presence)' : e.message), true); }
  }

  function formView() {
    const chips = h('div', { class: 'presence-chips' }, ...P.STATUSES.map((s) => h('button', { class: 'presence-chip' + (st.form.status === s.id ? ' on' : ''), onclick: () => { st.form.status = s.id; st.formDirty = true; paintPanel(); } }, dot(s.color), s.label)));
    const note = h('input', { type: 'text', maxLength: 140, placeholder: 'Notatka (np. CNC 3, wracam za godzinę)', value: st.form.note, style: { width: '100%' }, oninput: () => { st.form.note = note.value; st.formDirty = true; } });
    const until = h('input', { type: 'text', placeholder: 'do godz. (HH:MM)', value: st.form.until, style: { width: '120px' }, oninput: () => { st.form.until = until.value; st.formDirty = true; } });
    note.onkeydown = until.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    return h('div', { class: 'presence-form' }, h('b', {}, 'Mój status'), chips, note, h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, until, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: save }, 'Zapisz')));
  }
  /** Ikony urządzeń z wersją oprogramowania (🖥 PC, 🤖 Android) – tylko dla osoby z DEVICE_USERS. */
  function deviceBadges(uid) {
    if (!mayDevices()) return [];
    const now = Date.now();
    return P.devicesFor(uid, st.devs, now).map((d) => h('span', { class: 'presence-dev' + (d.stale ? ' stale' : ''), title: `${{ pc: 'Program na komputer (PC)', android: 'Aplikacja na Androida', ios: 'Wersja na iPhone\'a' }[d.platform] || d.platform}, wersja ${d.ver || '?'} · ostatnio: ${d.seenAt ? P.timeText(d.seenAt, now) : '—'}${d.stale ? ' (dawno nieużywane)' : ''}` },
      ' ' + ({ pc: '🖥', android: '🤖', ios: '📱' }[d.platform] || '•'), h('span', { class: 'muted', style: { fontSize: '10px' } }, d.ver ? 'v' + d.ver : '')));
  }
  function listView() {
    const now = Date.now(), items = P.sortPresence([...st.states.entries()].map(([uid, p]) => ({ ...p, uid })), now);
    const box = h('div', { class: 'presence-list' }, h('b', {}, `Pracownicy (${items.length})`));
    if (!items.length) box.append(h('div', { class: 'muted' }, st.error || 'Nikt nie ustawił jeszcze statusu.'));
    for (const p of items) {
      const stale = P.isStale(p, now), s = P.statusOf(p.status);
      box.append(h('div', { class: 'presence-row' + (stale ? ' stale' : ''), title: stale ? 'Brak aktualizacji od ponad 12 godzin' : '' }, dot(stale ? '#bdbdbd' : s.color, 11),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', {}, h('b', {}, p.name || '—'), ...deviceBadges(p.uid), ' · ', s.label, p.until ? ` do ${p.until}` : ''), p.note ? h('div', { class: 'muted', style: { fontSize: '11px' } }, p.note) : null),
        h('span', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap' } }, P.timeText(p.updatedAt, now))));
    }
    return box;
  }
  async function loadHistory() {
    if (!mayHistory()) return;
    st.hist.loading = true; st.hist.rows = null; paintPanel();
    try {
      const { sdk, db } = st.sdk ? { sdk: st.sdk, db: st.db } : await firebase();
      const days = P.lastDays(Date.now(), st.hist.range), docs = {};
      await Promise.all(days.map(async (d) => { const s = await sdk.getDoc(sdk.doc(db, 'presence_log', d)); if (s.exists()) docs[d] = s.data(); }));
      st.hist.rows = P.logEntries(docs);
    } catch (e) { st.hist.rows = []; toast('Historia: ' + (e.code === 'permission-denied' ? 'brak dostępu (reguły Firestore – presence_log)' : e.message), true); }
    st.hist.loading = false; paintPanel();
  }
  function historyView() {
    const h0 = st.hist, rows = (h0.rows || []).filter((e) => !h0.name || e.name === h0.name), names = [...new Set((h0.rows || []).map((e) => e.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
    const range = h('select', { onchange: () => { h0.range = Number(range.value); loadHistory(); } }, ...[[1, 'Dziś'], [7, '7 dni'], [30, '30 dni']].map(([v, l]) => h('option', { value: v, selected: v === h0.range }, l)));
    const who = h('select', { onchange: () => { h0.name = who.value; paintPanel(); } }, h('option', { value: '' }, 'Wszyscy'), ...names.map((n) => h('option', { value: n, selected: n === h0.name }, n)));
    const tbl = h('div', { class: 'presence-hist' });
    if (h0.loading) tbl.append(h('div', { class: 'muted' }, 'Ładowanie historii…'));
    else if (h0.rows == null) tbl.append(h('div', { class: 'muted' }, 'Kliknij „Odśwież”, aby wczytać historię.'));
    else if (!rows.length) tbl.append(h('div', { class: 'muted' }, 'Brak wpisów w wybranym okresie.'));
    for (const e of rows.slice(0, 300)) {
      const s = P.statusOf(e.status), pv = e.prev ? P.statusOf(e.prev) : null;
      tbl.append(h('div', { class: 'presence-row' }, dot(s.color, 10), h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', {}, h('b', {}, e.name || '—'), ' → ', s.label, e.until ? ` do ${e.until}` : '', pv ? h('span', { class: 'muted' }, `  (było: ${pv.label})`) : null), e.note ? h('div', { class: 'muted', style: { fontSize: '11px' } }, e.note) : null),
        h('span', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap' } }, P.timeText(e.ts))));
    }
    return h('div', {}, h('div', { class: 'row', style: { gap: '6px', margin: '4px 0' } }, range, who, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => loadHistory() }, 'Odśwież')),
      h('div', { class: 'muted', style: { fontSize: '11px' } }, `Wpisów: ${rows.length}${rows.length > 300 ? ' (pokazano 300 najnowszych)' : ''} · historia widoczna tylko dla uprawnionych`), tbl);
  }
  function paintPanel() {
    clear(panel);
    const un = unreadTotal();
    const tabs = h('div', { class: 'presence-tabs' }, h('button', { class: st.tab === 'list' ? 'on' : '', onclick: () => { st.tab = 'list'; paintPanel(); } }, 'Status'),
      h('button', { class: st.tab === 'chat' ? 'on' : '', onclick: () => { st.tab = 'chat'; openChat(); } }, 'Rozmowy' + (un ? ` (${un})` : '')),
      mayHistory() ? h('button', { class: st.tab === 'hist' ? 'on' : '', onclick: () => { st.tab = 'hist'; if (st.hist.rows == null) loadHistory(); else paintPanel(); } }, 'Historia') : null,
      h('span', { class: 'grow' }), h('button', { class: 'presence-close', title: 'Zamknij', onclick: () => toggle(false) }, '✕'));
    if (st.tab === 'hist' && !mayHistory()) st.tab = 'list';
    panel.append(tabs, st.tab === 'hist' ? historyView() : st.tab === 'chat' ? chatView() : h('div', {}, formView(), listView()));
    if (st.tab === 'chat') { const l = panel.querySelector('.chat-log'); if (l) l.scrollTop = l.scrollHeight; }
  }

  // ---------- komunikator: rozmowa ogólna i prywatne, wiadomości najwyżej 3 dni ----------
  const peers = () => [...st.states.entries()].filter(([uid]) => uid !== st.uid).map(([uid, p]) => ({ uid, name: p.name || uid })).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const convOfPeer = (uid) => C.dmId(st.uid, uid);
  const msgsOf = (conv) => C.mergeMessages(Object.fromEntries([...(st.chat.docs.get(conv) || new Map()).entries()]), Date.now());
  const saveRead = () => { try { localStorage.setItem(READ_KEY, JSON.stringify(st.chat.read)); } catch { /* bez pamięci */ } };
  function unreadTotal() {
    let n = C.unreadCount(msgsOf(C.GENERAL), st.uid, st.chat.read[C.GENERAL]);
    for (const [from, v] of Object.entries(st.chat.inbox)) { const conv = convOfPeer(from); if (v && Number(v.ts) > Number(st.chat.read[conv] || 0) && Number(v.ts) > Date.now() - C.RETENTION_MS) n += 1; }
    return n;
  }
  function markRead(conv) {
    const ms = msgsOf(conv), last = ms.length ? Number(ms[ms.length - 1].ts) : 0, inb = Object.entries(st.chat.inbox).find(([from]) => convOfPeer(from) === conv);
    st.chat.read[conv] = Math.max(Number(st.chat.read[conv] || 0), last, inb ? Number(inb[1].ts || 0) : 0); saveRead();
  }
  /** Nasłuch dokumentów dni jednej rozmowy (dziś i 3 poprzednie dni). */
  function watchConv(conv) {
    if (st.chat.watching.has(conv) || !st.sdk) return;
    st.chat.watching.add(conv);
    const { sdk, db } = st, born = Date.now();
    for (const day of C.readDays()) {
      sdk.onSnapshot(sdk.doc(db, 'chat', C.docId(conv, day)), (snap) => {
        const m = st.chat.docs.get(conv) || new Map(); st.chat.docs.set(conv, m); m.set(day, snap.exists() ? snap.data() : null);
        // nowa cudza wiadomość (po wczytaniu początkowym): powiadomienie, gdy rozmowa nie jest otwarta
        for (const [k, v] of Object.entries((snap.exists() && snap.data().m) || {})) {
          const id = conv + '/' + k;
          if (st.chat.seen.has(id)) continue; st.chat.seen.add(id);
          if (st.chat.ready && v.u !== st.uid && Number(v.ts) > born - 2000 && !(st.open && st.tab === 'chat' && st.chat.conv === conv)) toast(`✉ ${v.n || 'Wiadomość'}: ${String(v.x).slice(0, 80)}`);
        }
        if (st.open && st.tab === 'chat' && st.chat.conv === conv) { markRead(conv); repaintChat(); }
        paintPill(); if (st.open) { const t = panel.querySelector('.presence-tabs'); if (t) paintTabsOnly(); }
      }, () => { /* brak dostępu – bez rozmów */ });
    }
  }
  function paintTabsOnly() { const un = unreadTotal(), b = [...panel.querySelectorAll('.presence-tabs button')].find((x) => x.textContent.startsWith('Rozmowy')); if (b) b.textContent = 'Rozmowy' + (un ? ` (${un})` : ''); }
  async function cleanupChat() {   // usunięcie dokumentów starszych niż 3 dni (rozmowa ogólna i prywatne ze znanymi osobami)
    if (st.chat.cleaned || !st.sdk) return; st.chat.cleaned = true;
    const { sdk, db } = st, convs = [C.GENERAL, ...peers().map((p) => convOfPeer(p.uid))];
    for (const conv of convs) for (const day of (conv === C.GENERAL ? C.expiredDays(Date.now(), 4, 30) : C.expiredDays())) { try { await sdk.deleteDoc(sdk.doc(db, 'chat', C.docId(conv, day))); } catch { /* brak dokumentu / uprawnień */ } }
  }
  function openChat() { watchConv(st.chat.conv); markRead(st.chat.conv); paintPanel(); paintPill(); cleanupChat(); }
  async function sendChat() {
    const user0 = user(), m = C.makeMessage(st.uid, user0.name || user0.email, st.chat.text);
    if (!m) return;
    try {
      const { sdk, db } = st, day = P.dayKey(m.msg.ts);
      await sdk.setDoc(sdk.doc(db, 'chat', C.docId(st.chat.conv, day)), { t: C.dayStart(day), m: { [m.key]: m.msg } }, { merge: true });
      if (st.chat.conv !== C.GENERAL) {   // powiadomienie w skrzynce rozmówcy
        const peer = peers().find((p) => C.dmId(st.uid, p.uid) === st.chat.conv);
        if (peer) await sdk.setDoc(sdk.doc(db, 'chat_inbox', peer.uid), { [st.uid]: { n: m.msg.n, ts: m.msg.ts, x: m.msg.x.slice(0, 80) } }, { merge: true });
      }
      st.chat.text = ''; const inp = panel.querySelector('.chat-input'); if (inp) { inp.value = ''; inp.focus(); }
    } catch (e) { toast('Nie wysłano: ' + (e.code === 'permission-denied' ? 'brak dostępu do bazy (reguły Firestore – chat)' : e.message), true); }
  }
  function repaintChat() { const old = panel.querySelector('.chat-log'); if (old) { const fresh = chatLog(); old.replaceWith(fresh); fresh.scrollTop = fresh.scrollHeight; } }
  function chatLog() {
    const log = h('div', { class: 'chat-log' }), ms = msgsOf(st.chat.conv), now = Date.now();
    if (!ms.length) log.append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Brak wiadomości. Rozmowy są przechowywane do 3 dni.'));
    let lastDay = '';
    for (const m of ms) {
      const d = P.dayKey(m.ts); if (d !== lastDay) { lastDay = d; log.append(h('div', { class: 'chat-day' }, C.dayLabel(m.ts, now))); }
      const own = m.u === st.uid;
      log.append(h('div', { class: 'chat-msg' + (own ? ' own' : '') }, h('div', { class: 'chat-meta' }, own ? 'Ja' : (m.n || '—'), ' · ', P.timeText(m.ts, now).replace(/^.* /, '')), h('div', {}, m.x)));
    }
    return log;
  }
  function chatView() {
    const sel = h('select', { style: { width: '100%' }, onchange: () => { st.chat.conv = sel.value; watchConv(sel.value); markRead(sel.value); paintPanel(); paintPill(); } },
      h('option', { value: C.GENERAL, selected: st.chat.conv === C.GENERAL }, 'Wszyscy (rozmowa ogólna)'),
      ...peers().map((p) => { const conv = convOfPeer(p.uid), inb = st.chat.inbox[p.uid], un = inb && Number(inb.ts) > Number(st.chat.read[conv] || 0) && conv !== st.chat.conv; return h('option', { value: conv, selected: st.chat.conv === conv }, p.name + (un ? '  ✉' : '')); }));
    const inp = h('input', { type: 'text', class: 'chat-input', maxLength: C.MAX_TEXT, placeholder: 'Napisz wiadomość…', value: st.chat.text, style: { flex: 1 }, oninput: () => { st.chat.text = inp.value; }, onkeydown: (e) => { if (e.key === 'Enter') sendChat(); } });
    setTimeout(() => inp.focus(), 0);
    return h('div', {}, sel, chatLog(), h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, inp, h('button', { class: 'btn primary', onclick: sendChat }, 'Wyślij')),
      h('div', { class: 'muted', style: { fontSize: '10px', marginTop: '2px' } }, 'Wiadomości są przechowywane najwyżej 3 dni, potem znikają.'));
  }

  /** Zgłoszenie urządzenia (PC): presence_dev/{uid}_pc – wersja programu i czas; ponawiane co 20 minut. */
  async function reportDevice() {
    const send = async () => {
      try {
        const platform = ctx.platform || 'pc';   // wersja na iPhone'a ustawia 'ios'
        const d = P.makeDevice(user(), platform, ctx.version);
        if (d && st.uid && st.sdk) await st.sdk.setDoc(st.sdk.doc(st.db, 'presence_dev', st.uid + '_' + platform), d);
      } catch { /* bez zgłoszenia – nic nie psuje */ }
    };
    await send(); setInterval(send, 20 * 60 * 1000);
  }
  async function start() {
    try {
      const { sdk, db } = await firebase();
      st.sdk = sdk; st.db = db; st.uid = fbUid();
      reportDevice();   // zgłoszenie tego komputera (wersja programu); Android zgłasza się sam
      if (mayDevices()) sdk.onSnapshot(sdk.collection(db, 'presence_dev'), (snap) => { st.devs = new Map(); snap.forEach((d) => st.devs.set(d.id, d.data())); if (st.open && st.tab === 'list') { const l = panel.querySelector('.presence-list'); if (l) l.replaceWith(listView()); } }, () => {});
      watchConv(C.GENERAL); setTimeout(() => { st.chat.ready = true; }, 4000);   // nowe wiadomości po wczytaniu początkowym – powiadomienie
      sdk.onSnapshot(sdk.doc(db, 'chat_inbox', st.uid), (snap) => { const prev = st.chat.inbox; st.chat.inbox = snap.exists() ? snap.data() : {};
        for (const [from, v] of Object.entries(st.chat.inbox)) if (st.chat.ready && (!prev[from] || Number(prev[from].ts) < Number(v.ts)) && !(st.open && st.tab === 'chat' && st.chat.conv === convOfPeer(from))) toast(`✉ ${v.n || 'Wiadomość'}: ${v.x}`);
        paintPill(); if (st.open) paintTabsOnly(); }, () => {});
      sdk.onSnapshot(sdk.collection(db, 'presence'), (snap) => {
        st.error = ''; st.states = new Map(); snap.forEach((d) => st.states.set(d.id, d.data()));
        paintPill(); if (st.open && st.tab === 'list') { const active = document.activeElement; if (!panel.contains(active) || active.tagName === 'BUTTON') paintPanel(); else { const l = panel.querySelector('.presence-list'); if (l) l.replaceWith(listView()); } }
      }, (e) => { st.error = e.code === 'permission-denied' ? 'Brak dostępu do statusów (reguły Firestore – presence).' : (e.message || String(e)); paintPill(); if (st.open) paintPanel(); });
    } catch (e) { st.error = e.message || String(e); paintPill(); }
  }
  const api = { toggle, refresh: () => { paintPill(); if (st.open) paintPanel(); } };
  root._api = api;
  paintPill();
  start();
  return api;
}
