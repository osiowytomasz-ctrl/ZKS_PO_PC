// Reguły ToolTrack (odpowiednik ToolTrackLogic.kt, przeniesione z Index_ST.html).
import { naturalCompare } from './common.js';

export const DEFAULT_LOCATIONS = ['Correa', 'Union', 'Schiess', 'Skoda', 'Soraluce', 'Narzędziownia'];
const BLOCKED = ['zapas', 'złom', 'zlom'];
const HIDDEN_GROUPS = new Set(['', 'gwi', 'roz']);
const HIDDEN_TYPES = new Set(['', 'hss', 'tct', 'węg']);

export const norm = (v) => String(v ?? '').trim().toLowerCase();
export const normCode = (v) => norm(v).replace(/\s+/g, ' ');
export const isBlockedLocation = (loc) => BLOCKED.some((b) => norm(loc).includes(b));
export const isListed = (t) => !HIDDEN_GROUPS.has(norm(t.columnD)) && !HIDDEN_TYPES.has(norm(t.columnE)) && !isBlockedLocation(t.location);

/** Dla grupy `opr` filtr dynamiczny to mocowanie końcowe (N), dla pozostałych średnica (F); null = brak grupy. */
export function dynamicIsMounting(group) {
  const g = norm(group);
  if (!g) return null;
  return g === 'opr';
}
const dynValue = (t, mounting) => (mounting ? t.columnN : t.columnF);

export const emptyFilters = () => ({ location: '', code: '', group: '', type: '', company: '', dynamic: '' });
export function withFilter(f, field, value) {
  const n = { ...f, [field]: value };
  if (field === 'group') n.dynamic = '';
  return n;
}

export function filterTools(tools, f, exclude = null) {
  const mounting = dynamicIsMounting(f.group);
  const loc = norm(f.location), code = norm(f.code), group = norm(f.group), type = norm(f.type), company = norm(f.company), dyn = norm(f.dynamic);
  return tools.filter((t) =>
    (exclude === 'location' || !loc || norm(t.location) === loc) &&
    (exclude === 'code' || !code || norm(t.productCode).includes(code)) &&
    (exclude === 'group' || !group || norm(t.columnD) === group) &&
    (exclude === 'type' || !type || norm(t.columnE) === type) &&
    (exclude === 'company' || !company || norm(t.columnP) === company) &&
    (exclude === 'dynamic' || !dyn || mounting === null || norm(dynValue(t, mounting)) === dyn));
}

const numericAware = (a, b) => {
  const x = Number(String(a).replace(',', '.')), y = Number(String(b).replace(',', '.'));
  const xn = String(a).trim() !== '' && Number.isFinite(x), yn = String(b).trim() !== '' && Number.isFinite(y);
  if (xn && yn) return x - y;
  if (xn) return -1;
  if (yn) return 1;
  return naturalCompare(a, b);
};

export function filterOptions(tools, f, field) {
  const mounting = dynamicIsMounting(f.group);
  if (field === 'dynamic' && mounting === null) return [];
  const get = { location: (t) => t.location, group: (t) => t.columnD, type: (t) => t.columnE, company: (t) => t.columnP, dynamic: (t) => dynValue(t, mounting) }[field];
  const seen = new Map();
  for (const t of filterTools(tools, f, field)) {
    const v = String(get(t) ?? '').trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort(numericAware);
}

export const findByCode = (tools, code) => {
  const w = normCode(code);
  return w ? tools.find((t) => normCode(t.productCode) === w) || null : null;
};

const isWhite = (c) => { const x = norm(c).replace(/ /g, ''); return !x || x === '#ffffff' || x === '#fff' || x === 'white' || x === 'rgb(255,255,255)'; };

/** Czy któraś część skrawająca/akcesorium ma stan inny niż biały (czerwona ramka przy kodzie). */
export function hasPartWarning(tool, details, byCode) {
  const d = details[normCode(tool.productCode)];
  if (!d) return false;
  return [...(d.partsCutting || []), ...(d.partsAccessories || [])].some((p) => {
    const data = byCode.get(normCode(p));
    return data ? !isWhite(data.partStatusColor) : false;
  });
}

export function wearPercent(v) { let n = Number(v) || 0; if (n > 0 && n <= 1) n *= 100; return Math.max(0, Math.min(100, n)); }
export const wearBand = (p) => (p < 40 ? 'low' : p < 70 ? 'medium' : 'high');

export function locationColor(location) {
  const l = norm(location);
  if (l.includes('union')) return '#13fff2';
  if (l.includes('correa')) return '#999999';
  if (l.includes('schiess')) return '#0741f6';
  if (l.includes('skoda')) return '#7cc576';
  if (l.includes('soraluce')) return '#f7c948';
  if (l.includes('narzędziownia') || l.includes('narzedziownia')) return '#c6c6c6';
  return null;
}

export function rAlphaText(t) {
  const raw = (t.columnG && String(t.columnG).trim()) ? t.columnG : t.columnH;
  const n = Number(String(raw ?? '').trim().replace(',', '.')) || 0;
  return n === 0 ? '' : n.toFixed(2);
}
export const description = (t) => [t.columnP, t.name, t.columnO].filter((s) => s && String(s).trim()).join(' | ');
