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
   IMAGES — now written INLINE as part of a quiz/lecture's own JSON
   content (a data: URL directly on the question), via putContentItem()
   in content-client.js. There's no separate per-image upload step, no
   R2 image sub-path, and no refcount to release on delete — an image is
   just a field on the question, saved and deleted along with it. The
   functions below are kept only as no-ops for call-site compatibility.
══════════════════════════════════════════════════════════ */

/** No-op — an inline image needs no separate hydration step; it's already part of the fetched content. Kept for call-site compatibility. */
async function hydrateSharedQuizImages(_sharedId, _questions) { /* nothing to do — see comment above */ }

/** No-op — an inline image needs no separate hydration step; it's already part of the fetched content. Kept for call-site compatibility. */
async function hydratePublishedLectureImages(_subject, _lectureId, _questions) { /* nothing to do */ }


