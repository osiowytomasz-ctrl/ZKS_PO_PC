import { h, clear, field } from '../ui.js';
import * as K from '../logic/help.js';
import { MODULES } from '../app.js';

/** Help: u góry przyciski Symulator, SymulatorNUM i Pomiary (inHelp), pod nimi kalkulatory. */
export function mountHelp(el, ctx) {
  const inp = (ph, value = '') => h('input', { type: 'text', placeholder: ph, value, spellcheck: 'false' });
  const out = () => h('div', { style: { whiteSpace: 'pre-wrap', margin: '6px 0', fontFamily: 'monospace' } });
  const show = (box, text, err) => { box.textContent = text; box.style.color = err ? '#b00020' : '#1b5e20'; };
  const card = (title, ...c) => h('div', { class: 'panel', style: { marginBottom: '12px' } }, h('h2', {}, title), ...c);

  // Posuw Ra / R
  const ra = inp('np. 1.6', '1.6'), rr = inp('np. 0.8', '0.8'), o1 = out();
  const feedCard = card('Posuw dla Rply i Ra', h('div', { class: 'row' }, field('Ra [µm]', ra), field('R płytki [mm]', rr)),
    h('button', { class: 'btn primary', onclick: () => { const r = K.feed(ra.value, rr.value); show(o1, r.text, r.isError); } }, 'Oblicz posuw'), o1);

  // Cięciwy
  const dia = inp('Ø podziału', '100'), n = inp('n otworów', '8'), alpha = inp('α [°]', ''), lock = h('input', { type: 'checkbox' });
  alpha.disabled = true;
  lock.addEventListener('change', () => { alpha.disabled = !lock.checked; });
  const zIn = [inp('nr', '2'), inp('nr', '3'), inp('nr', '4')];
  const o2 = out();
  const chordCard = card('Cięciwy na podziale',
    h('div', { class: 'row' }, field('Podz. Ø [mm]', dia), field('n', n), field('α [°]', alpha), h('label', { class: 'row' }, lock, 'Odblokuj α')),
    h('div', { class: 'row' }, 'Cięciwa 1 do:', ...zIn),
    h('button', { class: 'btn primary', onclick: () => {
      const r = K.chords(dia.value, n.value, lock.checked, alpha.value, zIn.map((x) => x.value));
      if (r.error) return show(o2, r.error, true);
      if (r.angleText) alpha.value = r.angleText;
      show(o2, r.lines.map((l) => `1 → ${l.z ?? '?'}: ${l.text}${l.isError ? '' : ' [mm]'}`).join('\n'), false);
    } }, 'Oblicz'), o2);

  // Współrzędne
  const cd = inp('Ø', '100'), cn = inp('n', '6'), cs = inp('kąt startowy [°]', '0'), ca = inp('α [°]', ''), cl = h('input', { type: 'checkbox' });
  ca.disabled = true; cl.addEventListener('change', () => { ca.disabled = !cl.checked; });
  const o3 = out(), canvas = h('canvas', { width: 280, height: 280, style: { background: '#fff', border: '1px solid #ccc', display: 'block', margin: '6px 0' } });
  const coordCard = card('Współrzędne otworów na podziale',
    h('div', { class: 'row' }, field('Podz. Ø [mm]', cd), field('n', cn), field('Start [°]', cs), field('α [°]', ca), h('label', { class: 'row' }, cl, 'Odblokuj α')),
    h('button', { class: 'btn primary', onclick: () => {
      const r = K.coordinates(cd.value, cn.value, cs.value, cl.checked, ca.value);
      if (r.error) { show(o3, r.error, true); canvas.getContext('2d').clearRect(0, 0, 280, 280); return; }
      show(o3, r.lines.join('\n'), false);
      const g = canvas.getContext('2d'); g.clearRect(0, 0, 280, 280);
      const sc = 100 / (r.diameter / 2); g.strokeStyle = '#888'; g.beginPath(); g.arc(140, 140, 100, 0, 7); g.stroke();
      g.strokeStyle = '#ccc'; g.beginPath(); g.moveTo(10, 140); g.lineTo(270, 140); g.moveTo(140, 10); g.lineTo(140, 270); g.stroke();
      g.fillStyle = '#000'; g.font = '11px sans-serif';
      for (const p of r.points) { const x = 140 + p.x * sc, y = 140 - p.y * sc; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
        g.fillStyle = 'red'; g.fillText('N' + p.index, 140 + p.x * sc * 1.1 - 8, 140 - p.y * sc * 1.1 + 4); g.fillStyle = '#000'; }
    } }, 'Oblicz'), canvas, o3);

  // F° → Fmm
  const fa = inp('F° [°/min]', '360'), fd = inp('Ø [mm]', '100'), o4 = out();
  const linCard = card('F° na Fmm', h('div', { class: 'row' }, field('F° [°/min]', fa), field('Ø [mm]', fd)),
    h('button', { class: 'btn primary', onclick: () => { const r = K.linearFeed(fa.value, fd.value); show(o4, r.text, r.isError); } }, 'Oblicz Fmm'), o4);

  const modules = h('div', { class: 'grid-modules', style: { maxWidth: '760px' } },
    ...MODULES.filter((m) => m.inHelp).map((m) => h('button', { class: 'mod ' + (m.style || ''), disabled: !!m.disabled, onclick: () => ctx.go(m.id) }, m.title)));

  el.append(h('div', { style: { maxWidth: '760px', margin: '0 auto' } }, modules,
    h('p', { class: 'muted' }, 'Pola przyjmują wyrażenia jak w arkuszu, np. pi*100, 360/8, sqrt(2).'), feedCard, chordCard, coordCard, linCard));
}
