'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zks', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (cfg) => ipcRenderer.invoke('settings:save', cfg),
  call: (fn, args, opts) => ipcRenderer.invoke('api:call', fn, args || [], opts || {}),
  saveFile: (name, mime, base64) => ipcRenderer.invoke('file:save', name, mime, base64),
  saveText: (name, text) => ipcRenderer.invoke('file:saveText', name, text),
  printHtml: (html) => ipcRenderer.invoke('file:printHtml', html),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
});
