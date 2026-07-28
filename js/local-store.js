/* =============================================================================
   local-store.js

   Custom quizzes and stats/history live ENTIRELY here — IndexedDB, per
   device/account, never Firestore, never R2. This includes retake
   wrong-question snapshots (captured locally at submission time, at zero
   server cost).

   Depends on: window._idbGet / window._idbSet / window._idbDelete / window._idbList
   (existing IndexedDB helpers, extended here with a list-by-prefix helper
   if not already present in data-sync.js).
   ============================================================================= */

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * window._idbGet(key) (defined in data-sync.js) resolves directly to the
 * stored value itself (or null) — this is a thin pass-through, not a
 * { value } wrapper. This helper just documents/centralizes that shape so
 * call sites below read clearly and only change in one place if it ever does.
 */
async function _idbGetValue(key) {
  return window._idbGet(key).catch(() => null);
}

async function sha256HexOfString(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Content fingerprint used to detect exact-duplicate custom quizzes on import. */
async function fingerprintQuiz(quiz) {
  const normalized = JSON.stringify({ title: quiz.title, questions: quiz.questions });
  return sha256HexOfString(normalized);
}

// ---------------------------------------------------------------------------
// CUSTOM QUIZZES
// ---------------------------------------------------------------------------

export async function listCustomQuizzes() {
  const keys = await window._idbList('customQuiz:');
  const quizzes = [];
  for (const key of keys.keys || []) {
    const value = await _idbGetValue(key);
    if (value) quizzes.push(value);
  }
  return quizzes;
}

export async function saveCustomQuiz(quiz) {
  if (!quiz.id) quiz.id = newId();
  quiz.lastActivityAt = Date.now();
  await window._idbSet(`customQuiz:${quiz.id}`, quiz);
  return quiz;
}

export async function deleteCustomQuiz(id) {
  await window._idbDelete(`customQuiz:${id}`).catch(() => {});
}

/** Imports quizzes (from a file or P2P transfer), skipping exact-duplicate content. */
export async function importCustomQuizzes(incomingQuizzes) {
  const existing = await listCustomQuizzes();
  const existingFingerprints = new Set(await Promise.all(existing.map(fingerprintQuiz)));

  let added = 0, skipped = 0;
  for (const quiz of incomingQuizzes) {
    const fp = await fingerprintQuiz(quiz);
    if (existingFingerprints.has(fp)) { skipped++; continue; }
    const copy = { ...quiz, id: newId(), lastActivityAt: Date.now() }; // new local identity, full independent copy
    await window._idbSet(`customQuiz:${copy.id}`, copy);
    existingFingerprints.add(fp);
    added++;
  }
  return { added, skipped };
}

// ---------------------------------------------------------------------------
// STATS / HISTORY (aggregate + retake snapshots, all local)
// ---------------------------------------------------------------------------

export async function listAttempts() {
  const keys = await window._idbList('attempt:');
  const attempts = [];
  for (const key of keys.keys || []) {
    const value = await _idbGetValue(key);
    if (value) attempts.push(value);
  }
  return attempts;
}

/**
 * Records one completed quiz attempt. Accepts the app's existing entry
 * shape as-is (id, ts, subject, lecture, score, total, pct, avgTime, c2w,
 * w2c, date, wrongQuestions) so existing rendering/Retake code needs no
 * changes — only where this gets persisted has changed (local, not
 * Firestore). wrongQuestions already includes each question's image
 * inline (a plain local snapshot), since there's no 1MiB document limit
 * or per-document Firestore cost to work around anymore.
 */
export async function recordAttempt(entry) {
  await window._idbSet(`attempt:${entry.id}`, entry);
  return entry;
}

export async function deleteAttempt(id) {
  await window._idbDelete(`attempt:${id}`).catch(() => {});
}

// ---------------------------------------------------------------------------
// AGGREGATE STATS — incrementally maintained (exactly like the original
// design), NOT recomputed from history on every load. This preserves full
// precision (wrong vs unanswered, real time tracking) for normal,
// single-device use. Recomputation only happens during cross-device merge
// (see recomputeAggregateForMerge below), where it's unavoidably
// best-effort on a couple of fields — disclosed there, not hidden.
// ---------------------------------------------------------------------------

export async function getStatsAggregate() {
  return _idbGetValue('statsAggregate');
}

export async function saveStatsAggregate(aggregate) {
  await window._idbSet('statsAggregate', aggregate);
}

/**
 * Used ONLY when merging two devices' data (import/P2P) — recomputes a
 * fresh aggregate from the de-duplicated union of attempts, so combining
 * two devices' history can never double-count. Precision note, disclosed
 * rather than silently approximated: individual attempts don't store the
 * wrong/unanswered split or raw time-tracking separately (only score,
 * total, and an already-averaged time-per-question), so this recompute
 * treats every non-correct answer as "wrong" (folds unanswered into it)
 * and does not attempt to reconstruct total study time. This only affects
 * the merge path — normal single-device stats (via getStatsAggregate/
 * saveStatsAggregate above) stay fully precise, incremented exactly like
 * the original design, never recomputed this way.
 */
export function recomputeAggregateForMerge(attempts) {
  const st = {
    totalQuizzes: attempts.length, totalQuestions: 0,
    totalCorrect: 0, totalWrong: 0, totalUnanswered: 0,
    totalTimeSecs: 0, totalTimedQs: 0,
    correctToWrong: 0, wrongToCorrect: 0,
    totalScorePct: 0, bestScore: null, worstScore: null,
    subjectStats: {}
  };
  for (const a of attempts) {
    const score = a.score || 0;
    const total = a.total || 0;
    const pct = a.pct != null ? a.pct : (total ? Math.round(score / total * 100) : 0);
    st.totalQuestions += total;
    st.totalCorrect += score;
    st.totalWrong += (total - score); // unanswered folds into "wrong" here — see note above
    st.correctToWrong += a.c2w || 0;
    st.wrongToCorrect += a.w2c || 0;
    st.totalScorePct += pct;
    if (st.bestScore === null || pct > st.bestScore) st.bestScore = pct;
    if (st.worstScore === null || pct < st.worstScore) st.worstScore = pct;

    if (!st.subjectStats[a.subject]) st.subjectStats[a.subject] = { quizzes: 0, correct: 0, total: 0 };
    st.subjectStats[a.subject].quizzes++;
    st.subjectStats[a.subject].correct += score;
    st.subjectStats[a.subject].total += total;
  }
  return st;
}

/**
 * Safe merge for stats coming from import/P2P: union by attempt ID
 * (de-duplicating exact repeats), never merging pre-computed summary
 * numbers — always recomputed fresh from the combined raw list afterward.
 */
export async function importAttempts(incomingAttempts) {
  const existing = await listAttempts();
  const existingIds = new Set(existing.map(a => a.id));

  let added = 0, skipped = 0;
  for (const attempt of incomingAttempts) {
    if (existingIds.has(attempt.id)) { skipped++; continue; }
    await window._idbSet(`attempt:${attempt.id}`, attempt);
    existingIds.add(attempt.id);
    added++;
  }

  // Recompute + persist the aggregate from the full, de-duplicated set —
  // only if anything actually changed (skip the work on a no-op import).
  if (added > 0) {
    const allAttempts = await listAttempts();
    await saveStatsAggregate(recomputeAggregateForMerge(allAttempts));
  }

  return { added, skipped };
}

// ---------------------------------------------------------------------------
// EXPORT (for backup and manual transfer)
// ---------------------------------------------------------------------------

/**
 * @param {{ includeQuizzes?: boolean, includeStats?: boolean, quizIds?: string[] }} options
 */
export async function buildExportPayload({ includeQuizzes = true, includeStats = true, quizIds = null } = {}) {
  const payload = { __app: 'anu-msp-question-bank', __exportedAt: Date.now(), version: 1 };

  if (includeQuizzes) {
    let quizzes = await listCustomQuizzes();
    if (quizIds) quizzes = quizzes.filter(q => quizIds.includes(q.id));
    payload.customQuizzes = quizzes; // full content baked in, always self-contained
  }
  if (includeStats) {
    payload.attempts = await listAttempts();
  }
  return payload;
}

export function downloadExportFile(payload, filename = 'anu-msp-backup.json') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Validates + applies an imported payload (from a file or P2P transfer). */
export async function applyImportPayload(payload) {
  if (!payload || payload.__app !== 'anu-msp-question-bank') {
    throw new Error('This file doesn\u2019t look like a valid backup for this app.');
  }
  const results = { quizzes: { added: 0, skipped: 0 }, attempts: { added: 0, skipped: 0 } };
  if (Array.isArray(payload.customQuizzes)) {
    results.quizzes = await importCustomQuizzes(payload.customQuizzes);
  }
  if (Array.isArray(payload.attempts)) {
    results.attempts = await importAttempts(payload.attempts);
  }
  return results;
}

// ---------------------------------------------------------------------------
// BACKUP REMINDER
// ---------------------------------------------------------------------------

const LAST_BACKUP_KEY = 'lastBackupAt';
const ACTIVITY_SINCE_BACKUP_KEY = 'activitySinceBackup';

export function markBackedUp() {
  localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  localStorage.setItem(ACTIVITY_SINCE_BACKUP_KEY, '0');
}

export function noteActivity() {
  const n = parseInt(localStorage.getItem(ACTIVITY_SINCE_BACKUP_KEY) || '0', 10);
  localStorage.setItem(ACTIVITY_SINCE_BACKUP_KEY, String(n + 1));
}

function isHigherRiskPlatform() {
  // Best-effort heuristic only — user agents can misreport, and this may
  // need occasional upkeep as browsers change how they identify themselves.
  return /iPhone|iPad|iPod|Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
}

/** Returns true if a gentle backup reminder should be shown right now. */
export function shouldShowBackupReminder() {
  const last = parseInt(localStorage.getItem(LAST_BACKUP_KEY) || '0', 10);
  const activity = parseInt(localStorage.getItem(ACTIVITY_SINCE_BACKUP_KEY) || '0', 10);
  const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);

  const timeThreshold = isHigherRiskPlatform() ? 14 : 30;
  const activityThreshold = isHigherRiskPlatform() ? 15 : 30;

  return daysSince >= timeThreshold || activity >= activityThreshold;
}
