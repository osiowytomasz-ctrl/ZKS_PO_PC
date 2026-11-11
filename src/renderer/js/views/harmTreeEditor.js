// Edytor gałęzi operacji: drzewo (operacja › suboperacja › subsuboperacja) do edycji w oknie albo jako tekst w notatniku,
// eksport i import pliku .txt (np. do Notepad++), przeciąganie i ↑ ↓ (zmiana kolejności = zmiana liter), dodawanie i usuwanie węzłów.
// Zapis po podglądzie zmian i sprawdzeniu całej logiki (logic/harmTree.js: planTree).
import { h, clear, modal, toast } from '../ui.js';
import { treeFromOps, emptyNode, renameNode, moveNode, addChild, removeNode, treeToText, textToTree, planTree, sortTree } from '../logic/harmTree.js';
import { depthOf, subParent } from '../logic/schedule.js';
import { parseNumber } from '../logic/harmImport.js';
import { applyTree } from '../harmStore.js';
import { stationDropdown } from './harmEdit.js';

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const b64 = (text) => { const bytes = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/**
 * Okno edytora. [getOps] – aktualne operacje z bazy, [rootId] – edytowana gałąź (null = nowe drzewo od numeru [newLp]), [stations] – lista stanowisk.
 */
export function treeEditor({ getOps, rootId = null, newLp = '', stations = [] }) {
  const opsAtStart = getOps();
  const origIds = rootId ? treeFromOps(opsAtStart, rootId).map((n) => n.orig) : [];
  let nodes = rootId ? treeFromOps(opsAtStart, rootId) : [emptyNode(newLp)];
  const startText = treeToText(nodes, rootId ? `Gałąź operacji ${rootId}` : 'Nowa operacja');
  let mode = 'tree', parseErrors = [];
  const stationNames = stations.map((s) => s.name);
  const body = h('div', { style: { maxHeight: '58vh', overflow: 'auto', border: '1px solid #ddd' } });
  const status = h('div', { style: { marginTop: '6px', whiteSpace: 'pre-wrap', fontSize: '12px', maxHeight: '110px', overflow: 'auto' } });
  const textArea = h('textarea', { spellcheck: 'false', wrap: 'off', style: { width: '100%', height: '56vh', boxSizing: 'border-box', fontFamily: 'Consolas, "Courier New", monospace', fontSize: '13px', whiteSpace: 'pre', tabSize: 4 } });
  const plan = () => planTree(getOps(), origIds, nodes, { stations: stationNames, parseNum: parseNumber });
  const origOf = (n) => (n.orig ? opsAtStart[n.orig] : null);

  const refresh = () => {
    const p = plan();
    status.className = p.errors.length || parseErrors.length ? 'err' : 'muted';
    status.textContent = [...parseErrors, ...p.errors].length ? [...parseErrors, ...p.errors].join('\n')
      : (p.changes.length ? `Zmian: ${p.changes.length}. Błędów nie ma${p.warnings.length ? '; uwagi: ' + p.warnings.join('; ') : ''}.` : 'Bez zmian.');
    saveBtn.disabled = !!(p.errors.length || parseErrors.length || !p.changes.length);
  };
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };

  // --- drzewo: wiersz na węzeł; pola edytowalne, przeciąganie i ↑ ↓ w obrębie rodzica, + dodaje dziecko, ✕ usuwa z potomkami
  let dragging = null;
  const renderTree = () => {
    clear(body);
    const head = h('div', { style: { display: 'flex', gap: '4px', padding: '3px 6px', background: '#e4e4e4', fontSize: '12px', fontWeight: 700, position: 'sticky', top: 0, zIndex: 2 } },
      h('span', { style: { width: '16px' } }), h('span', { style: { width: '140px' } }, 'lp.'), h('span', { style: { flex: 1, minWidth: '200px' } }, 'Opis'), h('span', { style: { width: '96px' } }, 'Stan.'),
      h('span', { style: { width: '56px' } }, 'Czas [h]'), h('span', { style: { width: '110px' } }, 'Zależności'), h('span', { style: { width: '80px' } }, 'Komis'), h('span', { style: { width: '100px' } }, 'Klient'), h('span', { style: { width: '120px' } }));
    body.append(head);
    const base = Math.min(...nodes.map((n) => depthOf(n.lp.trim()) || 0));
    for (const n of nodes) {
      const lp = n.lp.trim(), d = Math.max(0, (depthOf(lp) || 0) - base), par = subParent(lp);
      const sibs = nodes.filter((x) => subParent(x.lp.trim()) === par && par != null);
      const idx = sibs.indexOf(n);
      const o = origOf(n);
      const changed = !n.orig || n.orig !== lp || ['element', 'station', 'komis', 'client'].some((k) => (o[k] || '') !== n[k].trim()) || String(o.hours ?? '') !== n.hours.trim() || (o.preds || []).join(', ') !== n.preds.split(/[,;\s]+/).filter(Boolean).join(', ');
      const inp = (key, w, extra = {}) => h('input', { type: 'text', value: n[key], spellcheck: 'false', title: extra.title || '', placeholder: extra.ph || '',
        style: { width: w, flex: extra.flex || 'none', minWidth: extra.min || 0, boxSizing: 'border-box', border: '1px solid #bbb', padding: '2px 4px', fontSize: '12px', fontWeight: extra.bold ? 700 : 400 },
        oninput: (e) => { n[key] = e.target.value; later(); }, onchange: extra.onchange });
      const row = h('div', { draggable: par != null ? 'true' : 'false',
        style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', marginLeft: d * 22 + 'px', borderLeft: d ? '2px solid #ddd' : 'none', borderBottom: '1px solid #eee', background: !n.orig ? '#e6f4ea' : changed ? '#fff4d6' : '#fff' },
        ondragstart: (e) => { if (e.target.tagName === 'INPUT') { e.preventDefault(); return; } dragging = n; e.dataTransfer.effectAllowed = 'move'; },
        ondragover: (e) => { if (dragging && subParent(dragging.lp.trim()) === par && dragging !== n) { e.preventDefault(); row.style.borderTop = '3px solid #1a73e8'; } },
        ondragleave: () => { row.style.borderTop = 'none'; },
        ondrop: (e) => {
          e.preventDefault(); row.style.borderTop = 'none';
          if (!dragging || subParent(dragging.lp.trim()) !== par || dragging === n) return;
          const from = sibs.indexOf(dragging), to = idx, step = to > from ? 1 : -1;
          let key = dragging.key; dragging = null;
          for (let k = from; k !== to; k += step) nodes = moveNode(nodes, key, step);
          renderTree(); refresh();
        } },
        h('span', { style: { color: '#888', width: '16px', cursor: par != null ? 'grab' : 'default' } }, par != null ? '⠿' : ''),
        inp('lp', (140 - d * 22) + 'px', { bold: true, title: 'Numer: zmiana przenosi też potomki (np. 600a → 600c: 600aa → 600ca)', onchange: (e) => { nodes = renameNode(nodes, n.key, e.target.value); renderTree(); refresh(); } }),
        n.orig && n.orig !== lp ? h('span', { title: 'Numer w bazie', style: { color: '#b45309', fontSize: '11px' } }, `(${n.orig})`) : null,
        inp('element', 'auto', { flex: 1, min: '200px' }),
        h('div', { style: { width: '96px' } }, stationDropdown(stations, n.station, (v) => { n.station = v; refresh(); }).el),
        inp('hours', '56px', { ph: n.orig && !n.hours && nodes.some((x) => subParent(x.lp.trim()) === lp) ? 'Σ' : '' }),
        inp('preds', '110px', { ph: 'np. 500, 600a', title: 'Numery operacji poprzedzających, oddzielone przecinkami (najwyżej 4)' }),
        inp('komis', '80px', { ph: d ? 'dziedz.' : '' }), inp('client', '100px', { ph: d ? 'dziedz.' : '' }),
        h('span', { style: { width: '120px', display: 'flex', gap: '2px', justifyContent: 'flex-end' } },
          h('button', { class: 'btn small', title: 'W górę', disabled: par == null || idx <= 0, onclick: () => { nodes = moveNode(nodes, n.key, -1); renderTree(); refresh(); } }, '↑'),
          h('button', { class: 'btn small', title: 'W dół', disabled: par == null || idx < 0 || idx >= sibs.length - 1, onclick: () => { nodes = moveNode(nodes, n.key, 1); renderTree(); refresh(); } }, '↓'),
          h('button', { class: 'btn small', title: depthOf(lp) >= 2 ? 'Subsuboperacja nie ma dzieci' : 'Dodaj ' + (depthOf(lp) === 0 ? 'suboperację' : 'subsuboperację'), disabled: depthOf(lp) >= 2, onclick: () => {
            const r = addChild(nodes, n.key, getOps()); if (r.error) { toast(r.error); return; } nodes = r.nodes; renderTree(); refresh();
            const el = body.querySelector(`[data-key="${r.key}"] input:nth-of-type(2)`); if (el) el.focus();
          } }, '+'),
          h('button', { class: 'btn small', title: 'Usuń z potomkami (z bazy dopiero po zapisie)', disabled: nodes.length <= 1 && !rootId, onclick: () => { nodes = removeNode(nodes, n.key); renderTree(); refresh(); } }, '✕')));
      row.dataset.key = n.key;
      body.append(row);
    }
    if (!nodes.length) body.append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Wszystkie operacje gałęzi są usunięte (zapis je skasuje).'));
  };

  // --- notatnik
  const toText = () => { textArea.value = treeToText(nodes, rootId ? `Gałąź operacji ${rootId}` : 'Nowa operacja'); };
  const fromText = () => { const r = textToTree(textArea.value, nodes); parseErrors = r.errors; nodes = r.nodes; };
  textArea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { fromText(); refresh(); }, 400); });
  textArea.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = textArea.selectionStart; textArea.setRangeText('  ', s, textArea.selectionEnd, 'end'); } });
  const setMode = (m) => {
    if (m === mode) return;
    if (m === 'text') toText(); else { fromText(); if (parseErrors.length) { refresh(); toast('Popraw najpierw błędy w tekście'); return; } }
    mode = m; clear(body);
    if (mode === 'text') body.append(textArea); else renderTree();
    treeBtn.classList.toggle('primary', mode === 'tree'); textBtn.classList.toggle('primary', mode === 'text');
    refresh();
  };
  const treeBtn = h('button', { class: 'btn small primary', onclick: () => setMode('tree') }, 'Drzewo');
  const textBtn = h('button', { class: 'btn small', title: 'Ta sama gałąź jako linie tekstu: lp | opis | stanowisko | czas | zależności | komis | klient', onclick: () => setMode('text') }, 'Notatnik');
  const exportBtn = h('button', { class: 'btn small', title: 'Zapis gałęzi do pliku .txt (np. do edycji w Notepad++)', onclick: async () => {
    if (mode === 'tree') toText(); else fromText();
    const name = `harmonogram_${rootId || nodes[0]?.lp || 'galaz'}_${stamp()}.txt`;
    if (await window.zks.saveFile(name, 'text/plain', b64(textArea.value.replace(/\n/g, '\r\n')))) toast('Zapisano ' + name);
  } }, 'Eksport do pliku…');
  const fileIn = h('input', { type: 'file', accept: '.txt,text/plain', style: { display: 'none' }, onchange: async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    textArea.value = (await f.text()).replace(/^﻿/, '');
    if (mode !== 'text') { mode = 'text'; clear(body); body.append(textArea); treeBtn.classList.remove('primary'); textBtn.classList.add('primary'); }
    fromText(); refresh(); toast(`Wczytano ${f.name} – sprawdź listę zmian i zapisz`);
  } });
  const importBtn = h('button', { class: 'btn small', title: 'Wczytanie gałęzi z pliku .txt (po edycji w notatniku)', onclick: () => fileIn.click() }, 'Import z pliku…');

  // --- zapis: podgląd zmian i zapis wsadowy
  const saveBtn = h('button', { class: 'btn primary', onclick: () => {
    if (mode === 'text') fromText();
    const p = plan();
    if (p.errors.length || parseErrors.length) { refresh(); return; }
    const list = h('div', { style: { maxHeight: '50vh', overflow: 'auto', fontSize: '13px' } }, ...p.changes.map((c) => h('div', { style: { padding: '1px 0', color: /^Usunięcie/.test(c) ? '#c00000' : '' } }, '• ' + c)));
    const cm = modal('Zmiany do zapisania', h('div', {},
      list, p.warnings.length ? h('div', { class: 'muted', style: { marginTop: '6px' } }, 'Uwagi: ' + p.warnings.join('; ')) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => cm.close() }, 'Wróć'), h('button', { class: 'btn primary', onclick: async () => {
        const again = plan();
        if (again.errors.length) { cm.close(); refresh(); toast('Dane w bazie zmieniły się – sprawdź błędy'); return; }
        try { await applyTree(again); cm.close(); m.close(); toast(`Zapisano zmian: ${again.changes.length}`); }
        catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'brak uprawnień do edycji' : e.message || e)); }
      } }, 'Zapisz'))), { wide: true });
  } }, 'Sprawdź i zapisz');
  const closeBtn = h('button', { class: 'btn', onclick: () => {
    if (mode === 'text') fromText();
    if (plan().changes.length && treeToText(nodes) !== startText && !window.confirm('Zamknąć bez zapisywania zmian?')) return;
    m.close();
  } }, 'Zamknij');

  const m = modal(rootId ? `Edycja gałęzi: ${subParent(rootId) ? 'suboperacja' : 'operacja'} ${rootId}` : 'Nowa operacja – konfigurator drzewa', h('div', {},
    h('p', { class: 'muted', style: { margin: '0 0 6px' } }, 'Edytuj numery, opisy, stanowiska, czasy, zależności, komis i klienta. ↑ ↓ albo przeciąganie zmienia kolejność w obrębie tej samej operacji (zmieniają się litery), + dodaje suboperację, ✕ usuwa z potomkami. „Notatnik” pokazuje to samo jako linie tekstu; plik .txt można edytować np. w Notepad++. Przed zapisem program sprawdza numery, poziomy, zależności i cykle oraz pokazuje listę zmian.'),
    h('div', { class: 'row', style: { gap: '6px', marginBottom: '6px' } }, treeBtn, textBtn, h('span', { style: { flex: 1 } }), exportBtn, importBtn, fileIn),
    body, status,
    h('div', { class: 'actions' }, closeBtn, saveBtn)), { wide: true, sticky: true });
  m.root.style.width = 'min(1200px, 97vw)'; m.root.style.maxWidth = '97vw';
  renderTree(); refresh();
}
