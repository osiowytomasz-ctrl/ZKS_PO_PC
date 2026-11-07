import { h } from '../ui.js';
export function mountPlaceholder(el, ctx, mod) {
  el.append(h('div', { class: 'panel', style: { maxWidth: '520px', margin: '40px auto', textAlign: 'center' } },
    h('h2', {}, mod ? mod.title : 'Moduł'),
    h('p', {}, 'Ten moduł jest w budowie. Wersja na Androida ma go już w aplikacji; w wersji na komputer pojawi się w kolejnym etapie.'),
    h('button', { class: 'btn', onclick: () => ctx.home() }, 'Wróć')));
}
