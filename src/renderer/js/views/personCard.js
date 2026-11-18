// Karta pracownika – wspólna dla całego programu (Grafik, Kompetencje, Plan): dane z Grafiku (stanowisko, urlopy, godziny, absencje)
// i z matrycy kompetencji (badania i BHP, uprawnienia z terminami, umiejętności, punkty). Otwierana wszędzie, gdzie jest nazwisko.
// Dane czytane z bazy przy otwarciu (gr_meta, gr_days roku, kp/main, config/main); część niedostępna dla poziomu użytkownika jest pomijana.
import { h, clear, modal } from '../ui.js';
import { firebase } from '../fb.js';
import * as F from '../logic/grafikFb.js';
import * as K from '../logic/competence.js';
import { stationList } from '../logic/harmModel.js';

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Osoba z listy Grafiku po identyfikatorze albo nazwisku (także skróconym „Nazwisko Imi” z Planu). */
export function findPerson(people, { id, name }) {
  const list = (people || []).filter((p) => p && !p.sep);
  if (id) { const p = list.find((x) => x.id === id); if (p) return p; }
  const n = norm(name); if (!n) return null;
  return list.find((x) => norm(x.name) === n) || list.find((x) => norm(x.name).startsWith(n)) || list.find((x) => n.startsWith(norm(x.name).split(' ')[0] + ' ') && norm(x.name).startsWith(n.slice(0, Math.max(4, n.length - 1)))) || null;
}

/** Sekcja kompetencji (badania i BHP, uprawnienia, umiejętności) – do wstawienia w dowolne okno. [kp] – dokument kp/main. */
export function competenceBlock(kp, id) {
  const p = (kp && kp.people || {})[id];
  if (!kp) return h('p', { class: 'muted' }, 'Kompetencje: brak dostępu (MASTER lub GOD) albo brak danych.');
  if (!p) return h('p', { class: 'muted' }, 'Brak danych w matrycy kompetencji.');
  const t = isoToday(), defs = K.isNewPermDefs(kp.perms) ? kp.perms : K.PERM_TYPES, skills = kp.skills || [];
  const row = (d) => {
    const pv = K.permOf(p, d.key), v = K.permValid(pv, d), lv = K.validLevel(v.iso, t, !!d.med), [bg, fg] = K.LEVEL_STYLE[lv] || ['', ''];
    return h('tr', {}, h('td', { class: 'left' }, d.name), h('td', { class: 'left' }, pv.nr || ''), h('td', {}, K.fmtPerm(pv.issued || '')),
      h('td', { style: { background: bg, color: fg, fontWeight: lv && lv !== 'green' ? 700 : 400, fontStyle: v.computed ? 'italic' : 'normal' } }, K.fmtPerm(v.iso) + (lv && lv !== 'green' ? ` – ${K.levelText(lv, !!d.med)}` : '')));
  };
  const types = [...K.MED_TYPES, ...defs.filter((d) => !K.isMedKey(d.key))].filter((d) => Object.keys(K.permOf(p, d.key)).length);
  const sk = skills.map((s) => ({ s, v: Number((p.skills || {})[s.key]) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v * b.s.weight - a.v * a.s.weight);
  return h('div', {},
    h('div', { class: 'row', style: { gap: '16px', flexWrap: 'wrap' } },
      ...[['Maszyna / stanowisko', p.machine], ['Stanowisko wg umowy', p.position], ['Komis wewn.', p.komis], ['Data zatrudnienia', K.fmtPerm(p.hired || '')], ['Punkty', String(K.points(p, skills))]]
        .filter(([, v]) => v).map(([k, v]) => h('span', {}, h('span', { class: 'muted' }, k + ': '), h('b', {}, v)))),
    types.length ? h('table', { class: 't', style: { marginTop: '6px' } }, h('thead', {}, h('tr', {}, ...['Badania / uprawnienie', 'Nr', 'Wydano', 'Ważne do'].map((x) => h('th', {}, x)))), h('tbody', {}, ...types.map(row)))
      : h('p', { class: 'muted' }, 'Brak wpisanych badań i uprawnień.'),
    sk.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' } }, ...sk.map(({ s, v }) => h('span', { title: `waga ${s.weight} · punkty ${v * s.weight}`,
      style: { border: '1px solid #999', borderLeft: `8px solid ${s.color}`, padding: '2px 6px', background: K.levelColor(v) || '#fff' } }, `${s.name}: ${v}%`))) : null);
}

/** Sekcja Grafiku (rok [year]): urlopy, godziny w miesiącach, absencje. [codes] – iso → kod. */
export function grafikBlock(p, codes, year) {
  const s = F.personSummary(p, codes || {}, year, isoToday()), ut = (p.ut || {})[year] || {};
  const red = (v) => (v < 0 ? { color: '#c00000' } : {});
  return h('div', {},
    h('div', { class: 'row', style: { gap: '14px', flexWrap: 'wrap' } },
      ...[['UT z ' + (Number(year) - 1), ut.prev || 0], ['UT ' + year, ut.cur || 0], ['Wykorzystane', s.used], ['Zaplanowane', s.future], ['Dostępny', s.available], ['Pozostało', s.remaining], ['Godziny ' + year, s.hoursToMonth[11]]]
        .map(([k, v]) => h('span', {}, h('span', { class: 'muted' }, k + ': '), h('b', { style: red(Number(v)) }, String(v))))),
    h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '14px', marginTop: '6px', flexWrap: 'wrap' } },
      h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Miesiąc', 'UT', 'Plan', 'Godziny', 'Narast.'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...F.MONTHS.map((mn, i) => h('tr', {}, h('td', { class: 'left' }, mn), h('td', { style: { background: s.monthPlanMet[i] ? '#ff9900' : '' } }, s.utByMonth[i] || ''), h('td', {}, s.plan[i] || ''), h('td', {}, s.hoursByMonth[i] || ''), h('td', {}, s.hoursToMonth[i] || ''))))),
      h('table', { class: 't' }, h('tbody', {}, ...F.ABSENCES.map(([k, label]) => { const st = F.absenceStyle(k); return h('tr', {}, h('td', { class: 'left', style: { background: st.bg, color: st.color } }, `${label} (${k})`), h('td', {}, s.absences[k] || 0)); })))));
}

/**
 * Karta pracownika z bazy: [who] = {id} albo {name}; [access] – poziom Grafiku (summary – urlopy i godziny). [extra] – przyciski dodatkowe.
 */
export async function openPersonCard(who, { access = { summary: true }, extra = [] } = {}) {
  const body = h('div', {}, h('p', { class: 'muted' }, 'Wczytywanie karty pracownika…'));
  const m = modal('Karta pracownika', h('div', {}, body, h('div', { class: 'actions' }, ...extra.map(([label, fn]) => h('button', { class: 'btn', onclick: () => { m.close(); fn(); } }, label)),
    h('button', { class: 'btn primary', onclick: () => m.close() }, 'Zamknij'))), { wide: true });
  try {
    const { sdk, db } = await firebase();
    const one = async (c, d) => { try { const s = await sdk.getDoc(sdk.doc(db, c, d)); return s.exists() ? s.data() : null; } catch { return null; } };
    const [meta, kp, cfg] = await Promise.all([one('gr_meta', 'main'), one('kp', 'main'), one('config', 'main')]);
    const p = findPerson(meta && meta.people, who);
    const id = p ? p.id : who.id;
    const year = String(new Date().getFullYear());
    clear(body);
    const stn = p ? F.placeStation(p.place, stationList(cfg)) : null;
    const title = h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', marginBottom: '6px' } },
      h('b', { style: { fontSize: '18px', padding: '2px 8px', background: stn ? stn.bg : '', color: stn ? stn.color : '' } }, p ? p.name : (who.name || who.id || '?')),
      p ? h('span', { class: 'muted' }, `${p.place ? 'stanowisko ' + p.place : 'bez stanowiska'}${p.nr ? ' · nr ' + p.nr : ''}`) : h('span', { class: 'err' }, 'nie znaleziono w Grafiku'));
    body.append(title);
    if (p && access.summary) {
      const months = F.monthsBetween(`${year}-01-01`, `${year}-12-31`);
      const docs = await Promise.all(months.map((mk) => one('gr_days', mk)));
      const codes = {};
      months.forEach((mk, i) => { const d = docs[i]; for (const [dd, v] of Object.entries(((d && d.c) || {})[p.id] || {})) codes[`${mk}-${dd}`] = v; });
      body.append(h('h4', { style: { margin: '6px 0 4px' } }, `Grafik ${year}`), grafikBlock(p, codes, year));
    }
    body.append(h('h4', { style: { margin: '10px 0 4px' } }, 'Kompetencje'), competenceBlock(kp, id));
  } catch (e) { clear(body); body.append(h('p', { class: 'err' }, 'Nie wczytano karty: ' + (e.message || e))); }
  return m;
}
