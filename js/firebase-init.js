import { firebaseConfig } from './config/firebase-config.js';

  import { initializeApp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


  // Config lives in ./config/firebase-config.js (git-ignored — copy
  // config/firebase-config.example.js and fill in your own project's keys).

  // Initialize Firebase
  const app     = initializeApp(firebaseConfig);
  const auth    = getAuth(app);
  const db      = getFirestore(app);
  // Expose to the rest of your app's scripts
  window._auth             = auth;
  window._db               = db;
  window._GoogleProvider   = new GoogleAuthProvider();
  window._doc              = doc;
  window._getDoc           = getDoc;
  window._setDoc           = setDoc;
  window._collection       = collection;
  window._getDocs          = getDocs;
  window._deleteDoc        = deleteDoc;
  window._onSnapshot       = onSnapshot;
  window._signInWithPopup  = signInWithPopup;
  window._signOut          = signOut;

  // Load admin-created years/modules/subjects, then admin-published questions.
  // (The admin permission roster is loaded separately, inside onAuthStateChanged
  // below, since it needs to be re-subscribed on every auth change — see there.)
  (async () => {
    await loadCurriculumExtensions();
    await loadPublishedQuestionsIntoSubjects();
    loadCustomIconsFromServer();
  })();

  // Watch login state — fires immediately on page load
  onAuthStateChanged(auth, async user => {
    window._currentUser = user || null;
    updateAuthUI(user);

    // Re-subscribe to the admin roster every time auth state settles (not just
    // once at page load). onAuthStateChanged fires immediately with whatever
    // stale/empty state is available, then fires again once Firebase Auth has
    // actually finished restoring the session — that second firing is what a
    // fresh sign-in needs in order to get a correctly-authenticated roster
    // listener instead of being stuck with a permission-denied one forever.
    await loadAdminRoster();
    updateAuthUI(window._currentUser);

    if (user) {
      // Mark as loading before the async calls so fsAwaitIfNeeded shows the spinner
      _fsReady.stats         = false;
      _fsReady.customQuizzes = false;
      loadStatsFromFirestore();
      loadCustomQuizzesFromFirestore();
      // Pre-load display name so sharing feels instant
      try {
        const ref  = window._doc(window._db, 'userProfiles', user.uid);
        const snap = await window._getDoc(ref);
        if (snap.exists() && snap.data().displayName) {
          window._userDisplayName = snap.data().displayName;
        } else {
          window._userDisplayName = null;
        }
      } catch(e) { window._userDisplayName = null; }

      // Manifest backfill needs admin write access to appConfig (same rule
      // as cacheVersion), so only attempt it once we've confirmed this user
      // is an admin. Re-load published questions afterward so any lectures
      // the backfill just discovered show up immediately, without a refresh.
      if (isAdminUser(user)) {
        _backfillManifestIfNeeded()
          .then(() => _backfillLectureOrderIfNeeded())
          .then(() => loadPublishedQuestionsIntoSubjects());
      }
    } else {
      // No user — nothing to load from Firestore, mark as ready immediately
      window._cachedStats = null;
      window._userDisplayName = null;
      _fsReady.customQuizzes = true;
      _fsReady.stats = true;
    }
  });
