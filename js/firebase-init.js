import { runOneTimeMigrationIfNeeded } from './migration.js';
import { listCustomQuizzes, listQuizCollections, listAttempts } from './local-store.js';
import { firebaseConfig } from './config/firebase-config.js';

  import { initializeApp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc, onSnapshot, query, where }
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
  window._query            = query;
  window._where            = where;
  window._signInWithPopup  = signInWithPopup;
  window._signOut          = signOut;

  // Load admin-created years/modules/subjects, then admin-published questions.
  // (The admin permission roster is loaded separately, inside onAuthStateChanged
  // below, since it needs to be re-subscribed on every auth change — see there.)
  //
  // The "Loading curriculum…" / "Loading lectures…" toast previously only
  // ever appeared reactively, from inside selectYear()/selectSubject() —
  // i.e. only if the user happened to click into a year/subject WHILE
  // these loads were still in flight. But both loads actually start here,
  // unconditionally, the moment the page boots — before the user has
  // clicked anything — so the entire initial-load window (the most common
  // time curriculum genuinely IS loading, on the very Home screen the user
  // is looking at) had no visible indicator at all. Showing it proactively
  // here means it now covers that window too; fsAwaitIfNeeded() no-ops
  // immediately if the flag's already true (e.g. warm cache), so this
  // adds no visible flash on a fast load.
  fsAwaitIfNeeded('curriculum', 'Loading curriculum…');
  (async () => {
    await loadCurriculumExtensions();
    fsAwaitIfNeeded('published', 'Loading lectures…');
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

    // Custom quizzes, quiz collections, attempts, and stats all live
    // entirely in local storage (IndexedDB) now — never Firestore — and
    // that storage is per-device, not per-account, so it must be loaded
    // back into memory on EVERY page load/refresh regardless of sign-in
    // state. This used to sit inside the `if (user)` branch below, back
    // when signing in was what actually fetched this data from Firestore;
    // once everything moved to local storage that guard became a bug —
    // a signed-out (or not-yet-signed-in) user's custom quizzes/stats
    // still saved correctly to IndexedDB, but a refresh never read them
    // back into window._cachedCustomQuizzes etc., so the UI showed nothing
    // and it looked like the save had been lost. Loading it here, outside
    // the `if (user)` branch, fixes that for both signed-in and
    // signed-out use — see the matching comment on
    // window.loadStatsFromFirestore in js/app-core.js.
    _fsReady.stats         = false;
    _fsReady.customQuizzes = false;
    window._cachedCustomQuizzes = await listCustomQuizzes();
    window._cachedQuizCollections = await listQuizCollections();
    await window.loadStatsFromFirestore();
    window._quizAttempts = await listAttempts();
    _fsReady.customQuizzes = true;

    if (user) {
      // One-time, safe migration for existing users: pulls any of their
      // OLD Firestore-stored stats/custom quizzes down to local storage
      // first, confirms the write, THEN deletes the old Firestore copies.
      // Safe to re-run if interrupted; already-migrated users return
      // immediately ({ alreadyDone: true }) at essentially no cost.
      // Runs AFTER the local-storage load above so a migration that adds
      // data this visit is picked up by a second load, not raced against
      // the first one.
      const migrationResult = await runOneTimeMigrationIfNeeded(user.uid);
      if (migrationResult.errors && migrationResult.errors.length) {
        console.warn('Migration incomplete, will retry next visit:', migrationResult.errors);
      }
      if (migrationResult.customQuizzesPulled || migrationResult.statsPulled) {
        // Something old just got pulled down from Firestore — reload local
        // storage once more so it shows up immediately, without a refresh.
        window._cachedCustomQuizzes = await listCustomQuizzes();
        window._cachedQuizCollections = await listQuizCollections();
        await window.loadStatsFromFirestore();
        window._quizAttempts = await listAttempts();
      }

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
          .then(() => loadPublishedQuestionsIntoSubjects(true)); // skip throttle: backfill may have just changed the manifest
      }
    } else {
      window._userDisplayName = null;
    }
  });
