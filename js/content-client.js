/* =============================================================================
   content-client.js

   Replaces direct Firestore reads/writes for CURRICULUM and COMMUNITY
   content with calls to the Cloudflare Worker (which itself talks to R2).

   Version manifests deliberately reuse the app's EXISTING, already-correct
   shapes (no separate/competing scheme introduced):
     appConfig/publishedManifest.subjects[subject][lectureId] = ts   (curriculum)
     appConfig/sharedQuizzesManifest.quizzes[quizId] = ts             (community)
   Both are written server-side by the Worker only — never by this client
   code directly (see firestore.rules).

   Depends on: window._db, window._doc, window._getDoc (Firestore SDK,
   already set up elsewhere), and window._idbGet / window._idbSet
   (existing IndexedDB helpers from data-sync.js).
   ============================================================================= */

const WORKER_BASE_URL = 'https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev';

const THROTTLE_MS = {
  community: 60 * 1000,       // 1 minute
  curriculum: 5 * 60 * 1000   // 5 minutes
};

function throttleKey(category) {
  return `lastVersionCheck:${category}`;
}
function withinThrottleWindow(category) {
  const last = parseInt(localStorage.getItem(throttleKey(category)) || '0', 10);
  return Date.now() - last < THROTTLE_MS[category];
}
function markThrottleChecked(category) {
  localStorage.setItem(throttleKey(category), String(Date.now()));
}

/** Reads the WHOLE curriculum manifest (one cheap read covers every lecture's version). */
export async function fetchCurriculumManifest() {
  const snap = await window._getDoc(window._doc(window._db, 'appConfig', 'publishedManifest'));
  return snap.exists() ? (snap.data().subjects || {}) : {};
}

/** Reads the WHOLE community manifest (one cheap read covers every quiz's version). */
export async function fetchCommunityManifest() {
  const snap = await window._getDoc(window._doc(window._db, 'appConfig', 'sharedQuizzesManifest'));
  return snap.exists() ? (snap.data().quizzes || {}) : {};
}

function r2Key(category, subject, itemId) {
  return category === 'curriculum' ? `curriculum/${subject}/${itemId}.json` : `community/${itemId}.json`;
}

/**
 * Fetches one curriculum lecture's content, using the local IndexedDB
 * cache when its manifest version hasn't changed.
 * @param {boolean} [skipThrottle] - force a real manifest check regardless of the time-throttle
 */
export async function getCurriculumLecture(subject, lectureId, { skipThrottle = false } = {}) {
  const idbKey = `content:curriculum:${subject}:${lectureId}`;
  const cached = await window._idbGet(idbKey).catch(() => null);

  if (cached && !skipThrottle && withinThrottleWindow('curriculum')) return cached;

  const manifest = await fetchCurriculumManifest();
  markThrottleChecked('curriculum');
  const serverVersion = manifest[subject]?.[lectureId] ?? null;

  if (cached && cached.__version === serverVersion) return cached;
  if (serverVersion == null) { await window._idbDelete(idbKey).catch(() => {}); return null; } // deleted

  const resp = await fetch(`${WORKER_BASE_URL}/${r2Key('curriculum', subject, lectureId)}`);
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`Failed to fetch curriculum/${subject}/${lectureId}: ${resp.status}`);
  }
  const data = await resp.json();
  data.__version = serverVersion;
  await window._idbSet(idbKey, data);
  return data;
}

/** Same idea as getCurriculumLecture, but for one community quiz (flat, no subject grouping). */
export async function getCommunityQuiz(quizId, { skipThrottle = false } = {}) {
  const idbKey = `content:community:${quizId}`;
  const cached = await window._idbGet(idbKey).catch(() => null);

  if (cached && !skipThrottle && withinThrottleWindow('community')) return cached;

  const manifest = await fetchCommunityManifest();
  markThrottleChecked('community');
  const serverVersion = manifest[quizId] ?? null;

  if (cached && cached.__version === serverVersion) return cached;
  if (serverVersion == null) { await window._idbDelete(idbKey).catch(() => {}); return null; } // deleted

  const resp = await fetch(`${WORKER_BASE_URL}/${r2Key('community', null, quizId)}`);
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`Failed to fetch community/${quizId}: ${resp.status}`);
  }
  const data = await resp.json();
  data.__version = serverVersion;
  await window._idbSet(idbKey, data);
  return data;
}

/**
 * Writes a lecture or quiz's content as-is. Images live INLINE on each
 * question (content.questions[i].image, a data: URL) — there's no
 * separate per-image upload step here at all; it's just a field in the
 * JSON, same as the question text. The caller is responsible for making
 * sure every image is already inlined before calling this — see
 * ensureInlineImages() in firebase-storage.js, which every save/share/
 * publish path runs first.
 */
export async function putContentItem(category, subject, itemId, content) {
  const idToken = await window._currentUser.getIdToken();

  const putResp = await fetch(`${WORKER_BASE_URL}/${r2Key(category, subject, itemId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(content)
  });
  if (!putResp.ok) throw new Error(`Content write failed: ${await putResp.text()}`);
  // Manifest bump happens server-side in the Worker, right after this
  // authorized write succeeds — never from the client directly.

  const idbKey = category === 'curriculum' ? `content:curriculum:${subject}:${itemId}` : `content:community:${itemId}`;
  const manifest = category === 'curriculum' ? await fetchCurriculumManifest() : await fetchCommunityManifest();
  const newVersion = category === 'curriculum' ? manifest[subject]?.[itemId] : manifest[itemId];
  await window._idbSet(idbKey, { ...content, __version: newVersion });
}

/** Deletes an item's content outright (community quiz delete, or curriculum unpublish). */
export async function deleteContentItem(category, subject, itemId) {
  const idToken = await window._currentUser.getIdToken();
  const resp = await fetch(`${WORKER_BASE_URL}/${r2Key(category, subject, itemId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (!resp.ok && resp.status !== 404) throw new Error(`Delete failed: ${await resp.text()}`);
  const idbKey = category === 'curriculum' ? `content:curriculum:${subject}:${itemId}` : `content:community:${itemId}`;
  await window._idbDelete(idbKey).catch(() => {});
}
