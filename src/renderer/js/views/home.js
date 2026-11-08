import { h, clear, api, apiCached, toast } from '../ui.js';
import { MODULES } from '../app.js';
import { filterParts, levelsPresent, LEVELS, levelOf } from '../logic/home.js';
import { parseSheetColor, contrastColor } from '../logic/common.js';

export function mountHome(el, ctx) {
  const state = { parts: null, loading: false, error: null, code: '', level: '', tab: 'braki' };

  const grid = h('div', { class: 'grid-modules' });
  const draw = () => {
    clear(grid);
    for (const m of MODULES.filter((x) => !x.inToolRoom)) {
      const denied = m.perm && ctx.user && (ctx.user.permissions || {})[m.perm] === 'none';
      grid.append(h('button', { class: 'mod ' + (m.style || ''), disabled: !!denied, onclick: () => ctx.go(m.id) }, m.title));
    }
  };

  const listBox = h('div', {});
  const renderList = () => {
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
    listBox.append(h('div', { class: 'table-wrap', style: { maxHeight: 'calc(100vh - 360px)', minHeight: '160px' } },
      h('table', { class: 't', style: { width: '100%' } },
        h('thead', {}, h('tr', {}, ...['KOD części', 'Stan', 'Zapas', 'Dost'].map((t) => h('th', {}, t)))), tbody)));
    listBox.append(h('div', { class: 'muted', style: { marginTop: '4px' } }, `Pozycji: ${shown.length}${shown.length !== state.parts.length ? ' z ' + state.parts.length : ''}` + (state.stale ? '  ·  dane z pamięci, odświeżanie…' : '')));
  };

  const codeInput = h('input', { type: 'search', placeholder: 'Szukaj kodu części…', style: { padding: '4px 8px', width: '240px' }, oninput: () => { state.code = codeInput.value; renderList(); } });
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
  const tabs = h('div', { class: 'tabs', style: { maxWidth: '900px', margin: '0 auto 6px' } });
  const braki = h('div', { class: 'panel', style: { maxWidth: '900px', margin: '0 auto' } },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('h2', { style: { margin: 0 } }, 'Braki części'), h('span', { class: 'grow' }),
      codeInput, levelSel, h('button', { class: 'btn', onclick: refresh }, 'Odśwież')),
    listBox);
  const workflow = h('div', { class: 'panel', style: { maxWidth: '900px', margin: '0 auto' } },
    h('h2', {}, 'Workflow'), h('p', {}, 'Moduł w budowie. Tu pojawią się zadania wspólne dla wszystkich.'));
  const drawTabs = () => {
    clear(tabs);
    for (const [id, label] of [['braki', 'Braki'], ['workflow', 'Workflow']]) tabs.append(h('button', { class: state.tab === id ? 'on' : '', onclick: () => { state.tab = id; drawTabs(); braki.style.display = id === 'braki' ? '' : 'none'; workflow.style.display = id === 'workflow' ? '' : 'none'; } }, label));
  };
  drawTabs(); workflow.style.display = 'none';
  el.append(grid, tabs, braki, workflow);
  refresh();
}
