// Układ płytek na narzędziu: które płytki (kody z PL_kontur), jakiego rodzaju (centralna na osi / obwodowa przy krawędzi) i gdzie leżą.
// Domyślnie (bez własnego układu) płytki biorą się z katalogu narzędzia: pierwsza płytka narzędzia centralnego (wiertło ISCAR / AMEC) jest centralna,
// pozostałe – obwodowe. Własny układ (zapisywany dla narzędzia na tym komputerze) pozwala wybrać rodzaj, dodać wiele płytek i ustawić ich położenie.
// Czyste funkcje – testy: test/plate-layout.test.js.

const num = (v, d = 0) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const r3 = (v) => Math.round(v * 1000) / 1000;

export const PLATE_MODES = [['auto', 'automatycznie'], ['central', 'centralna (na osi)'], ['edge', 'obwodowa (przy krawędzi)']];

/** Płytka układu: { code, mode: auto | central | edge, dx, dz (mm), ang (°), phi – kąt na obwodzie narzędzia (°), z – liczba kopii na obwodzie (0 – wg narzędzia) }. */
export function normPlate(p) {
  const o = p || {}, z = Math.round(num(o.z, 0));
  return { code: String(o.code ?? '').trim(), mode: o.mode === 'central' || o.mode === 'edge' ? o.mode : 'auto', dx: r3(num(o.dx)), dz: r3(num(o.dz)), ang: r3(num(o.ang)), phi: r3(num(o.phi)), z: z >= 1 ? Math.min(60, z) : 0 };
}
/** Lista płytek znormalizowana albo null (brak własnego układu). Płytki bez kodu są pomijane. */
export function normPlates(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map(normPlate).filter((p) => p.code);
  return out.length ? out : null;
}
/** Czy płytka o numerze [j] jest centralna: rodzaj wymuszony albo automatycznie (pierwsza płytka narzędzia centralnego). */
export const isCentralPlate = (plate, j, toolCentral) => (plate.mode === 'central' ? true : plate.mode === 'edge' ? false : j === 0 && !!toolCentral);
/**
 * Płytki do narysowania: własny układ [custom] albo płytki katalogu ([catalogCodes]) z ustawieniami domyślnymi.
 * Wynik: [{ code, central, dx, dz, ang, phi, z, custom }].
 */
export function resolvePlates(custom, catalogCodes, toolCentral) {
  const own = normPlates(custom);
  const list = own || (catalogCodes || []).map((code) => normPlate({ code }));
  return list.map((p, j) => ({ ...p, central: isCentralPlate(p, j, toolCentral), custom: !!own }));
}
/** Zmiana jednej płytki [j] – gdy własnego układu jeszcze nie ma, powstaje z płytek katalogu. Zwraca nową listę. */
export function patchPlate(custom, catalogCodes, j, patch) {
  const base = normPlates(custom) || (catalogCodes || []).map((code) => normPlate({ code }));
  if (!base[j]) return base;
  return base.map((p, k) => (k === j ? normPlate({ ...p, ...patch }) : p));
}
/** Dodanie płytki o kodzie [code] na koniec układu (własny układ powstaje z płytek katalogu, jeśli go nie było). */
export const addPlate = (custom, catalogCodes, code, extra = {}) => [...(normPlates(custom) || (catalogCodes || []).map((c) => normPlate({ code: c }))), normPlate({ ...extra, code })];
/** Usunięcie płytki [j]; pusty układ – null (wraca układ automatyczny). */
export const removePlate = (custom, catalogCodes, j) => {
  const base = normPlates(custom) || (catalogCodes || []).map((code) => normPlate({ code }));
  const out = base.filter((_, k) => k !== j);
  return out.length ? out : null;
};
