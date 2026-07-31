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

/**
 * Lists every document in a top-level collection, returning
 * `{ id, ...fields }` for each (paginating internally — Firestore caps a
 * single listDocuments response at 300 docs regardless of the requested
 * pageSize, so this follows nextPageToken until exhausted). Used only by
 * the one-time legacy-image cleanup sweep (see worker-index.js) to walk
 * every `imageRefcounts/{hash}` doc left over from the pre-inline-image
 * architecture; not used anywhere in the app's normal request path.
 */
export async function firestoreListCollection(env, collectionId) {
  const token = await getGoogleAccessToken(env);
  const out = [];
  let pageToken = '';
  do {
    const url = `${FIRESTORE_BASE(env.FIREBASE_PROJECT_ID)}/${collectionId}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Firestore list ${collectionId} failed: ${await resp.text()}`);
    const data = await resp.json();
    for (const doc of data.documents || []) {
      const id = doc.name.split('/').pop();
      out.push({ id, ...firestoreValueToJs(doc.fields || {}) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/**
 * Sets — or, if `value` is `undefined`, deletes — one deeply-nested field
 * inside a Firestore document, WITHOUT disturbing any of its sibling fields.
 * E.g. `fieldPath: ['subjects', 'Pharmacology_CVS', 'lec_123']` sets (or
 * removes) exactly doc.subjects.Pharmacology_CVS.lec_123, leaving every
 * other subject/lecture already recorded in the document untouched.
 *
 * Implementation note (build 87): this used to build a dotted, backtick-
 * quoted `updateMask.fieldPaths` string (Firestore's REST syntax for
 * targeting a nested field without a full read) and PATCH just that one
 * path. That works for ordinary IDs, but Firestore's field-path grammar
 * itself can't represent every string a quiz/lecture ID might contain (a
 * community quiz whose id happened to be a single `"` character reliably
 * 400'd with "Invalid property path" no matter how it was quoted/escaped —
 * see the README changelog for the report that led here). Since arbitrary
 * strings are always valid as plain JSON *map keys*, we now read the whole
 * top-level field (`fieldPath[0]`, e.g. "subjects" or "quizzes"), mutate it
 * in plain JS, and PATCH that single top-level field back in full. The mask
 * is then just that one simple field name — never a dotted/quoted path — so
 * there is nothing left to escape, regardless of what's inside any ID.
 */
export async function firestoreSetNestedField(env, path, fieldPath, value) {
  const [topKey, ...rest] = fieldPath;
  const existingDoc = await firestoreGetDoc(env, path);
  const topMap = existingDoc && typeof existingDoc[topKey] === 'object' && existingDoc[topKey] !== null
    ? JSON.parse(JSON.stringify(existingDoc[topKey]))
    : {};

  let cursor = topMap;
  for (let i = 0; i < rest.length - 1; i++) {
    const key = rest[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  const lastKey = rest[rest.length - 1];
  if (value === undefined) delete cursor[lastKey];
  else cursor[lastKey] = value;

  return firestorePatchDoc(env, path, { [topKey]: topMap });
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

/** Converts a single JS value (of any type this app uses) to its Firestore
 *  REST wire representation. Object keys are never validated or escaped —
 *  Firestore map keys accept any string, which is exactly why
 *  firestoreSetNestedField() above builds nested maps instead of dotted
 *  field-path strings. */
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: jsToFirestoreValue(v) } };
  return { stringValue: JSON.stringify(v) }; // fallback for anything unexpected
}

function jsToFirestoreValue(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFirestoreValue(v);
  return out;
}
