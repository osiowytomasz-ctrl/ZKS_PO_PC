import { h } from '../ui.js';
import { MODULES } from '../app.js';

/** Narzędziownia: przyciski modułów związanych z narzędziami (po 3 w wierszu, jak na ekranie głównym). */
export function mountToolRoom(el, ctx) {
  const grid = h('div', { class: 'grid-modules' });
  for (const m of MODULES.filter((x) => x.inToolRoom)) {
    grid.append(h('button', { class: 'mod ' + (m.style || ''), disabled: !!m.disabled, title: m.disabled ? 'Moduł w budowie' : '', onclick: () => ctx.go(m.id) }, m.title));
  }
  el.append(grid);
}
