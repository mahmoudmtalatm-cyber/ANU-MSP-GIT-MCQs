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

/** Deletes every custom quiz on this device. Used only by the "replace"
 *  import mode, right before writing the incoming set — never called for
 *  a normal merge import. */
export async function clearCustomQuizzes() {
  const existing = await listCustomQuizzes();
  await Promise.all(existing.map(q => window._idbDelete(`customQuiz:${q.id}`).catch(() => {})));
}

/**
 * Imports quizzes (from an imported backup file).
 * @param {object[]} incomingQuizzes
 * @param {{ mode?: 'merge'|'replace' }} [options]
 *   - 'merge' (default): keep existing quizzes, skip exact-duplicate content.
 *   - 'replace': delete every existing custom quiz first, then import the
 *     incoming set as-is (still de-duplicating identical entries within
 *     the incoming batch itself, so a backup file with repeats doesn't
 *     create repeats).
 */
export async function importCustomQuizzes(incomingQuizzes, { mode = 'merge' } = {}) {
  if (mode === 'replace') await clearCustomQuizzes();

  const existing = mode === 'replace' ? [] : await listCustomQuizzes();
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
 * Used ONLY when merging in imported backup data — recomputes a
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

/** Deletes every recorded attempt + the aggregate on this device. Used
 *  only by the "replace" import mode, right before writing the incoming
 *  set — never called for a normal merge import. */
export async function clearAttempts() {
  const existing = await listAttempts();
  await Promise.all(existing.map(a => window._idbDelete(`attempt:${a.id}`).catch(() => {})));
  await window._idbDelete('statsAggregate').catch(() => {});
}

/**
 * Safe merge for stats coming from an imported backup.
 * @param {object[]} incomingAttempts
 * @param {{ mode?: 'merge'|'replace' }} [options]
 *   - 'merge' (default): union by attempt ID, de-duplicating exact repeats.
 *   - 'replace': delete every existing attempt + aggregate first, then
 *     import the incoming set as-is (still de-duplicated within the
 *     incoming batch by ID).
 * Never merges pre-computed summary numbers — the aggregate is always
 * recomputed fresh from the resulting raw list afterward.
 */
export async function importAttempts(incomingAttempts, { mode = 'merge' } = {}) {
  if (mode === 'replace') await clearAttempts();

  const existing = mode === 'replace' ? [] : await listAttempts();
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
  if (added > 0 || mode === 'replace') {
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

/** Validates a payload and reports what it contains, WITHOUT writing
 *  anything — used to drive the "what do you want to load, and how"
 *  confirmation step before applyImportPayload() actually runs. */
export function inspectImportPayload(payload) {
  if (!payload || payload.__app !== 'anu-msp-question-bank') {
    return { valid: false, hasQuizzes: false, hasStats: false, quizCount: 0, statsCount: 0 };
  }
  const hasQuizzes = Array.isArray(payload.customQuizzes) && payload.customQuizzes.length > 0;
  const hasStats = Array.isArray(payload.attempts) && payload.attempts.length > 0;
  return {
    valid: true,
    hasQuizzes, hasStats,
    quizCount: hasQuizzes ? payload.customQuizzes.length : 0,
    statsCount: hasStats ? payload.attempts.length : 0
  };
}

/**
 * Validates + applies an imported payload (from a backup file).
 * @param {object} payload
 * @param {{ mode?: 'merge'|'replace', includeQuizzes?: boolean, includeStats?: boolean }} [options]
 *   - mode: 'merge' (default, keeps existing data) or 'replace' (deletes
 *     this device's existing data of the included types first).
 *   - includeQuizzes / includeStats: which data types from the payload to
 *     actually apply — lets the user load just one when a backup contains
 *     both. Both default to true (apply everything present).
 */
export async function applyImportPayload(payload, { mode = 'merge', includeQuizzes = true, includeStats = true } = {}) {
  if (!payload || payload.__app !== 'anu-msp-question-bank') {
    throw new Error('This file doesn\u2019t look like a valid backup for this app.');
  }
  const results = { quizzes: { added: 0, skipped: 0 }, attempts: { added: 0, skipped: 0 } };
  if (includeQuizzes && Array.isArray(payload.customQuizzes)) {
    results.quizzes = await importCustomQuizzes(payload.customQuizzes, { mode });
  }
  if (includeStats && Array.isArray(payload.attempts)) {
    results.attempts = await importAttempts(payload.attempts, { mode });
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

// ---------------------------------------------------------------------------
// AI EXPLANATION CACHE (local-only — never Firestore, never in Backup/Export)
// ---------------------------------------------------------------------------
// Replaces the old Firestore-backed "shared explanation pool" (removed in
// build 78, which cost a read/write per explanation across every user).
// This cache lives entirely in this device's IndexedDB: nothing is ever
// sent to or read from a server for it, and it's deliberately excluded from
// buildExportPayload()/applyImportPayload() above — it doesn't travel with
// a backup, by design.
//
// Entries are keyed by a best-effort "slot" identity (quiz source + subject
// + lecture + question index — see _explainSlotKey in js/ai-features.js)
// rather than by the question's own content, so a minor edit to the
// question (e.g. an admin fixing a typo) doesn't just silently evict the
// cache. Instead, each entry also stores a content fingerprint taken at
// cache time; getCachedExplanation() compares that against the question's
// current fingerprint and reports a `stale` flag rather than deciding for
// the caller — the UI can then still show the (possibly slightly outdated)
// explanation instantly, at zero cost, alongside a "regenerate recommended"
// hint. If the slot identity itself doesn't hold steady (quiz retitled,
// reordered, or dynamically assembled each time — retakes, merged custom
// quizzes), this just falls back to a normal cache miss next time, exactly
// like a question that was never explained; nothing incorrect is ever shown.
const EXPLANATION_CACHE_PREFIX = 'explainCache:';
const EXPLANATION_CACHE_MAX_ENTRIES = 500; // oldest evicted first past this cap

/** Fingerprint of only the parts of a question that actually feed the AI prompt. */
export async function fingerprintQuestion(q) {
  const normalized = JSON.stringify({
    question: q.question || '',
    options: q.options || {},
    answer: q.answer || '',
    hasImage: !!q.image,
  });
  return sha256HexOfString(normalized);
}

/**
 * @param {string} slotKey - stable-ish identity for this question's slot
 * @param {string} liveHash - fingerprintQuestion() of the question as it exists right now
 * @returns {Promise<{text:string, html:string, stale:boolean}|null>}
 */
export async function getCachedExplanation(slotKey, liveHash) {
  const entry = await _idbGetValue(EXPLANATION_CACHE_PREFIX + slotKey);
  if (!entry) return null;
  return {
    text: entry.text || '',
    html: entry.html || '',
    stale: entry.contentHash !== liveHash,
  };
}

/** Saves/replaces the cached explanation for a slot, then prunes if over the cap. */
export async function saveCachedExplanation(slotKey, contentHash, text, html) {
  await window._idbSet(EXPLANATION_CACHE_PREFIX + slotKey, {
    contentHash, text, html, cachedAt: Date.now(),
  });
  _pruneExplanationCache().catch(() => {});
}

async function _pruneExplanationCache() {
  const { keys } = await window._idbList(EXPLANATION_CACHE_PREFIX);
  if (!keys || keys.length <= EXPLANATION_CACHE_MAX_ENTRIES) return;
  const entries = await Promise.all(keys.map(async k => ({ key: k, value: await _idbGetValue(k) })));
  entries.sort((a, b) => (a.value?.cachedAt || 0) - (b.value?.cachedAt || 0));
  const toDrop = entries.slice(0, entries.length - EXPLANATION_CACHE_MAX_ENTRIES);
  await Promise.all(toDrop.map(e => window._idbDelete(e.key).catch(() => {})));
}

/** Wipes every locally cached explanation on this device (e.g. a "Clear cache" control). */
export async function clearExplanationCache() {
  const { keys } = await window._idbList(EXPLANATION_CACHE_PREFIX);
  await Promise.all((keys || []).map(k => window._idbDelete(k).catch(() => {})));
}
