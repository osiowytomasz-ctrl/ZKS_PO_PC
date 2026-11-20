// ToolBuilder – jak w aplikacji na Androida (BuilderScreen.kt): składanie zestawu narzędzi. Pierwsze narzędzie z listy z filtrami,
// kolejne pasują mocowaniem (Mk = Ms ostatniego). Wiersze z paskiem zużycia i miniaturą; zapis do BN z podglądem 2D, 3D i współrzędnymi,
// części zamienne, przekazanie do ToolTrack i eksport DXF.
import { h, clear, api, toast, modal, alertBox, confirmBox } from '../ui.js';
import { toolCatalog, confirmedContoursQuick, invalidateConfirmed, contourGenOn } from '../catalog.js';
import { ndLoad, ndPatch } from '../ndStore.js';
import * as E from '../logic/contourEditor.js';
import { fullContour } from '../logic/contourGen.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import * as B from '../logic/builder.js';
import * as G from '../logic/toolGeometry.js';
import { toolRow, toolTile, miniSvg, stackSvg, view3d, toolView3d, partsTable, fullScreen, filterDropdown, statusLine, lazyFill, setToolStations, locColor, contrast } from './toolViews.js';
import { firebase } from '../fb.js';
import { stationList } from '../logic/harmModel.js';
import * as T from '../logic/tooltrack.js';
import { setToolTrackSelection } from './tooltrack.js';
import { openContoursFor, mountContours, regionsText } from './contours.js';

const FILTERS = [['location', 'Lokal'], ['group', 'Grupa'], ['type', 'Rodzaj'], ['company', 'Firma'], ['diameter', 'Φ'], ['length', 'L'], ['rAlpha', 'r/α']];

export function mountBuilder(el, ctx) {
  const st = { all: [], listed: [], index: null, filters: B.emptyFilters(), selected: [], loading: false, view: 'list', stopFill: null };
  try { st.view = localStorage.getItem('zks.builder.view') === 'tiles' ? 'tiles' : 'list'; } catch { /* domyślnie lista */ }
  const status = statusLine();
  const filtersBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } });
  const list = h('div', { class: 'tool-list' });
  const newBtn = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => { st.selected = []; status.set(''); draw(); } }, 'Nowe narzędzie');
  // widok: lista (jak na telefonie) albo kafelki – liczba kafelków w wierszu zależy od szerokości okna
  const viewBtn = h('button', { class: 'btn', title: 'Zmiana widoku: lista / kafelki', onclick: () => { st.view = st.view === 'tiles' ? 'list' : 'tiles'; try { localStorage.setItem('zks.builder.view', st.view); } catch { /* bez pamięci */ } paintView(); drawList(); } });
  const paintView = () => { viewBtn.textContent = st.view === 'tiles' ? '☰ Lista' : '▦ Kafelki'; list.className = st.view === 'tiles' ? 'tool-grid' : 'tool-list'; };
  paintView();

  async function load(force) {
    st.loading = true; clear(list).append(h('div', { class: 'muted', style: { padding: '12px' } }, 'Ładowanie narzędzi…'));
    try {
      const cat = await toolCatalog(force);
      st.all = (cat.tools || []).filter((t) => String(t.productCode ?? '').trim());
      st.listed = st.all.filter(B.isListed); st.index = G.toolIndex(cat, await confirmedContoursQuick()); st.selected = [];
      // kolory lokalizacji z kolorów stanowisk (Ustawienia programu – config/main)
      try { const { sdk, db } = await firebase(); const snap = await sdk.getDoc(sdk.doc(db, 'config', 'main')); setToolStations(stationList(snap.exists() ? snap.data() : null)); } catch { setToolStations(null); }
      draw();
      st.cat = cat; loadContourData();
    } catch (e) { clear(list).append(h('div', { class: 'err', style: { padding: '12px' } }, 'Nie wczytano narzędzi: ' + e.message, ' ', h('button', { class: 'btn small', onclick: () => load(true) }, 'Ponów'))); }
    st.loading = false;
  }

  // ---------- akceptacja konturu z kafelka: to samo co „✓ Potwierdź poprawność konturu” w Konturach (PSWT: BH, BC, BE) ----------
  const canConfirm = grafikAccess(grafikLevelOf(ctx.user)).manage;
  async function loadContourData() {
    if (!canConfirm) return;
    try {
      const cd = await ndLoad({ manage: true, user: (ctx.user && (ctx.user.name || ctx.user.email)) || '' });   // baza Firebase, gdy pusta – arkusz
      st.cd = { params: cd.params || {}, mounts: cd.mounts || {}, v: cd.v || {} };
      st.index = G.toolIndex(st.cat, overrides());
      paintFix();
      if (st.view === 'tiles') drawList();
    } catch (e) { st.cdError = e.message; if (st.view === 'tiles') drawList(); }
  }
  const nc = (t) => String(t.productCode || '').trim().toLowerCase().replace(/\s+/g, ' ');
  /** Kontur, który Kontury wczytałyby przy otwarciu (bez zmian): kolumna V, T albo dane D:N → prawa połowa SVG. */
  function autoContour(t) {
    const r = autoContour0(t);
    if (!r) return null;
    let svg = E.addEdgeLines(r.svg);   // + linie krawędzi części obrotowej
    const p = st.cd.params[nc(t)], sp = monoSplit(p, svg);
    if (sp) svg = E.addLineAt(svg, sp.z);
    return { ...r, svg, regions: sp ? regionsText(sp.regions) : null };
  }
  /** Narzędzie monolityczne bez rejonów w BE: podział istniejącego konturu wg długości roboczej (K) – ostrze od czubka, reszta oprawka. */
  const monoSplit = (p, svg) => (p && !String(p.BE || '').trim() && E.isMonolithic(p) && E.bladeLength(p) > 0 ? E.workSplit(svg, E.bladeLength(p)) : null);
  /** Kontury dla podglądów: zatwierdzone (BC), a przy włączonym generatorze – V albo wewnętrzny generator zamiast T. */
  const overrides = () => E.contourOverrides(st.cd.params, st.cd.mounts, { gen: contourGenOn(), v: st.cd.v });
  function autoContour0(t) {
    const k = nc(t), v = st.cd.v[k] || '';
    if (v) { const pts = E.svgToContour(v); return { svg: E.isHalf(pts) ? v : E.halfPathSvg(pts), label: 'z kolumny V (roboczy)' }; }
    const tp = origT(t);
    const g = E.generatedHalf(st.cd.params[k], st.cd.mounts);   // generator – sama prawa połowa
    const fromGen = g.length >= 3 ? { svg: E.halfPathSvg(g), label: 'z wewnętrznego generatora (PSWT D:N + karta „kontury”)' } : null;
    const fromT = tp.length >= 3 ? { svg: E.halfPathSvg(tp), label: 'z kolumny T' } : null;
    return contourGenOn() ? fromGen || fromT : fromT || fromGen;
  }
  /** Kontur z kolumny T (ND_CACHE) – także gdy w podglądach zastępuje go zatwierdzony BC. */
  function origT(t) { const d = (st.index && st.index.details(t.productCode)) || {}; return G.parseContour(((d.confirmedContour || d.generatedContour) ? d.originalAY : d.columnAY) || ''); }
  /**
   * Naprawa konturów zatwierdzonych bez zmian w wersji 1.50–1.53 (BC = sam obrys zewnętrzny z T / V / danych D:N):
   * zapis BC jeszcze raz – prawa połowa z liniami krawędzi; potwierdzenie (BH) i rejony (BE) bez zmian.
   */
  function fixableConfirmed() {
    if (!st.cd) return [];
    const out = [];
    for (const t of st.listed) {
      const p = st.cd.params[nc(t)];
      if (!p || !p.BH || !p.BC) continue;
      const srcs = [];
      const v = st.cd.v[nc(t)] || ''; if (v) srcs.push(E.svgToContour(v));
      const tp = origT(t); if (tp.length >= 3) srcs.push(tp);
      const g = G.parseContour(fullContour(p, st.cd.mounts) || ''); if (g.length >= 3) srcs.push(g);
      let svg = p.BC.trim();
      for (const pts of srcs) {   // zapisany sam obrys – weź połowę z liniami z tego samego źródła
        if (E.isHalf(pts)) continue;
        if (E.halfSvg(E.halfFromContour(pts)) === svg) { svg = E.halfPathSvg(pts); break; }
      }
      svg = E.addEdgeLines(svg);   // brakujące linie krawędzi części obrotowej
      const sp = monoSplit(p, svg);   // monolityczne bez rejonów – podział wg długości roboczej
      if (sp) svg = E.addLineAt(svg, sp.z);
      if (svg !== p.BC.trim() || sp) out.push({ t, p, svg, regions: sp ? regionsText(sp.regions) : null });
    }
    return out;
  }
  async function fixConfirmed() {
    const list2 = fixableConfirmed();
    if (!list2.length) { toast('Brak konturów do poprawy'); return; }
    if (!(await confirmBox('Popraw zatwierdzone kontury', `Zatwierdzone kontury do uzupełnienia (${list2.length}): linie krawędzi elementów i części obrotowej (kolumna BC), a w narzędziach monolitycznych bez rejonów – podział ostrze / oprawka wg długości roboczej (kolumna BE). Zapisać je jeszcze raz w PSWT? Potwierdzenie (BH) się nie zmieni.\n\n${list2.slice(0, 12).map((x) => x.t.productCode).join(', ')}${list2.length > 12 ? ' …' : ''}`, 'Popraw'))) return;
    let ok = 0, bad = 0;
    for (const x of list2) {
      status.set(`Poprawianie konturów… ${ok + bad + 1} / ${list2.length}`, 'neutral');
      try { await api('ndConfirmContour', [x.t.productCode, x.p.BH, x.svg, x.regions]); x.p.BC = x.svg; if (x.regions) x.p.BE = x.regions; ndPatch(x.t.productCode, x.p, st.cd.v[nc(x.t)]); ok++; } catch { bad++; }
    }
    status.set(`Poprawiono kontury: ${ok}` + (bad ? `, błędy: ${bad}` : '') + '.', bad ? 'error' : 'neutral');
    invalidateConfirmed(); st.index = G.toolIndex(st.cat, overrides()); paintFix(); drawList();
  }
  const fixBtn = h('button', { class: 'btn', style: { display: 'none' }, title: 'Zatwierdzone kontury bez linii krawędzi – dopisanie linii krawędzi elementów i części obrotowej', onclick: () => fixConfirmed() });
  const paintFix = () => { const n = canConfirm ? fixableConfirmed().length : 0; fixBtn.style.display = n ? '' : 'none'; fixBtn.textContent = `Popraw zatwierdzone kontury (${n})`; };

  function okButton(t) {
    if (!canConfirm) return null;
    const box = h('div', { class: 'tile-ok', onclick: (e) => e.stopPropagation(), oncontextmenu: (e) => e.stopPropagation() });
    const paint = () => {
      clear(box);
      if (!st.cd) { box.append(h('span', { class: 'muted', style: { fontSize: '11px' } }, st.cdError ? 'Kontur: brak danych PSWT' : 'Kontur: wczytywanie…')); return; }
      const p = st.cd.params[nc(t)];
      if (!p) { box.append(h('button', { class: 'btn small', disabled: true, title: 'Brak narzędzia w kolumnie B arkusza PSWT' }, '✓ Akceptuj kontur')); return; }
      if (p.BH) {
        box.append(h('span', { class: 'tile-ok-on', title: 'Kontur potwierdzony (PSWT, kolumna BH): ' + p.BH }, '✓ ' + p.BH),
          h('button', { class: 'btn small', title: 'Cofnij potwierdzenie konturu', onclick: async () => {
            if (!(await confirmBox('Potwierdzenie konturu', `Cofnąć potwierdzenie konturu ${t.productCode}?`, 'Cofnij'))) return;
            try { await api('ndConfirmContour', [t.productCode, '', null, null]); p.BH = ''; ndPatch(t.productCode, p, st.cd.v[nc(t)]); after(t, box, false); toast('Cofnięto potwierdzenie'); } catch (e) { toast('Nie zapisano: ' + e.message, true); }
          } }, '↺'));
        return;
      }
      const src = autoContour(t);
      box.append(h('button', { class: 'btn small primary', disabled: !src, title: src ? 'Zatwierdza kontur ' + src.label + ' – jak „Potwierdź poprawność konturu” w Konturach' : 'Brak konturu (T, V ani danych D:N)', onclick: async () => {
        if (!(await confirmBox('Akceptacja konturu', `Zatwierdzić kontur narzędzia ${t.productCode} (${src.label}, bez zmian)? Do arkusza PSWT trafi: potwierdzenie (kolumna BH) i kontur – prawa połowa (kolumna BC).` + (src.regions ? ` Narzędzie monolityczne – podział wg długości roboczej (kolumna K): ${src.regions} (kolumna BE).` : ' Rejony (kolumna BE) zostają bez zmian.'), 'Zatwierdź'))) return;
        const d = new Date(), who = (ctx.user && (ctx.user.name || ctx.user.email)) || '';
        const value = `OK ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}${who ? ' ' + who : ''}`;
        try { await api('ndConfirmContour', [t.productCode, value, src.svg, src.regions]); p.BH = value; p.BC = src.svg; if (src.regions) p.BE = src.regions; ndPatch(t.productCode, p, st.cd.v[nc(t)]); after(t, box, true); toast('Kontur zatwierdzony – kafelek przeniesiony na koniec listy'); } catch (e) { toast('Nie zapisano: ' + e.message, true); }
      } }, '✓ Akceptuj kontur'));
    };
    box._paint = paint; paint();
    return box;
  }
  /** Po zmianie potwierdzenia: zatwierdzone kontury (BC zamiast T) w miniaturach i podglądach, przerysowanie kafelków. */
  function after(t, box, toEnd) {
    invalidateConfirmed(); st.index = G.toolIndex(st.cat, overrides());
    const tile = box.closest('.tool-tile');
    if (toEnd && tile && st.stopFill && st.stopFill.add) { tile.remove(); st.stopFill.add(t); }   // zatwierdzony – na sam dół, bez przewijania listy
    else if (tile) tile.replaceWith(row(t, { onclick: () => select(t) }));
  }
  /** Kafelki: zatwierdzone kontury (PSWT BH) na końcu listy. */
  const okLast = (items) => (st.view === 'tiles' && st.cd ? [...items.filter((t) => !(st.cd.params[nc(t)] || {}).BH), ...items.filter((t) => (st.cd.params[nc(t)] || {}).BH)] : items);

  const shown = () => B.sorted(st.selected.length ? B.nextCandidates(st.all, st.selected) : B.filterTools(st.listed, st.filters));
  // ikonka narzędzia: Kontury z tym narzędziem; karta narzędzia – prawy przycisk myszy na wierszu / kafelku
  const mini = (t, w = 60, hgt = 70) => miniSvg(st.index && G.buildMini(t, st.index.details(t.productCode)), { w, hgt, onclick: () => contoursWindow(t) });
  const row = (t, opts = {}) => (st.view === 'tiles'
    ? toolTile(t, { warning: !!st.index && st.index.hasPartWarning(t.productCode), mini: mini(t, 90, 110), oncontextmenu: (e) => { e.preventDefault(); miniPreview(t); }, footer: okButton(t), ...opts })
    : toolRow(t, { warning: !!st.index && st.index.hasPartWarning(t.productCode), mini: mini(t), oncontextmenu: (e) => { e.preventDefault(); miniPreview(t); }, ...opts }));

  function draw() {
    newBtn.style.display = st.selected.length ? '' : 'none';
    clear(filtersBox);
    if (st.selected.length) filtersBox.append(h('span', { class: 'muted' }, 'Filtry są wyłączone. Kolejne narzędzie musi pasować mocowaniem: Mk = Ms ostatnio wybranego.'));
    else {
      const code = h('input', { type: 'search', placeholder: 'Kod', value: st.filters.code, style: { width: '110px', padding: '4px 8px' }, oninput: () => { st.filters.code = code.value; drawList(); } });
      filtersBox.append(code, ...FILTERS.map(([f, l]) => filterDropdown(l, st.filters[f], B.options(st.listed, st.filters, f), (v) => { st.filters[f] = v; draw(); })));
      if (Object.values(st.filters).some((v) => String(v).trim())) filtersBox.append(h('button', { class: 'btn small', onclick: () => { st.filters = B.emptyFilters(); draw(); } }, 'Wyczyść'));
    }
    drawList();
  }

  function drawList() {
    const items = okLast(shown());
    if (st.stopFill) st.stopFill();
    clear(list);
    if (st.selected.length) {
      list.append(h('div', { class: 'tool-title' }, `Zestaw (${st.selected.length}) · L=${B.totalLength(st.selected)}`));
      for (const t of st.selected) {
        const d = st.index && st.index.details(t.productCode);
        const parts = d ? (d.partsCutting || []).length + (d.partsAccessories || []).length : null;
        list.append(row(t, { description: B.description(t) + ' | CZĘŚCI: ' + (parts ?? 'brak danych') }));
      }
      list.append(h('div', { class: 'tool-actions' },
        h('button', { class: 'btn primary', onclick: openSave }, 'Zapisz'),
        h('button', { class: 'btn', onclick: () => fullScreen('Części zamienne · ' + B.codesText(st.selected), partsTable(st.index ? st.index.partRows(st.selected.map((t) => t.productCode)) : [])) }, 'Części'),
        h('button', { class: 'btn', onclick: () => { setToolTrackSelection(st.selected); ctx.go('tooltrack'); } }, '→ ToolTrack'),
        h('button', { class: 'btn', onclick: dxf }, 'DXF'),
        h('button', { class: 'btn', onclick: () => { st.selected.pop(); status.set('Usunięto ostatnie narzędzie z zestawu.', 'neutral'); draw(); } }, 'Usuń ostatni')),
      h('hr', { style: { width: '100%', border: 0, borderTop: '1px solid #ccc', margin: '4px 0' } }));
    }
    list.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, (st.selected.length ? 'Pasujące narzędzia: ' : 'Narzędzia: ') + items.length));
    if (!items.length && st.all.length) list.append(h('div', {}, 'Brak narzędzi spełniających kryteria.'));
    // wszystkie narzędzia: dorysowywane porcjami przy przewijaniu (miniatury są kosztowne)
    st.stopFill = lazyFill(list, items, (t) => row(t, { onclick: () => select(t) }));
  }

  function select(t) {
    if (st.selected.some((x) => x.productCode === t.productCode)) return;
    st.selected.push(t);
    draw();
    if (!String(t.columnM ?? '').trim()) status.set('Brak danych w kolumnie M dla wybranego narzędzia.', 'neutral');
    else if (!shown().length) status.set('Brak dalszych powiązanych narzędzi.', 'neutral');
    else status.set('');
  }

  /**
   * Kontury nad ToolBuilderem: okno na prawie cały ekran, reszta wyszarzona i nieaktywna; „Zamknij” albo Esc wraca do ToolBuildera
   * (przy niezapisanych zmianach – pytanie). ToolBuilder zostaje otwarty ze swoim stanem.
   */
  function contoursWindow(t) {
    openContoursFor(t.productCode);
    const host = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
    let api2 = null;
    const close = async () => {
      if (api2 && api2.dirty() && !(await confirmBox('Kontury', 'Porzucić niezapisane zmiany konturu?', 'Porzuć'))) return;
      document.removeEventListener('keydown', onKey, true); m.close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const overlays = document.querySelectorAll('.overlay');
      if (overlays[overlays.length - 1] !== m.root.parentElement) return;   // Esc zamyka najpierw okna otwarte w Konturach
      e.preventDefault(); e.stopPropagation(); close();
    };
    const m = modal(null, h('div', { class: 'fs-dialog' },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { style: { margin: 0, flex: 1 } }, `Kontury – ${t.productCode}`),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Esc – zamknij'), h('button', { class: 'btn', onclick: close }, 'Zamknij')),
      host), { wide: true, sticky: true });
    m.root.classList.add('fs');
    document.addEventListener('keydown', onKey, true);
    api2 = mountContours(host, ctx);
  }

  /** Karta narzędzia: kod, lokalizacja i zużycie; duży rysunek 2D, obracany 3D, parametry w kafelkach, części ze stanem; dodanie do zestawu. */
  function miniPreview(t) {
    const d = st.index && st.index.details(t.productCode);
    const lc = locColor(t.location), wear = T.wearPercent(t.wear), band = T.wearBand(wear);
    const wc = band === 'low' ? '#00c853' : band === 'medium' ? '#ffd600' : '#d50000';
    const one = st.index && st.index.stackTool(t);
    const stack = one ? G.buildStack([one], true, false) : null;
    const params = [['Firma', t.columnP], ['Grupa', t.columnD], ['Rodzaj', t.columnE], ['Φ', t.columnF], ['Długość', String(t.columnJ ?? '').trim() ? t.columnJ + ' mm' : ''],
      ['r / α', [t.columnG, t.columnH].find((x) => String(x ?? '').trim()) || ''], ['Ms', t.columnM], ['Mk', t.columnN], ['Stan', t.status], ['Dostępne', t.available]];
    const opis = [t.name, t.columnO].filter((x) => String(x ?? '').trim()).join(' · ');
    const canAdd = shown().some((x) => x.productCode === t.productCode) && !st.selected.some((x) => x.productCode === t.productCode);
    const parts = st.index ? st.index.partRows([t.productCode]) : [];
    const m = fullScreen('Karta narzędzia', h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      h('div', { class: 'tcard-head' },
        h('span', { class: 'tcard-code' }, t.productCode),
        t.location ? h('span', { class: 'tcard-chip', style: { background: lc || '#eee', color: lc ? contrast(lc) : '#333' } }, t.location) : null,
        h('span', { class: 'muted' }, 'zużycie'), h('div', { class: 'tcard-wear', title: `Zużycie ${Math.round(wear)}%` }, h('div', { style: { width: wear + '%', height: '100%', background: wc } })), h('b', {}, Math.round(wear) + '%'),
        canAdd ? h('button', { class: 'btn primary', onclick: () => { m.close(); select(t); } }, st.selected.length ? '+ Dodaj do zestawu' : 'Wybierz jako pierwsze') : null),
      opis ? h('div', { style: { marginTop: '4px', fontSize: '14px' } }, opis) : null,
      h('div', { class: 'tcard-grid' },
        h('div', { class: 'tcard-pane' }, h('div', { class: 'muted' }, 'Rysunek 2D (płytki na czerwono)'), h('div', { style: { flex: 1, minHeight: 0 } }, stack ? stackSvg(stack, { labels: false, width: 500, height: 600 }) : h('p', { class: 'muted', style: { padding: '10px' } }, 'Brak konturu 2D.'))),
        h('div', { class: 'tcard-pane' }, h('div', { class: 'muted' }, 'Podgląd 3D – przeciągnij, aby obrócić; kółko: przybliżenie'), h('div', { style: { flex: 1, minHeight: 0 } }, toolView3d(st.index, [t]))),
        h('div', { class: 'tcard-pane', style: { overflow: 'auto' } }, h('div', { class: 'muted' }, 'Parametry'),
          h('div', { class: 'tcard-params' }, ...params.filter(([, v]) => String(v ?? '').trim()).map(([k, v]) => h('div', { class: 'tcard-param' }, h('span', {}, k), h('b', {}, String(v))))),
          h('div', { class: 'muted' }, `Części (${parts.length})`), h('div', { style: { padding: '0 6px 6px' } }, partsTable(parts))))));
  }

  function openSave() {
    if (!st.selected.length) { status.set('Najpierw wybierz narzędzie!', 'error'); return; }
    const sel = [...st.selected];
    const ro = (label, value) => h('label', { class: 'f' }, h('span', {}, label), h('input', { type: 'text', value, readonly: true }));
    const komis = h('input', { type: 'text' }), ktk = h('input', { type: 'text' }), op = h('input', { type: 'text' });
    const stack = st.index ? G.buildStack(sel.map((t) => st.index.stackTool(t)), false, true) : null;
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const codes = B.codesText(sel), path = B.selectionPath(sel), len = String(B.totalLength(sel));
      if (!codes.trim() || !path.trim() || !len.trim()) { await alertBox('ToolBuilder', 'Wszystkie pola nieedytowalne muszą być wypełnione!'); return; }
      save.disabled = true; save.textContent = 'Zapisywanie…';
      try {
        await api('saveToolDataToBN', [{ toolCodes: codes, selections: path, toolLength: len, toolKomis: komis.value.trim(), toolKtk: ktk.value.trim(), toolOperation: op.value.trim() }]);
        m.close(); await alertBox('ToolBuilder', 'Narzędzie zapisane!');
      } catch (e) {
        save.disabled = false; save.textContent = 'Zapisz';
        await alertBox('ToolBuilder', 'Błąd podczas zapisywania danych: ' + e.message + (e.code === 'NETWORK' ? ' Nie wiadomo, czy zapis się udał. Sprawdź arkusz BN, zanim spróbujesz ponownie.' : ''));
      }
    } }, 'Zapisz');
    const m = fullScreen('Zapis narzędzia', h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr 1fr', gap: '12px', height: '100%' } },
      h('div', {}, ro('Kod narzędzia', B.codesText(sel)), ro('Wartości wyboru', B.selectionPath(sel)), ro('Długość narzędzia', String(B.totalLength(sel))),
        h('label', { class: 'f' }, h('span', {}, 'Komis'), komis), h('label', { class: 'f' }, h('span', {}, 'Nr KTK'), ktk), h('label', { class: 'f' }, h('span', {}, 'Numer operacji'), op),
        h('div', { class: 'row', style: { marginTop: '8px' } }, save, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj')),
        h('button', { class: 'btn', style: { marginTop: '8px', width: '100%' }, onclick: () => coordinates(sel) }, 'Współrzędne')),
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, h('div', { class: 'muted' }, 'Podgląd 2D'),
        h('div', { style: { flex: 1, minHeight: '300px', border: '1px solid #ddd' } }, stack ? stackSvg(stack) : h('p', { class: 'muted' }, 'Brak danych konturu 2D.'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, h('div', { class: 'muted' }, 'Podgląd 3D'),
        h('div', { style: { flex: 1, minHeight: '300px', border: '1px solid #ddd' } }, toolView3d(st.index, sel)))));
    komis.focus();
  }

  function coordinates(sel) {
    const text = G.coordinatesText(sel.map((t) => st.index.coordinatesTool(t)));
    fullScreen('Współrzędne narzędzia i płytki', h('pre', { style: { fontSize: '11px', userSelect: 'text', margin: 0 } }, text));
  }

  function dxf() {
    const missing = st.selected.filter((t) => !st.index || st.index.dxfTool(t).contour.length === 0);
    if (missing.length) { alertBox('ToolBuilder', 'Brak konturu DXF dla: ' + missing.map((t) => t.productCode).join(', ')); return; }
    const o = G.defaultNameOptions();
    const box = (k, label) => { const c = h('input', { type: 'checkbox', checked: o[k], onchange: () => { o[k] = c.checked; } }); return h('label', { class: 'row' }, c, label); };
    const manual = h('input', { type: 'text', placeholder: 'np. Correa_op10' });
    const m = modal('Nazwa pliku DXF', h('div', {}, box('codes', 'Kody narzędzi'), box('length', 'Długość całkowita'), box('diameter', 'Średnica narzędzia'), box('toolType', 'Rodzaj narzędzia'),
      box('company', 'Firma narzędzia'), box('date', 'Data'), h('label', { class: 'f' }, h('span', {}, 'Opis ręczny'), manual),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'), h('button', { class: 'btn primary', onclick: async () => {
        o.manual = manual.value;
        const tools = st.selected, first = tools[0] || {};
        const name = G.dxfFileName(o, tools.map((t) => t.productCode), tools.reduce((s, t) => s + G.num(t.columnJ), 0), first.columnF || '', first.columnE || '', first.columnP || '', new Date().toISOString().slice(0, 10));
        const text = G.buildDxf(tools.map((t) => st.index.dxfTool(t)));
        m.close();
        const bytes = new TextEncoder().encode(text); let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const b64 = btoa(bin);
        try { const ok = await window.zks.saveFile(name, 'application/dxf', b64); if (ok) toast('Plik DXF został zapisany.'); } catch (e) { toast('Nie udało się zapisać pliku DXF: ' + e.message, true); }
      } }, 'Zapisz plik'))));
  }

  el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '6px';
  el.append(h('div', { class: 'row panel' }, h('b', {}, 'ToolBuilder'), h('span', { class: 'grow muted' }, 'Wybierz narzędzie tnące, potem kolejne pasujące mocowaniem (Mk = Ms). Ikonka narzędzia – Kontury; prawy przycisk – karta narzędzia.'), fixBtn, viewBtn, newBtn,
    h('button', { class: 'btn', onclick: () => load(true) }, 'Odśwież')), filtersBox, status, list);
  load(false);
}
