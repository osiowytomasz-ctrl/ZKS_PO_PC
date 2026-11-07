/**
 * desktop-bridge.js: odpowiednik natywnego mostu `AndroidBridge` dla wersji na komputer.
 * Ładowany przed gas-shim.js. Strona działa w ramce, więc wszystkie wywołania idą do głównego okna aplikacji
 * przez postMessage (klucz API zna tylko proces główny Electrona, strona go nie widzi).
 */
(function (global) {
  'use strict';
  var params = new URLSearchParams(global.location.search);
  var user = JSON.stringify({ email: params.get('email') || '', name: params.get('name') || '' });
  function post(msg) { global.parent.postMessage(msg, '*'); }

  global.AndroidBridge = {
    call: function (id, fn, argsJson) {
      var args = [];
      try { args = JSON.parse(argsJson); } catch (e) { /* puste argumenty */ }
      post({ type: 'gas-call', id: id, fn: fn, args: args });
    },
    userInfo: function () { return user; },
    saveFile: function (name, mime, base64) { post({ type: 'save-file', name: name, mime: mime, base64: base64 }); },
    printHtml: function (html) { post({ type: 'print-html', html: html }); },
    close: function () { post({ type: 'close' }); },
  };

  global.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source === global.parent && d && d.type === 'gas-done' && typeof global.__gasDone === 'function') {
      global.__gasDone(d.id, d.ok, d.payload);
    }
  });
})(window);
