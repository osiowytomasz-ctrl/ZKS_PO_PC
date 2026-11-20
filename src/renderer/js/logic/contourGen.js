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

/** Wiertło rurowe (trepan): wymiary w mm. bodyDia – o ile korpus jest mniejszy od Ø roboczego (średnica), wall – ścianka korpusu,
 *  blade – grubość węglika (ostrza), bladeLen – wysokość ostrza od czubka, floor – dno wnęki nad dołem narzędzia (poziom 0, początek chwytu),
 *  neck – o ile szyjka pod długością roboczą jest węższa od Ø roboczego (średnica), plateArc – długość płytki po obwodzie (maks.). */
export const TREPAN = { bodyDia: 0.5, wall: 3.5, blade: 4, bladeLen: 7, floor: 3, neck: 3, plateArc: 4 };
/**
 * Wymiary wiertła rurowego w 0,1 mm (jak kontur): R – promień roboczy (zewnętrzna strona węglika), Rb – korpus, Rn – szyjka, Ri – wnęka,
 * Rc – wewnętrzna strona węglika; yt – czubek (J), y7 – dół ostrza, ye – koniec długości roboczej (J−K), yb – dno wnęki.
 */
export function trepanDims(F, J, K = 0) {
  const t = TREPAN, R = nv(F) * 5, yt = nv(J) * 10, y7 = yt - t.bladeLen * 10;
  return { R, Rb: Math.max(R - t.bodyDia * 5, 0), Rn: Math.max(R - t.neck * 5, 0), Rc: Math.max(R - t.blade * 10, 0), Ri: Math.max(R - t.bodyDia * 5 - t.wall * 10, 0),
    yt, y7, ye: Math.min(Math.max(nv(J) - nv(K), 0) * 10, y7), yb: Math.min(t.floor * 10, y7 - 10) };
}
/**
 * Rysunek wiertła rurowego poza sylwetą (współrzędne konturu, 0,1 mm): płytki ostrza w ściankach (żółte) i linie niewidoczne – wnęka
 * (ścianki i dno) oraz środkowe odcinki linii płytki – rysowane przerywaną 1 px. null – brak wymiarów.
 */
export function trepanDrawing(F, J) {
  const d = trepanDims(F, J);
  if (!(d.R > 0) || !(d.yt > 0)) return null;
  const plate = (s) => [[s * d.Rc, d.y7], [s * d.R, d.y7], [s * d.R, d.yt], [s * d.Rc, d.yt]].map(([x, y]) => ({ x, y }));
  const line = (a) => a.map(([x, y]) => ({ x, y }));
  return { plates: [plate(-1), plate(1)], hidden: [line([[-d.Ri, d.yt], [-d.Ri, d.yb], [d.Ri, d.yb], [d.Ri, d.yt]]), line([[-d.Rc, d.y7], [d.Rc, d.y7]])], cavity: { ri: d.Ri, yb: d.yb, rb: d.Rb, y7: d.y7 } };
}
/** Liczba płytek ostrza wg Ø roboczego (mm): liniowo od 4 dla Ø12 do 12 dla Ø130 (poza zakresem – 4 / 12). */
export const trepanPlates = (dia) => Math.max(4, Math.min(12, Math.round(4 + ((nv(dia) - 12) * 8) / 118)));

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

  const erDrill = M.toUpperCase() === 'ER_032' || M3 === 'WEL'; // wiertło w tulejce ER_032 albo w oprawce Weldon (wersja z kolumny T)
  const drill = E === 'hss' || E === 'węg'; // wiertła węglikowe – ta sama reguła co HSS (dawna formuła nie miała reguły) // wiertło HSS w tulejce ER_032 albo w oprawce Weldon (wersja z kolumny T)
  if (D === 'wie' && drill && !erDrill) {
    const a = 5 * F, top = J * 10 - t30, w = (J - K) * 10;
    return pts([[a, avY], [a, w], [-a, w], [-a, top], [0, J * 10], [a, top], [-a, top], [a, top], [a, w], [-a, w], [-a, avY]]);
  }
  if (D === 'wie' && drill) { // ER_032 / WEL…
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
  if (D === 'tre') { // wiertło rurowe (trepanacyjne) – sylweta z boku: ostrze 7 mm × 4 mm, korpus Ø−0,5, szyjka pod długością roboczą; wnęka tylko w rysunku
    const d = trepanDims(F, J, K), rs = M3 === 'WEL' ? 5 * midN(M, 4, 3) : 0;   // chwyt Weldon (średnica z kodu mocowania) pod narzędziem
    const rl = d.ye > 0 ? d.Rn : d.Rb;
    const L = [...(rs ? [[rs, 0], [-rs, 0]] : []), ...(rs !== rl ? [[-rl, 0]] : []), ...(d.ye > 0 ? [[-rl, d.ye], [-d.Rb, d.ye], [d.Rb, d.ye], [-d.Rb, d.ye]] : []),   // krawędź szyjki – linia przez całą szerokość
      [-d.Rb, d.y7], [-d.R, d.y7], [-d.Rc, d.y7], [-d.Rc, d.yt], [-d.Rc, d.y7], [-d.R, d.y7], [-d.R, d.yt]];   // linie płytki: dół i wewnętrzna krawędź
    const Rr = [[d.R, d.yt], [d.R, d.y7], [d.Rc, d.y7], [d.Rc, d.yt], [d.Rc, d.y7], [d.R, d.y7], [d.Rb, d.y7], ...(d.ye > 0 ? [[d.Rb, d.ye], [rl, d.ye]] : []), ...(rs !== rl ? [[rl, 0]] : [])];
    return pts([...L, ...Rr]);
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
  if (D === 'fre' && (E === 'faz' || E === 'plu')) {
    // reguła dopisana (dawna formuła jej nie miała): walec Ø I (Fi_większe), na czole stożek pod kątem G (pochylenie) do Ø F; w Weldonie niżej o głębokość
    const off = M3 === 'WEL' ? minY(av) : 0, big = (I || F) * 5, small = F * 5, ang = G > 0 && G < 90 ? G : 90;
    const hc = ang === 90 ? 0 : (big - small) / Math.tan((ang * Math.PI) / 180);
    const top = J * 10 + off, w = (J - K) * 10 + off;
    return pts([[0, off], [-big, off], [-big, Math.max(off, top - hc)], [-small, top], [small, top], [big, Math.max(off, top - hc)], [big, off], [0, off]]);
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

/** Prawa część mocowania = lewa w odwrotnej kolejności, z X ze zmienionym znakiem (jak w zakładce „kontury”). */
export function mirrorLeft(left) {
  return txt(left).split(';').filter(Boolean).reverse().map((p) => { const [x, y] = p.split('_'); return f(-nv(x)) + '_' + y; }).join(';');
}

// ── Mocowania wg karty „kontury” (wzory kolumn AJ:AW arkusza): lewa część jako punkty x1…x7 (0,1 mm), Z jak w karcie ──
/** ZAOKR(x; 1) – jedno miejsce po przecinku, połówki od zera. */
const round1 = (x) => (Math.sign(x) * Math.round(Math.abs(x) * 10)) / 10;
/** FZS / KS: [BM, BN, BO, BP] z karty. */
const FZS_KS = { FZS_031: [50, 31, 34, 69], FZS_048: [72, 48, 45, 90], FZS_060: [95, 60, 68, 138], KS_003: [50, 31, 34, 69], KS_005: [95, 60, 75, 138], "KS_005'": [95, 60, 62, 125] };
/** ER: [AL (x2, puste dla małych), AM (głębokość), AQ = AS − …, AR·2, AT·2 (ujemne), AU]. */
const ER = { 8: [null, -135, 12, 65, 64.5, -15], 11: [null, -180, 20, 95, 115, -25], 16: [null, -275, 27, 138, 170, -40], 20: [-75, -315, 28, 174, 210, -48],
  25: [-95, -340, 31, 220, 260, -50], 32: [-125, -400, 36, 292, 330, -55], 40: [-155, -460, 41, 362, 410, -70], 50: [-195, -600, 55, 460, 520, -85] };
/** Stożek Morse'a: [BU, BY, BZ, CB, CG]; kąt CH = 1,5°. */
const MK = [[3, 9.045, 56.5, 10.5, 3.9], [3.5, 12.065, 62, 13.5, 5.2], [5, 17.78, 75, 16, 6.3], [5, 23.825, 94, 20, 7.9], [6.5, 31.267, 117.5, 24, 11.9],
  [6.5, 44.399, 149.5, 29, 15.9], [8, 63.348, 210, 40, 19], [8, 83.058, 285.75, 34.9, 19]];
/** Weldon: długość chwytu l (mm) wg średnicy chwytu d = głębokość osadzenia (tabela wymiarów chwytu Weldon). Rozmiary spoza tabeli – interpolacja. */
const WEL = { 6: 36, 8: 36, 10: 40, 12: 45, 14: 45, 16: 48, 18: 48, 20: 50, 25: 56, 32: 60 };
/** Termo (T__ / SP): BS z karty. */
const TS = { T__006: 6.8, T__008: 8.8, T__010: 10.8, SP_15: 12.8 };
const KAR = { 19: -220, 32: -400 };
/**
 * Stożek 7:24 SK50 (DIN 69871) wg pliku SK50.DXF – prawa połowa od dołu osi do góry (0,1 mm): stożek Ø69,85 × 101,6 mm, kołnierz Ø97,5 z rowkiem V,
 * górna płaszczyzna na 19,1 mm; poziom 0 = płaszczyzna pomiarowa (duża średnica stożka). Stosowany dla wszystkich mocowań ISO / SK.
 */
const SK50 = [[201.0316, -1016], [349.25, 0], [349.25, 15], [487.5, 15], [487.5, 78.553], [456.25, 96.595], [456.25, 125.405], [487.5, 143.447], [487.5, 191], [0, 191]];
/** Grzybek montażowy (kołek pociągowy DIN 69872 A, DIN50: M24, L1 = 34, L2 = 25, D1 = 21, D2 = 28, fazy 15° i 30°) wkręcony w koniec stożka – część wystająca. */
const STUD = [[0, -1356], [126, -1356], [140, -1332], [140, -1266], [105, -1256.6], [105, -1145], [178, -1044], [178, -1016]];

/**
 * Lewa część mocowania wg wzorów karty „kontury” (kod z kolumny M) – lista punktów [x, y] w 0,1 mm albo null (kod spoza karty
 * / bez wymiarów). [synthetic] – rozmiar spoza tabel karty (Weldon interpolowany, termo T__ z reguły BS = Ø + 0,8).
 */
export function formulaMountPoints(code) {
  const c = txt(code).toUpperCase(), d3 = Number(c.substr(3, 3)) || 0;
  let m;
  if ((m = /^ABS(\d{3})$/.exec(c)) && d3) { const d = d3; return { pts: [[0, -5 * d], [2.5 * d, -5 * d], [2.5 * d, 0], [-5 * d, 0]] }; }
  if (c === 'CAP080') return { pts: [[0, -800], [-250, -800], [-350, 0], [-400, 0], [0, 0]] };
  if ((m = /^D(\d\d,\d)□(\d\d,\d)_(\d{3})$/.exec(c))) {
    const a = nv(m[1]), s = nv(m[2]), L = Number(m[3]), y = -10 * L + 10 * s;
    if (!a || !L) return null;
    return { pts: [[0, -10 * L], [5 * s, -10 * L], [5 * s, y], [-5 * a, y], [-5 * a, 0]] };
  }
  if ((m = /^ER_(\d{3})$/.exec(c)) && ER[Number(m[1])]) {
    const [x2, y2, dq, r2, t2, u] = ER[Number(m[1])], t = -t2 / 2, q = u - dq;
    return { pts: [[0, y2], ...(x2 == null ? [] : [[x2, y2]]), [t, q], [r2 / 2, q], [r2 / 2, u], [t, u], [t - u, 0]] };
  }
  if (FZS_KS[c]) {
    const [a, b, cc, e] = FZS_KS[c], y1 = -10 * e + 10 * cc, y5 = 10 * cc - b;
    return { pts: [[0, y1], [5 * b, y1], [5 * b, 0], [-5 * a, 0], [-5 * a, y5], [2.5 * a, y5], [2.5 * a, 10 * cc]] };
  }
  if (/^ISO\d{3}$/.test(c)) return { pts: [...STUD, ...SK50] };   // stożek SK50 z grzybkiem montażowym (każdy rozmiar ISO / SK)
  if ((m = /^KAR(\d{3})$/.exec(c)) && KAR[Number(m[1])]) { const d = Number(m[1]), h = KAR[d]; return { pts: [[0, h], [-5 * d, h], [-5 * d, 0]] }; }
  if (c === 'FREM16') return { pts: [[0, -180], [-80, -180], [-80, -100], [-70, -100], [-70, -60], [-80, -60], [-80, 0]] };
  if ((m = /^MHD(\d{3})$/.exec(c)) && d3) {
    const d = d3;
    return { pts: [[0, -7.5 * d], [-2.5 * d, -7.5 * d], [-2.5 * d, -2.5 * d], [2.5 * d, -2.5 * d], [5 * d, 0], [-5 * d, 0]] };
  }
  if ((m = /^MK_(\d{3})$/.exec(c)) && MK[Number(m[1])]) {
    const [bu, by, bz, cb, cg] = MK[Number(m[1])], bv = round1(Math.tan((1.5 * Math.PI) / 180) * (bz - cb));
    const bm = -bz + bu, bn = -cg / 2, bq = bm + cb + bu, br = -by / 2 + bv, bt = -by / 2, r = (v) => round1(v) * 10;
    return { pts: [[0, r(bm)], [-r(bn), r(bm)], [-r(bn), r(bq)], [r(br), r(bq)], [r(bt), r(bu)]] };
  }
  if (TS[c] || /^T__\d{3}$/.test(c)) {
    const bs = TS[c] || (d3 ? d3 + 0.8 : 0);
    if (!bs) return null;
    return { pts: [[4.5 * bs, -10 * bs], [-4.5 * bs, -10 * bs], [-5 * bs, 0], [5 * bs, 0]], synthetic: !TS[c] };
  }
  if ((m = /^WEL(\d{3})$/.exec(c)) && d3) {
    const d = d3;
    let bl = WEL[d], synthetic = false;
    if (bl == null) { // rozmiar spoza karty – głębokość interpolowana między sąsiednimi rozmiarami
      const k = Object.keys(WEL).map(Number).sort((a, b) => a - b);
      let i = k.findIndex((x) => x >= d);
      if (i <= 0) i = i === 0 ? 1 : k.length - 1;
      const [d1, d2] = [k[i - 1], k[i]];
      bl = Math.round(WEL[d1] + ((WEL[d2] - WEL[d1]) * (d - d1)) / (d2 - d1));
      synthetic = true;
    }
    return { pts: [[0, -10 * bl], [-5 * d, -10 * bl], [-5 * d, 0]], synthetic };
  }
  return null;
}
/** Mocowanie wg karty: { left, right, formula: true, synthetic } (format kolumn B / C karty) albo null. */
export function formulaMount(code) {
  const r = formulaMountPoints(code);
  if (!r) return null;
  const left = r.pts.map(([x, y]) => P(x, y)).join(';');
  return { left, right: mirrorLeft(left), formula: true, synthetic: !!r.synthetic };
}
/** Zgodność wstecz: mocowanie ABS / WEL wyliczone ze wzoru karty (dawniej tylko, gdy brak go w zakładce). */
export function synthMount(mounts, M) {
  const c = txt(M).toUpperCase();
  if (!/^(ABS|WEL)\d{3}$/.test(c)) return null;
  const m = formulaMount(c);
  return m ? { left: m.left, right: m.right, synthetic: true } : null;
}
/**
 * Mocowanie narzędzia (kod z kolumny M; z „F0815” w opisie – wariant z apostrofem): najpierw wzory karty „kontury”
 * (kształt i położenie w osi Z jak w karcie), dla kodów spoza wzorów – dane z zakładki „kontury”.
 */
export function mounting(mounts, M, opis = '') {
  const key = txt(M) + (txt(opis).includes('F0815') ? "'" : '');
  const fm = formulaMount(key);
  if (fm) return fm;
  const found = (mounts || {})[key] || (mounts || {})[key.toUpperCase()];
  if (found && (found.left || found.right)) return found;
  return key !== txt(M) ? formulaMount(M) : null;   // wariant F0815 spoza karty – zwykłe mocowanie
}

/** Pełny kontur (dawne PSWT!AY = AV + (AW albo „;”) + AX); null, gdy brak i mocowania, i reguły korpusu. */
export function fullContour(p, mounts) {
  let m = mounting(mounts, p.M, p.C) || { left: '', right: '' };
  let body = bodyContour(p, m.left);
  // reguły bez „;” na początku (wariant ER, frezy HSS/WĘG) rysują własny chwyt poniżej zera – wyliczonego mocowania nie dokładamy
  if (body && !body.startsWith(';')) { m = { left: '', right: '' }; body = bodyContour(p, ''); }
  if (!body && !m.left && !m.right) return null;
  return m.left + (body || ';') + m.right;
}
