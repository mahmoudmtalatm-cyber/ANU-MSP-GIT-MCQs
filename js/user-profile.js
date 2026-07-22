/* ══════════════════════════════════════════════════════════
   DISPLAY NAME — per-user, stored in Firestore
══════════════════════════════════════════════════════════ */
let _dnResolve = null; // resolve callback for the display name promise

async function getOrPromptDisplayName() {
  if (!window._currentUser) return null;
  // Check cache
  if (window._userDisplayName) return window._userDisplayName;
  // Check Firestore
  try {
    const ref  = window._doc(window._db, 'userProfiles', window._currentUser.uid);
    const snap = await window._getDoc(ref);
    if (snap.exists() && snap.data().displayName) {
      window._userDisplayName = snap.data().displayName;
      return window._userDisplayName;
    }
  } catch(e) {}
  // Prompt
  return new Promise(resolve => {
    _dnResolve = resolve;
    const overlay = document.getElementById('displayNameOverlay');
    const input   = document.getElementById('displayNameInput');
    if (input) { input.value = ''; updateDnCounter(); }
    overlay.classList.remove('hidden');
  });
}

function updateDnCounter() {
  const input = document.getElementById('displayNameInput');
  const counter = document.getElementById('dnCharCount');
  if (input && counter) counter.textContent = input.value.length;
}

function cancelDisplayName() {
  document.getElementById('displayNameOverlay').classList.add('hidden');
  if (_dnResolve) { _dnResolve(null); _dnResolve = null; }
}

async function confirmDisplayName() {
  const input = document.getElementById('displayNameInput');
  const name  = (input ? input.value.trim() : '');
  if (!name || name.length < 2) {
    input && (input.style.borderColor = 'var(--wrong-fg)');
    return;
  }
  if (name.length > 30) {
    input && (input.style.borderColor = 'var(--wrong-fg)');
    return;
  }
  // Save to Firestore
  try {
    const ref = window._doc(window._db, 'userProfiles', window._currentUser.uid);
    await window._setDoc(ref, { displayName: name }, { merge: true });
  } catch(e) { console.error('Failed to save display name:', e); }
  window._userDisplayName = name;
  document.getElementById('displayNameOverlay').classList.add('hidden');
  if (_dnResolve) { _dnResolve(name); _dnResolve = null; }
}

/* ══════════════════════════════════════════════════════════
   FIRESTORE UTILITIES
══════════════════════════════════════════════════════════ */

// Deep-clean an object for Firestore: remove undefined values so Firestore never rejects the doc.
function cleanForFirestore(obj) {
  if (Array.isArray(obj)) {
    return obj.map(cleanForFirestore).filter(v => v !== undefined);
  }
  if (obj !== null && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = cleanForFirestore(v);
    }
    return out;
  }
  return obj;
}

/* ══════════════════════════════════════════════════════════
   SHARED QUIZ IMAGE HELPERS (subcollection per shared quiz)
   Path: sharedQuizzes/{sharedId}/images/{questionIdx}
══════════════════════════════════════════════════════════ */

/* Upload images for a shared quiz into its images subcollection.
   Compresses each image first, then replaces q.image with a sharedImageIdx sentinel. */
async function uploadSharedQuizImages(sharedId, questions) {
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    if (!q.image) continue;
    try {
      const compressed = await compressImageDataUrl(q.image);
      const imgRef = window._doc(
        window._db,
        'sharedQuizzes', sharedId,
        'images', String(idx)
      );
      await window._setDoc(imgRef, { imageData: compressed });
      q.sharedImageIdx = idx; // sentinel for consumers
      delete q.image;
    } catch (e) {
      console.warn('Shared image upload failed for question', idx, e);
      // Keep inline as fallback
    }
  }
}

/* Fetch images for a shared quiz from its images subcollection. */
async function hydrateSharedQuizImages(sharedId, questions) {
  await Promise.all(questions.map(async (q) => {
    if (q.image) return; // already in memory
    if (typeof q.sharedImageIdx !== 'number') return; // no image
    try {
      const imgRef = window._doc(
        window._db,
        'sharedQuizzes', sharedId,
        'images', String(q.sharedImageIdx)
      );
      const snap = await window._getDoc(imgRef);
      if (snap.exists()) q.image = snap.data().imageData;
    } catch (e) {
      console.warn('Shared image fetch failed for question', q.sharedImageIdx, e);
    }
  }));
}

/* Delete all image subcollection docs for a shared quiz. */
async function deleteSharedQuizImages(sharedId) {
  try {
    const col = window._collection(window._db, 'sharedQuizzes', sharedId, 'images');
    const snap = await window._getDocs(col);
    await Promise.all(snap.docs.map(d => window._deleteDoc(d.ref)));
  } catch (e) {
    console.warn('Shared image cleanup failed for quiz', sharedId, e);
  }
}

/* ══════════════════════════════════════════════════════════
   PUBLISHED LECTURE IMAGE HELPERS
   Images are stored in a subcollection to avoid Firestore's
   1 MB per-document limit.  The published lecture doc stores
   a `pubImageIdx` sentinel (the question index) instead of
   the raw base64 string, just like sharedImageIdx works for
   community quizzes.  This makes published lectures fully
   self-contained and independent of the source quiz.
   Path: publishedQuestions/{subject}/lectures/{lectureId}/images/{questionIdx}
══════════════════════════════════════════════════════════ */

/** Upload images for a published lecture into its images subcollection.
 *  Modifies questions in-place: replaces q.image with a pubImageIdx sentinel. */
async function uploadPublishedLectureImages(subject, lectureId, questions) {
  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    if (!q.image) continue;
    try {
      const compressed = await compressImageDataUrl(q.image);
      const imgRef = window._doc(
        window._db,
        'publishedQuestions', subject,
        'lectures', lectureId,
        'images', String(idx)
      );
      await window._setDoc(imgRef, { imageData: compressed });
      q.pubImageIdx = idx; // sentinel: tells hydrate where to fetch
      delete q.image;
    } catch (e) {
      console.warn('Published image upload failed for question', idx, e);
      // Keep inline as fallback — better to store than lose the image
    }
  }
}

/** Fetch images for a published lecture from its images subcollection. */
async function hydratePublishedLectureImages(subject, lectureId, questions) {
  await Promise.all(questions.map(async (q) => {
    if (q.image) return; // already in memory
    if (typeof q.pubImageIdx !== 'number') return; // no image
    try {
      const imgRef = window._doc(
        window._db,
        'publishedQuestions', subject,
        'lectures', lectureId,
        'images', String(q.pubImageIdx)
      );
      const snap = await window._getDoc(imgRef);
      if (snap.exists()) q.image = snap.data().imageData;
    } catch (e) {
      console.warn('Published image fetch failed for question', q.pubImageIdx, e);
    }
  }));
}

/** Delete all image subcollection docs for a published lecture. */
async function deletePublishedLectureImages(subject, lectureId) {
  try {
    const col = window._collection(
      window._db,
      'publishedQuestions', subject,
      'lectures', lectureId,
      'images'
    );
    const snap = await window._getDocs(col);
    await Promise.all(snap.docs.map(d => window._deleteDoc(d.ref)));
  } catch (e) {
    console.warn('Published image cleanup failed for lecture', lectureId, e);
  }
}

