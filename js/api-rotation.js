/* ══════════════════════════════════════════════════════════
   SMART API KEY ROTATION ENGINE
   Sits on top of the API Key Manager (js/ai-features.js) and the
   Gemini request layer (js/gemini-uploads.js). This is the ONE place
   that decides:
     - when a key counts as excluded — either "rate-limited" (3
       consecutive HTTP 429s) or "model error" (3 consecutive plain
       HTTP 400s that aren't a key-error) — both use the same
       3-strikes threshold and cooldown, just tracked as separate
       streaks and labeled differently in the UI
     - which key to rotate to next
     - what happens once every configured key is excluded
     - how the UI (badges, quick buttons, the Manager modal) finds out
       a rotation just happened, so they can update live

   Design notes:
   - All state here is in-memory only (per browser tab/session) and is
     keyed by API key id, not by position — so adding/removing/editing
     keys elsewhere never desyncs this from the real key list.
   - Nothing in this file ever touches the request/response bodies
     themselves — that stays in callGeminiWithRetry (gemini-uploads.js),
     which calls into the functions below at the right moments.
   - Every lookup here reads the live key list via loadApiKeys() (which
     reads straight from localStorage) instead of caching it, so a key
     added mid-run is available to the very next rotation decision —
     no extra wiring needed for "pick up new keys instantly".
══════════════════════════════════════════════════════════ */

// Persisted on/off switch for the whole rotation engine. Defaults to ON
// (matches every previous version's always-on behavior) so upgrading
// existing users never silently changes anything. Turning it off doesn't
// touch key health tracking or the status chips — it only stops
// pickNextApiKey() from ever handing back a key to switch to, which is
// the single choke point every rotation decision in the app goes through
// (see callGeminiWithRetry -> _tryRotate in js/gemini-uploads.js). With
// it off, a rate-limited/invalid key just fails and retries/backs off on
// itself, exactly like a single-key setup always has.
const SMART_ROTATION_ENABLED_STORE = 'anu_msp_smart_rotation_enabled_v1';

function isSmartRotationEnabled() {
  try {
    const raw = localStorage.getItem(SMART_ROTATION_ENABLED_STORE);
    return raw === null ? true : raw === '1';
  } catch (e) { return true; }
}

function setSmartRotationEnabled(enabled) {
  try { localStorage.setItem(SMART_ROTATION_ENABLED_STORE, enabled ? '1' : '0'); } catch (e) {}
  bumpApiKeysGeneration(); // wake any sleeping retry loop so it re-checks immediately
  _broadcastRotationUI({ rotationToggled: true, enabled: !!enabled });
}

// How many *consecutive* failures of ONE kind (429s, or plain 400s) on one
// key before it's treated as excluded and rotation kicks in. Both kinds
// share this same threshold and the same cooldown below — they're tracked
// as independent streaks (see _apiRotState) purely so the UI can label
// *why* a key got excluded ("Rate-limited" vs "Model error") without
// changing when rotation actually triggers.
const API_ROTATION_FAILURE_THRESHOLD = 3;

// An excluded key is retried again automatically after this cooldown —
// Gemini's free-tier rate limits are per-minute/per-day and often clear on
// their own, and a run of model errors can also just be transient, so a
// key shouldn't stay excluded forever once it's been rested.
const API_ROTATION_COOLDOWN_MS = 60 * 1000;

// Per-key rotation state, id -> { consecutive429, consecutive400,
// excludedAt, excludedReason: 'rate_limited'|'model_error'|null, invalid }
let _apiRotationState = Object.create(null);

// Bumped any time the key list itself changes (add/remove/edit) so an
// in-flight retry loop that's sleeping between attempts can wake up early
// instead of waiting out its full backoff before noticing a new key exists.
let _apiKeysGeneration = 0;
function bumpApiKeysGeneration() { _apiKeysGeneration++; }
function getApiKeysGeneration() { return _apiKeysGeneration; }

function _apiRotState(id) {
  if (!id) return null;
  if (!_apiRotationState[id]) {
    _apiRotationState[id] = {
      consecutive429: 0, consecutive400: 0,
      excludedAt: null, excludedReason: null,
      invalid: false
    };
  }
  return _apiRotationState[id];
}

/* Wipes rotation state for a key entirely — call whenever a key is deleted
   or its value is edited, since old failure history no longer applies. */
function clearKeyRotationState(id) {
  if (id && _apiRotationState[id]) delete _apiRotationState[id];
  bumpApiKeysGeneration();
}

/* A successful response always means the key is healthy right now —
   clear every failure streak and any excluded/invalid marking. */
function recordApiSuccess(id) {
  const st = _apiRotState(id);
  if (!st) return;
  const wasExcluded = st.excludedAt || st.invalid;
  st.consecutive429  = 0;
  st.consecutive400  = 0;
  st.excludedAt      = null;
  st.excludedReason  = null;
  st.invalid         = false;
  if (wasExcluded) _broadcastRotationUI({ recoveredId: id });
}

/* Records one failed attempt for a key. `status` is the HTTP status Gemini
   returned (429, 400, 401, 403, ...). 429s and plain 400s (never key-error
   400s — those go through markKeyInvalid instead, see callGeminiWithRetry)
   are tracked as two independent consecutive streaks, each using the same
   3-strikes threshold and cooldown, just recorded under a different
   `excludedReason` so the UI can say which one actually happened. A streak
   of one kind is unaffected by an isolated failure of the other kind, but
   two different failure kinds never combine into a single streak.
   Returns true if this failure just tipped the key over into "excluded"
   (i.e. rotation should happen now). */
function recordApiFailure(id, status) {
  const st = _apiRotState(id);
  if (!st) return false;
  if (status === 429) {
    st.consecutive429++;
    if (st.consecutive429 >= API_ROTATION_FAILURE_THRESHOLD && !st.excludedAt) {
      st.excludedAt     = Date.now();
      st.excludedReason = 'rate_limited';
      return true; // just became excluded this call
    }
    return false;
  }
  if (status === 400) {
    st.consecutive400++;
    if (st.consecutive400 >= API_ROTATION_FAILURE_THRESHOLD && !st.excludedAt) {
      st.excludedAt     = Date.now();
      st.excludedReason = 'model_error';
      return true; // just became excluded this call
    }
    return false;
  }
  // Any other failure kind breaks both streaks (matches the pre-existing
  // "a non-429 failure resets the 429 streak" behavior).
  st.consecutive429 = 0;
  st.consecutive400 = 0;
  return false;
}

/* Marks a key as permanently invalid (bad/revoked API key — 401/403/
   API_KEY_INVALID) so rotation stops offering it, without waiting on the
   cooldown logic which doesn't apply to a broken key. */
function markKeyInvalid(id) {
  const st = _apiRotState(id);
  if (!st) return;
  st.invalid = true;
}

/* Whether a key is currently excluded from being picked as the "preferred"
   rotation target — either genuinely invalid, or rate-limited/model-error
   and still within its cooldown window. Cooldown expiry is lazy (checked
   here, not via a timer) so a key silently becomes eligible again the next
   time anyone asks, with no polling needed. */
function isKeyExcluded(id) {
  const st = _apiRotationState[id];
  if (!st) return false;
  if (st.invalid) return true;
  if (st.excludedAt) {
    if (Date.now() - st.excludedAt >= API_ROTATION_COOLDOWN_MS) {
      // Cooldown elapsed — give it another chance automatically.
      st.excludedAt      = null;
      st.excludedReason  = null;
      st.consecutive429  = 0;
      st.consecutive400  = 0;
      return false;
    }
    return true;
  }
  return false;
}

/* True once every configured key is currently excluded — this is the
   "we're completely out of usable keys right now" state that should
   surface a persistent "add another API key" note in the UI. */
function allKeysRateLimited() {
  const keys = loadApiKeys();
  if (!keys.length) return false;
  return keys.every(k => isKeyExcluded(k.id));
}

/* Small, UI-facing summary for one key — used to draw the status chip
   (Invalid / Rate-limited / Model error) on its row in the API Key
   Manager. */
function getApiKeyStatusInfo(id) {
  const st = _apiRotationState[id];
  if (!st) return { excluded: false };
  if (st.invalid) return { excluded: true, reason: 'invalid' };
  if (st.excludedAt && !isKeyExcluded(id)) return { excluded: false }; // cooldown just lapsed
  if (st.excludedAt) return { excluded: true, reason: st.excludedReason };
  return { excluded: false };
}

/* Picks the next key to rotate to, given the one currently in use.
   - Returns null if there's nothing to rotate to (0 or 1 keys total).
   - Prefers the next non-excluded key, walking forward from just after
     the current one (so a 3-key rotation cycles 1→2→3→1→2→3…).
   - If every key is currently excluded (rate-limited, hitting model
     errors, or invalid), it still returns the next key in line rather
     than giving up — see allKeysRateLimited() below for the "add another
     key" note this pairs with; an excluded key can also come out of its
     cooldown and start working again at any moment, so it's worth
     continuing to cycle instead of freezing on one. */
function pickNextApiKey(currentId) {
  if (!isSmartRotationEnabled()) return null;
  const keys = loadApiKeys();
  if (keys.length < 2) return null;
  const idx = Math.max(0, keys.findIndex(k => k.id === currentId));
  const ordered = keys.slice(idx + 1).concat(keys.slice(0, idx + 1)).filter(k => k.id !== currentId);
  const healthy = ordered.find(k => !isKeyExcluded(k.id));
  return healthy || ordered[0] || null;
}

/* Refreshes every piece of UI that shows "which key is active right now"
   — the API Key Manager modal (if open), the small per-question quick
   buttons, and the inline badges shown in the Custom Quizzes modal — then
   tells the rest of the app a rotation happened via a DOM event, in case
   anything else wants to react to it. Safe to call at any time; every
   piece here already no-ops if its element isn't currently in the DOM. */
function _broadcastRotationUI(detail) {
  try { if (typeof _refreshApiKeyQuickButtons === 'function') _refreshApiKeyQuickButtons(); } catch (e) {}
  try {
    const overlay = document.getElementById('apiKeyOverlay');
    if (overlay && !overlay.classList.contains('hidden') && typeof renderApiKeyManager === 'function') {
      renderApiKeyManager();
    }
  } catch (e) {}
  try {
    document.querySelectorAll('.cq-api-badge-slot').forEach(slot => {
      if (typeof renderCqApiKeyBadge === 'function') slot.innerHTML = renderCqApiKeyBadge();
    });
  } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('apiKeyRotated', { detail: detail || {} })); } catch (e) {}
}

/* Shared "all keys are currently excluded" banner, shown inside the
   AI-tools progress boxes (ai-question-tools.js's _cqProgressStatusHTML)
   so anyone watching an active extraction/generation run sees it without
   needing to open the API Key Manager. Purely informational — the run
   itself keeps going, cycling through keys automatically. Wording stays
   generic ("issues") since the underlying cause could be rate limits on
   some keys and repeated model errors on others at the same time. */
function _apiAllRateLimitedBannerHTML() {
  const msg = isSmartRotationEnabled()
    ? `⚠️ All your API keys are currently hitting issues (rate limits and/or model errors). This will keep automatically rotating between them and retrying — it may just be a little slower right now. Adding another API key (🔑 Manage APIs) will speed things back up as soon as you paste it in.`
    : `⚠️ All your API keys are currently hitting issues (rate limits and/or model errors), and Smart Rotation is off, so the app is retrying on the same key instead of switching. Turn Smart Rotation back on in 🔑 Manage APIs, or add another key, to speed things back up.`;
  return `<div class="cq-status warning api-rotation-banner" style="margin-top:6px;">${msg}</div>`;
}
