'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zks', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (cfg) => ipcRenderer.invoke('settings:save', cfg),
  syncLink: (force) => ipcRenderer.invoke('link:sync', !!force),       // przyjęcie adresu API z bazy (jeśli nowszy)
  remoteLink: () => ipcRenderer.invoke('link:remote'),                  // aktualny wpis z bazy: { ok, link }
  checkLink: (text) => ipcRenderer.invoke('link:check', text),         // składnia adresu: { ok, url | error }
  call: (fn, args, opts) => ipcRenderer.invoke('api:call', fn, args || [], opts || {}),
  cacheGet: (fn, args) => ipcRenderer.invoke('cache:get', fn, args || []),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  saveFile: (name, mime, base64) => ipcRenderer.invoke('file:save', name, mime, base64),
  saveText: (name, text) => ipcRenderer.invoke('file:saveText', name, text),
  printHtml: (html) => ipcRenderer.invoke('file:printHtml', html),
  savePdf: (html, opts) => ipcRenderer.invoke('file:savePdf', html, opts || {}),
  openLastSaved: () => ipcRenderer.invoke('file:openLast'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  printReport: (html, opts) => ipcRenderer.invoke('file:print', html, opts || {}),
  copyImage: (base64) => ipcRenderer.invoke('clipboard:image', base64),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
});
