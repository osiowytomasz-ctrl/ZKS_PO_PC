// Reguły ToolBuildera i Assembled Tool Viewera (odpowiedniki BuilderLogic.kt i BnLogic.kt).
import { naturalCompare } from './common.js';
import { norm, isBlockedLocation, description } from './tooltrack.js';

export { description };
const num = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const FIELDS = ['code', 'location', 'group', 'type', 'company', 'diameter', 'length', 'rAlpha'];
export const emptyFilters = () => Object.fromEntries(FIELDS.map((f) => [f, '']));

export const isListed = (t) => !!String(t.columnD ?? '').trim() && !isBlockedLocation(t.location);
export const rAlphaValue = (t) => { const g = num(t.columnG); return g !== 0 ? g : num(t.columnH); };
export const rAlphaText = (t) => { const v = rAlphaValue(t); return v !== 0 ? v.toFixed(2) : null; };

const value = (t, f) => ({ code: t.productCode, location: t.location, group: t.columnD, type: t.columnE, company: t.columnP, diameter: t.columnF, length: t.columnJ, rAlpha: rAlphaText(t) ?? '' }[f]);
function matches(t, f, wanted) {
  if (f === 'code') return norm(t.productCode).includes(norm(wanted));
  if (f === 'diameter' || f === 'length') return num(value(t, f)) === num(wanted);
  if (f === 'rAlpha') return rAlphaText(t) === num(wanted).toFixed(2);
  return norm(value(t, f)) === norm(wanted);
}
export function filterTools(tools, filters, exclude = null) {
  return tools.filter((t) => FIELDS.every((f) => f === exclude || !String(filters[f]).trim() || matches(t, f, filters[f])));
}
export function options(tools, filters, field) {
  const seen = new Map();
  for (const t of filterTools(tools, filters, field)) { const v = String(value(t, field) ?? '').trim(); if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); }
  const list = [...seen.values()];
  return ['diameter', 'length', 'rAlpha'].includes(field) ? list.sort((a, b) => num(a) - num(b)) : list.sort(naturalCompare);
}
export const sorted = (tools) => [...tools].sort((a, b) => naturalCompare(a.productCode, b.productCode));

/** Kolejne narzędzie musi pasować do poprzedniego: jego Mk (N) równa się Ms (M) ostatnio wybranego. */
export function nextCandidates(all, selected) {
  const last = selected[selected.length - 1];
  if (!last) return [];
  const wanted = norm(last.columnM);
  if (!wanted) return [];
  const chosen = new Set(selected.map((t) => t.productCode));
  return all.filter((t) => String(t.columnN ?? '').trim() && norm(t.columnN) === wanted && !chosen.has(t.productCode));
}
export const totalLength = (selected) => Math.floor(selected.reduce((s, t) => s + num(t.columnJ), 0) + 0.5);
export function selectionPath(selected) {
  const first = selected[0];
  if (!first) return '';
  const dyn = norm(first.columnD) === 'opr' ? first.columnN : first.columnF;
  return [first.columnD, first.columnE, dyn, first.columnP].map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean).join('/');
}
export const codesText = (selected) => selected.map((t) => String(t.productCode).toUpperCase()).join('; ');

// ---- Assembled Tool Viewer (BN) ----
export const BN_FIELDS = ['group', 'type', 'diameter', 'length'];
export const bnValue = (row, f) => ({ group: row.columnJ, type: row.columnK, diameter: row.firstTool?.columnF, length: (row.firstTool?.teamTotalLength || '').trim() ? row.firstTool.teamTotalLength : row.firstTool?.columnJ }[f] ?? '');
export const bnFilter = (rows, filters, exclude = null) => rows.filter((r) => BN_FIELDS.every((f) => f === exclude || !norm(filters[f]) || norm(bnValue(r, f)) === norm(filters[f])));
export function bnOptions(rows, filters, field) {
  const seen = new Map();
  for (const r of bnFilter(rows, filters, field)) { const v = String(bnValue(r, field) ?? '').trim(); if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); }
  return [...seen.values()].sort((a, b) => { const x = num(a), y = num(b); return x && y ? x - y : naturalCompare(a, b); });
}
export function bnTeamCodes(row) {
  const raw = (row.firstTool?.bnTeamCode || '').trim() ? row.firstTool.bnTeamCode : row.firstTool?.code || '';
  return raw.split(';').map((s) => s.trim()).filter(Boolean);
}
export const bnExtraText = (t) => [t.bnKomis, t.bnKtk, t.bnOper].filter((s) => s && String(s).trim()).join(' _ ');
