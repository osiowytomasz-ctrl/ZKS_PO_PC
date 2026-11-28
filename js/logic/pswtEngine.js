// Silnik stanów PSWT – Etap 1 przejścia z arkusza do bazy (docs/MIGRACJA_ARKUSZ_DO_BAZY.md). Liczy kolumny ƒ karty PSWT z danych w bazie, dokładnie jak formuły arkusza:
//   AS zużyto, AT dostawy, AQ stan, AR stan − zapas, AO kup, AL majątek, AM wystąpienia, Q status / lokalizacja, AH długość wg symbolu FRE, AI opis oprzyrządowania z komponentów.
// W bazie PSWT są kolumny wpisywane (A…AU bez liczonych); wartości mieszane (ƒ? – C, F–J, O, AJ) są zapisane jako wyniki z arkusza. Warianty formuł Q i AH (dwa w arkuszu)
// zapisują flagi z importu (qv: 1 | 2, ah95). Czyste funkcje – testy: test/pswt-engine.test.js.
import { parseNumber } from './destroyed.js';
import { CUT_LETTERS, ACC_LETTERS } from './pswtLayout.js';

export const COMPUTED = ['Q', 'AH', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT'];
const lower = (s) => String(s ?? '').trim().toLowerCase();
const num = (x) => parseNumber(x);
const n0 = (x) => (x == null || x === '' || Number.isNaN(x) ? 0 : x);
const FRE_LEN = { FRE016: 32, FRE022: 40, FRE027: 50, FRE032: 63, FRE040: 108, FRE050: 150, FRE060: 150 };
const NARZ = new Set(['narzf', 'narzt', 'pom', 'narzr']);
const ZW = new Set(['fre', 'wyt', 'opr']);

/** Mapa symbol (małe litery) → suma ilości z wpisów: rows = [{ code, qty }]. */
export function sumByCode(rows, code = (r) => r.code, qty = (r) => r.qty) {
  const m = new Map();
  for (const r of rows || []) { const k = lower(code(r)); if (!k) continue; m.set(k, (m.get(k) || 0) + n0(typeof qty(r) === 'number' ? qty(r) : num(qty(r)))); }
  return m;
}
/** Zużycie z ZN: jak WYSZUKAJ.PIONOWO(B; ZN!B3:C; 2) – procent PIERWSZEGO wpisu karty o danym numerze narzędzia (jako ułamek: 100% = 1). entries: wpisy ZN z bazy { lp, code, pct }. */
export function znFirst(entries) {
  const m = new Map();
  for (const e of [...(entries || [])].sort((a, b) => a.lp - b.lp)) { const k = lower(e.code); if (k && !m.has(k)) m.set(k, e.pct == null ? 0 : e.pct / 100); }
  return m;
}
/** Ostatnia lokalizacja z karty N: wartości z baseSheet('N') (A data/godzina, B kod, C lokalizacja) – wpis z największą datą (jak MAXIFS + WYSZUKAJ.PIONOWO). */
export function latestLocation(nValues, parseTs) {
  const best = new Map();
  (nValues || []).slice(1).forEach((r, i) => {
    const k = lower(r && r[1]); if (!k) return;
    const ts = parseTs(r[0]); if (ts == null) return;
    const cur = best.get(k);
    if (!cur || ts > cur.ts || (ts === cur.ts && i > cur.i)) best.set(k, { ts, i, loc: String(r[2] ?? '') });
  });
  return new Map([...best].map(([k, v]) => [k, v.loc]));
}

// TEKST(n; "00.") w arkuszu z polskimi ustawieniami: kropka formatu daje przecinek („14,” – tak jest w karcie)
/** Stała wpisana w arkuszu w miejsce formuły (import zapisuje ją w e.ov[litera] jako tekst jak w komórce): wynik kolumny = ta wartość, jak w arkuszu. */
const applyOv = (e, r, l) => { if (e.ov && l in e.ov) { const t = String(e.ov[l] ?? ''); r[l] = l === 'Q' || l === 'AI' ? t : t.trim() === '' ? '' : (num(t) ?? t); } };
const textNum = (n) => (n === '' || n == null ? '' : `${n < 0 ? '-' : ''}${String(Math.round(Math.abs(n))).padStart(2, '0')},`);

/**
 * Kolumny liczone dla wszystkich wpisów PSWT: entries = [{ n, v: { A…AU: tekst }, qv?, ah95? }], ctx = { zp, zwg, zn, zakupy, zakupyAr, loc } (mapy symbol → liczba / tekst).
 * Wynik: Map n → { AS, AT, AQ, AR, AO, AL, AM, Q, AH, AI } (liczby albo tekst; '' = puste).
 */
export function computePswt(entries, ctx) {
  const rows = entries || [], out = new Map();
  // zliczanie wystąpień komponentów (AM): COUNTIF po osp1–osp10 i po płytkach ply1–ply10 w całej karcie
  const cOsp = new Map(), cPly = new Map();
  for (const e of rows) {
    for (const c of ACC_LETTERS) { const k = lower((e.v || {})[c]); if (k) cOsp.set(k, (cOsp.get(k) || 0) + 1); }   // osp1–osp10
    for (const c of CUT_LETTERS) { const k = lower((e.v || {})[c]); if (k) cPly.set(k, (cPly.get(k) || 0) + 1); }   // ply1–ply10
  }
  const byB = new Map(), byC = new Map();
  for (const e of rows) { const b = lower((e.v || {}).B), c = lower((e.v || {}).C); if (b && !byB.has(b)) byB.set(b, e); if (c && !byC.has(c)) byC.set(c, e); }
  // WYSZUKAJ.PIONOWO w arkuszu rozumie znaki wieloznaczne: „?” = dowolny jeden znak, „*” = dowolny ciąg, „~” – cytuje; pierwszy pasujący wiersz wg B, potem wg C
  const wild = (x) => /[*?]/.test(x);
  const wildRe = (x) => new RegExp('^' + [...x].map((ch, i, a) => (ch === '~' && i + 1 < a.length ? null : ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).filter((t) => t !== null).join('') + '$', 'i');
  const findPart = (x) => {
    const k = lower(x);
    if (!wild(k)) return byB.get(k) || byC.get(k);
    const re = wildRe(k);
    return rows.find((e) => re.test(String((e.v || {}).B ?? '').trim())) || rows.find((e) => re.test(String((e.v || {}).C ?? '').trim()));
  };
  // pierwszy przebieg: AS, AT, AQ, AR, AO, AL, AM, Q (nie zależą od innych wierszy poza zbiorczymi mapami)
  for (const e of rows) {
    const v = e.v || {}, B = String(v.B ?? '').trim(), key = lower(B), A = num(v.A), AP = n0(num(v.AP)), AN = n0(num(v.AN)), AJ = n0(num(v.AJ)), AU = n0(num(v.AU));
    const r = {}, ov = (l) => applyOv(e, r, l);
    const a = A == null ? null : A;
    if (a != null && a > 0 && a < 1000) r.AS = n0(ctx.zp.get(key));
    else if (a != null && a > 1999 && a < 4000) r.AS = n0(ctx.zwg.get(key));
    else r.AS = n0(ctx.zn.get(key));
    ov('AS');
    r.AT = n0(ctx.zakupy.get(key)) + n0(ctx.zakupyAr.get(key)) + AU; ov('AT');
    r.AQ = B === '' ? '' : n0(r.AT) - n0(r.AS); ov('AQ');
    r.AR = n0(r.AQ) - AP; ov('AR');
    r.AO = AN > n0(r.AQ) ? AN - n0(r.AQ) : 0; ov('AO');
    r.AL = (typeof e.aj === 'number' ? e.aj : AJ) * n0(r.AQ); ov('AL');   // cena w pełnej precyzji (e.aj), gdy import ją dostarczył – wyświetlana jest zaokrąglona
    const A0 = a == null ? 0 : a;
    if (A0 >= 400 && A0 < 999) r.AM = cOsp.get(key) || 0;
    else if (A0 >= 10000 && A0 < 10200) r.AM = cOsp.get(lower(v.C)) || 0;
    else if (lower(v.U) === 'insert' && A0 < 500) r.AM = cPly.get(key) || 0;
    else r.AM = '';
    ov('AM');
    // status / lokalizacja (Q): dwa warianty formuły – drugi dodatkowo wymaga A ≥ 1000 przy „Złom”
    const scrap = NARZ.has(lower(v.T)) && r.AS === 1 && (e.qv === 2 ? A0 >= 1000 : true);
    if (scrap) r.Q = 'Złom';
    else if (AP === 1) r.Q = 'zapas';
    else if (A0 < 1000 && B !== '') r.Q = 'FastService';
    else r.Q = ctx.loc.get(key) ?? '';
    ov('Q');
    out.set(e.n, r);
  }
  // drugi przebieg: AH (długość wg symbolu FRE) i AI (opis oprzyrządowania z komponentów – potrzebuje AQ innych wierszy)
  for (const e of rows) {
    const v = e.v || {}, r = out.get(e.n), F = num(v.F), len = FRE_LEN[String(v.M ?? '').trim()] ?? '';
    // w arkuszu tekst jest „większy” od liczby, więc przy symbolu spoza tabeli wynikiem jest Φ (F)
    r.AH = F == null ? '' : (len === '' || len >= F ? F * (e.ah95 ? 0.95 : 1) : len); applyOv(e, r, 'AH');
    if (ZW.has(lower(v.D)) && r.Q !== 'Złom') {
      let s = '', failed = false, miss = '';
      for (const c of ['AC', 'AD', 'AE', 'AF', 'AG']) {
        const x = String(v[c] ?? '').trim(); if (x === '') continue;
        const hit = findPart(x);
        if (!hit) { failed = true; miss = `${c}=„${x}”`; break; }
        s += textNum(out.get(hit.n).AQ);
      }
      r.AI = failed ? '#N/A' : s; if (failed) r.aiMiss = miss;   // którego komponentu nie znaleziono (diagnostyka porównania)
    } else r.AI = '';
    applyOv(e, r, 'AI');
  }
  return out;
}

/** Kontekst dla computePswt z rejestrów w bazie: zp, zwg ({ code, qty }), zn (wpisy ZN), zakupy i zakupyAr (wpisy { v: { C, D } }), nValues (karta N z arkusza), parseTs. */
export function buildContext({ zp, zwg, zn, zakupy, zakupyAr, nValues, parseTs }) {
  const sumZ = (list) => sumByCode(list, (e) => (e.v || {}).C, (e) => (e.v || {}).D);
  return { zp: sumByCode(zp), zwg: sumByCode(zwg), zn: znFirst(zn), zakupy: sumZ(zakupy), zakupyAr: sumZ(zakupyAr), loc: latestLocation(nValues, parseTs) };
}
