// Dane konturów narzędzi w bazie Firebase (zamiast pobierania z arkusza przy każdym otwarciu narzędziowni):
//   nd_meta/main   – { chunks, count, updatedAt, updatedBy }
//   nd_meta/mounts – { m: { kod mocowania: [lewa, prawa] } }            (zakładka „kontury” A:C)
//   nd_rows/{0..7} – { r: { kod narzędzia: [C, D … N, BH, BC, BE, V] } } (PSWT B:N, BH, BC, BE + ND_CACHE V)
// Źródłem pozostaje arkusz: MASTER / GOD przesyła dane do bazy (Ustawienia → Narzędziownia albo samoczynnie, gdy w bazie ich brak
// lub są starsze niż doba). Zatwierdzenie konturu zapisuje arkusz (Apps Script) i od razu poprawia wiersz w bazie.
// Kontury bez zatwierdzenia program liczy sam (wewnętrzny generator) albo bierze z kolumny T katalogu.
import { api } from './ui.js';
import { firebase } from './fb.js';

const KEYS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'BH', 'BC', 'BE'];
const NCHUNK = 8;
const DAY = 24 * 3600 * 1000;
const norm = (c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Stała paczka dla kodu (ten sam kod zawsze w tej samej paczce – poprawka jednego wiersza bez czytania pozostałych). */
export function chunkOf(code) {
  let h = 5381;
  for (const ch of norm(code)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return String(h % NCHUNK);
}
const toRow = (p, v) => [...KEYS.map((k) => String((p && p[k]) ?? '')), String(v ?? '')];
const fromRow = (a) => Object.fromEntries(KEYS.map((k, i) => [k, String(a[i] ?? '')]));

let memo = null;
/** Pamięć w programie do następnego zapisu / przesłania. */
export function ndInvalidate() { memo = null; }

/**
 * Dane konturów: { params: {kod: {C … N, BH, BC, BE}}, mounts, v: {kod: SVG}, source: 'baza' | 'arkusz', updatedAt }.
 * Najpierw baza; gdy pusta albo niedostępna – arkusz (Apps Script), a [manage] (MASTER / GOD) od razu przesyła dane do bazy.
 */
export function ndLoad({ manage = false, user = '', force = false } = {}) {
  if (memo && !force) {
    // dane wczytane wcześniej z arkusza (moduł bez uprawnień zapisu) – MASTER / GOD przesyła je do bazy
    if (manage) memo.then((d) => { if (d.source === 'arkusz' && !d.sent) { d.sent = true; ndWrite(d, user).catch(() => { d.sent = false; }); } }).catch(() => {});
    return memo;
  }
  memo = (async () => {
    try {
      const { sdk, db } = await firebase();
      const meta = await sdk.getDoc(sdk.doc(db, 'nd_meta', 'main'));
      if (meta.exists() && (meta.data().count || 0) > 0) {
        const [rows, mounts] = await Promise.all([sdk.getDocs(sdk.collection(db, 'nd_rows')), sdk.getDoc(sdk.doc(db, 'nd_meta', 'mounts'))]);
        const params = {}, v = {};
        rows.forEach((d) => { for (const [k, a] of Object.entries(d.data().r || {})) { params[k] = fromRow(a); if (a[KEYS.length]) v[k] = a[KEYS.length]; } });
        const m = (mounts.exists() && mounts.data().m) || {};
        const out = { params, v, mounts: Object.fromEntries(Object.entries(m).map(([k, a]) => [k, { left: a[0] || '', right: a[1] || '' }])), source: 'baza', updatedAt: meta.data().updatedAt || 0 };
        if (manage && Date.now() - out.updatedAt > DAY) ndImport({ user }).catch(() => {});   // starsze niż doba – odświeżenie w tle
        return out;
      }
    } catch { /* baza niedostępna – arkusz */ }
    const out = await fromSheet();
    if (manage) { out.sent = true; ndWrite(out, user).catch(() => { out.sent = false; }); }
    return out;
  })();
  memo.catch(() => { memo = null; });
  return memo;
}

async function fromSheet() {
  const [cd, v] = await Promise.all([api('ndContourData', [], { timeoutMs: 180000 }), api('ndContoursV', [], { timeoutMs: 180000 }).catch(() => ({}))]);
  const vv = {};
  for (const [k, s] of Object.entries(v || {})) vv[norm(k)] = s;
  return { params: (cd && cd.params) || {}, mounts: (cd && cd.mounts) || {}, v: vv, source: 'arkusz', updatedAt: Date.now() };
}

/** Przesłanie danych z arkusza do bazy (MASTER / GOD). Wynik: liczba narzędzi. */
export async function ndImport({ user = '' } = {}) {
  const data = await fromSheet();
  await ndWrite(data, user);
  memo = Promise.resolve({ ...data, source: 'baza' });
  return Object.keys(data.params).length;
}

async function ndWrite(data, user) {
  const { sdk, db } = await firebase();
  const chunks = Array.from({ length: NCHUNK }, () => ({}));
  const codes = new Set([...Object.keys(data.params), ...Object.keys(data.v)]);
  for (const k of codes) chunks[Number(chunkOf(k))][norm(k)] = toRow(data.params[k], data.v[k]);
  const b = sdk.writeBatch(db);
  chunks.forEach((r, i) => b.set(sdk.doc(db, 'nd_rows', String(i)), { r }));
  b.set(sdk.doc(db, 'nd_meta', 'mounts'), { m: Object.fromEntries(Object.entries(data.mounts || {}).map(([k, o]) => [k, [String(o.left || ''), String(o.right || '')]])) });
  b.set(sdk.doc(db, 'nd_meta', 'main'), { chunks: NCHUNK, count: codes.size, updatedAt: Date.now(), updatedBy: user });
  await b.commit();
}

/** Poprawka jednego narzędzia w bazie po zapisie w arkuszu (potwierdzenie konturu, kolumna V). [p] – pełne parametry, [v] – kontur roboczy. */
export async function ndPatch(code, p, v) {
  try {
    const { sdk, db } = await firebase();
    await sdk.setDoc(sdk.doc(db, 'nd_rows', chunkOf(code)), { r: { [norm(code)]: toRow(p, v) } }, { merge: true });
    if (memo) memo.then((d) => { const k = norm(code); d.params[k] = { ...(p || {}) }; if (v) d.v[k] = v; else delete d.v[k]; }).catch(() => {});
  } catch { /* baza niedostępna – arkusz jest zapisany, baza poprawi się przy następnym przesłaniu */ }
}
