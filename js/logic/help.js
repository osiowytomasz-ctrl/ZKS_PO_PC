// Kalkulatory Help (odpowiednik HelpLogic.kt, z IndexHelp.html). Wyrażenia: + - * / ^, nawiasy, pi, sqrt, sin, cos, tan, abs.

export function fixed(value, digits) {
  const t = value.toFixed(digits);
  return t.startsWith('-') && /^[0.]*$/.test(t.slice(1)) ? t.slice(1) : t;
}
export const plain = (v) => (Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(v));
const jsRound = (x) => Math.floor(x + 0.5);
const rad = (d) => (d * Math.PI) / 180;

/** Wartość wyrażenia albo null (puste, błędne, nieskończone). */
export function evalExpr(text) {
  const s = String(text ?? '').trim().replace(/,/g, '.');
  if (!s) return null;
  let i = 0;
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => { skip(); return s[i]; };
  const fail = (m) => { throw new Error(m); };
  function expr() { let v = term(); for (;;) { const c = peek(); if (c === '+') { i++; v += term(); } else if (c === '-') { i++; v -= term(); } else return v; } }
  function term() { let v = unary(); for (;;) { const c = peek(); if (c === '*') { i++; v *= unary(); } else if (c === '/') { i++; v /= unary(); } else return v; } }
  function unary() { const c = peek(); if (c === '-') { i++; return -unary(); } if (c === '+') { i++; return unary(); } return power(); }
  function power() { const b = primary(); if (peek() === '^') { i++; return Math.pow(b, unary()); } return b; }
  function primary() {
    const c = peek();
    if (c === undefined) fail('koniec');
    if (c === '(') { i++; const v = expr(); if (peek() !== ')') fail('brak )'); i++; return v; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) fail('liczba'); i += m[0].length; return parseFloat(m[0]);
    }
    if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z]+/.exec(s.slice(i)); i += m[0].length;
      const name = m[0].toLowerCase();
      if (name === 'pi') return Math.PI;
      if (peek() !== '(') fail('brak (');
      i++; const arg = expr(); if (peek() !== ')') fail('brak )'); i++;
      const f = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs }[name];
      if (!f) fail('funkcja'); return f(arg);
    }
    return fail('znak');
  }
  try { const v = expr(); skip(); if (i !== s.length) return null; return Number.isFinite(v) ? v : null; } catch (e) { return null; }
}

/** Posuw dla promienia płytki i chropowatości Ra. */
export function feed(raText, radiusText) {
  const ra = evalExpr(raText), r = evalExpr(radiusText);
  if (ra === null || r === null || ra <= 0 || r <= 0) return { text: 'Podaj poprawne wartości dla Ra i R płytki (większe od 0).', isError: true };
  const f = (jsRound(Math.sqrt((ra / 1000) * r * 8) * 2 * 100) / 100) * 0.9;
  return { text: `Ra = ${plain(ra)} µm, rε = ${plain(r)} mm, Posuw F = ${fixed(f, 3)} mm/obr`, isError: false };
}

/** Cięciwy od otworu 1 do wybranych otworów: Ø · sin(α·(z−1)/2). */
export function chords(diameterText, holesText, unlocked, angleText, zTexts) {
  const d = evalExpr(diameterText);
  if (d === null || d <= 0) return { error: 'Podaj poprawną wartość dla Podz. (większą od 0).', lines: [] };
  const hr = evalExpr(holesText);
  const holes = hr === null ? null : jsRound(hr);
  if (holes === null || holes <= 0) return { error: 'Podaj poprawną wartość dla n (większą od 0).', lines: [] };
  let angle, angleText2 = null;
  if (!unlocked) { angle = 360 / holes; angleText2 = fixed(angle, 6); }
  else {
    const a = evalExpr(angleText);
    if (a === null || a <= 0) return { error: 'Podaj poprawną wartość kąta α (większą od 0).', lines: [] };
    if (holes * a > 360.0001) return { error: `n × α = ${fixed(holes * a, 4)}° > 360° — sprawdź dane.`, lines: [] };
    angle = a;
  }
  const lines = zTexts.map((t) => {
    const zr = evalExpr(t);
    const z = zr === null ? null : jsRound(zr);
    if (z === null || z < 2 || z > holes) return { z, text: 'Błąd: Nr otworu musi być >= 2 i <= n', isError: true };
    return { z, text: fixed(d * Math.sin(rad((angle * (z - 1)) / 2)), 3), isError: false };
  });
  return { error: null, angleText: angleText2, lines };
}

/** Współrzędne otworów na okręgu: X = r·cos θ, Y = r·sin θ, θ = (i−1)·α + kąt startowy. */
export function coordinates(diameterText, holesText, startText, unlocked, angleText) {
  const d = evalExpr(diameterText);
  const hr = evalExpr(holesText);
  const holes = hr === null ? null : jsRound(hr);
  if (d === null || d <= 0 || holes === null || holes <= 0) return { error: 'Podaj poprawnie Podz. i n (większe od 0).', points: [], lines: [] };
  const start = evalExpr(startText) ?? 0;
  const step = unlocked ? (() => { const a = evalExpr(angleText); return a !== null && a > 0 ? a : null; })() : 360 / holes;
  if (step === null) return { error: 'Podaj poprawną wartość kąta α.', points: [], lines: [] };
  const r = d / 2;
  const points = Array.from({ length: holes }, (_, i) => { const deg = i * step + start; return { index: i + 1, x: r * Math.cos(rad(deg)), y: r * Math.sin(rad(deg)), deg }; });
  return { error: null, diameter: d, points, lines: points.map((p) => `N${p.index} X=${fixed(p.x, 3)} Y=${fixed(p.y, 3)} ; Kąt=${fixed(p.deg, 6)}`) };
}

/** Posuw kątowy F° [°/min] → liniowy Fmm [mm/min]: π·Ø·F°/360. */
export function linearFeed(angularText, diameterText) {
  const a = evalExpr(angularText), d = evalExpr(diameterText);
  if (a === null || d === null || a <= 0 || d <= 0) return { text: 'Podaj poprawne wartości dla F° i Ø (większe od 0).', isError: true };
  return { text: `F° = ${plain(a)} °/min, Ø = ${plain(d)} mm, Fmm = ${fixed((Math.PI * d * a) / 360, 3)} mm/min`, isError: false };
}
