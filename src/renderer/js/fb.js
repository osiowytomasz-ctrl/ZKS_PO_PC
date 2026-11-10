// Połączenie z Firebase (Firestore): logowanie tokenem z Apps Script (api firebaseToken) i dostęp do bazy.
import { api } from './ui.js';

// Publiczna konfiguracja aplikacji Web (nie jest sekretem; dostępu pilnują reguły Firestore).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDavZoJom1HP2JFWF90XDzk8K3tnl11RdY',
  authDomain: 'harmonohram-zks.firebaseapp.com',
  projectId: 'harmonohram-zks',
  storageBucket: 'harmonohram-zks.firebasestorage.app',
  messagingSenderId: '1010964987697',
  appId: '1:1010964987697:web:638a466ee73d20fddcba10',
};

let sdk = null, app = null, auth = null, db = null, expiresAt = 0, signing = null;

async function load() { if (!sdk) sdk = await import('../vendor/firebase.js'); return sdk; }

/** Loguje do Firebase (jeśli trzeba) i zwraca {sdk, db}. Token jest odnawiany przed końcem ważności. */
export async function firebase() {
  const s = await load();
  if (!app) {
    app = s.initializeApp(FIREBASE_CONFIG);
    auth = s.getAuth(app);
    db = s.initializeFirestore(app, { localCache: s.persistentLocalCache({ tabManager: s.persistentSingleTabManager() }) });
  }
  if (!auth.currentUser || Date.now() > expiresAt - 5 * 60 * 1000) {
    signing = signing || (async () => {
      const t = await api('firebaseToken', []);
      await s.signInWithCustomToken(auth, t.token);
      expiresAt = t.expiresAt;
    })().finally(() => { signing = null; });
    await signing;
  }
  return { sdk: s, db };
}
