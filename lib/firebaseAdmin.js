// Lets the Worker act as a trusted Firebase Admin client: mint its own
// Google OAuth access token from the service-account key (Wrangler secret),
// then use it to call the Firestore REST API directly — no Node SDK needed,
// works fine in the Workers runtime.

import { SignJWT, importPKCS8 } from 'jose';

let cachedToken = null; // { accessToken, expiresAt }

async function getGoogleAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/datastore'
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!resp.ok) throw new Error(`Failed to mint Google access token: ${await resp.text()}`);

  const data = await resp.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

const FIRESTORE_BASE = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

/** Reads one Firestore document via the REST API. Returns null if it doesn't exist. */
export async function firestoreGetDoc(env, path) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch(`${FIRESTORE_BASE(env.FIREBASE_PROJECT_ID)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Firestore GET failed: ${await resp.text()}`);
  return firestoreValueToJs((await resp.json()).fields);
}

/** Writes (merges) fields into a Firestore document via the REST API. */
export async function firestorePatchDoc(env, path, fields) {
  const token = await getGoogleAccessToken(env);
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const resp = await fetch(`${FIRESTORE_BASE(env.FIREBASE_PROJECT_ID)}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: jsToFirestoreValue(fields) })
  });
  if (!resp.ok) throw new Error(`Firestore PATCH failed: ${await resp.text()}`);
  return resp.json();
}

export async function firestoreDeleteDoc(env, path) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch(`${FIRESTORE_BASE(env.FIREBASE_PROJECT_ID)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok && resp.status !== 404) throw new Error(`Firestore DELETE failed: ${await resp.text()}`);
}

/** Backtick-quotes a field-path segment only if it actually needs it (Firestore
 *  requires quoting for anything other than letters/digits/underscores, or a
 *  segment starting with a digit) — leaves plain identifiers untouched. */
function quoteFieldPathSegment(segment) {
  const s = String(segment);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '`' + s.replace(/`/g, '\\`') + '`';
}

/**
 * Sets — or, if `value` is `undefined`, deletes — one deeply-nested field
 * inside a Firestore document via the REST API, WITHOUT disturbing any of
 * its sibling fields. E.g. `fieldPath: ['subjects', 'Pharmacology_CVS',
 * 'lec_123']` sets (or removes) exactly doc.subjects.Pharmacology_CVS.lec_123,
 * leaving every other subject/lecture already recorded in the document
 * untouched. Deleting works because Firestore's REST PATCH treats a field
 * that's named in `updateMask.fieldPaths` but omitted from the request
 * body's `fields` as "remove this field" rather than "leave it alone."
 *
 * This is separate from firestorePatchDoc() above because that function's
 * `fields` keys become literal top-level Firestore field names — passing a
 * dotted/nested key there wouldn't build the nested map structure Firestore
 * actually requires for a targeted nested update.
 */
export async function firestoreSetNestedField(env, path, fieldPath, value) {
  const token = await getGoogleAccessToken(env);
  const maskPath = fieldPath.map(quoteFieldPathSegment).join('.');

  let body;
  if (value === undefined) {
    body = { fields: {} }; // masked, but no value supplied => Firestore deletes the field
  } else {
    let node = jsToFirestoreValue({ __v: value }).__v;
    for (let i = fieldPath.length - 1; i >= 1; i--) {
      node = { mapValue: { fields: { [fieldPath[i]]: node } } };
    }
    body = { fields: { [fieldPath[0]]: node } };
  }

  const resp = await fetch(
    `${FIRESTORE_BASE(env.FIREBASE_PROJECT_ID)}/${path}?updateMask.fieldPaths=${encodeURIComponent(maskPath)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  if (!resp.ok) throw new Error(`Firestore nested PATCH failed: ${await resp.text()}`);
  return resp.json();
}

// --- Minimal Firestore <-> JS value conversion (only the types this app needs) ---
function firestoreValueToJs(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = parseInt(v.integerValue, 10);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('mapValue' in v) out[k] = firestoreValueToJs(v.mapValue.fields || {});
    else if ('arrayValue' in v) out[k] = (v.arrayValue.values || []).map(x => firestoreValueToJs({ _: x })._);
    else out[k] = null;
  }
  return out;
}

function jsToFirestoreValue(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (v === null || v === undefined) out[k] = { nullValue: null };
    else out[k] = { stringValue: JSON.stringify(v) }; // fallback for anything more complex
  }
  return out;
}
