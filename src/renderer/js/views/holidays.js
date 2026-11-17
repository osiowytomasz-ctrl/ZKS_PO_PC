// Ustawienia programu → „Dni świąteczne”: jedna lista świąt dla Harmonogramu (oś czasu, kalendarze) i Grafiku (kolory dni).
import { h, clear, toast } from '../ui.js';
import { calendarButton } from './datePicker.js';
import { parseDateTime } from '../logic/harmImport.js';
import { loadHolidays, saveHolidays } from '../holidayStore.js';

const fmtDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso; };

export function holidaysPanel() {
  const box = h('div', {}, h('p', { class: 'muted' }, 'Wczytywanie świąt…'));
  let rows = [];
  const hmap = () => new Map(rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.iso || '')).map((r) => [r.iso, r.name]));
  const render = () => {
    clear(box);
    const th = (t) => h('th', { style: { textAlign: 'left', padding: '2px 6px', background: '#eee', border: '1px solid #999', fontSize: '12px' } }, t);
    const tb = h('tbody', {});
    for (const r of rows) {
      const dI = h('input', { type: 'text', value: r.text, placeholder: 'np. 11.11.2026', spellcheck: 'false', style: { width: '110px', border: 'none', padding: '3px 6px' }, oninput: () => { r.text = dI.value; } });
      const nI = h('input', { type: 'text', value: r.name, placeholder: 'np. Święto Niepodległości', style: { width: '260px', border: 'none', padding: '3px 6px' }, oninput: () => { r.name = nI.value; } });
      tb.append(h('tr', {}, h('td', { style: { border: '1px solid #999', padding: 0, whiteSpace: 'nowrap' } }, dI, calendarButton(dI, { title: 'Wybierz datę święta z kalendarza', holidays: hmap() })),
        h('td', { style: { border: '1px solid #999', padding: 0 } }, nI),
        h('td', { style: { border: '1px solid #999', padding: '0 4px' } }, h('button', { class: 'btn small', onclick: () => { rows.splice(rows.indexOf(r), 1); render(); } }, 'Usuń'))));
    }
    box.append(h('div', { style: { maxHeight: '320px', overflow: 'auto' } }, h('table', { style: { borderCollapse: 'collapse' } }, h('thead', {}, h('tr', {}, th('Data (dd.mm.rrrr)'), th('Opis'), th(''))), tb)),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', onclick: () => { rows.push({ text: '', name: '' }); render(); const ins = box.querySelectorAll('tbody tr:last-child input'); if (ins[0]) ins[0].focus(); } }, 'Dodaj święto'),
        h('button', { class: 'btn small primary', onclick: save }, 'Zapisz święta')));
  };
  async function save() {
    const list = [];
    for (const r of rows) {
      if (!r.text.trim() && !r.name.trim()) continue;
      const t = parseDateTime(r.text.trim());
      if (t == null) { toast(`Święta: nie rozpoznano daty „${r.text}” (wpisz np. 11.11.2026)`); return; }
      const iso = new Date(t).toISOString().slice(0, 10);
      if (list.some((x) => x.date === iso)) { toast(`Święta: data ${r.text.trim()} jest wpisana dwa razy`); return; }
      list.push({ date: iso, name: r.name.trim() });
    }
    try { await saveHolidays(list); toast(`Zapisano święta: ${list.length}`); await load(); }
    catch (e) { toast('Nie zapisano świąt: ' + (e.code === 'permission-denied' ? 'brak uprawnień (GOD Harmonogramu albo MASTER / GOD Grafiku)' : e.message || e), true); }
  }
  async function load() {
    try { rows = (await loadHolidays()).map((x) => ({ text: fmtDay(x.date), iso: x.date, name: x.name })); render(); }
    catch (e) { clear(box); box.append(h('p', { class: 'muted err' }, 'Nie wczytano świąt: ' + (e.code === 'permission-denied' ? 'brak dostępu do bazy' : e.message || e))); }
  }
  load();
  return h('div', {}, h('h2', { style: { marginTop: '18px' } }, 'Dni świąteczne'),
    h('p', { class: 'muted' }, 'Wspólne dla całego programu: Harmonogram (oś czasu, kalendarze, terminy) i Grafik (czerwone dni). Zmienia GOD Harmonogramu albo MASTER / GOD Grafiku.'), box);
}
