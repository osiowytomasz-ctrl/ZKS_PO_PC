import { h, clear } from '../ui.js';
import { MENU } from '../logic/mistrz.js';

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez pamięci przeglądarki */ } };

/**
 * Przyciski główne modułu Mistrz w drugim rzędzie nagłówka (ctx.nav2): Dane Pracowników | Rejestr KTK | Rejestr Detali | Archiwa.
 * [active] – klucz wybranej grupy ('dane' w module Kompetencje); wybrana ma zieloną poświatę. [onGroup](g, tab) – wybór grupy z zakładkami
 * (w Mistrzu: odświeżenie widoku; w Kompetencjach: przejście do Mistrza). Dane Pracowników otwierają moduł Kompetencje (tylko przy prawie).
 */
export function drawMistrzNav(ctx, active, onGroup) {
  const nav = ctx.nav2; if (!nav) return;
  clear(nav);
  const canDane = ctx.grafikAcc ? !!ctx.grafikAcc().competence : false;
  for (const g of MENU) {
    if (g.module && !canDane) continue;
    nav.append(h('button', { class: 'btn small' + (g.key === active ? ' glow' : ''), title: g.module ? 'Dane pracowników, kompetencje i uprawnienia' : g.label,
      onclick: () => {
        if (g.module) return g.key === active ? null : ctx.go(g.module);
        const last = lsGet('mp.tab.' + g.key, g.tabs[0][0]);
        const tab = g.tabs.some(([k]) => k === last) ? last : g.tabs[0][0];
        lsSet('mp.tab', tab);
        onGroup(g, tab);
      } }, g.label));
  }
}
