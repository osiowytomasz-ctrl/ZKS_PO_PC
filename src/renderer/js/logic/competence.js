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
