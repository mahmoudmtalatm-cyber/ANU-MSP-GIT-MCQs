// Cloudflare Worker — foundation phase.
//
// Responsibilities right now:
//   1. Verify a request actually carries a genuine Firebase ID token for
//      this project (student or admin), before allowing any write.
//   2. Serve objects from R2 for reads (public — curriculum & community
//      content is meant to be readable by anyone using the app).
//   3. Accept a quiz/lecture's JSON content and write it as-is. Images live
//      INLINE inside that JSON (as data: URLs on each question), not as
//      separate R2 objects — so there's no upload-then-reference dance, no
//      content hashing, and no refcounting for this Worker to manage at
//      all: an image is just a field on a question, exactly like the
//      question text, and it's deleted the same way the question is —
//      by deleting the JSON document that contains it.
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
// Every successful content write/delete also bumps/clears that item's
// version marker in appConfig/publishedManifest (curriculum) or
// appConfig/sharedQuizzesManifest (community) — see manifestLocationForKey()
// below — since every manifest-gated reader in the app
// (getCurriculumLecture/getCommunityQuiz/ensureSharedQuizzesLoaded) treats
// "no manifest entry" as "doesn't exist."

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { firestoreGetDoc, firestorePatchDoc, firestoreDeleteDoc, firestoreSetNestedField, firestoreListCollection } from './lib/firebaseAdmin.js';

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
   isCommunityQuizAuthor() regardless of which origin the request claims to
   come from; CORS is a browser-side
   convenience, not a security boundary, so widening it here doesn't weaken
   the real authorization checks already in place.
   ============================================================================= */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

/**
 * True if this uid is the original author of the community quiz at this
 * key — read directly off the R2 content object's `authorUid` field.
 * (This used to check Firestore's `sharedQuizzes/{docId}` collection, but
 * that collection was retired in build 56 when content moved to R2 — no
 * client code writes it anymore, so that check silently returned false
 * for every real owner, same class of bug as the old isAdmin(). authorUid
 * now lives only on the R2 content object itself, set by sharing.js and
 * echoed back by putContentItem(), so that's the one real source of truth.)
 */
async function isCommunityQuizAuthor(env, uid, communityQuizId) {
  const object = await env.CONTENT_BUCKET.get(`community/${communityQuizId}.json`);
  if (!object) return false;
  try {
    const content = await object.json();
    return content.authorUid === uid;
  } catch {
    return false;
  }
}

/**
 * Where a content key's version marker lives in Firestore — shared by the
 * manifest-bump-on-write and manifest-clear-on-delete logic below, so the
 * two paths can never disagree with each other about the doc/field shape.
 * Mirrors the comment in js/content-client.js:
 *   appConfig/publishedManifest.subjects[subject][lectureId] = ts   (curriculum)
 *   appConfig/sharedQuizzesManifest.quizzes[quizId] = ts             (community)
 */
function manifestLocationForKey(key) {
  if (key.startsWith('curriculum/')) {
    const [, subject, file] = key.split('/');
    return { docPath: 'appConfig/publishedManifest', fieldPath: ['subjects', subject, file.replace(/\.json$/, '')] };
  }
  const [, file] = key.split('/');
  return { docPath: 'appConfig/sharedQuizzesManifest', fieldPath: ['quizzes', file.replace(/\.json$/, '')] };
}

/** Bumps the version marker for this content item so every reader that's gated on the manifest (getCurriculumLecture/getCommunityQuiz/ensureSharedQuizzesLoaded) can see the change. */
async function bumpManifestVersion(env, key) {
  const { docPath, fieldPath } = manifestLocationForKey(key);
  await firestoreSetNestedField(env, docPath, fieldPath, Date.now());
}

/**
 * Removes this content item's version marker entirely (not just null) so it
 * drops out of every manifest-gated listing/read. Deliberately swallows its
 * own errors: by the time this runs the R2 object is already deleted (see
 * the DELETE handler below), so the delete itself has already succeeded —
 * a manifest-bookkeeping hiccup shouldn't surface to the admin as "Delete
 * failed" when the content is in fact gone. Any reader that still has a
 * stale manifest entry will simply get a 404 on next fetch and prune the
 * item locally, same as the existing "quiz vanished mid-session" path.
 */
async function clearManifestVersion(env, key) {
  try {
    const { docPath, fieldPath } = manifestLocationForKey(key);
    await firestoreSetNestedField(env, docPath, fieldPath, undefined);
  } catch (err) {
    console.error(`Failed to clear manifest version for ${key} (content itself was already deleted):`, err);
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

  // ---- MAINTENANCE: one-time cleanup of the pre-inline-image storage
  // system's leftovers. Every image is now written inline (a data: URL
  // right on its question) — nothing in the app's normal read/write path
  // creates or reads an `imageRefcounts/{hash}` doc, or a separately-
  // hosted `.../images/{hash}.*` R2 object, anymore. This sweep exists
  // purely to reclaim the R2 storage those old objects still occupy,
  // once every quiz/lecture that used to reference them has been
  // migrated to inline storage (see js/admin-panel.js's migration tool).
  // Deliberately gated to the single super-admin account, not the
  // broader curriculum/community admin roster — this deletes storage
  // with no undo, and running it before migration is complete would
  // permanently break any not-yet-migrated quiz/lecture still pointing
  // at one of these objects.
  if (request.method === 'POST' && url.pathname === '/_admin/sweep-legacy-images') {
    let email;
    try {
      const payload = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
      email = payload.email || null;
    } catch (err) {
      return withCors(new Response(`Unauthorized: ${err.message}`, { status: 401 }));
    }
    if (!isSuperAdmin(email)) {
      return withCors(new Response('Forbidden: legacy-image cleanup is restricted to the super-admin account', { status: 403 }));
    }

    const refcountDocs = await firestoreListCollection(env, 'imageRefcounts');
    let objectsDeleted = 0, docsWithNoKnownOwner = 0;
    for (const doc of refcountDocs) {
      if (doc.ownerKey) {
        await env.CONTENT_BUCKET.delete(doc.ownerKey).catch(() => {});
        objectsDeleted++;
      } else {
        // A refcount doc from before ownerKey tracking existed (see the
        // #95-era history in the README) — there's no reliable way to
        // derive its physical R2 key from the doc alone, so it's left in
        // place; only the now-meaningless counter is cleared below.
        docsWithNoKnownOwner++;
      }
      await firestoreDeleteDoc(env, `imageRefcounts/${doc.id}`);
    }

    return withCors(new Response(JSON.stringify({
      refcountDocsSwept: refcountDocs.length,
      objectsDeleted,
      docsWithNoKnownOwner
    }), { headers: { 'Content-Type': 'application/json' } }));
  }


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
    let existingCommunityObject = null; // set below, only for community/ writes; reused after auth to decide whether to preserve the existing authorUid
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
      const communityQuizId = key.split('/')[1].replace(/\.json$/, '');
      // A community quiz's *first* write is a share by definition — there's
      // no prior author to check against, and requiring 'community' admin
      // permission here would mean an ordinary student could never share a
      // quiz at all (isCommunityAdmin() is only ever true for roster admins
      // — see below). Only an *existing* quiz's author/admin gate applies
      // once there's actually a prior version to protect.
      existingCommunityObject = await env.CONTENT_BUCKET.get(key);
      const authorized = !existingCommunityObject
        || (await isCommunityAdmin(env, email))
        || (await isCommunityQuizAuthor(env, uid, communityQuizId));
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

    // Images live inline in the JSON body now (a data: URL on each
    // question) — there's no separate image sub-path, no hashing, no
    // refcounting. Just write whatever content the client sent.
    const bodyBuffer = await request.arrayBuffer();
    let finalBody = bodyBuffer;
    if (key.startsWith('community/')) {
      // authorUid must reflect the ORIGINAL author, not whoever happens to
      // be making this particular write. For a brand-new quiz (no prior
      // object — see existingCommunityObject above) that's necessarily
      // the current requester, and must be forced server-side so the "any
      // signed-in user may create a new community quiz" rule above can't
      // be used to claim authorship under a different uid. For an
      // ALREADY-EXISTING quiz, the authorization check above already
      // restricts who's allowed to write here (the original author, or an
      // admin) regardless of who's currently writing — so the existing
      // document's authorUid is preserved untouched here, never
      // overwritten with the current writer's uid. This matters
      // concretely whenever an admin writes to a quiz they didn't
      // author — e.g. the legacy-image migration tool touching every
      // community quiz in bulk — which must never reassign authorship
      // (and therefore future edit/delete rights) to the admin running it.
      try {
        const content = JSON.parse(new TextDecoder().decode(bodyBuffer));
        if (existingCommunityObject) {
          const existingContent = await existingCommunityObject.json();
          content.authorUid = existingContent.authorUid;
        } else {
          content.authorUid = uid;
        }
        finalBody = new TextEncoder().encode(JSON.stringify(content));
      } catch (err) {
        return withCors(new Response(`Bad request: quiz content isn't valid JSON: ${err.message}`, { status: 400 }));
      }
    }
    await env.CONTENT_BUCKET.put(key, finalBody, {
      httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/json' }
    });
    await bumpManifestVersion(env, key);

    return withCors(new Response(JSON.stringify({ key }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  // ---- DELETE: require the same authorization as a write to this key ----
  if (request.method === 'DELETE') {
    let uid, email;
    try {
      const payload = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
      uid = payload.sub;
      email = payload.email || null;
    } catch (err) {
      return withCors(new Response(`Unauthorized: ${err.message}`, { status: 401 }));
    }

    if (key.startsWith('curriculum/')) {
      const subject = key.split('/')[1];
      const allowed = (await isCurriculumAdmin(env, email)) && (await curriculumScopeAllowsSubject(env, email, subject));
      if (!allowed) {
        return withCors(new Response('Forbidden: curriculum deletes are admin-only', { status: 403 }));
      }
    } else if (key.startsWith('community/')) {
      const communityQuizId = key.split('/')[1].replace(/\.json$/, '');
      const authorized = (await isCommunityAdmin(env, email)) || (await isCommunityQuizAuthor(env, uid, communityQuizId));
      if (!authorized) {
        return withCors(new Response('Forbidden: only the quiz author or an admin may delete this', { status: 403 }));
      }
    } else {
      return withCors(new Response('Forbidden: unrecognized content path', { status: 403 }));
    }

    // Images are inline inside this JSON document (see the PUT handler
    // above) — deleting the document deletes them with it. No separate
    // R2 objects or refcounts to release.
    await env.CONTENT_BUCKET.delete(key);
    await clearManifestVersion(env, key);

    return withCors(new Response(JSON.stringify({ deleted: true, key }), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  return withCors(new Response('Method not allowed', { status: 405 }));
}
