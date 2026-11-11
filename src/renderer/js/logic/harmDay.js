// Informacje o dniu (prawy przycisk na dniu osi Harmonogramu): obsada maszyn z grafiku (graf_norm), pracownicy z Grafiku (karta G)
// i operacje, które trwają w danej dobie produkcyjnej. Czyste funkcje (testy: test/harm-day.test.js); okno rysuje views/harmLive.js.
import { shiftHours, stationHours, slotNumber } from './schedule.js';
import { cleanName, isSeparator } from './grafik.js';

const HOUR = 3600000, DAY = 24 * HOUR;
export const DAY_START_HOUR = 6;                      // doba produkcyjna: od 6:00 do 6:00 następnego dnia (jak w liczeniu terminów)
const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const ABSENCE = { UT: 'urlop', L4: 'zwolnienie lekarskie', '*': 'dzień wolny' };

/** Dzień kliknięcia: data „RRRR-MM-DD”, opis i doba produkcyjna [start, end) w ms (czas ścienny jak UTC). */
export function dayOf(ms) {
  const d0 = Math.floor(ms / DAY) * DAY, d = new Date(d0);
  const p = (n) => String(n).padStart(2, '0');
  return {
    iso: d.toISOString().slice(0, 10), label: `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`, weekday: WEEKDAYS[d.getUTCDay()],
    start: d0 + DAY_START_HOUR * HOUR, end: d0 + DAY + DAY_START_HOUR * HOUR,
  };
}

/** Kod miejsca pracy z grafiku: zmiany a/b/c z godzinami (a = I zmiana, b = II, c = III) albo nieobecność (UT, L4, *). */
export function describeCode(code) {
  const text = String(code ?? '').trim();
  const h = shiftHours(text), hours = h.a + h.b + h.c;
  if (hours > 0) return { text, hours, work: true, shifts: ['a', 'b', 'c'].filter((l) => h[l] > 0).map((l) => `${{ a: 'I', b: 'II', c: 'III' }[l]} zm. ${h[l]} h`).join(', ') };
  const key = Object.keys(ABSENCE).find((k) => text.toUpperCase() === k.toUpperCase());
  return { text, hours: 0, work: false, shifts: key ? ABSENCE[key] : text ? 'bez godzin' : '' };
}

/**
 * Obsada maszyn w dniu z karty graf_norm: dla każdego stanowiska miejsca pracy (1Si1, 1Si2…) z kodem i godzinami oraz godziny stanowiska
 * policzone tak jak w harmonogramie. [stations] = [{name, bg, color, sum}]. Miejsca, które nie pasują do żadnego stanowiska, trafiają do „Inne”.
 */
export function daySlots(daysByKey, iso, stations) {
  const slots = (daysByKey && daysByKey[iso]) || {};
  const used = new Set();
  const out = stations.map((s) => {
    const list = [];
    for (const [header, code] of Object.entries(slots)) { const n = slotNumber(header, s.name); if (n) { list.push({ slot: header, n, code, ...describeCode(code) }); used.add(header); } }
    list.sort((a, b) => a.n - b.n);
    const codes = Array(9).fill(''); for (const x of list) codes[x.n - 1] = x.code;
    return { station: s.name, bg: s.bg, color: s.color, slots: list, hours: stationHours(s.name, codes, s.sum ? true : undefined) };
  });
  const other = Object.entries(slots).filter(([hd]) => !used.has(hd)).map(([slot, code]) => ({ slot, n: 0, code, ...describeCode(code) }));
  if (other.length) out.push({ station: 'Inne', bg: '#eeeeee', color: '#000000', slots: other, hours: other.reduce((t, x) => t + x.hours, 0) });
  return out.filter((s) => s.slots.length);
}

/** Pracownicy z Grafiku (odpowiedź getGrData dla jednego dnia): nazwisko, wpis z dnia i kolory komórki jak w Grafiku. */
export function grafikPeople(gr) {
  if (!gr || !gr.rows) return [];
  const out = [];
  for (let i = 1; i < gr.rows.length; i++) {
    const r = gr.rows[i];
    if (!r || isSeparator(r.name) || !String(r.name || '').trim()) continue;
    const text = String((gr.extraValues && gr.extraValues[i] && gr.extraValues[i][0]) ?? '').trim();
    if (!text) continue;
    out.push({ name: cleanName(r.name), fullName: String(r.name).trim(), text, value: String(r.value || '').trim(),
      bg: (gr.extraBackgrounds && gr.extraBackgrounds[i] && gr.extraBackgrounds[i][0]) || '', color: (gr.extraFontColors && gr.extraFontColors[i] && gr.extraFontColors[i][0]) || '',
      nameBg: r.nameBg || '', nameColor: r.nameColor || '' });
  }
  return out;
}

const normCode = (t) => String(t ?? '').trim().toLowerCase();

/**
 * Operatorzy na miejscach pracy. Karta graf_norm powstaje z Grafiku: wypełnione miejsca pracy (w kolejności kolumn graf_norm) odpowiadają
 * kolejnym pracownikom z wpisem w Grafiku (w kolejności wierszy). Przy tej samej liczbie – po kolei; przy różnej – dopasowanie po kolei
 * z tym samym kodem zmiany (najdłuższy wspólny podciąg), reszta pracowników zostaje bez przypisania.
 * [slots] = [{slot, code}] w kolejności graf_norm; wynik: {bySlot: Map slot → {person, same}, rest: [person]}; same = kod w Grafiku = kod w graf_norm.
 */
export function matchOperators(people, slots) {
  const bySlot = new Map();
  if (people.length === slots.length) {
    slots.forEach((s, i) => bySlot.set(s.slot, { person: people[i], same: normCode(people[i].text) === normCode(s.code) }));
    return { bySlot, rest: [] };
  }
  const n = people.length, m = slots.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = normCode(people[i].text) === normCode(slots[j].code) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const used = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (normCode(people[i].text) === normCode(slots[j].code)) { bySlot.set(slots[j].slot, { person: people[i], same: true }); used.add(i); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return { bySlot, rest: people.filter((_, i) => !used.has(i)) };
}

/** Okna zmian w dobie: a od 6:00, b od 14:00, c od 22:00, każda na tyle godzin, ile w kodzie (np. „a5b3” → 6–11 i 14–17). */
export function shiftWindows(code, dayStart) {
  const h = shiftHours(code);
  return [['a', 0], ['b', 8], ['c', 16]].filter(([l]) => h[l] > 0).map(([l, off]) => ({ shift: l, from: dayStart + off * HOUR, to: dayStart + (off + h[l]) * HOUR }));
}

/** Odcinki zadań stanowiska w oknach zmian operatora (to, nad czym pracuje w swojej zmianie); bez okien = cała doba. */
export function operatorSegments(tasks, windows, dayStart, dayEnd) {
  const wins = windows.length ? windows : [{ from: dayStart, to: dayEnd }];
  const out = [];
  for (const t of tasks) for (const w of wins) { const a = Math.max(t.from, w.from), b = Math.min(t.to, w.to); if (b > a) out.push({ task: t, from: a, to: b }); }
  return out;
}

/** Odcinki zadań stanowiska poza zmianami wszystkich operatorów (praca bez obsady według grafiku). */
export function uncoveredSegments(tasks, windows) {
  const wins = [...windows].sort((p, q) => p.from - q.from);
  const out = [];
  for (const t of tasks) {
    let cur = t.from;
    for (const w of wins) { if (w.to <= cur) continue; if (w.from >= t.to) break; if (w.from > cur) out.push({ task: t, from: cur, to: Math.min(w.from, t.to) }); cur = Math.max(cur, w.to); if (cur >= t.to) break; }
    if (cur < t.to) out.push({ task: t, from: cur, to: t.to });
  }
  return out;
}

/**
 * Zadania w dobie [start, end): operacje-liście (praca na stanowiskach), które w tym czasie trwają, pogrupowane wg stanowiska,
 * oraz zlecenia (komisy) z tymi zadaniami. [rows] – wiersze danych harmonogramu, [result] – terminy (id → {start, end}).
 */
export function dayTasks(rows, result, start, end) {
  const tasks = [];
  for (const r of rows) {
    if (r.komisRow || r.subCount) continue;
    const t = result.get(r.id);
    if (!t || t.start == null || t.end == null || t.end <= start || t.start >= end) continue;
    tasks.push({ row: r, start: t.start, end: t.end, from: Math.max(start, t.start), to: Math.min(end, t.end) });
  }
  tasks.sort((a, b) => a.start - b.start || String(a.row.id).localeCompare(String(b.row.id)));
  const byStation = new Map();
  for (const t of tasks) { const k = t.row.stanowisko || t.row.station || '—'; if (!byStation.has(k)) byStation.set(k, []); byStation.get(k).push(t); }
  const komis = new Map();
  for (const t of tasks) {
    const k = String(t.row.komis || '').trim() || '—';
    if (!komis.has(k)) komis.set(k, { komis: k, client: t.row.client || '', tasks: 0, stations: new Set(), hours: 0 });
    const e = komis.get(k); e.tasks++; e.stations.add(t.row.stanowisko || t.row.station || '—'); e.hours += Number(t.row.hours) || 0;
  }
  return { tasks, byStation, komis: [...komis.values()].map((e) => ({ ...e, stations: [...e.stations] })) };
}
