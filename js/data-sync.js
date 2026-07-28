/* ══════════════════════════════════════════════════════════
   LOCAL CACHE — curriculum + published questions
   Version key: 'anu_msp_cache_ver' (curriculum + published)

   ONE tiny server doc, admin-only writes:
     appConfig/cacheVersion { v: <ms> }

   Any write that changes shared curriculum/published data calls
   bumpCacheVersion(). On the next page-load / panel-open every user
   fetches this tiny doc, compares it to their stored version, and
   re-downloads the full data only when the versions differ.

   Community quizzes are NOT covered by this global-version scheme —
   they use their own per-quiz granular manifest
   (appConfig/sharedQuizzesManifest, Worker-written only) instead; see
   ensureSharedQuizzesLoaded() in js/community-quizzes.js. The old
   global appConfig/sharedQuizzesVersion doc + bumpSharedQuizzesVersion()
   scheme this file used to also maintain was fully retired in build 65
   once the manifest system's rollout was confirmed complete — removed
   here, its Firestore rule, and the now-unused 'shared' IndexedDB blob
   key it wrote to.

   Custom quizzes (private, per-user) use a separate per-user version
   doc: users/{uid}/meta/cacheVersion  { v: <ms> } — see the
   "PER-USER CACHE" section further down.

   STORAGE BACKEND: IndexedDB, not localStorage.
   The actual payload (published questions + their images, community
   quizzes + their images) can easily run past localStorage's ~5-10MB
   per-origin quota. When that happened, localStorage.setItem() threw
   a QuotaExceededError that was being silently swallowed — so the
   cache write always failed and every single page load did a full
   Firestore re-fetch, even though the version-check logic looked
   correct. IndexedDB has a far larger quota (typically hundreds of MB
   or more) and comfortably holds this data.

   Each piece is also stored under its OWN key ('curriculum' and one
   'published:<subjectName>' key per subject) and written the moment
   it's fetched, rather than being accumulated in memory and only
   saved once the entire dataset has finished loading. That way a
   subject that finished loading is durably cached even if the user
   navigates away or refreshes before every other subject is done —
   no "must complete a full load before anything is stored" problem.
══════════════════════════════════════════════════════════ */

const CACHE_VER_KEY = 'anu_msp_cache_ver';


const _IDB_NAME  = 'anu_msp_cache_db';
const _IDB_STORE = 'kv';

// subjName -> { lectureId: lectureName }, valid only for the current page
// load. Lets loadPublishedQuestionsIntoSubjects() correctly clean up
// renamed/reordered entries if it's called more than once in one session
// (e.g. right after an admin backfill or a manual reorder), without waiting
// for the slower IndexedDB-persisted track to catch up.
const _sessionPublishedTrack = {};

let _idbPromise = null;
function _idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(_IDB_STORE)) {
        req.result.createObjectStore(_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _idbPromise;
}

async function _idbGet(key) {
  try {
    const db = await _idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readonly');
      const rq = tx.objectStore(_IDB_STORE).get(key);
      rq.onsuccess = () => resolve(rq.result === undefined ? null : rq.result);
      rq.onerror   = () => reject(rq.error);
    });
  } catch (e) { return null; }
}

async function _idbSet(key, value) {
  try {
    const db = await _idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    return true;
  } catch (e) { console.warn('[cache] IndexedDB write failed for', key, e); return false; }
}

async function _idbDelete(key) {
  try {
    const db = await _idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) {}
}

async function _idbKeys() {
  try {
    const db = await _idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readonly');
      const rq = tx.objectStore(_IDB_STORE).getAllKeys();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror   = () => reject(rq.error);
    });
  } catch (e) { return []; }
}

/* Back-compat shape: returns { curriculum?, published? } so existing
   callers that do `cached.published` / `cached.curriculum` keep working
   unchanged (aside from adding `await`). */
async function _readCache() {
  const curriculum = await _idbGet('curriculum');
  if (curriculum == null) return null;
  return { curriculum };
}

/* Writes the curriculum section of payload, if present. Published
   questions are handled separately, per subject — see
   _idbSet('published:<subject>', ...) below. */
async function _writeCache(payload) {
  if (payload && payload.curriculum !== undefined) await _idbSet('curriculum', payload.curriculum);
}

function _readCacheVer() {
  return localStorage.getItem(CACHE_VER_KEY) || null;
}

function _writeCacheVer(v) {
  try { localStorage.setItem(CACHE_VER_KEY, String(v)); } catch(e) {}
}

async function _clearCache() {
  // Only the curriculum cache is governed by a single global version
  // marker, so only it needs a full wipe here. Published quizzes are
  // cached (and invalidated) individually — see the manifest system
  // below — so clearing this doesn't touch/discard already-cached
  // quizzes. Community quizzes have their own per-quiz manifest cache
  // (js/community-quizzes.js) and aren't touched by this function either.
  try {
    await _idbDelete('curriculum');
    // Legacy key from the retired global shared-quiz version scheme
    // (build 65) — delete it opportunistically in case a returning
    // user's browser still has it, but it's no longer written by
    // anything, so this is just tidying up, not a functional dependency.
    await _idbDelete('shared');
  } catch (e) {}
  try {
    localStorage.removeItem(CACHE_VER_KEY);
    localStorage.removeItem('anu_msp_cache_shared_ver'); // legacy, retired in build 65
  } catch(e) {}
}

/* Call this after every ADMIN write that changes curriculum/published data. */
async function bumpCacheVersion() {
  if (!window._db) return null;
  try {
    const val = Date.now();
    await window._setDoc(window._doc(window._db, 'appConfig', 'cacheVersion'), { v: val });
    return String(val);
  } catch(e) {
    console.warn('bumpCacheVersion failed:', e);
    return null;
  }
}

/* Fetch the curriculum/published version (single tiny doc read) */
async function _fetchServerCacheVersion() {
  try {
    const snap = await window._getDoc(window._doc(window._db, 'appConfig', 'cacheVersion'));
    return snap.exists() && snap.data().v != null ? String(snap.data().v) : null;
  } catch(e) { return null; }
}

/* ══════════════════════════════════════════════════════════
   PUBLISHED-QUIZ MANIFEST — quiz-level cache granularity
   ------------------------------------------------------------
   One tiny doc, appConfig/publishedManifest, shaped like:
     { subjects: { [subjectName]: { [lectureId]: lastModifiedTs } } }
   It lists every published quiz's id and its own last-modified
   timestamp — no questions, no images, just numbers — so reading it
   is cheap. Comparing it against what's cached locally tells us
   EXACTLY which individual quizzes changed since last time, so
   editing one quiz only invalidates that one quiz's cache entry —
   not its whole subject, and not any other subject.
══════════════════════════════════════════════════════════ */
async function _fetchPublishedManifest() {
  try {
    const snap = await window._getDoc(window._doc(window._db, 'appConfig', 'publishedManifest'));
    return snap.exists() ? (snap.data().subjects || {}) : {};
  } catch (e) { return {}; }
}

/* Apply a cached payload directly into memory (no Firestore reads) */
function _applyCurriculumCache(cached) {
  const { extYears = [], extModules = {}, extModuleIcons = {}, extSubjects = {}, extYearIcons = {} } = cached.curriculum || {};

  extYears.forEach(yr => { if (!curriculum[yr]) curriculum[yr] = {}; });

  yearIconMap = extYearIcons;

  Object.entries(extModules).forEach(([yr, mods]) => {
    if (!curriculum[yr]) curriculum[yr] = {};
    (mods || []).forEach(mod => {
      if (!curriculum[yr][mod]) curriculum[yr][mod] = [];
    });
  });

  moduleIconMap = extModuleIcons;

  Object.entries(extSubjects).forEach(([key, info]) => {
    if (!subjects[key])
      subjects[key] = { icon: info.icon || '📘', label: info.label || key, lectures: {} };
    const { year, module: mod } = info;
    if (!year || !mod) return;
    if (!curriculum[year]) curriculum[year] = {};
    if (!curriculum[year][mod]) curriculum[year][mod] = [];
    if (!curriculum[year][mod].includes(key)) curriculum[year][mod].push(key);
  });

  buildYearGrid();
  _reRenderOpenSelections();
}

function _reRenderOpenSelections() {
  const _yr = selectedYear, _mod = selectedModule, _subj = selectedSubject, _lecs = selectedLectures;
  if (_yr)   { selectYear(_yr);    selectedLectures = _lecs; }
  if (_mod)  { selectModule(_mod); selectedLectures = _lecs; }
  if (_subj) { selectSubject(_subj); }
}

/* ══════════════════════════════════════════════════════════
   Load all previously-published questions into `subjects`
   so they appear as extra lectures for every user.
══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════
   ONE-TIME MIGRATION — pick up lectures published BEFORE the
   manifest system existed.
   ------------------------------------------------------------
   loadPublishedQuestionsIntoSubjects() only ever fetches lecture
   IDs listed in appConfig/publishedManifest. That manifest is only
   written by publish/edit/delete/move actions (originally via a
   client-side _updatePublishedManifest() call, now via the Worker's
   server-side bumpManifestVersion() since the R2 migration — see
   build #80's README entry for the last leftover client-side call
   being retired), so any lecture that was published before that code
   existed never got an entry — it's still sitting in Firestore, but
   the loader never asks for it and it silently never appears.

   This scans each known subject's `lectures` subcollection once,
   finds any doc IDs missing from the manifest, and adds them so the
   normal fast path picks them up from then on. Gated behind
   appConfig/manifestBackfillDone so the (relatively expensive) full
   subcollection scan only ever runs once, by whichever client hits
   it first — after that the manifest is complete for everyone.

   IMPORTANT: writes to appConfig/* are admin-only per the Firestore
   rules (same as appConfig/cacheVersion). Only call this once an
   admin user is confirmed signed in — see the isAdminUser(user)
   check in onAuthStateChanged below. Calling it for a non-admin or
   signed-out visitor will just fail with permission-denied on the
   setDoc calls (harmless, but pointless — it can never complete).
══════════════════════════════════════════════════════════ */
/* NOTE: this one-time migration is now OBSOLETE as of the R2 migration —
   publishedQuestions/{subject}/lectures no longer holds live content, so
   this will simply find nothing and no-op harmlessly (its own
   manifestBackfillDone flag also means it already ran and returns
   immediately on any deployment where it previously completed). Left
   in place rather than removed, since it's inert either way and safe. */
async function _backfillManifestIfNeeded() {
  try {
    const doneRef  = window._doc(window._db, 'appConfig', 'manifestBackfillDone');
    const doneSnap = await window._getDoc(doneRef);
    if (doneSnap.exists() && doneSnap.data().done) return;

    const manifestRef  = window._doc(window._db, 'appConfig', 'publishedManifest');
    const manifestSnap = await window._getDoc(manifestRef);
    const manifestData = manifestSnap.exists() ? (manifestSnap.data() || {}) : {};
    if (!manifestData.subjects) manifestData.subjects = {};

    let changed = false;
    await Promise.all(Object.keys(subjects).map(async (subjName) => {
      try {
        const col   = window._collection(window._db, 'publishedQuestions', subjName, 'lectures');
        const snaps = await window._getDocs(col);
        const known = new Set(Object.keys(manifestData.subjects[subjName] || {}));
        snaps.forEach(docSnap => {
          if (!known.has(docSnap.id)) {
            const d  = docSnap.data() || {};
            const ts = d.updatedAt || d.publishedAt || Date.now();
            if (!manifestData.subjects[subjName]) manifestData.subjects[subjName] = {};
            manifestData.subjects[subjName][docSnap.id] = ts;
            changed = true;
          }
        });
      } catch (e) {
        console.warn('Manifest backfill scan failed for subject', subjName, e);
      }
    }));

    if (changed) await window._setDoc(manifestRef, manifestData);
    await window._setDoc(doneRef, { done: true });
  } catch (e) {
    console.warn('Manifest backfill failed:', e);
  }
}

/* ══════════════════════════════════════════════════════════
   ONE-TIME MIGRATION — give legacy lectures a stable 'order'
   ------------------------------------------------------------
   Lectures published before the reorder feature existed have no
   'order' field, so admin's Up/Down controls (and the sort in
   loadPublishedQuestionsIntoSubjects) have nothing to sort them by.
   This scans every subject's lectures once, assigns order = their
   original publishedAt/updatedAt timestamp to anything missing it
   (so they land in their existing chronological position rather
   than jumping around), and bumps each fixed lecture's manifest
   timestamp so every user's cache picks up the change.

   Separate from _backfillManifestIfNeeded / manifestBackfillDone
   on purpose — that migration may already have completed on a given
   deployment before this feature existed, so this uses its own
   'orderBackfillDone' flag to guarantee it still runs once.

   Admin-only, same reasoning as _backfillManifestIfNeeded: writes to
   appConfig/* and to lecture docs are gated by Firestore rules, so
   only call this once an admin user is confirmed signed in.
══════════════════════════════════════════════════════════ */
/* NOTE: also OBSOLETE post-R2-migration, same reasoning as
   _backfillManifestIfNeeded above — safe, inert no-op. */
async function _backfillLectureOrderIfNeeded() {
  try {
    const doneRef  = window._doc(window._db, 'appConfig', 'orderBackfillDone');
    const doneSnap = await window._getDoc(doneRef);
    if (doneSnap.exists() && doneSnap.data().done) return;

    const manifestRef  = window._doc(window._db, 'appConfig', 'publishedManifest');
    const manifestSnap = await window._getDoc(manifestRef);
    const manifestData = manifestSnap.exists() ? (manifestSnap.data() || {}) : {};
    if (!manifestData.subjects) manifestData.subjects = {};

    let changed = false;
    await Promise.all(Object.keys(subjects).map(async (subjName) => {
      try {
        const col   = window._collection(window._db, 'publishedQuestions', subjName, 'lectures');
        const snaps = await window._getDocs(col);
        const fixes = [];
        snaps.forEach(docSnap => {
          const d = docSnap.data() || {};
          if (d.order == null) {
            fixes.push({ id: docSnap.id, order: d.publishedAt || d.updatedAt || Date.now() });
          }
        });
        if (!fixes.length) return;

        // Metadata-only merge — doesn't touch questions/images.
        await Promise.all(fixes.map(fix =>
          window._setDoc(
            window._doc(window._db, 'publishedQuestions', subjName, 'lectures', fix.id),
            { order: fix.order },
            { merge: true }
          )
        ));

        if (!manifestData.subjects[subjName]) manifestData.subjects[subjName] = {};
        fixes.forEach(fix => { manifestData.subjects[subjName][fix.id] = Date.now(); });
        changed = true;
      } catch (e) {
        console.warn('Order backfill scan failed for subject', subjName, e);
      }
    }));

    if (changed) await window._setDoc(manifestRef, manifestData);
    await window._setDoc(doneRef, { done: true });
  } catch (e) {
    console.warn('Order backfill failed:', e);
  }
}

/* Same 60-second-class idea as ensureSharedQuizzesLoaded() in
   js/community-quizzes.js, applied to curriculum lectures: a plain
   in-memory cache already makes re-opening the curriculum browser cost
   nothing extra within one page load (this function only runs once at
   startup — see js/firebase-init.js — plus explicitly after an admin
   write). What it can't cover is a page REFRESH happening again shortly
   after the last real check. 5 minutes (matching content-client.js's own
   `THROTTLE_MS.curriculum`) is long enough to absorb that without students
   ever seeing meaningfully stale content — any admin write that needs to
   be reflected immediately calls this with skipThrottle = true. */
const PUBLISHED_MANIFEST_THROTTLE_MS = 5 * 60 * 1000;
const PUBLISHED_MANIFEST_THROTTLE_KEY = 'lastVersionCheck:curriculum';

/* Rebuilds every subject's `lectures` map straight from IndexedDB, with NO
   network calls at all. Returns true only if EVERY previously-tracked
   published lecture could be fully reconstructed from cache; the moment
   any single one is missing (e.g. storage was cleared) it returns false
   and applies nothing, so the caller falls back to a real manifest check
   rather than ever showing a partial/incomplete curriculum. */
async function _rebuildPublishedFromCacheOnly() {
  const perSubject = {};
  for (const subjName of Object.keys(subjects)) {
    const trackKey  = 'publishedTrack:' + subjName;
    const prevTrack = _sessionPublishedTrack[subjName] || (await _idbGet(trackKey)) || {};
    const lecIds = Object.keys(prevTrack);
    const resolved = [];
    for (const lectureId of lecIds) {
      const cached = await _idbGet('published:' + subjName + ':' + lectureId);
      if (!cached) return false; // incomplete — abort the whole rebuild, change nothing
      resolved.push({ name: cached.lectureName, questions: cached.questions, order: cached.order });
    }
    perSubject[subjName] = { prevTrack, resolved };
  }

  Object.entries(perSubject).forEach(([subjName, { prevTrack, resolved }]) => {
    if (!subjects[subjName].lectures) subjects[subjName].lectures = {};
    Object.values(prevTrack).forEach(name => { delete subjects[subjName].lectures[name]; });
    resolved.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    resolved.forEach(r => { subjects[subjName].lectures[r.name] = r.questions; });
    _sessionPublishedTrack[subjName] = prevTrack;
  });
  return true;
}

/** @param {boolean} [skipThrottle] - force a real manifest check regardless of the time-throttle (used right after an admin write) */
async function loadPublishedQuestionsIntoSubjects(skipThrottle) {
  if (!window._db) return;
  try {
    const withinThrottle = !skipThrottle &&
      (Date.now() - parseInt(localStorage.getItem(PUBLISHED_MANIFEST_THROTTLE_KEY) || '0', 10)) < PUBLISHED_MANIFEST_THROTTLE_MS;

    if (withinThrottle && await _rebuildPublishedFromCacheOnly()) {
      _reRenderOpenSelections();
      _fsReady.published = true;
      console.log('[cache] curriculum lectures: recent check (<5min ago) trusted, rebuilt from IndexedDB — 0 network calls');
      return;
    }

    /* ── 1. One tiny read tells us every published quiz's id + its own
            last-modified timestamp, per subject. No questions, no images. ── */
    const manifest = await _fetchPublishedManifest();
    localStorage.setItem(PUBLISHED_MANIFEST_THROTTLE_KEY, String(Date.now()));

    /* ── 2. Handle every subject in parallel, and within each subject
            every quiz in parallel. Each quiz is checked/fetched/cached
            completely independently:
              • unchanged quiz  → read straight from IndexedDB, 0 reads
              • new/changed one → fetch just that one doc, cache it the
                                    moment it lands (not after the whole
                                    subject or app finishes loading)
              • removed one     → dropped from memory + local cache
            Fetches run in parallel so they can land in any order — the
            actual student-facing sequence is decided afterward from each
            quiz's admin-controlled 'order' field, not fetch timing. ── */
    await Promise.all(Object.keys(subjects).map(async (subjName) => {
      const lecVersions = manifest[subjName] || {};
      const lecIds = Object.keys(lecVersions);

      // What we knew was live for this subject last time (id → name), so we
      // can tell a since-removed/renamed quiz apart from a subject's own
      // hardcoded, non-published lecture content. Prefer the in-memory
      // session track (set the last time this function ran during THIS
      // page load, e.g. after an admin migration) over the IndexedDB one,
      // so repeated in-session calls clean up renames/reorders correctly.
      const trackKey  = 'publishedTrack:' + subjName;
      const prevTrack = _sessionPublishedTrack[subjName] || (await _idbGet(trackKey)) || {};

      if (!subjects[subjName].lectures) subjects[subjName].lectures = {};
      const newTrack = {};
      const resolved = []; // { name, questions, order } for every lecture we have this pass

      await Promise.all(lecIds.map(async (lectureId) => {
        const ver = lecVersions[lectureId];
        const idbKey  = 'published:' + subjName + ':' + lectureId;
        const cached  = await _idbGet(idbKey);

        if (cached && cached.ver === ver) {
          // Cache hit for this exact quiz — zero Firestore reads.
          resolved.push({ name: cached.lectureName, questions: cached.questions, order: cached.order });
          newTrack[lectureId] = cached.lectureName;
          return;
        }

        // New or changed quiz — fetch just this one item from R2 via the Worker.
        try {
          const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${subjName}/${lectureId}.json`);
          if (!resp.ok) { if (resp.status === 404) return; throw new Error(`Fetch failed: ${resp.status}`); }
          const data = await resp.json();
          const name = data.lectureName || lectureId;
          const questions = data.questions || [];
          const order = data.order != null ? data.order : (data.publishedAt || 0);
          // Images are already resolved, permanent R2 URLs in the fetched
          // JSON — no separate hydrate step needed (see js/user-profile.js).

          resolved.push({ name, questions, order });
          newTrack[lectureId] = name;
          // Persist THIS quiz immediately — it's durably cached even if
          // other quizzes are still loading or the page closes right now.
          await _idbSet(idbKey, { ver, lectureName: name, questions, order });
        } catch (e) {
          // Leave uncached — retried next load. Preserve any previous
          // tracking so we don't wrongly treat it as "removed" below.
          if (prevTrack[lectureId]) newTrack[lectureId] = prevTrack[lectureId];
        }
      }));

      // Anything tracked last time but absent from this subject's manifest
      // now was deleted or moved elsewhere — remove it (and only it).
      const removedIds = Object.keys(prevTrack).filter(id => !(id in newTrack));
      await Promise.all(removedIds.map(async (id) => {
        await _idbDelete('published:' + subjName + ':' + id);
      }));

      // Rebuild this subject's published-lecture entries from a clean slate:
      // first drop every name we previously knew about (covers renames too),
      // then re-insert in admin-controlled order. Hardcoded, non-published
      // lectures were already present as object keys before this function
      // ever ran, so they keep their original position ahead of these.
      Object.values(prevTrack).forEach(name => { delete subjects[subjName].lectures[name]; });
      resolved.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      resolved.forEach(r => { subjects[subjName].lectures[r.name] = r.questions; });

      _sessionPublishedTrack[subjName] = newTrack;
      await _idbSet(trackKey, newTrack);
    }));

    // Re-render whatever the user already has open so new content appears immediately
    _reRenderOpenSelections();

  } catch (e) {
    console.warn('Failed to load published questions:', e);
  } finally {
    _fsReady.published = true;
  }
}

/* =============================================================================
   Expose IndexedDB helpers globally.
   data-sync.js is loaded as a classic (non-module) script, so its top-level
   functions are local to this file only. Several other scripts
   (local-store.js, community-quizzes.js, content-client.js) rely on these
   being available as window._idbGet / window._idbSet / window._idbDelete /
   window._idbList.

   Two call-shapes exist across the codebase:
     - content-client.js / community-quizzes.js: window._idbGet(key) returns
       the raw stored value directly (or null), matching this file's native
       _idbGet/_idbSet/_idbDelete behavior exactly — passed through as-is.
     - local-store.js: expects window._idbGet(key) to resolve to { value }
       (or null), and window._idbList(prefix) to resolve to
       { keys: [...] } filtered by key prefix.

   Since the raw shape is already relied on by more callers, window._idbGet/
   _idbSet/_idbDelete stay pass-through (unwrapped). window._idbList is added
   as a new prefix-filtering helper. local-store.js is patched separately to
   unwrap { value } itself via a small local wrapper — see local-store.js.
   ============================================================================= */
window._idbGet    = _idbGet;
window._idbSet    = _idbSet;
window._idbDelete = _idbDelete;
window._idbKeys   = _idbKeys;

/** Lists all stored keys starting with `prefix`, returned as { keys: [...] }. */
window._idbList = async function _idbList(prefix = '') {
  const allKeys = await _idbKeys();
  const keys = prefix ? allKeys.filter(k => k.startsWith(prefix)) : allKeys;
  return { keys };
};

