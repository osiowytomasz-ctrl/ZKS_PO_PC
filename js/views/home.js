import { h, clear, api, apiCached, toast } from '../ui.js';
import { createWorkflow } from './workflow.js';
import { createInfoBoard } from './infoBoard.js';
import { filterParts, levelsPresent, LEVELS, levelOf } from '../logic/home.js';
import { parseSheetColor, contrastColor } from '../logic/common.js';
import { viewMemory } from '../logic/viewMemory.js';
import { getMode } from '../migrationStore.js';

export function mountHome(el, ctx) {
  const state = { parts: null, loading: false, error: null, code: '', level: '', tab: 'braki' };
  const mem = viewMemory('home.braki', state, ['code', 'level']);   // szukanie kodu i poziom braków zapamiętane na tym komputerze
  mem.load();

  // Przyciski modułów oraz Braki / Workflow są w górnym pasku (app.js); ekran główny pokazuje wybraną zakładkę na całą szerokość.
  const draw = () => {};

  const listBox = h('div', {});
  const renderList = () => {
    mem.save();
    clear(listBox);
    if (state.loading) { listBox.append(h('div', { class: 'muted' }, 'Wczytywanie braków części…')); return; }
    if (state.error) { listBox.append(h('div', { class: 'err' }, state.error, ' ', h('button', { class: 'btn small', onclick: refresh }, 'Ponów'))); return; }
    if (!state.parts) return;
    const shown = filterParts(state.parts, { code: state.code, level: state.level || null });
    if (!shown.length) { listBox.append(h('div', { class: 'muted' }, state.parts.length ? 'Brak części pasujących do filtrów.' : 'Brak braków części.')); return; }
    const tbody = h('tbody', {});
    for (const p of shown) {
      const bg = parseSheetColor(p.color, '#ffffff');
      tbody.append(h('tr', {},
        h('td', { class: 'left', style: { background: bg, color: levelOf(p.color) === 'red' ? '#fff' : contrastColor(bg), fontWeight: 600 } }, p.partCode),
        h('td', {}, p.status), h('td', {}, p.stock), h('td', {}, p.available)));
    }
    listBox.append(h('div', { class: 'table-wrap', style: { maxHeight: 'calc(100vh - 190px)', minHeight: '160px' } },
      h('table', { class: 't', style: { width: '100%' } },
        h('thead', {}, h('tr', {}, ...['KOD części', 'Stan', 'Zapas', 'Dost'].map((t) => h('th', {}, t)))), tbody)));
    listBox.append(h('div', { class: 'muted', style: { marginTop: '4px' } }, `Pozycji: ${shown.length}${shown.length !== state.parts.length ? ' z ' + state.parts.length : ''}` + (state.stale ? '  ·  dane z pamięci, odświeżanie…' : '')));
  };

  const codeInput = h('input', { type: 'search', placeholder: 'Szukaj kodu części…', value: state.code || '', style: { padding: '4px 8px', width: '240px' }, oninput: () => { state.code = codeInput.value; renderList(); } });
  const levelSel = h('select', { style: { padding: '4px' }, onchange: () => { state.level = levelSel.value; renderList(); } }, h('option', { value: '' }, 'Wszystkie poziomy'));
  const fillLevels = () => {
    while (levelSel.options.length > 1) levelSel.remove(1);
    for (const l of levelsPresent(state.parts || [])) levelSel.append(h('option', { value: l, selected: state.level === l }, LEVELS[l]));
  };

  async function refresh() {
    state.loading = true; state.error = null; state.parts = null; renderList();
    try {
      if (!ctx.user) await ctx.loadUser();
      draw();
      if ((await getMode('pswt')) === 'db') {   // PSWT „tylko baza”: braki liczone z bazy (bez karty ND_CACHE)
        const { loadMissingPartsDb } = await import('../pswtStore.js');
        state.parts = await loadMissingPartsDb(); state.loading = false; state.error = null; state.stale = false; fillLevels(); renderList();
        return;
      }
      await apiCached('getHomeMissingPartsFromNdCacheV2', [], (res, meta) => {
        state.parts = Array.isArray(res) ? res : (res && res.rows) || [];
        state.loading = false; state.error = null; state.stale = meta.cached;
        fillLevels(); renderList();
      });
    } catch (e) {
      state.error = e.message;
    }
    state.loading = false;
    renderList();
  }

  draw();
  const braki = h('div', { class: 'panel', style: { maxWidth: '1100px', margin: '0 auto' } },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('h2', { style: { margin: 0 } }, 'Braki części'), h('span', { class: 'grow' }),
      codeInput, levelSel, h('button', { class: 'btn', onclick: refresh }, 'Odśwież')),
    listBox);
  const wf = createWorkflow(ctx); const board = createInfoBoard(ctx);
  const workflow = h('div', {}, board.node, wf.node);   // Tablica informacyjna: karty z informacjami u góry, pod nimi lista zadań
  const tab = ctx.homeTab === 'workflow' ? 'workflow' : 'braki';
  braki.style.display = tab === 'braki' ? '' : 'none'; workflow.style.display = tab === 'workflow' ? '' : 'none';
  el.append(braki, workflow);
  if (tab === 'workflow') { wf.refresh(); board.refresh(); } else refresh();
  return () => board.stop();
}
