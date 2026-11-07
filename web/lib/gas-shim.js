/**
 * gas-shim.js: most między stronami HTML modułów (Symulator, SymulatorNUM, Pomiary) a aplikacją Android.
 *
 * Strony napisano dla Apps Script i wołają serwer przez `google.script.run.nazwaFunkcji(...)`. W aplikacji
 * ten sam kod działa bez zmian: poniżej `google.script.run` przekazuje wywołanie do natywnego mostu
 * `AndroidBridge` (klasa GasBridge w Kotlinie), a ten wysyła je do API Apps Script z kluczem użytkownika.
 * Klucz nigdy nie trafia do strony.
 *
 * Dodatkowo shim zastępuje to, czego nie ma w WebView:
 *  - pobieranie plików (`<a download>` z blobem) → okno zapisu pliku w Androidzie,
 *  - `window.open('', '_blank')` + `document.write` + `print()` (raport PDF) → drukowanie/zapis do PDF,
 *  - `window.parent.currentUserEmail/currentUserName` oraz `window.parent.closeSymulator()`.
 *
 * Testy: `node tools/test-gas-shim.js`.
 */
(function (global) {
  'use strict';
  if (global.__gasShimInstalled) return;
  global.__gasShimInstalled = true;

  var bridge = global.AndroidBridge;
  var pending = {};
  var seq = 0;

  // ---- google.script.run -------------------------------------------------------------------------------

  /** Wywoływane przez aplikację po zakończeniu wywołania serwera. */
  global.__gasDone = function (id, ok, payload) {
    var call = pending[id];
    if (!call) return;
    delete pending[id];
    try {
      if (ok) {
        if (call.success) call.success(payload, call.user);
      } else {
        var err = new Error((payload && payload.message) || 'Błąd serwera.');
        if (call.failure) call.failure(err, call.user);
        else if (global.console) console.error('google.script.run: ' + err.message);
      }
    } catch (e) {
      if (global.console) console.error('google.script.run: błąd w obsłudze odpowiedzi', e);
    }
  };

  function fail(state, message) {
    setTimeout(function () {
      if (state.failure) state.failure(new Error(message), state.user);
    }, 0);
  }

  function invoke(state, name, args) {
    if (!bridge || typeof bridge.call !== 'function') {
      fail(state, 'Brak połączenia ze skryptem aplikacji.');
      return;
    }
    var id = 'c' + (++seq);
    pending[id] = { success: state.success, failure: state.failure, user: state.user };
    try {
      bridge.call(id, name, JSON.stringify(args));
    } catch (e) {
      delete pending[id];
      fail(state, 'Nie udało się wysłać żądania: ' + (e && e.message ? e.message : e));
    }
  }

  function runner(state) {
    return new Proxy({}, {
      get: function (_target, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        if (name === 'withSuccessHandler') {
          return function (fn) { return runner({ success: fn, failure: state.failure, user: state.user }); };
        }
        if (name === 'withFailureHandler') {
          return function (fn) { return runner({ success: state.success, failure: fn, user: state.user }); };
        }
        if (name === 'withUserObject') {
          return function (obj) { return runner({ success: state.success, failure: state.failure, user: obj }); };
        }
        return function () { invoke(state, name, Array.prototype.slice.call(arguments)); };
      }
    });
  }

  var google = global.google = global.google || {};
  google.script = google.script || {};
  google.script.run = runner({});
  google.script.host = {
    close: function () { if (bridge && bridge.close) bridge.close(); },
    setHeight: function () {},
    setWidth: function () {}
  };

  // ---- użytkownik i zamknięcie modułu ------------------------------------------------------------------

  try {
    var user = JSON.parse(bridge.userInfo());
    global.currentUserEmail = user.email || '';
    global.currentUserName = user.name || '';
  } catch (e) { /* brak danych: pola zostają puste do ręcznego wpisania */ }

  // Strony wołają window.parent.closeSymulator(); w WebView parent === window.
  global.closeSymulator = function () { if (bridge && bridge.close) bridge.close(); };

  // ---- pobieranie plików -------------------------------------------------------------------------------

  var blobs = new Map();
  if (global.URL && typeof global.URL.createObjectURL === 'function') {
    var nativeCreate = global.URL.createObjectURL.bind(global.URL);
    var nativeRevoke = global.URL.revokeObjectURL.bind(global.URL);
    global.URL.createObjectURL = function (obj) {
      var url = nativeCreate(obj);
      blobs.set(url, obj);
      return url;
    };
    global.URL.revokeObjectURL = function (url) {
      // Strony odwołują adres zaraz po kliknięciu; blob potrzebny jest jeszcze chwilę do odczytu.
      setTimeout(function () { blobs.delete(url); }, 15000);
      nativeRevoke(url);
    };
  }

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunk = 0x8000;
    var text = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(text);
  }

  function saveBlob(name, blob) {
    return blob.arrayBuffer().then(function (buffer) {
      bridge.saveFile(name, blob.type || 'application/octet-stream', toBase64(buffer));
    });
  }

  function handleDownload(anchor) {
    var href = anchor.href || '';
    var name = anchor.getAttribute('download') || 'plik';
    var known = blobs.get(href);
    var source = known
      ? Promise.resolve(known)
      : /^(blob|data):/.test(href)
        ? fetch(href).then(function (r) { return r.blob(); })
        : null;
    if (!source) return false;
    source.then(function (blob) { return saveBlob(name, blob); }).catch(function (e) {
      if (global.console) console.error('Zapis pliku nie powiódł się', e);
      if (typeof global.alert === 'function') global.alert('Nie udało się zapisać pliku: ' + (e && e.message ? e.message : e));
    });
    return true;
  }

  if (bridge && typeof bridge.saveFile === 'function' && global.HTMLAnchorElement) {
    var nativeClick = global.HTMLAnchorElement.prototype.click;
    global.HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download') && handleDownload(this)) return;
      return nativeClick.apply(this, arguments);
    };
    global.document.addEventListener('click', function (event) {
      var target = event.target;
      var anchor = target && target.closest ? target.closest('a[download]') : null;
      if (anchor && handleDownload(anchor)) event.preventDefault();
    }, true);
  }

  // ---- raport w nowym oknie (drukowanie do PDF) -------------------------------------------------------

  global.open = function (url) {
    if (url) return null; // zewnętrzne adresy są w aplikacji zablokowane
    var parts = [];
    return {
      document: {
        open: function () { parts = []; },
        write: function (html) { parts.push(String(html)); },
        close: function () {}
      },
      focus: function () {},
      close: function () {},
      print: function () { if (bridge && bridge.printHtml) bridge.printHtml(parts.join('')); }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
