// Powiadomienia Workflow (dzwoneczek w górnym pasku): nowe zadania, zmiany statusu (w tym moich zleceń) oraz codzienne przypomnienie o zaległych
// (wstrzymane za długo, w trakcie za długo). Zdarzenia liczone z porównania kolejnych stanów listy zadań (wf_tasks). Czyste funkcje – testy: test/wf-notify.test.js.
import { parseDate } from './common.js';
import { normName } from './presence.js';
import { STATUS_LABELS } from './workflow.js';

export const DEFAULT_SETTINGS = { newTasks: true, status: true, mineOnly: false, stale: true, heldDays: 7, progressDays: 14, sound: false, system: false };
export const normSettings = (s) => {
  const o = { ...DEFAULT_SETTINGS, ...(s || {}) }, n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.min(365, Math.round(Number(v))) : d);
  for (const k of ['newTasks', 'status', 'mineOnly', 'stale', 'sound', 'system']) o[k] = !!o[k];
  o.heldDays = n(o.heldDays, 7); o.progressDays = n(o.progressDays, 14);
  return o;
};

/** Status zadania z rekordu workflow: 'A' (zakończone), 'B' (w trakcie), 'C' (wstrzymane) albo ''. */
export const taskStatus = (r) => ['A', 'B', 'C'].find((c) => String((r && r[c]) ?? '').trim().toLowerCase() === 'x') || '';
export const statusLabel = (s) => (s ? STATUS_LABELS[s] : 'bez statusu');
/** Krótki opis zadania: komis (E) i treść (F), do [n] znaków. */
export const taskText = (r, n = 90) => [r.E, r.F].map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' – ').slice(0, n);
/** Czy zlecającym (kolumna G) jest zalogowana osoba: wspólne słowo nazwiska / imienia (bez polskich znaków i wielkości liter). */
export function isMine(g, userName) {
  const a = new Set(normName(g).split(' ').filter((w) => w.length > 2)), b = normName(userName).split(' ').filter((w) => w.length > 2);
  return !!a.size && b.some((w) => a.has(w));
}
/** Stan do porównań: Map numer → { s: status, g: zlecający }. */
export const snapshotOf = (recs) => new Map((recs || []).map((r) => [Number(r.row), { s: taskStatus(r), g: String(r.G ?? '') }]));
/** Zapis / odczyt migawki w pamięci przeglądarki (obiekt zwykły). */
export const snapToObj = (m) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.s + '|' + v.g]));
export const objToSnap = (o) => new Map(Object.entries(o || {}).map(([k, v]) => { const i = String(v).indexOf('|'); return [Number(k), { s: String(v).slice(0, i), g: String(v).slice(i + 1) }]; }));

/**
 * Zdarzenia z różnicy stanów: [prev] – poprzednia migawka (null – pierwsze wczytanie, bez zdarzeń), [recs] – bieżące zadania, [user] – nazwa zalogowanego.
 * Wynik: [{ id, ts, type: 'new' | 'status', row, mine, title, text }] według ustawień [opts].
 */
export function diffTasks(prev, recs, user, opts = DEFAULT_SETTINGS, now = Date.now()) {
  if (!prev) return [];
  const o = normSettings(opts), out = [];
  for (const r of recs || []) {
    const row = Number(r.row), old = prev.get(row), s = taskStatus(r), mine = isMine(r.G, user);
    if (!old) {
      if (o.newTasks) out.push({ id: `new:${row}:${now}`, ts: now, type: 'new', row, mine, title: `Nowe zadanie #${row}${r.G ? ' – ' + String(r.G).trim() : ''}`, text: taskText(r) });
    } else if (old.s !== s && o.status && (!o.mineOnly || mine)) {
      out.push({ id: `st:${row}:${now}`, ts: now, type: 'status', row, mine, title: `Zadanie #${row}: ${statusLabel(old.s)} → ${statusLabel(s)}`, text: taskText(r) });
    }
  }
  return out;
}
/** Wiek zadania w dniach z daty w kolumnie D („RRRR.MM.DD GG:MM”); null – brak daty. */
export function ageDays(r, now = Date.now()) {
  const d = parseDate(String(r.D ?? '').replace(/\./g, '-').replace(/ /, 'T'));
  const t = d instanceof Date ? d.getTime() : (typeof d === 'number' ? d : null);
  return t == null || Number.isNaN(t) ? null : Math.floor((now - t) / 86400000);
}
/** Przypomnienie o zaległych: wstrzymane dłużej niż [heldDays] i w trakcie dłużej niż [progressDays] dni – jedno zdarzenie (albo null). */
export function staleDigest(recs, opts = DEFAULT_SETTINGS, now = Date.now()) {
  const o = normSettings(opts);
  if (!o.stale) return null;
  let held = 0, prog = 0;
  for (const r of recs || []) {
    const s = taskStatus(r), a = ageDays(r, now);
    if (a == null) continue;
    if (s === 'C' && a >= o.heldDays) held++; else if (s === 'B' && a >= o.progressDays) prog++;
  }
  if (!held && !prog) return null;
  const parts = [held ? `wstrzymane ponad ${o.heldDays} dni: ${held}` : '', prog ? `w trakcie ponad ${o.progressDays} dni: ${prog}` : ''].filter(Boolean);
  return { id: `stale:${now}`, ts: now, type: 'stale', row: 0, mine: false, title: 'Zaległe zadania w Workflow', text: parts.join(' · ') };
}
