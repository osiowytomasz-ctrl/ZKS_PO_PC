// Skrzynka donosów i pochwał (Help): żartobliwa skrzynka z gotowymi formułami i punktacją „Walka o donosiciela”.
// Zgłoszenia (dokument miesiąca skrzynka/{rrrr-mm}) czyta tylko MASTER i GOD; ranking punktów (skrzynka_punkty) widzą wszyscy.
import { h, clear, toast } from '../ui.js';
import { firebase, fbUid } from '../fb.js';
import * as S from '../logic/skrzynka.js';
import { grafikAccess } from '../logic/grafikAccess.js';
import { moduleLevelOf } from '../logic/moduleLevels.js';

export function mountSkrzynka(el, ctx) {
  const me = () => ({ name: (ctx.user && (ctx.user.name || ctx.user.email)) || '', email: (ctx.user && ctx.user.email) || '' });
  const st = { kind: 'donos', formula: null, people: [], docs: [], month: S.monthKey(), rankMode: 'month', entries: null };
  const isBoss = () => grafikAccess(moduleLevelOf(ctx.user, 'mistrz'), 'mistrz').manage;   // MASTER i GOD (w Mistrzu) czytają skrzynkę

  // ---------- formularz ----------
  const kindBtns = Object.entries(S.KINDS).map(([k, v]) => h('button', { class: 'btn', onclick: () => { st.kind = k; st.formula = null; paintForm(); } }, `${v.icon} ${v.label}`));
  const targetSel = h('select', { style: { padding: '6px', minWidth: '220px' } });
  const targetOther = h('input', { type: 'text', placeholder: 'albo wpisz kogoś innego…', style: { padding: '6px', width: '200px' } });
  const extra = h('input', { type: 'text', maxlength: 200, placeholder: 'Dopisek od siebie (nieobowiązkowy)', style: { padding: '6px', width: '100%', boxSizing: 'border-box' } });
  const formulas = h('div', { style: { display: 'grid', gap: '4px', margin: '8px 0' } });
  const preview = h('div', { style: { background: '#fffbe6', border: '1px dashed #c9b600', padding: '8px 10px', minHeight: '2.4em', margin: '6px 0', fontStyle: 'italic' } });
  const sendBtn = h('button', { class: 'btn primary', onclick: () => send() }, '📮 Wrzuć do skrzynki');
  const target = () => (targetOther.value.trim() || targetSel.value);
  function paintPreview() {
    const f = S.formulaById(st.formula);
    preview.textContent = f ? S.fillFormula(f, target()) + (extra.value.trim() ? ' Dopisek: ' + extra.value.trim() : '') + `   [+${f.pts} pkt]` : 'Wybierz gotową formułę z listy…';
  }
  function paintForm() {
    kindBtns.forEach((b, i) => b.classList.toggle('primary', Object.keys(S.KINDS)[i] === st.kind));
    clear(formulas).append(...S.FORMULAS.filter((f) => f.kind === st.kind).map((f) => h('button', {
      class: 'btn' + (st.formula === f.id ? ' primary' : ''), style: { textAlign: 'left', whiteSpace: 'normal' },
      onclick: () => { st.formula = f.id; paintForm(); } }, `${f.text.replace(/\{cel\}/g, '…')}  `, h('span', { class: 'muted' }, `(${f.level}, +${f.pts})`))));
    paintPreview();
  }
  targetSel.addEventListener('change', () => { targetOther.value = ''; paintPreview(); });
  targetOther.addEventListener('input', paintPreview); extra.addEventListener('input', paintPreview);

  async function loadPeople() {
    try {
      const { sdk, db } = await firebase();
      const snap = await sdk.getDocs(sdk.collection(db, 'presence'));
      const names = []; snap.forEach((d) => { const n = String((d.data() || {}).name || '').trim(); if (n && n.toLowerCase() !== me().name.toLowerCase()) names.push(n); });
      st.people = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pl'));
    } catch { st.people = []; }
    clear(targetSel).append(h('option', { value: '' }, '— wybierz osobę —'), ...st.people.map((n) => h('option', { value: n }, n)));
  }

  async function send() {
    const m = me();
    sendBtn.disabled = true;
    try {
      const { sdk, db } = await firebase();
      const uid = fbUid();
      const r = S.makeEntry({ formulaId: st.formula, target: target(), extra: extra.value, by: m.name, uid });
      if (r.error) { toast(r.error, true); sendBtn.disabled = false; return; }
      await sdk.setDoc(sdk.doc(db, 'skrzynka', S.monthKey(new Date(r.entry.at))), { e: { [r.entry.id]: r.entry } }, { merge: true });
      // punkty autora (transakcja: dwa zgłoszenia naraz nie nadpiszą się)
      const ref = sdk.doc(db, 'skrzynka_punkty', uid);
      let res = null;
      await sdk.runTransaction(db, async (tx) => { const prev = await tx.get(ref); res = S.applyPoints(prev.exists() ? prev.data() : null, r.entry, m.name); tx.set(ref, res.doc); });
      toast(res.limited ? 'Wrzucone, ale limit punktowanych zgłoszeń na dziś wyczerpany. Wróć jutro, kapusiu!' : `Wrzucone! +${res.gained} pkt do „Walki o donosiciela”.`);
      st.formula = null; extra.value = ''; targetOther.value = ''; targetSel.value = ''; paintForm();
      await loadRanking();
    } catch (e) { toast('Skrzynka się zacięła: ' + (e.code === 'permission-denied' ? 'brak uprawnień (opublikuj reguły Firestore: skrzynka)' : e.message || e), true); }
    sendBtn.disabled = false;
  }

  // ---------- ranking „Walka o donosiciela” ----------
  const rankBox = h('div', {});
  const modeBtns = [['month', 'Ten miesiąc'], ['all', 'Od początku']].map(([k, l]) => h('button', { class: 'btn small', onclick: () => { st.rankMode = k; paintRank(); } }, l));
  function paintRank() {
    modeBtns.forEach((b, i) => b.classList.toggle('primary', ['month', 'all'][i] === st.rankMode));
    const rows = S.ranking(st.docs, st.rankMode === 'month' ? st.month : null);
    clear(rankBox);
    if (!rows.length) { rankBox.append(h('p', { class: 'muted' }, 'Na razie cisza. Pierwszy donosiciel jeszcze się nie ujawnił – będzie sławny.')); return; }
    rankBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 't', style: { width: '100%' } },
      h('thead', {}, h('tr', {}, ...['#', 'Donosiciel', 'Tytuł', '🕵️ donosy', '👏 pochwały', 'Punkty'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((r) => h('tr', { style: r.name === me().name ? { background: '#e8f5e9' } : null },
        h('td', {}, r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : String(r.rank)), h('td', { class: 'left', style: { fontWeight: 600 } }, r.name),
        h('td', { class: 'left' }, r.title), h('td', {}, String(r.donosy)), h('td', {}, String(r.pochwaly)), h('td', { style: { fontWeight: 700 } }, String(r.pts))))))));
  }
  async function loadRanking() {
    try { const { sdk, db } = await firebase(); const snap = await sdk.getDocs(sdk.collection(db, 'skrzynka_punkty')); st.docs = []; snap.forEach((d) => st.docs.push(d.data())); }
    catch (e) { st.docs = []; clear(rankBox).append(h('p', { class: 'err' }, 'Ranking niedostępny: ' + (e.code === 'permission-denied' ? 'opublikuj reguły Firestore (skrzynka_punkty).' : e.message || e))); return; }
    paintRank();
  }

  // ---------- czytanie skrzynki (MASTER i GOD) ----------
  const boxList = h('div', {});
  async function openBox() {
    clear(boxList).append(h('p', { class: 'muted' }, 'Otwieram skrzynkę…'));
    try {
      const { sdk, db } = await firebase();
      const snap = await sdk.getDoc(sdk.doc(db, 'skrzynka', st.month));
      const all = snap.exists() ? Object.values((snap.data() || {}).e || {}) : [];
      all.sort((a, b) => b.at - a.at);
      clear(boxList);
      if (!all.length) { boxList.append(h('p', { class: 'muted' }, 'Skrzynka pusta. Wydział wzorowy albo podejrzanie dyskretny.')); return; }
      boxList.append(...all.map((x) => h('div', { style: { borderBottom: '1px solid #eee', padding: '4px 0' } },
        h('span', { class: 'muted', style: { fontSize: '11px' } }, `${S.KINDS[x.kind] ? S.KINDS[x.kind].icon : ''} ${new Date(x.at).toLocaleString('pl-PL')} · od: ${x.by}`), h('div', {}, x.text))));
    } catch (e) { clear(boxList).append(h('p', { class: 'err' }, e.code === 'permission-denied' ? 'Skrzynkę czytają tylko MASTER i GOD.' : 'Nie otwarto: ' + (e.message || e))); }
  }

  el.append(h('div', { style: { maxWidth: '860px', margin: '0 auto' } },
    h('div', { class: 'panel' },
      h('h2', {}, '📮 Skrzynka donosów i pochwał'),
      h('p', { class: 'muted' }, 'Anonimowość gwarantowana: zgłoszenia czyta tylko mistrz. Punkty są jawne – o tytuł Donosiciela Miesiąca walczy cały wydział. To żart: sprawy poważne (BHP, awarie, kolizje) zgłaszaj mistrzowi, nie skrzynce.'),
      h('div', { class: 'row', style: { gap: '6px' } }, ...kindBtns),
      h('div', { class: 'row', style: { gap: '6px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('b', {}, 'Kogo dotyczy:'), targetSel, targetOther),
      formulas, extra, preview, h('div', { class: 'row' }, sendBtn)),
    h('div', { class: 'panel', style: { marginTop: '12px' } },
      h('h2', {}, '🏆 Walka o donosiciela'),
      h('p', { class: 'muted' }, `Punkty za zgłoszenie: donos 2–5 (im cięższy kaliber, tym więcej), pochwała 1–3. Punktowanych jest ${S.DAILY_LIMIT} zgłoszeń dziennie. Donos na siebie i chwalenie siebie – zabronione.`),
      h('div', { class: 'row', style: { gap: '6px', marginBottom: '6px' } }, ...modeBtns), rankBox),
    isBoss() ? h('div', { class: 'panel', style: { marginTop: '12px' } }, h('h2', {}, '🔐 Zawartość skrzynki (tylko mistrz)'),
      h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn', onclick: openBox }, `Otwórz skrzynkę (${S.monthKey()})`)), boxList) : null));
  paintForm(); loadPeople(); loadRanking();
}
