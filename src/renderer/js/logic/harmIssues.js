// Konflikty i błędy harmonogramu liczone na bieżąco (po każdej zmianie w bazie): pętle zależności, brakujący poprzednicy,
// suboperacje bez operacji nadrzędnej, koniec ręczny przed startem ręcznym, brak startu, brak czasu, nieznane stanowisko, koniec po wysyłce.
// Ten sam zestaw reguł ma Android (harmfb/HarmIssues.kt).
import { predError, subParent, isSyntheticId } from './harmModel.js';

const fmt = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const isDone = (op) => String(op.status || '').trim().toLowerCase() === 'zak.';
const without = (ops, lp, pred) => ({ ...ops, [lp]: { ...ops[lp], preds: (ops[lp].preds || []).filter((x) => x !== pred) } });
const isCycleMsg = (msg) => /cykl/i.test(msg || '');

/**
 * Lista problemów: [{ lp, level: 'error'|'warn', kind, text, col? (klucz kolumny: z1–z4, startManual, endManual, hours, station, lp) }].
 * [extra]: { ends: Map lp → koniec liczony (ms), noStart: Set lp bez startu, stations: Set nazw stanowisk }.
 */
export function findIssues(opsByLp, extra = {}) {
  const ops = opsByLp || {}, out = [];
  const push = (lp, level, kind, text, col) => out.push({ lp, level, kind, text, ...(col ? { col } : {}) });
  const kids = new Set(Object.keys(ops).map(subParent).filter(Boolean));
  const cycleLinks = [];
  for (const [lp, op] of Object.entries(ops)) {
    const preds = op.preds || [];
    const par = subParent(lp);
    if (par && !ops[par]) push(lp, 'error', 'parent', `${lp}: brak operacji nadrzędnej ${par}`, 'lp');
    if (preds.length > 4) push(lp, 'error', 'preds', `${lp}: więcej niż 4 poprzedników (${preds.join(', ')})`, 'z4');
    preds.forEach((p, i) => {
      const col = 'z' + Math.min(4, i + 1);
      if (!ops[p]) { push(lp, 'error', 'missing', `${lp}: poprzednik ${p} nie istnieje`, col); return; }
      if (preds.indexOf(p) !== i) { push(lp, 'warn', 'dup', `${lp}: poprzednik ${p} wpisany dwa razy`, col); return; }
      const err = predError(without(ops, lp, p), lp, i, p);
      if (err) {
        if (isCycleMsg(err)) cycleLinks.push([lp, p, col]);
        else push(lp, 'error', 'pred', `${lp} ← ${p}: ${err}`, col);
      }
    });
    if (op.startManual != null && op.endManual != null && op.endManual < op.startManual) push(lp, 'error', 'dates', `${lp}: koniec ręczny ${fmt(op.endManual)} jest przed startem ręcznym ${fmt(op.startManual)}`, 'endManual');
    if (!isDone(op) && !kids.has(lp) && !(op.hours > 0) && op.endManual == null && !isSyntheticId(lp) && op.station) push(lp, 'warn', 'hours', `${lp}: brak czasu [h]`, 'hours');
    if (op.station && extra.stations && extra.stations.size && !extra.stations.has(op.station)) push(lp, 'warn', 'station', `${lp}: nieznane stanowisko „${op.station}”`, 'station');
    if (!isDone(op) && extra.noStart && extra.noStart.has(lp)) push(lp, 'warn', 'nostart', `${lp}: brak startu (ustaw start ręczny albo poprzedników)`, 'startManual');
    const end = extra.ends && extra.ends.get(lp);
    if (!isDone(op) && end != null && op.wysylka != null && end > op.wysylka) push(lp, 'warn', 'late', `${lp}: koniec ${fmt(end)} po wysyłce ${fmt(op.wysylka)}`, 'wysylka');
  }
  // pętle: które powiązanie wystarczy usunąć, żeby zniknęły wszystkie (podpowiedź)
  if (cycleLinks.length) {
    const fixes = new Set();
    if (cycleLinks.length <= 60) {
      for (const [lp, p] of cycleLinks) {
        const o2 = without(ops, lp, p);
        const left = cycleLinks.some(([l2, p2]) => !(l2 === lp && p2 === p) && isCycleMsg(predError(without(o2, l2, p2), l2, 0, p2)));
        if (!left) fixes.add(lp + '|' + p);
      }
    }
    for (const [lp, p, col] of cycleLinks) {
      const fix = fixes.has(lp + '|' + p);
      push(lp, 'error', 'cycle', `${lp} ← ${p}: pętla zależności` + (fix ? ' – usunięcie tego powiązania rozwiązuje wszystkie pętle' : ''), col);
    }
    out.forEach((x) => { if (x.kind === 'cycle' && /rozwiązuje/.test(x.text)) x.fix = true; });
  }
  const rank = { error: 0, warn: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (b.fix ? 1 : 0) - (a.fix ? 1 : 0) || a.lp.localeCompare(b.lp, 'pl', { numeric: true }));
}

/** Problemy pogrupowane po operacji: Map lp → { level, cols: Set, texts: [] } – do oznaczeń w tabeli. */
export function issuesByOp(issues) {
  const m = new Map();
  for (const x of issues) {
    if (!m.has(x.lp)) m.set(x.lp, { level: x.level, cols: new Map(), texts: [] });
    const e = m.get(x.lp);
    if (x.level === 'error') e.level = 'error';
    if (x.col) e.cols.set(x.col, e.cols.get(x.col) === 'error' ? 'error' : x.level);
    e.texts.push(x.text);
  }
  return m;
}
