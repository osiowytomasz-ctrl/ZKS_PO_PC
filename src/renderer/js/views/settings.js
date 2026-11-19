import { h, field, api, toast, confirmBox } from '../ui.js';
import { permissionsSummary } from '../logic/common.js';
import { firebase, resetFirestoreCache } from '../fb.js';
import { defaultRange } from '../logic/grafik.js';
import { holidaysPanel } from './holidays.js';
import { importKartyFromSheet } from '../pomiaryStore.js';
import { grafikAccess, grafikLevelOf } from '../logic/grafikAccess.js';
import { openGrafikCodes } from './grafikCodes.js';
import { openUsersAdmin } from './usersAdmin.js';

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
      const user = await ctx.loadUser({ fresh: true });
      if (!user) throw new Error(ctx.userError || 'Brak odpowiedzi.');
      status.className = ''; status.style.color = '#1b5e20';
      const gl = user.grafikLevel ? `${String(user.grafikLevel).toUpperCase()} (z kolumny „Grafik dostęp”)` : `serwer nie podaje poziomu – w Apps Script nie ma nowej wersji Api.gs i Firebase.gs (program przyjmuje ${grafikAccess(grafikLevelOf(user)).label} z kolumny „Grafik”)`;
      status.textContent = `Połączono jako ${user.name || user.email} (${user.email}).\nUprawnienia: ${permissionsSummary(user.permissions)}\nGrafik i Kompetencje: ${gl}`;
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
    const tests = [['Puste wywołanie (api_whoami), 1', 'api_whoami', []], ['Puste wywołanie (api_whoami), 2', 'api_whoami', []], ['Grafik (getGrData)', 'getGrData', [s, e, 'fresh']]];
    const out = []; const res = {};
    for (const [label, fn, args] of tests) {
      const r = await timed(fn, args); res[label] = r;
      out.push(`${label}: ${r.ok ? fmt(r.ms) + (r.bytes ? `, odpowiedź ${(r.bytes / 1024).toFixed(0)} KB` : '') : 'błąd: ' + r.err}`);
    }
    const floor = Math.min(res['Puste wywołanie (api_whoami), 1'].ms, res['Puste wywołanie (api_whoami), 2'].ms);
    const gr = res['Grafik (getGrData)'];
    out.push('');
    out.push(`Minimalny czas serwera Apps Script (puste wywołanie): ${fmt(floor)}.`);
    if (gr.ok) out.push(`Czas czytania arkusza w Grafiku: ok. ${fmt(Math.max(0, gr.ms - floor))} (reszta to stały narzut serwera).`);
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
      h('button', { class: 'btn', title: 'Usuwa zapamiętane dane z arkusza (listy, grafik, katalog narzędzi)', onclick: async () => { await window.zks.cacheClear(); toast('Wyczyszczono pamięć podręczną'); } }, 'Wyczyść pamięć podręczną'),
      h('button', { class: 'btn', title: 'Usuwa lokalną kopię bazy Firebase (Grafik, Harmonogram, Kompetencje, Workflow) i przeładowuje program – dane pobiorą się od nowa z serwera. Gdy na tym komputerze brakuje danych, które inni widzą.', onclick: async () => {
        if (!(await confirmBox('Pamięć bazy', 'Usunąć lokalną kopię bazy Firebase na tym komputerze i przeładować program? Dane w bazie zostają; pobiorą się od nowa.', 'Wyczyść i przeładuj'))) return;
        await resetFirestoreCache('ręcznie z Ustawień', true);
      } }, 'Wyczyść pamięć bazy')),
    status, speed, fbOut,
    // Dostęp: klucze do programu (administrator) i kody do Grafiku na telefonie (MASTER, GOD)
    cfg.url && cfg.key && (grafikAccess(grafikLevelOf(ctx.user)).manage) ? h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Dostęp'),
      h('p', { class: 'muted' }, 'Klucze dostępu do programu (PC i Android) nadaje administrator. Kody iPhone – osobiste kody pracowników do Grafiku do wglądu w przeglądarce telefonu (strona …/exec?p=grafik).'),
      h('div', { class: 'row' },
        grafikLevelOf(ctx.user) === 'god' ? h('button', { class: 'btn', title: 'Konta z zakładki Uzytkownicy: klucze, nowi użytkownicy (tylko administrator)', onclick: () => openUsersAdmin() }, 'Użytkownicy i klucze') : null,
        h('button', { class: 'btn', title: 'Osobiste kody pracowników do Grafiku na telefonie (iPhone, przeglądarka)', onclick: async () => {
          try {
            const { sdk, db } = await firebase();
            const m = await sdk.getDoc(sdk.doc(db, 'gr_meta', 'main'));
            const people = (m.exists() && m.data().people) || [];
            await openGrafikCodes({ people: () => people, user: ctx.user });
          } catch (e) { toast('Kody iPhone: ' + (e.message || e), true); }
        } }, 'Kody iPhone'))) : null,
    cfg.url && cfg.key ? holidaysPanel() : null,
    // Pomiary: karty są w bazie Firebase; jednorazowe przeniesienie dawnych kart z arkusza „Karty pomiarowe” (GOD)
    cfg.url && cfg.key && grafikLevelOf(ctx.user) === 'god' ? h('div', { style: { marginTop: '14px' } }, h('h3', {}, 'Pomiary'),
      h('p', { class: 'muted' }, 'Karty pomiaru zapisują się w bazie Firebase (bez arkusza). Dawne karty z arkusza „Karty pomiarowe” można raz przenieść do bazy.'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmBox('Pomiary', 'Przenieść wszystkie karty z arkusza „Karty pomiarowe” do bazy? Karty już przeniesione zostaną nadpisane danymi z arkusza; karty zapisane w programie zostają.', 'Przenieś'))) return;
        try { toast('Przeniesiono kart: ' + (await importKartyFromSheet(ctx.user && ctx.user.email))); } catch (e) { toast('Nie przeniesiono: ' + (e.message || e), true); }
      } }, 'Przenieś karty z arkusza do bazy')) : null,
    h('p', { class: 'muted' }, window.zks ? '' : '')));
}
