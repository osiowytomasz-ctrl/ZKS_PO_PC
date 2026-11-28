// Wspólne okno „Migracja” dla kart przenoszonych z arkusza do bazy (ZN, ZP, ZwG, …) – tylko GOD (docs/MIGRACJA_ARKUSZ_DO_BAZY.md):
// wybór trybu pracy (arkusz / równolegle / tylko baza), import z arkusza do bazy i porównanie bazy z arkuszem (kolumny liczone przez program mają być takie same jak w arkuszu).
import { h, clear, modal, toast, api, confirmBox } from '../ui.js';
import { MODES, getMode, setMode } from '../migrationStore.js';

/**
 * title – tytuł okna; domain – klucz trybu (migrationStore); user – nazwa zapisywana przy zmianie; allowed – dozwolone tryby (domyślnie wszystkie), reasons – opis, dlaczego tryb jest zablokowany;
 * exportKey – karta do eksportu bazy do arkusza ('ZN' | 'ZP' | 'ZWG' | 'ZAKUPY' | 'N' | 'PSWT'; przycisk tylko, gdy podano);
 * dbWarning – dodatkowe ostrzeżenie przy włączaniu trybu „Tylko baza”;
 * importFn() → tekst wyniku (sam pyta o zgodę; throw – błąd); compareFn() → { ok, sheet, db, onlySheet, onlyDb, diffs, expected } (klucz wpisu w polu lp albo n); onMode(mode) – po zmianie trybu.
 */
export async function openMigrationDialog({ title, domain, user = '', allowed = Object.keys(MODES), reasons = {}, importFn, compareFn, onMode, intro = '', exportKey = '', dbWarning = '' }) {
  const current = await getMode(domain, true);
  const out = h('div', { style: { fontSize: '13px', maxHeight: '40vh', overflow: 'auto', margin: '8px 0' } });
  const radios = Object.entries(MODES).map(([k, label]) => {
    const ok = allowed.includes(k);
    return h('label', { style: { display: 'block', margin: '4px 0', opacity: ok ? 1 : 0.5 }, title: ok ? '' : reasons[k] || 'Niedostępne' }, h('input', { type: 'radio', name: 'migmode', value: k, checked: current === k, disabled: !ok }), ' ' + label + (ok ? '' : ` – ${reasons[k] || 'niedostępne'}`));
  });
  const busy = async (label, fn) => { out.textContent = label + '…'; out.style.color = ''; try { await fn(); } catch (e) { out.textContent = 'Błąd: ' + (e.message || e); out.style.color = '#c62828'; } };
  const keyOf = (x) => (x.lp != null ? x.lp : x.n);
  const importBtn = h('button', { class: 'btn', onclick: () => busy('Import z arkusza', async () => { out.textContent = await importFn(); }) }, 'Importuj z arkusza do bazy');
  const cmpBtn = h('button', { class: 'btn', onclick: () => busy('Porównywanie z arkuszem', async () => {
    const r = await compareFn();
    clear(out);
    out.append(h('div', { style: { fontWeight: 700, color: r.ok ? '#1b5e20' : '#c62828' } }, r.ok
      ? `✔ Zgodne: ${r.sheet} wpisów w arkuszu i w bazie, wszystkie pola (także liczone) takie same${r.expected.length ? ` – poza ${r.expected.length} oczekiwanymi różnicami (puste pola liczone w arkuszu, policzone przez program)` : ''}.`
      : `✖ Różnice: arkusz ${r.sheet} wpisów, baza ${r.db}; tylko w arkuszu: ${r.onlySheet.length}, tylko w bazie: ${r.onlyDb.length}, różnych pól: ${r.diffs.length}`));
    if (r.onlySheet.length) out.append(h('div', {}, 'Tylko w arkuszu: ' + r.onlySheet.slice(0, 40).join(', ')));
    if (r.onlyDb.length) out.append(h('div', {}, 'Tylko w bazie: ' + r.onlyDb.slice(0, 40).join(', ')));
    if (r.byColumn && Object.keys(r.byColumn).length) out.append(h('div', { style: { margin: '4px 0' } }, 'Różnice wg pól: ' + Object.entries(r.byColumn).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')));
    if (r.expected && r.expected.length) out.append(h('div', { class: 'muted' }, `Oczekiwane (arkusz puste, program policzył): ${r.expected.length}.`));
    if (r.diffs.length) out.append(h('button', { class: 'btn small', onclick: async () => {
      const tsv = ['wpis\tpole\tarkusz\tbaza', ...r.diffs.map((x) => [keyOf(x), x.field, String(x.sheet ?? '').replace(/\s+/g, ' '), String(x.db ?? '').replace(/\s+/g, ' ')].join('\t'))].join('\n');
      try { await navigator.clipboard.writeText(tsv); toast(`Skopiowano ${r.diffs.length} różnic`); } catch { toast('Nie udało się skopiować do schowka', true); }
    } }, `Kopiuj wszystkie różnice (${r.diffs.length})`));
    if (r.diffs.length) out.append(h('table', { class: 't', style: { width: '100%', marginTop: '6px' } }, h('thead', {}, h('tr', {}, ...['wpis', 'pole', 'arkusz', 'baza'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...r.diffs.slice(0, 150).map((x) => h('tr', {}, h('td', {}, String(keyOf(x))), h('td', {}, x.field), h('td', { class: 'left' }, String(x.sheet ?? '')), h('td', { class: 'left' }, String(x.db ?? '')))))));
  }) }, 'Porównaj z arkuszem');
  /** Droga powrotna: baza → arkusz (tylko komórki bez formuł, te same zakresy co import; Eksport.gs). Tylko GOD. */
  const exportBtn = exportKey ? h('button', { class: 'btn', title: 'Wpisuje dane z bazy do karty w arkuszu (tylko komórki bez formuł; formuły zostają)', onclick: () => busy('Eksport do arkusza', async () => {
    if (!(await confirmBox('Eksport do arkusza', 'Wpisać dane z bazy do karty w arkuszu? Zmieniane są tylko komórki bez formuł, które różnią się od bazy – wartości wpisane w arkuszu ręcznie po ostatnim imporcie zostaną nadpisane danymi z bazy.', 'Eksportuj'))) { out.textContent = 'Anulowano.'; return; }
    const r = await api('exportToSheet', [exportKey], { timeoutMs: 360000 }), x = ((r && r.results) || [])[0] || {};
    out.textContent = `Eksport ${x.card || exportKey}: wpisów w bazie ${x.entries}, zapisano komórek ${x.written}, nowych wierszy ${x.newRows}, pominięto komórek z formułami ${x.skippedFormulas}${x.skippedEntries ? `, pominięto wpisów ze zdublowanym numerem ${x.skippedEntries}` : ''}.`;
  }) }, 'Eksportuj do arkusza') : null;
  const saveMode = h('button', { class: 'btn primary', onclick: () => busy('Zapis trybu', async () => {
    const v = (radios.map((l) => l.querySelector('input')).find((i) => i.checked) || {}).value;
    if (!v) return;
    if (v === 'db' && !(await confirmBox('Tryb „Tylko baza”', (dbWarning ? dbWarning + '\n\n' : '') + 'Zapisy idą wyłącznie do bazy – arkusz przestaje się aktualizować (przepiszesz go z bazy przyciskiem „Eksportuj do arkusza”). Aplikacje na Androida i iPhone\'a nadal czytają i zapisują w arkuszu, więc ich zmiany nie trafią do bazy, dopóki nie zostaną przestawione. Wycofanie: tryb „Arkusz”. Włączyć?', 'Włącz'))) return;
    await setMode(domain, v, user); out.textContent = `Tryb: ${MODES[v]}.`;
    if (onMode) await onMode(v);
    toast('Zapisano tryb: ' + MODES[v]);
  }) }, 'Zapisz tryb');
  const m = modal(title, h('div', {},
    h('p', { class: 'muted', style: { fontSize: '12px' } }, intro || 'Kolejność: 1) Importuj z arkusza do bazy, 2) Porównaj z arkuszem (musi być „Zgodne”), 3) tryb „Równolegle” (nowe wpisy idą do bazy i do arkusza) i po kilku dniach porównaj ponownie, 4) tryb „Tylko baza”. Wycofanie: tryb „Arkusz”.'),
    ...radios, h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, saveMode, importBtn, cmpBtn, exportBtn), out,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  return m;
}
