// Status i dostępność pracowników – menu rozwijane w prawym dolnym rogu programu (widoczne na każdym ekranie).
// Każdy ustawia własny status (dostępny, przy maszynie, zajęty …) z notatką i godziną „do”; lista pokazuje stan bieżący wszystkich.
// Każda zmiana trafia do dziennika (presence_log); historię widzą tylko osoby z listy w logic/presence.js (Osiowy Tomasz, Kumała Łukasz, Skupnik Adam).
import { h, clear, toast } from '../ui.js';
import { firebase, fbUid } from '../fb.js';
import * as P from '../logic/presence.js';

const dot = (color, size = 10) => h('span', { style: { display: 'inline-block', width: size + 'px', height: size + 'px', borderRadius: '50%', background: color, flex: 'none' } });

export function mountPresence(ctx) {
  const old = document.getElementById('presence-widget');
  if (old) return old._api;
  const st = { open: false, tab: 'list', states: new Map(), error: '', uid: '', sdk: null, db: null, form: { status: '', note: '', until: '' }, formDirty: false, hist: { range: 7, name: '', rows: null, loading: false } };
  const user = () => ctx.user || {};
  const mayHistory = () => P.canSeeHistory(user().name);
  const root = h('div', { id: 'presence-widget', class: 'presence' });
  const panel = h('div', { class: 'presence-panel', style: { display: 'none' } });
  const pill = h('button', { class: 'presence-pill', title: 'Status i dostępność pracowników', onclick: () => toggle() });
  root.append(panel, pill);
  document.body.append(root);

  const mine = () => st.states.get(st.uid) || null;
  function paintPill() {
    const m = mine(), s = P.statusOf(m && !P.isStale(m) ? m.status : ''), free = [...st.states.values()].filter((p) => !P.isStale(p) && P.statusOf(p.status).free).length;
    clear(pill).append(dot(s.color, 11), h('span', {}, m ? s.label : 'Ustaw status'), h('span', { class: 'presence-count', title: 'Dostępni teraz' }, String(free)), h('span', {}, st.open ? '▾' : '▴'));
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
  function listView() {
    const now = Date.now(), items = P.sortPresence([...st.states.entries()].map(([uid, p]) => ({ ...p, uid })), now);
    const box = h('div', { class: 'presence-list' }, h('b', {}, `Pracownicy (${items.length})`));
    if (!items.length) box.append(h('div', { class: 'muted' }, st.error || 'Nikt nie ustawił jeszcze statusu.'));
    for (const p of items) {
      const stale = P.isStale(p, now), s = P.statusOf(p.status);
      box.append(h('div', { class: 'presence-row' + (stale ? ' stale' : ''), title: stale ? 'Brak aktualizacji od ponad 12 godzin' : '' }, dot(stale ? '#bdbdbd' : s.color, 11),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', {}, h('b', {}, p.name || '—'), ' · ', s.label, p.until ? ` do ${p.until}` : ''), p.note ? h('div', { class: 'muted', style: { fontSize: '11px' } }, p.note) : null),
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
    const tabs = h('div', { class: 'presence-tabs' }, h('button', { class: st.tab === 'list' ? 'on' : '', onclick: () => { st.tab = 'list'; paintPanel(); } }, 'Status'),
      mayHistory() ? h('button', { class: st.tab === 'hist' ? 'on' : '', onclick: () => { st.tab = 'hist'; if (st.hist.rows == null) loadHistory(); else paintPanel(); } }, 'Historia') : null,
      h('span', { class: 'grow' }), h('button', { title: 'Zamknij', onclick: () => toggle(false) }, '✕'));
    if (st.tab === 'hist' && !mayHistory()) st.tab = 'list';
    panel.append(tabs, st.tab === 'hist' ? historyView() : h('div', {}, formView(), listView()));
  }

  async function start() {
    try {
      const { sdk, db } = await firebase();
      st.sdk = sdk; st.db = db; st.uid = fbUid();
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
