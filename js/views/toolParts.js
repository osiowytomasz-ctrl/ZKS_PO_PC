// Edytor „Części narzędzia” (ToolBuilder → miniatura → Kontury → „Części i typ…”, tylko GOD): przypisanie do 10 płytek (ply1–10) i do 10 części / akcesoriów (osp1–10) oraz typ narzędzia
// (monolityczne / składane / oprawka-redukcja-przedłużka). Zmiany są szkicem w oknie – dopiero „Zapisz” zapisuje jedną zmianę wpisu PSWT w bazie (w trybie „równolegle” najpierw te same komórki
// w arkuszu). Wymaga PSWT w trybie „równolegle” albo „tylko baza”. Logika: logic/toolParts.js, układ kolumn: logic/pswtLayout.js.
import { h, clear, api, toast, modal, confirmBox } from '../ui.js';
import { getMode } from '../migrationStore.js';
import { loadPartsData, savePartsDb, readPswtEntry } from '../pswtStore.js';
import { invalidateCatalog } from '../catalog.js';
import { parseSheetColor } from '../logic/common.js';
import { colIndex } from '../logic/pswtDb.js';
import * as P from '../logic/toolParts.js';
import { insertSvg } from './parts.js';

const low = (t) => String(t ?? '').trim().toLowerCase();

/** o: { index (toolIndex), tool (pozycja katalogu), onSaved(info) } */
export async function openToolPartsEditor(o) {
  const mode = await getMode('pswt', true);
  const box = h('div', { style: { minWidth: '720px' } }, h('p', { class: 'muted' }, 'Wczytywanie części z bazy…'));
  const m = modal(`Części narzędzia – ${o.tool.productCode}`, box, { wide: true, sticky: true });
  if (mode === 'sheet') { clear(box).append(h('p', {}, 'Przypisywanie części działa, gdy PSWT jest w trybie „równolegle” albo „tylko baza” (GOD: ⇄ Migracja w Produktach).'), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))); return; }
  let data;
  try { data = await loadPartsData(); } catch (e) { clear(box).append(h('p', { class: 'err' }, 'Nie wczytano PSWT z bazy: ' + (e.message || e)), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))); return; }
  const entry = data.entries.find((e) => low((e.v || {}).B) === low(o.tool.productCode));
  if (!entry) { clear(box).append(h('p', { class: 'err' }, `Narzędzia „${o.tool.productCode}” nie ma w PSWT w bazie (zrób import w ⇄ Migracja).`), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))); return; }
  const byCode = new Map(data.candidates.map((c) => [low(c.code), c]));
  const orig = P.slotsOf(entry.v);
  const st = { cut: [...orig.cut], acc: [...orig.acc], type: String(entry.tt || '') };
  const status = h('div', { class: 'muted', style: { minHeight: '18px', fontSize: '12px' } });
  const say = (t, err) => { status.textContent = t || ''; status.style.color = err ? '#c62828' : ''; };

  // ---------- jedno miejsce części: kod w kolorze stanu, ◂ ▸ – kolejność, × – usuń ----------
  const chip = (list, i) => {
    const code = list[i], c = byCode.get(low(code)), warn = !c;
    const color = c && c.zapas !== '' && Number(String(c.zapas).replace(',', '.')) <= 0 ? '#ffd0d0' : '#fff';
    const mv = (d) => h('button', { class: 'btn small', style: { padding: '0 4px' }, disabled: i + d < 0 || i + d >= list.length, onclick: () => { [list[i], list[i + d]] = [list[i + d], list[i]]; draw(); } }, d < 0 ? '◂' : '▸');
    return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px', border: '1px solid ' + (warn ? '#c62828' : '#999'), background: color, padding: '2px 4px', margin: '2px' }, title: c ? `${c.name || ''} ${c.firma ? '· ' + c.firma : ''}\nstan ${c.stan || '—'} · zapas ${c.zapas || '—'} · dostępne ${c.dostepne || '—'} · w narzędziach: ${c.uses}` : 'Tego symbolu nie ma w PSWT' },
      h('span', { class: 'muted', style: { fontSize: '10px' } }, String(i + 1)), h('b', {}, code), c && c.zapas !== '' ? h('span', { class: 'muted', style: { fontSize: '11px' } }, `(${c.zapas})`) : null, mv(-1), mv(1),
      h('button', { class: 'btn small', style: { padding: '0 4px' }, title: 'Usuń z listy', onclick: () => { list.splice(i, 1); draw(); } }, '×'));
  };
  const panel = (title, list, kind) => h('div', { style: { border: '1px solid #ccc', padding: '6px 8px', margin: '6px 0' } },
    h('div', { class: 'row', style: { gap: '8px' } }, h('b', {}, `${title} (${list.length}/${P.MAX_SLOTS})`), h('span', { class: 'grow' }),
      h('button', { class: 'btn small primary', disabled: list.length >= P.MAX_SLOTS, onclick: () => pick(kind) }, '＋ Dodaj…')),
    h('div', { style: { minHeight: '34px' } }, list.length ? list.map((_, i) => chip(list, i)) : h('span', { class: 'muted' }, kind === 'cut' ? 'Brak płytek – „＋ Dodaj…”.' : 'Brak części – „＋ Dodaj…”.')));

  const typeRow = h('div', { style: { margin: '4px 0 6px' } });
  function drawType() {
    clear(typeRow).append(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Typ narzędzia (od niego zależy, czy brak części jest zgłaszany) · zapisany w bazie: ' + (entry.tt ? (P.TOOL_TYPES.find((x) => x.id === entry.tt) || { label: entry.tt }).label : 'nie ustawiono (domyślny wg grupy)') + ':'),
      ...P.TOOL_TYPES.map((t) => h('label', { style: { display: 'block', margin: '2px 0' } }, h('input', { type: 'radio', name: 'ttype', checked: P.toolTypeOf(o.tool, st.type) === t.id, onchange: () => { st.type = t.id; drawState(); } }), ` ${t.label} `, h('span', { class: 'muted', style: { fontSize: '11px' } }, `– ${t.hint}`))));
  }
  const holder = h('div', {});
  const stateLine = h('div', { style: { fontSize: '12px', margin: '2px 0' } });
  function drawState() {
    const a = P.assignState(o.tool, { partsCutting: st.cut, partsAccessories: st.acc }, st.type);
    stateLine.textContent = a.ok ? '✔ Przypisanie kompletne dla wybranego typu.' : '⚠ ' + a.text + ' (dla wybranego typu).'; stateLine.style.color = a.ok ? '#2e7d32' : '#c62828';
  }
  function draw() { clear(holder).append(panel('Płytki skrawające', st.cut, 'cut'), panel('Części / akcesoria', st.acc, 'acc')); drawState(); }

  // ---------- wybór części z bazy: szukanie, firma, numery; kontur płytki w miniaturze ----------
  function pick(kind) {
    const list = kind === 'cut' ? st.cut : st.acc, free = P.MAX_SLOTS - list.length;
    const q = h('input', { type: 'search', placeholder: 'Szukaj: kod, opis, firma', style: { width: '260px', padding: '4px 8px' }, oninput: () => paint() });
    const allNo = h('input', { type: 'checkbox', onchange: () => paint() });
    const firms = [...new Set(data.candidates.map((c) => c.firma).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
    const firm = h('select', { onchange: () => paint() }, h('option', { value: '' }, 'Firma'), ...firms.map((f) => h('option', { value: f }, f)));
    const only = h('label', { class: 'row', style: { gap: '4px' } }, allNo, kind === 'cut' ? 'wszystkie numery (domyślnie płytki: 1–399)' : 'wszystkie numery (domyślnie oprzyrządowanie: 400–999)');
    const chosen = new Set();
    const body = h('div', { style: { maxHeight: '52vh', overflow: 'auto', border: '1px solid #ccc' } });
    const add = h('button', { class: 'btn primary', onclick: () => { for (const c of chosen) if (list.length < P.MAX_SLOTS && !list.some((x) => low(x) === low(c))) list.push(c); mm.close(); draw(); } }, 'Dodaj zaznaczone');
    function paint() {
      const text = low(q.value), taken = new Set(list.map(low));
      let items = data.candidates.filter((c) => (allNo.checked || (kind === 'cut' ? c.a >= 1 && c.a <= 399 : c.a >= 400 && c.a <= 999)) && (!firm.value || c.firma === firm.value) && (!text || low(c.code + ' ' + c.name + ' ' + c.firma).includes(text)));
      items = items.sort((a, b) => a.code.localeCompare(b.code, 'pl', { numeric: true }));
      const shown = items.slice(0, 200);
      clear(body).append(h('table', { class: 't', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ...['', 'Kod', 'Firma', 'Opis', ...(kind === 'cut' ? ['Kontur'] : []), 'Stan', 'Zapas', 'Dost.', 'W narz.'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...shown.map((c) => {
          const on = taken.has(low(c.code));
          const cb = h('input', { type: 'checkbox', disabled: on, checked: chosen.has(c.code), onchange: () => { if (cb.checked) { if (chosen.size >= free) { cb.checked = false; say(`Wolnych miejsc: ${free}.`, true); return; } chosen.add(c.code); } else chosen.delete(c.code); add.textContent = `Dodaj zaznaczone (${chosen.size})`; } });
          return h('tr', { style: { opacity: on ? 0.5 : 1 } }, h('td', {}, cb), h('td', { class: 'left', style: { fontWeight: 700 } }, c.code), h('td', { class: 'left' }, c.firma), h('td', { class: 'left' }, c.name),
            ...(kind === 'cut' ? [h('td', {}, insertSvg(o.index && o.index.insertContour(c.code), { w: 54, hgt: 34 }))] : []), h('td', {}, c.stan), h('td', {}, c.zapas), h('td', {}, c.dostepne), h('td', {}, String(c.uses)));
        }))), items.length > shown.length ? h('p', { class: 'muted', style: { padding: '4px 8px' } }, `Pokazano pierwsze ${shown.length} z ${items.length} – zawęź szukanie.`) : null);
    }
    const mm = modal(kind === 'cut' ? 'Dodaj płytki' : 'Dodaj części', h('div', {}, h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } }, q, firm, only, h('span', { class: 'muted' }, `wolnych miejsc: ${free}`)), body,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => mm.close() }, 'Anuluj'), add)), { wide: true });
    paint(); q.focus();
  }

  // ---------- kopiowanie z innego narzędzia ----------
  const copyIn = h('input', { type: 'text', list: 'tp-tools', placeholder: 'kod narzędzia', style: { width: '200px' }, autocomplete: 'off' });
  const copyList = h('datalist', { id: 'tp-tools' }, ...data.entries.filter((e) => P.slotsOf(e.v).cut.length || P.slotsOf(e.v).acc.length).slice(0, 3000).map((e) => h('option', { value: String((e.v || {}).B ?? '') })));
  async function copyFrom() {
    const src = data.entries.find((e) => low((e.v || {}).B) === low(copyIn.value));
    if (!src) { say('Nie ma takiego narzędzia w PSWT.', true); return; }
    const s = P.slotsOf(src.v);
    if ((st.cut.length || st.acc.length) && !(await confirmBox('Kopiuj części', `Zastąpić części tego narzędzia (płytki: ${st.cut.length}, części: ${st.acc.length}) częściami narzędzia ${copyIn.value} (płytki: ${s.cut.length}, części: ${s.acc.length})?`, 'Kopiuj'))) return;
    st.cut = [...s.cut]; st.acc = [...s.acc]; say(`Skopiowano z ${copyIn.value} – sprawdź i zapisz.`); draw();
  }

  // ---------- zapis ----------
  const save = h('button', { class: 'btn primary', onclick: async () => {
    const errs = P.validateSlots(st.cut, st.acc, new Set(data.candidates.map((c) => low(c.code))));
    if (errs.length) { say(errs.join(' '), true); return; }
    const changes = P.planChanges(entry.v, st.cut, st.acc), ttNew = st.type || '', ttChanged = ttNew !== String(entry.tt || '');
    if (!Object.keys(changes).length && !ttChanged) { m.close(); return; }
    save.disabled = true; say('Zapisywanie…');
    try {
      if (mode === 'dual' && Object.keys(changes).length) {   // „równolegle”: najpierw arkusz (serwer przelicza kolumny logiczne na układ karty), potem baza
        const items = Object.entries(changes).map(([l, t]) => ({ row: entry.n, lcol: colIndex(l), value: t, expect: String((entry.v || {})[l] ?? '') }));
        const res = await api('updateBaseCells', ['PSWT', items]);
        const bad = ((res && res.results) || []).find((r) => !r.ok);
        if (bad) throw new Error('arkusz: ' + (bad.error || 'nie zapisano'));
      }
      await savePartsDb(entry.n, changes, ttChanged ? ttNew : undefined);
      const back = await readPswtEntry(entry.n);   // kontrola: baza musi zwrócić to, co zapisano (typ i miejsca)
      if (!back) throw new Error('po zapisie nie można odczytać wpisu z bazy');
      if (ttChanged && String(back.tt || '') !== ttNew) throw new Error(`baza nie zachowała typu narzędzia (zapisano „${ttNew || 'domyślny'}”, odczytano „${back.tt || 'domyślny'}”)`);
      for (const [l, t] of Object.entries(changes)) if (String((back.v || {})[l] ?? '') !== t) throw new Error(`baza nie zachowała kolumny ${l}`);
      if (o.index) o.index.setParts(o.tool.productCode, st.cut, st.acc, ttChanged ? ttNew : undefined);
      invalidateCatalog();
      toast(`Zapisano części narzędzia ${o.tool.productCode}${mode === 'dual' ? ' (arkusz i baza)' : ''} · typ: ${(P.TOOL_TYPES.find((x) => x.id === P.toolTypeOf(o.tool, ttNew)) || {}).label || '—'}${ttNew ? '' : ' (domyślny)'}`);
      m.close(); if (o.onSaved) o.onSaved({ cut: st.cut, acc: st.acc, type: ttNew });
      window.dispatchEvent(new CustomEvent('zks:toolparts', { detail: { code: o.tool.productCode, cut: [...st.cut], acc: [...st.acc], type: ttChanged ? ttNew : undefined } }));   // ToolBuilder i inne otwarte widoki przerysują trójkąty „nie przypisano”
    } catch (e) { save.disabled = false; say('Nie zapisano: ' + (e.message || e), true); }
  } }, 'Zapisz');

  clear(box).append(copyList, h('div', { class: 'muted', style: { fontSize: '12px' } }, `Wpis PSWT: wiersz ${entry.n} · tryb: ${mode === 'dual' ? 'równolegle (arkusz i baza)' : 'tylko baza'} · maks. ${P.MAX_SLOTS} płytek i ${P.MAX_SLOTS} części`),
    typeRow, holder, stateLine,
    h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, h('span', { class: 'muted' }, 'Kopiuj z narzędzia:'), copyIn, h('button', { class: 'btn small', onclick: copyFrom }, 'Kopiuj')), status,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), save));
  drawType(); draw();
}
