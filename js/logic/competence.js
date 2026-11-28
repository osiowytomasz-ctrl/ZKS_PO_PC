// Kompetencje operatorów (matryca jak arkusz „MK”): dane podstawowe, uprawnienia (daty i numery) i umiejętności z wagami.
// Punkty = Σ poziom umiejętności (0–100) × waga kolumny – jak SUMPRODUCT($AE:$BZ; $AE$2:$BZ$2) w arkuszu.
// Czyste funkcje – testy: test/competence.test.js.
import { excelToIso } from './xlsxRead.js';

/** Dane podstawowe (kolumny A–G arkusza). */
export const BASIC = [
  { key: 'dept', title: 'Wydz.', full: 'Wydział (PO, PL, PM…)', w: 46 },
  { key: 'komis', title: 'Komis wewn.', full: 'Komis wewnętrzny', w: 80 },
  { key: 'machine', title: 'Maszyna / stanowisko', full: 'Obsługiwana maszyna, stanowisko', w: 120 },
  { key: 'position', title: 'Stanowisko wg umowy', full: 'Stanowisko wg umowy', w: 140 },
  { key: 'hired', title: 'Data zatrudn.', full: 'Data zatrudnienia (dd.mm.rrrr)', w: 84, date: true },
];

const lc = (s) => String(s ?? '').trim().toLowerCase();
export const cleanId = (s) => String(s ?? '').replace(/[^A-Za-z0-9_]/g, '_');
/** Identyfikator pracownika: wydział + nr ewidencyjny (PO + 12007 → „PO12007”, jak nr ew. w Grafiku). */
export const personId = (dept, nr, row) => (String(nr ?? '').trim() ? cleanId(String(dept || '').trim().toUpperCase() + String(nr).trim()) : 'k' + row);

/** Punkty pracownika (Σ poziom × waga). */
export function points(person, skills) {
  let s = 0;
  for (const k of skills || []) s += (Number((person.skills || {})[k.key]) || 0) * (Number(k.weight) || 0);
  return Math.round(s * 100) / 100;
}

/** Uprawnienie do pilnowania terminu (jak formatowanie warunkowe arkusza: kolumny „Badania ważne do” i „Data szkolenia BHP”). */
export const isExpiryPerm = (name) => /badani|bhp/i.test(String(name));
/** Stan daty uprawnienia: 'expired' (minęła), 'soon' (w ciągu 30 dni) albo ''. Arkusz: obie na czerwono (< DZIŚ+30). */
export function permAlert(value, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '';
  if (value < todayIso) return 'expired';
  const soon = new Date(Date.parse(todayIso + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  return value < soon ? 'soon' : '';
}

const mix = (a, b, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) + parseInt(b.slice(1 + i, 3 + i), 16) * t).toString(16).padStart(2, '0')).join('');
/** Kolor poziomu umiejętności 0–100: skala od białego do zielonego (jak skala kolorów w Excelu). */
export function levelColor(v) {
  const n = Number(v);
  if (!String(v ?? '').trim() || !Number.isFinite(n) || n <= 0) return null;
  return mix('#ffffff', '#57bb8a', Math.min(1, n / 100));
}

/** Wpis poziomu: liczba 0–100 („50”, „50%”, „0,5” → 50) albo '' – inaczej null (błędny). */
export function parseLevel(text) {
  const t = String(text ?? '').trim().replace('%', '').replace(',', '.');
  if (!t) return '';
  let n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1 && !/%/.test(String(text))) n = Math.round(n * 100);
  return n < 0 || n > 100 ? null : n;
}

/** Daty wpisywane w uprawnieniach: dd.mm.rrrr / rrrr-mm-dd → 'RRRR-MM-DD'; inny tekst zostaje (numer uprawnień, „szkolenie”, „x”). */
export function parsePermValue(text) {
  const t = String(text ?? '').trim();
  let m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? t : t;
}
export const fmtPerm = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v ?? ''); };

/**
 * Import arkusza matrycy (odczyt readXlsx): wiersz 3 – nagłówki, wiersz 2 – wagi umiejętności (kolor tła = grupa), od wiersza 4 – pracownicy.
 * Kolumny rozpoznawane po nagłówkach: „Nazwisko i Imię”, „Komis”, „Obsługiwana maszyna”, „Stanowisko wg. umowy”, „ewid.”;
 * uprawnienia – kolumny od pierwszej po „ewid.” do kolumny przed „ur” (data urodzenia nie jest przenoszona); umiejętności – po „Punkty”.
 */
export function parseCompetenceSheet(ws) {
  const get = (r, c) => ws.cells.get(colName(c) + r);
  const val = (r, c) => { const x = get(r, c); return x ? x.v : null; };
  const head = (c) => lc(String(val(3, c) ?? '').replace(/\s+/g, ' '));
  const find = (re, from = 1) => { for (let c = from; c <= ws.maxCol; c++) if (re.test(head(c))) return c; return 0; };
  const cName = find(/nazwisko/), cKomis = find(/komis/), cMach = find(/obsługiwana|maszyna/), cPos = find(/wg\.? ?umowy/), cNr = find(/ewid/);
  const cDept = cName > 1 ? cName - 1 : 0, cBirth = find(/^ur$/), cPts = find(/^punkty$/);
  if (!cName || !cPts) throw new Error('Nie rozpoznano matrycy: w wierszu 3 potrzebne są nagłówki „Nazwisko i Imię” i „Punkty”.');
  const permEnd = (cBirth || find(/^wydział$/) || cPts) - 1;
  const perms = [];
  for (let c = (cNr || cPos || cName) + 1; c <= permEnd; c++) {
    const name = String(val(3, c) ?? '').replace(/\s+/g, ' ').trim(); if (!name) continue;
    perms.push({ key: 'p' + colName(c), name, ...(isExpiryPerm(name) ? { expiry: true } : {}) });
  }
  const skills = [];
  for (let c = cPts + 1; c <= ws.maxCol; c++) {
    const name = String(val(3, c) ?? '').trim(); if (!name) continue;
    const w = get(2, c);
    skills.push({ key: 's' + colName(c), name, weight: Number(w && w.v) || 0, color: (w && w.fill) || '#d9d9d9' });
  }
  const people = {}; let n = 0;
  for (let r = 4; r <= ws.maxRow; r++) {
    const name = String(val(r, cName) ?? '').trim(); if (!name) continue;
    const dept = String(val(r, cDept) ?? '').trim().toUpperCase(), nr = val(r, cNr);
    let id = personId(dept, nr, r); while (people[id]) id += '_';
    const p = { lp: ++n, name, dept, nr: nr == null ? '' : String(nr), komis: str(val(r, cKomis)), machine: str(val(r, cMach)), position: str(val(r, cPos)), perms: {}, skills: {} };
    for (const pm of perms) { const x = get(r, colIdx(pm.key.slice(1))); if (x && x.v != null && String(x.v).trim() !== '') p.perms[pm.key] = x.date ? excelToIso(x.v) : String(x.v).trim(); }
    for (const sk of skills) { const x = get(r, colIdx(sk.key.slice(1))); const v = x && typeof x.v === 'number' ? x.v : parseLevel(x && x.v); if (v !== '' && v != null && v !== 0) p.skills[sk.key] = v; }
    people[id] = p;
  }
  return { perms, skills, people };
}
const str = (v) => (v == null ? '' : String(v).trim());
export const colName = (i) => { let s = ''; for (; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const colIdx = (l) => { let c = 0; for (const ch of l) c = c * 26 + ch.charCodeAt(0) - 64; return c; };

// ---------------------------------------------------------------------------------------------------------------------
// Uprawnienia: każde ma numer, datę wydania i datę ważności (people[id].perms[typ] = {nr, issued, valid}).
// Typ może mieć okres ważności w latach – wtedy „ważne do” bez wpisu liczy się z daty wydania.
// ---------------------------------------------------------------------------------------------------------------------
/** Domyślne typy uprawnień (z kolumn H–Y arkusza MK). */
export const PERM_TYPES = [
  { key: 'wst', name: 'Szkolenie wstępne' },
  { key: 'instr', name: 'Instruktaż stanowiskowy' },
  { key: 'bad', name: 'Badania lekarskie' },
  { key: 'bhp', name: 'Szkolenie BHP' },
  { key: 'suw', name: 'Suwnica' },
  { key: 's135', name: 'Spawanie 135' },
  { key: 's141', name: 'Spawanie 141' },
  { key: 'gaz', name: 'Uprawnienia gazowe (G)' },
  { key: 'ciec', name: 'Cięcie gazowe 81' },
  { key: 'pod', name: 'Podesty ruchome' },
  { key: 'woz', name: 'Wózki widłowe' },
  { key: 'zwy', name: 'Zwyżki' },
  { key: 'umowa', name: 'Umowa' },
];
export const PERM_FIELDS = [['nr', 'Nr'], ['issued', 'Wydano'], ['valid', 'Ważne do']];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Definicje typów w nowym układzie? (stary import miał klucze kolumn arkusza „pH”, „pL”… i jedną wartość na kolumnę). */
export const isNewPermDefs = (defs) => Array.isArray(defs) && defs.length > 0 && defs.every((d) => d && !/^p[A-Z]{1,2}$/.test(d.key));

/** Uprawnienie osoby jako {nr, issued, valid}; stary zapis (sam tekst) – traktowany jako numer. */
export function permOf(person, key) {
  const v = ((person && person.perms) || {})[key];
  if (v == null || v === '') return {};
  if (typeof v === 'object') return v;
  return ISO.test(String(v)) ? { issued: String(v) } : { nr: String(v) };
}

/** Data ważności: wpisana albo wyliczona z daty wydania i okresu typu (lata). {iso, computed}. */
export function permValid(perm, def) {
  if (perm && ISO.test(String(perm.valid || ''))) return { iso: perm.valid, computed: false };
  const years = Number(def && def.validYears) || 0;
  if (years > 0 && perm && ISO.test(String(perm.issued || ''))) {
    const d = new Date(perm.issued + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + years); d.setUTCDate(d.getUTCDate() - 1);
    return { iso: d.toISOString().slice(0, 10), computed: true };
  }
  return { iso: '', computed: false };
}

/** Stan terminu: 'expired' (minął), 'soon' (w ciągu [days] dni) albo ''. */
export function validStatus(iso, todayIso, days = 30) {
  if (!ISO.test(String(iso || ''))) return '';
  if (iso < todayIso) return 'expired';
  const soon = new Date(Date.parse(todayIso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  return iso <= soon ? 'soon' : '';
}

/** Najgorszy stan uprawnień osoby (do filtra „Terminy”): 'expired' > 'soon' > ''. */
export function personPermStatus(person, defs, todayIso, days = 30) {
  let worst = '';
  for (const d of defs || []) {
    const s = validStatus(permValid(permOf(person, d.key), d).iso, todayIso, days);
    if (s === 'expired') return 'expired';
    if (s === 'soon') worst = 'soon';
  }
  return worst;
}

// ---------- odczyt komórek arkusza z uprawnieniami ----------
const DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const pad = (n) => String(n).padStart(2, '0');
/**
 * Komórka arkusza → {date, kind, text}: data (z formatu daty, „waż. dd/mm/rrrr”, „wyd. dd/mm/rrrr”, dd.mm.rrrr, liczba dni Excela)
 * z rodzajem z dopisku ('valid' / 'issued' / null), albo tekst (numer, „x”, „szkolenie”). „-”, „brak” i puste – pomijane.
 */
export function parsePermCell(cell) {
  if (!cell || cell.v == null) return null;
  if (cell.date && typeof cell.v === 'number') return { date: excelToIso(cell.v), kind: null };
  if (typeof cell.v === 'number') return cell.v > 20000 && cell.v < 80000 ? { date: excelToIso(cell.v), kind: null } : { text: String(cell.v) };
  let t = String(cell.v).replace(/\s+/g, ' ').trim();
  if (!t || /^[-–]+$/.test(t) || /^brak$/i.test(t)) return null;
  let kind = null;
  const pre = /^(waż\.?|ważne do|wazne do|wyd\.?)\s*/i.exec(t);
  if (pre) { kind = /^wyd/i.test(pre[1]) ? 'issued' : 'valid'; t = t.slice(pre[0].length).trim(); }
  const m = DMY.exec(t);
  if (m) return { date: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, kind };
  if (/^\d{5}$/.test(t) && Number(t) > 20000 && Number(t) < 80000) return { date: excelToIso(Number(t)), kind };
  return { text: t };
}

/** Nagłówek kolumny arkusza → [typ, pole] ('nr' | 'issued' | 'valid' | 'auto' – data wyd./waż. rozpoznawana po dopisku albo dacie). */
export function permColumn(header) {
  const h = String(header || '').toLowerCase().replace(/\s+/g, ' ');
  const rules = [
    [/szkoleni\w* wstępn/, 'wst', 'issued'], [/instruktaż/, 'instr', 'issued'], [/badani/, 'bad', 'valid'], [/szkoleni\w* bhp/, 'bhp', 'issued'],
    [/suwnic.*nr/, 'suw', 'nr'], [/suwnic.*dat/, 'suw', 'auto'], [/metoda ?135/, 's135', 'auto'], [/metoda ?141/, 's141', 'auto'],
    [/gazowe.*nr/, 'gaz', 'nr'], [/gazowe.*dat/, 'gaz', 'auto'], [/cięcie gazowe|ciecie gazowe/, 'ciec', 'auto'],
    [/podest.*nr/, 'pod', 'nr'], [/podest.*(dat|waż|waz)/, 'pod', 'valid'], [/wózk.*nr|wozk.*nr/, 'woz', 'nr'], [/wózk.*dat|wozk.*dat/, 'woz', 'auto'],
    [/zwyż.*nr|zwyz.*nr/, 'zwy', 'nr'], [/zwyż.*dat|zwyz.*dat/, 'zwy', 'auto'], [/umowa/, 'umowa', 'auto'],
  ];
  for (const [re, key, field] of rules) if (re.test(h)) return [key, field];
  return null;
}

/** Wartość komórki dopisana do uprawnienia [perm] (pole z kolumny, rodzaj daty z dopisku albo – dla „auto” – data przyszła = ważność). */
export function mergePermCell(perm, field, parsed, todayIso) {
  if (!parsed) return perm;
  const out = { ...perm };
  if (parsed.text != null) { out.nr = out.nr ? `${out.nr}; ${parsed.text}` : parsed.text; return out; }
  let f = parsed.kind || (field === 'auto' || field === 'nr' ? (parsed.date > todayIso ? 'valid' : 'issued') : field);
  if (out[f] && !out[f === 'issued' ? 'valid' : 'issued']) f = f === 'issued' ? 'valid' : 'issued';
  out[f] = parsed.date;
  return out;
}

/**
 * Uprawnienia pracowników z arkusza MK: { people: { id: { name, perms: {typ: {nr, issued, valid}} } } } – identyfikator jak w Grafiku
 * (wydział + nr ew.); kolumny rozpoznane po nagłówkach z wiersza 3 (data urodzenia nie jest czytana).
 */
export function parsePermsSheet(ws, todayIso) {
  const get = (r, c) => ws.cells.get(colName(c) + r);
  const head = (c) => String((get(3, c) || {}).v ?? '');
  let cName = 0, cNr = 0;
  const cols = [];
  for (let c = 1; c <= ws.maxCol; c++) {
    const hd = head(c).toLowerCase();
    if (!cName && /nazwisko/.test(hd)) cName = c;
    else if (!cNr && /ewid/.test(hd)) cNr = c;
    else { const pc = permColumn(head(c)); if (pc && cName) cols.push([c, ...pc]); }
  }
  if (!cName) throw new Error('Nie rozpoznano arkusza: w wierszu 3 potrzebny jest nagłówek „Nazwisko i Imię”.');
  const people = {};
  for (let r = 4; r <= ws.maxRow; r++) {
    const name = String((get(r, cName) || {}).v ?? '').trim(); if (!name) continue;
    const dept = String((get(r, cName - 1) || {}).v ?? '').trim().toUpperCase(), nr = (get(r, cNr) || {}).v;
    const perms = {};
    for (const [c, key, field] of cols) { const p = parsePermCell(get(r, c)); if (p) perms[key] = mergePermCell(perms[key] || {}, field, p, todayIso); }
    people[personId(dept, nr, r)] = { name, perms };
  }
  return { people, types: [...new Set(cols.map((x) => x[1]))] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Badania lekarskie i BHP – osobna grupa (zawsze widoczna w Uprawnieniach), poziomy ważności terminów
// ---------------------------------------------------------------------------------------------------------------------
/** Badania lekarskie i szkolenie BHP: numer, data wydania, data ważności – stałe typy (nie usuwa się ich w „Kolumny…”). */
export const MED_TYPES = [{ key: 'bad', name: 'Badania lekarskie', med: true }, { key: 'bhp', name: 'Szkolenie BHP', med: true }];
export const isMedKey = (k) => k === 'bad' || k === 'bhp';

const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
/**
 * Poziom terminu ważności (kolor komórki „Ważne do”):
 *  - uprawnienia: 'expired' – minął; 'red' – do 1 miesiąca; 'orange' – do 3 miesięcy; 'green' – dłużej;
 *  - badania lekarskie i BHP ([med]): 'expired' – minął; 'orange' – do 1 miesiąca; '' – dłużej.
 * '' – brak daty.
 */
export function validLevel(iso, todayIso, med = false) {
  if (!ISO.test(String(iso || ''))) return '';
  if (iso < todayIso) return 'expired';
  if (med) return iso <= addMonths(todayIso, 1) ? 'orange' : '';
  if (iso <= addMonths(todayIso, 1)) return 'red';
  if (iso <= addMonths(todayIso, 3)) return 'orange';
  return 'green';
}
/** Kolory poziomów (tło, tekst). */
export const LEVEL_STYLE = { expired: ['#c00000', '#ffffff'], red: ['#ff0000', '#ffffff'], orange: ['#ffc000', '#000000'], green: ['#92d050', '#000000'] };
export const LEVEL_TEXT = { expired: 'termin minął', red: 'mija w ciągu miesiąca', orange: 'mija w ciągu 3 miesięcy', green: 'ważne' };
/** Opis poziomu (badania i BHP: pomarańczowy = do miesiąca). */
export const levelText = (lv, med = false) => (med && lv === 'orange' ? 'mija w ciągu miesiąca' : LEVEL_TEXT[lv] || '');
const RANK = { expired: 3, red: 2, orange: 1 };
/** Najpilniejszy termin osoby (do „⚠ Terminy”): 'expired' > 'red' > 'orange' > ''. [defs] – uprawnienia bez badań i BHP. */
export function personAlert(person, defs, todayIso) {
  let worst = '';
  const all = [...MED_TYPES, ...(defs || []).filter((d) => !isMedKey(d.key))];
  for (const d of all) {
    const lv = validLevel(permValid(permOf(person, d.key), d).iso, todayIso, !!d.med);
    if ((RANK[lv] || 0) > (RANK[worst] || 0)) worst = lv;
  }
  return worst;
}
