'use strict';
const fs = require('fs');
const path = require('path');

// Adres API i klucz użytkownika. Szyfrowane przez safeStorage (DPAPI / Keychain / libsecret), gdy dostępne.
function createStore(dir, safeStorage) {
  const file = path.join(dir, 'settings.bin');
  const canEncrypt = () => !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  return {
    load() {
      try {
        const raw = fs.readFileSync(file);
        const marker = raw[0];
        const payload = raw.subarray(1);
        const text = marker === 1 ? safeStorage.decryptString(payload) : payload.toString('utf8');
        const obj = JSON.parse(text);
        return { url: String(obj.url || ''), key: String(obj.key || ''), linkVer: Number(obj.linkVer) || 0 };
      } catch (e) {
        return { url: '', key: '', linkVer: 0 };
      }
    },
    save(cfg) {
      // linkVer – wersja adresu z bazy, ostatnio przyjęta przez ten program (gdy nie podano, zostaje poprzednia)
      const linkVer = cfg.linkVer !== undefined ? Number(cfg.linkVer) || 0 : this.load().linkVer;
      const json = JSON.stringify({ url: String(cfg.url || '').trim(), key: String(cfg.key || '').trim(), linkVer });
      fs.mkdirSync(dir, { recursive: true });
      const buf = canEncrypt()
        ? Buffer.concat([Buffer.from([1]), safeStorage.encryptString(json)])
        : Buffer.concat([Buffer.from([0]), Buffer.from(json, 'utf8')]);
      fs.writeFileSync(file, buf, { mode: 0o600 });
    },
    encrypted: canEncrypt,
  };
}
module.exports = { createStore };
