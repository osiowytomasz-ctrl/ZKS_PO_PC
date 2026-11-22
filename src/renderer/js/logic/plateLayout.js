// Układ płytek na narzędziu: które płytki (kody z PL_kontur), jakiego rodzaju (centralna na osi / obwodowa przy krawędzi) i gdzie leżą.
// Domyślnie (bez własnego układu) płytki biorą się z katalogu narzędzia: pierwsza płytka narzędzia centralnego (wiertło ISCAR / AMEC) jest centralna,
// pozostałe – obwodowe. Własny układ (zapisywany dla narzędzia na tym komputerze) pozwala wybrać rodzaj, dodać wiele płytek i ustawić ich położenie.
// Czyste funkcje – testy: test/plate-layout.test.js.

const num = (v, d = 0) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Rodzaje ułożenia płytki: automatycznie, centralna (jedna na osi narzędzia – wiertła ISCAR / AMEC), obwodowa (para przy krawędzi – frezy),
 * nieregularna (jedna płytka w dowolnym miejscu: położenie ustawiane ΔX, ΔZ, obrotem i kątem na obwodzie – np. wiertła płytkowe Komet).
 */
export const PLATE_MODES = [['auto', 'automatycznie'], ['central', 'centralna (na osi)'], ['edge', 'obwodowa (przy krawędzi)'], ['irregular', 'nieregularna (dowolne położenie)']];

/** Płytka układu: { code, mode: auto | central | edge, dx, dz (mm), ang (°), phi – kąt na obwodzie narzędzia (°), z – liczba kopii na obwodzie (0 – wg narzędzia) }. */
export function normPlate(p) {
  const o = p || {}, z = Math.round(num(o.z, 0));
  return { code: String(o.code ?? '').trim(), mode: ['central', 'edge', 'irregular'].includes(o.mode) ? o.mode : 'auto', dx: r3(num(o.dx)), dz: r3(num(o.dz)), ang: r3(num(o.ang)), phi: r3(num(o.phi)), z: z >= 1 ? Math.min(60, z) : 0,
    ...(o.autoAng ? { autoAng: true } : {}), ...(o.autoPos ? { autoPos: true } : {}), ...(o.angRel != null && o.angRel !== '' && Number.isFinite(Number(o.angRel)) ? { angRel: r3(Number(o.angRel)) } : {}),   // angRel – kąt płytki frezu względem krawędzi skrawającej narzędzia: płytka podąża za zmianą kąta skrawania G

    ...(o.base && Number.isFinite(Number(o.base.x)) && Number.isFinite(Number(o.base.y)) ? { base: { x: Number(o.base.x), y: Number(o.base.y) } } : {}) };   // base – własny punkt bazowy tej płytki (inny niż domyślny dla kodu)   // autoAng / autoPos – kąt i położenie nadal wynikają z narzędzia (kąt skrawania G, rzędy); ręcznie wpisana wartość jest bezwzględna
}
/**
 * Układ płytek „jak jest rysowany” (płytki ze stackTool: rodzaj, korekty, kąt, rzędy frezów płytkowych / jeżowych) jako lista układu do edycji. Dzięki temu pierwsza zmiana
 * w oknie płytki / edytorze zaczyna się od faktycznego stanu (np. pochylenie G z tabeli), a nie od pustego układu z kątem 0°.
 */
export const specsFromPlates = (plates) => (plates || []).map((p) => normPlate({ code: p.code, mode: p.kind === 'central' ? 'central' : p.kind === 'irregular' ? 'irregular' : 'edge', dx: p.dx, dz: p.dz, ang: p.ang, phi: p.phi, z: p.z, autoAng: p.autoAng, autoPos: p.autoPos, angRel: p.angRel, base: p.ownBase }));
/** Pola płytki ustawione ręcznie przestają być automatyczne: [patch] z ang → bezwzględny kąt płytki, z dx / dz → bezwzględne położenie. */
export const withManual = (p, patch) => {
  const o = { ...p, ...patch }, ch = (k) => !!patch && k in patch && Math.abs(num(patch[k]) - num(p[k])) > 1e-9;   // pole nie zmienione (np. zwrotka z edytora) zostaje automatyczne
  if (ch('ang')) { delete o.autoAng; if (!('angRel' in patch)) delete o.angRel; }
  if (ch('dx') || ch('dz')) delete o.autoPos;
  return o;
};
/** Lista płytek znormalizowana albo null (brak własnego układu). Płytki bez kodu są pomijane. */
export function normPlates(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map(normPlate).filter((p) => p.code);
  return out.length ? out : null;
}
/** Czy płytka o numerze [j] jest centralna: rodzaj wymuszony albo automatycznie (pierwsza płytka narzędzia centralnego). */
export const isCentralPlate = (plate, j, toolCentral) => (plate.mode === 'central' ? true : plate.mode === 'edge' || plate.mode === 'irregular' ? false : j === 0 && !!toolCentral);
/** Rodzaj płytki do rysowania: 'central' | 'irregular' | 'edge' (obwodowa – para lewa / prawa). */
export const plateKind = (plate, j, toolCentral) => (plate.mode === 'irregular' ? 'irregular' : isCentralPlate(plate, j, toolCentral) ? 'central' : 'edge');
/**
 * Płytki do narysowania: własny układ [custom] albo płytki katalogu ([catalogCodes]) z ustawieniami domyślnymi.
 * Wynik: [{ code, kind, central, irregular, dx, dz, ang, phi, z, custom }].
 */
export function resolvePlates(custom, catalogCodes, toolCentral) {
  const own = normPlates(custom);
  const list = own || (catalogCodes || []).map((code) => normPlate({ code }));
  return list.map((p, j) => { const kind = plateKind(p, j, toolCentral); return { ...p, kind, central: kind === 'central', irregular: kind === 'irregular', custom: !!own }; });
}
/** Zmiana jednej płytki [j] – gdy własnego układu jeszcze nie ma, powstaje z płytek katalogu. Zwraca nową listę. */
export function patchPlate(custom, catalogCodes, j, patch) {
  const base = normPlates(custom) || (catalogCodes || []).map((code) => normPlate({ code }));
  if (!base[j]) return base;
  return base.map((p, k) => (k === j ? normPlate(withManual(p, patch)) : p));
}
/** Dodanie płytki o kodzie [code] na koniec układu (własny układ powstaje z płytek katalogu, jeśli go nie było). */
export const addPlate = (custom, catalogCodes, code, extra = {}) => [...(normPlates(custom) || (catalogCodes || []).map((c) => normPlate({ code: c }))), normPlate({ ...extra, code })];
/** Usunięcie płytki [j]; pusty układ – null (wraca układ automatyczny). */
export const removePlate = (custom, catalogCodes, j) => {
  const base = normPlates(custom) || (catalogCodes || []).map((code) => normPlate({ code }));
  const out = base.filter((_, k) => k !== j);
  return out.length ? out : null;
};
