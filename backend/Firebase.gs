/**
 * Firebase.gs — wydawanie tokenów logowania do Firebase (Firestore) dla zalogowanych użytkowników API.
 *
 * Wymaga Script Properties (Ustawienia projektu → Właściwości skryptu):
 *   FIREBASE_CLIENT_EMAIL  — client_email z klucza konta usługi
 *   FIREBASE_PRIVATE_KEY   — private_key z klucza konta usługi
 *   FIREBASE_PROJECT_ID    — (opcjonalnie) domyślnie 'harmonohram-zks'
 *
 * Token ważny 1 godzinę; aplikacja odnawia go sama. Claims w tokenie (używane w regułach Firestore):
 *   plan: 'none'|'read'|'write', grafik: 'none'|'read'|'write'
 *
 * Dodaj do API_FUNCS w Api.gs:
 *   firebaseToken: { run: function (a, ctx) { return api_firebaseToken_(ctx); } },
 */

function api_b64url_(input) {
  var s = typeof input === 'string'
    ? Utilities.base64EncodeWebSafe(input, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(input);
  return s.replace(/=+$/, '');
}

function api_firebaseToken_(ctx) {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('FIREBASE_CLIENT_EMAIL');
  var key = props.getProperty('FIREBASE_PRIVATE_KEY');
  var projectId = props.getProperty('FIREBASE_PROJECT_ID') || 'harmonohram-zks';
  if (!email || !key) throw new Error('Brak FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY w Script Properties.');
  key = key.replace(/\\n/g, '\n');

  var now = Math.floor(Date.now() / 1000);
  var perms = (ctx && ctx.permissions) || {};
  var uid = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(ctx.email || ctx.name || 'user'))
  ).replace(/=+$/, '').slice(0, 28);

  var header = api_b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = api_b64url_(JSON.stringify({
    iss: email,
    sub: email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: uid,
    claims: { plan: perms.plan || 'none', grafik: perms.grafik || 'none', name: ctx.name || '' }
  }));
  var unsigned = header + '.' + payload;
  var sig = api_b64url_(Utilities.computeRsaSha256Signature(unsigned, key));
  return { token: unsigned + '.' + sig, projectId: projectId, expiresAt: (now + 3600) * 1000, uid: uid };
}
