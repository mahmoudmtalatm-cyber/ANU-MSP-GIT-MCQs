/* =============================================================================
   migration.js

   Runs once per user, the next time their client loads after this update
   ships. Safely moves their EXISTING stats/custom-quiz data (currently
   live in Firestore, per the old architecture) to local storage.

   Hard rule followed throughout: never delete the old Firestore data
   until the local write is confirmed. Never touches curriculum data.
   Safe to re-run if interrupted (checks a completion flag first, and each
   step is independently idempotent).
   ============================================================================= */

import { saveCustomQuiz, recordAttempt, saveStatsAggregate } from './local-store.js';

const MIGRATION_FLAG_KEY = 'migratedToLocalStorage_v1';

export async function runOneTimeMigrationIfNeeded(uid) {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'done') return { alreadyDone: true };

  const result = { statsPulled: 0, customQuizzesPulled: 0, errors: [] };

  // --- Step 1: pull old custom quizzes from Firestore, write locally, confirm, then delete ---
  try {
    const oldQuizzesSnap = await window._getDocs(
      window._collection(window._db, 'users', uid, 'customQuizzes')
    );
    for (const docSnap of oldQuizzesSnap.docs) {
      const quiz = docSnap.data();
      // Legacy custom quizzes store images as an `imageUrl: firestore://...`
      // sentinel pointing at a Firestore subcollection, not inline — must
      // resolve these back to real image data BEFORE saving locally, or
      // the migrated copy would hold a dangling reference once that
      // Firestore subcollection is cleaned up a few lines below.
      await window.hydrateQuizImages(quiz.questions || []);

      const written = await saveCustomQuiz(quiz);
      if (!written || !written.id) throw new Error('Local write did not confirm for a custom quiz \u2014 aborting delete for this item.');
      // Confirmed written locally (with images fully resolved inline) —
      // now safe to remove the old Firestore copy AND its images subcollection.
      await deleteSubcollection(window._collection(docSnap.ref, 'images'));
      await window._deleteDoc(docSnap.ref);
      result.customQuizzesPulled++;
    }
  } catch (err) {
    result.errors.push(`Custom quizzes migration: ${err.message}`);
    // Do not proceed to delete anything further for this section if a step failed;
    // safe to retry entirely on next load since nothing here is destructive
    // until each individual item's local write is confirmed first.
  }

  // --- Step 2: pull old stats/history (old #55-era per-quiz-document + manifest architecture) ---
  try {
    const statsDocSnap = await window._getDoc(window._doc(window._db, 'stats', uid));
    if (statsDocSnap.exists()) {
      const oldStats = statsDocSnap.data();

      // Old architecture kept per-quiz history documents under a subcollection.
      const historySnap = await window._getDocs(
        window._collection(window._db, 'stats', uid, 'statsHistory')
      );

      for (const historyDoc of historySnap.docs) {
        const old = historyDoc.data();
        // Preserve what maps cleanly to the new aggregate-only shape.
        // NOTE: old per-question wrong-answer image/text detail from the
        // pre-this-update format cannot be perfectly carried into the new
        // local retake-snapshot format (different shape) — this is
        // intentional and disclosed, not silently dropped: only the
        // aggregate score/date/subject/counts are preserved for old
        // entries; retake snapshots start fresh from this point forward.
        const written = await recordAttempt({
          id: `${historyDoc.id}`,
          ts: old.ts || Date.now(),
          subject: old.subject,
          lecture: old.lecture || old.lectureName,
          score: old.score,
          total: old.total,
          pct: old.pct,
          avgTime: old.avgTime,
          c2w: old.c2w,
          w2c: old.w2c,
          date: old.date || new Date().toLocaleDateString(),
          // Old per-question wrong-answer image/text detail from the
          // pre-this-update format cannot be perfectly carried into the
          // new local retake-snapshot format (different shape) — this is
          // intentional and disclosed, not silently dropped: aggregate
          // score/date/subject/counts are preserved for old entries;
          // retake snapshots start fresh from this point forward.
          wrongQuestions: []
        });
        if (!written || !written.id) throw new Error('Local write did not confirm for a stats entry \u2014 aborting delete for this item.');

        // Confirmed written locally — now safe to remove the old per-quiz
        // Firestore document AND its image/fullImages subcollections.
        await deleteSubcollection(window._collection(historyDoc.ref, 'images'));
        await deleteSubcollection(window._collection(historyDoc.ref, 'fullImages'));
        await window._deleteDoc(historyDoc.ref);
        result.statsPulled++;
      }

      // Whole old stats/{uid} doc — its aggregate fields (totalQuizzes,
      // totalCorrect, bestScore, etc.) were ALREADY correct, incrementally
      // maintained totals under the old design; they don't need
      // recomputing, just copying over as-is. historyManifest/history
      // themselves are old-architecture-specific and not needed (history
      // now lives as individual local attempt records, migrated above).
      const { historyManifest, history, ...aggregateFields } = oldStats;
      await saveStatsAggregate(aggregateFields);

      // Only now — aggregate saved locally AND every history entry above
      // confirmed migrated — is it safe to remove the old Firestore doc.
      await window._deleteDoc(statsDocSnap.ref);
    }
  } catch (err) {
    result.errors.push(`Stats migration: ${err.message}`);
  }

  if (result.errors.length === 0) {
    localStorage.setItem(MIGRATION_FLAG_KEY, 'done');
  }
  // If there were errors, the flag is deliberately NOT set, so this safely
  // retries on the user's next visit rather than being left half-migrated.

  return result;
}

async function deleteSubcollection(collectionRef) {
  const snap = await window._getDocs(collectionRef);
  for (const d of snap.docs) {
    await window._deleteDoc(d.ref).catch(() => {});
  }
}
