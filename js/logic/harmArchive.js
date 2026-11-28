// Archiwum zakończonych operacji (kolekcja harm_archive): stare, zakończone zlecenia wychodzą z bieżącego harmonogramu, żeby program,
// telefon i baza pracowały na małym zbiorze niezależnie od historii. Przenoszone są tylko całe drzewa (operacja z suboperacjami),
// gdy WSZYSTKIE ich operacje bez dzieci są zakończone („zak.”), koniec ostatniej jest starszy niż wybrana data, a żadna operacja,
// która zostaje, nie zależy od nich (Z1–Z4). Ten sam wybór liczy Android (harmfb/HarmArchive.kt).
import { subParent } from './harmModel.js';

const rootOf = (lp) => { let r = String(lp); for (let p = subParent(r); p; p = subParent(r)) r = p; return r; };
const isDone = (op) => String((op && op.status) || '').trim().toLowerCase() === 'zak.';

/**
 * Drzewa do archiwum: [{ root, lps: [...], end (ms), komis }], posortowane po końcu. [ends] – Map lp → koniec liczony (ms; z silnika),
 * [beforeMs] – archiwizować tylko kończące się przed tą chwilą.
 */
export function archiveCandidates(opsByLp, ends, beforeMs) {
  const ops = opsByLp || {};
  const trees = new Map();
  for (const lp of Object.keys(ops)) { const r = ops[rootOf(lp)] ? rootOf(lp) : lp; if (!trees.has(r)) trees.set(r, []); trees.get(r).push(lp); }
  const hasKids = new Set(Object.keys(ops).map(subParent).filter((p) => p && ops[p]));
  const cand = new Map();
  for (const [root, lps] of trees) {
    const leaves = lps.filter((lp) => !hasKids.has(lp));
    if (!leaves.length || !leaves.every((lp) => isDone(ops[lp]))) continue;
    let end = null;
    for (const lp of lps) { const e = (ends && ends.get(lp)) ?? ops[lp].endManual ?? null; if (e != null) end = end == null ? e : Math.max(end, e); }
    if (end == null || end >= beforeMs) continue;
    cand.set(root, { root, lps, end, komis: ops[root].komis || '' });
  }
  // drzewa, od których zależy coś, co zostaje – nie przenosimy (powtarzane, bo wycofanie jednego drzewa może zatrzymać inne)
  for (let changed = true; changed;) {
    changed = false;
    const moving = new Set([...cand.values()].flatMap((c) => c.lps));
    for (const [lp, op] of Object.entries(ops)) {
      if (moving.has(lp)) continue;
      for (const p of op.preds || []) if (moving.has(p)) { const r = rootOf(p); if (cand.delete(cand.has(r) ? r : p)) changed = true; }
    }
  }
  return [...cand.values()].sort((a, b) => a.end - b.end);
}
