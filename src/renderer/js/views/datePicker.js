// Okno wyboru daty z kalendarzem (komórki z datą w Harmonogramie): miesiąc z dniami tygodnia, weekendy i święta w kolorach jak w harmonogramie,
// godzina i minuty, przyciski „Dziś” i „Wyczyść”. Daty to czas ścienny zapisany jak UTC (jak w całym Harmonogramie).
import { h, clear, modal } from '../ui.js';

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const p2 = (n) => String(n).padStart(2, '0');

/** [value] – ms albo null; [holidays] – Map 'RRRR-MM-DD' → nazwa; onPick(ms|null) – null = wyczyść. */
export function datePickerDialog({ title = 'Wybierz datę', value = null, holidays = new Map(), defaultHour = 6, onPick }) {
  const now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const init = value != null ? new Date(value) : null;
  let sel = init ? Date.UTC(init.getUTCFullYear(), init.getUTCMonth(), init.getUTCDate()) : null;
  let viewY = (init || new Date(today)).getUTCFullYear(), viewM = (init || new Date(today)).getUTCMonth();
  const hourSel = h('select', { style: { padding: '3px' } }, ...Array.from({ length: 24 }, (_, i) => h('option', { value: i }, p2(i))));
  const minSel = h('select', { style: { padding: '3px' } }, ...[0, 15, 30, 45].map((m) => h('option', { value: m }, p2(m))));
  hourSel.value = String(init ? init.getUTCHours() : defaultHour);
  const mins = init ? init.getUTCMinutes() : 0;
  if (![0, 15, 30, 45].includes(mins)) minSel.append(h('option', { value: mins }, p2(mins)));
  minSel.value = String(mins);
  const head = h('div', { style: { fontWeight: 700, minWidth: '150px', textAlign: 'center' } });
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 38px)', gap: '2px', marginTop: '6px' } });
  const shown = h('div', { class: 'muted', style: { marginTop: '6px' } });
  const render = () => {
    head.textContent = `${MONTHS[viewM]} ${viewY}`;
    clear(grid);
    ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].forEach((d, i) => grid.append(h('div', { style: { textAlign: 'center', fontSize: '12px', fontWeight: 700, color: i === 5 ? '#0070c0' : i === 6 ? '#c00000' : '#555' } }, d)));
    const first = Date.UTC(viewY, viewM, 1), dow = (new Date(first).getUTCDay() + 6) % 7, days = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    for (let i = 0; i < dow; i++) grid.append(h('div', {}));
    for (let d = 1; d <= days; d++) {
      const ms = Date.UTC(viewY, viewM, d), wd = (dow + d - 1) % 7, iso = `${viewY}-${p2(viewM + 1)}-${p2(d)}`;
      const hol = holidays.has(iso), isSel = ms === sel, isToday = ms === today;
      const bg = isSel ? '#1a73e8' : hol ? '#800000' : wd === 6 ? '#ffe5e5' : wd === 5 ? '#e5f4fc' : '#fff';
      grid.append(h('button', { type: 'button', title: hol ? 'Święto: ' + (holidays.get(iso) || '') : '', onclick: () => { sel = ms; render(); },
        style: { height: '32px', border: isToday ? '2px solid #00b050' : '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: bg,
          color: isSel || hol ? '#fff' : wd === 6 ? '#c00000' : wd === 5 ? '#0070c0' : '#000', fontWeight: isSel || hol || isToday ? 700 : 400 } }, String(d)));
    }
    shown.textContent = sel == null ? 'Nie wybrano dnia' : `Wybrano: ${new Date(sel).toISOString().slice(8, 10)}.${new Date(sel).toISOString().slice(5, 7)}.${new Date(sel).getUTCFullYear()} ${p2(+hourSel.value)}:${p2(+minSel.value)}`;
  };
  hourSel.addEventListener('change', render); minSel.addEventListener('change', render);
  const move = (dm) => { viewM += dm; if (viewM < 0) { viewM = 11; viewY--; } if (viewM > 11) { viewM = 0; viewY++; } render(); };
  const m = modal(title, h('div', {},
    h('div', { class: 'row', style: { alignItems: 'center', justifyContent: 'space-between' } },
      h('button', { class: 'btn small', title: 'Poprzedni miesiąc', onclick: () => move(-1) }, '‹'), head, h('button', { class: 'btn small', title: 'Następny miesiąc', onclick: () => move(1) }, '›')),
    grid,
    h('div', { class: 'row', style: { alignItems: 'center', gap: '6px', marginTop: '8px' } }, 'Godzina ', hourSel, ':', minSel,
      h('button', { class: 'btn small', onclick: () => { sel = today; viewY = new Date(today).getUTCFullYear(); viewM = new Date(today).getUTCMonth(); render(); } }, 'Dziś')),
    shown,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', style: { marginRight: 'auto' }, title: 'Usuwa datę z tej komórki', onclick: () => { m.close(); onPick(null); } }, 'Wyczyść'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
      h('button', { class: 'btn primary', onclick: () => { if (sel == null) return; m.close(); onPick(sel + (+hourSel.value) * 3600000 + (+minSel.value) * 60000); } }, 'OK'))));
  render();
}
