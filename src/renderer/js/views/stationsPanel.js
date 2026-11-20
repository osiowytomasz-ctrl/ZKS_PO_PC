// Ustawienia programu → „Kolory stanowisk”: wspólne dla całego programu (Harmonogram, Grafik, Plan; także Android) – Firestore config/main.stations.
// Zmienia poziom GOD Harmonogramu (reguły bazy). Zapisywane są tylko stanowiska dodane i te z kolorami innymi niż domyślne.
import { h, clear, toast } from '../ui.js';
import { firebase } from '../fb.js';
import { stationList, DEFAULT_STATIONS } from '../logic/harmModel.js';
import { parseSheetColor } from '../logic/common.js';

export function stationsPanel() {
  const box = h('div', {}, h('p', { class: 'muted' }, 'Wczytywanie stanowisk…'));
  let rows = [];
  const render = () => {
    clear(box);
    for (const r of rows) {
      const def = DEFAULT_STATIONS.find((d) => d.name === r.name);
      const sample = h('span', { style: { display: 'inline-block', width: '56px', textAlign: 'center', fontStyle: 'italic', fontWeight: 700, padding: '1px 4px', background: r.bg, color: r.color } }, r.name);
      const bgI = h('input', { type: 'color', value: parseSheetColor(r.bg, '#cccccc'), style: { width: '28px', height: '20px', padding: 0, border: 0 }, oninput: () => { r.bg = bgI.value; sample.style.background = r.bg; } });
      const fgI = h('input', { type: 'color', value: parseSheetColor(r.color, '#000000'), style: { width: '28px', height: '20px', padding: 0, border: 0 }, oninput: () => { r.color = fgI.value; sample.style.color = r.color; } });
      box.append(h('div', { class: 'row', style: { margin: '2px 0', alignItems: 'center', gap: '6px' } }, sample, bgI, h('span', { class: 'muted' }, 'tło'), fgI, h('span', { class: 'muted' }, 'tekst'),
        def ? h('button', { class: 'btn small', title: 'Przywraca kolory domyślne', onclick: () => { r.bg = def.bg; r.color = def.color; render(); } }, 'Domyślne')
          : h('label', { class: 'muted', title: 'Godziny wszystkich miejsc pracy się sumują (jak Śl, Do, Narz)' }, h('input', { type: 'checkbox', checked: r.sum, onchange: (e) => { r.sum = e.target.checked; } }), ' sumuj godziny'),
        def ? null : h('button', { class: 'btn small', onclick: () => { rows.splice(rows.indexOf(r), 1); render(); } }, 'Usuń')));
    }
    const nameI = h('input', { type: 'text', placeholder: 'Nowe stanowisko, np. 4Fr', style: { padding: '3px', width: '180px' }, spellcheck: 'false' });
    box.append(h('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } }, nameI,
      h('button', { class: 'btn small', onclick: () => {
        const name = nameI.value.trim();
        if (!name) { toast('Wpisz nazwę stanowiska'); return; }
        if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) { toast('Takie stanowisko już jest'); return; }
        rows.push({ name, bg: '#cccccc', color: '#000000', sum: false }); render();
      } }, 'Dodaj'),
      h('button', { class: 'btn small primary', onclick: save }, 'Zapisz stanowiska')));
  };
  const save = async () => {
    const list = rows.filter((r) => { const d = DEFAULT_STATIONS.find((x) => x.name === r.name); return !d || d.bg !== r.bg || d.color !== r.color || r.sum; })
      .map(({ name, bg, color, sum }) => (sum ? { name, bg, color, sum: true } : { name, bg, color }));
    try {
      const { sdk, db } = await firebase();
      await sdk.setDoc(sdk.doc(db, 'config', 'main'), { stations: list }, { merge: true });
      toast('Zapisano kolory stanowisk');
    } catch (e) { toast('Nie zapisano: ' + (e.code === 'permission-denied' ? 'zmienia tylko poziom GOD Harmonogramu' : e.message || e), true); }
  };
  (async () => {
    try {
      const { sdk, db } = await firebase();
      const snap = await sdk.getDoc(sdk.doc(db, 'config', 'main'));
      rows = stationList(snap.exists() ? snap.data() : null).map((x) => ({ name: x.name, bg: x.bg, color: x.color, sum: !!x.sum }));
      render();
    } catch (e) { clear(box).append(h('p', { class: 'err' }, 'Nie wczytano stanowisk: ' + (e.message || e))); }
  })();
  return h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Kolory stanowisk'),
    h('p', { class: 'muted' }, 'Wspólne dla całego programu (Harmonogram, Grafik, Plan, telefon). Zmienia poziom GOD Harmonogramu.'), box);
}
