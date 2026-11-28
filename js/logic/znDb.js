// Zniszczone (karta ZN) w bazie Firebase – Etap 1 przejścia z arkusza (docs/MIGRACJA_ARKUSZ_DO_BAZY.md).
// W bazie są tylko kolumny WPISYWANE karty ZN: lp (A), nr narzędzia (B), procent (C), kto / gdzie (H), data (I), opis zniszczeń (L), przyczyna (M).
// Kolumny liczone (ƒ) liczy program jak formuły arkusza: opis (D), cena (E), firma (F), oznaczenie (G) – wyszukiwane w PSWT po numerze narzędzia
// (całe PSWT od wiersza 2), data2 = rrrr.mm (J), kwota strat = procent × cena (K). Czyste funkcje – testy: test/zn-db.test.js.
import { parseZn, parseNumber } from './destroyed.js';

/** Nagłówki karty ZN (wiersz 2) – takie same nazwy, po których parseZn rozpoznaje kolumny. */
export const ZN_HEADER = ['lp.', 'Nr narz.', 'procent zniszcz.', 'Opis narzedzia', 'Cena ', 'Firma', 'Oznaczenie', 'Kto gdzie', 'Data', 'data2', 'Kwota strat na narzędziu', 'Opis zniszczeń', 'Przyczyna'];
const p2 = (n) => String(n).padStart(2, '0');
/**
 * Data (ms) → „rrrr-mm-dd”, a gdy wpis ma godzinę (kilka wpisów w arkuszu ją ma) – „rrrr-mm-ddTgg:mm”.
 * [ms] to „ściana zegara” zapisana jako UTC (tak zwraca parseDate), więc czytamy pola UTC – wynik nie zależy od strefy czasowej komputera.
 * Bieżący czas lokalny: isoOf(wallClockMs(new Date())).
 */
export const isoOf = (ms) => {
  if (ms == null) return '';
  const d = new Date(ms), day = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  return d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? `${day}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${d.getUTCSeconds() ? ':' + p2(d.getUTCSeconds()) : ''}` : day;
};
/** Czas lokalny [d] jako „ściana zegara” w UTC (ms) – do isoOf. */
export const wallClockMs = (d = new Date()) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
const plDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] : ''}` : ''; };
const money = (n) => (n == null ? '' : n.toFixed(2).replace('.', ','));
/** Błąd arkusza z komórki PSWT (#N/A, #VALUE!…) – w ZN formuła ma JEŻELI.BŁĄD(…; „”), więc to samo co pusta komórka. */
const cleanErr = (t) => (/^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)/.test(String(t ?? '').trim()) ? '' : String(t ?? '').trim());
const FIELDS_OV = ['opis', 'firma', 'mark', 'cena', 'month', 'loss'];   // kolumny liczone: tylko tu arkusz bywa nadpisany ręcznie (stałe wpisane w komórki z formułą)
export const znId = (lp) => `zn_${String(lp).padStart(5, '0')}`;

/**
 * Wpisy z wartości karty ZN (jak zwraca baseSheet) → wpisy do bazy { lp, code, pct, who, date, damage, cause, [dateText], [ov] }.
 * W bazie są kolumny wpisywane; [lookup] (pswtLookup) służy do wykrycia komórek liczonych, które w arkuszu ktoś nadpisał ręcznie (stała w miejscu formuły):
 * takie wartości zapisujemy w `ov` (np. oznaczenie wpisane jako nazwisko), żeby baza odtwarzała arkusz co do znaku. Gdy komórka jest pusta tylko dlatego, że
 * formuła w arkuszu nie sięga do wiersza PSWT (wyszukiwanie od wiersza 26), nie robimy nadpisania – program szuka od wiersza 2.
 */
export function entriesFromSheet(values, lookup = null) {
  const sheet = parseZn(values), out = [], used = new Set();
  for (const e of sheet) {
    let lp = parseInt(String(e.lp).replace(/\D/g, ''), 10); if (!Number.isFinite(lp)) lp = e.row;
    while (used.has(lp)) lp += 100000;   // zdublowany numer lp w arkuszu – zachowujemy oba wpisy
    used.add(lp);
    const x = { lp, code: e.code, pct: e.pct, who: '', date: isoOf(e.ts)   /* kolumna H („Kto gdzie”) nie jest importowana */, damage: e.damage, cause: e.cause };
    if (!x.date && e.date) x.dateText = e.date;   // data zapisana w nietypowym formacie – zostaje tekstem
    out.push(x);
  }
  if (lookup) {
    const computed = parseZn(computeZnValues(out, lookup)), byLp = new Map(computed.map((c) => [String(parseInt(c.lp, 10)), c]));
    sheet.forEach((e, i) => {
      const x = out[i], c = byLp.get(String(x.lp)); if (!c) return;
      const found = !!(e.opis || e.cena || e.firma);   // w arkuszu formuły wyszukały narzędzie w PSWT
      const ov = {};
      for (const f of FIELDS_OV) {
        const sv = f === 'loss' ? (e.loss == null ? '' : String(e.loss)) : String(e[f] ?? '').trim(), cv = f === 'loss' ? (c.loss == null ? '' : String(c.loss)) : String(c[f] ?? '').trim();
        const same = f === 'cena' || f === 'loss' ? (sv === '' && cv === '') || (sv !== '' && cv !== '' && Math.abs(parseNumber(sv) - parseNumber(cv)) <= 0.01) : sv.toLowerCase() === cv.toLowerCase();
        if (same) continue;
        const zeroLoss = f === 'loss' && !found && Number(sv) === 0;   // 0 w arkuszu, bo formuła nie znalazła ceny
        if (sv !== '' && !zeroLoss) ov[f] = f === 'loss' || f === 'cena' ? parseNumber(sv) : sv;
        else if (sv === '' && found) ov[f] = f === 'loss' || f === 'cena' ? null : '';   // pusta komórka mimo znalezionego narzędzia – ktoś ją wyczyścił
      }
      if (Object.keys(ov).length) x.ov = ov;
    });
  }
  return out;
}

/** Wyszukiwanie w PSWT (migawka z bazy: { headers, rows }): numer narzędzia → { opis, cena, firma, mark }; bez rozróżniania wielkości liter, od wiersza 2 do końca. */
export function pswtLookup(snapshot) {
  const rows = (snapshot && snapshot.rows) || [], map = new Map();
  for (const r of rows) { const k = String((r && r[1]) ?? '').trim().toLowerCase(); if (k && !map.has(k)) map.set(k, r); }   // pierwszy pasujący, jak WYSZUKAJ.PIONOWO
  return (code) => {
    const r = map.get(String(code ?? '').trim().toLowerCase());
    if (!r) return null;
    return { opis: cleanErr(r[2]), cena: parseNumber(cleanErr(r[35])), firma: cleanErr(r[15]), mark: cleanErr(r[14]) };   // C, AJ, P, O
  };
}

/** Wartości w układzie karty ZN (2 wiersze nagłówka + wpisy) z wpisów z bazy; kolumny ƒ policzone z [lookup] (pswtLookup), z nadpisaniami `ov`. Można podać je do parseZn. */
export function computeZnValues(entries, lookup = () => null) {
  const rows = [...(entries || [])].sort((a, b) => a.lp - b.lp).map((e) => {
    const ov = e.ov || {}, has = (f) => Object.prototype.hasOwnProperty.call(ov, f);
    const p = lookup(e.code) || null, cena = has('cena') ? ov.cena : (p ? p.cena : null);
    // jak w arkuszu: K = C × E, a pusta cena („”) daje 0
    const loss = has('loss') ? ov.loss : ((e.pct == null ? 0 : e.pct) / 100) * (cena == null ? 0 : cena);
    const date = e.date ? plDate(e.date) : (e.dateText || '');
    return [String(e.lp), e.code, e.pct == null ? '' : `${Math.round(e.pct * 10) / 10}%`, has('opis') ? ov.opis : (p ? p.opis : ''), money(cena), has('firma') ? ov.firma : (p ? p.firma : ''),
      has('mark') ? ov.mark : (p ? p.mark : ''), e.who || '', date, has('month') ? ov.month : (e.date ? `${e.date.slice(0, 4)}.${e.date.slice(5, 7)}` : ''), money(loss), e.damage || '', e.cause || ''];
  });
  return [['Osiągnięcia w dziedzinie użytkowania narzędzi – Ranking'], ZN_HEADER, ...rows];
}

const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const near = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);
/**
 * Porównanie karty ZN z arkusza z tym, co program liczy z bazy: po numerze lp, każde pole (także liczone). Wynik: { sheet, db, onlySheet, onlyDb, diffs, expected, ok }.
 * `expected` – różnice OCZEKIWANE: w arkuszu kolumny D–G, K są puste (albo K = 0), bo formuły szukają w PSWT od wiersza 26, a program (jak ustalono) – od wiersza 2.
 * `diffs` – pozostałe, nieoczekiwane różnice. ok = brak nieoczekiwanych różnic i brak wpisów tylko po jednej stronie.
 */
export function compareZn(sheetValues, dbValues) {
  const a = parseZn(sheetValues), b = parseZn(dbValues), mb = new Map(b.map((e) => [String(parseInt(e.lp, 10)), e])), seen = new Set(), diffs = [], expected = [], onlySheet = [];
  const blank = (v) => v == null || String(v).trim() === '';
  for (const e of a) {
    const k = String(parseInt(e.lp, 10)), o = mb.get(k);
    if (!o) { onlySheet.push(e.lp); continue; }
    seen.add(k);
    const notFoundInSheet = blank(e.opis) && blank(e.cena) && blank(e.firma);   // formuła arkusza nie znalazła narzędzia w PSWT (wiersze 2–25 poza zakresem)
    const chk = (field, ok, lookupField = false) => {
      if (ok) return;
      (lookupField && notFoundInSheet ? expected : diffs).push({ lp: e.lp, field, sheet: e[field], db: o[field] });
    };
    chk('code', eq(e.code, o.code)); chk('pct', near(e.pct, o.pct, 0.51)); chk('ts', e.ts === o.ts); chk('damage', eq(e.damage, o.damage)); chk('cause', eq(e.cause, o.cause));
    chk('opis', eq(e.opis, o.opis), true); chk('firma', eq(e.firma, o.firma), true); chk('mark', eq(e.mark, o.mark), true); chk('cena', near(parseNumber(e.cena), parseNumber(o.cena), 0.01), true);
    chk('month', eq(e.month, o.month)); chk('loss', near(e.loss ?? 0, o.loss ?? 0, 0.01), true);
  }
  const onlyDb = b.filter((e) => !seen.has(String(parseInt(e.lp, 10)))).map((e) => e.lp);
  return { sheet: a.length, db: b.length, onlySheet, onlyDb, diffs, expected, ok: !onlySheet.length && !onlyDb.length && !diffs.length };
}
