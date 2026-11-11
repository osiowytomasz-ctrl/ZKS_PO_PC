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

/** Przypisanie pracowników do miejsc pracy: miejsce (np. „1Si1”) albo stanowisko (np. „1Si”) wpisane w komórce Grafiku. */
export function assignPeople(people, slotNames, stationNames) {
  const bySlot = new Map(), byStation = new Map(), rest = [];
  const norm = (t) => String(t).toLocaleLowerCase('pl');
  const has = (text, code) => new RegExp(`(^|[^\\p{L}\\d])${norm(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\d])`, 'u').test(norm(text));
  const slots = [...slotNames].sort((a, b) => b.length - a.length), sts = [...stationNames].sort((a, b) => b.length - a.length);
  for (const p of people) {
    const s = slots.find((x) => has(p.text, x));
    if (s) { if (!bySlot.has(s)) bySlot.set(s, []); bySlot.get(s).push(p); continue; }
    const st = sts.find((x) => has(p.text, x));
    if (st) { if (!byStation.has(st)) byStation.set(st, []); byStation.get(st).push(p); continue; }
    rest.push(p);
  }
  return { bySlot, byStation, rest };
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
