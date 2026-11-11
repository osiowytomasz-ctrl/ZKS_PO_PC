// Oś czasu Harmonogramu: interwał kolumn (od 1 godziny do miesiąca), przesunięcie początku względem dziś, święta.
// Czas „lokalny” liczony jak UTC (ms), tak jak w całym silniku.

const HOUR = 3600000, DAY = 24 * HOUR;

/** Interwały kolumn osi: `hours` = nominalna długość kolumny (do przeliczenia skali), `unit` = sposób wyznaczania granic. */
export const INTERVALS = [
  { id: '1h', label: '1 godzina', unit: 'h', n: 1, hours: 1 }, { id: '2h', label: '2 godziny', unit: 'h', n: 2, hours: 2 },
  { id: '4h', label: '4 godziny', unit: 'h', n: 4, hours: 4 }, { id: '6h', label: '6 godzin', unit: 'h', n: 6, hours: 6 },
  { id: '12h', label: '12 godzin', unit: 'h', n: 12, hours: 12 }, { id: 'd', label: '1 dzień', unit: 'd', n: 1, hours: 24 },
  { id: 'w', label: '1 tydzień', unit: 'w', n: 1, hours: 168 }, { id: 'm', label: '1 miesiąc', unit: 'm', n: 1, hours: 730 },
];
export const DEFAULT_INTERVAL = 'd';
export const intervalOf = (id) => INTERVALS.find((i) => i.id === id) || INTERVALS.find((i) => i.id === DEFAULT_INTERVAL);

export const MAX_SHIFT_DAYS = 3650;
/** Początek osi: pełna godzina „teraz” + przesunięcie w dniach (ujemne = przeszłość, dodatnie = przyszłość). */
export const axisStartMs = (nowMs, shiftDays) => Math.floor(nowMs / HOUR) * HOUR + Math.max(-MAX_SHIFT_DAYS, Math.min(MAX_SHIFT_DAYS, shiftDays)) * DAY;

const p2 = (n) => String(n).padStart(2, '0');
const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };

/** Święta z ustawień ([{date: 'RRRR-MM-DD', name}] albo same teksty dat) jako Map data → nazwa. */
export function holidayMap(list) {
  const m = new Map();
  for (const x of list || []) { const date = typeof x === 'string' ? x : x && x.date; if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) m.set(date, (x && x.name) || ''); }
  return m;
}

/** Następna granica kolumny po chwili [ms] dla interwału. */
function nextBoundary(ms, iv) {
  const d = new Date(ms);
  if (iv.unit === 'h') { const step = iv.n * HOUR, day0 = Math.floor(ms / DAY) * DAY; return day0 + (Math.floor((ms - day0) / step) + 1) * step; }
  if (iv.unit === 'd') return (Math.floor(ms / DAY) + 1) * DAY;
  if (iv.unit === 'w') { const day0 = Math.floor(ms / DAY) * DAY, dow = (new Date(day0).getUTCDay() + 6) % 7; return day0 + (7 - dow) * DAY; }   // tydzień od poniedziałku
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * Kolumny osi od [startMs] do co najmniej [endMs] (+ zapas dwóch kolumn), najwyżej [maxCells]. Pierwsza kolumna może być niepełna.
 * Każda: {start, end, hours, label, kind}; kind: 'work' | 'sat' | 'sun' | 'holiday' (dla godzin i dni wg dnia), 'span' dla tygodni i miesięcy.
 */
export function buildCells(startMs, endMs, intervalId, holidays, maxCells = 2000) {
  const iv = intervalOf(intervalId), hol = holidays || new Map();
  const cells = [];
  let t = startMs, extra = 2;
  while (cells.length < maxCells && (t <= endMs || extra-- > 0 || cells.length < 7)) {
    const end = nextBoundary(t, iv), d = new Date(t);
    let label, kind = 'span';
    const dm = `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`;
    if (iv.unit === 'h') label = `${dm} ${p2(d.getUTCHours())}:00`;
    else if (iv.unit === 'd') label = `${dm}.${d.getUTCFullYear()}`;
    else if (iv.unit === 'w') label = `tydz. ${dm}.${d.getUTCFullYear()}`;
    else label = `${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
    if (iv.unit === 'h' || iv.unit === 'd') { const dow = d.getUTCDay(); kind = hol.has(dayKeyOf(t)) ? 'holiday' : dow === 0 ? 'sun' : dow === 6 ? 'sat' : 'work'; }
    cells.push({ start: t, end, hours: (end - t) / HOUR, label, kind, holidayName: kind === 'holiday' ? hol.get(dayKeyOf(t)) : '' });
    t = end;
  }
  return cells;
}

/** Najdłuższa etykieta kolumny dla interwału (do dopasowania wysokości nagłówka). */
export const sampleLabel = (intervalId) => { const iv = intervalOf(intervalId); return iv.unit === 'h' ? '00.00 00:00' : iv.unit === 'w' ? 'tydz. 00.00.0000' : iv.unit === 'm' ? '00.0000' : '00.00.0000'; };
