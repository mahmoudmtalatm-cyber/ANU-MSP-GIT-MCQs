/* ══════════════════════════════════════════════════════════
   FIREBASE STORAGE — quiz image helpers
══════════════════════════════════════════════════════════ */

/* Save all base64 images in a quiz's questions to Firestore subcollection documents.
   Each image goes into users/{uid}/customQuizzes/{quizId}/images/{idx}.
   Replaces q.image (data URL) with q.imageUrl (firestore:// sentinel).
   Returns the modified questions array (mutates in place too). */
async function uploadQuizImagesToStorage(quizId, questions) {
  if (!window._db || !window._currentUser) return questions;
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    if (!q.image) continue; // nothing to save
    try {
      const compressed = await compressImageDataUrl(q.image);
      const imgRef = window._doc(
        window._db,
        'users', window._currentUser.uid,
        'customQuizzes', quizId,
        'images', String(idx)
      );
      await window._setDoc(imgRef, { imageData: compressed });
      q.imageUrl = `firestore://${quizId}/${idx}`; // sentinel: tells hydrate where to fetch from
      delete q.image; // don't inline base64 in the parent quiz document
    } catch (e) {
      console.warn('Image save to Firestore failed for question', idx, e);
      // Keep image as-is so quiz still works locally
    }
  }
  return questions;
}

/* Delete all Firestore image subcollection docs for a quiz (called on delete). */
async function deleteQuizImagesFromStorage(quizId) {
  if (!window._db || !window._currentUser) return;
  try {
    const col = window._collection(
      window._db,
      'users', window._currentUser.uid,
      'customQuizzes', quizId,
      'images'
    );
    const snap = await window._getDocs(col);
    await Promise.all(snap.docs.map(d => window._deleteDoc(d.ref)));
  } catch (e) {
    console.warn('Image cleanup failed for quiz', quizId, e);
  }
}

/* Fetch all images back into in-memory image (data URL) fields.
   New quizzes use a firestore:// sentinel and read from the images subcollection.
   Legacy quizzes with a real HTTPS Storage URL fall back to fetching that URL. */
async function hydrateQuizImages(questions) {
  await Promise.all(questions.map(async (q) => {
    if (q.image || !q.imageUrl) return; // already hydrated or no image

    if (q.imageUrl.startsWith('firestore://')) {
      // New path: read from Firestore images subcollection
      try {
        const parts = q.imageUrl.replace('firestore://', '').split('/');
        const storedQuizId = parts[0];
        const imgIdx = parts[1];
        const imgRef = window._doc(
          window._db,
          'users', window._currentUser.uid,
          'customQuizzes', storedQuizId,
          'images', imgIdx
        );
        const snap = await window._getDoc(imgRef);
        if (snap.exists()) q.image = snap.data().imageData;
      } catch (e) {
        console.warn('Firestore image fetch failed', q.imageUrl, e);
      }
    } else {
      // Legacy path: real HTTPS URL from Firebase Storage
      try {
        q.image = await _urlToDataUrl(q.imageUrl);
      } catch (e) {
        console.warn('Legacy Storage image fetch failed', q.imageUrl, e);
      }
    }
  }));
}

/** Fetches a remote image URL and resolves it to a data: URL (or rejects on failure). */
async function _urlToDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** The single canonical "make sure every image is inline" step. Pulls
 * every still-remote `q.image` (an http(s) URL) down into a real local
 * data: URL, in place. There are two reasons a question could still have
 * a remote URL at this point:
 * 1. It's a genuinely old community/curriculum item from before this
 * app moved to inline-only image storage — its JSON still has a URL
 * pointing at a separately-hosted image object.
 * 2. It's mid-flow — e.g. a community quiz just fetched for "Save to
 * Mine", still carrying the URL it was fetched with.
 * Call this before ANY write that includes questions (save, merge,
 * share, publish, swap/rename/split, migration) — putContentItem()
 * (content-client.js) does no image handling of its own anymore; images
 * are just an ordinary field on the question, written and deleted along
 * with everything else in the JSON. Failures are left as the original
 * URL (best-effort: an image that fails to download here is no worse
 * off than before this fix, just not yet inlined). */
async function ensureInlineImages(questions) {
  await Promise.all((questions || []).map(async (q) => {
    if (!q.image || !/^https?:\/\//i.test(q.image)) return; // not a remote URL — nothing to pull down
    try {
      q.image = await _urlToDataUrl(q.image);
    } catch (e) {
      console.warn('Failed to inline remote quiz image', q.image, e);
    }
  }));
}

/* ══════════════════════════════════════════════════════════
   STATS HISTORY — wrong-question image helpers

   The Statistics "Retake wrong questions" feature needs the full
   question (including any image) preserved per finished quiz, but
   the `stats` document itself has to stay under Firestore's 1 MiB
   per-document limit. Embedding base64 images directly in
   `history[].wrongQuestions` (as before) meant the *next* quiz's
   save could push the whole document over that limit — which
   Firestore silently rejects, and since the write is fire-and-
   forget, the newest quiz's entry would just never actually save,
   with no error shown anywhere.

   Mirrors uploadQuizImagesToStorage/hydrateQuizImages/
   deleteQuizImagesFromStorage below, but under
   users/{uid}/statsHistory/{historyId}/images/{idx} and a distinct
   `firestore-history://` sentinel (so hydrateHistoryImages can't be
   confused with a customQuizzes imageUrl, and vice versa).
══════════════════════════════════════════════════════════ */

/* Moves any base64 images in a history entry's wrongQuestions out to
   Firestore subcollection docs, replacing q.image with a
   firestore-history:// sentinel. Mutates the passed-in array (mutate a
   clone, never the live currentQuestions objects — see saveQuizStats). */
async function uploadHistoryImagesToStorage(historyId, wrongQuestions) {
  if (!window._db || !window._currentUser) return wrongQuestions;
  for (let idx = 0; idx < wrongQuestions.length; idx++) {
    const q = wrongQuestions[idx];
    if (!q || !q.image) continue; // nothing to save (or already migrated)
    try {
      const compressed = await compressImageDataUrl(q.image);
      const imgRef = window._doc(
        window._db,
        'users', window._currentUser.uid,
        'statsHistory', historyId,
        'images', String(idx)
      );
      await window._setDoc(imgRef, { imageData: compressed });
      q.imageUrl = `firestore-history://${historyId}/${idx}`;
      delete q.image; // don't inline base64 in the stats document
    } catch (e) {
      console.warn('History image save to Firestore failed for question', idx, e);
      // Keep image as-is so Retake still works locally this session —
      // same fallback uploadQuizImagesToStorage uses.
    }
  }
  return wrongQuestions;
}

/* Fetches wrongQuestions' images back into q.image (data URL) fields,
   for Retake. Only touches entries with a firestore-history:// sentinel
   and no image already loaded. */
async function hydrateHistoryImages(wrongQuestions) {
  await Promise.all((wrongQuestions || []).map(async (q) => {
    if (!q || q.image || !q.imageUrl || !q.imageUrl.startsWith('firestore-history://')) return;
    try {
      const parts = q.imageUrl.replace('firestore-history://', '').split('/');
      const historyId = parts[0];
      const imgIdx = parts[1];
      const imgRef = window._doc(
        window._db,
        'users', window._currentUser.uid,
        'statsHistory', historyId,
        'images', imgIdx
      );
      const snap = await window._getDoc(imgRef);
      if (snap.exists()) q.image = snap.data().imageData;
    } catch (e) {
      console.warn('History image fetch failed', q.imageUrl, e);
    }
  }));
}

/* Delete all Firestore image subcollection docs for a history entry
   (called on Reset All Statistics, or wherever else a history entry is
   removed outright), so orphaned images don't pile up forever. */
async function deleteHistoryImagesFromStorage(historyId) {
  if (!window._db || !window._currentUser || !historyId) return;
  try {
    const col = window._collection(
      window._db,
      'users', window._currentUser.uid,
      'statsHistory', historyId,
      'images'
    );
    const snap = await window._getDocs(col);
    await Promise.all(snap.docs.map(d => window._deleteDoc(d.ref)));
  } catch (e) {
    console.warn('History image cleanup failed for', historyId, e);
  }
}

/* ══════════════════════════════════════════════════════════
   STATS HISTORY — full quiz snapshot (archival, right + wrong)

   `history[].wrongQuestions` (above) is what's actually displayed and
   what Retake uses. This is a separate, permanent archival copy of
   EVERY question in the quiz as the user answered it — right and
   wrong — kept "just in case" for a future feature (e.g. reviewing a
   full past quiz), without bloating anything currently in use:

     • Never inlined in the `stats` document at all — text-only data
       lives in one small doc per attempt:
         users/{uid}/statsHistory/{historyId}/full/data
     • Any images go to their own subcollection (same pattern as
       everything else here), separate from the wrong-question-only
       `images` subcollection so the two never collide:
         users/{uid}/statsHistory/{historyId}/fullImages/{idx}

   This is intentionally independent of the live quiz: it's a frozen
   copy taken at submit time, so it's completely unaffected if an
   admin later edits or deletes the quiz it came from. Best-effort —
   if it fails to save, the quiz's actual score/history entry (already
   saved) is never affected.
══════════════════════════════════════════════════════════ */

/* Saves a full snapshot of every question in a finished quiz — each
   with the question's own fields plus `userAnswer` and `isCorrect` —
   to Firestore. Mutates a clone, same caution as uploadHistoryImagesToStorage
   (never pass the live currentQuestions/userAnswers objects in). */
async function uploadHistoryFullSnapshotToStorage(historyId, allQuestions) {
  if (!window._db || !window._currentUser || !historyId) return false;
  try {
    for (let idx = 0; idx < allQuestions.length; idx++) {
      const q = allQuestions[idx];
      if (!q || !q.image) continue; // nothing to save
      try {
        const compressed = await compressImageDataUrl(q.image);
        const imgRef = window._doc(
          window._db,
          'users', window._currentUser.uid,
          'statsHistory', historyId,
          'fullImages', String(idx)
        );
        await window._setDoc(imgRef, { imageData: compressed });
        q.imageUrl = `firestore-full://${historyId}/${idx}`;
        delete q.image; // don't inline base64 in the snapshot doc
      } catch (e) {
        console.warn('Full-snapshot image save failed for question', idx, e);
        // Leave q.image as-is; the snapshot doc write below still proceeds.
      }
    }
    const ref = window._doc(
      window._db,
      'users', window._currentUser.uid,
      'statsHistory', historyId,
      'full', 'data'
    );
    await window._setDoc(ref, { questions: allQuestions, savedAt: Date.now() });
    return true;
  } catch (e) {
    // Archival-only feature — never let a failure here affect the quiz
    // save that already succeeded.
    console.warn('Full quiz snapshot save failed for', historyId, e);
    return false;
  }
}

/* Fetches a full quiz snapshot back (text + hydrated images), for a
   future "review the full quiz as taken" feature. Returns null if none
   was ever saved (e.g. the user wasn't signed in at the time, or the
   save failed). Not affected by later edits/deletion of the live quiz —
   it reads only from this account's own archival copy. */
async function hydrateHistoryFullSnapshot(historyId) {
  if (!window._db || !window._currentUser || !historyId) return null;
  try {
    const ref = window._doc(
      window._db,
      'users', window._currentUser.uid,
      'statsHistory', historyId,
      'full', 'data'
    );
    const snap = await window._getDoc(ref);
    if (!snap.exists()) return null;
    const questions = snap.data().questions || [];
    await Promise.all(questions.map(async (q) => {
      if (!q || q.image || !q.imageUrl || !q.imageUrl.startsWith('firestore-full://')) return;
      try {
        const parts = q.imageUrl.replace('firestore-full://', '').split('/');
        const imgRef = window._doc(
          window._db,
          'users', window._currentUser.uid,
          'statsHistory', parts[0],
          'fullImages', parts[1]
        );
        const imgSnap = await window._getDoc(imgRef);
        if (imgSnap.exists()) q.image = imgSnap.data().imageData;
      } catch (e) {
        console.warn('Full-snapshot image fetch failed', q.imageUrl, e);
      }
    }));
    return questions;
  } catch (e) {
    console.warn('Full quiz snapshot fetch failed for', historyId, e);
    return null;
  }
}

/* Delete the full-snapshot doc and its image subcollection for a
   history entry (called wherever a history entry is removed outright,
   e.g. Reset All Statistics), so nothing orphaned is left behind. */
async function deleteHistoryFullSnapshotFromStorage(historyId) {
  if (!window._db || !window._currentUser || !historyId) return;
  try {
    await window._deleteDoc(window._doc(
      window._db,
      'users', window._currentUser.uid,
      'statsHistory', historyId,
      'full', 'data'
    ));
    const col = window._collection(
      window._db,
      'users', window._currentUser.uid,
      'statsHistory', historyId,
      'fullImages'
    );
    const snap = await window._getDocs(col);
    await Promise.all(snap.docs.map(d => window._deleteDoc(d.ref)));
  } catch (e) {
    console.warn('Full quiz snapshot cleanup failed for', historyId, e);
  }
}

/* ══════════════════════════════════════════════════════════
   STATS HISTORY — per-quiz documents + manifest (incremental cache)

   Each finished quiz is its own Firestore document:
     users/{uid}/statsHistory/{historyId}
   (holding subject/lecture/score/wrongQuestions/etc — see saveQuizStats
   in js/app-core.js) instead of an ever-growing array field inside the
   `stats/{uid}` aggregate document.

   A tiny manifest — { [historyId]: ts } — travels inside the aggregate
   doc itself (cheap: it's just IDs and numbers, not question content)
   and tells the client EXACTLY which quizzes are new or changed since
   last time, mirroring the published-quiz manifest system in
   js/data-sync.js:
     • unchanged entry → read straight from the local IndexedDB cache, 0 reads
     • new entry → fetch just that one document
     • removed entry → dropped from memory + local cache
   This means taking one more quiz never re-downloads any of the
   others, no matter how large history grows — and vice versa, an
   already-cached quiz never gets re-fetched just because a new one
   was added elsewhere.

   Uses the generic IndexedDB key/value helpers from js/data-sync.js
   (_idbGet/_idbSet/_idbDelete/_idbKeys) rather than localStorage, same
   reasoning as the published-quiz cache: history entries can carry
   substantial text over years of use, well past localStorage's
   ~5-10MB per-origin quota.
══════════════════════════════════════════════════════════ */
function _historyIdbKey(uid, historyId) { return 'history:' + uid + ':' + historyId; }

/* Save one finished quiz as its own document, and warm the local
   per-entry cache immediately so it's available without a re-fetch. */
async function saveHistoryEntryToStorage(uid, historyId, entry) {
  const ref = window._doc(window._db, 'users', uid, 'statsHistory', historyId);
  await window._setDoc(ref, entry);
  await _idbSet(_historyIdbKey(uid, historyId), entry);
}

/* Load every history entry listed in the manifest — using the local
   per-entry cache wherever its timestamp still matches, and fetching
   only new/changed ones — then prune any cached entries no longer
   listed in the manifest (e.g. deleted via Reset All Statistics). */
async function loadHistoryEntries(uid, manifest) {
  const ids = Object.keys(manifest || {});
  const entries = [];

  await Promise.all(ids.map(async (historyId) => {
    const ts = manifest[historyId];
    const idbKey = _historyIdbKey(uid, historyId);
    const cached = await _idbGet(idbKey);

    if (cached && cached.ts === ts) {
      entries.push(cached); // cache hit — zero Firestore reads for this entry
      return;
    }

    try {
      const ref = window._doc(window._db, 'users', uid, 'statsHistory', historyId);
      const snap = await window._getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      entries.push(data);
      await _idbSet(idbKey, data); // persist this one entry immediately
    } catch (e) {
      console.warn('Failed to fetch history entry', historyId, e);
      if (cached) entries.push(cached); // fall back to a stale local copy rather than dropping it
    }
  }));

  try {
    const prefix = 'history:' + uid + ':';
    const knownIds = new Set(ids);
    const allKeys = await _idbKeys();
    await Promise.all(allKeys
      .filter(k => typeof k === 'string' && k.startsWith(prefix) && !knownIds.has(k.slice(prefix.length)))
      .map(k => _idbDelete(k)));
  } catch (e) { /* best-effort cleanup, never blocks loading */ }

  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first
  return entries;
}

/* Delete one history entry completely: its own document, its images
   and full-snapshot subcollections, and its local cache entry. Used by
   Reset All Statistics (and anywhere else a single entry is dropped). */
async function deleteHistoryEntryCompletely(uid, historyId) {
  if (!uid || !historyId) return;
  await Promise.all([
    window._deleteDoc(window._doc(window._db, 'users', uid, 'statsHistory', historyId)).catch(e =>
      console.warn('History entry doc delete failed for', historyId, e)),
    deleteHistoryImagesFromStorage(historyId),
    deleteHistoryFullSnapshotFromStorage(historyId),
    _idbDelete(_historyIdbKey(uid, historyId))
  ]);
}

/* ONE-TIME MIGRATION — accounts saved before per-quiz documents existed
   still have their whole `history` array inlined in the aggregate
   `stats/{uid}` document. Splits it out into individual
   users/{uid}/statsHistory/{historyId} documents + builds the manifest,
   so this account gets the same incremental-cache benefits as every
   quiz taken from now on. Also compacts any lingering inline images
   from before the #51 fix while it's at it. Runs at most once per
   account — after this, `aggregate.history` is gone for good and the
   manifest takes over. Best-effort: if the final aggregate write fails,
   the next load simply retries (harmless — already-migrated entries
   just get re-saved under new ids). */
async function _migrateInlineHistoryToDocs(uid, aggregate) {
  const legacyHistory = aggregate.history || [];
  const manifest = {};
  await Promise.all(legacyHistory.map(async (h, i) => {
    if (!h) return;
    const historyId = h.id || `${Date.now()}_legacy${i}`;
    const ts = h.ts || Date.parse(h.date) || (Date.now() - i);
    const entry = { ...h, id: historyId, ts };
    try {
      if (entry.wrongQuestions && entry.wrongQuestions.some(q => q && q.image)) {
        await uploadHistoryImagesToStorage(historyId, entry.wrongQuestions);
      }
      await saveHistoryEntryToStorage(uid, historyId, entry);
      manifest[historyId] = ts;
    } catch (e) {
      console.warn('Legacy history migration failed for entry', historyId, e);
    }
  }));

  const { history, ...rest } = aggregate;
  const migrated = { ...rest, historyManifest: manifest };
  try {
    await window._setDoc(window._doc(window._db, 'stats', uid), migrated);
  } catch (e) {
    console.warn('Failed to save migrated aggregate stats doc:', e);
  }
  return migrated;
}

/* ══════════════════════════════════════════════════════════
   STATS — per-user local cache + version check (aggregate document)

   Mirrors the PER-USER CACHE pattern used for custom quizzes (see
   ai-features.js): a tiny per-user version field tells us whether the
   `stats` aggregate document — totals, subjectStats, historyManifest —
   has changed since last time, so a normal page load/login can skip
   re-downloading it entirely when it hasn't. The `history` array itself
   is never part of this: it's cached per-quiz instead (see above).

     Server doc : users/{uid}/meta/cacheVersion { ..., stats: <ms> }
                  (same doc custom quizzes already use, just a
                  different field, so login still costs one small
                  read for both instead of two)
     Local keys : anu_msp_stats_cache_<uid>
                  anu_msp_stats_cache_ver_<uid>

   persistStats() (js/app-core.js) writes through the local cache and
   bumps the version on every save, so the very next load — this
   device or a fresh session — is already warm.
══════════════════════════════════════════════════════════ */
function _statsCacheKey(uid) { return 'anu_msp_stats_cache_' + uid; }
function _statsCacheVerKey(uid) { return 'anu_msp_stats_cache_ver_' + uid; }

function _readStatsCache(uid) {
  try {
    const raw = localStorage.getItem(_statsCacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function _writeStatsCache(uid, st) {
  try { localStorage.setItem(_statsCacheKey(uid), JSON.stringify(st)); } catch (e) {}
}
function _readStatsCacheVer(uid) {
  return localStorage.getItem(_statsCacheVerKey(uid)) || null;
}
function _writeStatsCacheVer(uid, v) {
  try { localStorage.setItem(_statsCacheVerKey(uid), String(v)); } catch (e) {}
}

/* Fetch this user's stats version field (shares a doc with the
   custom-quizzes version — see comment above). */
async function _fetchStatsServerVersion(uid) {
  try {
    const snap = await window._getDoc(window._doc(window._db, 'users', uid, 'meta', 'cacheVersion'));
    return snap.exists() && snap.data().stats != null ? String(snap.data().stats) : null;
  } catch (e) { return null; }
}

/* Bump this user's stats version field (call after any stats write).
   Uses merge so it never clobbers the custom-quizzes `v` field living
   in the same doc. */
async function _bumpStatsVersion(uid) {
  if (!window._db) return null;
  try {
    const v = Date.now();
    await window._setDoc(window._doc(window._db, 'users', uid, 'meta', 'cacheVersion'), { stats: v }, { merge: true });
    return String(v);
  } catch (e) {
    console.warn('_bumpStatsVersion failed:', e);
    return null;
  }
}

function loadCustomQuizzes() {
  return window._cachedCustomQuizzes || [];
}

async function loadCustomQuizzesFromFirestore() {
  if (!window._currentUser) return;
  const uid = window._currentUser.uid;
  try {
    // Cache check: one tiny doc read tells us if anything changed since last time
    const serverVer = await _fetchCqServerVersion(uid);
    const localVer = _readCqCacheVer(uid);
    const cached = _readCqCache(uid);

    if (serverVer && localVer === serverVer && cached) {
      console.log('[cache] custom quizzes hit, skipping Firestore fetch');
      window._cachedCustomQuizzes = cached;
      return;
    }

    const col = window._collection(window._db, 'users', uid, 'customQuizzes');
    const snap = await window._getDocs(col);
    const quizzes = [];
    snap.forEach(d => quizzes.push(d.data()));
    quizzes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    await Promise.all(quizzes.map(quiz => hydrateQuizImages(quiz.questions || [])));
    window._cachedCustomQuizzes = quizzes;

    _writeCqCache(uid, quizzes);
    if (serverVer) _writeCqCacheVer(uid, serverVer);
    else await _bumpCqVersion(uid).then(v => v && _writeCqCacheVer(uid, v)); // first time: create the doc
  } catch (e) {
    console.error('Failed to load custom quizzes:', e);
    try {
      const cached = _readCqCache(uid);
      window._cachedCustomQuizzes = cached || [];
    } catch (_) { window._cachedCustomQuizzes = []; }
  } finally {
    _fsReady.customQuizzes = true;
  }
}

/* Writes `arr` to local storage: every quiz in it is upserted, and every id
   in `deletedIds` (if any) is explicitly removed.

   This deliberately does NOT infer deletions by diffing `arr` against
   what's currently in IndexedDB (i.e. "delete anything on disk that isn't
   in arr"), even though that's a natural-looking way to write this and is
   what an earlier version of this function did. That approach is only
   correct as long as `arr` is guaranteed to be the complete, up-to-date
   list — and it isn't always: window._cachedCustomQuizzes (what
   loadCustomQuizzes() returns, and what most callers pass in here as their
   starting point) gets reset to a fresh load from IndexedDB on every auth
   state change (see js/firebase-init.js), not just once at page load. A
   save that happens to land in the brief async window before that reload
   resolves would build `arr` from an empty/incomplete cache, and a
   diff-based delete would then silently wipe every quiz missing from it —
   real, permanent data loss (not just a display glitch that a refresh
   fixes). Requiring callers that actually mean to delete something to say
   so via `deletedIds` removes that whole class of bug: a stale snapshot
   can at worst redundantly re-save quizzes that didn't need it, but it can
   never delete one just because it happened to be missing from an
   in-flight load. */
async function saveCustomQuizzesList(arr, deletedIds = []) {
  // Custom quizzes now live entirely in local storage (see js/local-store.js)
  // — no Firestore round-trip, no Storage image upload, no version bump.
  window._cachedCustomQuizzes = arr;
  const { saveCustomQuiz, deleteCustomQuiz: deleteLocal } =
    await import('./local-store.js');

  for (const id of deletedIds) {
    await deleteLocal(id);
  }
  for (const quiz of arr) {
    await saveCustomQuiz(quiz);
  }
}
function openCustomQuizzes() {
  fsAwaitIfNeeded('customQuizzes', 'Loading your quizzes…', () => {
    // Data (window._cachedCustomQuizzes etc. — see firebase-init.js) landed
    // after this modal's own initial render already ran below. Re-render
    // now so it actually reflects what just loaded, unless the user already
    // closed the modal in the meantime.
    if (!document.getElementById('customQuizOverlay').classList.contains('hidden')) {
      renderCustomQuizModal();
    }
  });
  cqSelectedFiles = [];
  cqGeneratedQuestions = null;
  cqGeneratedTitle = '';
  cqBusy = false;
  cqLectureFiles = [];
  cqCustomPrompt = '';
  cqQuestionCount = '';
  cqEditingQuizId = null;
  cqEditQuestions = null;
  cqCreatingNew = false;
  cqNewQuizTitle = '';
  cqMultiSelected = new Set();
  _questionEditDirty = false;
  cqResetCollectionsTransientState();
  document.getElementById('customQuizOverlay').classList.remove('hidden');
  renderCustomQuizModal();
}
function closeCustomQuizzes() {
  _guardedClose(() => {
    document.getElementById('customQuizOverlay').classList.add('hidden');
    fsLoadingHide();
  });
}

/* Renders the inline "currently using API N" badge. This is called both
   directly (for the initial render of each modal section) AND by the
   rotation engine (js/api-rotation.js → _broadcastRotationUI) any time
   auto-rotation switches the active key mid-run, so every caller wraps
   its output in a `.cq-api-badge-slot` div — that's the hook the rotation
   engine uses to refresh just this badge in place, live, without having
   to re-render the whole modal around it (which would lose scroll
   position, open editors, etc). */
function renderCqApiKeyBadge() {
  const entry = getActiveApiKeyEntry();
  const keys = loadApiKeys();
  if (!entry) {
    return `<div class="apikey-empty" style="padding:14px;">
      <span class="ns-icon"><svg class="hicon" style="width:32px;height:32px;" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></span>No API key configured yet.
      <div style="margin-top:8px;"><button class="apikey-open-btn ghost" onclick="openApiKeyManager(() => renderCustomQuizModal())"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Add an API Key</button></div>
    </div>`;
  }
  const idx = Math.max(0, keys.findIndex(k => k.id === entry.id));
  const allRL = (typeof allKeysRateLimited === 'function') && allKeysRateLimited();
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <div class="apikey-badge">
      <span class="apikey-dot" style="background:${entry.color || 'var(--accent)'};"></span>
      Using API ${idx + 1}: ${escapeHtml(entry.label)}
      ${allRL ? `<span class="apikey-status-chip apikey-status-limited" style="margin-left:4px;" title="Rotating automatically until a key frees up"><svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> All rate-limited</span>` : ''}
    </div>
    <button class="apikey-open-btn ghost" onclick="openApiKeyManager(() => renderCustomQuizModal())"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage API Keys</button>
  </div>`;
}

function renderCustomQuizModal() {
  cqCollectionsHost = 'custom'; // this modal owns the shared collections tree/breadcrumb UI while it's open
  const body = document.getElementById('customQuizBody');
  const quizzes = loadCustomQuizzes();
  const collections = loadQuizCollections();

  // Remember the folder-tree sidebar's scroll position — it's torn down
  // and rebuilt from scratch below (along with the rest of the modal),
  // which would otherwise snap it back to the top on every single action
  // inside it (picking a color/icon, renaming, expanding a folder, etc).
  // Same pattern as the scroll-preservation in renderAdminQuestionEditor.
  const _prevSidebar = body ? body.querySelector('.cq-coll-sidebar') : null;
  const _prevSidebarScrollTop = _prevSidebar ? _prevSidebar.scrollTop : null;

  let html = '';

  /* ── Saved custom quizzes ── */
  html += `<div class="cq-section">
    <div class="cq-section-title"><svg class="micon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Your Custom Quizzes</div>

    <!-- API Key -->
    <div class="cq-api-badge-slot">${renderCqApiKeyBadge()}</div>
    `;
  if (!quizzes.length) {
    html += `<div class="empty-state" style="padding:12px;">
      <div class="empty-icon"><svg class="hicon" style="width:36px;height:36px;" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
      No custom quizzes yet — create one below using AI.
    </div>`;
  } else {
    // Prune selections for quizzes that no longer exist (deleted, etc.)
    const liveIds = new Set(quizzes.map(q => q.id));
    Array.from(cqMultiSelected).forEach(id => { if (!liveIds.has(id)) cqMultiSelected.delete(id); });

    if (cqMultiSelected.size > 0) {
      const totalQs = quizzes
        .filter(q => cqMultiSelected.has(q.id))
        .reduce((sum, q) => sum + q.questions.length, 0);
      const defMins = Math.max(5, totalQs);
      html += `<div class="cq-quiz-item" style="background:var(--surface-2);border:1.5px solid var(--accent);">
        <div class="cq-quiz-info">
          <div class="cq-quiz-name"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> ${cqMultiSelected.size} quiz${cqMultiSelected.size !== 1 ? 'zes' : ''} selected — ${totalQs} question${totalQs !== 1 ? 's' : ''} total</div>
          <div class="cq-quiz-meta">Start them together in one sitting, in the order checked below.</div>
        </div>
        <div class="cq-quiz-actions">
          <input type="number" id="cqMultiMins" value="${defMins}" min="1" max="480" title="Duration (minutes)" />
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;font-weight:700;color:var(--text-muted);cursor:pointer;" title="Shuffle questions">
            <input type="checkbox" id="cqMultiShuffle" style="width:14px;height:14px;accent-color:var(--accent);" /> <svg class="sicon" viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
          </label>
          <div class="cq-move-wrap">
            <button class="cq-btn cq-btn-secondary" id="cqBulkMoveBtn" style="background:var(--violet-strong);" onclick="event.stopPropagation(); cqToggleBulkMoveMenu()"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Move to…</button>
            ${cqBulkMoveMenuOpen ? _renderBulkMoveMenuHTML() : ''}
          </div>
          <button class="cq-btn" onclick="startCustomQuizzesMulti()"><svg class="sicon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Selected</button>
          <button class="cq-btn cq-btn-secondary" onclick="clearCqMultiSelect()">✖ Clear</button>
        </div>
      </div>`;
    }

    /* ── Collections sidebar + breadcrumb + filtered list ── */
    const visibleQuizzes = _filterQuizzesByActiveCollection(quizzes, collections);
    html += `<div class="cq-coll-layout ${cqSidebarCollapsed ? 'cq-coll-sidebar-collapsed' : ''}">
      ${renderCqCollectionsSidebarHTML(quizzes, collections)}
      <div class="cq-coll-main">
        ${renderCqBreadcrumbHTML(collections)}
        <div class="cq-coll-quiz-list">`;

    if (!visibleQuizzes.length) {
      html += `<div class="empty-state" style="padding:16px 12px;">
        <div class="empty-icon"><svg class="hicon" style="width:36px;height:36px;" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
        No quizzes in this folder yet — drag a quiz here, or use its <svg class="sicon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Move button.
      </div>`;
    }

    visibleQuizzes.forEach(q => {
      const defMins = Math.max(5, q.questions.length);
      const isEditing = cqEditingQuizId === q.id;
      const isChecked = cqMultiSelected.has(q.id);
      const moveOpen = cqCollectionMoveMenuFor === q.id;
      html += `<div class="cq-quiz-item" draggable="true"
          ondragstart="cqQuizDragStart(event,'${q.id}')" ondragend="cqQuizDragEnd(event)">
        <div class="cq-quiz-info" style="display:flex;align-items:flex-start;gap:8px;">
          <span class="cq-drag-handle" title="Drag to a folder">⠿</span>
          <input type="checkbox" title="Select for a combined quiz" style="margin-top:3px;width:15px;height:15px;accent-color:var(--accent);flex-shrink:0;"
            ${isChecked ? 'checked' : ''} onchange="toggleCqMultiSelect('${q.id}', this.checked)" />
          <div>
            <div class="cq-quiz-name">${escapeHtml(q.title)}</div>
            <div class="cq-quiz-meta">${q.questions.length} question${q.questions.length !== 1 ? 's' : ''} &middot; created ${new Date(q.createdAt).toLocaleDateString()}${q.sharedAt ? ' &middot; <span class="share-chip"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg> Shared</span>' : ''}</div>
            ${_quizCollectionChipHTML(q, collections) ? `<div style="margin-top:5px;">${_quizCollectionChipHTML(q, collections)}</div>` : ''}
          </div>
        </div>
        <div class="cq-quiz-actions">
          <input type="number" id="cqMins_${q.id}" value="${defMins}" min="1" max="180" title="Duration (minutes)" />
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;font-weight:700;color:var(--text-muted);cursor:pointer;" title="Shuffle questions">
            <input type="checkbox" id="cqShuffle_${q.id}" style="width:14px;height:14px;accent-color:var(--accent);" /> <svg class="sicon" viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
          </label>
          <button class="cq-btn" onclick="startCustomQuiz('${q.id}')"><svg class="sicon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start</button>
          <div class="cq-move-wrap">
            <button class="cq-btn cq-btn-secondary" data-move-btn="${q.id}" style="background:var(--violet-strong);" onclick="event.stopPropagation(); cqToggleQuizMoveMenu('${q.id}')" title="Move to a folder"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Move</button>
            ${moveOpen ? _renderQuizMoveMenuHTML(q) : ''}
          </div>
          <button class="cq-btn cq-btn-secondary" onclick="renameCustomQuiz('${q.id}')" style="background:var(--unanswered-bg);color:var(--unanswered-fg);border:1.5px solid var(--amber-strong);" title="Rename this quiz"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Rename</button>
          <button class="cq-btn cq-btn-secondary" onclick="${isEditing ? 'closeCustomQuizEditor()' : `openCustomQuizEditor('${q.id}')`}" style="background:var(--accent);color:#fff;">${isEditing ? '✖ Close Editor' : '<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit'}</button>
          <button class="cq-share-btn" onclick="shareCustomQuiz('${q.id}')" title="Share with community"><svg class="sicon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Share</button>
          <button class="cq-btn cq-btn-danger" onclick="deleteCustomQuiz('${q.id}')" aria-label="Delete quiz" title="Delete quiz"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>
        ${isEditing ? `<div class="cq-inline-editor" id="cqCustomEditorArea_${q.id}" style="margin-top:10px;"></div>` : ''}
      </div>`;
    });

    html += `</div></div></div>`; // .cq-coll-quiz-list, .cq-coll-main, .cq-coll-layout
  }
  html += `</div>`;

  /* ── Write your own quiz by hand (no AI) ── */
  html += `<div class="cq-section">
    <div class="cq-section-title"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Create Your Own Quiz</div>

    <!-- API Key -->
    <div class="cq-api-badge-slot">${renderCqApiKeyBadge()}</div>
    `;
  if (cqCreatingNew) {
    html += `<div class="cq-field-hint">Write your quiz from scratch — same editor as editing an existing quiz, you just start from a blank question.</div>
    <div class="cq-input-row">
      <input type="text" id="cqNewQuizTitleInput" placeholder="Quiz title (e.g. 'My Practice Set')"
             value="${escapeHtml(cqNewQuizTitle)}" oninput="cqNewQuizTitle = this.value" />
    </div>
    <div class="cq-inline-editor" id="cqNewQuizEditorArea"></div>`;
  } else {
    html += `<div class="cq-field-hint">Prefer to type your own questions instead of using AI? Start with one blank question and build it up.</div>
    <button class="cq-btn cq-btn-secondary" onclick="openNewQuizComposer()" style="background:var(--green-mid);margin-top:6px;">＋ Start Writing a New Quiz</button>`;
  }
  html += `</div>`;

  /* ── Create new quiz with AI ── */
  html += `<div class="cq-section">
    <div class="cq-section-title"><svg class="micon" viewBox="0 0 24 24"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/></svg> Create a New Quiz with AI (Gemini)</div>

    <!-- API Key -->
    <div class="cq-api-badge-slot">${renderCqApiKeyBadge()}</div>

    <!-- Mode tabs -->
    <div class="cq-tabs">
      <button class="cq-tab-btn ${cqMode === 'extract' ? 'active' : ''}" onclick="setCQMode('extract')"><svg class="micon" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg> Extract from MCQs</button>
      <button class="cq-tab-btn ${cqMode === 'generate' ? 'active' : ''}" onclick="setCQMode('generate')"><svg class="micon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generate from Lecture</button>
    </div>

    <!-- TAB: Extract from MCQs (original flow) -->
    <div id="cqTabExtract" ${cqMode !== 'extract' ? 'style="display:none"' : ''}>
      <div class="cq-field-hint">Upload one or more images or PDFs that already contain MCQ questions — the AI will extract them exactly as written. Add multiple files if your quiz is split across several pages or documents.</div>
      <div class="cq-dropzone" id="cqDropzone" onclick="document.getElementById('cqFileInput').click()">
        <div class="cq-dz-icon"><svg class="hicon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
        <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more images or PDFs of your quiz questions</div>
        ${cqSelectedFiles.length ? _cqFileListHTML(cqSelectedFiles, 'cqRemoveSelectedFile') : ''}
        ${cqSelectedFiles.length ? `<div class="cq-dz-add-more"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Click again to add more files</div>` : ''}
      </div>
      <input type="file" id="cqFileInput" accept="image/*,application/pdf" multiple style="display:none;" onchange="handleCQFileSelect(event)" />

      <!-- AI Answering — single menu (master switch) + submenu (exactly one
           behavior), so it's never ambiguous which one is actually active.
           The Reference Source card sits directly below it since both
           submenu options use it. -->
      <div style="margin:10px 0 4px;padding:12px 14px;background:${cqAiAnsweringEnabled ? 'var(--violet-pale)' : 'var(--card)'};border:1.5px solid ${cqAiAnsweringEnabled ? 'var(--violet-strong)' : 'var(--border)'};border-radius:10px;transition:all .2s;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <div style="position:relative;width:42px;height:24px;flex-shrink:0;">
            <input type="checkbox" id="cqAiAnsweringChk" ${cqAiAnsweringEnabled ? 'checked' : ''}
              onchange="cqAiAnsweringEnabled = this.checked; renderCustomQuizModal()"
              style="opacity:0;width:0;height:0;position:absolute;" />
            <span style="position:absolute;inset:0;border-radius:24px;background:${cqAiAnsweringEnabled ? 'var(--violet-strong)' : '#ccc'};transition:background .2s;"></span>
            <span style="position:absolute;top:3px;left:${cqAiAnsweringEnabled ? '21px' : '3px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></span>
          </div>
          <div>
            <div style="font-size:.82rem;font-weight:800;color:${cqAiAnsweringEnabled ? 'var(--violet-dark)' : 'var(--text)'};letter-spacing:.2px;">
              <svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI Answering
            </div>
            <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px;">
              Let Gemini AI determine correct answers during extraction
            </div>
          </div>
        </label>

        ${cqAiAnsweringEnabled ? `
        <div style="margin:11px 0 0 8px;padding-left:14px;border-left:2.5px solid var(--violet-border);display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
            <input type="radio" name="cqAiAnswerSubmodeRadio" value="missing" ${cqAiAnswerSubmode === 'missing' ? 'checked' : ''}
              onchange="cqAiAnswerSubmode = 'missing'; renderCustomQuizModal()"
              style="margin-top:3px;width:16px;height:16px;accent-color:var(--violet-strong);flex-shrink:0;" />
            <div>
              <div style="font-size:.78rem;font-weight:700;color:var(--violet-dark);"><svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Only answer questions missing a key</div>
              <div style="font-size:.71rem;color:var(--text-muted);margin-top:1px;">Fills in an answer only for questions that have no answer key in the source document</div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
            <input type="radio" name="cqAiAnswerSubmodeRadio" value="all" ${cqAiAnswerSubmode === 'all' ? 'checked' : ''}
              onchange="cqAiAnswerSubmode = 'all'; renderCustomQuizModal()"
              style="margin-top:3px;width:16px;height:16px;accent-color:var(--violet-strong);flex-shrink:0;" />
            <div>
              <div style="font-size:.78rem;font-weight:700;color:var(--violet-dark);"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Solve / verify all questions</div>
              <div style="font-size:.71rem;color:var(--text-muted);margin-top:1px;">Re-solves every question, including ones that already have an answer key in the source</div>
            </div>
          </label>
        </div>
        <div style="margin:9px 0 0 8px;padding-left:14px;border-left:2.5px solid var(--violet-border);">
          <div class="cq-batch-config">
            ${_renderBatchSizeConfigHTML('cqAnswerBatchSizeInput', 'cqAnswerBatchSize', cqAnswerBatchSize, 20)}
          </div>
        </div>
        ` : ''}
      </div>

      <!-- Reference Source — directly below the AI Answering menu (both
           submenu options rely on it), so there's no confusion about
           which control it belongs to. -->
      ${cqAiAnsweringEnabled ? `
      <div style="margin:8px 0 4px;padding:12px 14px;background:var(--violet-pale);border:1.5px solid var(--violet-border);border-radius:10px;">
        <div style="font-size:.75rem;font-weight:700;color:var(--violet-dark);margin-bottom:5px;">
          <svg class="sicon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Reference Source (optional) — upload images/PDFs the AI should use to answer
        </div>
        <div class="cq-dropzone cq-dz-purple" id="cqSourceDropzone" onclick="document.getElementById('cqSourceFileInput').click()">
          <div class="cq-dz-icon"><svg class="hicon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
          <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
          ${cqAiSourceFiles.length ? _cqFileListHTML(cqAiSourceFiles, 'cqRemoveSourceFile', sf => sf.file) : ''}
          ${cqAiSourceFiles.length ? `<div class="cq-dz-add-more"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Click again to add more files</div>` : ''}
        </div>
        <input type="file" id="cqSourceFileInput" accept="image/*,application/pdf" multiple style="display:none;"
          onchange="handleCqSourceFileSelect(event)" />
      </div>
      ` : ''}

      <!-- Fill Choices toggle -->
      <div style="margin:8px 0 4px;padding:11px 14px;background:${cqFillChoicesToggle ? 'var(--unanswered-bg)' : 'var(--card)'};border:1.5px solid ${cqFillChoicesToggle ? 'var(--amber-strong)' : 'var(--border)'};border-radius:10px;transition:all .2s;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <div style="position:relative;width:42px;height:24px;flex-shrink:0;">
            <input type="checkbox" ${cqFillChoicesToggle ? 'checked' : ''}
              onchange="cqFillChoicesToggle = this.checked; renderCustomQuizModal()"
              style="opacity:0;width:0;height:0;position:absolute;" />
            <span style="position:absolute;inset:0;border-radius:24px;background:${cqFillChoicesToggle ? 'var(--unanswered-fg)' : '#ccc'};transition:background .2s;"></span>
            <span style="position:absolute;top:3px;left:${cqFillChoicesToggle ? '21px' : '3px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></span>
          </div>
          <div>
            <div style="font-size:.82rem;font-weight:800;color:${cqFillChoicesToggle ? 'var(--unanswered-fg)' : 'var(--text)'};letter-spacing:.2px;">
              <svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Fill Choices (AI)
            </div>
            <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px;">
              AI tops every question up to 4 answer choices — only adds missing distractors, never touches the correct answer
            </div>
          </div>
        </label>
        ${cqFillChoicesToggle ? `<div style="margin:9px 0 0;">${_renderAiThinkingToggle('fillBulk', 'amber')}</div>` : ''}
      </div>

      <!-- Refine Questions toggle -->
      <div style="margin:8px 0 4px;padding:11px 14px;background:${cqRefineToggle ? 'var(--violet-pale)' : 'var(--card)'};border:1.5px solid ${cqRefineToggle ? 'var(--violet-border)' : 'var(--border)'};border-radius:10px;transition:all .2s;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <div style="position:relative;width:42px;height:24px;flex-shrink:0;">
            <input type="checkbox" ${cqRefineToggle ? 'checked' : ''}
              onchange="cqRefineToggle = this.checked; renderCustomQuizModal()"
              style="opacity:0;width:0;height:0;position:absolute;" />
            <span style="position:absolute;inset:0;border-radius:24px;background:${cqRefineToggle ? 'var(--violet-dark)' : '#ccc'};transition:background .2s;"></span>
            <span style="position:absolute;top:3px;left:${cqRefineToggle ? '21px' : '3px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></span>
          </div>
          <div>
            <div style="font-size:.82rem;font-weight:800;color:${cqRefineToggle ? 'var(--violet-dark)' : 'var(--text)'};letter-spacing:.2px;">
              <svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Questions (AI)
            </div>
            <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px;">
              AI polishes grammar &amp; exam-style phrasing on every question's wording — doesn't change what's being asked or touch the choices
            </div>
          </div>
        </label>
        ${cqRefineToggle ? `<div style="margin:9px 0 0;">${_renderAiThinkingToggle('refineBulk', 'violet')}</div>` : ''}
        ${cqRefineToggle ? `
        <div style="margin:9px 0 0;">
          <div style="font-size:.73rem;font-weight:700;color:var(--violet-dark);margin-bottom:5px;">
            <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Custom Instructions (optional) — applied to every question's refine
          </div>
          <textarea class="cq-textarea" id="cqRefineCustomInput" rows="2"
            placeholder="Optional — anything extra you want applied to every question (e.g. &quot;keep each question to one sentence&quot;). Only overrides the default refine behavior where it truly conflicts — grammar and exam phrasing still apply otherwise."
            oninput="cqRefineCustomInstructions = this.value"
            style="border-color:var(--violet-border);">${escapeHtml(cqRefineCustomInstructions)}</textarea>
        </div>
        ` : ''}
      </div>

      <!-- Content Filter toggle — removes any question the AI can only
           answer from its own knowledge, not from the reference source
           uploaded right below it. Unlike AI Answering's reference source
           above (optional), this one is required: the toggle refuses to
           run without at least one file, since a filter pass with nothing
           to check against would be indistinguishable from one that
           filters out nothing. -->
      <div style="margin:8px 0 4px;padding:11px 14px;background:${cqContentFilterToggle ? 'var(--wrong-bg)' : 'var(--card)'};border:1.5px solid ${cqContentFilterToggle ? 'var(--wrong-fg)' : 'var(--border)'};border-radius:10px;transition:all .2s;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <div style="position:relative;width:42px;height:24px;flex-shrink:0;">
            <input type="checkbox" ${cqContentFilterToggle ? 'checked' : ''}
              onchange="cqContentFilterToggle = this.checked; renderCustomQuizModal()"
              style="opacity:0;width:0;height:0;position:absolute;" />
            <span style="position:absolute;inset:0;border-radius:24px;background:${cqContentFilterToggle ? 'var(--wrong-fg)' : '#ccc'};transition:background .2s;"></span>
            <span style="position:absolute;top:3px;left:${cqContentFilterToggle ? '21px' : '3px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3);"></span>
          </div>
          <div>
            <div style="font-size:.82rem;font-weight:800;color:${cqContentFilterToggle ? 'var(--wrong-fg)' : 'var(--text)'};letter-spacing:.2px;">
              <svg class="sicon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Content Filter (AI)${_betaBadgeHTML()}
            </div>
            <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px;">
              Removes every question the AI can only answer from its own knowledge, not from the reference source below — needs at least one file
            </div>
          </div>
        </label>
        ${cqContentFilterToggle ? `
        <div style="margin:11px 0 0 8px;padding-left:14px;border-left:2.5px solid var(--wrong-fg);">
          <details class="cq-bulk-ai-opts" ${_detailsIsOpen('cqPreExtractFilterOpts', false) ? 'open' : ''} ontoggle="_detailsToggle('cqPreExtractFilterOpts', this.open)">
            <summary><svg class="sicon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Content Filter settings</summary>
            <div style="margin-top:8px;">
              <div style="font-size:.75rem;font-weight:700;color:var(--wrong-fg);margin-bottom:5px;">
                <svg class="sicon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Reference Source (required) — upload the images/PDFs every question must check out against
              </div>
              <div class="cq-dropzone cq-dz-purple" id="cqFilterSourceDropzone" onclick="document.getElementById('cqFilterSourceFileInput').click()">
                <div class="cq-dz-icon"><svg class="hicon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
                <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
                ${cqFilterSourceFiles.length ? _cqFileListHTML(cqFilterSourceFiles, 'cqRemoveFilterSourceFile', sf => sf.file) : ''}
                ${cqFilterSourceFiles.length ? `<div class="cq-dz-add-more"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Click again to add more files</div>` : ''}
              </div>
              <input type="file" id="cqFilterSourceFileInput" accept="image/*,application/pdf" multiple style="display:none;"
                onchange="handleCqFilterSourceFileSelect(event)" />
              <div class="cq-bulk-ai-opts-divider"></div>
              ${_renderCqFilterPassesConfigHTML('renderCustomQuizModal()')}
            </div>
          </details>
        </div>
        ` : ''}
      </div>

      <!-- Sequential-run notice — shown whenever 2+ AI steps are selected,
           since they all write to the same question objects and could
           otherwise conflict if fired at once. -->
      ${(() => {
        const steps = [
          cqAiAnsweringEnabled ? 'Solve/Answer' : null,
          cqContentFilterToggle ? 'Content Filter' : null,
          cqFillChoicesToggle ? 'Fill Choices' : null,
          cqRefineToggle ? 'Refine Questions' : null
        ].filter(Boolean);
        if (steps.length < 2) return '';
        const stepsText = steps.map((s, idx) => `${idx + 1}) ${s}`).join(' → ');
        return `
      <div style="margin:8px 0 4px;padding:10px 14px;background:#FFFDE7;border:1.5px solid #FBC02D;border-radius:10px;font-size:.75rem;color:#7A5C00;">
        <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> <strong>Multiple AI steps selected</strong> — to avoid conflicting edits on the same question, they'll run one at a time (not simultaneously), in this order:<br>
        ${stepsText}.
      </div>`;
      })()}


      <div class="cq-input-row">
        <input type="text" id="cqTitleInput" placeholder="Quiz title (e.g. 'Cardio Lecture 3')"
               value="${escapeHtml(cqGeneratedTitle)}" oninput="cqGeneratedTitle = this.value" />
        <button class="cq-btn" id="cqGenerateBtn" onclick="generateQuizFromAI()" ${cqBusy ? 'disabled' : ''}>
          ${cqBusy ? '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Generating…' : '<svg class="sicon" viewBox="0 0 24 24"><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/></svg> Extract Questions'}
        </button>
      </div>
    </div>

    <!-- TAB: Generate from Lecture -->
    <div id="cqTabGenerate" ${cqMode !== 'generate' ? 'style="display:none"' : ''}>
      <div class="cq-badge-row">
        <span class="cq-badge"><svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Clinical scenarios included</span>
        <span class="cq-badge"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Hard difficulty</span>
        <span class="cq-badge"><svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI-written questions</span>
      </div>
      <div class="cq-field-hint">Upload your lecture material (PDF, image, or .txt file) — the AI will generate brand-new original questions from the content. Add multiple files to combine several sources into one quiz.</div>
      <div class="cq-dropzone" id="cqLectureDropzone" onclick="document.getElementById('cqLectureFileInput').click()">
        <div class="cq-dz-icon"><svg class="hicon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
        <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more PDF, image, or .txt lecture files</div>
        ${cqLectureFiles.length ? _cqFileListHTML(cqLectureFiles, 'cqRemoveLectureFile') : ''}
        ${cqLectureFiles.length ? `<div class="cq-dz-add-more"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Click again to add more files</div>` : ''}
      </div>
      <input type="file" id="cqLectureFileInput" accept="image/*,application/pdf,text/plain,.txt" multiple style="display:none;" onchange="handleLectureFileSelect(event)" />

      <div class="cq-qcount-row">
        <label for="cqQCountInput">Number of questions:</label>
        <input type="number" id="cqQCountInput" placeholder="Auto" min="5" max="100"
               value="${escapeHtml(cqQuestionCount)}" oninput="cqQuestionCount = this.value" />
        <span class="cq-field-hint" style="margin:0;">(leave blank = AI decides based on content)</span>
      </div>

      <div class="cq-field-hint">Custom prompt / focus (optional):</div>
      <textarea class="cq-textarea" id="cqCustomPromptInput"
        placeholder="e.g. Focus on drug mechanisms and side effects. Include dosing questions."
        oninput="cqCustomPrompt = this.value">${escapeHtml(cqCustomPrompt)}</textarea>

      <div class="cq-input-row">
        <input type="text" id="cqLectureTitleInput" placeholder="Quiz title (e.g. 'Respiratory Lecture 2')"
               value="${escapeHtml(cqGeneratedTitle)}" oninput="cqGeneratedTitle = this.value" />
        <button class="cq-btn" id="cqLectureGenBtn" onclick="generateQuizFromLecture()" ${cqBusy ? 'disabled' : ''}>
          ${cqBusy ? '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Generating…' : '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg> Generate Questions'}
        </button>
      </div>
    </div>

<!-- Pause/resume/stop and status reflect the LIVE generation state
         (cqBusy/cqIsPaused/cqPauseRequested/cqStopRequested), and the
         status box is pre-filled from the cached status HTML — this is
         what makes returning to this modal mid-run (e.g. after switching
         API keys via <svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage APIs, which re-renders this modal while
         a background extraction/generation is still going) show the run
         exactly as it was, instead of a frozen, blank-looking modal. See
         js/dom-utils.js for the cache these values come from. -->
    ${(() => {
      const showRow = cqBusy;
      const pausingNow = cqBusy && cqPauseRequested && !cqIsPaused;
      const showPauseBtn = cqBusy && !cqIsPaused;
      const showResumeBtn = cqBusy && cqIsPaused;
      const stoppingNow = cqBusy && cqStopRequested;
      const cachedStatus = cqBusy ? getCachedStatusHTML('cqStatus') : '';
      return `
    <div id="cqPauseRow" style="display:${showRow ? 'flex' : 'none'};gap:8px;margin:8px 0;align-items:center;flex-wrap:wrap;">
      <button class="cq-btn" id="cqPauseBtn" type="button" onclick="cqRequestPause()" ${pausingNow ? 'disabled' : ''}
        style="display:${showPauseBtn ? 'inline-flex' : 'none'};background:var(--unanswered-bg);color:var(--unanswered-fg);border:1.5px solid var(--amber-strong);">${pausingNow ? '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Pausing…' : '<svg class="sicon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause'}</button>
      <button class="cq-btn" id="cqResumeBtn" type="button" onclick="cqResumeGeneration()"
        style="display:${showResumeBtn ? 'inline-flex' : 'none'};background:var(--correct-bg);color:var(--correct-fg);border:1.5px solid #66BB6A;"><svg class="sicon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume</button>
      <button class="ai-tool-stop-btn" id="cqStopBtn" type="button" onclick="cqRequestStop()" ${stoppingNow ? 'disabled' : ''}
        style="display:${showRow ? 'inline-block' : 'none'};padding:7px 12px;font-size:.82rem;" title="Stop extraction/generation immediately">${stoppingNow ? '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Stopping…' : '<svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop'}</button>
    </div>
    <div id="cqStatus">${cachedStatus}</div>`;
    })()}
    <div id="cqPreviewArea"></div>
  </div>`;

  body.innerHTML = html;

  if (_prevSidebarScrollTop !== null) {
    const _newSidebar = body.querySelector('.cq-coll-sidebar');
    if (_newSidebar) _newSidebar.scrollTop = _prevSidebarScrollTop;
  }

  if (cqGeneratedQuestions) renderCQPreview();
  if ((cqEditingQuizId || cqCreatingNew) && cqEditQuestions) renderCustomQuizEditor();
  setupCQDropzone();
  setupLectureDropzone();
  setupSourceDropzone();
  setupFilterSourceDropzone();
}

function setupCQDropzone() {
  const dz = document.getElementById('cqDropzone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    files.forEach(acceptCQFile);
  });
}

function setupLectureDropzone() {
  const dz = document.getElementById('cqLectureDropzone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    files.forEach(acceptLectureFile);
  });
}

function handleCQFileSelect(event) {
  const files = Array.from((event.target && event.target.files) || []);
  files.forEach(acceptCQFile);
  event.target.value = '';
}

function handleLectureFileSelect(event) {
  const files = Array.from((event.target && event.target.files) || []);
  files.forEach(acceptLectureFile);
  event.target.value = '';
}

/* Remove a single staged file by index — used by the ✕ button in each
   dropzone's file list. */
function cqRemoveSelectedFile(idx) {
  cqSelectedFiles.splice(idx, 1);
  renderCustomQuizModal();
}
function cqRemoveLectureFile(idx) {
  cqLectureFiles.splice(idx, 1);
  renderCustomQuizModal();
}

function acceptLectureFile(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
  const statusEl = document.getElementById('cqStatus');

  if (!isPdf && !isImage && !isTxt) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Please upload a PDF, image (JPG/PNG/WEBP), or .txt file.</div>`;
    return;
  }
  if (file.size > GEMINI_MAX_FILE_BYTES) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> "${escapeHtml(file.name)}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API.</div>`;
    return;
  }
  cqLectureFiles.push(file);
  if (statusEl) statusEl.innerHTML = '';
  renderCustomQuizModal();
}

function acceptCQFile(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  const statusEl = document.getElementById('cqStatus');

  if (!isPdf && !isImage) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Please upload an image (JPG/PNG/WEBP) or a PDF file.</div>`;
    return;
  }
  if (file.size > GEMINI_MAX_FILE_BYTES) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> "${escapeHtml(file.name)}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API.</div>`;
    return;
  }

  cqSelectedFiles.push(file);
  if (statusEl) statusEl.innerHTML = '';
  renderCustomQuizModal();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsDataURL(file);
  });
}