// Tablica (zakładka „Tablica” na ekranie głównym i w aplikacji na iPhone'a): u góry dwie zwarte karty, pod spodem lista zadań (Workflow). Karty:
//  - „Tablica ogłoszeń”: informacje od mistrza dla całego wydziału – tekst sformatowany jak w Wordzie (wklejanie z Worda i stron, pogrubienie, kolory, listy…); wpisuje GOD i MASTER (wf_meta/info),
//    u pozostałych użytkowników wyświetla się sformatowany, na żywo,
//  - „Ostatnie zdarzenia”: po 3 najnowsze wpisy z rejestrów operacji, dokumentacji, detali i płytek, jedna linia tekstu „data godzina: wydarzenie: kto” (operacje w kolorach tabeli, detale z procentem
//    wykonania w skali czerwony → żółty → zielony, płytki na szaro). Czytane z jednego dokumentu bazy (wf_meta/feed), odświeżanego co godzinę i po każdym zdarzeniu (boardFeedStore.js).
import { h, clear, toast } from '../ui.js';
import { firebase } from '../fb.js';
import { appAccess } from '../logic/toolroomAccess.js';
import { grafikAccess } from '../logic/grafikAccess.js';
import { moduleLevelOf } from '../logic/moduleLevels.js';
import { mergeFeed, eventText, feedStale, FEED_SOURCES } from '../logic/boardFeed.js';
import { sanitizeHtml, plainText, textToHtml } from '../logic/richText.js';
import { watchFeed, refreshFeed } from '../boardFeedStore.js';

const CHECK_MS = 5 * 60000;   // jak często Tablica sprawdza, czy zdarzenia są starsze niż godzina (odczyt lokalny – bez bazy)
const fmtAt = (ms) => { if (!ms) return ''; const d = new Date(ms); return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

export function createInfoBoard(ctx) {
  const canEdit = () => appAccess(moduleLevelOf(ctx.user, 'tablica'), 'tablica').editPlan;   // MASTER i GOD w Tablicy
  const canRead = () => grafikAccess(moduleLevelOf(ctx.user, 'mistrz'), 'mistrz').cells;   // rejestry Mistrza: od CLERIK w Mistrzu
  const who = () => (ctx.user && (ctx.user.name || ctx.user.email)) || '';
  const card = (title, ...kids) => h('div', { style: { background: '#fff', border: '1px solid var(--border)', padding: '4px 8px', minWidth: 0 } },
    h('div', { style: { fontWeight: 700, marginBottom: '2px', display: 'flex', gap: '6px', alignItems: 'baseline' } }, title), ...kids);

  // ---------- tablica ogłoszeń (tekst sformatowany) ----------
  const infoMeta = h('span', { class: 'muted', style: { fontSize: '11px', fontWeight: 400 } });
  const editor = h('div', { contenteditable: 'true', spellcheck: 'true', style: { minHeight: '11em', maxHeight: '320px', overflow: 'auto', border: '1px solid #bbb', padding: '4px 6px', fontSize: '14px', background: '#fff', outline: 'none' } });
  const infoView = h('div', { class: 'rich', style: { fontSize: '14px', minHeight: '11em', maxHeight: '320px', overflow: 'auto' } });
  let infoDirty = false, infoStop = null;
  const setView = (html, text) => { const x = html ? sanitizeHtml(html) : textToHtml(text || ''); infoView.innerHTML = x; if (!infoDirty) editor.innerHTML = x; };
  const saveBtn = h('button', { class: 'btn small primary', disabled: true, onclick: async () => {
    const html = sanitizeHtml(editor.innerHTML);
    try {
      const { sdk, db } = await firebase();
      await sdk.setDoc(sdk.doc(db, 'wf_meta', 'info'), { text: plainText(html), html, by: who(), at: Date.now() });
      infoDirty = false; saveBtn.disabled = true; toast('Zapisano tablicę ogłoszeń');
    } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień (reguły Firestore: wf_meta)' : e.message || e), true); }
  } }, 'Zapisz');
  editor.addEventListener('input', () => { infoDirty = true; saveBtn.disabled = false; });
  editor.addEventListener('paste', (e) => {   // wklejanie z Worda / stron: zostaje formatowanie dozwolone przez sanitizeHtml
    const cd = e.clipboardData; if (!cd) return;
    e.preventDefault();
    const html = cd.getData('text/html'), text = cd.getData('text/plain');
    document.execCommand('insertHTML', false, html ? sanitizeHtml(html) : textToHtml(text));
  });
  // pasek formatowania: przyciski nie zabierają zaznaczenia (mousedown), polecenia execCommand
  const cmd = (name, value = null) => () => { editor.focus(); document.execCommand(name, false, value); infoDirty = true; saveBtn.disabled = false; };
  const tb = (label, title, fn, style = {}) => h('button', { class: 'btn small', title, style: { minWidth: '26px', padding: '1px 5px', ...style }, onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
  const color = (title, name, init) => h('input', { type: 'color', value: init, title, style: { width: '26px', height: '24px', padding: 0, border: '1px solid #aaa' }, onmousedown: (e) => e.stopPropagation(), oninput: (e) => { editor.focus(); document.execCommand(name, false, e.target.value); infoDirty = true; saveBtn.disabled = false; } });
  const sizeSel = h('select', { title: 'Rozmiar tekstu', onchange: () => { if (sizeSel.value) { editor.focus(); document.execCommand('fontSize', false, sizeSel.value); infoDirty = true; saveBtn.disabled = false; } sizeSel.value = ''; } },
    h('option', { value: '' }, 'Rozmiar'), ...[['2', 'mały'], ['3', 'normalny'], ['4', 'średni'], ['5', 'duży'], ['6', 'bardzo duży']].map(([v, l]) => h('option', { value: v }, l)));
  const toolbar = h('div', { class: 'row', style: { gap: '3px', flexWrap: 'wrap', marginBottom: '3px', alignItems: 'center' } },
    tb('B', 'Pogrubienie', cmd('bold'), { fontWeight: 700 }), tb('I', 'Kursywa', cmd('italic'), { fontStyle: 'italic' }), tb('U', 'Podkreślenie', cmd('underline'), { textDecoration: 'underline' }), tb('S', 'Przekreślenie', cmd('strikeThrough'), { textDecoration: 'line-through' }),
    color('Kolor tekstu', 'foreColor', '#c00000'), color('Kolor tła (zakreślacz)', 'hiliteColor', '#ffff00'), sizeSel,
    tb('• lista', 'Lista punktowana', cmd('insertUnorderedList')), tb('1. lista', 'Lista numerowana', cmd('insertOrderedList')),
    tb('⇤', 'Do lewej', cmd('justifyLeft')), tb('↔', 'Wyśrodkuj', cmd('justifyCenter')), tb('✕ format', 'Usuń formatowanie zaznaczenia', cmd('removeFormat')));
  async function watchInfo() {
    try {
      const { sdk, db } = await firebase();
      infoStop = sdk.onSnapshot(sdk.doc(db, 'wf_meta', 'info'), (snap) => {
        const d = snap.exists() ? snap.data() : {};
        setView(d.html || '', d.text || '');
        infoMeta.textContent = d.at ? `${d.by || ''} · ${fmtAt(d.at)}` : '';
      }, () => { infoMeta.textContent = 'brak dostępu'; });
    } catch { /* bez bazy – pole zostaje puste */ }
  }
  const infoCard = card(h('span', {}, 'Tablica ogłoszeń'), infoMeta);
  infoCard.style.background = '#fffbe6';

  // ---------- ostatnie zdarzenia (jedna lista – linie tekstu, jeden dokument w bazie) ----------
  const feedBody = h('div', { style: { maxHeight: '320px', overflow: 'auto', fontSize: '12.5px', lineHeight: '1.3' } });
  let feedState = { updated: 0, src: {} }, feedStop = null, refreshing = false;
  const paintFeed = () => {
    clear(feedBody);
    if (!canRead()) { feedBody.append(h('div', { class: 'muted' }, 'Rejestry Mistrza są widoczne od poziomu CLERIK.')); return; }
    const list = mergeFeed(feedState.src, 40);
    if (!list.length) { feedBody.append(h('div', { class: 'muted' }, refreshing ? 'Wczytywanie…' : 'Brak wpisów.')); return; }
    for (const e of list) {
      feedBody.append(h('div', { style: { padding: '1px 4px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: e.bg || '', color: e.fg || '' }, title: eventText(e) + (e.pct != null ? ` · wykonano ${e.pct}%` : '') },
        h('span', { style: { opacity: 0.7 } }, e.at + ': '), e.what, e.pct != null ? h('span', { style: { background: e.pctBg, color: '#000', padding: '0 4px', margin: '0 3px', fontWeight: 700 } }, e.pct + '%') : null, e.who ? h('span', { style: { opacity: 0.7 } }, ': ' + e.who) : null));
    }
  };
  async function refresh(force = false) {
    if (!canRead() || refreshing || (!force && !feedStale(feedState.updated))) return;
    refreshing = true; paintFeed();
    try { await refreshFeed(FEED_SOURCES, who()); } catch (e) { if (force) toast('Nie odświeżono zdarzeń: ' + (e.code === 'permission-denied' ? 'brak uprawnień' : e.message || e), true); }
    refreshing = false; paintFeed();
  }
  const refreshBtn = h('button', { class: 'btn small', title: 'Odśwież zdarzenia z tabel', style: { marginLeft: 'auto' }, onclick: () => refresh(true) }, '↻');
  const feedCard = card(h('span', {}, 'Ostatnie zdarzenia'));
  feedCard.firstChild.append(refreshBtn); feedCard.append(feedBody);
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '6px', marginBottom: '6px' } }, infoCard, feedCard);
  const node = h('div', {}, grid);

  let timer = null, started = false;
  async function start() {
    if (started) return; started = true;
    // GOD i MASTER wpisują ogłoszenia (pasek formatowania + edytor), reszta widzi sformatowany tekst
    infoCard.append(canEdit() ? h('div', {}, toolbar, editor, h('div', { class: 'row', style: { marginTop: '2px' } }, saveBtn)) : infoView);
    watchInfo();
    paintFeed();
    if (canRead()) {
      try { feedStop = await watchFeed((s) => { feedState = s; paintFeed(); refresh(false); }); } catch { /* bez bazy */ }   // pierwszy odczyt odświeża dokument, gdy jest starszy niż godzina
      timer = setInterval(() => { if (node.isConnected && node.offsetParent !== null) refresh(false); }, CHECK_MS);
    }
  }
  return { node, start, refresh: () => { start(); refresh(false); }, stop: () => { clearInterval(timer); if (infoStop) infoStop(); if (feedStop) feedStop(); } };
}
