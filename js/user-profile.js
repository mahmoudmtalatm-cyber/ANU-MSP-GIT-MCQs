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
   IMAGE UPLOAD — now via the Cloudflare Worker/R2, content-hash
   addressed. Images stored in R2 are PERMANENT URLs, not sentinels —
   once uploaded, q.image is set to the real R2 URL directly, so there
   is no separate "hydrate" step needed anymore: fetching a lecture's
   or quiz's content JSON from R2 (see js/content-client.js) already
   returns fully-resolved image URLs, ready to use as-is.
══════════════════════════════════════════════════════════ */

const WORKER_BASE_URL = 'https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev';

/** Uploads one image (a data URL) for a given content item, returning its permanent R2 URL. */
async function uploadImageToR2(category, subject, itemId, dataUrl, previousR2Url) {
  const idToken = await window._currentUser.getIdToken();
  const bytes = await (await fetch(dataUrl)).blob();
  const previousHash = previousR2Url ? previousR2Url.split('/images/')[1]?.split('.')[0] || '' : '';
  const uploadUrl = category === 'curriculum'
    ? `${WORKER_BASE_URL}/curriculum/${subject}/${itemId}/images/new.jpg`
    : `${WORKER_BASE_URL}/community/${itemId}/images/new.jpg`;

  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': bytes.type || 'image/jpeg',
      'X-Previous-Image-Hash': previousHash
    },
    body: bytes
  });
  if (!resp.ok) throw new Error(`Image upload failed: ${await resp.text()}`);
  const { key } = await resp.json();
  return `${WORKER_BASE_URL}/${key}`;
}

/** Uploads any not-yet-uploaded (data URL) images for a shared/community quiz, mutating questions in place. */
async function uploadSharedQuizImages(sharedId, questions) {
  for (const q of questions) {
    if (!q.image || !q.image.startsWith('data:')) continue; // already a real URL, or no image
    try {
      q.image = await uploadImageToR2('community', null, sharedId, q.image, q.__previousImageUrl);
      delete q.__previousImageUrl;
    } catch (e) {
      console.warn('Shared image upload failed:', e);
    }
  }
}

/** No-op under the new architecture — R2-fetched content already has resolved image URLs. Kept for call-site compatibility. */
async function hydrateSharedQuizImages(_sharedId, _questions) { /* nothing to do — see comment above */ }

/** Images live at community/{sharedId}/images/{hash}.* in R2 — deletion is handled by the Worker's DELETE endpoint's refcount cleanup, not a separate call. Kept for call-site compatibility. */
async function deleteSharedQuizImages(_sharedId) { /* handled by the Worker on content delete, via image refcounts */ }

/** Uploads any not-yet-uploaded (data URL) images for a published lecture, mutating questions in place. */
async function uploadPublishedLectureImages(subject, lectureId, questions) {
  for (const q of questions) {
    if (!q.image || !q.image.startsWith('data:')) continue;
    try {
      q.image = await uploadImageToR2('curriculum', subject, lectureId, q.image, q.__previousImageUrl);
      delete q.__previousImageUrl;
    } catch (e) {
      console.warn('Published image upload failed:', e);
    }
  }
}

/** No-op under the new architecture — see hydrateSharedQuizImages above. Kept for call-site compatibility. */
async function hydratePublishedLectureImages(_subject, _lectureId, _questions) { /* nothing to do */ }

/** Kept for call-site compatibility — deletion + refcount cleanup now handled by the Worker's DELETE endpoint. */
async function deletePublishedLectureImages(_subject, _lectureId) { /* handled by the Worker on content delete */ }

