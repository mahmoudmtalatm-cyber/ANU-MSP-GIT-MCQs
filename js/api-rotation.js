/* ══════════════════════════════════════════════════════════
   SMART API KEY ROTATION ENGINE
   Sits on top of the API Key Manager (js/ai-features.js) and the
   Gemini request layer (js/gemini-uploads.js). This is the ONE place
   that decides:
     - when a key counts as "rate-limited" (3 consecutive HTTP 429s)
     - which key to rotate to next
     - what happens once every configured key is rate-limited
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

// How many *consecutive* 429s on one key before it's treated as rate-limited
// and rotation kicks in.
const API_ROTATION_429_THRESHOLD = 3;

// A rate-limited key is retried again automatically after this cooldown —
// Gemini's free-tier limits are per-minute/per-day and often clear on their
// own, so a key shouldn't stay excluded forever once it's been rested.
const API_ROTATION_COOLDOWN_MS = 60 * 1000;

// Per-key rotation state, id -> { consecutive429, rateLimitedAt, invalid }
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
    _apiRotationState[id] = { consecutive429: 0, rateLimitedAt: null, invalid: false };
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
   clear both the 429 streak and any rate-limited/invalid marking. */
function recordApiSuccess(id) {
  const st = _apiRotState(id);
  if (!st) return;
  const wasExcluded = st.rateLimitedAt || st.invalid;
  st.consecutive429 = 0;
  st.rateLimitedAt  = null;
  st.invalid        = false;
  if (wasExcluded) _broadcastRotationUI({ recoveredId: id });
}

/* Records one failed attempt for a key. `status` is the HTTP status Gemini
   returned (429, 401, 403, ...). Returns true if this failure just tipped
   the key over into "rate-limited" (i.e. rotation should happen now). */
function recordApiFailure(id, status) {
  const st = _apiRotState(id);
  if (!st) return false;
  if (status === 429) {
    st.consecutive429++;
    if (st.consecutive429 >= API_ROTATION_429_THRESHOLD && !st.rateLimitedAt) {
      st.rateLimitedAt = Date.now();
      return true; // just became rate-limited this call
    }
    return false;
  }
  // Any non-429 failure breaks a 429 streak (matches the pre-existing
  // behavior in callGeminiWithRetry for its own local counter).
  st.consecutive429 = 0;
  return false;
}

/* Marks a key as permanently invalid (bad/revoked API key — 401/403/
   API_KEY_INVALID) so rotation stops offering it, without waiting on the
   429 cooldown logic which doesn't apply to a broken key. */
function markKeyInvalid(id) {
  const st = _apiRotState(id);
  if (!st) return;
  st.invalid = true;
}

/* Whether a key is currently excluded from being picked as the "preferred"
   rotation target — either genuinely invalid, or rate-limited and still
   within its cooldown window. Cooldown expiry is lazy (checked here, not
   via a timer) so a key silently becomes eligible again the next time
   anyone asks, with no polling needed. */
function isKeyExcluded(id) {
  const st = _apiRotationState[id];
  if (!st) return false;
  if (st.invalid) return true;
  if (st.rateLimitedAt) {
    if (Date.now() - st.rateLimitedAt >= API_ROTATION_COOLDOWN_MS) {
      // Cooldown elapsed — give it another chance automatically.
      st.rateLimitedAt = null;
      st.consecutive429 = 0;
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

/* Small, UI-facing summary for one key — used to draw the "rate-limited"
   chip on its row in the API Key Manager. */
function getApiKeyStatusInfo(id) {
  const st = _apiRotationState[id];
  if (!st) return { excluded: false };
  if (st.invalid) return { excluded: true, reason: 'invalid' };
  if (st.rateLimitedAt && !isKeyExcluded(id)) return { excluded: false }; // cooldown just lapsed
  if (st.rateLimitedAt) return { excluded: true, reason: 'rate_limited' };
  return { excluded: false };
}

/* Picks the next key to rotate to, given the one currently in use.
   - Returns null if there's nothing to rotate to (0 or 1 keys total).
   - Prefers the next non-excluded key, walking forward from just after
     the current one (so a 3-key rotation cycles 1→2→3→1→2→3…).
   - If every key is currently excluded, it still returns the next key in
     line rather than giving up — see allKeysRateLimited() above for the
     "add another key" note this pairs with; a key can also be mid-way
     through its cooldown and start working again at any moment, so it's
     worth continuing to cycle instead of freezing on one. */
function pickNextApiKey(currentId) {
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

/* Shared "all keys are currently rate-limited" banner, shown inside the
   AI-tools progress boxes (ai-question-tools.js's _cqProgressStatusHTML)
   so anyone watching an active extraction/generation run sees it without
   needing to open the API Key Manager. Purely informational — the run
   itself keeps going, cycling through keys automatically. */
function _apiAllRateLimitedBannerHTML() {
  return `<div class="cq-status warning api-rotation-banner" style="margin-top:6px;">
    ⚠️ All your API keys are currently rate-limited by Google. This will keep automatically rotating between them and retrying — it may just be a little slower right now. Adding another API key (🔑 Manage APIs) will speed things back up as soon as you paste it in.
  </div>`;
}
