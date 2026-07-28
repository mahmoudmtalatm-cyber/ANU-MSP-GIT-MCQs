// Cloudflare Worker — foundation phase.
//
// Responsibilities right now:
//   1. Verify a request actually carries a genuine Firebase ID token for
//      this project (student or admin), before allowing any write.
//   2. Serve objects from R2 for reads (public — curriculum & community
//      content is meant to be readable by anyone using the app).
//   3. Accept content-hash-keyed uploads for writes, so identical image
//      bytes always land at the identical key (dedup is automatic).
//
// NOT yet implemented here (next phases, flagged so nothing is silently
// skipped):
//   - Per-role authorization (only an admin may write under curriculum/,
//     only a quiz's own author may delete their own community/ entry).
//     Needs the caller's Firebase UID cross-referenced against Firestore
//     admin-role data, which means this Worker also needs a Firebase Admin
//     REST integration (service-account-signed OAuth token) to query
//     Firestore from inside the Worker — a separate, careful piece to add
//     before any write path here is safe to expose publicly.
//   - The image reference-counter logic (§4 of the plan) — decrementing
//     and conditionally deleting an old image hash when a question's image
//     changes. This also needs the Firestore integration above.
//   - Per-item version manifest updates.
//
// Until per-role authorization is added, treat this Worker's write
// endpoint as NOT SAFE to point real traffic at yet.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { firestoreGetDoc, firestorePatchDoc, firestoreDeleteDoc } from './lib/firebaseAdmin.js';

/* =============================================================================
   CORS
   The app is served from GitHub Pages (a different origin than this Worker),
   so every response — including error responses and the OPTIONS preflight
   itself — needs Access-Control-Allow-Origin, or the browser blocks the
   response before any app code ever sees it (this was build 58's follow-up
   bug: sign-in/curriculum worked, but every content-client.js fetch() to
   this Worker was silently blocked by CORS).

   Allow '*' (any origin) since curriculum/community content is meant to be
   publicly readable anyway (see the GET handler below) — there's no
   per-origin secret being protected here. Writes are still fully gated by
   verifyFirebaseToken()/isAdmin()/isCommunityQuizAuthor() regardless of
   which origin the request claims to come from; CORS is a browser-side
   convenience, not a security boundary, so widening it here doesn't weaken
   the real authorization checks already in place.
   ============================================================================= */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Previous-Image-Hash',
  'Access-Control-Max-Age': '86400'
};

/** Returns a new Response with CORS headers merged in on top of whatever headers it already had. */
function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** True if this uid is listed as an admin (mirrors the existing admin-roster check used elsewhere in the app). */
async function isAdmin(env, uid) {
  const doc = await firestoreGetDoc(env, `adminRoster/${uid}`);
  return !!doc;
}

/** True if this uid is the original author of the community quiz at this key. */
async function isCommunityQuizAuthor(env, uid, communityQuizId) {
  const doc = await firestoreGetDoc(env, `sharedQuizzes/${communityQuizId}`);
  return !!doc && doc.authorUid === uid;
}

/**
 * Bumps (or creates) the refcount for an image hash. Called whenever a
 * question starts using this hash.
 */
async function incrementImageRefcount(env, hash) {
  const existing = await firestoreGetDoc(env, `imageRefcounts/${hash}`);
  const next = (existing?.count || 0) + 1;
  await firestorePatchDoc(env, `imageRefcounts/${hash}`, { count: next });
}

/**
 * Decrements the refcount for an image hash. If it hits zero, deletes both
 * the R2 object and the refcount record itself.
 */
async function decrementImageRefcountAndMaybeDelete(env, hash, r2KeyPrefix) {
  const existing = await firestoreGetDoc(env, `imageRefcounts/${hash}`);
  if (!existing) return; // nothing to decrement — already gone or never tracked
  const next = existing.count - 1;
  if (next <= 0) {
    await firestoreDeleteDoc(env, `imageRefcounts/${hash}`);
    await env.CONTENT_BUCKET.delete(`${r2KeyPrefix}/images/${hash}.jpg`).catch(() => {});
    await env.CONTENT_BUCKET.delete(`${r2KeyPrefix}/images/${hash}.png`).catch(() => {});
  } else {
    await firestorePatchDoc(env, `imageRefcounts/${hash}`, { count: next });
  }
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

/**
 * Verifies a Firebase ID token sent as `Authorization: Bearer <token>`.
 * Throws if invalid/expired/wrong project. Returns the token's payload
 * (includes `sub` = the user's Firebase UID) on success.
 */
async function verifyFirebaseToken(request, projectId) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) throw new Error('Missing Authorization header');

  const token = match[1];
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId
  });
  return payload; // payload.sub is the Firebase UID
}

/** Computes a SHA-256 hex hash of the given bytes — used as the R2 key for images. */
async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    // ---- CORS preflight ----
    // Browsers send this automatically before PUT requests (and before GET
    // requests with custom headers) from a different origin. It must be
    // answered directly, with no body, before any other logic runs.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Everything else runs inside a try/catch. Without this, any uncaught
    // exception anywhere below (a Firestore Admin call failing, a bug, a
    // malformed request) makes Cloudflare return its own bare runtime-error
    // response — which has none of the CORS headers withCors() adds, since
    // the exception happens before any handler branch gets a chance to
    // return through it. The browser then reports that as "blocked by CORS
    // policy," masking what's actually a 500. Catching here guarantees
    // every response, success or failure, always carries CORS headers, and
    // surfaces the real error message instead of a misleading CORS error.
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled Worker error:', err);
      return withCors(new Response(`Internal error: ${err.message || err}`, { status: 500 }));
    }
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\//, '')); // e.g. "curriculum/lec_123/q_1.json"

  // ---- READS: public, no auth required ----
  // Curriculum & community content is meant to be freely readable by any
  // signed-in student using the app; the app itself already gates *access
  // to the app* via Firebase Auth on the client side.
  if (request.method === 'GET') {
    const object = await env.CONTENT_BUCKET.get(key);
    if (!object) return withCors(new Response('Not found', { status: 404 }));

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('etag', object.httpEtag);
    return withCors(new Response(object.body, { headers }));
  }

  // ---- WRITES: require a verified Firebase identity ----
  // NOT YET SAFE FOR PRODUCTION TRAFFIC — see file header. This currently
  // only confirms "this is some real, signed-in Firebase user," not
  // "this specific user is allowed to write to this specific key."
  if (request.method === 'PUT') {
    let uid;
    try {
      const payload = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
      uid = payload.sub;
    } catch (err) {
      return withCors(new Response(`Unauthorized: ${err.message}`, { status: 401 }));
    }

    // Per-role authorization: check who's allowed to write to this key
    // BEFORE touching R2 at all.
    if (key.startsWith('curriculum/')) {
      if (!(await isAdmin(env, uid))) {
        return withCors(new Response('Forbidden: curriculum writes are admin-only', { status: 403 }));
      }
    } else if (key.startsWith('community/')) {
      const communityQuizId = key.split('/')[1];
      const authorized = (await isAdmin(env, uid)) || (await isCommunityQuizAuthor(env, uid, communityQuizId));
      if (!authorized) {
        return withCors(new Response('Forbidden: only the quiz author or an admin may write here', { status: 403 }));
      }
    } else {
      // Any key outside the two known public-content prefixes is rejected
      // by default — nothing else should ever be written through this
      // Worker (custom quizzes/stats are local-only, per the plan, and
      // never touch R2 at all).
      return withCors(new Response('Forbidden: unrecognized content path', { status: 403 }));
    }

    // If this write is replacing a previous image on the same question,
    // the client includes the old hash so we can safely decrement/clean
    // up its refcount — never an unconditional delete (see plan §4).
    const previousHash = request.headers.get('X-Previous-Image-Hash');
    const r2KeyPrefix = key.split('/images/')[0];

    const bodyBuffer = await request.arrayBuffer();

    // Images are content-hash-addressed: the actual storage key is derived
    // from the bytes themselves, ignoring whatever key the client asked
    // for in the URL, for the image sub-path specifically.
    let finalKey = key;
    if (key.includes('/images/')) {
      const hash = await sha256Hex(bodyBuffer);
      const ext = key.split('.').pop();
      finalKey = key.replace(/images\/[^/]+$/, `images/${hash}.${ext}`);

      const newHash = finalKey.split('/images/')[1].split('.')[0];
      const existing = await env.CONTENT_BUCKET.head(finalKey);

      if (!existing) {
        await env.CONTENT_BUCKET.put(finalKey, bodyBuffer, {
          httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' }
        });
      }
      await incrementImageRefcount(env, newHash);

      // Only now, after the new hash is safely referenced, release the
      // old one — never delete before the replacement is confirmed in place.
      if (previousHash && previousHash !== newHash) {
        await decrementImageRefcountAndMaybeDelete(env, previousHash, r2KeyPrefix);
      }

      return withCors(new Response(JSON.stringify({ key: finalKey, deduped: !!existing }), {
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Non-image writes (quiz/lecture text JSON) — no hashing, no refcount,
    // just a straightforward authorized write.
    await env.CONTENT_BUCKET.put(finalKey, bodyBuffer, {
      httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' }
    });

    return withCors(new Response(JSON.stringify({ key: finalKey, deduped: false }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  // ---- DELETE ----
  // (Not yet implemented elsewhere in this file, but routed through the
  // same withCors() wrapper for consistency once it is, and so it returns
  // a CORS-safe 405 instead of a silent block in the meantime.)

  return withCors(new Response('Method not allowed', { status: 405 }));
}
