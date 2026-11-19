// Mistrz PO – model arkusza „Mistrz_PO” w programie. W bazie są tylko dane WPISYWANE (kolumny bez formuł);
// kolumny liczone w arkuszu (formuły) liczy program – funkcje compute* odpowiadają formułom arkusza 1:1 (opis przy każdej kolumnie).
// Wiersz w programie: { row: numer wiersza w arkuszu, v: { A: …, B: … } } – tylko kolumny wpisywane; wynik compute*: { A…, K…, … }.

/** Zakładki arkusza obsługiwane przez moduł (kolejność jak w pliku). input – kolumny wpisywane; calc – kolumny liczone (tytuł, opis formuły). */
export const SHEETS = [
  { key: 'ops', name: 'Rejestr operacji', title: 'Rejestr operacji z przewodnika', first: 3, input: 'ABCDEFGHIJ',
    head: { A: 'Data', B: 'Godz.', C: 'Komis', D: 'Ktk', E: 'Oper', F: 'Klient', G: 'nr rysunku', H: 'Operator', I: 'Status', J: 'Uwagi' },
    calc: { K: ['status g', 'Stan operacji (komis, Ktk, oper): Koniec > W toku > Start; pusty dla „Usunięta”'],
      L: ['zak. oper.', 'Dla oper. 10 ze statusem Koniec: liczba wpisów „Koniec” dla komisu i Ktk'],
      M: ['postęp dok.', 'Postęp z Rejestru dokumentacji (komis + Ktk) albo „Brak dokumentu”'],
      O: ['klucz', 'Komis + Ktk'],
      P: ['status dok.', 'Status z Rejestru dokumentacji (zrobione / ilość operacji)'] } },
  { key: 'docs', name: 'Rejestr dokumentacji', title: 'Rejestr dokumentacji', first: 3, input: 'ABCDEFGHIJ',
    head: { A: 'Data', B: 'godz', C: 'komis', D: 'nr dok', E: 'rodz', F: 'nazwa', G: 'rys', H: 'id', I: 'ilość oper', J: 'rejestrujący' },
    calc: { K: ['Status', 'Zakończone operacje / ilość operacji (z Rejestru operacji, a gdy brak – z Archiwum: „Ar :”)'],
      L: ['klucz', 'Komis + nr dok'],
      M: ['Stat2', 'Postęp: zakończone operacje / ilość operacji'],
      N: ['start obróbki', 'Data i godzina „Start” operacji 10'],
      O: ['czas [h]', 'Koniec obróbki − start obróbki, w godzinach'],
      P: ['Koniec obróbki', 'Data i godzina „Koniec” ostatniej operacji (ilość oper × 10)'] } },
  { key: 'dreg', name: 'Rejestr detali', title: 'Rejestr detali', first: 3, input: 'ABCDEFGH',
    head: { A: 'Data', B: 'G.', C: 'Komis', D: 'nr rysunku', E: 'nr detalu', F: 'kpl.', G: 'szt', H: 'Operator' },
    calc: { I: ['Progres', 'zrobione / do zrobienia'],
      J: ['Do zrobienia', 'Suma „szt x kpl” z Listy detali (nr rysunku, nr detalu, kpl.)'],
      K: ['zrobione', 'Suma „szt” w Rejestrze detali (komis, nr rysunku, nr detalu, kpl.)'] } },
  { key: 'dlist', name: 'Lista detali', title: 'Detale', first: 3, input: 'ABCDEFGMNO',
    head: { A: 'lp.', B: 'Komis (xx/yyy)', C: 'Nazwa elementu', D: 'nr rysunku', E: 'nr poz.', F: 'kpl/partia', G: 'szt x kpl', M: 'data+kolor rozp. druku', N: 'potw. wydrukowania', O: 'Uwagi' },
    calc: { H: ['qr-code', 'Kod QR detalu (gdy wszystkie pola B–G są wypełnione)'],
      J: ['klucz', 'nr rysunku + nr poz.'],
      K: ['szt', '= szt x kpl'],
      L: ['postęp', 'Suma „szt” z Rejestru detali (komis, nr rysunku, nr poz., kpl) / szt x kpl'] } },
  { key: 'zkom', name: 'Z.kom', title: 'Komisy', first: 2, input: 'ABCDEFGHI',
    head: { A: 'Status', B: 'Komis', C: 'Uwagi kierownik/mistrza/techno', D: 'Stanowisko', E: 'czy w harmonogramie', F: 'Klient', G: 'Temat', H: 'Termin', I: 'Status' },
    calc: {}, aCalc: true },
  { key: 'opsArch', name: 'Archiwum operacji', title: 'Archiwum operacji', first: 3, input: 'ABCDEFGHIJ', archive: true,
    head: { A: 'Data', B: 'Godz.', C: 'Komis', D: 'Ktk', E: 'Oper', F: 'Klient', G: 'nr rysunku', H: 'Operator', I: 'Status', J: 'Uwagi' },
    calc: { K: ['liczba oper', 'Dla oper. 10 ze statusem Koniec: liczba wpisów „Koniec” dla komisu i Ktk'] } },
  { key: 'docsArch', name: 'Ar. dok', title: 'Archiwum dokumentacji', first: 3, input: 'ABCDEFGHIJ', archive: true,
    head: { A: 'Data', B: 'godz', C: 'komis', D: 'nr dok', E: 'rodz', F: 'nazwa', G: 'rys', H: 'id', I: 'ilość oper', J: 'rejestrujący' },
    calc: { K: ['Status', 'jak w Rejestrze dokumentacji'], L: ['klucz', 'Komis + nr dok'], M: ['Stat2', 'Postęp'], N: ['start obróbki', 'Start operacji 10'],
      O: ['czas [h]', 'Koniec − start, w godzinach'], P: ['Koniec obróbki', 'Koniec ostatniej operacji'] } },
  { key: 'dlistArch', name: 'Archiwum Lista detali', title: 'Lista detali – archiwum', first: 3, input: 'ABCDEFGMNO', archive: true,
    head: { A: 'lp.', B: 'Komis (xx/yyy)', C: 'Nazwa elementu', D: 'nr rysunku', E: 'nr poz.', F: 'kpl/partia', G: 'szt x kpl', M: 'data+kolor rozp. druku', N: 'potw. wydrukowania', O: 'Uwagi' },
    calc: { H: ['qr-code', 'Kod QR detalu'], J: ['klucz', 'nr rysunku + nr poz.'], K: ['szt', '= szt x kpl'], L: ['postęp', 'jak w Liście detali'] } },
];
export const sheetByKey = (k) => SHEETS.find((s) => s.key === k);

/** Kolumny zakładki w kolejności liter (wpisywane i liczone) – jak w pliku. */
export function sheetColumns(sh) {
  const letters = [...new Set([...sh.input, ...Object.keys(sh.calc)])].sort((a, b) => colNum(a) - colNum(b));
  return letters.map((L) => (sh.calc[L] ? { key: L, title: sh.calc[L][0], full: `${L}: ${sh.calc[L][1]} (liczy program)`, calc: true } : { key: L, title: sh.head[L] || L, full: `${L}: ${sh.head[L] || ''} (wpisywane)` }));
}
export const colNum = (L) => { let n = 0; for (const ch of L) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
export const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// ---------- wartości (porównania jak w Arkuszach: tekst bez rozróżniania wielkości liter, liczba = tekst liczby) ----------
const s = (v) => (v === null || v === undefined ? '' : String(v));
/** Klucz porównania: '10' i 10 są równe, 'Koniec' = 'koniec'. */
export const eq = (v) => s(v).trim().toLowerCase();
export const num = (v) => { if (typeof v === 'number') return v; const t = s(v).trim().replace(',', '.'); return t === '' ? NaN : Number(t); };
const empty = (v) => s(v).trim() === '';

/** Data i godzina z kolumn A (rrrr-mm-dd) i B (gg:mm) → milisekundy UTC (do różnicy w godzinach) albo null. */
export function stamp(a, b) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(a)); if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s(b)) || /\s(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s(a));
  return Date.UTC(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0, t && t[3] ? +t[3] : 0);
}
export const fmtStamp = (ms) => { if (ms === null || ms === undefined || ms === '') return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };

/** Wartość do wyświetlenia: daty rrrr-mm-dd → dd.mm.rrrr; liczby – z przecinkiem. */
export function display(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ',');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2})(?::\d{2})?)?$/.exec(v);
  if (m) return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] : ''}`;
  const t = /^(\d{2}:\d{2}):\d{2}$/.exec(v);
  return t ? t[1] : String(v);
}
export const pct = (x) => (x === '' || x === null || x === undefined || !Number.isFinite(x) ? '' : `${Math.round(x * 100)}%`);

// ---------- obliczenia ----------
const key2 = (...v) => v.map(eq).join('\u0001');
/**
 * Luźny klucz numeru detalu. Arkusz Google zamienia wpisy skanera na daty: „2.1.4” → 2002-01-04 (r.m.d), „06-01” → 06-01 bieżącego
 * roku (m-d), a „2,3” na liczbę 2.3, „0001634638” na 1634638 – mimo to formuły łączą je z Listą detali. Tu tak samo: data i taki tekst dają klucz „miesiąc-dzień”.
 */
export function looseKey(v) {
  const t = eq(v), p2 = (x) => String(+x).padStart(2, '0');
  const md = (m, d) => (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 ? `md:${p2(m)}-${p2(d)}` : null);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return md(m[2], m[3]) || t;
  m = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(t);
  if (m) return md(m[2], m[3]) || t;
  m = /^(\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return md(m[1], m[2]) || t;
  // liczba zapisana jako tekst („0001634638”, „2,3”) = ta sama liczba (SUMIFS w arkuszu porównuje liczbowo)
  const n = t.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(n) && n.length < 16 ? String(Number(n)) : t;
}
const dkey = (...v) => v.map(looseKey).join('\u0001');

/** Rejestr operacji (oraz Archiwum operacji – kolumna K jak L). [docsCalc] – wyniki computeDocs (kolumny K, M) do M i P. */
export function computeOps(rows, docsCalc = [], archive = false) {
  const koniec = new Map(), state = new Map();
  for (const { v } of rows) {
    const st = eq(v.I);
    if (st === 'koniec') koniec.set(key2(v.C, v.D), (koniec.get(key2(v.C, v.D)) || 0) + 1);
    const k3 = key2(v.C, v.D, v.E), cur = state.get(k3) || 0;
    const rank = st === 'koniec' ? 3 : st === 'w toku' ? 2 : st === 'start' ? 1 : 0;
    if (rank > cur) state.set(k3, rank);
  }
  const docIdx = new Map();
  for (const d of docsCalc) { const k = eq(d.L); if (k && !docIdx.has(k)) docIdx.set(k, d); }
  return rows.map(({ v }) => {
    const L = num(v.E) === 10 && eq(v.I) === 'koniec' ? koniec.get(key2(v.C, v.D)) || 0 : (archive ? '' : 0);
    if (archive) return { ...v, K: L };
    const K = eq(v.I) === 'usunięta' ? '' : ['', 'Start', 'W toku', 'Koniec'][state.get(key2(v.C, v.D, v.E)) || 0];
    const O = s(v.C) + s(v.D), d = docIdx.get(eq(O));
    return { ...v, K, L, M: d ? d.M : (empty(v.C) ? '' : 'Brak dokumentu'), O, P: d ? d.K : '' };
  });
}

/** Rejestr dokumentacji (i Ar. dok): K status „x / ilość”, L klucz, M postęp, N start, O godziny, P koniec – z operacji i archiwum operacji. */
export function computeDocs(rows, ops, opsArch) {
  const index = (list, isArch) => {
    const done = new Map(), start = new Map(), end = new Map(), cnt = new Map();
    for (const { v } of list) if (eq(v.I) === 'koniec') cnt.set(key2(v.C, v.D), (cnt.get(key2(v.C, v.D)) || 0) + 1);
    for (const { v } of list) {
      const k = key2(v.C, v.D), e = num(v.E), st = eq(v.I);
      if (e === 10 && st === 'koniec') done.set(k, [...(done.get(k) || []), cnt.get(k) || 0]);   // FILTER: wszystkie pasujące
      if (e === 10 && st === 'start' && !start.has(k)) start.set(k, stamp(v.A, v.B));
      if (st === 'koniec') { const ek = k + '\u0001' + e; if (!end.has(ek)) end.set(ek, stamp(v.A, v.B)); }
    }
    return { done, start, end, isArch };
  };
  const a = index(ops || []), b = index(opsArch || []);
  return rows.map(({ v }) => {
    const k = key2(v.C, v.D), L = s(v.C) + s(v.D), ok = !empty(v.C) && !empty(v.D) && !empty(v.I), n = num(v.I);
    let K = '', M = '';
    if (ok) {
      // jak CONCATENATE(FILTER(…)): kilka pasujących wpisów łączy się w jeden tekst; postęp z pierwszego
      if (a.done.has(k)) { K = `${a.done.get(k).join('')} / ${s(v.I)}`; M = Number.isFinite(n) && n ? a.done.get(k)[0] / n : 0; }
      else if (b.done.has(k)) { K = `Ar :${b.done.get(k).join('')} / ${s(v.I)}`; M = Number.isFinite(n) && n ? b.done.get(k)[0] / n : 0; }
      else { K = `0 / ${s(v.I)}`; M = 0; }
    }
    const N = a.start.has(k) ? a.start.get(k) : b.start.has(k) ? b.start.get(k) : '';
    const ek = k + '\u0001' + (Number.isFinite(n) ? n * 10 : NaN);
    const P = a.end.has(ek) ? a.end.get(ek) : b.end.has(ek) ? b.end.get(ek) : '';
    const O = P === '' || P === null || N === '' || N === null ? '' : (P - N) / 3600000;
    return { ...v, K, L, M, N, O, P };
  });
}

/** Rejestr detali: J – do zrobienia (Lista detali: suma G wg D, E, F), K – zrobione (suma G wg C, D, E, F), I – K / J. */
export function computeDetailReg(rows, list) {
  const todo = new Map(), done = new Map();
  for (const { v } of list || []) { const k = dkey(v.D, v.E, v.F), g = num(v.G); if (Number.isFinite(g)) todo.set(k, (todo.get(k) || 0) + g); }
  for (const { v } of rows) { const k = dkey(v.C, v.D, v.E, v.F), g = num(v.G); if (Number.isFinite(g)) done.set(k, (done.get(k) || 0) + g); }
  return rows.map(({ v }) => {
    const J = empty(v.D) ? '' : todo.get(dkey(v.D, v.E, v.F)) || 0;
    const K = empty(v.C) ? '' : done.get(dkey(v.C, v.D, v.E, v.F)) || 0;
    const I = typeof J === 'number' && typeof K === 'number' && J ? K / J : '';
    return { ...v, I, J, K };
  });
}

/** Tekst kodu QR detalu (jak w formule kolumny H Listy detali): *komis*$rys$⍵poz⍵^kpl^@szt@. */
export const detailQr = (v) => ('BCDEFG'.split('').every((c) => !empty(v[c])) ? `*${s(v.B)}*$${s(v.D)}$⍵${s(v.E)}⍵^${s(v.F)}^@${s(v.G)}@` : '');

/** Lista detali (i archiwum): H – kod QR, J – klucz, K = G, L – zrobione z Rejestru detali / G. */
export function computeDetailList(rows, reg) {
  const done = new Map();
  for (const { v } of reg || []) { const k = dkey(v.C, v.D, v.E, v.F), g = num(v.G); if (Number.isFinite(g)) done.set(k, (done.get(k) || 0) + g); }
  return rows.map(({ v }) => {
    const g = num(v.G), sum = done.get(dkey(v.B, v.D, v.E, v.F)) || 0;
    const L = !empty(v.C) && Number.isFinite(g) && g ? sum / g : 0;
    return { ...v, H: detailQr(v), J: s(v.D) + s(v.E), K: v.G ?? '', L };
  });
}

/** Z.kom: A – wpisane (np. „zak.”) albo „wstrzymany”, gdy status (I) zaczyna się od „wstrz”. */
export const computeZkom = (rows) => rows.map(({ v }) => ({ ...v, A: !empty(v.A) ? v.A : eq(v.I).slice(0, 5) === 'wstrz' ? 'wstrzymany' : '' }));

/** Wszystkie zakładki naraz: { key: [wiersz z kolumnami liczonymi] } (kolejność zależności jak w arkuszu). */
export function computeAll(data) {
  const r = (k) => data[k] || [];
  const docs = computeDocs(r('docs'), r('ops'), r('opsArch'));
  return {
    docs, docsArch: computeDocs(r('docsArch'), r('ops'), r('opsArch')),
    ops: computeOps(r('ops'), docs), opsArch: computeOps(r('opsArch'), [], true),
    dreg: computeDetailReg(r('dreg'), r('dlist')),
    dlist: computeDetailList(r('dlist'), r('dreg')), dlistArch: computeDetailList(r('dlistArch'), r('dreg')),
    zkom: computeZkom(r('zkom')),
  };
}

/** Kolumny w procentach / jako data-godzina (do wyświetlenia). */
export const PCT_COLS = { ops: ['M'], docs: ['M'], docsArch: ['M'], dreg: ['I'], dlist: ['L'], dlistArch: ['L'] };
export const STAMP_COLS = { docs: ['N', 'P'], docsArch: ['N', 'P'] };

/** Tekst komórki do pokazania (procenty, data-godzina, godziny). */
export function cellText(sheetKey, col, value) {
  if ((PCT_COLS[sheetKey] || []).includes(col)) return typeof value === 'number' ? pct(value) : display(value);
  if ((STAMP_COLS[sheetKey] || []).includes(col)) return typeof value === 'number' ? fmtStamp(value) : '';
  if ((sheetKey === 'docs' || sheetKey === 'docsArch') && col === 'O') return typeof value === 'number' ? (Math.round(value * 10) / 10).toString().replace('.', ',') : '';
  return display(value);
}

// ---------- import ----------
/** Z.kom kolumna A: „wstrzymany” to wynik formuły – nie zapisujemy go do bazy (liczy program). */
const dropCalcInput = (sheetKey, col, v) => (sheetKey === 'zkom' && col === 'A' && eq(v) === 'wstrzymany' ? '' : v);

/**
 * Wiersze zakładki z siatki wartości ([[A, B, …], …] od wiersza 1) → [{row, v}] tylko z kolumnami wpisywanymi; puste wiersze pomijane.
 * Wartości już znormalizowane (daty rrrr-mm-dd, godziny gg:mm).
 */
export function rowsFromGrid(sh, grid) {
  const out = [];
  for (let r = sh.first - 1; r < grid.length; r++) {
    const line = grid[r] || [], v = {};
    let any = false;
    for (const L of sh.input) {
      let x = dropCalcInput(sh.key, L, line[colNum(L) - 1]);
      if (typeof x === 'string') x = x.replace(/\s+$/, '');
      if (x === null || x === undefined || x === '') continue;
      v[L] = x; any = true;
    }
    if (any) out.push({ row: r + 1, v });
  }
  return out;
}

/** Komórka z pliku .xlsx ({v, date}) → wartość do bazy: data rrrr-mm-dd, godzina gg:mm, data z godziną „rrrr-mm-dd gg:mm”. */
export function xlsxValue(c) {
  if (!c || c.v === null || c.v === undefined) return '';
  if (!c.date || typeof c.v !== 'number') return c.v;
  const n = c.v, days = Math.floor(n + 1e-9), secs = Math.min(86399, Math.round((n - days) * 86400));
  const p = (x) => String(x).padStart(2, '0');
  const hm = `${p(Math.floor(secs / 3600))}:${p(Math.floor(secs / 60) % 60)}${secs % 60 ? ':' + p(secs % 60) : ''}`;
  if (days === 0) return hm;
  const iso = new Date(Math.round((days - 25569) * 86400000)).toISOString().slice(0, 10);
  return secs ? `${iso} ${hm}` : iso;
}

/** Arkusze z readXlsx → { key: [{row, v}] } dla zakładek modułu (brakujące zakładki pomijane). */
export function dataFromXlsx(sheets) {
  const out = {};
  for (const sh of SHEETS) {
    const ws = sheets.find((x) => x.name === sh.name);
    if (!ws) continue;
    const grid = [];
    for (const [ref, c] of ws.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) continue;
      const r = Number(m[2]) - 1, col = colNum(m[1]) - 1;
      if (!sh.input.includes(m[1])) continue;
      (grid[r] = grid[r] || [])[col] = xlsxValue(c);
    }
    for (let i = 0; i < grid.length; i++) grid[i] = grid[i] || [];
    out[sh.key] = rowsFromGrid(sh, grid);
  }
  return out;
}

// ---------- kolory (formatowanie warunkowe arkusza) ----------
const C = { start: ['#980000', '#ffffff'], toku: ['#f1c232', ''], koniec: ['#6aa84f', ''], ar: ['#666666', '#ffffff'], full: ['#38761d', '#ffffff'],
  g75: ['#93c47d', '#000000'], y50: ['#ffff00', ''], o25: ['#ff9900', ''], red: ['#ff0000', '#ffffff'], mint: ['#b7e1cd', ''], magenta: ['#ff00ff', ''], amber: ['#f1c232', ''] };

/**
 * Kolor komórki jak w formatowaniu warunkowym arkusza: [tło, czcionka] albo null.
 * [r] – wiersz z kolumnami liczonymi, [next] – następny wiersz w kolejności arkusza (luka w numerach operacji), [col] – litera kolumny.
 */
export function cellColor(sheetKey, r, col, next = null) {
  const n = colNum(col), up = (L) => n <= colNum(L);
  const gap = next && Number.isFinite(num(r.E)) && Number.isFinite(num(next.E)) && num(r.E) + 10 < num(next.E) && eq(r.D) === eq(next.D);
  if (sheetKey === 'ops') {
    if (col === 'E' && gap) return C.magenta;
    if (col === 'L' && r.L !== '' && r.L !== undefined) return C.mint;
    if (up('K')) return eq(r.K) === 'start' ? C.start : eq(r.K) === 'w toku' ? C.toku : eq(r.K) === 'koniec' ? C.koniec : null;
    return null;
  }
  if (sheetKey === 'opsArch') return col === 'E' && gap ? C.red : null;
  if (sheetKey === 'docs' || sheetKey === 'docsArch') {
    if (!up('M') || r.M === '' || r.M === undefined) return null;
    if (s(r.K).slice(0, 2) === 'Ar') return C.ar;
    return r.M === 1 ? C.full : r.M > 0.75 ? C.g75 : r.M > 0.5 ? C.y50 : r.M >= 0.25 ? C.o25 : r.M >= 0 && !empty(r.C) ? C.red : null;
  }
  if (sheetKey === 'dreg') {
    if (!up('K') || r.J === '' || r.J === undefined || !r.J) return null;
    const x = r.K / r.J;
    return x === 1 ? C.g75 : x > 0.75 ? C.amber : x > 0 ? C.red : null;
  }
  if (sheetKey === 'dlist' || sheetKey === 'dlistArch') {
    if (col === 'E' && !empty(r.B) && !empty(r.C) && !empty(r.D) && empty(r.E)) return C.red;
    if (!up('L')) return null;
    return r.L === 1 ? C.g75 : r.L > 0 && !empty(r.B) ? C.red : null;
  }
  return null;
}
