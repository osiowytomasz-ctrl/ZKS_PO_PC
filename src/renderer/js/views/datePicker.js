// Okno wyboru daty z kalendarzem (komórki z datą w Harmonogramie): miesiąc z dniami tygodnia, weekendy i święta w kolorach jak w harmonogramie,
// godzina i minuty, przyciski „Dziś” i „Wyczyść”. Daty to czas ścienny zapisany jak UTC (jak w całym Harmonogramie).
import { h, clear, modal } from '../ui.js';
import { parseDateTime } from '../logic/harmImport.js';

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const p2 = (n) => String(n).padStart(2, '0');

/** [value] – ms albo null; [holidays] – Map 'RRRR-MM-DD' → nazwa; onPick(ms|null) – null = wyczyść. */
export function datePickerDialog({ title = 'Wybierz datę', value = null, holidays = new Map(), defaultHour = 6, withTime = true, onPick }) {
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
  const render = (syncText = true) => {
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
    if (syncText && textIn) { textIn.value = fmtSel(); textErr.textContent = ''; }
    shown.textContent = sel == null ? 'Nie wybrano dnia' : `Wybrano: ${new Date(sel).toISOString().slice(8, 10)}.${new Date(sel).toISOString().slice(5, 7)}.${new Date(sel).getUTCFullYear()}` + (withTime ? ` ${p2(+hourSel.value)}:${p2(+minSel.value)}` : '');
  };
  // pole tekstowe: datę można wpisać albo wkleić (dd.mm.rrrr gg:mm, rrrr-mm-dd, z Excela); kalendarz i godzina idą za polem
  const fmtSel = () => (sel == null ? '' : `${new Date(sel).toISOString().slice(8, 10)}.${new Date(sel).toISOString().slice(5, 7)}.${new Date(sel).getUTCFullYear()}` + (withTime ? ` ${p2(+hourSel.value)}:${p2(+minSel.value)}` : ''));
  const textIn = h('input', { type: 'text', value: '', placeholder: withTime ? 'np. 14.11.2026 14:00' : 'np. 14.11.2026', spellcheck: 'false', style: { width: '170px', padding: '4px', fontSize: '14px' } });
  const textErr = h('span', { class: 'err', style: { fontSize: '12px' } });
  const fromText = () => {
    const t = textIn.value.trim();
    if (!t) { textErr.textContent = ''; return true; }
    const ms = parseDateTime(t);
    if (ms == null) { textErr.textContent = 'Nie rozpoznano daty'; return false; }
    textErr.textContent = '';
    const d = new Date(ms);
    sel = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); viewY = d.getUTCFullYear(); viewM = d.getUTCMonth();
    if (withTime) {
      hourSel.value = String(d.getUTCHours());
      const mi = d.getUTCMinutes(); if (![...minSel.options].some((o) => +o.value === mi)) minSel.append(h('option', { value: mi }, p2(mi))); minSel.value = String(mi);
    }
    render(false); return true;
  };
  textIn.addEventListener('input', fromText);
  textIn.addEventListener('paste', () => setTimeout(fromText, 0));
  textIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (fromText()) ok(); } });
  hourSel.addEventListener('change', () => render()); minSel.addEventListener('change', () => render());
  const move = (dm) => { viewM += dm; if (viewM < 0) { viewM = 11; viewY--; } if (viewM > 11) { viewM = 0; viewY++; } render(); };
  const ok = () => { if (sel == null) return; m.close(); onPick(withTime ? sel + (+hourSel.value) * 3600000 + (+minSel.value) * 60000 : sel); };
  const m = modal(title, h('div', {},
    h('div', { class: 'row', style: { alignItems: 'center', gap: '6px', marginBottom: '6px' } }, 'Wpisz lub wklej: ', textIn, textErr),
    h('div', { class: 'row', style: { alignItems: 'center', justifyContent: 'space-between' } },
      h('button', { class: 'btn small', title: 'Poprzedni miesiąc', onclick: () => move(-1) }, '‹'), head, h('button', { class: 'btn small', title: 'Następny miesiąc', onclick: () => move(1) }, '›')),
    grid,
    h('div', { class: 'row', style: { alignItems: 'center', gap: '6px', marginTop: '8px' } }, ...(withTime ? ['Godzina ', hourSel, ':', minSel] : []),
      h('button', { class: 'btn small', onclick: () => { sel = today; viewY = new Date(today).getUTCFullYear(); viewM = new Date(today).getUTCMonth(); render(); } }, 'Dziś')),
    shown,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', style: { marginRight: 'auto' }, title: 'Usuwa datę z tej komórki', onclick: () => { m.close(); onPick(null); } }, 'Wyczyść'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Anuluj'),
      h('button', { class: 'btn primary', onclick: () => { if (fromText()) ok(); } }, 'OK'))));
  render();
  textIn.focus(); textIn.select();
}

/**
 * Przycisk z ikoną kalendarza do pola tekstowego z datą „dd.mm.rrrr”: otwiera kalendarz i wpisuje wybraną datę do pola
 * (wywołuje zdarzenia input i change, więc pole działa jak przy ręcznym wpisaniu).
 */
export function calendarButton(input, { title = 'Wybierz datę z kalendarza', holidays = new Map(), withTime = false } = {}) {
  const parse = (t) => { const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?)?$/.exec(String(t || '').trim()); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : null; };
  const fmt = (ms) => { const d = new Date(ms); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}` + (withTime ? ` ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : ''); };
  return h('button', { type: 'button', class: 'btn small', title, 'aria-label': title, style: { padding: '2px 6px' }, onclick: () => datePickerDialog({ title, value: parse(input.value), holidays, withTime,
    onPick: (ms) => { input.value = ms == null ? '' : fmt(ms); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); } }) }, '📅');
}
