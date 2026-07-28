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
// Per-role authorization (only a 'curriculum' admin — whose recorded scope
// covers the target subject — may write under curriculum/; only a quiz's
// own author, or a 'community' admin, may write their community/ entry) is
// implemented below, mirroring firestore.rules and
// js/admin-curriculum-scope.js exactly: same appConfig/adminRoster doc
// shape, same super-admin email, same curriculum-scope semantics. See
// isCurriculumAdmin(), isCommunityAdmin(), and curriculumScopeAllowsSubject()
// below — keep all three in sync with firestore.rules if that model ever
// changes.
//
// NOT yet implemented here (flagged so nothing is silently skipped):
//   - Per-item version manifest updates (appConfig/publishedManifest,
//     appConfig/sharedQuizzesManifest) after a write.
//   - DELETE is routed but not yet handled (see the bottom of this file) —
//     content-client.js's deleteContentItem() calls currently get a 405
//     from this Worker.

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
   verifyFirebaseToken()/isCurriculumAdmin()/isCommunityAdmin()/
   isCommunityQuizAuthor() regardless of
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

/* =============================================================================
   ADMIN ROLE CHECKS
   Mirror firestore.rules and js/admin-curriculum-scope.js exactly — same
   roster doc (appConfig/adminRoster, a single doc with an `admins` map
   keyed by *lowercased email*, not a per-user collection), same
   super-admin email, same curriculum-scope semantics. This is the model
   the previous isAdmin(env, uid) implementation didn't match — it looked
   up a `adminRoster/{uid}` document, which never exists under the real
   schema (wrong collection, wrong doc-per-user shape, and keyed by uid
   instead of email), so every curriculum/community authorization check
   silently failed regardless of who the caller was. Keep these three in
   sync with firestore.rules if the roster model ever changes.
   ============================================================================= */
const SUPER_ADMIN_EMAIL = 'mahmoudmtalatm@gmail.com';

function isSuperAdmin(email) {
  return !!email && email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

/** This user's appConfig/adminRoster.admins[emailLower] entry, or null if they're not on the roster. */
async function getRosterEntry(env, email) {
  if (!email) return null;
  const roster = await firestoreGetDoc(env, 'appConfig/adminRoster');
  return (roster && roster.admins && roster.admins[email.toLowerCase()]) || null;
}

async function hasRosterPermission(env, email, permission) {
  const entry = await getRosterEntry(env, email);
  return !!entry && Array.isArray(entry.permissions) && entry.permissions.includes(permission);
}

async function isCurriculumAdmin(env, email) {
  return isSuperAdmin(email) || (await hasRosterPermission(env, email, 'curriculum'));
}

async function isCommunityAdmin(env, email) {
  return isSuperAdmin(email) || (await hasRosterPermission(env, email, 'community'));
}

/**
 * True if this admin's recorded curriculum scope covers `subject` — mirrors
 * curriculumScopeAllowsSubject()/_subjectAllowedByScope() in firestore.rules.
 * The super admin, and any admin with no recorded scope (or scope.type ===
 * 'all'), covers every subject. A 'scoped' admin only covers the specific
 * Year(s)/Module(s)/Subject(s) recorded in their roster entry, looked up
 * against that subject's placement in appConfig/curriculumExtensions.
 */
async function curriculumScopeAllowsSubject(env, email, subject) {
  if (isSuperAdmin(email)) return true;

  const entry = await getRosterEntry(env, email);
  const scope = entry?.curriculumScope || { type: 'all' };
  if (scope.type === 'all') return true;

  const extensions = await firestoreGetDoc(env, 'appConfig/curriculumExtensions');
  const subjectInfo = extensions?.subjects?.[subject];
  if (!subjectInfo) return false;

  const scopeYears = scope.years || {};
  const yearEntry = scopeYears[subjectInfo.year];
  if (yearEntry === true) return true;
  if (!yearEntry || typeof yearEntry !== 'object') return false;

  const moduleEntry = yearEntry[subjectInfo.module];
  if (moduleEntry === true) return true;
  return Array.isArray(moduleEntry) && moduleEntry.includes(subject);
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

  // ---- WRITES: require a verified Firebase identity, then a role check ----
  // verifyFirebaseToken() only confirms "this is some real, signed-in
  // Firebase user" — the isCurriculumAdmin()/isCommunityAdmin()/
  // isCommunityQuizAuthor() checks right below decide whether *this*
  // user is allowed to write to *this* key.
  if (request.method === 'PUT') {
    let uid, email;
    try {
      const payload = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
      uid = payload.sub;
      email = payload.email || null;
    } catch (err) {
      return withCors(new Response(`Unauthorized: ${err.message}`, { status: 401 }));
    }

    // Per-role authorization: check who's allowed to write to this key
    // BEFORE touching R2 at all.
    if (key.startsWith('curriculum/')) {
      // Key shape: curriculum/{subject}/{lectureId}.json (see r2Key() in
      // js/content-client.js) — the subject is what curriculum SCOPE is
      // recorded/checked against, same as publishedQuestions/{subject}/...
      // in firestore.rules.
      const subject = key.split('/')[1];
      const allowed = (await isCurriculumAdmin(env, email)) && (await curriculumScopeAllowsSubject(env, email, subject));
      if (!allowed) {
        return withCors(new Response('Forbidden: curriculum writes are admin-only', { status: 403 }));
      }
    } else if (key.startsWith('community/')) {
      const communityQuizId = key.split('/')[1];
      const authorized = (await isCommunityAdmin(env, email)) || (await isCommunityQuizAuthor(env, uid, communityQuizId));
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
