import { h, field, api, toast } from '../ui.js';
import { permissionsSummary } from '../logic/common.js';
import { firebase } from '../fb.js';
import { defaultRange } from '../logic/grafik.js';

export async function mountSettings(el, ctx) {
  const cfg = await window.zks.getSettings();
  const url = h('input', { type: 'text', value: cfg.url, placeholder: 'https://script.google.com/macros/s/…/exec', spellcheck: 'false' });
  const key = h('input', { type: 'password', value: cfg.key, placeholder: 'Klucz użytkownika', spellcheck: 'false', autocomplete: 'off' });
  const show = h('input', { type: 'checkbox', onchange: () => { key.type = show.checked ? 'text' : 'password'; } });
  const status = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });

  const save = async () => {
    await window.zks.saveSettings({ url: url.value, key: key.value });
    toast('Zapisano ustawienia');
  };
  const check = async () => {
    await save();
    status.className = 'muted'; status.textContent = 'Sprawdzanie połączenia…';
    try {
      const user = await ctx.loadUser();
      if (!user) throw new Error(ctx.userError || 'Brak odpowiedzi.');
      status.className = ''; status.style.color = '#1b5e20';
      status.textContent = `Połączono jako ${user.name || user.email} (${user.email}).\nUprawnienia: ${permissionsSummary(user.permissions)}`;
    } catch (e) {
      status.className = 'err'; status.textContent = e.message;
    }
  };

  const speed = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });
  const fmt = (ms) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');
  const timed = async (fn, args) => { const t = performance.now(); const r = await window.zks.call(fn, args, { timeoutMs: 180000 }); return { ms: performance.now() - t, ok: r.ok, err: r.error, bytes: r.ok ? JSON.stringify(r.data).length : 0 }; };
  const speedTest = async () => {
    await save();
    speed.className = 'muted'; speed.textContent = 'Mierzenie… (kilka sekund)';
    const [s, e] = defaultRange();
    const tests = [['Puste wywołanie (api_whoami), 1', 'api_whoami', []], ['Puste wywołanie (api_whoami), 2', 'api_whoami', []], ['Grafik (getGrData)', 'getGrData', [s, e, 'fresh']], ['Harmonogram (getHarmData)', 'getHarmData', ['fresh']]];
    const out = []; const res = {};
    for (const [label, fn, args] of tests) {
      const r = await timed(fn, args); res[label] = r;
      out.push(`${label}: ${r.ok ? fmt(r.ms) + (r.bytes ? `, odpowiedź ${(r.bytes / 1024).toFixed(0)} KB` : '') : 'błąd: ' + r.err}`);
    }
    const floor = Math.min(res['Puste wywołanie (api_whoami), 1'].ms, res['Puste wywołanie (api_whoami), 2'].ms);
    const gr = res['Grafik (getGrData)'], hm = res['Harmonogram (getHarmData)'];
    out.push('');
    out.push(`Minimalny czas serwera Apps Script (puste wywołanie): ${fmt(floor)}.`);
    if (gr.ok) out.push(`Czas czytania arkusza w Grafiku: ok. ${fmt(Math.max(0, gr.ms - floor))} (reszta to stały narzut serwera).`);
    if (hm.ok) out.push(`Czas czytania arkusza w Harmonogramie: ok. ${fmt(Math.max(0, hm.ms - floor))}.`);
    speed.textContent = out.join('\n');
  };
  const fbOut = h('div', { class: 'muted', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } });
  const fbTest = async () => {
    await save();
    fbOut.className = 'muted'; fbOut.textContent = 'Łączenie z Firebase…';
    try {
      const t0 = performance.now();
      const { sdk, db } = await firebase();
      const t1 = performance.now();
      const ref = sdk.doc(db, 'test', 'ping');
      await sdk.setDoc(ref, { at: Date.now() });
      const t2 = performance.now();
      const snap = await sdk.getDoc(ref);
      const t3 = performance.now();
      fbOut.textContent = `Firebase działa.\nLogowanie: ${fmt(t1 - t0)}\nZapis: ${fmt(t2 - t1)}\nOdczyt: ${fmt(t3 - t2)} (dokument ${snap.exists() ? 'jest' : 'brak'})`;
    } catch (e) {
      fbOut.className = 'muted err'; fbOut.textContent = 'Błąd Firebase: ' + (e.code || '') + ' ' + (e.message || e);
    }
  };
  el.append(h('div', { class: 'panel', style: { maxWidth: '640px', margin: '20px auto' } },
    h('h2', {}, 'Połączenie z serwerem'),
    h('p', { class: 'muted' }, 'Adres i klucz są te same co w aplikacji na telefonie. Klucz jest przechowywany w pliku szyfrowanym przez system (gdy system to umożliwia) i jest wysyłany wyłącznie w treści żądania do podanego adresu.'),
    field('Adres API (…/exec)', url),
    field('Klucz użytkownika', key),
    h('label', { class: 'row muted' }, show, 'Pokaż klucz'),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary', onclick: check }, 'Zapisz i sprawdź połączenie'),
      h('button', { class: 'btn', title: 'Mierzy czas odpowiedzi serwera dla pustego wywołania, Grafiku i Harmonogramu', onclick: speedTest }, 'Test szybkości'),
      h('button', { class: 'btn', title: 'Sprawdza logowanie i zapis/odczyt w bazie Firebase', onclick: fbTest }, 'Test Firebase'),
      h('button', { class: 'btn', onclick: async () => { await save(); await ctx.loadUser(); ctx.go('home'); } }, 'Zapisz i wróć'),
      h('button', { class: 'btn', title: 'Otwiera stronę z najnowszą wersją aplikacji (plik .exe)', onclick: () => window.zks.openExternal('https://github.com/osiowytomasz-ctrl/ZKS_PO_PC/releases/tag/latest') }, 'Aktualizuj'),
      h('button', { class: 'btn', title: 'Usuwa zapamiętane dane z arkusza (listy, grafik, katalog narzędzi)', onclick: async () => { await window.zks.cacheClear(); toast('Wyczyszczono pamięć podręczną'); } }, 'Wyczyść pamięć podręczną')),
    status, speed, fbOut,
    h('p', { class: 'muted' }, window.zks ? '' : '')));
}
