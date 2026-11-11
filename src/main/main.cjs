'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, safeStorage, clipboard, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { callApi } = require('./apiCore.cjs');
const { createStore } = require('./settings.cjs');

const WEB_SCHEME = 'zks-web';
const WEB_ROOT = path.join(__dirname, '..', '..', 'web');

protocol.registerSchemesAsPrivileged([
  { scheme: WEB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let store;

/** Plik pamięci podręcznej dla wywołania; klucz zawiera adres i klucz użytkownika, więc dane różnych osób się nie mieszają. */
function cacheFile(fn, args) {
  const cfg = store.load();
  const h = crypto.createHash('sha256').update(JSON.stringify([cfg.url, cfg.key, fn, args])).digest('hex').slice(0, 40);
  return path.join(app.getPath('userData'), 'cache', h + '.json');
}
let mainWindow;

/** Zwraca bezpieczną nazwę pliku (bez ścieżki). */
function safeName(name) {
  const base = path.basename(String(name || 'plik')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return base || 'plik';
}

/** Rozwiązuje adres zks-web://app/… do pliku w katalogu web/; null przy próbie wyjścia poza katalog. */
function resolveWebPath(requestUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(requestUrl).pathname); } catch (e) { return null; }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const target = path.normalize(path.join(WEB_ROOT, pathname));
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) return null;
  return target;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#808080',
    title: 'ZKS PO',
    icon: path.join(__dirname, '..', 'renderer', 'img', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Zewnętrzne linki otwieramy w przeglądarce systemowej, nigdy w oknie aplikacji.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'), safeStorage);

  protocol.handle(WEB_SCHEME, (request) => {
    const file = resolveWebPath(request.url);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  ipcMain.handle('settings:get', () => store.load());
  ipcMain.handle('settings:save', (_e, cfg) => { store.save(cfg || {}); return true; });
  ipcMain.handle('api:call', (_e, fn, args, opts) => {
    if (typeof fn !== 'string' || !/^[A-Za-z0-9_]{1,80}$/.test(fn)) {
      return { ok: false, code: 'UNKNOWN_FN', error: 'Nieprawidłowa nazwa funkcji.' };
    }
    const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? Math.min(opts.timeoutMs, 600000) : undefined;
    const list = Array.isArray(args) ? args : [];
    return callApi(store.load(), fn, list, { fetch: (u, o) => net.fetch(u, o), timeoutMs }).then((r) => {
      if (r.ok && opts && opts.cache) {
        try {
          const f = cacheFile(fn, (opts && Array.isArray(opts.cacheArgs)) ? opts.cacheArgs : list);
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, JSON.stringify({ t: Date.now(), data: r.data }), { mode: 0o600 });
        } catch (e) { /* brak miejsca lub uprawnień: działamy bez pamięci podręcznej */ }
      }
      return r;
    });
  });
  ipcMain.handle('cache:get', (_e, fn, args) => {
    try { return JSON.parse(fs.readFileSync(cacheFile(String(fn), Array.isArray(args) ? args : []), 'utf8')); } catch (e) { return null; }
  });
  ipcMain.handle('cache:clear', () => { try { fs.rmSync(path.join(app.getPath('userData'), 'cache'), { recursive: true, force: true }); return true; } catch (e) { return false; } });

  ipcMain.handle('file:save', async (_e, name, mime, base64) => {
    const bytes = Buffer.from(String(base64 || ''), 'base64');
    const res = await dialog.showSaveDialog(mainWindow, { defaultPath: safeName(name) });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, bytes);
    return true;
  });
  ipcMain.handle('file:saveText', async (_e, name, text) => {
    const res = await dialog.showSaveDialog(mainWindow, { defaultPath: safeName(name) });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, String(text || ''), 'utf8');
    return true;
  });
  ipcMain.handle('file:printHtml', async (_e, html) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html || '')));
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      const res = await dialog.showSaveDialog(mainWindow, { defaultPath: 'raport.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (res.canceled || !res.filePath) return false;
      fs.writeFileSync(res.filePath, pdf);
      return true;
    } finally {
      win.destroy();
    }
  });
  // Raport HTML (Harmonogram) → plik PDF albo wydruk. HTML trafia do pliku tymczasowego (duże raporty nie mieszczą się w adresie data:).
  const withReportWindow = async (html, fn) => {
    const tmp = path.join(app.getPath('temp'), `zks-raport-${Date.now()}.html`);
    fs.writeFileSync(tmp, String(html || ''), 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try { await win.loadFile(tmp); return await fn(win); } finally { win.destroy(); fs.rmSync(tmp, { force: true }); }
  };
  ipcMain.handle('file:savePdf', async (_e, html, opts = {}) => withReportWindow(html, async (win) => {
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: opts.pageSize === 'A3' ? 'A3' : 'A4', landscape: opts.landscape !== false, preferCSSPageSize: true });
    const res = await dialog.showSaveDialog(mainWindow, { defaultPath: safeName(opts.name || 'harmonogram.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, pdf);
    return true;
  }));
  ipcMain.handle('file:print', async (_e, html, opts = {}) => withReportWindow(html, (win) => new Promise((resolve) => {
    win.webContents.print({ silent: false, printBackground: true, landscape: opts.landscape !== false, pageSize: opts.pageSize === 'A3' ? 'A3' : 'A4' }, (ok) => resolve(!!ok));
  })));
  ipcMain.handle('clipboard:image', (_e, base64) => { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(String(base64 || ''), 'base64'))); return true; });
  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url));
    return false;
  });
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { safeName, resolveWebPath };
