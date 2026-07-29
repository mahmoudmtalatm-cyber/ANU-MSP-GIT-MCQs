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
        const imgIdx       = parts[1];
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
        const resp = await fetch(q.imageUrl);
        const blob = await resp.blob();
        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => { q.image = reader.result; resolve(); };
          reader.onerror = resolve;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('Legacy Storage image fetch failed', q.imageUrl, e);
      }
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
      const imgIdx     = parts[1];
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
    const ref  = window._doc(
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
        const parts  = q.imageUrl.replace('firestore-full://', '').split('/');
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
     • new entry       → fetch just that one document
     • removed entry   → dropped from memory + local cache
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
    const ts     = manifest[historyId];
    const idbKey = _historyIdbKey(uid, historyId);
    const cached = await _idbGet(idbKey);

    if (cached && cached.ts === ts) {
      entries.push(cached); // cache hit — zero Firestore reads for this entry
      return;
    }

    try {
      const ref  = window._doc(window._db, 'users', uid, 'statsHistory', historyId);
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
    const prefix   = 'history:' + uid + ':';
    const knownIds = new Set(ids);
    const allKeys  = await _idbKeys();
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

     Server doc : users/{uid}/meta/cacheVersion  { ..., stats: <ms> }
                  (same doc custom quizzes already use, just a
                  different field, so login still costs one small
                  read for both instead of two)
     Local keys : anu_msp_stats_cache_<uid>
                  anu_msp_stats_cache_ver_<uid>

   persistStats() (js/app-core.js) writes through the local cache and
   bumps the version on every save, so the very next load — this
   device or a fresh session — is already warm.
══════════════════════════════════════════════════════════ */
function _statsCacheKey(uid)    { return 'anu_msp_stats_cache_' + uid; }
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
    const localVer  = _readCqCacheVer(uid);
    const cached    = _readCqCache(uid);

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

async function saveCustomQuizzesList(arr) {
  // Custom quizzes now live entirely in local storage (see js/local-store.js)
  // — no Firestore round-trip, no Storage image upload, no version bump.
  window._cachedCustomQuizzes = arr;
  const { saveCustomQuiz, deleteCustomQuiz: deleteLocal, listCustomQuizzes } =
    await import('./local-store.js');

  const existing = await listCustomQuizzes();
  const newIds = new Set(arr.map(q => q.id));
  for (const quiz of existing) {
    if (!newIds.has(quiz.id)) await deleteLocal(quiz.id);
  }
  for (const quiz of arr) {
    await saveCustomQuiz(quiz);
  }
}
function openCustomQuizzes() {
  fsAwaitIfNeeded('customQuizzes', 'Loading your quizzes…');
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
  const keys  = loadApiKeys();
  if (!entry) {
    return `<div class="apikey-empty" style="padding:14px;">
      <span class="ns-icon">🔑</span>No API key configured yet.
      <div style="margin-top:8px;"><button class="apikey-open-btn ghost" onclick="openApiKeyManager(() => renderCustomQuizModal())">🔑 Add an API Key</button></div>
    </div>`;
  }
  const idx = Math.max(0, keys.findIndex(k => k.id === entry.id));
  const allRL = (typeof allKeysRateLimited === 'function') && allKeysRateLimited();
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <div class="apikey-badge">
      <span class="apikey-dot" style="background:${entry.color || 'var(--accent)'};"></span>
      Using API ${idx + 1}: ${escapeHtml(entry.label)}
      ${allRL ? `<span class="apikey-status-chip apikey-status-limited" style="margin-left:4px;" title="Rotating automatically until a key frees up">⏳ All rate-limited</span>` : ''}
    </div>
    <button class="apikey-open-btn ghost" onclick="openApiKeyManager(() => renderCustomQuizModal())">🔑 Manage API Keys</button>
  </div>`;
}

function renderCustomQuizModal() {
  const body       = document.getElementById('customQuizBody');
  const quizzes    = loadCustomQuizzes();
  const collections = loadQuizCollections();

  let html = '';

  /* ── Saved custom quizzes ── */
  html += `<div class="cq-section">
    <div class="cq-section-title">📚 Your Custom Quizzes</div>

    <!-- API Key -->
    <div class="cq-api-badge-slot">${renderCqApiKeyBadge()}</div>
    `;
  if (!quizzes.length) {
    html += `<div class="empty-state" style="padding:12px;">
      <div class="empty-icon">📭</div>
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
          <div class="cq-quiz-name">🧩 ${cqMultiSelected.size} quiz${cqMultiSelected.size !== 1 ? 'zes' : ''} selected — ${totalQs} question${totalQs !== 1 ? 's' : ''} total</div>
          <div class="cq-quiz-meta">Start them together in one sitting, in the order checked below.</div>
        </div>
        <div class="cq-quiz-actions">
          <input type="number" id="cqMultiMins" value="${defMins}" min="1" max="480" title="Duration (minutes)" />
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;font-weight:700;color:var(--text-muted);cursor:pointer;" title="Shuffle questions">
            <input type="checkbox" id="cqMultiShuffle" style="width:14px;height:14px;accent-color:var(--accent);" /> 🔀
          </label>
          <div class="cq-move-wrap">
            <button class="cq-btn cq-btn-secondary" id="cqBulkMoveBtn" style="background:var(--violet-strong);" onclick="event.stopPropagation(); cqToggleBulkMoveMenu()">📁 Move to…</button>
            ${cqBulkMoveMenuOpen ? _renderBulkMoveMenuHTML() : ''}
          </div>
          <button class="cq-btn" onclick="startCustomQuizzesMulti()">&#9654; Start Selected</button>
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
        <div class="empty-icon">📁</div>
        No quizzes in this folder yet — drag a quiz here, or use its 📁 Move button.
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
            <div class="cq-quiz-meta">${q.questions.length} question${q.questions.length !== 1 ? 's' : ''} &middot; created ${new Date(q.createdAt).toLocaleDateString()}${q.sharedAt ? ' &middot; <span class="share-chip">&#127758; Shared</span>' : ''}</div>
            ${_quizCollectionChipHTML(q, collections) ? `<div style="margin-top:5px;">${_quizCollectionChipHTML(q, collections)}</div>` : ''}
          </div>
        </div>
        <div class="cq-quiz-actions">
          <input type="number" id="cqMins_${q.id}" value="${defMins}" min="1" max="180" title="Duration (minutes)" />
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;font-weight:700;color:var(--text-muted);cursor:pointer;" title="Shuffle questions">
            <input type="checkbox" id="cqShuffle_${q.id}" style="width:14px;height:14px;accent-color:var(--accent);" /> 🔀
          </label>
          <button class="cq-btn" onclick="startCustomQuiz('${q.id}')">&#9654; Start</button>
          <div class="cq-move-wrap">
            <button class="cq-btn cq-btn-secondary" data-move-btn="${q.id}" style="background:var(--violet-strong);" onclick="event.stopPropagation(); cqToggleQuizMoveMenu('${q.id}')" title="Move to a folder">📁 Move</button>
            ${moveOpen ? _renderQuizMoveMenuHTML(q) : ''}
          </div>
          <button class="cq-btn cq-btn-secondary" onclick="renameCustomQuiz('${q.id}')" style="background:var(--unanswered-bg);color:var(--unanswered-fg);border:1.5px solid var(--amber-strong);" title="Rename this quiz">&#127991;&#65039; Rename</button>
          <button class="cq-btn cq-btn-secondary" onclick="${isEditing ? 'closeCustomQuizEditor()' : `openCustomQuizEditor('${q.id}')`}" style="background:var(--accent);color:#fff;">${isEditing ? '✖ Close Editor' : '✏️ Edit'}</button>
          <button class="cq-share-btn" onclick="shareCustomQuiz('${q.id}')" title="Share with community">&#128279; Share</button>
          <button class="cq-btn cq-btn-danger" onclick="deleteCustomQuiz('${q.id}')">&#128465;</button>
        </div>
        ${isEditing ? `<div class="cq-inline-editor" id="cqCustomEditorArea_${q.id}" style="margin-top:10px;"></div>` : ''}
      </div>`;
    });

    html += `</div></div></div>`; // .cq-coll-quiz-list, .cq-coll-main, .cq-coll-layout
  }
  html += `</div>`;

  /* ── Write your own quiz by hand (no AI) ── */
  html += `<div class="cq-section">
    <div class="cq-section-title">✍️ Create Your Own Quiz</div>

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
    <div class="cq-section-title">✨ Create a New Quiz with AI (Gemini)</div>

    <!-- API Key -->
    <div class="cq-api-badge-slot">${renderCqApiKeyBadge()}</div>

    <!-- Mode tabs -->
    <div class="cq-tabs">
      <button class="cq-tab-btn ${cqMode === 'extract' ? 'active' : ''}" onclick="setCQMode('extract')">📋 Extract from MCQs</button>
      <button class="cq-tab-btn ${cqMode === 'generate' ? 'active' : ''}" onclick="setCQMode('generate')">🧠 Generate from Lecture</button>
    </div>

    <!-- TAB: Extract from MCQs (original flow) -->
    <div id="cqTabExtract" ${cqMode !== 'extract' ? 'style="display:none"' : ''}>
      <div class="cq-field-hint">Upload one or more images or PDFs that already contain MCQ questions — the AI will extract them exactly as written. Add multiple files if your quiz is split across several pages or documents.</div>
      <div class="cq-dropzone" id="cqDropzone" onclick="document.getElementById('cqFileInput').click()">
        <div class="cq-dz-icon">📄🖼️</div>
        <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more images or PDFs of your quiz questions</div>
        ${cqSelectedFiles.length ? _cqFileListHTML(cqSelectedFiles, 'cqRemoveSelectedFile') : ''}
        ${cqSelectedFiles.length ? `<div class="cq-dz-add-more">➕ Click again to add more files</div>` : ''}
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
              🤖 AI Answering
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
              <div style="font-size:.78rem;font-weight:700;color:var(--violet-dark);">🤖 Only answer questions missing a key</div>
              <div style="font-size:.71rem;color:var(--text-muted);margin-top:1px;">Fills in an answer only for questions that have no answer key in the source document</div>
            </div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
            <input type="radio" name="cqAiAnswerSubmodeRadio" value="all" ${cqAiAnswerSubmode === 'all' ? 'checked' : ''}
              onchange="cqAiAnswerSubmode = 'all'; renderCustomQuizModal()"
              style="margin-top:3px;width:16px;height:16px;accent-color:var(--violet-strong);flex-shrink:0;" />
            <div>
              <div style="font-size:.78rem;font-weight:700;color:var(--violet-dark);">✅ Solve / verify all questions</div>
              <div style="font-size:.71rem;color:var(--text-muted);margin-top:1px;">Re-solves every question, including ones that already have an answer key in the source</div>
            </div>
          </label>
        </div>
        ` : ''}
      </div>

      <!-- Reference Source — directly below the AI Answering menu (both
           submenu options rely on it), so there's no confusion about
           which control it belongs to. -->
      ${cqAiAnsweringEnabled ? `
      <div style="margin:8px 0 4px;padding:12px 14px;background:var(--violet-pale);border:1.5px solid var(--violet-border);border-radius:10px;">
        <div style="font-size:.75rem;font-weight:700;color:var(--violet-dark);margin-bottom:5px;">
          📚 Reference Source (optional) — upload images/PDFs the AI should use to answer
        </div>
        <div class="cq-dropzone cq-dz-purple" id="cqSourceDropzone" onclick="document.getElementById('cqSourceFileInput').click()">
          <div class="cq-dz-icon">🖼️📄</div>
          <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
          ${cqAiSourceFiles.length ? _cqFileListHTML(cqAiSourceFiles, 'cqRemoveSourceFile', sf => sf.file) : ''}
          ${cqAiSourceFiles.length ? `<div class="cq-dz-add-more">➕ Click again to add more files</div>` : ''}
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
              🧩 Fill Choices (AI)
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
              🪄 Refine Questions (AI)
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
            ⚙️ Custom Instructions (optional) — applied to every question's refine
          </div>
          <textarea class="cq-textarea" id="cqRefineCustomInput" rows="2"
            placeholder="Optional — anything extra you want applied to every question (e.g. &quot;keep each question to one sentence&quot;). Only overrides the default refine behavior where it truly conflicts — grammar and exam phrasing still apply otherwise."
            oninput="cqRefineCustomInstructions = this.value"
            style="border-color:var(--violet-border);">${escapeHtml(cqRefineCustomInstructions)}</textarea>
        </div>
        ` : ''}
      </div>

      <!-- Sequential-run notice — shown whenever 2+ AI steps are selected,
           since they all write to the same question objects and could
           otherwise conflict if fired at once. -->
      ${(() => {
        const steps = [
          cqAiAnsweringEnabled ? 'Solve/Answer' : null,
          cqFillChoicesToggle ? 'Fill Choices' : null,
          cqRefineToggle ? 'Refine Questions' : null
        ].filter(Boolean);
        if (steps.length < 2) return '';
        const stepsText = steps.map((s, idx) => `${idx + 1}) ${s}`).join('  →  ');
        return `
      <div style="margin:8px 0 4px;padding:10px 14px;background:#FFFDE7;border:1.5px solid #FBC02D;border-radius:10px;font-size:.75rem;color:#7A5C00;">
        ⚙️ <strong>Multiple AI steps selected</strong> — to avoid conflicting edits on the same question, they'll run one at a time (not simultaneously), in this order:<br>
        ${stepsText}.
      </div>`;
      })()}


      <div class="cq-input-row">
        <input type="text" id="cqTitleInput" placeholder="Quiz title (e.g. 'Cardio Lecture 3')"
               value="${escapeHtml(cqGeneratedTitle)}" oninput="cqGeneratedTitle = this.value" />
        <button class="cq-btn" id="cqGenerateBtn" onclick="generateQuizFromAI()" ${cqBusy ? 'disabled' : ''}>
          ${cqBusy ? '⏳ Generating…' : '✨ Extract Questions'}
        </button>
      </div>
    </div>

    <!-- TAB: Generate from Lecture -->
    <div id="cqTabGenerate" ${cqMode !== 'generate' ? 'style="display:none"' : ''}>
      <div class="cq-badge-row">
        <span class="cq-badge">🏥 Clinical scenarios included</span>
        <span class="cq-badge">🎯 Hard difficulty</span>
        <span class="cq-badge">🤖 AI-written questions</span>
      </div>
      <div class="cq-field-hint">Upload your lecture material (PDF, image, or .txt file) — the AI will generate brand-new original questions from the content. Add multiple files to combine several sources into one quiz.</div>
      <div class="cq-dropzone" id="cqLectureDropzone" onclick="document.getElementById('cqLectureFileInput').click()">
        <div class="cq-dz-icon">📚🔬</div>
        <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more PDF, image, or .txt lecture files</div>
        ${cqLectureFiles.length ? _cqFileListHTML(cqLectureFiles, 'cqRemoveLectureFile') : ''}
        ${cqLectureFiles.length ? `<div class="cq-dz-add-more">➕ Click again to add more files</div>` : ''}
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
          ${cqBusy ? '⏳ Generating…' : '🧠 Generate Questions'}
        </button>
      </div>
    </div>

<!-- Pause/resume/stop and status reflect the LIVE generation state
         (cqBusy/cqIsPaused/cqPauseRequested/cqStopRequested), and the
         status box is pre-filled from the cached status HTML — this is
         what makes returning to this modal mid-run (e.g. after switching
         API keys via 🔑 Manage APIs, which re-renders this modal while
         a background extraction/generation is still going) show the run
         exactly as it was, instead of a frozen, blank-looking modal. See
         js/dom-utils.js for the cache these values come from. -->
    ${(() => {
      const showRow      = cqBusy;
      const pausingNow    = cqBusy && cqPauseRequested && !cqIsPaused;
      const showPauseBtn  = cqBusy && !cqIsPaused;
      const showResumeBtn = cqBusy && cqIsPaused;
      const stoppingNow   = cqBusy && cqStopRequested;
      const cachedStatus  = cqBusy ? getCachedStatusHTML('cqStatus') : '';
      return `
    <div id="cqPauseRow" style="display:${showRow ? 'flex' : 'none'};gap:8px;margin:8px 0;align-items:center;flex-wrap:wrap;">
      <button class="cq-btn" id="cqPauseBtn" type="button" onclick="cqRequestPause()" ${pausingNow ? 'disabled' : ''}
        style="display:${showPauseBtn ? 'inline-flex' : 'none'};background:var(--unanswered-bg);color:var(--unanswered-fg);border:1.5px solid var(--amber-strong);">${pausingNow ? '⏳ Pausing…' : '⏸️ Pause'}</button>
      <button class="cq-btn" id="cqResumeBtn" type="button" onclick="cqResumeGeneration()"
        style="display:${showResumeBtn ? 'inline-flex' : 'none'};background:var(--correct-bg);color:var(--correct-fg);border:1.5px solid #66BB6A;">▶️ Resume</button>
      <button class="ai-tool-stop-btn" id="cqStopBtn" type="button" onclick="cqRequestStop()" ${stoppingNow ? 'disabled' : ''}
        style="display:${showRow ? 'inline-block' : 'none'};padding:7px 12px;font-size:.82rem;" title="Stop extraction/generation immediately">${stoppingNow ? '⏳ Stopping…' : '⏹ Stop'}</button>
    </div>
    <div id="cqStatus">${cachedStatus}</div>`;
    })()}
    <div id="cqPreviewArea"></div>
  </div>`;

  body.innerHTML = html;

  if (cqGeneratedQuestions) renderCQPreview();
  if ((cqEditingQuizId || cqCreatingNew) && cqEditQuestions) renderCustomQuizEditor();
  setupCQDropzone();
  setupLectureDropzone();
  setupSourceDropzone();
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
  const isPdf   = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  const isTxt   = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
  const statusEl = document.getElementById('cqStatus');

  if (!isPdf && !isImage && !isTxt) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">⚠️ Please upload a PDF, image (JPG/PNG/WEBP), or .txt file.</div>`;
    return;
  }
  if (file.size > GEMINI_MAX_FILE_BYTES) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">⚠️ "${escapeHtml(file.name)}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API.</div>`;
    return;
  }
  cqLectureFiles.push(file);
  if (statusEl) statusEl.innerHTML = '';
  renderCustomQuizModal();
}

function acceptCQFile(file) {
  const isPdf   = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  const statusEl = document.getElementById('cqStatus');

  if (!isPdf && !isImage) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">⚠️ Please upload an image (JPG/PNG/WEBP) or a PDF file.</div>`;
    return;
  }
  if (file.size > GEMINI_MAX_FILE_BYTES) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">⚠️ "${escapeHtml(file.name)}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API.</div>`;
    return;
  }

  cqSelectedFiles.push(file);
  if (statusEl) statusEl.innerHTML = '';
  renderCustomQuizModal();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsDataURL(file);
  });
}

