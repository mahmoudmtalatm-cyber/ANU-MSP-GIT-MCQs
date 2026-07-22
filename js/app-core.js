  /* ══════════════════════════════════════════════════════════
   ADMIN CONFIG — permission-based admin system
   ─────────────────────────────────────────────
   • SUPER_ADMIN_EMAIL is hardcoded, always has every permission,
     and can never be removed or demoted by anyone.
   • All other admins live in Firestore at appConfig/adminRoster,
     doc shape: { admins: { [emailLower]: { permissions:[...], addedBy, addedAt } } }
   • An admin can only grant permissions they themselves currently
     hold, and can only remove another admin whose permissions are
     fully covered by their own (so nobody can promote around, or
     demote/remove, an admin more powerful than themselves).
══════════════════════════════════════════════════════════ */
const SUPER_ADMIN_EMAIL = "mahmoudmtalatm@gmail.com";

const ADMIN_PERMISSIONS = ['curriculum', 'community', 'admins'];
const ADMIN_PERMISSION_LABELS = {
  curriculum: 'Manage Curriculum & Publish Quizzes',
  community:  'Manage Community Quizzes',
  admins:     'Assign / Remove Admins'
};

// In-memory copy of the Firestore admin roster, populated by loadAdminRoster().
// Shape: { [emailLower]: { permissions: string[], addedBy, addedAt } }
window._adminRoster = window._adminRoster || {};

// Unsubscribe handle for the current admin-roster listener, so loadAdminRoster()
// can safely tear down and re-attach a fresh subscription on every auth change.
window._adminRosterUnsub = window._adminRosterUnsub || null;

function isSuperAdmin(user) {
  return !!(user && user.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL);
}

/* Returns the array of permissions this user currently holds (empty array if none). */
function getAdminPermissions(user) {
  if (!user || !user.email) return [];
  const email = user.email.toLowerCase();
  if (email === SUPER_ADMIN_EMAIL) return ADMIN_PERMISSIONS.slice();
  const entry = window._adminRoster && window._adminRoster[email];
  return (entry && Array.isArray(entry.permissions)) ? entry.permissions.slice() : [];
}

function hasAdminPermission(user, perm) {
  return getAdminPermissions(user).includes(perm);
}

/* "Is an admin at all" — true if the user holds any permission. */
function isAdminUser(user) {
  return getAdminPermissions(user).length > 0;
}

/* Live-subscribe to the admin roster in Firestore. Returns a promise that
   resolves once the first snapshot arrives, but keeps listening after that —
   so if someone grants (or revokes) a permission while this tab is open, the
   change takes effect immediately here too, with no reload required. */
function loadAdminRoster() {
  if (!window._db) return Promise.resolve();
  // Tear down any previous subscription first. This is what lets us safely call
  // loadAdminRoster() again on every auth-state change (see onAuthStateChanged
  // below) instead of only once at page load: on a brand-new sign-in, the very
  // first subscription attempt can race ahead of Firebase Auth finishing restore
  // of the session, get rejected with permission-denied, and — since onSnapshot
  // never retries on its own — stay broken for the rest of that session until a
  // manual reload. Re-attaching fresh right after auth actually settles fixes it.
  if (window._adminRosterUnsub) {
    try { window._adminRosterUnsub(); } catch (e) {}
    window._adminRosterUnsub = null;
  }
  return new Promise(resolve => {
    let settled = false;
    try {
      const ref = window._doc(window._db, 'appConfig', 'adminRoster');
      window._adminRosterUnsub = window._onSnapshot(ref, snap => {
        const data = snap.exists() ? (snap.data() || {}) : {};
        window._adminRoster = data.admins || {};
        // Refresh admin-button visibility, and if the admin panel is currently
        // open, re-render it so newly-granted/revoked permissions apply live.
        updateAuthUI(window._currentUser);
        refreshOpenAdminPanel();
        if (!settled) { settled = true; resolve(); }
      }, err => {
        console.warn('Admin roster listener failed:', err);
        window._adminRoster = window._adminRoster || {};
        if (!settled) { settled = true; resolve(); }
      });
    } catch (e) {
      console.warn('Failed to attach admin roster listener:', e);
      window._adminRoster = window._adminRoster || {};
      resolve();
    }
  });
}

async function saveAdminRoster() {
  if (!window._db) return;
  const ref = window._doc(window._db, 'appConfig', 'adminRoster');
  await window._setDoc(ref, cleanForFirestore({ admins: window._adminRoster }));
}

/* Grant `permissions` to `targetEmail`. `actingUser` must hold 'admins' permission,
   and can only grant permissions they themselves currently hold. */
async function assignAdmin(actingUser, targetEmail, permissions) {
  if (!hasAdminPermission(actingUser, 'admins')) {
    throw new Error('You do not have permission to manage admins.');
  }
  const emailLower = String(targetEmail || '').trim().toLowerCase();
  if (!emailLower || !emailLower.includes('@')) throw new Error('Enter a valid email address.');
  if (emailLower === SUPER_ADMIN_EMAIL) throw new Error('That account is already the permanent super admin.');
  if (!Array.isArray(permissions) || !permissions.length) throw new Error('Select at least one permission to grant.');

  const actingPerms = isSuperAdmin(actingUser) ? ADMIN_PERMISSIONS.slice() : getAdminPermissions(actingUser);
  const invalid = permissions.filter(p => !actingPerms.includes(p));
  if (invalid.length) {
    throw new Error('You cannot grant permissions you do not hold yourself: ' + invalid.join(', '));
  }

  window._adminRoster[emailLower] = {
    permissions: permissions.slice(),
    addedBy: actingUser.email.toLowerCase(),
    addedAt: Date.now()
  };
  await saveAdminRoster();
}

/* ── Chain of command ──────────────────────────────────────
   Every admin (other than the super admin) was added by someone,
   recorded as `addedBy`. Walking that link repeatedly traces the
   full lineage of assigners back to the super admin. An admin can
   never remove anyone in their own lineage — i.e. whoever assigned
   them, or whoever assigned that person, and so on — regardless of
   permissions, so authority can only flow downward. */
function getAdminAssignerChain(emailLower) {
  const roster  = window._adminRoster || {};
  const chain   = [];
  const visited = new Set([emailLower]);
  let current = emailLower;
  while (true) {
    const entry = roster[current];
    if (!entry || !entry.addedBy) break;
    const parent = entry.addedBy.toLowerCase();
    if (visited.has(parent)) break; // cycle guard — shouldn't happen, but never loop forever
    chain.push(parent);
    visited.add(parent);
    if (parent === SUPER_ADMIN_EMAIL) break; // chain always terminates at the super admin
    current = parent;
  }
  return chain;
}

function isInAssignerChain(actingEmailLower, targetEmailLower) {
  return getAdminAssignerChain(actingEmailLower).includes(targetEmailLower);
}

/* Remove an admin. The super admin can never be removed, but the super admin
   can remove anyone else. A non-super admin can only remove another admin
   whose permissions are fully covered by their own, AND who is not above
   them in the assignment chain (i.e. didn't assign them, directly or
   transitively) — authority only flows downward. */
async function removeAdmin(actingUser, targetEmail) {
  const emailLower = String(targetEmail || '').trim().toLowerCase();
  if (emailLower === SUPER_ADMIN_EMAIL) throw new Error('The super admin cannot be removed.');
  if (!hasAdminPermission(actingUser, 'admins')) {
    throw new Error('You do not have permission to manage admins.');
  }
  const target = window._adminRoster[emailLower];
  if (!target) throw new Error('That admin was not found.');

  if (!isSuperAdmin(actingUser)) {
    const actingEmailLower = actingUser.email.toLowerCase();
    if (isInAssignerChain(actingEmailLower, emailLower)) {
      throw new Error('You cannot remove an admin who is above you in the assignment chain (they assigned you, directly or indirectly).');
    }
    const actingPerms = getAdminPermissions(actingUser);
    const targetPerms = target.permissions || [];
    const exceeds = targetPerms.some(p => !actingPerms.includes(p));
    if (exceeds) throw new Error('You cannot remove an admin who has permissions you do not hold.');
  }

  // Splice the removed admin out of the chain: anyone they directly assigned
  // gets re-parented to whoever assigned THEM, so the lineage above/below the
  // gap stays intact, exactly as if the removed admin had never been there.
  // Their own entry is then deleted outright. If this email is added again
  // later, it comes back as a brand-new node — addedBy is whoever re-adds
  // them now, with no automatic relink to the old descendants above.
  const grandparent = target.addedBy ? target.addedBy.toLowerCase() : null;
  for (const childEntry of Object.values(window._adminRoster)) {
    if (childEntry && childEntry.addedBy && childEntry.addedBy.toLowerCase() === emailLower) {
      if (grandparent) {
        childEntry.addedBy = grandparent;
      } else {
        delete childEntry.addedBy;
      }
    }
  }

  delete window._adminRoster[emailLower];
  await saveAdminRoster();
}

  /* ══════════════════════════════════════════════════════════
   AUTH UI
══════════════════════════════════════════════════════════ */
function updateAuthUI(user) {
  const homeArea = document.getElementById('authAreaHome');
  const quizArea = document.getElementById('authAreaQuiz');
  const adminBtn = document.getElementById('adminOpenBtn');
  if (adminBtn) adminBtn.classList.toggle('hidden', !isAdminUser(user));

  if (user) {
    // Logged-in state
    const loggedInHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <img src="${user.photoURL}"
             style="width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.6);"
             onerror="this.style.display='none'" />
        <span style="color:white;font-size:.85rem;font-weight:700;">
          ${user.displayName ? user.displayName.split(' ')[0] : 'User'}
        </span>
        <button onclick="fbSignOut()"
                style="background:rgba(255,255,255,.2);border:1.5px solid rgba(255,255,255,.4);
                       color:white;padding:5px 12px;border-radius:6px;cursor:pointer;
                       font-weight:700;font-size:.78rem;font-family:var(--font);">
          Sign out
        </button>
      </div>`;
    if (homeArea) homeArea.innerHTML = loggedInHTML;
    if (quizArea) quizArea.innerHTML = loggedInHTML;
  } else {
    // Logged-out state
    const signInHTML = `
      <button onclick="fbSignIn()"
              style="background:white;color:var(--accent);border:none;padding:8px 16px;
                     border-radius:8px;cursor:pointer;font-weight:800;font-size:.85rem;
                     display:flex;align-items:center;gap:7px;font-family:var(--font);
                     box-shadow:0 2px 8px rgba(0,0,0,.15);">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
             style="width:17px;height:17px;" />
        Sign in with Google
      </button>`;
    if (homeArea) homeArea.innerHTML = signInHTML;
    if (quizArea) quizArea.innerHTML = signInHTML;
  }
}

async function fbSignIn() {
  try {
    await window._signInWithPopup(window._auth, window._GoogleProvider);
    // onAuthStateChanged fires automatically after this — no extra code needed
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      alert('Sign-in failed: ' + e.message);
    }
  }
}

async function fbSignOut() {
  if (!confirm('Sign out of your account?')) return;
  await window._signOut(window._auth);
  window._currentUser  = null;
  window._cachedStats  = null;
  updateAuthUI(null);
}
  function updateSubjectButtonStates() {
  document.querySelectorAll('.subject-btn').forEach(btn => {
    const name  = btn.dataset.subject;
    const count = selectedLectures[name]?.size || 0;
    btn.classList.toggle('has-selection', count > 0 && name !== selectedSubject);
  });
}
/* ══════════════════════════════════════════════════════════
   SUBJECT & LECTURE DATA
   
   HOW TO ADD QUESTIONS TO OTHER SUBJECTS:
   ─────────────────────────────────────────
   Each subject has a "lectures" object.
   Each lecture is an array of question objects.

   Question object structure:
   {
     question: "The question text",
     image: "https://example.com/image.png",   ← OPTIONAL: URL or base64 data URI
     options: { A: "...", B: "...", C: "...", D: "..." },
     answer: "A"   ← must match one of the option keys
   }

   Example with image:
   {
     question: "What structure is shown in the image?",
     image: "https://upload.wikimedia.org/…/anatomy.jpg",
     options: { A: "Stomach", B: "Liver", C: "Pancreas", D: "Spleen" },
     answer: "B"
   }
══════════════════════════════════════════════════════════ */
const subjects = {};
// Years are fully admin-managed (added/renamed/deleted via the Admin
// Panel → Manage Curriculum tab) — nothing is hardcoded here. Existing
// years are restored from Firestore by loadCurriculumExtensions().
const curriculum = {};
// year -> icon override, set via the icon picker in Manage Curriculum.
// Years without an explicit icon fall back to an auto-numbered emoji
// (1️⃣, 2️⃣, 3️⃣, … 🔟, 1️⃣1️⃣, …) based on their position — see _yearIcon().
let yearIconMap = {};

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
let currentQuestions = [];
let currentIndex     = 0;
let userAnswers      = {};
let markedSet        = new Set();
let timeLeft         = 0;
let timerInterval    = null;
let selectedSubject  = '';
let selectedYear     = '';
let selectedModule   = '';
let questionTimes    = {};
let questionStart    = 0;
let currentLecture   = '';
let changeLog        = [];
let selectedLectures = {}; // { subjectName: Set of lecture names }
let correctToWrong   = 0;
let wrongToCorrect   = 0;
let currentQuizSource = 'curriculum'; // 'curriculum' | 'custom' | 'community'

/* ══════════════════════════════════════════════════════════
   UNLOAD GUARD — warn before refresh/close if progress could
   be lost: an active quiz timer, or a background process
   (AI generation, admin publish/split, syncing, explain-all).
══════════════════════════════════════════════════════════ */
function _hasUnsavedProgress() {
  // Quiz in progress: timer running and the quiz screen is showing
  const quizScreen = document.getElementById('quiz');
  if (timerInterval && quizScreen && !quizScreen.classList.contains('hidden')) return true;

  // Background processes that would be interrupted mid-flight
  if (typeof cqBusy !== 'undefined' && cqBusy) return true;
  if (typeof adminBusy !== 'undefined' && adminBusy) return true;
  if (typeof _explainAllBusy !== 'undefined' && _explainAllBusy) return true;
  if (typeof _editorBulkBusy !== 'undefined' && (_editorBulkBusy.admin || _editorBulkBusy.customQuiz)) return true;
  if (typeof _aiToolsBusy !== 'undefined' && Object.keys(_aiToolsBusy).length) return true;

  // A Firestore sync/loading operation is in flight
  const toast = document.getElementById('fsLoadingToast');
  if (toast && toast.classList.contains('visible')) return true;

  return false;
}
window.addEventListener('beforeunload', (e) => {
  if (!_hasUnsavedProgress()) return;
  e.preventDefault();
  e.returnValue = ''; // required by Chrome to show the confirmation dialog
  return '';
});
/* ══════════════════════════════════════════════════════════
   INIT — build subject grid
══════════════════════════════════════════════════════════ */
function buildYearGrid() {
  const grid = document.getElementById('yearGrid');
  grid.innerHTML = '';
  Object.keys(curriculum).forEach((year, i) => {
    const btn = document.createElement('button');
    btn.className = 'year-btn';
    btn.dataset.year = year;
    btn.innerHTML = `<span class="y-icon">${_yearIcon(year, i)}</span>${year}`;
    btn.onclick = () => selectYear(year);
    if (year === selectedYear) btn.classList.add('active');
    grid.appendChild(btn);
  });
}

/* Keycap-digit emoji for a position, e.g. 1 → "1️⃣", 10 → "🔟", 11 → "1️⃣1️⃣".
   Used as the default year icon until an admin picks a custom one. */
function _numberEmoji(n) {
  if (n === 10) return '🔟';
  return String(n).split('').map(d => d + '\uFE0F\u20E3').join('');
}

/* Look up the icon for a year: admin-set icon > auto-numbered fallback
   (position is 0-indexed, matching Object.keys(curriculum) order). */
function _yearIcon(year, position) {
  return (yearIconMap && yearIconMap[year]) || _numberEmoji(position + 1);
}
/* ══════════════════════════════════════════════════════════
   FIRESTORE LOADING INDICATOR
   Tracks background promises. Show toast when user opens
   something whose data hasn't finished loading yet.
══════════════════════════════════════════════════════════ */
const _fsReady = {
  curriculum:    false,
  published:     false,
  stats:         true,   // true until a signed-in user triggers a load
  customQuizzes: true,   // true until a signed-in user triggers a load
};

function fsLoadingShow(msg) {
  const toast = document.getElementById('fsLoadingToast');
  const label = document.getElementById('fsLoadingMsg');
  if (label) label.textContent = msg || 'Loading…';
  if (toast) toast.classList.add('visible');
}

function fsLoadingHide() {
  const toast = document.getElementById('fsLoadingToast');
  if (toast) toast.classList.remove('visible');
}

/* Call when user opens something — shows toast if data isn't ready, hides when it is */
function fsAwaitIfNeeded(key, msg) {
  if (_fsReady[key]) return; // already done, nothing to show
  fsLoadingShow(msg);
  // Poll until ready (resolves within the same event-loop tick once the promise sets the flag)
  const interval = setInterval(() => {
    if (_fsReady[key]) {
      clearInterval(interval);
      fsLoadingHide();
    }
  }, 100);
}

buildYearGrid();

/* ══════════════════════════════════════════════════════════
   SUBJECT SELECTION
══════════════════════════════════════════════════════════ */
function selectYear(year) {
  fsAwaitIfNeeded('curriculum', 'Loading curriculum…');
  selectedYear    = year;
  selectedModule  = '';
  selectedSubject = '';
  selectedLectures = {};

  document.querySelectorAll('.year-btn').forEach(b => b.classList.toggle('active', b.dataset.year === year));

  const moduleSection  = document.getElementById('moduleSection');
  const subjectSection = document.getElementById('subjectSection');
  document.getElementById('moduleGrid').innerHTML   = '';
  document.getElementById('subjectGrid').innerHTML  = '';
  document.getElementById('lectureCheckList').innerHTML =
    '<div style="color:var(--text-muted);font-size:.9rem;padding:8px;">— Choose a subject first —</div>';
  document.getElementById('qCountBadge').classList.add('hidden');
  document.getElementById('startBtn').disabled = true;
  subjectSection.classList.add('hidden');

  const modules = Object.keys(curriculum[year] || {});
  if (!modules.length) {
    document.getElementById('moduleGrid').innerHTML =
      '<div style="color:var(--text-muted);font-size:.9rem;padding:4px;">No modules available for this year yet.</div>';
    moduleSection.classList.remove('hidden');
    return;
  }

  modules.forEach(mod => {
    const btn = document.createElement('button');
    btn.className = 'module-btn';
    btn.dataset.module = mod;
    btn.innerHTML = `<span class="m-icon">${_moduleIcon(year, mod)}</span>${mod}`;
    btn.onclick = () => selectModule(mod);
    document.getElementById('moduleGrid').appendChild(btn);
  });
  moduleSection.classList.remove('hidden');
}

function selectModule(mod) {
  selectedModule  = mod;
  selectedSubject = '';
  selectedLectures = {};

  document.querySelectorAll('.module-btn').forEach(b => b.classList.toggle('active', b.dataset.module === mod));

  const subjectSection = document.getElementById('subjectSection');
  const grid = document.getElementById('subjectGrid');
  grid.innerHTML = '';
  document.getElementById('lectureCheckList').innerHTML =
    '<div style="color:var(--text-muted);font-size:.9rem;padding:8px;">— Choose a subject first —</div>';
  document.getElementById('qCountBadge').classList.add('hidden');
  document.getElementById('startBtn').disabled = true;

  const names = (curriculum[selectedYear][mod] || []).filter(n => subjects[n]);
  if (!names.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:.9rem;padding:4px;">No subjects in this module yet.</div>';
    subjectSection.classList.remove('hidden');
    return;
  }
  names.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'subject-btn';
    btn.dataset.subject = name;
    btn.innerHTML = `<span class="subj-icon">${subjects[name].icon}</span>${subjects[name].label || name}`;
    btn.onclick = () => selectSubject(name);
    grid.appendChild(btn);
  });
  subjectSection.classList.remove('hidden');
}
function selectSubject(name) {
  fsAwaitIfNeeded('published', 'Loading lectures…');
  selectedSubject = name;

  document.querySelectorAll('.subject-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.subject === name)
  );

  const list = document.getElementById('lectureCheckList');
  list.innerHTML = '';

  const lectures = Object.keys(subjects[name].lectures);
  if (!lectures.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:.9rem;padding:8px;">No lectures available.</div>';
    updateLectureCount();
    return;
  }

  if (!selectedLectures[name]) selectedLectures[name] = new Set();

  lectures.forEach(lname => {
    const qCount   = subjects[name].lectures[lname].length;
    const isChecked = selectedLectures[name].has(lname);
    const label    = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 4px;border-radius:6px;';
    label.innerHTML = `
      <input type="checkbox" value="${lname}" ${isChecked ? 'checked' : ''}
        style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;" />
      <span style="font-size:.88rem;font-weight:600;color:var(--text-main);flex:1;">${lname}</span>
      <span style="font-size:.78rem;color:var(--accent);font-weight:700;">${qCount}q</span>
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      if (!selectedLectures[name]) selectedLectures[name] = new Set();
      if (e.target.checked) selectedLectures[name].add(lname);
      else selectedLectures[name].delete(lname);
      updateLectureCount();
    });
    list.appendChild(label);
  });

  updateLectureCount();
}
function onLectureChange() { updateLectureCount(); }  // kept for safety

function updateLectureCount() {
  let total = 0;
  Object.entries(selectedLectures).forEach(([subj, lecSet]) => {
    lecSet.forEach(lname => {
      const qs = subjects[subj]?.lectures[lname];
      if (qs) total += qs.length;
    });
  });
  const badge = document.getElementById('qCountBadge');
  const btn   = document.getElementById('startBtn');
  if (total === 0) { badge.classList.add('hidden'); btn.disabled = true; }
  else {
    document.getElementById('qCountText').textContent = `${total} question${total !== 1 ? 's' : ''}`;
    badge.classList.remove('hidden');
    btn.disabled = false;
  }
  updateSubjectButtonStates();
}

function selectAllLectures() {
  if (!selectedSubject) return;
  if (!selectedLectures[selectedSubject]) selectedLectures[selectedSubject] = new Set();
  Object.keys(subjects[selectedSubject].lectures).forEach(l => selectedLectures[selectedSubject].add(l));
  selectSubject(selectedSubject);
}

function clearAllLectures() {
  if (!selectedSubject) return;
  if (selectedLectures[selectedSubject]) selectedLectures[selectedSubject].clear();
  selectSubject(selectedSubject);
}

/* ══════════════════════════════════════════════════════════
   SCREEN SWITCHING
══════════════════════════════════════════════════════════ */
function showScreen(id) {
  ['home','quiz','results'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

/* ══════════════════════════════════════════════════════════
   HOME → START
══════════════════════════════════════════════════════════ */

function startRetakeQuiz(questionsArray) {
  if (!questionsArray || questionsArray.length === 0) {
    return alert('No wrong questions found to retake.');
  }
  currentQuestions = questionsArray;
  selectedSubject  = selectedSubject || 'Retake';
  currentLecture   = 'Retake — Wrong Questions';
  currentIndex     = 0;
  userAnswers      = {};
  markedSet        = new Set();
  questionTimes    = {};
  correctToWrong   = 0;
  wrongToCorrect   = 0;
  changeLog        = [];
  timeLeft         = Math.max(questionsArray.length * 60, 120);
  showScreen('quiz');
  renderQuestion();
  startTimer();
}

function startQuiz() {
  const mins    = parseInt(document.getElementById('timeInput').value, 10);
  const shuffle = document.getElementById('shuffleToggle').checked;

  let combined = [], totalLecCount = 0;
  const involvedSubjects = [];
  Object.entries(selectedLectures).forEach(([subj, lecSet]) => {
    if (!lecSet.size) return;
    involvedSubjects.push(subj);
    lecSet.forEach(lname => {
      combined = combined.concat(subjects[subj]?.lectures[lname] || []);
      totalLecCount++;
    });
  });

  if (!combined.length)   return alert('Please select at least one lecture.');
  if (!mins || mins <= 0) return alert('Please enter a valid duration in minutes.');

  if (shuffle) {
    combined = _cqGroupAwareShuffle(combined);
  }

  selectedSubject  = involvedSubjects.length === 1 ? involvedSubjects[0] : involvedSubjects.join(' + ');
  currentLecture   = totalLecCount === 1
    ? [...selectedLectures[involvedSubjects[0]]][0]
    : `${totalLecCount} lectures (${involvedSubjects.map(subjectDisplayName).join(', ')})`;
  currentQuestions = combined;
  currentIndex = 0; userAnswers = {}; markedSet = new Set();
  questionTimes = {}; correctToWrong = 0; wrongToCorrect = 0; changeLog = [];
  timeLeft = mins * 60;
  currentQuizSource = 'curriculum';

  showScreen('quiz');
  renderQuestion();
  startTimer();
}
/* ══════════════════════════════════════════════════════════
   TIMER
══════════════════════════════════════════════════════════ */
function startTimer() {
  stopTimer();
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) { timeLeft = 0; updateTimerDisplay(); stopTimer(); submitQuiz(); }
    else { updateTimerDisplay(); }
  }, 1000);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
function updateTimerDisplay() {
  const m = String(Math.floor(timeLeft/60)).padStart(2,'0');
  const s = String(timeLeft%60).padStart(2,'0');
  const el = document.getElementById('timerDisplay');
  el.textContent = `${m}:${s}`;
  el.classList.toggle('urgent', timeLeft <= 60);
}

/* ── Returns option [key, value] pairs in guaranteed original order.
   Uses optionsOrder array if present, otherwise falls back to Object.entries. ── */
function getOptionEntries(q) {
  if (Array.isArray(q.optionsOrder) && q.optionsOrder.length) {
    return q.optionsOrder.map(({ key, value }) => [key, value]);
  }
  return Object.entries(q.options);
}

/* ══════════════════════════════════════════════════════════
   RENDER QUESTION
══════════════════════════════════════════════════════════ */
function renderQuestion() {
  questionStart = Date.now();
  const q     = currentQuestions[currentIndex];
  const total = currentQuestions.length;

  document.getElementById('qNumber').textContent = `Q${currentIndex+1} / ${total}`;
  document.getElementById('qText').textContent   = q.question;

  // Optional image
  const imgWrap = document.getElementById('qImageWrap');
  const imgEl   = document.getElementById('qImage');
  if (q.image) {
    imgEl.src = q.image;
    imgWrap.classList.remove('hidden');
  } else {
    imgWrap.classList.add('hidden');
    imgEl.src = '';
  }

  const list = document.getElementById('optionsList');
  list.innerHTML = '';

  getOptionEntries(q).forEach(([key, val]) => {
    const saved = userAnswers[currentIndex] || '';
    const label = document.createElement('label');
    label.className = 'option-label' + (saved === key ? ' selected' : '');
    label.innerHTML = `
      <input type="radio" name="q${currentIndex}" value="${key}" ${saved===key?'checked':''} />
      <span class="opt-key">${key}.</span>
      <span>${val}</span>
    `;
    label.addEventListener('click', () => selectAnswer(key));
    list.appendChild(label);
  });

  updateMarkBtn();
  renderNavigator();
}

function selectAnswer(key) {
  const prev    = userAnswers[currentIndex] || '';
  const correct = currentQuestions[currentIndex].answer;
  if (prev && prev !== key) {
    if (prev === correct)   correctToWrong++;
    else if (key === correct) wrongToCorrect++;
    const _q    = currentQuestions[currentIndex];
    const _type = prev === correct ? 'c2w' : key === correct ? 'w2c' : 'w2w';
    changeLog.push({
      qIndex:   currentIndex,
      fromKey:  prev,       fromText: _q.options[prev],
      toKey:    key,        toText:   _q.options[key],
      type:     _type
    });
  }
  userAnswers[currentIndex] = key;
  document.querySelectorAll('.option-label').forEach(lbl => {
    const inp = lbl.querySelector('input');
    lbl.classList.toggle('selected', inp.value === key);
  });
  renderNavigator();
}

/* ══════════════════════════════════════════════════════════
   NAVIGATOR
══════════════════════════════════════════════════════════ */
function renderNavigator() {
  const grid = document.getElementById('navGrid');
  grid.innerHTML = '';
  currentQuestions.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn ' + navState(i);
    btn.textContent = i + 1;
    btn.onclick = () => goTo(i);
    grid.appendChild(btn);
  });
}
function navState(i) {
  if (i === currentIndex)  return 'state-current';
  if (markedSet.has(i))    return 'state-marked';
  if (userAnswers[i])      return 'state-answered';
  return 'state-default';
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function goTo(i) {
  const spent = Math.round((Date.now() - questionStart) / 1000);
  questionTimes[currentIndex] = (questionTimes[currentIndex] || 0) + spent;
  currentIndex = i;
  renderQuestion();
}
function prevQ()  { if (currentIndex > 0) goTo(currentIndex - 1); }
function nextQ()  { if (currentIndex < currentQuestions.length - 1) goTo(currentIndex + 1); }

/* ══════════════════════════════════════════════════════════
   MARK
══════════════════════════════════════════════════════════ */
function toggleMark() {
  if (markedSet.has(currentIndex)) markedSet.delete(currentIndex);
  else markedSet.add(currentIndex);
  updateMarkBtn();
  renderNavigator();
}
function updateMarkBtn() {
  const btn = document.getElementById('markBtn');
  btn.classList.toggle('is-marked', markedSet.has(currentIndex));
  btn.textContent = markedSet.has(currentIndex) ? '🔴 Unmark' : '🔴 Mark / Unmark';
}

/* ══════════════════════════════════════════════════════════
   SUBMIT
══════════════════════════════════════════════════════════ */
function confirmSubmit() {
  const unanswered = currentQuestions.length - Object.keys(userAnswers).length;
  if (unanswered > 0) {
    if (!confirm(`You still have ${unanswered} unanswered question(s). Submit anyway?`)) return;
  }
  submitQuiz();
}

function submitQuiz() {
  const spent = Math.round((Date.now() - questionStart) / 1000);
  questionTimes[currentIndex] = (questionTimes[currentIndex] || 0) + spent;
  stopTimer();
  const total = currentQuestions.length;
  let score = 0;
  currentQuestions.forEach((q, i) => {
    if (userAnswers[i] === q.answer) score++;
  });

  const pct   = Math.round(score / total * 100);
  const emoji = pct === 100 ? '🏆' : pct >= 70 ? '🎉' : '📝';
  if (pct === 100) launchConfetti();

  document.getElementById('resultsTitle').textContent = `${emoji}  Quiz Results`;
  const totalTime = Object.values(questionTimes).reduce((a,b) => a+b, 0);
  const answered  = Object.keys(questionTimes).length || 1;
  const avgTime   = Math.round(totalTime / answered);
  const avgMins   = Math.floor(avgTime / 60);
  const avgSecs   = String(avgTime % 60).padStart(2,'0');
  const avgLabel  = avgMins > 0 ? `${avgMins}m ${avgSecs}s` : `${avgSecs}s`;
  document.getElementById('resultsTitle').textContent = `${emoji}  Quiz Results  ·  ⏱ avg ${avgLabel}/question`;
  const badge = document.getElementById('scoreBadge');
  badge.textContent  = `${score} / ${total}  (${pct}%)`;
  badge.style.background = pct >= 70 ? 'var(--green-pale-border)' : 'var(--red-pale)';
  const _totalSecs  = Object.values(questionTimes).reduce((a,b)=>a+b,0);
  const _timedQs    = Object.keys(questionTimes).length;
  const _unanswered = currentQuestions.length - Object.keys(userAnswers).length;
  const _wrong      = currentQuestions.length - score - _unanswered;
  saveQuizStats(score, currentQuestions.length, _wrong, _unanswered, _totalSecs, _timedQs, correctToWrong, wrongToCorrect, selectedSubject, currentLecture);

  buildResults();
  showScreen('results');
}

// Cancels any in-flight per-question explanations and chats from the results
// screen and clears their busy/loading state. Shared by buildResults() (new
// results view) and showScreen() (leaving results without a new view) — if
// this never runs on the "leaving" path, a request abandoned mid-flight stays
// marked busy forever, since nothing else would ever clear it, and every
// later _guardedClose() confirm() would keep firing for a process the user
// can no longer see or stop.
function _cancelAndClearResultsAiState() {
  if (_allCancelToken) { _cancelAiToken(_allCancelToken); _allCancelToken = null; }
  Object.keys(_singleCancelToken).forEach(k => { _cancelAiToken(_singleCancelToken[k]); delete _singleCancelToken[k]; });
  for (const k in _explainCache) delete _explainCache[k];
  for (const k in _explainRawText) delete _explainRawText[k];
  Object.keys(_chatCancelToken).forEach(k => { _cancelAiToken(_chatCancelToken[k]); delete _chatCancelToken[k]; });
  for (const k in _chatHistory) delete _chatHistory[k];
  for (const k in _chatPending) delete _chatPending[k];
  for (const k in _chatBusy) delete _chatBusy[k];
  _explainAllBusy = false;
}

function buildResults() {
  // Cancel any in-progress explanations from a previous result view
  _cancelAndClearResultsAiState();
  // Snapshot any shared (Firestore) explanations for this quiz so they can be reused
  // instantly instead of re-generated, and so newly-generated ones can be shared too.
  _explainPoolLoadPromise = _loadExplainPool(currentQuestions);
  const explainAllBtn = document.getElementById('explainAllBtn');
  if (explainAllBtn) { explainAllBtn.disabled = false; explainAllBtn.innerHTML = '🤖&nbsp; Explain All Questions'; explainAllBtn.onclick = explainAllQuestions; }

  const body = document.getElementById('resultsBody');
  body.innerHTML = '';
  if (correctToWrong > 0 || wrongToCorrect > 0) {
    const summary = document.createElement('div');
    summary.style.cssText = 'background:#fff;border:1px solid var(--border-soft);border-radius:10px;padding:14px 20px;display:flex;gap:24px;flex-wrap:wrap;margin-bottom:4px;';
    summary.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.3rem">🔄</span>
        <div>
          <div style="font-size:.78rem;font-weight:700;color:#5A7080;text-transform:uppercase;letter-spacing:.8px;">Answer Changes</div>
          <div style="display:flex;gap:16px;margin-top:4px;flex-wrap:wrap;">
            <span style="font-weight:700;color:var(--wrong-fg);">✘ Correct → Wrong: ${correctToWrong}</span>
            <span style="font-weight:700;color:var(--correct-fg);">✔ Wrong → Correct: ${wrongToCorrect}</span>
          </div>
        </div>
      </div>`;
    body.appendChild(summary);
  }
if (changeLog.length > 0) {
    const flowSection = document.createElement('div');
    flowSection.className = 'change-flow-section';
    flowSection.innerHTML = `<div class="change-flow-title">🔄 Answer Changes Flow — ${changeLog.length} change${changeLog.length!==1?'s':''}</div>`;
    const flowList = document.createElement('div');
    flowList.className = 'change-flow-list';
    const verdicts = {
      c2w: '✘ You changed a correct answer to a wrong one',
      w2c: '✔ You changed a wrong answer to the correct one',
      w2w: '↔ You changed from one wrong answer to another'
    };
    changeLog.forEach((ch, idx) => {
      const q       = currentQuestions[ch.qIndex];
      const item    = document.createElement('div');
      item.className = `change-flow-item ${ch.type}`;
      const qShort  = q.question.length > 65 ? q.question.substring(0,65)+'…' : q.question;
      const fShort  = ch.fromText.length > 55 ? ch.fromText.substring(0,55)+'…' : ch.fromText;
      const tShort  = ch.toText.length   > 55 ? ch.toText.substring(0,55)+'…'   : ch.toText;
      item.innerHTML = `
        <span class="cf-num">Change ${idx+1}</span>
        <div class="cf-body">
          <div class="cf-qnum">Q${ch.qIndex+1}: ${qShort}</div>
          <div>
            <span class="cf-from">${ch.fromKey}. ${fShort}</span>
            <span class="cf-arrow">→</span>
            <span class="cf-to">${ch.toKey}. ${tShort}</span>
          </div>
          <div class="cf-verdict">${verdicts[ch.type]}</div>
        </div>`;
      flowList.appendChild(item);
    });
    flowSection.appendChild(flowList);
    body.appendChild(flowSection);
  }
  currentQuestions.forEach((q, i) => {
    const userAns  = userAnswers[i] || '';
    const correct  = q.answer;
    const isOk     = userAns === correct;
    const isUnansw = userAns === '';
    const isMark   = markedSet.has(i);

    let cls, statusText, statusClass, stripColor;
    if (isOk) {
      cls='correct';    statusText='✔  Correct';       statusClass='correct';    stripColor='var(--correct-fg)';
    } else if (isUnansw) {
      cls='unanswered'; statusText='—  Not answered';  statusClass='unanswered'; stripColor='var(--unanswered-fg)';
    } else {
      cls='wrong';      statusText='✘  Incorrect';     statusClass='wrong';      stripColor='var(--wrong-fg)';
    }

    const card = document.createElement('div');
    card.className = `r-card ${cls}`;

    // Build image HTML for results
    const imgHTML = q.image
      ? `<div class="r-image-wrap"><img src="${q.image}" alt="Question image" /></div>`
      : '';

    card.innerHTML = `
      <div class="r-card-inner">
        <div class="r-strip" style="background:${stripColor}"></div>
        <div class="r-content">
          <div class="r-card-header">
            <div class="r-qnum">Q${i+1}${isMark?' &nbsp;🔴 Marked':''}</div>
            <div class="r-status ${statusClass}">${statusText}</div>
          </div>
          <div class="r-question">${q.question}</div>
          ${imgHTML}
          <div class="r-options"></div>
        </div>
      </div>
    `;

    const optsDiv = card.querySelector('.r-options');
    getOptionEntries(q).forEach(([key, val]) => {
      const isCorrectOpt = key === correct;
      const isUserOpt    = key === userAns;

      let bg='', fg='', pfx='';
      if (isCorrectOpt)      { bg='#C8E6C9'; fg='#1B5E20'; pfx='✔'; }
      else if (isUserOpt)    { bg='var(--red-pale)'; fg='var(--red-deep)'; pfx='✘'; }

      const row = document.createElement('div');
      row.className = 'r-option';
      if (bg) { row.style.background=bg; row.style.border=`1px solid ${fg}`; row.style.borderRadius='6px'; }
      row.innerHTML = `
        <span class="r-opt-pfx" style="color:${fg||'var(--text-muted)'}">${pfx||' '}</span>
        <strong style="color:${fg||'var(--text-muted)'};min-width:20px">${key}.</strong>
        <span style="color:${fg||'var(--text-muted)'};${isCorrectOpt||isUserOpt?'font-weight:600':''}">${val}</span>
      `;
      optsDiv.appendChild(row);
    });

    // AI Explain button
    const explainBtn = document.createElement('button');
    explainBtn.className = 'ai-explain-btn';
    explainBtn.id = `explainBtn_${i}`;
    explainBtn.innerHTML = '🤖 Explain';
    explainBtn.onclick = () => explainQuestion(i);
    card.querySelector('.r-content').appendChild(explainBtn);

    // Placeholder for the explanation panel
    const explainPanel = document.createElement('div');
    explainPanel.id = `explainPanel_${i}`;
    card.querySelector('.r-content').appendChild(explainPanel);

    // AI Chat button
    const chatBtn = document.createElement('button');
    chatBtn.className = 'ai-chat-btn';
    chatBtn.id = `chatBtn_${i}`;
    chatBtn.innerHTML = '💬 Chat';
    chatBtn.onclick = () => toggleChatPanel(i);
    card.querySelector('.r-content').appendChild(chatBtn);

    // Quick-access API Key Manager button (shows the currently active key)
    const apikeyBtn = document.createElement('button');
    apikeyBtn.className = 'ai-apikey-btn';
    apikeyBtn.id = `apikeyQuickBtn_${i}`;
    apikeyBtn.title = 'Manage API Keys';
    apikeyBtn.innerHTML = _apiKeyQuickBtnHTML();
    apikeyBtn.onclick = () => openApiKeyManager();
    card.querySelector('.r-content').appendChild(apikeyBtn);

    // Placeholder for the chat panel
    const chatPanel = document.createElement('div');
    chatPanel.id = `chatPanel_${i}`;
    chatPanel.className = 'ai-chat-panel';
    card.querySelector('.r-content').appendChild(chatPanel);

    body.appendChild(card);
  });
}

function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';

  const pieces = Array.from({length: 150}, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height,
    w: Math.random() * 12 + 6,
    h: Math.random() * 6 + 4,
    color: `hsl(${Math.random()*360},90%,55%)`,
    speed: Math.random() * 4 + 2,
    angle: Math.random() * 360,
    spin: Math.random() * 4 - 2,
    drift: Math.random() * 2 - 1
  }));

  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
      p.y += p.speed;
      p.x += p.drift;
      p.angle += p.spin;
      if (p.y > canvas.height) {
        p.y = -10;
        p.x = Math.random() * canvas.width;
      }
    });
    frame = requestAnimationFrame(draw);
  }
  draw();
  setTimeout(() => {
    cancelAnimationFrame(frame);
    canvas.style.display = 'none';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, 4000);
}

/* ══════════════════════════════════════════════════════════
   BACK TO HOME
══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   PERSISTENT STATISTICS
══════════════════════════════════════════════════════════ */
const STATS_KEY = 'anu_msp_stats_v2';

function defaultStats() {
  return {
    totalQuizzes: 0, totalQuestions: 0,
    totalCorrect: 0, totalWrong: 0, totalUnanswered: 0,
    totalTimeSecs: 0, totalTimedQs: 0,
    correctToWrong: 0, wrongToCorrect: 0,
    totalScorePct: 0, bestScore: null, worstScore: null,
    subjectStats: {}, history: []
  };
}

// Called once after login — loads stats from Firestore into memory
async function loadStatsFromFirestore() {
  if (!window._currentUser) return;
  try {
    const ref  = window._doc(window._db, 'stats', window._currentUser.uid);
    const snap = await window._getDoc(ref);
    if (snap.exists()) {
      window._cachedStats = Object.assign(defaultStats(), snap.data());
    } else {
      window._cachedStats = defaultStats();
    }
  } catch(e) {
    console.error('Failed to load stats from Firestore:', e);
    window._cachedStats = defaultStats();
  } finally {
    _fsReady.stats = true;
  }
}

// Called everywhere stats are read — returns the in-memory cache
function loadStats() {
  if (window._currentUser) {
    // Signed in — use Firestore cache (or empty if still loading)
    return window._cachedStats || defaultStats();
  } else {
    // Not signed in — fall back to localStorage
    try {
      const raw = localStorage.getItem(STATS_KEY);
      return raw ? Object.assign(defaultStats(), JSON.parse(raw)) : defaultStats();
    } catch(e) { return defaultStats(); }
  }
}

function persistStats(st) {
  window._cachedStats = st; // always update the in-memory cache

  if (window._currentUser) {
    // Signed in — save to Firestore
    const ref = window._doc(window._db, 'stats', window._currentUser.uid);
    window._setDoc(ref, st).catch(e => console.error('Failed to save stats:', e));
  } else {
    // Not signed in — save to localStorage as fallback
    try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch(e) {}
  }
}

/* Stats/Retake history stores whatever was in `selectedSubject` at quiz-submit
   time, which — for curriculum quizzes — is the raw subject key (e.g.
   "biochem1"), not its display label. Resolve it here at render time so the
   Statistics and Retake screens always show real subject names, without
   touching the stored data (subjectStats is keyed by the raw value, and
   changing that would split one subject's history across two entries). */
function subjectDisplayName(raw) {
  if (!raw) return raw;
  if (raw.indexOf(' + ') !== -1) {
    return raw.split(' + ').map(k => (subjects[k] && subjects[k].label) || k).join(' + ');
  }
  return (subjects[raw] && subjects[raw].label) || raw;
}

function saveQuizStats(score, total, wrong, unanswered, timeSecs, timedQs, c2w, w2c, subject, lecture) {
  const st  = loadStats();
  const pct = Math.round(score / total * 100);

  st.totalQuizzes++;
  st.totalQuestions  += total;
  st.totalCorrect    += score;
  st.totalWrong      += wrong;
  st.totalUnanswered += unanswered;
  st.totalTimeSecs   += timeSecs;
  st.totalTimedQs    += timedQs;
  st.correctToWrong  += c2w;
  st.wrongToCorrect  += w2c;
  st.totalScorePct   += pct;
  if (st.bestScore  === null || pct > st.bestScore)  st.bestScore  = pct;
  if (st.worstScore === null || pct < st.worstScore) st.worstScore = pct;

  if (!st.subjectStats[subject])
    st.subjectStats[subject] = { quizzes: 0, correct: 0, total: 0 };
  st.subjectStats[subject].quizzes++;
  st.subjectStats[subject].correct += score;
  st.subjectStats[subject].total   += total;

  const avgTime = timedQs > 0 ? Math.round(timeSecs / timedQs) : 0;
  st.history.unshift({
  subject, lecture, score, total, pct, avgTime, c2w, w2c,
  date: new Date().toLocaleDateString(),
  wrongQuestions: currentQuestions
    .filter((q, i) => (userAnswers[i] || '') !== q.answer)
});
  if (st.history.length > 20) st.history.pop();

  persistStats(st);
}

function openStats() {
  fsAwaitIfNeeded('stats', 'Loading your stats…');
  document.getElementById('statsOverlay').classList.remove('hidden');

  if (window._currentUser && !window._cachedStats) {
    // Still loading from Firestore — show spinner
    document.getElementById('statsBody').innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
        <div style="font-weight:700;">Loading your stats…</div>
      </div>`;
    // Try again shortly
    setTimeout(() => {
      if (document.getElementById('statsOverlay').classList.contains('hidden')) return;
      renderStatsModal();
    }, 1500);
  } else {
    renderStatsModal();
  }
}
function closeStats() { document.getElementById('statsOverlay').classList.add('hidden'); fsLoadingHide(); }

function resetStats() {
  if (!confirm('Reset ALL statistics? This cannot be undone.')) return;

  window._cachedStats = defaultStats();

  if (window._currentUser) {
    // Signed in — overwrite Firestore doc with empty stats
    const ref = window._doc(window._db, 'stats', window._currentUser.uid);
    window._setDoc(ref, defaultStats()).catch(e => console.error('Failed to reset stats:', e));
  } else {
    // Not signed in — clear localStorage
    localStorage.removeItem(STATS_KEY);
  }

  renderStatsModal();
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderStatsModal() {
  const st   = loadStats();
  const body = document.getElementById('statsBody');
  body.innerHTML = '';

  if (st.totalQuizzes === 0) {
    body.innerHTML = `<div class="no-stats-box"><div class="ns-icon">📊</div>No data yet — complete a quiz to see your statistics.</div>`;
    return;
  }

  const overallAcc  = Math.round(st.totalCorrect / st.totalQuestions * 100);
  const avgScore    = Math.round(st.totalScorePct / st.totalQuizzes);
  const avgTime     = st.totalTimedQs > 0 ? Math.round(st.totalTimeSecs / st.totalTimedQs) : 0;
  const studyMins   = Math.floor(st.totalTimeSecs / 60);
  const totalChanges = st.correctToWrong + st.wrongToCorrect;
  const c2wPct = totalChanges > 0 ? Math.round(st.correctToWrong / totalChanges * 100) : 0;
  const w2cPct = totalChanges > 0 ? Math.round(st.wrongToCorrect  / totalChanges * 100) : 0;
  const net    = st.wrongToCorrect - st.correctToWrong;

  /* — Overall Performance — */
  const sec1 = document.createElement('div');
  sec1.className = 'stats-section';
  sec1.innerHTML = `<div class="stats-section-title">📈 Overall Performance</div>`;
  const g1 = document.createElement('div');
  g1.className = 'stats-grid';
  g1.innerHTML = `
    <div class="stat-tile"><div class="stat-val">${st.totalQuizzes}</div><div class="stat-lbl">Quizzes Taken</div></div>
    <div class="stat-tile"><div class="stat-val">${overallAcc}%</div><div class="stat-lbl">Overall Accuracy</div></div>
    <div class="stat-tile"><div class="stat-val">${avgScore}%</div><div class="stat-lbl">Avg Score</div></div>
    <div class="stat-tile"><div class="stat-val">${st.bestScore !== null ? st.bestScore+'%' : '—'}</div><div class="stat-lbl">Best Score</div></div>
    <div class="stat-tile"><div class="stat-val">${st.worstScore !== null ? st.worstScore+'%' : '—'}</div><div class="stat-lbl">Worst Score</div></div>
    <div class="stat-tile"><div class="stat-val">${studyMins}m</div><div class="stat-lbl">Total Study Time</div></div>
    <div class="stat-tile"><div class="stat-val">${st.totalQuestions}</div><div class="stat-lbl">Total Questions</div></div>
    <div class="stat-tile"><div class="stat-val">${st.totalCorrect}</div><div class="stat-lbl">Correct</div></div>
    <div class="stat-tile"><div class="stat-val">${fmtTime(avgTime)}</div><div class="stat-lbl">Avg Time / Q</div></div>
  `;
  sec1.appendChild(g1);
  body.appendChild(sec1);

  /* — Answer Changes — */
  const sec2 = document.createElement('div');
  sec2.className = 'stats-section';
  sec2.innerHTML = `<div class="stats-section-title">🔄 Answer Changes (All Time) — ${totalChanges} total</div>`;
  if (totalChanges === 0) {
    sec2.innerHTML += `<div style="color:var(--text-muted);font-size:.88rem;">No answer changes recorded yet.</div>`;
  } else {
    const cr = document.createElement('div');
    cr.className = 'stats-change-row';
    cr.innerHTML = `
      <div class="change-tile c2w">
        <div class="change-val">${st.correctToWrong}</div>
        <div class="change-lbl">✘ Correct → Wrong</div>
        <div class="change-pct">${c2wPct}% of changes</div>
      </div>
      <div class="change-tile w2c">
        <div class="change-val">${st.wrongToCorrect}</div>
        <div class="change-lbl">✔ Wrong → Correct</div>
        <div class="change-pct">${w2cPct}% of changes</div>
      </div>`;
    sec2.appendChild(cr);
    const nl = document.createElement('div');
    nl.className = 'net-label';
    if (net > 0) {
      nl.style.cssText = 'background:var(--correct-bg);color:var(--correct-fg);border:1px solid var(--green-pale-border)';
      nl.textContent   = `✔ Net gain: changing answers gave you +${net} extra correct`;
    } else if (net < 0) {
      nl.style.cssText = 'background:var(--wrong-bg);color:var(--wrong-fg);border:1px solid var(--red-soft-border)';
      nl.textContent   = `✘ Net loss: changing answers cost you ${Math.abs(net)} correct`;
    } else {
      nl.style.cssText = 'background:var(--surface-2);color:var(--text-muted);border:1px solid var(--border-soft)';
      nl.textContent   = `Neutral: answer changes had no net effect`;
    }
    sec2.appendChild(nl);
  }
  body.appendChild(sec2);

  /* — Subject Performance — */
  const subjects_used = Object.keys(st.subjectStats);
  if (subjects_used.length > 0) {
    const sec3 = document.createElement('div');
    sec3.className = 'stats-section';
    sec3.innerHTML = `<div class="stats-section-title">📚 Subject Performance</div>`;
    subjects_used
      .sort((a,b) => {
        const pa = Math.round(st.subjectStats[a].correct/st.subjectStats[a].total*100);
        const pb = Math.round(st.subjectStats[b].correct/st.subjectStats[b].total*100);
        return pb - pa;
      })
      .forEach(subj => {
        const s   = st.subjectStats[subj];
        const pct = s.total > 0 ? Math.round(s.correct / s.total * 100) : 0;
        const row = document.createElement('div');
        row.className = 'subject-stat-row';
        row.innerHTML = `
          <div class="subj-stat-name">${escapeHtml(subjectDisplayName(subj))}</div>
          <div class="subj-bar-wrap"><div class="subj-bar" style="width:${pct}%"></div></div>
          <div class="subj-stat-pct">${pct}%</div>
          <div class="subj-quizzes">${s.quizzes} quiz${s.quizzes!==1?'zes':''}</div>`;
        sec3.appendChild(row);
      });
    body.appendChild(sec3);
  }

  /* — Recent Quizzes — */
  if (st.history.length > 0) {
    const sec4 = document.createElement('div');
    sec4.className = 'stats-section';
    sec4.innerHTML = `<div class="stats-section-title">🕐 Recent Quizzes</div>`;
    const hl = document.createElement('div');
    hl.className = 'history-list';
    st.history.slice(0, 10).forEach(h => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const lecShort = h.lecture.length > 38 ? h.lecture.substring(0,38)+'…' : h.lecture;
      const changeNote = (h.c2w||0)+(h.w2c||0) > 0
        ? ` · ✘${h.c2w||0} ✔${h.w2c||0} changes` : '';
      item.innerHTML = `
        <div class="h-top-row">
          <div>
            <div class="h-subject">${escapeHtml(subjectDisplayName(h.subject))}</div>
            <div class="h-lecture">${lecShort}</div>
            <div class="h-lecture">⏱ ${fmtTime(h.avgTime)}/q${changeNote} · ${h.date}</div>
          </div>
          <div class="h-score" style="color:${h.pct>=70?'var(--correct-fg)':'var(--wrong-fg)'}">${h.score}/${h.total}<br><span style="font-size:.8rem">(${h.pct}%)</span></div>
        </div>`;
      const wrongCount = (h.wrongQuestions || []).length;
const retakeBtn = document.createElement('button');
retakeBtn.style.cssText = 'display:block;width:100%;padding:5px 12px;border-radius:6px;border:none;background:var(--accent);color:white;font-weight:700;cursor:pointer;font-size:.8rem;opacity:' + (wrongCount > 0 ? '1' : '.4') + ';';
retakeBtn.textContent = `🔄 Retake ${wrongCount} wrong Q${wrongCount !== 1 ? 's' : ''}`;
retakeBtn.disabled = wrongCount === 0;
retakeBtn.onclick = (e) => { e.stopPropagation(); retakeSingleQuiz(h); };
item.appendChild(retakeBtn);
      hl.appendChild(item);
    });
    sec4.appendChild(hl);
    body.appendChild(sec4);
  }

  /* — Reset — */
  const rb = document.createElement('button');
  rb.className = 'stats-reset-btn';
  rb.textContent = '🗑  Reset All Statistics';
  rb.onclick = resetStats;
  body.appendChild(rb);
}
function retakeSingleQuiz(h) {
  const wrong = (h.wrongQuestions || []).filter(Boolean);
  closeStats();
  startRetakeQuiz(wrong);
}

function openRetake() {
  fsAwaitIfNeeded('stats', 'Loading your stats…');
  renderRetakeSelector();
  document.getElementById('retakeOverlay').classList.remove('hidden');
}

function closeRetake() {
  document.getElementById('retakeOverlay').classList.add('hidden');
  fsLoadingHide();
}

function renderRetakeSelector() {
  const st   = loadStats();
  const body = document.getElementById('retakeBody');
  body.innerHTML = '';

  if (!st.history.length) {
    body.innerHTML = '<div class="no-stats-box"><div class="ns-icon">📋</div>No quiz history yet. Complete a quiz first.</div>';
    return;
  }

  const info = document.createElement('p');
  info.style.cssText = 'color:var(--text-muted);font-size:.88rem;margin-bottom:12px;';
  info.textContent = 'Check one or more quizzes, then press the button to retake all their wrong questions combined.';
  body.appendChild(info);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  st.history.forEach((h, idx) => {
    const count = (h.wrongQuestions || []).length;
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;background:var(--surface-2);border:1px solid var(--border-soft-2);border-radius:8px;padding:10px 14px;cursor:' + (count > 0 ? 'pointer' : 'not-allowed') + ';opacity:' + (count > 0 ? '1' : '.5') + ';';
    const lecShort = h.lecture.length > 42 ? h.lecture.substring(0, 42) + '…' : h.lecture;
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" ${count === 0 ? 'disabled' : ''} style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;" />
      <div style="flex:1;">
        <div style="font-weight:700;font-size:.88rem;">${escapeHtml(subjectDisplayName(h.subject))}</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px;">${lecShort}</div>
        <div style="font-size:.78rem;margin-top:3px;">
          ${h.date} &nbsp;·&nbsp; Score ${h.score}/${h.total} (${h.pct}%)
          &nbsp;·&nbsp; <strong style="color:${count > 0 ? 'var(--wrong-fg)' : 'var(--text-muted)'}">${count} wrong</strong>
        </div>
      </div>`;
    list.appendChild(row);
  });

  body.appendChild(list);

  const selectAllRow = document.createElement('div');
  selectAllRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.style.cssText = 'flex:1;padding:8px;border-radius:6px;border:1.5px solid var(--accent);background:var(--surface-2-hover);color:var(--accent);font-weight:700;cursor:pointer;font-size:.85rem;';
  selectAllBtn.textContent = '☑ Select All';
  selectAllBtn.onclick = () => {
    document.querySelectorAll('#retakeBody input[type=checkbox]:not(:disabled)')
      .forEach(cb => cb.checked = true);
  };

  const clearBtn = document.createElement('button');
  clearBtn.style.cssText = 'flex:1;padding:8px;border-radius:6px;border:1.5px solid var(--border-soft);background:var(--surface-2);color:var(--text-muted);font-weight:700;cursor:pointer;font-size:.85rem;';
  clearBtn.textContent = '☐ Clear All';
  clearBtn.onclick = () => {
    document.querySelectorAll('#retakeBody input[type=checkbox]')
      .forEach(cb => cb.checked = false);
  };

  selectAllRow.appendChild(selectAllBtn);
  selectAllRow.appendChild(clearBtn);
  body.appendChild(selectAllRow);

  const retakeBtn = document.createElement('button');
  retakeBtn.className = 'btn btn-primary';
  retakeBtn.style.marginTop = '12px';
  retakeBtn.textContent = '🔄 Retake Selected Wrong Questions';
  retakeBtn.onclick = () => {
    const checked = [...document.querySelectorAll('#retakeBody input[type=checkbox]:checked')];
    if (!checked.length) return alert('Please select at least one quiz.');
    const allWrong = [];
    const seen = new Set();
    checked.forEach(cb => {
      const h = st.history[+cb.dataset.idx];
      (h.wrongQuestions || []).forEach(q => {
        if (q && !seen.has(q.question)) {
          seen.add(q.question);
          allWrong.push(q);
        }
      });
    });
    closeRetake();
    startRetakeQuiz(allWrong);
  };
  body.appendChild(retakeBtn);
}
