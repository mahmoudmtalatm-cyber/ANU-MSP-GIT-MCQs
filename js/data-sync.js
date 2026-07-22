/* ══════════════════════════════════════════════════════════
   LOCAL CACHE — curriculum + published questions + community quizzes
   Version key: 'anu_msp_cache_ver'        (curriculum + published)
                'anu_msp_cache_shared_ver' (community quizzes)

   TWO separate tiny server docs (kept separate on purpose so the
   Firestore rules stay simple — see note below):
     appConfig/cacheVersion         { v: <ms> }  — admin-only writes
     appConfig/sharedQuizzesVersion { v: <ms> }  — any signed-in user
                                                    can write (publishing
                                                    or deleting their own
                                                    community quiz bumps
                                                    this one)

   Any write that changes shared data calls bumpCacheVersion() (admin
   curriculum/published writes) or bumpSharedQuizzesVersion() (any
   user sharing/deleting a community quiz). On the next page-load /
   panel-open every user fetches only the relevant tiny doc, compares
   it to their stored version, and re-downloads the full data only
   when the versions differ.

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

   Each piece is also stored under its OWN key ('curriculum', 'shared',
   and one 'published:<subjectName>' key per subject) and written the
   moment it's fetched, rather than being accumulated in memory and
   only saved once the entire dataset has finished loading. That way
   a subject that finished loading is durably cached even if the user
   navigates away or refreshes before every other subject is done —
   no "must complete a full load before anything is stored" problem.
══════════════════════════════════════════════════════════ */

const CACHE_VER_KEY        = 'anu_msp_cache_ver';
const CACHE_SHARED_VER_KEY = 'anu_msp_cache_shared_ver';

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

/* Back-compat shape: returns { curriculum?, published?, shared? } so
   existing callers that do `cached.published` / `cached.curriculum` /
   `cached.shared` keep working unchanged (aside from adding `await`). */
async function _readCache() {
  const [curriculum, shared] = await Promise.all([
    _idbGet('curriculum'),
    _idbGet('shared')
  ]);
  if (curriculum == null && shared == null) return null;
  const out = {};
  if (curriculum != null) out.curriculum = curriculum;
  if (shared     != null) out.shared     = shared;
  return out;
}

/* Writes only the top-level sections present on payload (curriculum
   and/or shared). Published questions are handled separately, per
   subject — see _idbSet('published:<subject>', ...) below. */
async function _writeCache(payload) {
  const jobs = [];
  if (payload && payload.curriculum !== undefined) jobs.push(_idbSet('curriculum', payload.curriculum));
  if (payload && payload.shared     !== undefined) jobs.push(_idbSet('shared',     payload.shared));
  await Promise.all(jobs);
}

function _readCacheVer() {
  return localStorage.getItem(CACHE_VER_KEY) || null;
}

function _writeCacheVer(v) {
  try { localStorage.setItem(CACHE_VER_KEY, String(v)); } catch(e) {}
}

function _readSharedCacheVer() {
  return localStorage.getItem(CACHE_SHARED_VER_KEY) || null;
}

function _writeSharedCacheVer(v) {
  try { localStorage.setItem(CACHE_SHARED_VER_KEY, String(v)); } catch(e) {}
}

async function _clearCache() {
  // Only curriculum + community-quiz caches are governed by a single global
  // version marker, so only they need a full wipe here. Published quizzes
  // are cached (and invalidated) individually — see the manifest system
  // below — so clearing this doesn't touch/discard already-cached quizzes.
  try {
    await Promise.all([_idbDelete('curriculum'), _idbDelete('shared')]);
  } catch (e) {}
  try {
    localStorage.removeItem(CACHE_VER_KEY);
    localStorage.removeItem(CACHE_SHARED_VER_KEY);
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

/* Call this after any SIGNED-IN USER publishes or deletes a community quiz. */
async function bumpSharedQuizzesVersion() {
  if (!window._db) return null;
  try {
    const val = Date.now();
    await window._setDoc(window._doc(window._db, 'appConfig', 'sharedQuizzesVersion'), { v: val });
    return String(val);
  } catch(e) {
    console.warn('bumpSharedQuizzesVersion failed:', e);
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

/* Fetch the community-quizzes version (single tiny doc read) */
async function _fetchSharedServerVersion() {
  try {
    const snap = await window._getDoc(window._doc(window._db, 'appConfig', 'sharedQuizzesVersion'));
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

/* Call after publishing, editing, deleting, or moving a published lecture.
   Pass ts = null to remove the entry (lecture deleted or moved away). */
async function _updatePublishedManifest(subject, lectureId, ts) {
  if (!window._db) return;
  try {
    const ref  = window._doc(window._db, 'appConfig', 'publishedManifest');
    const snap = await window._getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    if (!data.subjects) data.subjects = {};
    if (!data.subjects[subject]) data.subjects[subject] = {};
    if (ts == null) {
      delete data.subjects[subject][lectureId];
      if (!Object.keys(data.subjects[subject]).length) delete data.subjects[subject];
    } else {
      data.subjects[subject][lectureId] = ts;
    }
    await window._setDoc(ref, data);
  } catch (e) {
    console.warn('Failed to update published manifest:', e);
  }
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
   written by _updatePublishedManifest() (publish/edit/delete/move),
   so any lecture that was published before that code existed never
   got an entry — it's still sitting in Firestore, but the loader
   never asks for it and it silently never appears.

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

async function loadPublishedQuestionsIntoSubjects() {
  if (!window._db) return;
  try {
    /* ── 1. One tiny read tells us every published quiz's id + its own
            last-modified timestamp, per subject. No questions, no images. ── */
    const manifest = await _fetchPublishedManifest();

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

        // New or changed quiz — fetch just this one document.
        try {
          const ref  = window._doc(window._db, 'publishedQuestions', subjName, 'lectures', lectureId);
          const snap = await window._getDoc(ref);
          if (!snap.exists()) return;
          const data = snap.data();
          const name = data.lectureName || lectureId;
          const questions = data.questions || [];
          const order = data.order != null ? data.order : (data.publishedAt || 0);
          // Hydrate images from the separate images subcollection (published lectures
          // store images there to stay under Firestore's 1 MB doc limit, and to keep
          // the snapshot independent of the original source quiz).
          await hydratePublishedLectureImages(subjName, lectureId, questions);

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

