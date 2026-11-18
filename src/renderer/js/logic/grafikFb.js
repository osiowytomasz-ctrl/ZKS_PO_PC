// Grafik w Firebase: te same wyliczenia co karta G arkusza (formuły i formatowanie warunkowe z audytu 16.11.2026).
// W bazie są tylko kody (a8, b8, UT, L4…) i komentarze; kolory, podsumowania urlopów i godzin oraz graf_norm liczy program.
// Czyste funkcje – testy: test/grafik-fb.test.js. Ten sam algorytm ma Android (ui/grafik/GrafikFb.kt).
import { shiftHours, slotNumber } from './schedule.js';

const lc = (s) => String(s ?? '').trim().toLowerCase();
const has = (code, part) => lc(code).includes(lc(part));             // COUNTIFS "*x*" i TEXT_CONTAINS – bez wielkości liter
const eq = (code, v) => lc(code) === lc(v);                           // porównanie „=” w arkuszu – bez wielkości liter

/** Kody nieobecności liczone w kolumnach AU…BE karty G (COUNTIFS „zawiera”). */
export const ABSENCES = [
  ['NŻ', 'na żądanie'], ['v', 'odebranie urlopu'], ['L4', 'chorobowe'], ['OP', 'opieka'], ['Ojc', 'ojcowski'], ['OKL', 'okolicznościowy'],
  ['HDK', 'honorowy dawca krwi'], ['BO', 'badania okresowe'], ['BHP', 'szkolenie BHP'], ['SZ', 'szkolenia inne'], ['Sł', 'służba wojskowa'],
];
export const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

// ---------------------------------------------------------------------------------------------------------------------
// Kolory komórek dnia: reguły formatowania warunkowego karty G w tej samej kolejności (pierwsza pasująca wygrywa)
// ---------------------------------------------------------------------------------------------------------------------
const S = (bg, color, bold = false, italic = false) => ({ bg, color, bold, italic });
const DEFAULT_STYLE = S('#ffffff', '#000000');
/**
 * Styl komórki dnia. [code] – wpis, [iso] – data rrrr-mm-dd, [ctx]: { todayIso, hour (0–23), holiday (bool – niedziela/święto z wiersza 3),
 * utNegative (pozostały urlop pracownika < 0) }. Kopia reguł z karty G (audyt): pierwsza pasująca reguła wygrywa.
 */
export function cellStyle(code, iso, ctx = {}) {
  const c = String(code ?? '').trim(), l = c.toLowerCase(), empty = c === '';
  const today = ctx.todayIso || '', h = ctx.hour ?? 12;
  const dow = iso ? new Date(iso + 'T00:00:00Z').getUTCDay() : -1;
  const first = l.charAt(0), third = l.charAt(2);
  const yesterday = today ? new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) : '';
  if (c.includes('*')) return S('#1155cc', '#ffffff', true);
  if (eq(c, 'L4')) return S('#000000', '#ffff00');
  if (eq(c, 'UT') && ctx.utNegative) return S('#ff0000', '#000000', true, true);
  if (eq(c, 'UT')) return S('#92d050', '#38761d', true, true);
  if (eq(c, 'KW')) return S('#ff0000', '#ffff00', true, true);
  if (eq(c, 'BHP')) return S('#ffff00', '#000000', true);
  if (eq(c, 'BO') || eq(c, 'BK')) return S('#00ffff', '#000000', true);
  if (eq(c, 'Op')) return S('#ff9900', '#000000', true, true);
  if (eq(c, 'Hdk')) return S('#ffffff', '#980000', true, true);
  if (eq(c, 'Nż')) return S('#0d904f', '#ff0000', true, true);
  if (eq(c, 'Ojc')) return S('#ff00ff', '#000000', true, true);
  if (eq(c, 'OKL')) return S('#9900ff', '#ffffff', true, true);
  if (has(c, '.w')) return S('#0000ff', '#ffff00', true, true);
  if (eq(c, 'V')) return S('#b7e1cd', '#000000');
  if (l.includes('sz')) return S('#7f6000', '#000000', true, true);
  // minione wpisy (i I zmiana dzisiaj po 14:00) – szare
  if ((iso && today && iso < today && !empty) || (h >= 14 && first === 'a' && iso === today)) return S('#434343', '#ffffff');
  // pusta komórka w sobotę – niebieska, w niedzielę i święto – czerwona
  if (empty && dow === 6) return S('#00b0f0', '#ffffff');
  if (empty && (dow === 0 || ctx.holiday)) return S('#cc0000', '#ffffff');
  if (has(c, 'Egz')) return S('#00ff00', '#000000', true, true);
  if (has(c, 'AUDIT')) return S('#980000', '#00ff00', true, true);
  // zmiana trwająca teraz – zielona
  if (iso && today && ((h <= 14 && (first === 'a' || third === 'a') && iso === today) || (h > 14 && h <= 22 && first === 'b' && iso === today)
    || (h <= 6 && first === 'c' && iso === yesterday) || (h >= 22 && first === 'c' && iso === today))) return S('#00b050', '#000000', true, true);
  if (c.includes('?') && /[abc]/.test(l)) return S('#ff0000', '#ff0000');
  const shiftLetter = c.length === 4 ? third : first;
  if (shiftLetter === 'a') return S('#f3f3f3', '#000000');
  if (shiftLetter === 'b') return S('#d9d9d9', '#000000');
  if (shiftLetter === 'c') return S('#b7b7b7', '#000000');
  if (empty) return S('#000000', '#000000');
  if (c === '?') return S('#ffc7ff', '#000000', true, true);
  if (c === '!!') return S('#00ffff', '#ff0000', true, true);
  return DEFAULT_STYLE;
}
/** Nagłówek dnia: sobota niebieska, niedziela i święto czerwone (jak w arkuszu). */
/** Kolor kolumny absencji (AU–BE karty G) – ten sam co komórka dnia z tym kodem; „Sł” nie ma reguły, więc jak w arkuszu – łososiowy. */
export function absenceStyle(code) {
  if (eq(code, 'Sł')) return S('#fce5cd', '#000000', true);
  return cellStyle(code, '2000-01-03', { todayIso: '1999-01-01', hour: 0 });   // dzień roboczy w przyszłości: bez reguł „minione” i „dziś”
}

export function headerStyle(iso, holiday) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  if (dow === 6) return S('#00b0f0', '#ffffff');
  if (dow === 0 || holiday) return S('#cc0000', '#ffffff');
  return S('#ffffff', '#000000');
}

// ---------------------------------------------------------------------------------------------------------------------
// Podsumowania pracownika w roku (kolumny C, D, F…Q, AD…AO, AP, AS, AT, AU…BE karty G)
// ---------------------------------------------------------------------------------------------------------------------
/** Godziny z kodu: suma zmian a, b, c (a8b2 → 10; L4, UT → 0). Arkusz liczył to niejednolicie (patrz docs/GRAFIK_ANALIZA.md). */
export const codeHours = (code) => { const h = shiftHours(code); return h.a + h.b + h.c; };
/**
 * Godziny przepracowane z wpisu dnia (kolumny AD–AO karty G, poprawione): suma liczb po literach zmian a/b/c
 * (a8 = 8, a8b2 = 10, b2c6 = 8, a10 = 10); sam numer (np. „8”) = tyle godzin; nieobecności (UT, L4, NŻ…) = 0.
 * Arkusz liczył inaczej i niespójnie: w części wierszy pierwsza liczba z komórki (L4 = 4 h, a8b2 = 8 h), w innych
 * sklejone cyfry (a8b2 = 82 h); do tego „DATE(rok; 2; 31)” to 3 marca, więc luty obejmował początek marca.
 */
export function workHours(code) {
  const t = lc(code);
  if (!t) return 0;
  let sum = 0, any = false;
  for (const m of t.matchAll(/[abc](\d{1,2})/g)) { sum += Number(m[1]); any = true; }
  if (any) return sum;
  return /^\d{1,2}$/.test(t) ? Number(t) : 0;
}

/** Numer tygodnia ISO 8601 (poniedziałek–niedziela; tydzień z pierwszym czwartkiem roku = 1) – jak NUM.TYG.ISO w arkuszu. */
export function isoWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z'), wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const y = d.getUTCFullYear(), first = new Date(Date.UTC(y, 0, 4));
  return 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

/** Pierwszy i ostatni dzień miesiąca [m] (1–12) roku [y]: ['2026-11-01', '2026-11-30']. */
export function monthRange(y, m) {
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate(), mm = String(m).padStart(2, '0');
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`];
}

/** Poniedziałek i niedziela tygodnia ISO [w] roku ISO [y]. */
export function isoWeekRange(y, w) {
  const j4 = Date.UTC(Number(y), 0, 4), wd = (new Date(j4).getUTCDay() + 6) % 7, mon = j4 + ((Number(w) - 1) * 7 - wd) * 86400000;
  return [new Date(mon).toISOString().slice(0, 10), new Date(mon + 6 * 86400000).toISOString().slice(0, 10)];
}

/** Liczba tygodni ISO w roku (52 albo 53). */
export const isoWeeksInYear = (y) => isoWeek(`${y}-12-28`);

/** Stanowisko miejsca pracy („1Si2” → stanowisko 1Si z listy Harmonogramu, z kolorami). Wielka „I” zamiast „l” też pasuje. */
export function placeStation(place, stations) {
  const p = String(place ?? '').trim();
  if (!p) return null;
  for (const s of stations || []) if (slotNumber(p, s.name) || slotNumber(p.replace(/I/g, 'l'), s.name) || lc(p) === lc(s.name)) return s;
  return null;
}

/**
 * Podsumowanie pracownika [p] w roku [year] z wpisów [codes] (Map/obiekt iso → kod) na dzień [todayIso]:
 *  - utByMonth[12]: ile dni z „UT” w miesiącu (F…Q),
 *  - hoursToMonth[12]: godziny narastająco do końca miesiąca (AD…AO),
 *  - planned: suma planu urlopu z miesięcy (AP), used: UT + NŻ do dziś włącznie (AS), future: UT po dziś (AT),
 *  - available = UT z poprzedniego roku + UT bieżący − used (D), remaining = available − future (C),
 *  - absences: liczba dni z każdym kodem nieobecności (AU…BE), monthPlanMet[12]: wykonanie = plan (kolor pomarańczowy F…Q).
 */
export function personSummary(p, codes, year, todayIso) {
  const y = String(year), list = codes instanceof Map ? [...codes] : Object.entries(codes || {});
  const ut = (p.ut && p.ut[y]) || {};
  const plan = (ut.plan || []).map((x) => Number(x) || 0);
  const utByMonth = Array(12).fill(0), hoursByMonth = Array(12).fill(0), absences = Object.fromEntries(ABSENCES.map(([k]) => [k, 0]));
  let used = 0, future = 0;
  for (const [iso, code] of list) {
    if (!iso.startsWith(y + '-') || !String(code ?? '').trim()) continue;
    const m = Number(iso.slice(5, 7)) - 1;
    if (has(code, 'UT')) { utByMonth[m]++; if (iso <= todayIso) used++; else future++; }
    if (has(code, 'NŻ') && iso <= todayIso) used++;
    hoursByMonth[m] += workHours(code);
    for (const [k] of ABSENCES) if (has(code, k)) absences[k]++;
  }
  const hoursToMonth = []; let acc = 0;
  for (let m = 0; m < 12; m++) { acc += hoursByMonth[m]; hoursToMonth.push(acc); }
  const available = (Number(ut.prev) || 0) + (Number(ut.cur) || 0) - used;
  return {
    utByMonth, hoursByMonth, hoursToMonth, plan, planned: plan.reduce((a, b) => a + b, 0), used, future, available, remaining: available - future, absences,
    monthPlanMet: utByMonth.map((n, m) => plan[m] != null && plan[m] !== 0 && n === plan[m]),
  };
}

/** Nazwisko jak w kolumnie B arkusza: „Nazwisko Imię   UT= 4 br” (pozostały urlop i dopisek). */
export const displayName = (p, remaining) => `${p.name}   UT= ${remaining}${p.suffix ? ' ' + p.suffix : ''}`;

// ---------------------------------------------------------------------------------------------------------------------
// graf_norm z Grafiku: dla każdego dnia miejsca pracy (kolumna BF karty G) z kodami pracowników – wejście silnika Harmonogramu
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Dni grafiku w kształcie, jakiego używa Harmonogram (`daysByKey`): { 'rrrr-mm-dd': { '1Si1': 'a8', … } }. Pracownik bez miejsca pracy
 * albo separator – pomijany; dwa razy to samo miejsce – liczy się pierwszy pracownik (jak PODAJ.POZYCJĘ w graf_norm).
 */
export function grafNormDays(people, codesByPerson, isos) {
  const out = {};
  for (const iso of isos) {
    const slots = {};
    for (const p of people) {
      if (p.sep || !p.place || p.place in slots) continue;
      const c = (codesByPerson[p.id] || {})[iso];
      slots[p.place] = c == null ? '' : String(c);
    }
    out[iso] = slots;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Paczki miesięczne w bazie: gr_days/{rrrr-mm} = { c: { osoba: { dd: kod } }, n: { osoba: { dd: komentarz } } }
// ---------------------------------------------------------------------------------------------------------------------
export const monthKey = (iso) => iso.slice(0, 7);
export const dayOf = (iso) => iso.slice(8, 10);
/** Miesiące (rrrr-mm) obejmujące zakres dat (włącznie). */
export function monthsBetween(fromIso, toIso) {
  const out = []; let [y, m] = fromIso.split('-').map(Number); const [y2, m2] = toIso.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
/** Daty (rrrr-mm-dd) od–do włącznie. */
export function daysBetween(fromIso, toIso) {
  const out = []; for (let t = Date.parse(fromIso + 'T00:00:00Z'), e = Date.parse(toIso + 'T00:00:00Z'); t <= e; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/** Paczki miesięcy → { kody: osoba → { iso → kod }, komentarze: osoba → { iso → tekst } }. */
export function unpackMonths(months) {
  const codes = {}, notes = {};
  for (const [mk, doc] of Object.entries(months || {})) {
    for (const [pid, days] of Object.entries((doc && doc.c) || {})) for (const [dd, v] of Object.entries(days || {})) { (codes[pid] = codes[pid] || {})[`${mk}-${dd}`] = v; }
    for (const [pid, days] of Object.entries((doc && doc.n) || {})) for (const [dd, v] of Object.entries(days || {})) { (notes[pid] = notes[pid] || {})[`${mk}-${dd}`] = v; }
  }
  return { codes, notes };
}
/** Kod wpisany ręcznie: bez spacji na brzegach, puste = usunięcie; najwyżej 20 znaków. */
export const cleanCode = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
