// Kopia całego harmonogramu (eksport / import, tylko poziom GOD): plik JSON z operacjami (harm_ops) i ustawieniami (config/main).
// Ten sam format czyta i zapisuje aplikacja na Androidzie (harmfb/HarmBackup.kt).
import { ID_PATTERN, isSyntheticId, subParent } from './harmModel.js';

export const BACKUP_FORMAT = 'zks-harmonogram';
export const BACKUP_VERSION = 1;
const TEXT = ['client', 'komis', 'element', 'station', 'status'];
const NUM = ['hours', 'startManual', 'endManual', 'wysylka', 'dostawa'];

/** Operacja w postaci do pliku/bazy: tylko znane pola, puste pominięte, preds zawsze jako lista. */
export function normOp(o) {
  const r = { preds: Array.isArray(o && o.preds) ? o.preds.map((p) => String(p).trim()).filter(Boolean) : [] };
  for (const k of TEXT) { const v = o && o[k]; if (v != null && String(v) !== '') r[k] = String(v); }
  for (const k of NUM) { const v = o && o[k]; if (typeof v === 'number' && Number.isFinite(v)) r[k] = v; }
  return r;
}

/** Ustawienia (config/main) do pliku: stanowiska, kolory komisów, święta. */
export function normConfig(cfg) {
  const c = cfg || {};
  return {
    stations: (c.stations || []).filter((s) => s && s.name).map(({ name, bg, color, sum }) => (sum ? { name, bg, color, sum: true } : { name, bg, color })),
    komisColors: (c.komisColors || []).filter((k) => k && k.komis).map(({ komis, bg, color, bold, italic, underline }) => ({ komis, bg, color, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}) })),
    holidays: (c.holidays || []).map((h) => (typeof h === 'string' ? { date: h } : h)).filter((h) => h && h.date).map(({ date, name }) => (name ? { date, name } : { date })),
  };
}

/** Zawartość pliku kopii. */
export function backupData(opsByLp, cfg, { app = '', user = '', nowMs = Date.now() } = {}) {
  const ops = {};
  for (const lp of Object.keys(opsByLp || {}).sort()) ops[lp] = normOp(opsByLp[lp]);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date(nowMs).toISOString(), app, user, count: Object.keys(ops).length, ops, config: normConfig(cfg) };
}

export const backupText = (data) => JSON.stringify(data, null, 1);

/**
 * Odczyt i kontrola pliku kopii. Zwraca { ops, config, errors, warnings, meta }; przy błędach import jest zablokowany.
 * Kontrola: format, numery operacji, rodzic suboperacji w pliku, typy pól, poprzednicy (nieistniejący – uwaga).
 */
export function parseBackup(text) {
  const errors = [], warnings = [];
  let d;
  try { d = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { ops: {}, config: null, errors: ['To nie jest plik kopii harmonogramu (błędny JSON)'], warnings, meta: {} }; }
  if (!d || d.format !== BACKUP_FORMAT || typeof d.ops !== 'object' || !d.ops) return { ops: {}, config: null, errors: ['To nie jest plik kopii harmonogramu (brak znacznika „' + BACKUP_FORMAT + '”)'], warnings, meta: {} };
  if (Number(d.version) > BACKUP_VERSION) errors.push(`Plik z nowszej wersji programu (format ${d.version}) – zaktualizuj program`);
  const ops = {};
  for (const [lp0, o] of Object.entries(d.ops)) {
    const lp = String(lp0).trim();
    if (!(ID_PATTERN.test(lp) || isSyntheticId(lp))) { errors.push(`Błędny numer operacji „${lp0}”`); continue; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push(`Operacja ${lp}: błędne dane`); continue; }
    for (const k of NUM) if (o[k] != null && !(typeof o[k] === 'number' && Number.isFinite(o[k]))) errors.push(`Operacja ${lp}: pole ${k} nie jest liczbą`);
    if (o.preds != null && !Array.isArray(o.preds)) errors.push(`Operacja ${lp}: poprzednicy (preds) nie są listą`);
    ops[lp] = normOp(o);
    if (ops[lp].preds.length > 4) errors.push(`Operacja ${lp}: więcej niż 4 poprzedników`);
  }
  for (const lp of Object.keys(ops)) {
    const p = subParent(lp);
    if (p && !ops[p]) errors.push(`${lp}: brak operacji nadrzędnej ${p} w pliku`);
    const missing = ops[lp].preds.filter((x) => !ops[x]);
    if (missing.length) warnings.push(`${lp}: poprzednik spoza pliku (${missing.join(', ')})`);
  }
  const config = d.config && typeof d.config === 'object' ? normConfig(d.config) : null;
  return { ops, config, errors: errors.slice(0, 50), warnings: warnings.slice(0, 50), meta: { exportedAt: d.exportedAt || '', app: d.app || '', user: d.user || '', count: Object.keys(ops).length } };
}

/** Porównanie z obecnym harmonogramem: ile operacji dojdzie, zmieni się, zniknie i zostanie bez zmian. */
export function backupDiff(current, incoming) {
  const cur = current || {}, inc = incoming || {};
  const same = (a, b) => JSON.stringify(normOp(a)) === JSON.stringify(normOp(b));
  const added = [], changed = [], removed = [];
  let unchanged = 0;
  for (const lp of Object.keys(inc)) { if (!cur[lp]) added.push(lp); else if (same(cur[lp], inc[lp])) unchanged++; else changed.push(lp); }
  for (const lp of Object.keys(cur)) if (!inc[lp]) removed.push(lp);
  return { added, changed, removed, unchanged };
}

/** Nazwa pliku kopii z datą i godziną. */
export function backupFileName(nowMs = Date.now()) {
  const d = new Date(nowMs), p = (n) => String(n).padStart(2, '0');
  return `harmonogram_kopia_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
}
