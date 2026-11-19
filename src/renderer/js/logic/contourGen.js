// Generator konturu narzędzia z danych – zamiast ciężkiej formuły w arkuszu PSWT (kolumna AW).
// Pełny kontur jak dawniej w PSWT: AY = AV (lewa część mocowania z zakładki „kontury” wg kolumny M) + AW (korpus z kolumn D:N) + AX (prawa część).
// Wynik w formacie kolumny T: pary x_y (0,1 mm) rozdzielone „;”. Gałęzie i kolejność 1:1 z formuły (pierwsza pasująca wygrywa).
// Czyste funkcje – testy: test/contour-gen.test.js.

const txt = (v) => String(v ?? '').trim();
const low = (v) => txt(v).toLowerCase();
/** Liczba z komórki (przecinek dziesiętny); pusta / tekst = 0 (jak arkusz w działaniach). */
export const nv = (v) => { const n = Number(txt(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
/** FRAGMENT.TEKSTU(tekst; od; ile) – od 1. */
const mid = (s, from, len) => txt(s).substr(from - 1, len);
const midN = (s, from, len) => nv(mid(s, from, len));
/** ZAOKR(x; 0) – połówki od zera. */
const round0 = (x) => Math.sign(x) * Math.round(Math.abs(x));
const f = (v) => { const r = Math.round(v * 10000) / 10000; return String(Object.is(r, -0) ? 0 : r); };
const P = (x, y) => f(x) + '_' + f(y);
/** Lista punktów z „;” na początku i na końcu (jak ZŁĄCZ.TEKSTY z ";" przed każdym punktem). */
const pts = (list, { lead = true, tail = true } = {}) => (lead ? ';' : '') + list.map(([x, y]) => P(x, y)).join(';') + (tail ? ';' : '');

/** Najniższe Y lewej części mocowania (głębokość mocowania). */
export function minY(av) {
  const ys = txt(av).split(';').map((p) => p.split('_')[1]).filter((y) => y != null && y.trim() !== '').map(nv);
  return ys.length ? Math.min(...ys) : 0;
}
/** Y ostatniego punktu lewej części mocowania (w formule: FRAGMENT.TEKSTU(AV; DŁ(AV)-1; 2)). */
export function lastY(av) {
  const parts = txt(av).split(';').filter(Boolean);
  const p = parts[parts.length - 1] || '';
  return nv(p.split('_')[1]);
}

/**
 * Korpus narzędzia (dawne PSWT!AW) z kolumn D:N: { D grupa, E rodzaj, F Fi_mniejsze, G pochylenie, H promień, I Fi_większe, J długość 1,
 * K długość robocza, L ząb / ap, M mocowanie początkowe, N mocowanie końcowe } i lewej części mocowania [av]. '' – brak reguły dla tej grupy.
 */
export function bodyContour(p, av = '') {
  const D = low(p.D), E = low(p.E), M = txt(p.M), N = txt(p.N);
  const F = nv(p.F), G = nv(p.G), H = nv(p.H), I = nv(p.I), J = nv(p.J), K = nv(p.K), L = nv(p.L);
  const M3 = mid(M, 1, 3).toUpperCase(), N3 = mid(N, 1, 3).toUpperCase(), M2 = mid(M, 1, 2).toUpperCase(), N2 = mid(N, 1, 2).toUpperCase();
  const avY = lastY(av);
  const t30 = round0((Math.tan(Math.PI / 6) * F * 10) / 2);

  const erDrill = M.toUpperCase() === 'ER_032' || M3 === 'WEL'; // wiertło HSS w tulejce ER_032 albo w oprawce Weldon (wersja z kolumny T)
  if (D === 'wie' && E === 'hss' && !erDrill) {
    const a = 5 * F, top = J * 10 - t30, w = (J - K) * 10;
    return pts([[a, avY], [a, w], [-a, w], [-a, top], [0, J * 10], [a, top], [-a, top], [a, top], [a, w], [-a, w], [-a, avY]]);
  }
  if (D === 'wie' && E === 'hss') { // ER_032 / WEL…
    const b = -7.5 * K, a = 5 * F;
    return pts([[0, b], [-a, b], [-a, b + (J - K) * 10], [a, b + (J - K) * 10], [a, b + J * 10], [0, b + J * 10 + t30], [-a, b + J * 10], [-a, b + (J - K) * 10],
      [a, b + (J - K) * 10], [a, b], [0, b]], { lead: false, tail: false });
  }
  if (D === 'wie' && E === 'ply') { // wersja z kolumny T: korpus 0,98·F, czoło 10 mm krócej niż J
    const m = ((midN(M, 4, 3) + 10) * 10) / 2, a = (0.98 * F * 10) / 2, top = J * 10 - 100;
    return pts([[-m, 0], [-a, J * 10 - K * 10], [a, J * 10 - K * 10], [a, top - F], [0, top], [-a, top - F], [-a, J * 10 - K * 10], [a, J * 10 - K * 10], [m, 0], [-m, 0]]);
  }
  if (D === 'wyt' && E === 'wst') {
    const m = 5 * midN(M, 4, 3), a = (F / 2) * 10;
    return pts([[-m, (J - L - K) * 10], [a, (J - L - K) * 10], [a, (J - L - G) * 10], [0, (J - L - G) * 10], [0, (J - L - H) * 10], [I * 5, (J - L - H) * 10],
      [I * 5, (J - L - G) * 10], [0, (J - L - G) * 10], [0, (J - L - H) * 10], [a, (J - L - H) * 10], [a, (J - L) * 10], [-a, (J - L) * 10], [-a, (J - L - K) * 10], [m, (J - L - K) * 10]]);
  }
  if (D === 'wyt' && E === 'mik') {
    const m = midN(M, 4, 3), y0 = J * 10 - L * 11;
    return pts([[(-m * 10) / 2, y0], [(-m * 0.6 * 10) / 2, y0], [(-m * 0.6 * 10) / 2, J * 10], [(m * 0.6 * 10) / 2, J * 10], [(m * 0.6 * 10) / 2, y0], [(m * 10) / 2, y0]]);
  }
  if (D === 'gwi') {
    const m = (midN(M, 2, 4) * 10) / 2, s = midN(M, 12, 3);
    return pts([[-m, 0], [-m, (J - K - s) * 10], [(I * 10) / 2, (J - K - s) * 10], [(I * 10) / 2, (J - I / 5 - s) * 10], [(I * 10) / 2 - I, (J - s) * 10],
      [(-I * 10) / 2 + I, (J - s) * 10], [(-I * 10) / 2, (J - I / 5 - s) * 10], [(-I * 10) / 2, (J - K - s) * 10], [m, (J - K - s) * 10], [m, 0]]);
  }
  if (D === 'tre') {
    return pts([[-10 * (F / 2 - 2), 0], [-10 * (F / 2 - 2), 10 * (J - K)], [-10 * (F / 2), 10 * (J - K)], [-10 * (F / 2), 10 * J], [10 * (F / 2), 10 * J],
      [10 * (F / 2), 10 * (J - K)], [10 * (F / 2 - 2), 10 * (J - K)], [10 * (F / 2 - 2), 0]]);
  }
  const holder = (yK) => { // oprawka z kołnierzem: wspólny kawałek reguł „opr red FRE ABS/MHD” i „opr stż FRE0”
    const i2 = (I * 10) / 2, a9 = (I - L) * 0.9 * 5, a1 = (I - L) * 0.1 * 5;
    return [[-i2, J * 10], [-i2 + a9, J * 10], [-i2 + a9, (J + H) * 10], [-i2 + a1, (J + H) * 10], [-i2 + a1, J * 10], [(L * 10) / 2, J * 10], [(L * 10) / 2, (J + yK) * 10],
      [(-L * 10) / 2, (J + yK) * 10], [(-L * 10) / 2, J * 10], [i2 - a1, J * 10], [i2 - a1, (J + H) * 10], [i2 - a9, (J + H) * 10], [i2 - a9, J * 10], [i2, J * 10]];
  };
  if (D === 'opr' && E === 'red' && N3 === 'FRE' && (M3 === 'ABS' || M3 === 'MHD')) {
    return pts([[(-F * 10) / 2, 0], [(-I * 10) / 2, (I - F) * 5], ...holder(K), [(I * 10) / 2, (I - F) * 5], [(F * 10) / 2, 0]]);
  }
  if (D === 'fre' && (['tar', 'teo', 'jez', 'pal'].includes(E) || (E === 'plu' && M3 === 'WEL'))) {
    // wersja z kolumny T: chwyt Fi_większe (I), część robocza 0,98·F (tarczowe – F), czoło 1 mm krócej; w oprawce Weldon całość niżej o głębokość mocowania
    const off = M3 === 'WEL' ? minY(av) : 0, a = ((E === 'tar' ? 1 : 0.98) * F * 10) / 2, i = (I * 10) / 2, w = (J - K) * 10 + off, t = (J - 1) * 10 + off;
    return pts([[(-L * 10) / 2, 0], [-i, 0], [-i, w], [-a, w], [-a, t], [a, t], [a, w], [i, w], [i, 0], [(L * 10) / 2, 0]]);
  }
  if (D === 'fre' && (E === 'hss' || E === 'węg')) {
    const c = E === 'hss' ? 3 : 3.5, b = -c * F * 10, a = (F * 10) / 2, w = (-c * F + J - K) * 10, t = (-c * F + J) * 10;
    return pts([[0, b], [a, b], [a, w], [-a, w], [-a, t], [a, t], [a, w], [-a, w], [-a, b], [0, b]], { lead: false, tail: false });
  }
  if (D === 'opr' && E === 'prz' && (N3 === 'ABS' || N3 === 'MHD')) return pts([[(-F * 10) / 2, J * 10], [(F * 10) / 2, J * 10]]);
  const erHolder = M2 === 'ER' || (M3 === 'WEL' && N3 === 'T__'); // tulejka ER albo przedłużka Weldon → termo (wersja z kolumny T)
  if (D === 'opr' && E === 'red' && !erHolder && N3 !== 'FRE' && N3 !== 'ARB' && M3 !== 'FZS' && M2 !== 'KS' && N2 !== 'KS' && N2 !== 'KA' && M2 !== 'ER' && M2 !== 'MK') {
    return pts([[(-F * 10) / 2, 0], [(-F / 2) * 10, 10 * (J - K)], [(-I * 10) / 2, 10 * (J - K)], [(-I * 10) / 2, 10 * J], [(I * 10) / 2, 10 * J], [(I * 10) / 2, 10 * (J - K)],
      [(F / 2) * 10, 10 * (J - K)], [(F * 10) / 2, 0]]);
  }
  if (D === 'opr' && E === 'red' && mid(N, 6, 1) === '□') {
    const w = (midN(N, 2, 3) * 10) / 2, d = -10 * midN(N, 12, 3) + K * 10;
    return pts([[-w, K * 10], [-w, d], [w, d], [w, K * 10]]);
  }
  if (D === 'opr' && E === 'prz' && N3 === 'MK_') {
    const a = (F * 10) / 2;
    return pts([[a, avY], [a, J * 10], [-a, J * 10], [-a, avY]]);
  }
  if (D === 'opr' && E === 'prz' && mid(M, 6, 1) === '□' && mid(N, 6, 1) === '□') {
    const s = midN(M, 12, 3), a = (F * 10) / 2, i2 = (I * 10) / 2;
    return pts([[-a, 0], [-a, (J - s - K) * 10], [i2, (J - s - K) * 10], [i2, (J - s) * 10], [-i2, (J - s) * 10], [-i2, (J - s - K) * 10], [a, (J - s - K) * 10], [a, 0], [a, 0]]);
  }
  if (D === 'opr' && E === 'stż' && mid(N, 1, 4).toUpperCase() === 'FRE0') {
    return pts([[(-I * 10) / 2, 191], ...holder(K), [(I * 10) / 2, 191]]);
  }
  if (D === 'opr' && E === 'stż' && mid(N, 1, 4).toUpperCase() === 'FREM') {
    const a = (F * 10) / 2, i2 = (I * 10) / 2;
    return pts([[-i2, 191], [-i2, J * 10 - F], [a, J * 10 - F], [a, J * 10], [-a, J * 10], [-a, J * 10 - F], [i2, J * 10 - F], [i2, 191]]);
  }
  if (D === 'opr' && E === 'stż' && N3 !== 'FRE' && N3 !== 'SPC' && N3 !== 'BK_') {
    const a = (F * 10) / 2, i2 = (I * 10) / 2;
    return pts([[-i2, 191], [a, 191], [a, J * 10 - K], [-a, J * 10 - K], [-a, J * 10], [a, J * 10], [a, J * 10 - K], [-a, J * 10 - K], [-a, 191], [i2, 191]]);
  }
  if (D === 'opr' && E === 'stż' && N3 === 'BK_') {
    const a = (F * 10) / 2, i2 = (I * 10) / 2, s = J * 10 - (F * 10) / 1.5;
    return pts([[-i2, 191], [a, 191], [a, s], [(F * 10) / 5, J * 10], [(-F * 10) / 5, J * 10], [-a, s], [-a, 191], [i2, 191]]);
  }
  if (D === 'opr' && E === 'red' && N2 === 'KA') {
    const a = (F * 10) / 2, i2 = (I * 10) / 2, w = 10 * (J - K);
    return pts([[-a, avY], [a, avY], [-a, avY], [-a, w], [a, w], [-a, w], [-i2, w], [-i2, 10 * J], [i2, 10 * J], [i2, w], [a, w], [a, avY]]);
  }
  if (D === 'opr' && E === 'red' && erHolder) {
    const b = -30 * F, a = (F * 10) / 2;
    return pts([[0, b], [-a, b], [-a, b + 10 * J], [a, b + 10 * J], [a, b], [-a, b], [0, b]], { lead: false, tail: false });
  }
  if (D === 'wyt' && E === 'zgr' && M3 === 'ABS') {
    const m = midN(M, 4, 3), a = m * 5, c = m * 3;
    return pts([[a, 0], [a, J * 2], [-a, J * 2], [a, J * 2], [c, J * 3], [-c, J * 3], [c, J * 3], [c, J * 5], [-c, J * 5], [c, J * 5], [a, J * 6], [-a, J * 6], [a, J * 6], [a, J * 7],
      [-a, J * 7], [-I * 5, J * 10], [-I, J * 10], [-I, J * 9], [I, J * 9], [I, J * 10], [I * 5, J * 10], [a, J * 7], [-a, J * 7], [-a, J * 6], [-c, J * 5], [-c, J * 3], [-a, J * 2], [-a, 0]]);
  }
  if (D === 'opr' && E === 'red' && M3 === 'CAP' && N3 === 'ARB') {
    const a = (F * 10) / 2, b = (F / 2 - H) * 10, n2 = (midN(N, 4, 3) / 2) * 10, n3 = (10 + midN(N, 4, 3)) * 5;
    return pts([[-a, 0], [-a, 10 * (G - H)], [a, 10 * (G - H)], [-a, 10 * (G - H)], [-b, 10 * G], [b, 10 * G], [-b, 10 * G], [-n2, 10 * G], [-n2, 10 * (G + K)], [n3, 10 * (G + K)],
      [n3, 10 * (G + K + 15)], [-n3, 10 * (G + K + 15)], [-n3, 10 * (G + K)], [n2, 10 * (G + K)], [n2, 10 * G], [b, 10 * G], [a, 10 * (G - H)], [a, 0]]);
  }
  if (D === 'opr' && E === 'red' && N2 === 'KS') {
    const a = (F / 2) * 10;
    return pts([[a, 0], [a, K * 10], [-a, K * 10], [-a, 0]]);
  }
  return '';
}

/** Mocowanie z zakładki „kontury” (kod z kolumny M; dla narzędzi z „F0815” w opisie – wariant z apostrofem). */
export function mounting(mounts, M, opis = '') {
  const key = txt(M) + (txt(opis).includes('F0815') ? "'" : '');
  return mounts[key] || mounts[key.toUpperCase()] || null;
}

/** Pełny kontur (dawne PSWT!AY = AV + (AW albo „;”) + AX); null, gdy brak i mocowania, i reguły korpusu. */
export function fullContour(p, mounts) {
  const m = mounting(mounts, p.M, p.C) || { left: '', right: '' };
  const body = bodyContour(p, m.left);
  if (!body && !m.left && !m.right) return null;
  return m.left + (body || ';') + m.right;
}
