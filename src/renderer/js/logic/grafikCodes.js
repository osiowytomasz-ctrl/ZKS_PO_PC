// Kody dostępu do Grafiku na telefonie (strona Apps Script ?p=grafik, GrafikKod.gs): 8 cyfr, w bazie tylko skrót SHA-256.
// Czyste funkcje – testy: test/grafik-kod.test.js.
export const SALT = 'zks-grk:';

/** Nowy losowy kod: 8 cyfr (bez zera na początku – łatwiej przepisać). */
export function newCode(rand = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const r = rand(8);
  return Array.from(r, (x, i) => String(i === 0 ? 1 + (x % 9) : x % 10)).join('');
}

/** Skrót kodu jak w GrafikKod.gs (grk_hash_): SHA-256 z SALT + kod, zapis szesnastkowy. */
export async function hashCode(code) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + code));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Wiersze okna kodów: pracownicy (bez separatorów) z nadanym kodem ({hash, at, by, last}) albo bez. */
export function codeRows(people, codes) {
  const byPid = {};
  for (const [hash, c] of Object.entries(codes || {})) if (c && c.pid) byPid[c.pid] = { hash, ...c };
  return (people || []).filter((p) => !p.sep && p.id && p.name).map((p) => ({ pid: p.id, name: p.name, place: p.place || '', code: byPid[p.id] || null }));
}

/** Skróty kodów osoby [pid] (do usunięcia przy nadaniu nowego kodu albo odebraniu dostępu). */
export const hashesOf = (codes, pid) => Object.entries(codes || {}).filter(([, c]) => c && c.pid === pid).map(([k]) => k);
