import { h, clear, apiCached } from '../ui.js';
import * as W from '../logic/workflow.js';

/** Zakładka Workflow na ekranie głównym: karta Z z kolorowaniem liczonym lokalnie. Zwraca {node, refresh}. */
export function createWorkflow() {
  const info = h('span', { class: 'muted' });
  const body = h('div', { class: 'table-wrap', style: { maxHeight: 'calc(100vh - 330px)', minHeight: '160px' } });
  const st = { headers: [], records: [] };

  function draw() {
    const cols = W.COLS;
    const tbody = h('tbody', {});
    for (const rec of st.records) {
      const tr = h('tr', {});
      for (const c of cols) {
        const s = W.cellStyle(rec, c, rec.row);
        tr.append(h('td', { class: 'left', style: s ? { background: s.background, color: s.color, fontWeight: s.bold ? 700 : '', fontStyle: s.italic ? 'italic' : '', textDecoration: s.strike ? 'line-through' : '' } : null }, rec[c]));
      }
      tbody.append(tr);
    }
    clear(body);
    body.append(h('table', { class: 't', style: { width: '100%' } },
      h('thead', {}, h('tr', {}, ...cols.map((c, i) => h('th', {}, st.headers[i] || c)))), tbody));
    const bad = W.mismatches(st.records).length;
    info.textContent = `Wierszy: ${st.records.length}` + (st.stale ? '  ·  dane z pamięci, odświeżanie…' : '') + (bad ? `  ·  niezgodne z kolumną H w arkuszu: ${bad}` : '');
  }

  async function refresh() {
    info.textContent = 'Wczytywanie karty Z…';
    try {
      await apiCached('api_getWorkflow', [], (d, meta) => {
        st.headers = d.headers || [];
        st.records = (d.rows || []).map((r) => ({ ...W.toRecord(r.cells || []), row: r.row }));
        st.stale = meta.cached; draw();
      }, { timeoutMs: 120000 });
    } catch (e) {
      clear(body);
      const missing = e.code === 'UNKNOWN_FN';
      body.append(h('div', { class: missing ? 'muted' : 'err', style: { padding: '12px' } },
        missing ? 'Serwer nie ma jeszcze funkcji api_getWorkflow. Wklej ją do Apps Script według docs/WORKFLOW_API.md w repozytorium i wdróż nową wersję.' : e.message));
      info.textContent = '';
    }
  }

  const node = h('div', { class: 'panel', style: { maxWidth: '900px', margin: '0 auto' } },
    h('div', { class: 'row', style: { marginBottom: '8px' } }, h('h2', { style: { margin: 0 } }, 'Workflow'), h('span', { class: 'grow' }), info,
      h('button', { class: 'btn', onclick: refresh }, 'Odśwież')), body);
  return { node, refresh };
}
