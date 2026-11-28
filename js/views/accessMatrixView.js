// Ustawienia (GOD) → „Uprawnienia – tabela”: dla każdego modułu przycisk, a w nim tabela elementów (moduły, podmoduły, przyciski, opcje)
// × poziomy GOD / MASTER / CLERIK / TOURIST / PEASANT × ZAPIS / ODCZYT / UKRYTY. Zasady i zapis: logic/accessOverlay.js, accessMatrixStore.js.
import { h, toast, modal, confirmBox } from '../ui.js';
import { SECTIONS, MATRIX_LEVELS, LEVEL_LABELS, STATES, STATE_LABELS, ELEMENTS, rowOf, defaultState, diffFromDefaults } from '../logic/accessMatrix.js';
import { getOverrides } from '../logic/accessOverlay.js';
import { saveAccessMatrix } from '../accessMatrixStore.js';

/** Zmieniony względem domyślnych elementów sekcji (liczba, dla przycisku). */
const changedCount = (sec) => sec.elements.filter((e) => getOverrides()[e.id]).length;

/** Tabela jednej sekcji (modułu) w oknie. */
function sectionTable(sec, ctx) {
  const rows = Object.fromEntries(sec.elements.map((e) => [e.id, rowOf(e.id)]));   // robocza kopia
  const body = h('tbody');
  const info = h('span', { class: 'muted' });

  const paintInfo = () => {
    const n = Object.keys(diffFromDefaults(rows)).length;
    info.textContent = n ? `Elementów różniących się od domyślnych: ${n}` : 'Wszystko jak domyślnie (dotychczasowe zasady).';
  };
  const cell = (e, lv, st) => {
    const on = rows[e.id][lv] === st, def = defaultState(e.id, lv) === st;
    const td = h('td', { style: { textAlign: 'center', padding: '2px 0', background: on && !def ? '#ffe082' : on ? '#c8e6c9' : '', borderLeft: st === 'write' ? '2px solid #000' : '' }, title: `${e.label} – ${LEVEL_LABELS[lv]}: ${STATE_LABELS[st]}${def ? ' (domyślnie)' : ''}` });
    const r = h('input', { type: 'radio', name: `${e.id}:${lv}`, checked: on, onchange: () => { rows[e.id][lv] = st; draw(); } });
    td.append(r);
    return td;
  };
  function draw() {
    body.replaceChildren(...sec.elements.map((e) => h('tr', {},
      h('td', { class: 'left', style: { fontWeight: e.id.endsWith('.enter') || ['view', 'harmonogram', 'cells', 'competence'].includes(e.id.split('.').pop()) ? 700 : 400, minWidth: '300px' } }, e.label,
        h('div', { class: 'muted', style: { fontSize: '10px' } }, e.kind === 'edit' ? 'zmienia dane – działa tylko w stanie ZAPIS' : 'widok – widoczny w stanach ZAPIS i ODCZYT')),
      ...MATRIX_LEVELS.flatMap((lv) => STATES.map((st) => cell(e, lv, st))))));
    paintInfo();
  }
  const vert = { writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'inline-block', fontWeight: 700, padding: '4px 0' };
  const table = h('table', { class: 't', style: { borderCollapse: 'collapse' } },
    h('thead', {},
      h('tr', {}, h('th', { class: 'left', rowSpan: 2, style: { verticalAlign: 'bottom' } }, `Moduł: ${sec.title}`), ...MATRIX_LEVELS.map((lv) => h('th', { colSpan: 3, style: { borderLeft: '2px solid #000' } }, LEVEL_LABELS[lv]))),
      h('tr', {}, ...MATRIX_LEVELS.flatMap((lv) => STATES.map((st) => h('th', { style: { padding: '0 2px', height: '70px', verticalAlign: 'bottom', borderLeft: st === 'write' ? '2px solid #000' : '' } }, h('span', { style: vert }, STATE_LABELS[st])))))),
    body);
  draw();

  const reset = () => { for (const e of sec.elements) for (const lv of MATRIX_LEVELS) rows[e.id][lv] = defaultState(e.id, lv); draw(); };
  const save = async (m) => {
    const next = { ...getOverrides() };
    for (const e of sec.elements) delete next[e.id];
    Object.assign(next, diffFromDefaults(rows));
    try {
      await saveAccessMatrix(next, ctx.user && (ctx.user.name || ctx.user.email));
      toast(`Zapisano uprawnienia: ${sec.title}. Zmiana działa od razu (na pozostałych komputerach i telefonach – po chwili).`);
      m.close();
    } catch (e) { toast('Nie zapisano: ' + (e.code || '') + ' ' + (e.message || e), true); }
  };
  return { table, info, reset, save };
}

function openSection(sec, ctx) {
  const t = sectionTable(sec, ctx);
  const box = h('div', {},
    h('p', { class: 'muted', style: { maxWidth: '900px' } },
      'ZAPIS – element widoczny i można go używać; ODCZYT – widoczny, bez możliwości zmian; UKRYTY – nie ma go w programie. Zielone = domyślnie (dotychczasowe zasady), żółte = zmienione przez Ciebie. ',
      'Tabela steruje przyciskami i widokami programu na komputerze i w telefonie. Twarde blokady serwera (reguły bazy) zostają – nadanie praw zapisu ponad nie nie pozwoli zapisać danych w bazie.'),
    h('div', { class: 'table-wrap', style: { maxHeight: '62vh' } }, t.table), t.info);
  const m = modal('', box, { wide: true, sticky: true });
  m.root.style.maxWidth = '96vw'; m.root.style.width = 'min(1100px, 96vw)';
  m.root.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Przywrócić domyślne?', `Wszystkie elementy modułu ${sec.title} wrócą do dotychczasowych zasad (po zapisie).`, 'Przywróć')) t.reset(); } }, 'Przywróć domyślne'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
    h('button', { class: 'btn primary', onclick: () => t.save(m) }, 'Zapisz')));
}

/** Blok w Ustawieniach (tylko GOD): przycisk dla każdego modułu. */
export function accessMatrixPanel(ctx) {
  const btns = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
  const paint = () => btns.replaceChildren(...SECTIONS.map((s) => {
    const n = changedCount(s);
    return h('button', { class: 'btn', title: `Tabela uprawnień modułu ${s.title}`, style: n ? { outline: '2px solid #f9a825' } : {}, onclick: () => openSection(s, ctx) }, s.title + (n ? ` (${n})` : ''));
  }));
  paint();
  return h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Uprawnienia – tabela'),
    h('p', { class: 'muted' }, 'Dla każdego modułu tabela praw jego elementów (moduły, podmoduły, przyciski, opcje) na poziomach GOD / MASTER / CLERIK / TOURIST / PEASANT: ZAPIS, ODCZYT albo UKRYTY. Poziomy użytkowników ustawia się wyżej („Dostęp”). W nawiasie – liczba elementów zmienionych względem dotychczasowych zasad. Tylko GOD.'),
    btns);
}
