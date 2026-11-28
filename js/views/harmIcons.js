// Ikony paska Harmonogramu (te same kształty co w aplikacji na Androida: harmfb/HarmFbScreen.kt, ToolIcon) jako SVG 16×16.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
const P = (x, y) => `${(x * 16).toFixed(2)} ${(y * 16).toFixed(2)}`;

/** SVG ikony [name]: share, gear, broom, eye, eyeOff, sigma, sigmaOff, plus, refresh, undo. Kolor = currentColor. */
export function iconSvg(name, size = 18) {
  const svg = el('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const add = (tag, attrs) => svg.append(el(tag, attrs));
  switch (name) {
    case 'share':
      add('path', { d: `M${P(0.25, 0.5)} L${P(0.78, 0.2)} M${P(0.25, 0.5)} L${P(0.78, 0.8)}` });
      for (const [x, y] of [[0.78, 0.2], [0.25, 0.5], [0.78, 0.8]]) add('circle', { cx: x * 16, cy: y * 16, r: 2.24, fill: 'currentColor', stroke: 'none' });
      break;
    case 'gear':
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a); add('line', { x1: 8 + c * 4.48, y1: 8 + s * 4.48, x2: 8 + c * 7.68, y2: 8 + s * 7.68, 'stroke-width': 2.56, 'stroke-linecap': 'butt' }); }
      add('circle', { cx: 8, cy: 8, r: 5.28, fill: 'currentColor', stroke: 'none' });
      add('circle', { cx: 8, cy: 8, r: 2.24, fill: 'var(--icon-hole, #fff)', stroke: 'none' });
      break;
    case 'broom':
      add('line', { x1: 14.72, y1: 0.96, x2: 8.32, y2: 7.68, 'stroke-width': 1.8 });
      add('path', { d: `M${P(0.43, 0.40)} L${P(0.61, 0.56)} L${P(0.37, 0.97)} L${P(0.04, 0.70)} Z`, fill: 'currentColor', stroke: 'none' });
      break;
    case 'eye': case 'eyeOff':
      add('ellipse', { cx: 8, cy: 8, rx: 7.36, ry: 4.16 });
      add('circle', { cx: 8, cy: 8, r: 2.24, fill: 'currentColor', stroke: 'none' });
      if (name === 'eyeOff') add('line', { x1: 1.28, y1: 14.72, x2: 14.72, y2: 1.28, 'stroke-width': 1.9 });
      break;
    case 'sigma': case 'sigmaOff':
      add('path', { d: `M${P(0.82, 0.14)} L${P(0.2, 0.14)} L${P(0.56, 0.5)} L${P(0.2, 0.86)} L${P(0.82, 0.86)}`, 'stroke-width': 1.9 });
      if (name === 'sigmaOff') add('line', { x1: 0.8, y1: 15.2, x2: 15.2, y2: 0.8 });
      break;
    case 'undo': {   // cofnij: łuk ze strzałką w lewo
      add('path', { d: 'M4.2 6.4 H10.2 A3.9 3.9 0 0 1 10.2 14.2 H6.4', 'stroke-width': 1.8 });
      add('path', { d: 'M5.8 2.6 L1.8 6.4 L5.8 10.2 Z', fill: 'currentColor', stroke: 'none' });
      break;
    }
    case 'plus':
      add('path', { d: `M8 1.6 V14.4 M1.6 8 H14.4`, 'stroke-width': 2.1 });
      break;
    case 'refresh': {
      const r = 5.76, a0 = (-50 * Math.PI) / 180, a1 = (230 * Math.PI) / 180;
      add('path', { d: `M${8 + r * Math.cos(a0)} ${8 + r * Math.sin(a0)} A${r} ${r} 0 1 1 ${8 + r * Math.cos(a1)} ${8 + r * Math.sin(a1)}`, 'stroke-width': 1.8 });
      const tx = 8 + r * Math.cos(a1), ty = 8 + r * Math.sin(a1), hd = 3.2;
      add('path', { d: `M${tx - hd * 0.7} ${ty - hd * 0.7} L${tx + hd * 0.75} ${ty - hd * 0.35} L${tx + hd * 0.05} ${ty + hd * 0.8} Z`, fill: 'currentColor', stroke: 'none' });
      break;
    }
    default: break;
  }
  return svg;
}
