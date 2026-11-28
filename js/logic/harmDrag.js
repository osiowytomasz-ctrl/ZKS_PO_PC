// Przesuwanie operacji na wykresie (przeciągnij i upuść). Operacja nie dostaje ręcznej daty – zmienia miejsce w kolejce swojego stanowiska,
// a zależności (Z1–Z4) przepinają się same; start i koniec dalej liczy silnik (poprzednicy, kolejność suboperacji, godziny z grafiku).
//
// Kolejka stanowiska = zależności między operacjami tego samego stanowiska (np. 2Un: 110 → 1 → 202 → 203). Zależności od innych stanowisk
// (technologiczne, np. detal po toczeniu) zostają bez zmian. Przesunięcie operacji X na chwilę T:
//  1. X wychodzi z kolejki: kto na tym stanowisku czekał na X, czeka teraz na poprzedników X z kolejki (łańcuch się nie rwie);
//  2. X wchodzi za P – operację stanowiska z najpóźniejszym startem nie późniejszym niż T; następcy P na stanowisku czekają teraz na X;
//     upuszczona przed wszystkimi – X staje się pierwsza (początki kolejki czekają na X), a gdy nie ma żadnego poprzednika – start ręczny = T;
//  3. operacja z ręcznym startem (bez końca) dostaje nowy start ręczny T (zaokrąglony do pełnej godziny);
//  4. zbędne zależności (wynikające z liter suboperacji) są usuwane; cykl, ponad 4 zależności albo błąd powiązania – przesunięcie odrzucone.
// W pionie (upuszczenie na wierszu operacji A): górna połowa wiersza – przed A, dolna – za A, w kolejce stanowiska A (inne stanowisko = zmiana stanowiska).
// Zablokowane: operacje z ręcznym startem i ręcznym końcem (nie przesuwają się i nie są przepinane), zakończone, węzły złożone z suboperacji.
// Ten sam algorytm ma Android (harmfb/HarmDrag.kt).
import { subParent, structurallyBefore, predError, lpCompare, isAncestor } from './harmModel.js';
import { computeSchedule } from './schedule.js';

export const MAX_PREDS = 4;
const HOUR_MS = 3600000;

/** Operacja z ręcznym startem i ręcznym końcem – stoi w miejscu (znak zakazu podczas przesuwania). */
export const isLocked = (op) => !!op && op.startManual != null && op.endManual != null;
const isDone = (op) => String((op && op.status) || '').trim().toLowerCase() === 'zak.';

/** Stanowisko operacji (puste dziedziczy się po rodzicu). */
export function effStation(ops, lp) {
  for (let x = String(lp); x; x = subParent(x)) { const o = ops[x]; if (!o) return ''; if (String(o.station || '').trim()) return String(o.station).trim(); }
  return '';
}

const parents = (ops) => { const s = new Set(); for (const lp of Object.keys(ops)) { const p = subParent(lp); if (p && ops[p]) s.add(p); } return s; };
const chopped = (ops, kids, lp) => kids.has(lp) && !(ops[lp].hours > 0);

/** Czy operację można przeciągnąć: {ok} albo {ok:false, reason}. */
export function canDrag(ops, lp, kids = parents(ops)) {
  const op = ops[lp];
  if (!op) return { ok: false, reason: 'Brak operacji' };
  if (isLocked(op)) return { ok: false, reason: 'Ręczny start i ręczny koniec – operacja zablokowana' };
  if (isDone(op)) return { ok: false, reason: 'Operacja zakończona' };
  if (chopped(ops, kids, lp)) return { ok: false, reason: 'Pasek złożony z suboperacji – przesuń suboperację' };
  if (!effStation(ops, lp)) return { ok: false, reason: 'Operacja bez stanowiska' };
  return { ok: true };
}

const uniq = (arr, self) => { const out = []; for (const p of arr) { const s = String(p ?? '').trim(); if (s && s !== self && !out.includes(s)) out.push(s); } return out; };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Operacje w cyklu zależności (do porównania przed i po przesunięciu; liczone raz na początku przeciągania). */
export const cycles = (ops) => new Set([...computeSchedule(Object.entries(ops).map(([lp, o]) => ({ lp, ...o })), {})].filter(([, r]) => r.state === 'cycle').map(([lp]) => lp));

/**
 * Plan przesunięcia operacji [lp]. Dwa sposoby:
 *  - w poziomie (na własnym wierszu): [targetMs] – lewa krawędź paska; miejsce w kolejce = za operacją stanowiska z najpóźniejszym startem <= T;
 *  - w pionie (na wiersz innej operacji): [anchor] = {lp: A, side: 'after'|'before'} – dokładnie za A albo przed A, w kolejce stanowiska A.
 *    Gdy A jest na innym stanowisku, operacja przechodzi na to stanowisko (pole Stanowisko).
 * [result] – bieżący wynik silnika (Map lp → {start, end}). Zwraca {ok, reason?, ops (stan po zmianie – do podglądu),
 * patches: [[lp, {preds?, startManual?, station?}]], after (P albo null), before (A albo null), changed, station, stationFrom}.
 */
export function planDrag(ops, result, lp, targetMs, { before: cycBefore, anchor } = {}) {
  lp = String(lp);
  const kids = parents(ops);
  const can = canDrag(ops, lp, kids);
  if (!can.ok) return { ok: false, reason: can.reason };
  const S0 = effStation(ops, lp);
  let S = S0, A = null, side = null;
  if (anchor && anchor.lp != null && String(anchor.lp) !== lp) {
    A = String(anchor.lp); side = anchor.side === 'before' ? 'before' : 'after';
    if (!ops[A]) return { ok: false, reason: `Brak operacji ${A}` };
    if (chopped(ops, kids, A)) return { ok: false, reason: `${A} jest złożona z suboperacji – upuść na wierszu suboperacji` };
    if (isAncestor(A, lp) || isAncestor(lp, A) || (subParent(A) && subParent(A) === subParent(lp))) return { ok: false, reason: `${A} i ${lp} są w jednym drzewie – kolejność wynika z liter numeru` };
    if (side === 'before' && isLocked(ops[A])) return { ok: false, reason: `${A} ma ręczny start i koniec – nie można wstawić przed nią` };
    S = effStation(ops, A);
    if (!S) return { ok: false, reason: `${A} nie ma stanowiska` };
  }
  const memo = new Map();
  const stOf = (x) => { let v = memo.get(x); if (v === undefined) { v = effStation(ops, x); memo.set(x, v); } return v; };
  const onOld = (x) => !!ops[x] && stOf(x) === S0;
  const onS = (x) => !!ops[x] && stOf(x) === S;
  const work = { ...ops };
  const preds = (x) => (work[x].preds || []).map(String);
  const setPreds = (x, list) => { const v = uniq(list, x); if (!same(v, preds(x))) work[x] = { ...work[x], preds: v }; };
  const T = Math.round(targetMs / HOUR_MS) * HOUR_MS;
  const res = (x) => (result && result.get(x)) || {};
  const implied = (x) => structurallyBefore(work, x);

  // 1. wyjście z kolejki (starego stanowiska) – mostek nad X
  const qX = preds(lp).filter(onOld);
  for (const y of Object.keys(ops)) {
    if (y === lp || isLocked(ops[y]) || !onOld(y) || !preds(y).includes(lp)) continue;
    setPreds(y, preds(y).flatMap((p) => (p === lp ? qX : [p])));
  }
  const other = preds(lp).filter((p) => !onOld(p) && !onS(p));
  if (S !== S0) work[lp] = { ...work[lp], station: S };
  // 2. miejsce w kolejce
  let P = null, head = false;
  if (A && side === 'before') {
    const qA = preds(A).filter((p) => onS(p) && p !== lp);
    setPreds(lp, [...other, ...qA.filter((p) => !implied(lp).has(p))]);
    setPreds(A, [...preds(A).filter((p) => !qA.includes(p)), lp]);
    head = !qA.length;
    if (head && work[A].startManual != null) { const { startManual, ...rest } = work[A]; work[A] = { ...rest, startManual: null }; }   // X przejmuje początek kolejki, A idzie za X
  } else {
    if (A) P = A;
    else {
      for (const c of Object.keys(ops)) {
        if (c === lp || !onS(c) || chopped(ops, kids, c)) continue;
        const s = res(c).start;
        if (s == null || s > T) continue;
        if (P == null) { P = c; continue; }
        const sp = res(P).start, ec = res(c).end ?? s, ep = res(P).end ?? sp;
        if (s > sp || (s === sp && (ec > ep || (ec === ep && lpCompare(c, P) > 0)))) P = c;
      }
    }
    if (P) {
      setPreds(lp, implied(lp).has(P) ? other : [...other, P]);
      for (const y of Object.keys(ops)) {
        if (y === lp || isLocked(ops[y]) || !onS(y) || !preds(y).includes(P)) continue;
        setPreds(y, preds(y).map((p) => (p === P ? lp : p)));
      }
    } else {
      head = true;
      setPreds(lp, other);
      for (const y of Object.keys(ops)) {                         // początki kolejki (bez poprzedników na stanowisku) za X czekają na X
        if (y === lp || isLocked(ops[y]) || !onS(y) || chopped(ops, kids, y) || ops[y].startManual != null) continue;
        if (preds(y).some(onS) || res(y).start == null || res(y).start < T) continue;
        setPreds(y, [...preds(y), lp]);
      }
    }
  }
  // 3. ręczny start. W poziomie: przesuwa się z paskiem. W pionie: operacja idzie za poprzednikiem (start ręczny znika), a gdy jest pierwsza
  //    i nie ma żadnego poprzednika – start ręczny = start operacji, przed którą stoi. Bez żadnego źródła startu – start ręczny (inaczej nie miałaby startu).
  const sub = subParent(lp) && ops[subParent(lp)];
  if (A) {
    if (preds(lp).length || sub) { if (ops[lp].startManual != null) work[lp] = { ...work[lp], startManual: null }; }
    else work[lp] = { ...work[lp], startManual: Math.round((res(A).start ?? T) / HOUR_MS) * HOUR_MS };
  } else if (ops[lp].startManual != null || (!preds(lp).length && !sub)) work[lp] = { ...work[lp], startManual: T };
  // 4. porządki i kontrola
  const changed = Object.keys(work).filter((x) => work[x] !== ops[x]);
  for (const x of changed) { const red = implied(x); if (preds(x).some((p) => red.has(p))) setPreds(x, preds(x).filter((p) => !red.has(p))); }
  for (const x of changed) {
    const ps = preds(x);
    if (ps.length > MAX_PREDS) return { ok: false, reason: `Operacja ${x} miałaby ${ps.length} zależności (najwyżej ${MAX_PREDS})` };
    for (let i = 0; i < ps.length; i++) {
      if ((ops[x].preds || []).map(String).includes(ps[i])) continue;      // sprawdzamy tylko nowe powiązania
      const e = predError(work, x, i, ps[i]);
      if (e && !/^Zbędne/.test(e)) return { ok: false, reason: `${x} ← ${ps[i]}: ${e}` };
    }
  }
  const cb = cycBefore || cycles(ops), ca = cycles(work);
  const newCyc = [...ca].filter((x) => !cb.has(x));
  if (newCyc.length) return { ok: false, reason: `Powstałby cykl zależności (${newCyc.slice(0, 5).join(', ')})` };
  const patches = changed.map((x) => {
    const p = {};
    if (!same(preds(x), (ops[x].preds || []).map(String))) p.preds = preds(x);
    if ((work[x].startManual ?? null) !== (ops[x].startManual ?? null)) p.startManual = work[x].startManual ?? null;
    if ((work[x].station ?? '') !== (ops[x].station ?? '')) p.station = work[x].station;
    return [x, p];
  }).filter(([, p]) => Object.keys(p).length);
  for (const [x] of patches) if (work[x].startManual === null) { const { startManual, ...rest } = work[x]; work[x] = rest; }   // do podglądu: brak startu ręcznego
  return { ok: true, ops: work, patches, after: P, before: side === 'before' ? A : null, head, changed: patches.map(([x]) => x), station: S, stationFrom: S0, targetMs: T };
}
