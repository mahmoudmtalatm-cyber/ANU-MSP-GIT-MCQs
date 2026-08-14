/* ══════════════════════════════════════════════════════════
   API KEY MANAGER — multiple Gemini API keys, one active
   Single shared place used by AI explanations, chat, and
   custom quizzes (extract / generate / AI-answer / AI-solve).
══════════════════════════════════════════════════════════ */

const AI_EXPLAIN_KEY_STORE = 'anu_msp_gemini_api_key'; // legacy single-key store (used for migration only)
const API_KEYS_STORE = 'anu_msp_gemini_api_keys_v2'; // [{id,label,key,color}]
const API_ACTIVE_ID_STORE = 'anu_msp_gemini_active_key_id_v2';

const API_KEY_COLORS = ['var(--accent)','#8E24AA','#43A047','#FB8C00','#E53935','#00897B','#5E35B1','#D81B60','#3949AB','#6D4C41'];

let _apiKeyPendingCallback = null; // callback to resume once a key becomes active

function _apiKeyNewId() { return 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* Picks a random color for a new API key, preferring one not already used
   by an existing key so entries stay visually distinct. Falls back to a
   fully random color from the palette once every color is already taken. */
function _pickRandomApiKeyColor(usedColors) {
  usedColors = usedColors || [];
  const available = API_KEY_COLORS.filter(c => !usedColors.includes(c));
  const pool = available.length ? available : API_KEY_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function loadApiKeys() {
  try {
    const raw = localStorage.getItem(API_KEYS_STORE);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
  } catch (e) {}
  // One-time migration from the old single-key store
  try {
    const legacy = (localStorage.getItem(AI_EXPLAIN_KEY_STORE) || '').trim();
    if (legacy) {
      const id = _apiKeyNewId();
      const arr = [{ id, label: 'API 1', key: legacy, color: API_KEY_COLORS[0] }];
      saveApiKeys(arr);
      setActiveApiKeyId(id);
      return arr;
    }
  } catch (e) {}
  return [];
}
function saveApiKeys(arr) {
  try { localStorage.setItem(API_KEYS_STORE, JSON.stringify(arr)); } catch (e) {}
}
function getActiveApiKeyId() {
  try { return localStorage.getItem(API_ACTIVE_ID_STORE) || ''; } catch (e) { return ''; }
}
function setActiveApiKeyId(id) {
  try { localStorage.setItem(API_ACTIVE_ID_STORE, id || ''); } catch (e) {}
}
/* Returns the currently active key STRING (empty if none configured). */
function getActiveApiKey() {
  const keys = loadApiKeys();
  if (!keys.length) return '';
  const activeId = getActiveApiKeyId();
  let found = keys.find(k => k.id === activeId);
  if (!found) { found = keys[0]; setActiveApiKeyId(found.id); }
  return (found.key || '').trim();
}
function getActiveApiKeyEntry() {
  const keys = loadApiKeys();
  if (!keys.length) return null;
  const activeId = getActiveApiKeyId();
  return keys.find(k => k.id === activeId) || keys[0] || null;
}
/* Reverse lookup used by the rotation engine (js/api-rotation.js) — given
   the raw key string a request was actually sent with, find which stored
   entry it belongs to, so 429/success outcomes get recorded against the
   right id even though callGeminiWithRetry only ever sees the raw string. */
function _findKeyIdByValue(key) {
  if (!key) return null;
  const found = loadApiKeys().find(k => k.key === key);
  return found ? found.id : null;
}
function addApiKey(key, label, color) {
  key = (key || '').trim();
  if (!key) return null;
  const keys = loadApiKeys();
  const id = _apiKeyNewId();
  color = color || _pickRandomApiKeyColor(keys.map(k => k.color));
  // Auto-number new keys as "API N" — N is the next free number, so it stays
  // correct even after earlier keys were deleted or renamed.
  const usedNums = keys
    .map(k => /^API (\d+)$/.exec(k.label))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  const nextNum = usedNums.length ? Math.max(...usedNums) + 1 : keys.length + 1;
  keys.push({ id, label: (label || '').trim() || `API ${nextNum}`, key, color });
  saveApiKeys(keys);
  if (keys.length === 1) setActiveApiKeyId(id); // first key added becomes active automatically
  // A new key is immediately visible to the rotation engine (it always
  // reads the live key list), but this also wakes any request that's
  // currently sleeping between retries with nothing to rotate to — so a
  // key pasted in mid-run gets picked up right away instead of waiting
  // out the rest of that backoff first. See js/api-rotation.js.
  if (typeof bumpApiKeysGeneration === 'function') bumpApiKeysGeneration();
  return id;
}
function removeApiKeyById(id) {
  let keys = loadApiKeys();
  keys = keys.filter(k => k.id !== id);
  saveApiKeys(keys);
  if (getActiveApiKeyId() === id) {
    setActiveApiKeyId(keys.length ? keys[0].id : '');
  }
  if (typeof clearKeyRotationState === 'function') clearKeyRotationState(id);
}
function renameApiKey(id, label) {
  const keys = loadApiKeys();
  const k = keys.find(x => x.id === id);
  if (k) { k.label = (label || '').trim() || k.label; saveApiKeys(keys); }
}
function updateApiKeyValue(id, newKey) {
  const keys = loadApiKeys();
  const k = keys.find(x => x.id === id);
  if (k) { k.key = newKey; saveApiKeys(keys); }
  // The key's value changed, so any rate-limited/invalid history recorded
  // against this id no longer applies — give it a clean slate, and let any
  // sleeping retry loop know something changed.
  if (typeof clearKeyRotationState === 'function') clearKeyRotationState(id);
}
function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  const dots = Math.min(12, Math.max(4, key.length - 8));
  return key.slice(0, 4) + '•'.repeat(dots) + key.slice(-4);
}

/* Small " API" button shown under each reviewed question, for quick
   access to the API Key Manager without scrolling back to the top. */
function _apiKeyQuickBtnHTML() {
  const entry = getActiveApiKeyEntry();
  if (!entry) return '<svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Add API Key';
  return `<span class="apikey-dot" style="background:${entry.color || 'var(--accent)'};"></span> ${escapeHtml(entry.label)}`;
}
function _refreshApiKeyQuickButtons() {
  document.querySelectorAll('.ai-apikey-btn').forEach(btn => {
    btn.innerHTML = _apiKeyQuickBtnHTML();
  });
}

/* ── Legacy wrappers (kept so existing call sites keep working) ── */
function getExplainKey() { return getActiveApiKey(); }
function getGeminiKey() { return getActiveApiKey(); }
/* No-op setters: key editing now only happens through the API Key Manager. */
function setExplainKey() {}
function setGeminiKey() {}

/* ── Open / close the manager modal ── */
function openApiKeyManager(pendingCallback) {
  _apiKeyPendingCallback = pendingCallback || null;
  document.getElementById('apiKeyOverlay').classList.remove('hidden');
  renderApiKeyManager();
}
function closeApiKeyManager() {
  document.getElementById('apiKeyOverlay').classList.add('hidden');
  _apiKeyEditingId = null;
  // If something was waiting on a key becoming available, resume it now.
  if (_apiKeyPendingCallback && getActiveApiKey()) {
    const cb = _apiKeyPendingCallback;
    _apiKeyPendingCallback = null;
    cb();
  } else {
    _apiKeyPendingCallback = null;
  }
}
function useApiKey(id) {
  const keyIsChanging = id !== getActiveApiKeyId();
  // Switching keys is always safe if it's already the active one, or if
  // nothing AI-related is actually running right now.
  if (keyIsChanging) {
    const activeLabel = _activeAiProcessLabel();
    if (activeLabel) {
      const confirmed = confirm(
        `You're currently ${activeLabel}. Switching your active API key now will forcibly abort that process immediately — anything not already completed will be lost.\n\nAbort it and switch keys?`
      );
      if (!confirmed) return;
      _stopAllAiProcesses();
    }
  }

  setActiveApiKeyId(id);
  // A manual switch should behave exactly like opening the site fresh: try
  // the primary model first, and only fall back if that key actually needs
  // it. Without this, a key that never had trouble would still inherit
  // whatever model an earlier key had fallen back to. Auto-rotation resets
  // this the same way — see resetGeminiModelResolution() in
  // js/gemini-uploads.js.
  if (keyIsChanging && typeof resetGeminiModelResolution === 'function') resetGeminiModelResolution();
  renderApiKeyManager();
  // Refresh any inline "manage keys" widgets that might be open behind the modal
  if (typeof renderCustomQuizModal === 'function' && document.getElementById('customQuizBody')) {
    try { renderCustomQuizModal(); } catch (e) {}
  }
}
function deleteApiKeyPrompt(id, label) {
  if (!confirm(`Remove "${label}"? This cannot be undone.`)) return;
  removeApiKeyById(id);
  renderApiKeyManager();
}
function apiKeyLabelChanged(id, value) {
  renameApiKey(id, value);
}

function submitNewApiKey() {
  const valueInp = document.getElementById('apikeyValueInput');
  const key = (valueInp ? valueInp.value : '').trim();
  if (!key) { if (valueInp) valueInp.style.borderColor = 'var(--wrong-fg)'; return; }

  // Name and colour are always auto-assigned — the user has no control over them.
  addApiKey(key, '', null);
  renderApiKeyManager();
}

// Which key (if any) is currently in inline edit mode
let _apiKeyEditingId = null;

/* Switches a key's row into edit mode — always reachable via the button
   so an existing key's value can be updated any time, without deleting and
   re-adding it. */
function startEditApiKey(id) {
  _apiKeyEditingId = id;
  renderApiKeyManager();
  setTimeout(() => {
    const inp = document.getElementById('apikeyEditInput_' + id);
    if (inp) { inp.focus(); inp.select(); }
  }, 30);
}
function cancelEditApiKey() {
  _apiKeyEditingId = null;
  renderApiKeyManager();
}
function submitEditApiKey(id) {
  const inp = document.getElementById('apikeyEditInput_' + id);
  const newKey = (inp ? inp.value : '').trim();
  if (!newKey) { if (inp) inp.style.borderColor = 'var(--wrong-fg)'; return; }

  updateApiKeyValue(id, newKey);
  _apiKeyEditingId = null;
  renderApiKeyManager();
}
function toggleApiKeyVisibility(btn, id) {
  const span = document.getElementById('apikeyMasked_' + id);
  if (!span) return;
  const keys = loadApiKeys();
  const entry = keys.find(k => k.id === id);
  if (!entry) return;
  const label = btn.querySelector('.apikey-toggle-label');
  if (span.dataset.shown === '1') {
    span.textContent = maskApiKey(entry.key);
    span.dataset.shown = '0';
    btn.classList.remove('apikey-toggle-on');
    if (label) label.textContent = 'Show';
  } else {
    span.textContent = entry.key;
    span.dataset.shown = '1';
    btn.classList.add('apikey-toggle-on');
    if (label) label.textContent = 'Hide';
  }
}

function renderApiKeyManager() {
  const body = document.getElementById('apiKeyManagerBody');
  if (!body) return;
  const keys = loadApiKeys();
  const activeId = getActiveApiKeyId();

  let html = '';

  if (_apiKeyPendingCallback) {
    html += `<div class="apikey-pending-note"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Pick or add an API key below, then close this window to continue.</div>`;
  }

  if (typeof allKeysRateLimited === 'function' && allKeysRateLimited()) {
    const rotationOn = (typeof isSmartRotationEnabled !== 'function') || isSmartRotationEnabled();
    html += rotationOn
      ? `<div class="apikey-pending-note apikey-allrl-note"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> All your keys are currently rate-limited by Google. The app keeps rotating between them and retrying automatically — adding one more key below will get things moving at full speed again.</div>`
      : `<div class="apikey-pending-note apikey-allrl-note"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> All your keys are currently rate-limited by Google, and Smart Rotation is off below, so requests keep retrying on the same key. Turn it back on, or add another key, to get moving again.</div>`;
  }

  html += `<div class="cq-help-box">
    <strong>How to get a free Gemini API key:</strong>
    <ol>
      <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></li>
      <li>Sign in with your Google account</li>
      <li>Click <strong>"Create API key"</strong> (choose or create a project if asked)</li>
      <li>Copy the generated key and paste it below</li>
    </ol>
    You can add several keys — e.g. one per Google account — and switch between them any time. Your keys are saved only in this browser and are sent directly to Google's API, never through any other server. Only Gemini API keys are supported.
  </div>`;

  const rotationOn = (typeof isSmartRotationEnabled !== 'function') || isSmartRotationEnabled();
  html += `<div class="rotation-toggle-card ${rotationOn ? 'rotation-on' : ''}">
    <div class="rotation-toggle-info">
      <div class="rotation-toggle-title"><span class="rotation-toggle-icon"><svg class="hicon" style="width:16px;height:16px;" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></span> Smart Rotation</div>
      <div class="rotation-toggle-desc">${rotationOn
        ? 'On — when a key gets rate-limited or fails, the app automatically switches to your next key.'
        : 'Off — the app stays on your active key and retries it, even if others are available.'}</div>
    </div>
    <label class="rotation-switch" title="${rotationOn ? 'Turn off Smart Rotation' : 'Turn on Smart Rotation'}">
      <input type="checkbox" ${rotationOn ? 'checked' : ''} onchange="setSmartRotationEnabled(this.checked); renderApiKeyManager();" />
      <span class="rotation-switch-track"><span class="rotation-switch-thumb"></span></span>
    </label>
  </div>`;

  html += `<div class="apikey-list">`;
  if (!keys.length) {
    html += `<div class="apikey-empty"><span class="ns-icon"><svg class="hicon" style="width:32px;height:32px;" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></span>No API keys yet — add your first one below.</div>`;
  } else {
    keys.forEach((k, idx) => {
      const isActive = k.id === activeId;
      const isEditing = _apiKeyEditingId === k.id;
      const color = k.color || API_KEY_COLORS[idx % API_KEY_COLORS.length];
      const rotStatus = (typeof getApiKeyStatusInfo === 'function') ? getApiKeyStatusInfo(k.id) : { excluded: false };
      const statusChip = !rotStatus.excluded ? '' :
        rotStatus.reason === 'invalid'
          ? `<span class="apikey-status-chip apikey-status-invalid" title="This key was rejected by Google — check the value or replace it.">✕ Invalid</span>`
          : rotStatus.reason === 'model_error'
          ? `<span class="apikey-status-chip apikey-status-model-error" title="3 requests in a row came back as bad requests on this key — temporarily skipped by auto-rotation and will be retried automatically."><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Model Error</span>`
          : `<span class="apikey-status-chip apikey-status-limited" title="Temporarily skipped by auto-rotation — will be retried automatically."><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Rate-limited</span>`;
      html += `<div class="apikey-item ${isActive ? 'active' : ''}" style="--apikey-color:${color};">
        <div class="apikey-num">${idx + 1}</div>
        <div class="apikey-info">
          <div class="apikey-label-row">
            <div class="apikey-label-display">${escapeHtml(k.label)}</div>
            ${isActive ? `<span class="apikey-active-chip">Active</span>` : ''}
            ${statusChip}
          </div>
          ${isEditing ? `
          <div class="apikey-edit-row">
            <input type="password" id="apikeyEditInput_${k.id}" value="${escapeHtml(k.key)}"
              oninput="this.style.borderColor='var(--border-soft)'" placeholder="Paste new Gemini API key" />
          </div>
          <div id="apikeyEditStatus_${k.id}"></div>
          <div class="apikey-edit-actions">
            <button class="apikey-use-btn" id="apikeyEditSaveBtn_${k.id}" onclick="submitEditApiKey('${k.id}')" type="button"><svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save</button>
            <button class="apikey-view-btn" onclick="cancelEditApiKey()" type="button">Cancel</button>
          </div>
          ` : `
          <div class="apikey-masked-row">
            <span class="apikey-masked" id="apikeyMasked_${k.id}" data-shown="0">${maskApiKey(k.key)}</span>
            <button class="apikey-toggle-btn" id="apikeyToggleBtn_${k.id}" onclick="toggleApiKeyVisibility(this,'${k.id}')" type="button">
              <span class="apikey-toggle-label">Show</span>
            </button>
          </div>
          `}
        </div>
        ${isEditing ? '' : `
        <div class="apikey-item-actions">
          <button class="apikey-use-btn" ${isActive ? 'disabled' : ''} onclick="useApiKey('${k.id}')">${isActive ? '✓ In use' : 'Use'}</button>
          <button class="apikey-edit-btn" onclick="startEditApiKey('${k.id}')" title="Edit this key's value"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>
          <button class="apikey-del-btn" onclick="deleteApiKeyPrompt('${k.id}', '${escapeHtml(k.label).replace(/'/g, "&#39;")}')"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>
        `}
      </div>`;
    });
  }
  html += `</div>`;

  const nextColor = _pickRandomApiKeyColor(keys.map(k => k.color));
  html += `<div class="apikey-add-form" id="apiKeyAddForm" data-color="${nextColor}">
    <div class="cq-section-title" style="margin-bottom:0;"><svg class="micon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add a New API Key</div>
    <div style="font-size:.78rem;color:var(--text-muted);font-weight:600;">
      Its name and colour are assigned automatically — just paste your Gemini key below.
    </div>
    <div class="apikey-add-row">
      <input type="password" id="apikeyValueInput" placeholder="Paste your Gemini API key here" oninput="this.style.borderColor='var(--border-soft)'" style="flex:1;min-width:180px;" />
    </div>
    <div id="apikeyAddStatus"></div>
    <button class="apikey-save-btn" id="apikeyAddBtn" onclick="submitNewApiKey()" type="button"><svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Key</button>
  </div>`;

  body.innerHTML = html;
  _refreshApiKeyQuickButtons();
}

/* ══════════════════════════════════════════════════════════
   AI EXPLANATION — per-question and explain-all
══════════════════════════════════════════════════════════ */

// Model is now configured in one place: GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL
// in gemini-uploads.js (loaded before this file) — see geminiEndpoint().

// Track which questions are loaded/loading to avoid duplicate calls
const _explainCache = {}; // { qIndex: 'loading' | html-string }
const _explainRawText = {}; // { qIndex: raw AI text } — used to give chat context
const _explainStale = {}; // { qIndex: true } — cached copy predates an edit to the question (see local-store.js)
let _explainAllBusy = false;

// ── Cancellation tokens ──
// Each is a plain object { cancelled: false }.
// explainQuestion sets _singleCancelToken[i] before calling the API.
// explainAllQuestions sets _allCancelToken before the loop.
// Stopping checks these between retries and after awaits.
const _singleCancelToken = {}; // { [qIndex]: { cancelled: bool } }
let _allCancelToken = null; // { cancelled: bool } | null

/* Marks a cancel token as cancelled AND aborts its in-flight fetch (if any)
   right away via AbortController, instead of just letting the request run
   to completion and discarding the result. Use this everywhere a token
   gets cancelled instead of setting `.cancelled = true` directly. */
function _cancelAiToken(token) {
  if (!token) return;
  token.cancelled = true;
  if (token.controller) {
    try { token.controller.abort(); } catch (e) {}
    token.controller = null;
  }
}

/* ── Guarding API key switches while an AI process is actively running ──
   Switching the active key mid-request isn't safe for most in-flight AI
   calls (only the custom-quiz extractor/generator has a real pause-and-
   resume checkpoint system — everything else would just be cut off). So
   before the key actually changes, warn the user that doing so forcibly
   aborts whatever's running, and only proceed if they confirm. */
function _activeAiProcessLabel() {
  // Custom-quiz extraction/generation — only warn if it's actively running,
  // not if it's already sitting paused at a checkpoint (that's the intended
  // way to switch keys mid-run without losing anything).
  if (typeof cqBusy !== 'undefined' && cqBusy && !cqIsPaused) {
    return 'extracting/generating your quiz questions';
  }
  if (typeof _explainAllBusy !== 'undefined' && _explainAllBusy) {
    return 'generating AI explanations for this quiz';
  }
  if (Object.values(_explainCache).includes('loading')) {
    return 'generating an AI explanation';
  }
  if (typeof _chatBusy !== 'undefined' && Object.values(_chatBusy).some(Boolean)) {
    return 'an AI chat response';
  }
  if (typeof _editorBulkBusy !== 'undefined' && _editorBulkBusy.admin) {
    return 'running a bulk AI tool on the quiz you\'re editing in the Admin Panel';
  }
  if (typeof _editorBulkBusy !== 'undefined' && _editorBulkBusy.customQuiz) {
    return 'running a bulk AI tool on your custom quiz';
  }
  if (typeof _editorBulkBusy !== 'undefined' && _editorBulkBusy.cq) {
    return 'running a bulk AI tool on your extracted quiz preview';
  }
  if (typeof _aiToolsBusy !== 'undefined' && Object.keys(_aiToolsBusy).length) {
    return 'running an AI tool (Refine / Fill Choices / Add Choice / Solve) on a question';
  }
  return null;
}

/* Forcibly aborts whatever _activeAiProcessLabel() detected, once the user
   has confirmed — this is a hard, immediate abort (via AbortController on
   the in-flight fetch), not a graceful "finish this step then stop". The
   custom-quiz loop doesn't get its own AbortController (it makes several
   different requests across its run), so it gets a hard-stop flag instead,
   checked immediately after its current request is aborted and errors out. */
function _stopAllAiProcesses() {
  if (typeof cqBusy !== 'undefined' && cqBusy) {
    cqStopRequested = true;
    if (typeof cqCancelToken !== 'undefined' && cqCancelToken) _cancelAiToken(cqCancelToken);
    cqPauseRequested = false;
    cqPauseSkipRequested = false;
    // If it's sitting paused, wake it up so it can see the stop flag and exit.
    if (cqIsPaused && cqResumeResolve) {
      const resolve = cqResumeResolve;
      cqResumeResolve = null;
      resolve();
    }
  }
  _cancelAiToken(_allCancelToken);
  Object.keys(_singleCancelToken).forEach(k => { _cancelAiToken(_singleCancelToken[k]); });
  if (typeof _chatCancelToken !== 'undefined') {
    Object.keys(_chatCancelToken).forEach(k => { _cancelAiToken(_chatCancelToken[k]); });
  }
  // Bulk (whole-quiz) AI tool passes running in the Admin/Custom-Quiz editors —
  // each has its own cancel token (see _editorBulkAiSolve/FillChoices/RefineQuestions).
  if (typeof _editorBulkCancelToken !== 'undefined') {
    Object.keys(_editorBulkCancelToken).forEach(k => { _cancelAiToken(_editorBulkCancelToken[k]); _editorBulkCancelToken[k] = null; });
  }
  // Per-question AI tool runs (Refine / Fill Choices / Add Choice / Solve),
  // keyed by `${editorKey}_${i}` — see _aiToolsKey.
  if (typeof _aiToolsCancelToken !== 'undefined') {
    Object.keys(_aiToolsCancelToken).forEach(k => { _cancelAiToken(_aiToolsCancelToken[k]); delete _aiToolsCancelToken[k]; });
  }
}

/* ── Guarding menu close / tab-switch attempts while a process is running ──
   Wraps a close (or tab-switch) action: if an AI process is actively running
   that would be interrupted, warn the user first — same wording/pattern as
   the API-key-switch guard above — and only actually stop it and proceed if
   they confirm. A publish (adminBusy) is a sequence of Firestore writes with
   no safe mid-flight abort point (partial writes could orphan uploaded
   images), so unlike the AI processes it isn't offered as "stop and close" —
   it's simply blocked until it finishes on its own. */
// Set true by any question-editing action (text edits, option/answer changes,
// add/delete question or option, image changes, reordering, case-group links,
// AI tool results not yet saved, etc.) across every editor in the app — the
// extraction/generation preview, "Create Your Own Quiz", the saved-custom-quiz
// editor, and the admin question editor. Cleared whenever a fresh editor is
// opened or edits are actually saved. _guardedClose() (and a couple of
// non-overlay "cancel" actions that also abandon an in-progress edit) check
// this so the user is warned before their unsaved edits are silently lost.
let _questionEditDirty = false;
function _markQuestionEditDirty() { _questionEditDirty = true; }

function _guardedClose(closeFn) {
  if (typeof adminBusy !== 'undefined' && adminBusy) {
    alert('A publish is still in progress. Please wait for it to finish before closing.');
    return;
  }
  const activeLabel = _activeAiProcessLabel();
  if (activeLabel) {
    const confirmed = confirm(
      `You're currently ${activeLabel}. Closing this now will stop that process immediately — anything not already completed will be lost.\n\nStop it and close?`
    );
    if (!confirmed) return;
    _stopAllAiProcesses();
  }
  if (_questionEditDirty) {
    const confirmed = confirm(
      `You have unsaved edits. Closing now will discard them and they will be lost.\n\nClose anyway?`
    );
    if (!confirmed) return;
  }
  _questionEditDirty = false;
  closeFn();
}

/* ── Build Gemini prompt for one question ── */
function buildExplainPrompt(questions, q, userAnswer) {
  const optLines = getOptionEntries(q)
    .map(([k, v]) => ` ${k}. ${v}`)
    .join('\n');
  const userLine = userAnswer
    ? `The student answered: ${userAnswer}. ${q.options[userAnswer] || ''}`
    : 'The student did not answer this question.';

  const wrongOptLines = getOptionEntries(q)
    .filter(([k]) => k !== q.answer)
    .map(([k, v]) => `
WRONG — ${k}. ${v}:
[1 tight sentence: the specific reason it's wrong — no restating the question or option text]`).join('');

  const hasImage = !!(q.image || _cqFindCaseGroupImage(questions, q));
  const imageNote = hasImage
    ? '\nA visual element (image/diagram/figure) associated with this question is attached — refer to it in your explanation as needed.\n'
    : '';

  const caseBlock = _cqCaseContextBlock(questions, q);

  return `You are a medical education expert. Explain this MCQ question clearly for a medical student.
${imageNote}
${caseBlock}QUESTION:
${q.question}

OPTIONS:
${optLines}

CORRECT ANSWER: ${q.answer}. ${q.options[q.answer] || ''}
${userLine}

Provide a tight, information-dense explanation in this EXACT structure (use these exact section headers). You MUST include a section for EVERY answer choice, both correct and wrong. Every sentence must add new information — no throat-clearing, no restating the question, no filler phrases like "this is important because" or "let's look at":

QUESTION OVERVIEW:
[One sentence: the core concept/clinical scenario being tested — nothing else]

CORRECT ANSWER — ${q.answer}. ${q.options[q.answer] || ''}:
[1–2 sentences with only the essential medical reasoning for why this is correct]
${wrongOptLines}

Be as brief as possible while keeping every piece of medical reasoning — cut words, never cut content. Use plain text only — no markdown, no bullet points, no asterisks. Keep the medical reasoning itself consistent every time; only natural, minor variation in phrasing is expected between runs.`;
}

/* ── Render the "no active API key" prompt inside an explain panel ── */
function renderExplainKeyPrompt(panelEl, onSave, errorMsg) {
  panelEl.innerHTML = `
    <div class="ai-explain-panel">
      <div class="ai-explain-panel-header">
        <span><svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></span> Gemini API Key Required
      </div>
      <div class="ai-explain-panel-body">
        <div class="ai-key-prompt">
          <div class="ai-key-prompt-title">${errorMsg ? escapeHtml(errorMsg) : 'Add a Gemini API key to enable AI explanations'}</div>
          <div class="ai-key-prompt-sub">Add, choose, or manage your keys in one place — the API Key Manager.</div>
          <div class="ai-key-prompt-row">
            <button onclick="openApiKeyManager(() => { const p = this && this.closest ? this.closest('.ai-explain-panel') : null; })" style="width:100%;justify-content:center;" type="button"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Open API Key Manager</button>
          </div>
        </div>
      </div>
    </div>`;
  // Store callback so closing the manager (once a key is active) can resume the action
  const wrapped = () => { if (onSave) onSave(getActiveApiKey()); };
  panelEl.querySelector('.ai-key-prompt-row button').setAttribute('onclick', '');
  panelEl.querySelector('.ai-key-prompt-row button').onclick = () => openApiKeyManager(wrapped);
}

/* ── Stop a single in-progress explanation ── */
function stopExplainQuestion(i) {
  _cancelAiToken(_singleCancelToken[i]);
}

/* ── Best-effort stable identity for "this question's slot" in the local
   explanation cache (js/local-store.js). Holds steady across normal
   re-review of the same quiz; can shift if the quiz is retitled/reordered
   or is dynamically assembled each time (retake, multi-custom-quiz merge)
   — in that case a lookup just misses, same as an unexplained question. ── */
function _explainSlotKey(i) {
  return `${currentQuizSource}::${selectedSubject}::${currentLecture}::${i}`;
}

/* ── Render an explanation into its panel, with a Regenerate control ── */
function displayExplainPanel(i, html) {
  const panel = document.getElementById(`explainPanel_${i}`);
  if (!panel) return;
  const staleHint = _explainStale[i]
    ? `<div class="ai-explain-stale-hint"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> This question has changed since this explanation was generated — regenerate recommended.</div>`
    : '';
  panel.innerHTML = html + staleHint + `
    <div class="ai-explain-regen-row" style="padding:6px 16px 14px;text-align:right;">
      <button class="ai-explain-regen-btn" onclick="regenerateExplanation(${i})" style="background:none;border:1.5px solid var(--accent);color:var(--accent);border-radius:6px;padding:4px 10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font);"><svg class="sicon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Regenerate</button>
    </div>`;
}

/* ── Force a fresh AI explanation, bypassing any cached copy ── */
function regenerateExplanation(i) {
  if (_explainCache[i] === 'loading') return;
  _explainCache[i] = undefined;
  _explainRawText[i] = undefined;
  _explainStale[i] = false;
  const panel = document.getElementById(`explainPanel_${i}`);
  if (panel) panel.innerHTML = '';
  explainQuestion(i, true);
}

/* ── Core: fetch explanation for one question index ── */
async function explainQuestion(i, forceRegenerate = false) {
  const btn = document.getElementById(`explainBtn_${i}`);
  const panel = document.getElementById(`explainPanel_${i}`);
  if (!btn || !panel) return;

  if (!forceRegenerate) {
    // Already shown — toggle off
    if (_explainCache[i] && _explainCache[i] !== 'loading') {
      if (panel.innerHTML.trim()) { panel.innerHTML = ''; btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Explain'; return; }
      displayExplainPanel(i, _explainCache[i]);
      btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Hide';
      return;
    }
    if (_explainCache[i] === 'loading') return;
  }

  const q = currentQuestions[i];

  if (!forceRegenerate) {
    // Local, per-device explanation cache (js/local-store.js) — no
    // Firestore reads/writes, no API key needed for a cache hit.
    try {
      const { fingerprintQuestion, getCachedExplanation } = await import('./local-store.js');
      const liveHash = await fingerprintQuestion(q);
      const cached = await getCachedExplanation(_explainSlotKey(i), liveHash);
      if (cached && cached.html) {
        _explainCache[i] = cached.html;
        _explainRawText[i] = cached.text;
        _explainStale[i] = cached.stale;
        displayExplainPanel(i, cached.html);
        btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Hide';
        return;
      }
    } catch (e) { /* non-fatal — fall through to a fresh generation */ }
  }

  const apiKey = getExplainKey();

  // No key — show inline prompt
  if (!apiKey) {
    renderExplainKeyPrompt(panel, (key) => explainQuestion(i, forceRegenerate));
    return;
  }

  // Create a fresh cancel token for this question
  const token = { cancelled: false };
  _singleCancelToken[i] = token;

  _explainCache[i] = 'loading';
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<svg class="sicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Explaining…';

  const loadingHTML = () => `
    <div class="ai-explain-panel">
      <div class="ai-explain-panel-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span style="display:flex;align-items:center;gap:8px;">
          <div class="ai-exp-spinner"></div>
          Getting AI explanation…
        </span>
        <button onclick="stopExplainQuestion(${i})" style="background:var(--wrong-fg);color:white;border:none;border-radius:6px;padding:4px 10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font);flex-shrink:0;"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
      </div>
    </div>`;

  panel.innerHTML = loadingHTML();

  try {
    const userAnswer = userAnswers[i] || '';
    const prompt = buildExplainPrompt(currentQuestions, q, userAnswer);
    const url = geminiEndpoint();

    // Build parts — prepend the question's image if it has one, or fall back
    // to the case group's shared image (i.e. the core question's image) when
    // this is a dependent question in a case cluster.
    const parts = [];
    const explainImg = q.image || _cqFindCaseGroupImage(currentQuestions, q);
    if (explainImg) {
      const base64 = explainImg.split(',')[1] || '';
      const mime = explainImg.match(/^data:([^;]+)/)?.[1] || 'image/png';
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }
    parts.push({ text: prompt });

    const data = await callGeminiWithRetry(url, {
      contents: [{ parts }],
      // temperature: 0.3 — mostly consistent explanations with a little
      // natural variation in phrasing, rather than robotically identical
      // wording every time. Auto-stripped on a fallback-model switch (see
      // GEMINI_SAMPLING_PARAM_KEYS in gemini-uploads.js) — the trailing
      // sentence in buildExplainPrompt() above is the prompt-level backstop
      // for that case.
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
    }, {
      cancelToken: token,
      apiKey
    });

    const text = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Empty response from AI.');

    // If the user hit Stop while this request was finishing up, don't render the result
    if (token.cancelled) {
      _explainCache[i] = null;
      const p = document.getElementById(`explainPanel_${i}`);
      if (p) p.innerHTML = '';
      const b = document.getElementById(`explainBtn_${i}`);
      if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Explain'; }
      return;
    }

    const html = renderExplainText(text, q);
    _explainCache[i] = html;
    _explainRawText[i] = text;
    _explainStale[i] = false;

    displayExplainPanel(i, html);
    const b = document.getElementById(`explainBtn_${i}`);
    if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Hide'; }

    // Cache locally on this device only — never sent to Firestore or anywhere else.
    (async () => {
      try {
        const { fingerprintQuestion, saveCachedExplanation } = await import('./local-store.js');
        const hash = await fingerprintQuestion(q);
        await saveCachedExplanation(_explainSlotKey(i), hash, text, html);
      } catch (e) { /* non-fatal — explanation still shown, just won't be cached */ }
    })();

  } catch(err) {
    if (err._cancelled) {
      // User stopped — reset quietly
      _explainCache[i] = null;
      const p = document.getElementById(`explainPanel_${i}`);
      if (p) p.innerHTML = '';
      const b = document.getElementById(`explainBtn_${i}`);
      if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Explain'; }
      return;
    }
    _explainCache[i] = null; // allow retry
    const isKeyErr = err._keyError || /api.?key|invalid.?key|not.?valid|permission.?denied/i.test(err.message || '');
    const p = document.getElementById(`explainPanel_${i}`);
    if (p) {
      if (isKeyErr) {
        renderExplainKeyPrompt(p, (key) => {
          p.innerHTML = '';
          explainQuestion(i);
        }, 'Your active API key was rejected or is invalid — pick or add another one.');
      } else {
        p.innerHTML = `
          <div class="ai-explain-panel">
            <div class="ai-explain-panel-header"><span><svg class="micon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Explanation failed</div>
            <div class="ai-explain-panel-body">
              <div class="ai-exp-error">${escapeHtml(err.message || String(err))}</div>
            </div>
          </div>`;
      }
    }
    const b = document.getElementById(`explainBtn_${i}`);
    if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Explain'; }
  }
}

/* ── Parse AI text into structured HTML ── */
function renderExplainText(text, q) {
  // Build a lookup map: option key → { label, cls }
  const sectionMeta = {};
  sectionMeta['__overview__'] = { label: 'Question Overview', cls: 'question-label' };
  sectionMeta['__correct__'] = { label: `✔ Correct — ${q.answer}. ${q.options[q.answer] || ''}`, cls: 'correct-label' };
  getOptionEntries(q).forEach(([k, v]) => {
    if (k !== q.answer) {
      sectionMeta[`__wrong_${k}__`] = { label: `✘ Wrong — ${k}. ${v}`, cls: 'wrong-label' };
    }
  });

  // Build a single regex that matches ANY of the known headers, capturing which key matched.
  // We use a unified scan: find every header occurrence in the text, tag it, then sort by position.
  const headerDefs = [
    { key: '__overview__', re: /QUESTION\s+OVERVIEW\s*:/i },
    { key: '__correct__', re: /CORRECT\s+ANSWER\s*(?:—|-|–)?[^:\n]*:/i },
    ...getOptionEntries(q).filter(([k]) => k !== q.answer).map(([k]) => k)
      .map(k => ({
        key: `__wrong_${k}__`,
        // Match "WRONG — K." or "WRONG — K ." or just "WRONG — K:" where K is the exact option key
        // Use word boundary so "B" doesn't match "BC"
        re: new RegExp(`WRONG\\s*(?:—|-|–)?\\s*${escapeRegex(k)}\\s*\\.?[^:\\n]*:`, 'i')
      }))
  ];

  // Scan text for all header positions; a key may appear at most once — keep the FIRST occurrence
  const hits = []; // { key, start, end (end of header marker) }
  const seenKeys = new Set();

  headerDefs.forEach(({ key, re }) => {
    const reGlobal = new RegExp(re.source, 'gi');
    let m;
    while ((m = reGlobal.exec(text)) !== null) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        hits.push({ key, start: m.index, headerEnd: m.index + m[0].length });
      }
      break; // only first occurrence per section
    }
  });

  // Sort hits by their position in the text
  hits.sort((a, b) => a.start - b.start);

  // Extract body text between consecutive headers
  let html = '<div class="ai-explain-panel"><div class="ai-explain-panel-header"><span><svg class="micon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg></span> AI Explanation</div><div class="ai-explain-panel-body">';

  if (hits.length === 0) {
    // Parsing found nothing — show raw text as fallback
    html += `<div class="exp-section"><div>${escapeHtml(text)}</div></div>`;
  } else {
    hits.forEach((hit, idx) => {
      const bodyStart = hit.headerEnd;
      const bodyEnd = idx + 1 < hits.length ? hits[idx + 1].start : text.length;
      const body = text.slice(bodyStart, bodyEnd).trim();
      const meta = sectionMeta[hit.key];
      if (!meta) return;
      html += `<div class="exp-section">
        <div class="exp-label ${meta.cls}">${escapeHtml(meta.label)}</div>
        <div>${escapeHtml(body)}</div>
      </div>`;
    });
  }

  html += '</div></div>';
  return html;
}

/* ── Escape special regex characters in a string ── */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── Stop the explain-all batch ── */
function stopExplainAll() {
  _cancelAiToken(_allCancelToken);
  // Also cancel any currently-running single explanation that the batch started
  Object.values(_singleCancelToken).forEach(t => { _cancelAiToken(t); });
  _explainAllBusy = false;
  const btn = document.getElementById('explainAllBtn');
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Explain All'; }
}

/* ── Explain ALL questions sequentially ── */
async function explainAllQuestions() {
  if (_explainAllBusy) return;

  const apiKey = getExplainKey();
  if (!apiKey) {
    let tempPanel = document.getElementById('explainAllKeyPanel');
    if (!tempPanel) {
      tempPanel = document.createElement('div');
      tempPanel.id = 'explainAllKeyPanel';
      tempPanel.style.cssText = 'padding:0 24px 12px;';
      const footer = document.querySelector('.results-footer');
      if (footer) footer.insertAdjacentElement('afterend', tempPanel);
    }
    renderExplainKeyPrompt(tempPanel, (key) => { tempPanel.remove(); explainAllQuestions(); });
    tempPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  _explainAllBusy = true;
  // Fresh batch-level cancel token
  const batchToken = { cancelled: false };
  _allCancelToken = batchToken;

  const btn = document.getElementById('explainAllBtn');
  if (btn) {
    btn.disabled = false; // keep it clickable so it acts as Stop
    btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop All';
    btn.onclick = stopExplainAll;
  }

  for (let i = 0; i < currentQuestions.length; i++) {
    // Bail out if the batch was cancelled between questions
    if (batchToken.cancelled) break;

    // Skip already-explained
    if (_explainCache[i] && _explainCache[i] !== 'loading') {
      const p = document.getElementById(`explainPanel_${i}`);
      if (p && !p.innerHTML.trim()) displayExplainPanel(i, _explainCache[i]);
      const b = document.getElementById(`explainBtn_${i}`);
      if (b) b.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Hide';
      continue;
    }

    _explainCache[i] = undefined;
    await explainQuestion(i); // explainQuestion manages its own _singleCancelToken

    // If cancelled mid-question, stop the batch
    if (batchToken.cancelled) break;

    // If a key prompt appeared, pause the batch and let the user enter a key
    const panel = document.getElementById(`explainPanel_${i}`);
    if (panel && panel.querySelector('#explainKeyInput')) {
      _explainAllBusy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Explain All'; btn.onclick = explainAllQuestions; }
      window._explainKeySaveCallback = (key) => {
        panel.innerHTML = '';
        explainAllQuestions(); // restart from scratch — already-done questions are cached
      };
      return;
    }

    // Small delay to avoid rate limiting
    if (!batchToken.cancelled) await cancellableSleep(300, batchToken);
  }

  _explainAllBusy = false;
  _allCancelToken = null;
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = batchToken.cancelled ? ' Explain All' : ' Explained ✓';
    btn.onclick = explainAllQuestions;
  }
}

/* ══════════════════════════════════════════════════════════
   AI CHAT — per-question chat with attachments
══════════════════════════════════════════════════════════ */
// Model is now configured in one place: GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL
// in gemini-uploads.js (loaded before this file) — see geminiEndpoint().

// Conversation state, keyed by question index
const _chatHistory = {}; // { qIndex: [{role:'user'|'model', parts:[{text}|{inline_data}|{file_data},_name]}] }
const _chatPending = {}; // { qIndex: [{file, name, mimeType, previewUrl}] } — attachments staged but not yet sent
const _chatBusy = {}; // { qIndex: bool }
const _chatCancelToken = {}; // { qIndex: {cancelled:bool} }
const _chatError = {}; // { qIndex: errorMessage }

/* ── Toggle the chat panel open/closed ── */
function toggleChatPanel(i) {
  const panel = document.getElementById(`chatPanel_${i}`);
  const btn = document.getElementById(`chatBtn_${i}`);
  if (!panel) return;

  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    panel.innerHTML = '';
    if (btn) btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Chat';
    return;
  }

  panel.classList.add('open');
  if (btn) btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Hide Chat';
  renderChatPanel(i);
}

/* ── Build the system instruction for the chat, including any existing explanation ── */
function buildChatSystemInstruction(i) {
  const q = currentQuestions[i];
  const userAnswer = userAnswers[i] || '';
  const optLines = getOptionEntries(q).map(([k, v]) => ` ${k}. ${v}`).join('\n');
  const userLine = userAnswer
    ? `The student answered: ${userAnswer}. ${q.options[userAnswer] || ''}`
    : 'The student did not answer this question.';

  const caseBlock = _cqCaseContextBlock(currentQuestions, q);

  let ctx = `You are a friendly, knowledgeable medical education tutor chatting with a student about one MCQ question. Stay focused on this question and related concepts unless the student clearly asks something else. Be concise by default: answer in 2–4 sentences, straight to the point, no restating the question, no filler pleasantries or hedging. Only go longer when the student explicitly asks for more detail or the concept genuinely can't be explained correctly in fewer words — but never drop essential medical content just to be short.

${caseBlock}QUESTION:
${q.question}

OPTIONS:
${optLines}

CORRECT ANSWER: ${q.answer}. ${q.options[q.answer] || ''}
${userLine}`;

  if (q.image || _cqFindCaseGroupImage(currentQuestions, q)) {
    ctx += `\n\nThis question includes a visual element (image, diagram, figure, X-ray, ECG, histology slide, etc.) that has been provided to you alongside this conversation. Use it when answering questions about the image or any visual findings.`;
  }

  const rawExplain = _explainRawText[i];
  if (rawExplain) {
    ctx += `\n\nAN AI-GENERATED EXPLANATION HAS ALREADY BEEN SHOWN TO THE STUDENT FOR THIS QUESTION:
${rawExplain}

Build on this explanation rather than repeating it verbatim — clarify, expand, or address follow-up questions about it.`;
  }

  ctx += `\n\nThe student may attach images or files (e.g. photos of notes, diagrams, or screenshots) — consider their contents when responding. Default to short, direct replies; expand only if the question truly needs it. Plain text only — no markdown, no asterisks. Keep the underlying medical facts consistent across the conversation; natural variation in wording between replies is fine, but never contradict something already established.`;
  return ctx;
}

/* ── Render the chat panel UI for question i ── */
function renderChatPanel(i) {
  const panel = document.getElementById(`chatPanel_${i}`);
  if (!panel) return;

  const history = _chatHistory[i] || [];
  const pending = _chatPending[i] || [];
  const busy = !!_chatBusy[i];
  const error = _chatError[i];

  let msgsHTML = '';
  if (!history.length) {
    msgsHTML = `<div class="ai-chat-empty">Ask anything about this question — request a simpler explanation, dig into a specific option, or attach an image (e.g. a diagram or your notes) for the AI to look at.</div>`;
  } else {
    history.forEach(m => {
      const isUser = m.role === 'user';
      let bodyHTML = '';
      (m.parts || []).forEach(p => {
        if (p.text) {
          bodyHTML += `<div class="ai-chat-text">${escapeHtml(p.text).replace(/\n/g, '<br>')}</div>`;
        } else if (p.inline_data) {
          if ((p.inline_data.mime_type || '').startsWith('image/')) {
            bodyHTML += `<div class="ai-chat-attach-thumb"><img src="data:${p.inline_data.mime_type};base64,${p.inline_data.data}" alt="attachment" /></div>`;
          } else {
            bodyHTML += `<div class="ai-chat-file-chip"><svg class="sicon" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> ${escapeHtml(p._name || 'attachment')}</div>`;
          }
        } else if (p.file_data) {
          bodyHTML += `<div class="ai-chat-file-chip"><svg class="sicon" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> ${escapeHtml(p._name || 'attachment')}</div>`;
        }
      });
      msgsHTML += `<div class="ai-chat-msg ${isUser ? 'user' : 'model'}"><div class="ai-chat-bubble">${bodyHTML}</div></div>`;
    });
  }

  if (busy) {
    msgsHTML += `
      <div class="ai-chat-msg model">
        <div class="ai-chat-bubble ai-chat-loading">
          <div class="ai-exp-spinner"></div>
          <span id="chatLoadingLabel_${i}">Thinking…</span>
          <button class="ai-chat-stop-btn" onclick="stopChat(${i})"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
        </div>
      </div>`;
  } else if (error) {
    msgsHTML += `
      <div class="ai-chat-msg model">
        <div class="ai-chat-bubble ai-chat-error">
          <div class="ai-chat-error-row">
            <span><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escapeHtml(error)}</span>
            <button class="ai-chat-retry-btn" onclick="retryLastChatMessage(${i})">↻ Retry</button>
          </div>
        </div>
      </div>`;
  }

  let attachHTML = '';
  if (pending.length) {
    attachHTML = `<div class="ai-chat-pending">` + pending.map((a, idx) => {
      if ((a.mimeType || '').startsWith('image/') && a.previewUrl) {
        return `<div class="ai-chat-pending-item"><img src="${a.previewUrl}" alt="" /><button onclick="removeChatAttachment(${i},${idx})">✕</button></div>`;
      }
      return `<div class="ai-chat-pending-item"><span> ${escapeHtml(a.name)} <span style="opacity:.65;">(${formatBytes(a.file.size)})</span></span><button onclick="removeChatAttachment(${i},${idx})">✕</button></div>`;
    }).join('') + `</div>`;
  }

  panel.innerHTML = `
    <div class="ai-chat-box">
      <div class="ai-chat-header"><span><svg class="micon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span> Chat about this question</div>
      <div class="ai-chat-messages" id="chatMessages_${i}">${msgsHTML}</div>
      ${attachHTML}
      <div class="ai-chat-input-row">
        <input type="file" id="chatFileInput_${i}" multiple accept="image/*,.pdf,.txt,.csv" style="display:none" onchange="handleChatFileSelect(${i}, this)" />
        <button class="ai-chat-attach-btn" type="button" title="Attach file" onclick="document.getElementById('chatFileInput_${i}').click()" ${busy ? 'disabled' : ''}><svg class="sicon" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        <input type="text" class="ai-chat-text-input" id="chatTextInput_${i}" placeholder="Ask a question…" ${busy ? 'disabled' : ''} onkeydown="if(event.key==='Enter'){event.preventDefault();sendChatMessage(${i});}" />
        <button class="ai-chat-send-btn" type="button" title="Send" onclick="sendChatMessage(${i})" ${busy ? 'disabled' : ''}>➤</button>
      </div>
    </div>`;

  const msgsEl = document.getElementById(`chatMessages_${i}`);
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

/* ── Handle attaching files via the file picker ── */
function handleChatFileSelect(i, inputEl) {
  const files = Array.from((inputEl && inputEl.files) || []);
  if (!files.length) return;
  if (!_chatPending[i]) _chatPending[i] = [];

  files.forEach(file => {
    if (file.size > GEMINI_MAX_FILE_BYTES) {
      alert(`"${file.name}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API.`);
      return;
    }
    const mimeType = file.type || 'application/octet-stream';
    // Use a lightweight object URL for image previews instead of reading the
    // whole file into a base64 data URL up front — keeps large attachments
    // cheap to stage before they're actually sent.
    const previewUrl = mimeType.startsWith('image/') ? URL.createObjectURL(file) : null;
    _chatPending[i].push({ file, name: file.name, mimeType, previewUrl });
  });

  renderChatPanel(i);
  inputEl.value = '';
}

/* ── Remove a staged (not-yet-sent) attachment ── */
function removeChatAttachment(i, idx) {
  if (_chatPending[i]) {
    const removed = _chatPending[i].splice(idx, 1)[0];
    if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  }
  renderChatPanel(i);
}

/* ── Stop an in-progress chat request ── */
function stopChat(i) {
  _cancelAiToken(_chatCancelToken[i]);
}

/* ── Strip our internal display-only fields before sending to the API ── */
function buildApiContents(history) {
  return history.map(m => ({
    role: m.role,
    parts: m.parts.map(p => {
      if (p.inline_data) return { inline_data: { mime_type: p.inline_data.mime_type, data: p.inline_data.data } };
      if (p.file_data) return { file_data: { mime_type: p.file_data.mime_type, file_uri: p.file_data.file_uri } };
      return { text: p.text };
    })
  }));
}

/* ── Send the staged message (text + attachments) ── */
async function sendChatMessage(i) {
  if (_chatBusy[i]) return;

  const input = document.getElementById(`chatTextInput_${i}`);
  const text = input ? input.value.trim() : '';
  const pending = _chatPending[i] || [];
  if (!text && !pending.length) return;

  const apiKey = getExplainKey();
  if (!apiKey) {
    const panel = document.getElementById(`chatPanel_${i}`);
    if (panel) {
      renderExplainKeyPrompt(panel, () => {
        renderChatPanel(i);
        const inp = document.getElementById(`chatTextInput_${i}`);
        if (inp) inp.value = text;
        sendChatMessage(i);
      });
    }
    return;
  }

  // Attachments are converted to Gemini "parts" here — small ones inline as
  // base64, larger ones streamed through the Files API — so staging stays
  // instant regardless of file size and only the actual send does the work.
  if (pending.length) {
    _chatBusy[i] = true;
    if (input) input.disabled = true;
    renderChatPanel(i);
    const loadingLabel = document.getElementById(`chatLoadingLabel_${i}`);
    if (loadingLabel) loadingLabel.textContent = 'Uploading attachment…';
  }

  const parts = [];
  if (text) parts.push({ text });
  try {
    for (const a of pending) {
      const part = await buildGeminiFilePart(a.file, apiKey, a.mimeType);
      part._name = a.name;
      parts.push(part);
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
  } catch (e) {
    _chatBusy[i] = false;
    _chatError[i] = e.message || String(e);
    renderChatPanel(i);
    return;
  }

  if (!_chatHistory[i]) _chatHistory[i] = [];
  _chatHistory[i].push({ role: 'user', parts });
  _chatPending[i] = [];
  _chatError[i] = null;
  if (input) input.value = '';

  await runChatRequest(i);
}

/* ── Retry the last (failed) request without re-sending a new user message ── */
function retryLastChatMessage(i) {
  if (_chatBusy[i]) return;
  _chatError[i] = null;
  runChatRequest(i);
}

/* ── Core: send the current history to Gemini and append the reply ── */
async function runChatRequest(i) {
  const apiKey = getExplainKey();
  if (!apiKey) {
    const panel = document.getElementById(`chatPanel_${i}`);
    if (panel) renderExplainKeyPrompt(panel, () => runChatRequest(i));
    return;
  }

  const history = _chatHistory[i] || [];
  if (!history.length) return;

  _chatBusy[i] = true;
  _chatError[i] = null;
  renderChatPanel(i);

  const token = { cancelled: false };
  _chatCancelToken[i] = token;

  try {
    const url = geminiEndpoint();

    // If this question has an embedded image — or, for a dependent question
    // in a case cluster, if the core question has one — inject it as the
    // first part of the first user turn so Gemini can see it throughout the
    // conversation.
    const q = currentQuestions[i];
    let apiContents = buildApiContents(history);
    const chatImg = q.image || _cqFindCaseGroupImage(currentQuestions, q);
    if (chatImg && apiContents.length > 0) {
      const base64 = chatImg.split(',')[1] || '';
      const mime = chatImg.match(/^data:([^;]+)/)?.[1] || 'image/png';
      const imagePart = { inline_data: { mime_type: mime, data: base64 } };
      // Prepend image to the first user turn's parts
      apiContents = apiContents.map((m, idx) =>
        idx === 0 && m.role === 'user'
          ? { ...m, parts: [imagePart, ...m.parts] }
          : m
      );
    }

    const data = await callGeminiWithRetry(url, {
      contents: apiContents,
      systemInstruction: { parts: [{ text: buildChatSystemInstruction(i) }] },
      // temperature: 0.4 — this is an open-ended follow-up conversation
      // rather than a one-shot factual answer, so a bit more natural
      // variation is appropriate here than in the explain call above.
      // Auto-stripped on a fallback-model switch (see
      // GEMINI_SAMPLING_PARAM_KEYS in gemini-uploads.js) — the closing
      // sentence in buildChatSystemInstruction() above is the prompt-level
      // backstop for that case.
      generationConfig: { maxOutputTokens: 1536, temperature: 0.4 }
    }, {
      cancelToken: token,
      apiKey
    });

    const replyText = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!replyText) throw new Error('Empty response from AI.');

    _chatBusy[i] = false;
    if (token.cancelled) { renderChatPanel(i); return; }

    _chatHistory[i].push({ role: 'model', parts: [{ text: replyText }] });
    renderChatPanel(i);

  } catch (err) {
    _chatBusy[i] = false;

    if (err._cancelled) {
      renderChatPanel(i);
      return;
    }

    const isKeyErr = err._keyError || /api.?key|invalid.?key|not.?valid|permission.?denied/i.test(err.message || '');
    if (isKeyErr) {
      const panel = document.getElementById(`chatPanel_${i}`);
      if (panel) renderExplainKeyPrompt(panel, () => runChatRequest(i), 'Your active API key was rejected or is invalid — pick or add another one.');
      return;
    }

    _chatError[i] = err.message || String(err);
    renderChatPanel(i);
  }
}

/* ══════════════════════════════════════════════════════════
   CUSTOM QUIZZES — AI-POWERED (GEMINI)
══════════════════════════════════════════════════════════ */
const CQ_KEY = 'anu_msp_custom_quizzes_v1';
// Model is now configured in one place: GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL
// in gemini-uploads.js (loaded before this file) — see geminiEndpoint().

/* ── PER-USER CACHE for Custom Quizzes ──────────────────────
   These are private, so each user gets their own tiny version
   doc instead of the shared appConfig/cacheVersion doc:
     Server doc : users/{uid}/meta/cacheVersion { v: <ms> }
     Local keys : anu_msp_cq_full_cache_<uid>
                  anu_msp_cq_full_cache_ver_<uid>
   saveCustomQuizzesList() bumps the doc (and refreshes the local
   cache immediately, so the very next load is already warm).
   loadCustomQuizzesFromFirestore() checks the doc before doing
   the full collection read + per-question image hydration. */
function _cqCacheKey(uid) { return 'anu_msp_cq_full_cache_' + uid; }
function _cqCacheVerKey(uid) { return 'anu_msp_cq_full_cache_ver_' + uid; }

function _readCqCache(uid) {
  try {
    const raw = localStorage.getItem(_cqCacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
function _writeCqCache(uid, arr) {
  try { localStorage.setItem(_cqCacheKey(uid), JSON.stringify(arr)); } catch(e) {}
}
function _readCqCacheVer(uid) {
  return localStorage.getItem(_cqCacheVerKey(uid)) || null;
}
function _writeCqCacheVer(uid, v) {
  try { localStorage.setItem(_cqCacheVerKey(uid), String(v)); } catch(e) {}
}

/* Fetch this user's tiny custom-quizzes version doc */
async function _fetchCqServerVersion(uid) {
  try {
    const snap = await window._getDoc(window._doc(window._db, 'users', uid, 'meta', 'cacheVersion'));
    return snap.exists() && snap.data().v != null ? String(snap.data().v) : null;
  } catch(e) { return null; }
}

/* Bump this user's custom-quizzes version doc (call after any write) */
async function _bumpCqVersion(uid) {
  if (!window._db) return null;
  try {
    const v = Date.now();
    await window._setDoc(window._doc(window._db, 'users', uid, 'meta', 'cacheVersion'), { v });
    return String(v);
  } catch(e) {
    console.warn('_bumpCqVersion failed:', e);
    return null;
  }
}

let cqSelectedFiles = []; // array of File — quiz images/PDFs to extract questions from
let cqGeneratedQuestions = null;
let cqGeneratedTitle = '';
let cqBusy = false;

// ── Pause / resume (lets the user swap to a different API key mid-run
// without losing any work already extracted/generated) ──
let cqPauseRequested = false; // user clicked Pause, take effect at next safe checkpoint
let cqIsPaused = false; // actually sitting paused right now
let cqResumeResolve = null; // resolves the in-flight "await" that's holding the loop

// While cqPauseRequested is true but cqIsPaused is still false (i.e. the
// loop hasn't reached its next natural checkpoint yet), the user can click
// a second "pause now" action to skip waiting for that checkpoint — this
// aborts whatever's in flight right now and steps back to the LAST
// completed checkpoint instead, exactly like the automatic rate-limit
// pause fallback already does. Nothing extracted/generated so far is lost;
// only the one file/batch/question in flight is retried once resumed.
let cqPauseSkipRequested = false;

// ── Hard stop (used when the user confirms switching API keys mid-run —
// unlike Pause, this actually ends the run instead of just holding it) ──
let cqStopRequested = false; // set true to end the run at the next checkpoint / in-flight request
let cqCancelToken = null; // { cancelled: bool } | null — passed to callGeminiWithRetry so an
                               // in-flight request also stops as soon as it comes back

// ── NEW: Generate from lecture state ──
let cqMode = 'extract'; // 'extract' | 'generate'
let cqLectureFiles = []; // array of File — lecture material to generate new questions from
let cqCustomPrompt = '';
let cqQuestionCount = '';

// ── AI Answering (single menu: master switch + submenu picking exactly
// one behavior — replaces the old separate "AI Answer Mode" / "AI Solve
// All" toggles, which as two independent switches could be turned on
// together and silently conflict) ──
let cqAiAnsweringEnabled = false; // master on/off for AI answering
let cqAiAnswerSubmode = 'missing'; // 'missing' (only fill no-key questions) | 'all' (solve/verify every question)
let cqAiAnswerSource = ''; // kept for compatibility with cqAiSolveQuestions' signature — always '' now that reference sources are files-only (no more paste-text UI)
let cqAiSourceFiles = []; // optional source images/PDFs (array of {base64, mimeType, name})

// ── Post-extraction AI polish (Refine Question / Fill Choices) ──
// These reuse the exact same per-question AI tools available in the editor
// (see "AI QUESTION TOOLS" above), just run once automatically across every
// question right after extraction instead of one at a time by hand.
let cqRefineToggle = false; // whether to AI-refine every extracted question's wording
let cqRefineCustomInstructions = ''; // optional custom instructions applied to every refine call
let cqFillChoicesToggle = false; // whether to AI-fill every question up to 4 answer choices

// ── Content Filter (AI) — same bulk pass as the post-extraction
// "Content Filter" tool (_editorBulkContentFilter / cqRunContentFilterPass,
// js/ai-features.js + js/gemini-uploads.js), just offered as a fourth
// pre-extraction toggle alongside AI Answering / Fill Choices / Refine
// Questions so it can run automatically right after extraction instead of
// needing a trip into the editor afterward. Needs its own reference-source
// files rather than reusing AI Answering's cqAiSourceFiles — that source is
// optional there, but Content Filter's is mandatory, so the two can't
// safely share one list. ──
let cqContentFilterToggle = false; // whether to AI-filter every extracted question against a reference source
let cqFilterSourceFiles = []; // required source images/PDFs for Content Filter (array of {file, mimeType, name})

// ── Split quiz into multiple quizzes ──
let cqSplitState = null;
// shape when active: { context: 'preview'|'saved', quizId: null|string,
// mode: 'equal'|'custom'|'visual', chunkSize: number,
// ranges: [{start:'', end:'', label:''}],
// visualCuts: Set of question indices (0-based) after which to cut,
// visualLabels: {cutIndex: string} — label for each resulting part }

// ── Inline editing of an already-saved custom quiz ──
let cqEditingQuizId = null; // id of the saved quiz currently being edited, or null
let cqEditQuestions = null; // working copy of that quiz's questions while the editor is open

// Where the inline editor above is currently mounted: the normal Custom
// Quizzes modal, or the admin panel's "My Custom Quizzes" list. Controls
// which container id the editor renders into and which screen refreshes
// itself once the editor closes or saves.
let cqEditorContext = 'quiz'; // 'quiz' | 'admin'

// ── Writing a brand-new quiz by hand (no AI) — reuses the same editor
// as above, just starts from a blank slate instead of an existing quiz ──
let cqCreatingNew = false; // true while the "write your own" composer is open
let cqNewQuizTitle = ''; // title for the quiz currently being composed

// ── Taking multiple saved custom quizzes together in one sitting ──
let cqMultiSelected = new Set(); // ids of saved quizzes checked for a combined run

function setCQMode(mode) {
  cqMode = mode;
  renderCustomQuizModal();
}

/* Renders the staged-files list inside a dropzone, with a per-file remove
   button, for any of the multi-file upload areas. */
function _cqFileListHTML(items, removeFnName, fileAccessor) {
  if (!items || !items.length) return '';
  const getFile = fileAccessor || (x => x);
  return `<div class="cq-dz-filelist">` + items.map((it, idx) => {
    const f = getFile(it);
    return `
    <div class="cq-dz-file-item">
      <span><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${escapeHtml(f.name)} <span style="opacity:.65;">(${formatBytes(f.size)})</span></span>
      <button type="button" onclick="event.stopPropagation();${removeFnName}(${idx})" title="Remove this file">✕</button>
    </div>
  `;
  }).join('') + `</div>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* -- Case / vignette clusters, with optional nested "sub-cases" --
   Some source documents present one shared stem/case/image and then several
   questions that all refer back to it without repeating that context. The
   question whose own text/image actually presents that case is the "core"
   (root) question of the group; every other member is a "dependent" that
   points at it via case_group. There is deliberately no separate/duplicated
   case-text field to keep in sync — the core question's own "question" and
   "image" fields ARE the case, so editing the core question (including its
   correct answer) just means editing that question itself, and every place
   that reads it below reads it live off that same object — there's only
   ever one place that can drift, and nothing here ever caches a stale copy.

   NESTING: a dependent question can ALSO itself be a shared sub-context for
   further questions — e.g. the main vignette leads to one question, one of
   whose own follow-up lab results is itself shared by two more questions
   underneath it. To express that, a member that has others nested under it
   gets a `case_link_id` (a stable id, scoped to this one case_group,
   lazily assigned the first moment something is linked under it), and
   each of ITS dependents records that id in its own `case_parent_id`. A
   member with no `case_parent_id` is a direct child of the group's root
   core — exactly today's (pre-nesting) behavior, so old data with neither
   field needs no migration at all. There's no depth limit: a `case_link_id`
   holder can itself have `case_parent_id` pointing further up, and so on —
   see _cqCaseAncestorChain() for walking that all the way to the root. */

let _cqGroupPrefixCounter = 0;
function _cqNextGroupPrefixId() { return ++_cqGroupPrefixCounter; }

/* Returns the ROOT (top-level) core question for whichever group `q`
   belongs to — could be `q` itself. null if `q` isn't grouped or its group
   currently has no root core assigned. */
function _cqFindCoreQuestion(questions, q) {
  if (!q || !q.case_group) return null;
  if (q.case_is_core) return q;
  return questions.find(o => o.case_group === q.case_group && o.case_is_core) || null;
}

/* Resolves `q`'s DIRECT parent in its case tree: the specific sub-case it's
   explicitly nested under (case_parent_id → another member's case_link_id),
   or — if it has no case_parent_id, or that id doesn't currently resolve to
   an actual member of the SAME group (e.g. a dangling reference left over
   after deleting the sub-case it pointed at) — the group's root core.
   Returns null for the root itself, or for a standalone/ungrouped question. */
function _cqFindCaseParent(questions, q) {
  if (!q || !q.case_group || q.case_is_core) return null;
  if (q.case_parent_id) {
    const p = questions.find(o => o.case_group === q.case_group && o.case_link_id === q.case_parent_id);
    if (p && p !== q) return p;
  }
  return _cqFindCoreQuestion(questions, q);
}

/* Full ancestor chain for `q`, ROOT FIRST down to (but excluding) `q`
   itself — e.g. for a question nested two levels deep this is
   [rootCore, immediateParentSubCase]. Empty for the root itself or a
   standalone question. Cycle-safe (see _cqNormalizeCaseParents — the editor
   UI never lets a cycle form, but this still won't hang if data is somehow
   corrupted, e.g. hand-edited JSON). */
function _cqCaseAncestorChain(questions, q) {
  const chain = [];
  const seen = new Set();
  let cur = _cqFindCaseParent(questions, q);
  while (cur && !seen.has(cur)) {
    chain.unshift(cur);
    seen.add(cur);
    if (cur.case_is_core) break;
    cur = _cqFindCaseParent(questions, cur);
  }
  return chain;
}

/* True if `q` is itself a shared sub-context for at least one other member
   of its group — i.e. a "sub-case", not just a plain dependent. The
   top-level root is never reported as a sub-case even if it has children;
   it's just "the case". Purely informational (used for editor-UI labels);
   nothing below needs to distinguish "sub-case" from "plain leaf" to build
   correct context, since the ancestor chain walk covers either shape. */
function _cqIsSubCase(questions, q) {
  if (!q || !q.case_group || !q.case_link_id) return false;
  return questions.some(o => o !== q && o.case_group === q.case_group && o.case_parent_id === q.case_link_id);
}

/* Every question directly or transitively nested under `q` (its whole
   subtree, excluding `q` itself) — used only to stop the editor UI from
   letting the user pick a target that would create a cycle (nesting a
   question under its own descendant). */
function _cqCaseDescendants(questions, q) {
  if (!q || !q.case_group) return [];
  const gid = q.case_group;
  const out = [];
  const visit = (node) => {
    questions.forEach(o => {
      if (o.case_group !== gid || o === node) return;
      if (_cqFindCaseParent(questions, o) === node) { out.push(o); visit(o); }
    });
  };
  visit(q);
  return out;
}

/* Assigns `q` a stable case_link_id if it doesn't have one yet (needed the
   first moment something else gets nested under it), and returns it. */
function _caseGroupEnsureLinkId(q) {
  if (!q.case_link_id) q.case_link_id = 'node_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  return q.case_link_id;
}

/* The shared image for a case cluster: the NEAREST ancestor (immediate
   parent first, walking outward to the root) that actually has an image —
   so a question nested under a sub-case with its own distinct image (say,
   a specific lab panel) gets THAT image rather than always the outermost
   case's, while still falling back outward if the immediate context has
   none of its own. Nothing is duplicated onto siblings (which would bypass
   the Firestore image-subcollection pipeline used for saved/shared/
   published quizzes and could bloat those documents) — this only ever
   reads whichever ancestor's own "image" field is currently set. */
function _cqFindCaseGroupImage(questions, q) {
  if (!q || !q.case_group || q.case_is_core) return null;
  const chain = _cqCaseAncestorChain(questions, q); // root .. immediate parent
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].image) return chain[i].image;
  }
  return null;
}

/* One case-context level's own answer choices, each explicitly labeled
   CORRECT or WRONG — reads q.options/q.answer live, so an edit to the
   correct answer (on any ancestor level, at any depth) is reflected the
   very next time this runs; nothing here is ever cached or snapshotted. */
function _cqCaseLevelAnswerBlock(q) {
  const entries = getOptionEntries(q);
  if (!entries.length) return '';
  return entries.map(([k, v]) => ` ${k}. ${v} — ${k === q.answer ? 'CORRECT' : 'WRONG'}`).join('\n');
}

/* Shared helper for every AI feature (solve, explain, chat, and the
   lightweight per-question AI tools) that needs to give the model the case
   context a dependent question belongs to — now walking the FULL ancestor
   chain, so a question nested several sub-cases deep gets every level, not
   just the immediate one. Returns '' for standalone questions and for the
   root core itself (its own "question" text already IS the case, so it
   needs no prefix).

   Each level is clearly labeled as background CONTEXT ONLY — including its
   own correct/wrong answers, so the model can use that reasoning without
   ever mistaking a context question's answer for the actual question's
   answer, or restating/re-asking a context question as if it were the real
   one — and the block ends with an explicit "end of context" line right
   before the caller appends the real question. This is also what keeps a
   multi-level nested case from confusing the model: it sees the whole
   chain top-down, each one explicitly numbered by level, so "the shared
   case" (level 1) and "the specific sub-case this question depends on"
   (the deepest level) are never conflated with each other or with the
   actual question. */
function _cqCaseContextBlock(questions, q) {
  if (!q || !q.case_group || q.case_is_core) return '';
  const chain = _cqCaseAncestorChain(questions, q).filter(lvl => lvl.question && lvl.question.trim());
  if (!chain.length) return '';
  const parts = chain.map((lvl, idx) => {
    const label = idx === 0
      ? 'Shared case/vignette this question belongs to'
      : `Nested sub-case within the above (level ${idx + 1}) that this question specifically depends on`;
    const ansBlock = _cqCaseLevelAnswerBlock(lvl);
    return `${label} — BACKGROUND CONTEXT ONLY, this is NOT a separate question you are being asked here:\n"""${lvl.question.trim()}"""\n`
      + (ansBlock ? `Its own answer choices (for context/reasoning only — do not restate, re-ask, or grade these; they belong to this context question, not to the actual question below):\n${ansBlock}\n` : '');
  });
  return parts.join('\n') + '\n— End of shared case context. The ACTUAL question you must act on now follows below, entirely separately from everything above. —\n\n';
}

function _cqNormalizeCaseGroups(questions) {
  const byGroup = {};
  questions.forEach(q => {
    if (q.case_group) (byGroup[q.case_group] = byGroup[q.case_group] || []).push(q);
  });
  Object.entries(byGroup).forEach(([gid, members]) => {
    if (members.length < 2) {
      members.forEach(q => { q.case_group = null; q.case_is_core = false; q.case_link_id = null; q.case_parent_id = null; });
      delete byGroup[gid];
    }
  });
  // Every surviving group must have EXACTLY one core question (the one that
  // holds the case/image the others depend on) — never zero, never more
  // than one, so shuffling and display always know which question to lead
  // the group with and which question's text/image to pull as context.
  Object.keys(byGroup).forEach(gid => {
    _caseGroupEnsureSingleCore(questions, gid);
    _cqNormalizeCaseParents(questions, byGroup[gid]);
  });
}

/* Repairs case_parent_id references within one group: drops any that point
   at a case_link_id which doesn't belong to THIS group, or at the question
   itself (a 1-node cycle) — falling back to "direct child of the root",
   exactly like a never-set case_parent_id. Also breaks any longer circular
   parent chain (A under B under A) the same way. The editor UI (see
   _caseGroupSetParent/_caseGroupSetCore below) never lets either situation
   arise in the first place, but this keeps the tree well-formed regardless
   — e.g. after a hand-edited JSON import, or a deleted sub-case leaving its
   former children's case_parent_id pointing at nothing. */
function _cqNormalizeCaseParents(questions, members) {
  const byLinkId = {};
  members.forEach(q => { if (q.case_link_id) byLinkId[q.case_link_id] = q; });
  members.forEach(q => {
    if (q.case_is_core || !q.case_parent_id) return;
    const target = byLinkId[q.case_parent_id];
    if (!target || target === q) q.case_parent_id = null;
  });
  members.forEach(q => {
    if (q.case_is_core || !q.case_parent_id) return;
    const seen = new Set([q]);
    let cur = byLinkId[q.case_parent_id];
    while (cur && !cur.case_is_core) {
      if (seen.has(cur)) { q.case_parent_id = null; return; } // cycle — cut here, falls back to root
      seen.add(cur);
      cur = cur.case_parent_id ? byLinkId[cur.case_parent_id] : null;
    }
  });
}

/* Ensures the case group `gid` has exactly one member with case_is_core
   true. If none are marked core, promotes the first member in current
   array order (usually the one that physically presents the case). If more
   than one is marked core (e.g. after a manual edit), keeps only the first
   and demotes the rest. Shared by both auto-extraction normalization and
   the manual case-link editors below. */
function _caseGroupEnsureSingleCore(questions, gid) {
  if (!gid) return;
  const members = questions.filter(q => q.case_group === gid);
  if (!members.length) return;
  const cores = members.filter(q => q.case_is_core);
  if (cores.length === 1) return;
  members.forEach(q => { q.case_is_core = false; });
  members[0].case_is_core = true;
}

/* -- Manual case-group linking --
   Auto-detection during extraction gets the shared case/vignette/image
   right most of the time, but not always — and grouping is also useful
   for quizzes that weren't extracted at all (typed by hand, or edited
   later). These helpers add a small "<svg class="sicon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Case Link" control to every
   question card in BOTH inline editors (the extraction review screen and
   the generic admin quiz editor) so the user can see which question is the
   root case-holder, which questions depend on it (directly, or nested
   under one of ITS dependents, to any depth), and freely create/join/
   leave/re-nest a group before saving — using the same case_group /
   case_is_core / case_link_id / case_parent_id fields the automatic
   detection uses, so both paths stay fully compatible. There's nothing
   else to edit here: the case IS the core question (or, for a nested
   level, the sub-case question), so changing it just means editing that
   question directly. */

// Registry so the shared functions below can operate on whichever
// editor invoked them, without duplicating this logic per editor.
const _caseGroupEditors = {
  cq: {
    getQuestions: () => cqGeneratedQuestions,
    rerender: () => renderCQPreview()
  },
  admin: {
    getQuestions: () => adminEditQuestions,
    rerender: () => renderAdminQuestionEditor(_adminEditorContainerId())
  },
  customQuiz: {
    getQuestions: () => cqEditQuestions,
    rerender: () => renderCustomQuizEditor()
  }
};

/* ── Bulk (whole-quiz) AI Tools for the Admin and Custom-Quiz editors ──
   Mirrors the AI Solve / Fill Choices / Refine Questions passes already
   available during Custom Quiz MCQ Extraction, but scoped to a quiz
   someone is editing after the fact — same underlying bulk functions
   (cqAiSolveQuestions / cqBulkFillChoices / cqBulkRefineQuestions), just
   pointed at whichever editor's live "questions" array via the registry
   above. Runs strictly one question at a time and locks the whole editor
   (every per-question AI button, plus reordering/add/delete/save) for the
   duration, since these functions mutate the same question objects the
   per-question tools do — running them concurrently would race. */
// 'cq' (the extraction preview) is included alongside 'admin' and
// 'customQuiz' so the whole-quiz AI Tools panel — and the preview-only
// Re-extract Missing Images tool below — can run there too, in case
// the user forgot to hit the per-question AI buttons during extraction.
const _editorBulkBusy = { admin: false, customQuiz: false, cq: false };
// Which bulk tool ('Solve' | 'Fill' | 'Refine' | 'Reextract') is currently
// running, per editor — lets the Stop button next to just that tool's
// button show up, while its sibling tools stay merely disabled (they
// can't run at the same time anyway; _editorBulkGuard enforces that).
// 'Reextract' only ever applies to the 'cq' editor (see
// _editorBulkReextractImages) — the other editors simply never set it.
const _editorBulkActiveTool = { admin: null, customQuiz: null, cq: null };
// One cancel token per editor, live only while a bulk pass is running —
// see _stopAllAiProcesses() and the menu-close guard (_guardedClose).
const _editorBulkCancelToken = { admin: null, customQuiz: null, cq: null };
const _editorBulkAiSourceFiles = { admin: [], customQuiz: [], cq: [] };
// Same shape as above, but this is Content Filter's own reference-source
// store — kept separate from AI Solve All's because Content Filter
// REQUIRES a source (see _editorBulkContentFilter) while AI Solve All's
// is optional, so the two tools can't safely share one file list. Same
// dropzone component and file-handling code renders/drives both (see
// _editorBulkSourceStore() and friends below) — just pointed at whichever
// store its toolKey resolves to.
const _editorBulkFilterSourceFiles = { admin: [], customQuiz: [], cq: [] };
const _editorBulkRefineInstructions = { admin: '', customQuiz: '', cq: '' };

function _editorBulkStatusEl(editorKey) {
  return document.getElementById(`${editorKey}BulkAiStatus`);
}

// True if any single-question AI tool (Refine / Fill / Add Choice / Solve)
// is mid-run anywhere in this editor — blocks a bulk pass from starting
// underneath it, and vice versa (bulk locks disable those buttons too).
function _aiToolsAnyBusyInEditor(editorKey) {
  return Object.keys(_aiToolsBusy).some(k => k.startsWith(editorKey + '_'));
}

function _aiToolsSetAllDisabledForEditor(editorKey, disabled) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions) return;
  questions.forEach((_, i) => {
    _aiToolsButtonIds(editorKey, i).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  });
}

function _editorBulkSetBusy(editorKey, busy, tool) {
  _editorBulkBusy[editorKey] = busy;
  _editorBulkActiveTool[editorKey] = busy ? tool : null;
  // 'Reextract' only ever exists for the 'cq' editor — looking up its
  // button/stop-button ids on 'admin'/'customQuiz' just finds nothing and
  // no-ops, same as any other editor-specific id would.
  ['Solve', 'Filter', 'Fill', 'Refine', 'Reextract'].forEach(name => {
    const btn = document.getElementById(`${editorKey}Bulk${name}Btn`);
    if (btn) btn.disabled = busy;
    const stopBtn = document.getElementById(`${editorKey}Bulk${name}StopBtn`);
    if (stopBtn) stopBtn.style.display = (busy && tool === name) ? 'inline-block' : 'none';
  });
  const lockWrap = document.getElementById(`${editorKey}BulkLockWrap`);
  if (lockWrap) lockWrap.classList.toggle('cq-bulk-lock', busy);
  _aiToolsSetAllDisabledForEditor(editorKey, busy);
}

/* Stops whichever bulk (whole-quiz) AI tool is currently running in this
   editor. Only one can run at a time per editor (_editorBulkGuard), so no
   tool name is needed — same hard, immediate abort as every other Stop
   button (see _cancelAiToken). */
function _editorBulkStopTool(editorKey) {
  _cancelAiToken(_editorBulkCancelToken[editorKey]);
}

// Each bulk tool gets its own row with its own button PLUS (if it takes
// options) its own labeled sub-menu directly under that button — so it's
// never ambiguous which instructions belong to which tool. These are bulk,
// whole-quiz versions of the same AI Solve / Fill Choices / Refine actions
// available per-question, plus Content Filter (bulk-only, no per-question
// equivalent); every tool here still runs one question at a time under the
// hood, applying its action to each question in the quiz.
function _renderBulkAiToolsPanel(editorKey, questions) {
  const busy = _editorBulkBusy[editorKey];
  const activeTool = _editorBulkActiveTool[editorKey];
  const n = questions.length;
  const statusId = `${editorKey}BulkAiStatus`;
  // Restores the spinner/progress box immediately if this panel gets
  // rebuilt mid-run (e.g. switching API keys via Manage APIs while a
  // bulk Solve/Fill/Refine pass is still going) — otherwise only the Stop
  // button (driven by live busy state) would show, with a blank box below
  // it until the in-flight request happens to finish. See js/dom-utils.js.
  const cachedStatus = busy ? getCachedStatusHTML(statusId) : '';
  return `
  <div class="cq-bulk-ai-panel">
    <div class="cq-bulk-ai-title"><svg class="micon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI Tools — Whole Quiz
      <span style="font-weight:600;opacity:.7;">(${n} question${n !== 1 ? 's' : ''})</span>
    </div>
    <div class="cq-bulk-ai-subtitle">Each tool below runs on every question in this quiz. Open a tool's <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> to set instructions for that tool only.</div>

    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkSolveBtn" type="button"
          ${busy ? 'disabled' : ''} onclick="_editorBulkAiSolve('${editorKey}')"
          style="background:#1565C0;color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI Solve All</button>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkSolveStopBtn"
          style="${busy && activeTool === 'Solve' ? 'display:inline-block;' : ''}"
          title="Stop AI Solve All" onclick="_editorBulkStopTool('${editorKey}')"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
      </div>
      <details class="cq-bulk-ai-opts">
        <summary><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> AI Solve settings</summary>
        <div style="margin-top:8px;">
          <div class="cq-bulk-ai-label"><svg class="sicon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Reference source (optional) — upload images/PDFs for the AI to use, or leave empty to answer from general knowledge</div>
          <div class="cq-dropzone cq-dz-purple" id="${editorKey}BulkSolveSourceDropzone"
            style="${busy ? 'pointer-events:none;opacity:.55;' : ''}"
            onclick="document.getElementById('${editorKey}BulkSolveSourceFileInput').click()">
            <div class="cq-dz-icon"><svg class="hicon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
            <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
            ${_editorBulkSourceFileListHTML(editorKey, 'Solve', _editorBulkAiSourceFiles[editorKey])}
            ${_editorBulkAiSourceFiles[editorKey].length ? `<div class="cq-dz-add-more"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Click again to add more files</div>` : ''}
          </div>
          <input type="file" id="${editorKey}BulkSolveSourceFileInput" accept="image/*,application/pdf" multiple style="display:none;" ${busy ? 'disabled' : ''}
            onchange="_editorBulkSourceFileSelect('${editorKey}', 'Solve', this)">
          <div class="cq-bulk-ai-scope">Used only by <svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI Solve All — no effect on Fill Choices, Refine Questions, or Content Filter. Any source added here is also selectable per-question (as "Editor bulk source").</div>
        </div>
      </details>
    </div>

    ${_renderBulkContentFilterToolHTML(editorKey, busy, activeTool)}

    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkFillBtn" type="button"
            ${busy ? 'disabled' : ''} onclick="_editorBulkFillChoices('${editorKey}')"
            style="background:var(--unanswered-fg);color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Fill Choices (All)</button>
          ${_renderAiThinkingToggle('fillBulk', 'amber')}
        </div>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkFillStopBtn"
          style="${busy && activeTool === 'Fill' ? 'display:inline-block;' : ''}"
          title="Stop Fill Choices" onclick="_editorBulkStopTool('${editorKey}')"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
        <span class="cq-bulk-ai-no-opts">Tops up missing answer choices.</span>
      </div>
    </div>

    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkRefineBtn" type="button"
            ${busy ? 'disabled' : ''} onclick="_editorBulkRefineQuestions('${editorKey}')"
            style="background:var(--violet-dark);color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Questions (All)</button>
          ${_renderAiThinkingToggle('refineBulk', 'violet')}
        </div>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkRefineStopBtn"
          style="${busy && activeTool === 'Refine' ? 'display:inline-block;' : ''}"
          title="Stop Refine Questions" onclick="_editorBulkStopTool('${editorKey}')"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
      </div>
      <details class="cq-bulk-ai-opts">
        <summary><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Refine Questions settings</summary>
        <div style="margin-top:8px;">
          <div class="cq-bulk-ai-label"><svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Custom instructions for Refine (optional)</div>
          <textarea class="cq-textarea" rows="2" id="${editorKey}BulkRefineInput" ${busy ? 'disabled' : ''}
            oninput="_editorBulkRefineInstructions['${editorKey}'] = this.value"
            placeholder="e.g. keep each question to one sentence">${escapeHtml(_editorBulkRefineInstructions[editorKey] || '')}</textarea>
          <div class="cq-bulk-ai-scope">Used only by <svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Questions (All) — no effect on AI Solve or Fill Choices.</div>
        </div>
      </details>
    </div>
    ${editorKey === 'cq' ? _renderBulkReextractToolHTML(editorKey, questions, busy, activeTool) : ''}

    <div id="${statusId}" style="margin-top:8px;">${cachedStatus}</div>
  </div>`;
}

// Content Filter — bulk-only, no per-question equivalent (unlike Solve/
// Fill/Refine, which are also available one question at a time). Checks
// every question against a REQUIRED reference source and drops any
// question the AI could only answer from its own knowledge, i.e. not
// found in that source — a way to weed out off-topic or unsourced
// questions from a quiz in one pass. Deliberately reuses AI Solve All's
// own engine under the hood (cqAiSolveQuestions — see
// _editorBulkContentFilter in this file) rather than a separate answer-
// checking implementation, since "does the source contain this
// question's answer" is exactly what that engine already determines
// per question via found_in_source. The two tools stay fully
// independent in the UI, though: this one has its own reference-source
// dropzone (toolKey 'Filter', so it never shares files or state with AI
// Solve All's), and its own required-source validation, since a filter
// pass run with no source would just be Solve All in disguise, silently
// discarding every question it couldn't verify from thin air. The
// result also never shows the solve-flavoured "AI-answered"/"AI Guess"
// batch progress or per-question badges Solve All uses — a question
// either survives the filter or it doesn't, so nothing about how it
// each was scored is left to inspect afterward.
function _renderBulkContentFilterToolHTML(editorKey, busy, activeTool) {
  const files = _editorBulkFilterSourceFiles[editorKey];
  return `
    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkFilterBtn" type="button"
          ${busy ? 'disabled' : ''} onclick="_editorBulkContentFilter('${editorKey}')"
          title="Removes any question the AI can't answer from the source below"
          style="background:var(--wrong-fg);color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Content Filter</button>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkFilterStopBtn"
          style="${busy && activeTool === 'Filter' ? 'display:inline-block;' : ''}"
          title="Stop Content Filter" onclick="_editorBulkStopTool('${editorKey}')"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
      </div>
      <details class="cq-bulk-ai-opts" open>
        <summary><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Content Filter source</summary>
        <div style="margin-top:8px;">
          <div class="cq-bulk-ai-label"><svg class="sicon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Reference source (required) — upload images/PDFs; any question the AI can only answer from outside this source gets removed</div>
          <div class="cq-dropzone cq-dz-purple" id="${editorKey}BulkFilterSourceDropzone"
            style="${busy ? 'pointer-events:none;opacity:.55;' : ''}"
            onclick="document.getElementById('${editorKey}BulkFilterSourceFileInput').click()">
            <div class="cq-dz-icon"><svg class="hicon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
            <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
            ${_editorBulkSourceFileListHTML(editorKey, 'Filter', files)}
            ${files.length ? `<div class="cq-dz-add-more"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Click again to add more files</div>` : ''}
          </div>
          <input type="file" id="${editorKey}BulkFilterSourceFileInput" accept="image/*,application/pdf" multiple style="display:none;" ${busy ? 'disabled' : ''}
            onchange="_editorBulkSourceFileSelect('${editorKey}', 'Filter', this)">
          <div class="cq-bulk-ai-scope">${files.length ? '' : '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Content Filter won\'t run until at least one file is uploaded here. '}Used only by <svg class="sicon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Content Filter — separate from AI Solve All's source above, and has no effect on Fill Choices or Refine Questions.</div>
        </div>
      </details>
    </div>`;
}


// question Gemini flagged as has_image but never successfully cropped —
// the same " AI detected an image… couldn't extract it" case shown per-
// question below (see _canReextract in renderCQPreview). Grouped and
// requested per SOURCE FILE via extractImagesForQuestions, exactly like
// the initial extraction pass (which itself batches
// GEMINI_BOUNDING_BOX_BATCH_SIZE image-bearing questions per request) —
// deliberately NOT a per-question loop making one request per image. See
// cqBulkReextractMissingImages in js/gemini-uploads.js for the batching.
function _renderBulkReextractToolHTML(editorKey, questions, busy, activeTool) {
  const missing = questions.filter(q => q.has_image && !q.image && q._sourceFile && !q._notExtractable).length;
  return `
    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkReextractBtn" type="button"
          ${busy || !missing ? 'disabled' : ''} onclick="_editorBulkReextractImages('${editorKey}')"
          title="${missing ? `Re-run image extraction for ${missing} question${missing !== 1 ? 's' : ''} still missing an image` : 'No questions are currently missing an extractable image'}"
          style="background:var(--accent);color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Re-extract Missing Images${missing ? ` (${missing})` : ''}</button>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkReextractStopBtn"
          style="${busy && activeTool === 'Reextract' ? 'display:inline-block;' : ''}"
          title="Stop Re-extract Missing Images" onclick="_editorBulkStopTool('${editorKey}')"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
        <span class="cq-bulk-ai-no-opts">Retries only questions flagged with an image that never got extracted — grouped and requested per source file, same batching as extraction itself.</span>
      </div>
    </div>`;
}

// Shared guard for all three bulk actions below: refuses to start if a bulk
// pass is already running in this editor, if any single-question AI tool is
// mid-run, or if there's no active API key — surfacing whichever applies in
// the bulk status box before anything else touches the DOM.
function _editorBulkGuard(editorKey) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions.length) return null;
  const statusEl = _editorBulkStatusEl(editorKey);
  if (_editorBulkBusy[editorKey] || _aiToolsAnyBusyInEditor(editorKey)) {
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML('Another AI action is already running — please wait for it to finish.');
    return null;
  }
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML('Add a Gemini API key (<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> API Keys) to use AI tools.');
    return null;
  }
  return { ed, questions };
}

// Which reference-source file store a bulk tool's dropzone reads/writes —
// keyed by the same tool name used everywhere else in this panel ('Solve'
// or 'Filter') — so AI Solve All and Content Filter can each have their
// own independent dropzone, sharing all the same rendering/handling code
// below without their files or DOM ids colliding.
function _editorBulkSourceStore(toolKey) {
  return toolKey === 'Filter' ? _editorBulkFilterSourceFiles : _editorBulkAiSourceFiles;
}

// Renders the staged reference files for a bulk panel's dropzone, with a
// per-file remove button — same shape/markup as every other reference-
// source dropzone in the app, just keyed by editor (and which tool's
// dropzone this is) instead of by question.
function _editorBulkSourceFileListHTML(editorKey, toolKey, files) {
  if (!files || !files.length) return '';
  return `<div class="cq-dz-filelist">` + files.map((f, idx) => `
    <div class="cq-dz-file-item">
      <span><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${escapeHtml(f.name)}</span>
      <button type="button" onclick="event.stopPropagation();_editorBulkSourceRemoveFile('${editorKey}', '${toolKey}', ${idx})" title="Remove this file">✕</button>
    </div>`).join('') + `</div>`;
}
// Shared validation with every other reference-source dropzone in the app
// (extraction's cqSourceDropzone, the per-question source library form).
function _editorBulkSourceAcceptFile(editorKey, toolKey, file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) { alert(`"${file.name}" isn't an image or PDF — please upload an image (JPG/PNG/WEBP) or a PDF file.`); return; }
  if (file.size > GEMINI_MAX_FILE_BYTES) { alert(`"${file.name}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API, so it can't be used.`); return; }
  const mimeType = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');
  _editorBulkSourceStore(toolKey)[editorKey].push({ file, mimeType, name: file.name });
}
function _editorBulkSourceFileSelect(editorKey, toolKey, input) {
  const files = Array.from((input && input.files) || []);
  files.forEach(f => _editorBulkSourceAcceptFile(editorKey, toolKey, f));
  input.value = '';
  _editorBulkRerender(editorKey);
}
function _editorBulkSourceRemoveFile(editorKey, toolKey, idx) {
  _editorBulkSourceStore(toolKey)[editorKey].splice(idx, 1);
  _editorBulkRerender(editorKey);
}
// Wires drag&drop on both of the bulk panel's reference dropzones (AI
// Solve All's and Content Filter's). Called after every full render of
// the editor (the panel is rebuilt via innerHTML each time, same as every
// other dropzone in this file, so there's no stale-listener risk).
function _editorBulkSourceSetupDropzone(editorKey) {
  ['Solve', 'Filter'].forEach(toolKey => {
    const dz = document.getElementById(`${editorKey}Bulk${toolKey}SourceDropzone`);
    if (!dz) return;
    ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over');
    }));
    dz.addEventListener('drop', e => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      files.forEach(f => _editorBulkSourceAcceptFile(editorKey, toolKey, f));
      _editorBulkRerender(editorKey);
    });
  });
}
// Re-renders the whole editor so the dropzone reflects the updated file
// list — mirrors every other add/remove handler in these editors (reorder,
// delete, image change, etc. all go through ed.rerender() too).
function _editorBulkRerender(editorKey) {
  const ed = _caseGroupEditors[editorKey];
  if (ed && ed.rerender) ed.rerender();
}

async function _editorBulkAiSolve(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;
  _editorBulkSetBusy(editorKey, true, 'Solve');
  // Real per-run cancel token — this is what _stopAllAiProcesses() cancels via
  // _editorBulkCancelToken[editorKey]. Without creating and passing this down,
  // that cancel call had nothing to cancel: the loop below kept running for
  // real in the background even after the user confirmed "stop it".
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  // Self-healing + auto-caching (see js/dom-utils.js) — this loop writes
  // progress across many `await`s, and the panel can be rebuilt mid-run.
  const statusEl = liveStatusRef(`${editorKey}BulkAiStatus`, `${editorKey}BulkAiStatus`);
  statusEl.innerHTML = _cqProgressStatusHTML('<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI is solving all questions…', 0);
  let finalHtml;
  try {
    const sourceFiles = _editorBulkAiSourceFiles[editorKey] || [];
    const allIdxs = questions.map((q, i) => i).filter(i => questions[i] && questions[i].question && questions[i].question.trim());
    await cqAiSolveQuestions(questions, allIdxs, '', sourceFiles, statusEl, token);
    finalHtml = token.cancelled
      ? `<div class="cq-status warning"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> AI Solve stopped.</div>`
      : `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> AI Solve finished — ${allIdxs.length} question${allIdxs.length !== 1 ? 's' : ''} checked.</div>`;
  } catch (e) {
    finalHtml = _aiToolsErrorHTML(e.message || 'AI Solve failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Solve');
    _markQuestionEditDirty();
    ed.rerender();
    // ed.rerender() just rebuilt this panel from scratch, and — since it's no
    // longer "busy" — with a blank status box (see cachedStatus in
    // _renderBulkAiToolsPanel: it only restores from cache while busy).
    // Setting finalHtml straight onto statusEl above would've been wiped out
    // by that same rerender a moment later, so it's applied here instead,
    // after the rebuild, onto the fresh element that now actually exists.
    _aiToolsSetStatusById(`${editorKey}BulkAiStatus`, finalHtml);
  }
}

/* Small pill flagging a question Content Filter couldn't confidently
   resolve either way after repeated retries — see cqRunContentFilterPass
   in js/gemini-uploads.js (changelog #131) for how a question ends up
   here: only ones that stayed genuinely "uncertain" round after round,
   never a confident reject (those are deleted, not flagged) or a
   confident keep (those get no badge at all). Deliberately a distinct
   rose/pink color (--review-*, css/styles.css) rather than reusing the
   amber "AI Guess" badge — this means something different: "the AI
   couldn't decide even after several tries," not "the AI guessed once."
   Purely informational; nothing here clears the flag automatically —
   editing, re-running Content Filter, or deleting the question are the
   ways to resolve it. */
function _renderContentFilterReviewBadge(q) {
  if (!q || !q.content_filter_flagged) return '';
  return `<span title="Content Filter couldn't confidently confirm or rule this out after several tries — please check it against the source by hand"
      style="background:var(--review-pale);color:var(--review-fg);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--review-border-strong);"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Needs Review</span>`;
}

/* ── Content Filter — bulk pass that removes any question the AI is
   CONFIDENT it can only answer from its own knowledge, not from the
   required reference source, and gives genuinely borderline calls
   repeated second looks before giving up on them (see changelog #131).
   Deliberately layered on top of AI Solve All's own engine
   (cqAiSolveQuestions) rather than a separate answer-checking
   implementation, since "was this question's answer found in the
   source" is exactly what that engine already reports per question via
   its strict-mode source_verdict/ai_guessed/ai_uncertain — Content
   Filter just acts on that result instead of only recording it. A
   question also gets its answer double-checked against the source in
   the process, same as an AI Solve All pass would do, since that's an
   unavoidable side effect of asking the same question — but that answer
   is discarded, never applied (see cqRunContentFilterPass). Requires at
   least one reference-source file, unlike AI Solve All — an "AI's own
   knowledge" fallback here would make this indistinguishable from a
   pass that filters out nothing.

   Shows the same live "(batch N of M)" progress bar Solve All does —
   cqRunContentFilterPass re-words cqAiSolveQuestions' own per-batch text
   to "Checking questions against the source…" for round 1 and
   "Re-checking questions still in doubt (round N)…" for every retry
   round (see _cqContentFilterProgressLabel/_cqContentFilterRoundLabel in
   js/gemini-uploads.js) — and no ai_answered/ai_guessed/ai_uncertain is
   left behind on any question once the whole pass finishes. A question
   either made it through cleanly (no badge), got permanently removed
   (confident reject), or — if it stayed genuinely uncertain through
   every retry — gets `content_filter_flagged` and the "Needs Review"
   badge above instead of being deleted on unresolved doubt. ── */
async function _editorBulkContentFilter(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;

  const sourceFiles = _editorBulkFilterSourceFiles[editorKey] || [];
  if (!sourceFiles.length) {
    const statusEl = _editorBulkStatusEl(editorKey);
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML('Content Filter needs a reference source — upload at least one image or PDF under "Content Filter source" above, then try again.');
    return;
  }

  _editorBulkSetBusy(editorKey, true, 'Filter');
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  // Self-healing + auto-caching (see js/dom-utils.js) — this loop writes
  // progress across many `await`s, and the panel can be rebuilt mid-run.
  const statusEl = liveStatusRef(`${editorKey}BulkAiStatus`, `${editorKey}BulkAiStatus`);
  statusEl.innerHTML = _cqProgressStatusHTML('<svg class="sicon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Checking questions against the source…', 0);

  let finalHtml;
  try {
    // Actual filtering logic lives in cqRunContentFilterPass (js/gemini-uploads.js),
    // shared with the pre-extraction "Content Filter (AI)" toggle so it
    // only exists in one place. Passing statusEl through gives this the
    // same live "(batch N of M)" progress bar Solve All shows.
    const { removed, remaining, needsReview } = await cqRunContentFilterPass(questions, sourceFiles, token, statusEl);
    finalHtml = token.cancelled
      ? `<div class="cq-status warning"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Content Filter stopped${removed ? ` — ${removed} question${removed !== 1 ? 's' : ''} already removed before stopping` : ''}.</div>`
      : `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Content Filter finished — ${removed} question${removed !== 1 ? 's' : ''} removed, ${remaining} remain${remaining === 1 ? 's' : ''}${needsReview ? `, ${needsReview} flagged "Needs Review" (moved to the end)` : ''}.</div>`;
  } catch (e) {
    finalHtml = _aiToolsErrorHTML(e.message || 'Content Filter failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Filter');
    _markQuestionEditDirty();
    ed.rerender();
    // See the matching comment in _editorBulkAiSolve() above for why
    // finalHtml is applied here, after the rebuild, rather than directly
    // onto `statusEl` above.
    _aiToolsSetStatusById(`${editorKey}BulkAiStatus`, finalHtml);
  }
}

async function _editorBulkFillChoices(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;
  _editorBulkSetBusy(editorKey, true, 'Fill');
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  // Self-healing + auto-caching (see js/dom-utils.js) — this loop writes
  // progress across many `await`s, and the panel can be rebuilt mid-run.
  const statusEl = liveStatusRef(`${editorKey}BulkAiStatus`, `${editorKey}BulkAiStatus`);
  statusEl.innerHTML = _cqProgressStatusHTML('<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Filling choices…', 0);
  let finalHtml;
  try {
    const { done, errors } = await cqBulkFillChoices(questions, statusEl, token);
    finalHtml = token.cancelled
      ? `<div class="cq-status warning"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Fill Choices stopped — topped up ${done} question${done !== 1 ? 's' : ''} so far.</div>`
      : `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Fill Choices finished — topped up ${done} question${done !== 1 ? 's' : ''}.</div>`;
    if (errors.length) finalHtml += errors.map(e => `<div class="cq-status warning" style="margin-top:4px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escapeHtml(e)}</div>`).join('');
  } catch (e) {
    finalHtml = _aiToolsErrorHTML(e.message || 'Fill Choices failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Fill');
    _markQuestionEditDirty();
    ed.rerender();
    // See matching comment in _editorBulkAiSolve — applied post-rerender so
    // it isn't instantly wiped by the panel rebuild that just happened.
    _aiToolsSetStatusById(`${editorKey}BulkAiStatus`, finalHtml);
  }
}

async function _editorBulkRefineQuestions(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;
  _editorBulkSetBusy(editorKey, true, 'Refine');
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  // Self-healing + auto-caching (see js/dom-utils.js) — this loop writes
  // progress across many `await`s, and the panel can be rebuilt mid-run.
  const statusEl = liveStatusRef(`${editorKey}BulkAiStatus`, `${editorKey}BulkAiStatus`);
  statusEl.innerHTML = _cqProgressStatusHTML('<svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refining question wording…', 0);
  let finalHtml;
  try {
    const custom = (_editorBulkRefineInstructions[editorKey] || '').trim();
    const { done, errors } = await cqBulkRefineQuestions(questions, custom, statusEl, token);
    finalHtml = token.cancelled
      ? `<div class="cq-status warning"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Refine stopped — rewrote ${done} question${done !== 1 ? 's' : ''} so far.</div>`
      : `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Refine finished — rewrote ${done} question${done !== 1 ? 's' : ''}.</div>`;
    if (errors.length) finalHtml += errors.map(e => `<div class="cq-status warning" style="margin-top:4px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escapeHtml(e)}</div>`).join('');
  } catch (e) {
    finalHtml = _aiToolsErrorHTML(e.message || 'Refine failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Refine');
    _markQuestionEditDirty();
    ed.rerender();
    // See matching comment in _editorBulkAiSolve — applied post-rerender so
    // it isn't instantly wiped by the panel rebuild that just happened.
    _aiToolsSetStatusById(`${editorKey}BulkAiStatus`, finalHtml);
  }
}

// Preview-only (cq) — see _renderBulkReextractToolHTML above and
// cqBulkReextractMissingImages in js/gemini-uploads.js. Shares the exact
// same guard/busy-lock/cancel-token/rerender machinery as
// _editorBulkFillChoices and _editorBulkRefineQuestions above; the only
// difference is which underlying bulk function it calls.
async function _editorBulkReextractImages(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;
  _editorBulkSetBusy(editorKey, true, 'Reextract');
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  // Self-healing + auto-caching (see js/dom-utils.js) — this loop writes
  // progress across many `await`s, and the panel can be rebuilt mid-run.
  const statusEl = liveStatusRef(`${editorKey}BulkAiStatus`, `${editorKey}BulkAiStatus`);
  statusEl.innerHTML = _cqProgressStatusHTML('<svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Re-extracting missing images…', 0);
  let finalHtml;
  try {
    const { done, errors, skipped } = await cqBulkReextractMissingImages(questions, statusEl, token);
    finalHtml = token.cancelled
      ? `<div class="cq-status warning"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Re-extract Missing Images stopped — recovered ${done} image${done !== 1 ? 's' : ''} so far.</div>`
      : `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Re-extract Missing Images finished — recovered ${done} image${done !== 1 ? 's' : ''}.</div>`;
    if (skipped) finalHtml += `<div class="cq-status warning" style="margin-top:4px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Skipped ${skipped} question${skipped !== 1 ? 's' : ''} with no traceable source file (hand-typed or merged in from another quiz) — upload an image manually for those instead.</div>`;
    if (errors.length) finalHtml += errors.map(e => `<div class="cq-status warning" style="margin-top:4px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escapeHtml(e)}</div>`).join('');
  } catch (e) {
    finalHtml = _aiToolsErrorHTML(e.message || 'Re-extract Missing Images failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Reextract');
    _markQuestionEditDirty();
    ed.rerender();
    // See matching comment in _editorBulkAiSolve — applied post-rerender so
    // it isn't instantly wiped by the panel rebuild that just happened.
    _aiToolsSetStatusById(`${editorKey}BulkAiStatus`, finalHtml);
  }
}

/* Swaps question `i` with its neighbor (dir: -1 = up, +1 = down) in
   whichever editor invoked it, via the registry above. Case-group links
   are matched by id rather than array position, so reordering never
   breaks a linked case cluster — it just changes display order. */
function _editorMoveQuestion(editorKey, i, dir) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions) return;
  const j = i + dir;
  if (j < 0 || j >= questions.length) return;
  [questions[i], questions[j]] = [questions[j], questions[i]];
  _markQuestionEditDirty();
  ed.rerender();
}

/* Moves question `i` to a specific 1-based position typed into the number
   input `inputId` — useful for reordering in large quizzes where nudging
   one spot at a time with ▲▼ would take forever. The target is clamped to
   [1, questions.length] so it can never be pushed past either end. */
function _editorMoveQuestionTo(editorKey, i, inputId) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions) return;
  const input = document.getElementById(inputId);
  if (!input) return;
  let target = parseInt(input.value, 10);
  if (!target || isNaN(target)) return;
  target = Math.max(1, Math.min(target, questions.length)); // never allow a number bigger than the quiz
  const j = target - 1;
  if (j === i) return;
  const [moved] = questions.splice(i, 1);
  questions.splice(j, 0, moved);
  _markQuestionEditDirty();
  ed.rerender();
}

/* Renders the ▲▼ reorder buttons plus a "jump to position" number input
   for one question card. */
function _renderReorderButtons(editorKey, i, total) {
  const upDisabled = i === 0;
  const downDisabled = i === total - 1;
  const inputId = `_moveQNumInput_${editorKey}_${i}`;
  return `<button class="cq-edit-reask-btn" title="Move up" type="button"
      onclick="_editorMoveQuestion('${editorKey}', ${i}, -1)" ${upDisabled ? 'disabled' : ''}
      style="padding:2px 8px;${upDisabled ? 'opacity:.35;cursor:not-allowed;' : ''}">▲</button>
    <button class="cq-edit-reask-btn" title="Move down" type="button"
      onclick="_editorMoveQuestion('${editorKey}', ${i}, 1)" ${downDisabled ? 'disabled' : ''}
      style="padding:2px 8px;${downDisabled ? 'opacity:.35;cursor:not-allowed;' : ''}">▼</button>
    <span style="display:inline-flex;align-items:center;gap:3px;" title="Move this question to a specific number">
      <span style="font-size:.7rem;font-weight:700;color:var(--text-muted);">#</span>
      <input type="number" id="${inputId}" min="1" max="${total}" step="1" value="${i + 1}"
        onkeydown="if(event.key==='Enter'){event.preventDefault();_editorMoveQuestionTo('${editorKey}', ${i}, '${inputId}');}"
        style="width:48px;padding:3px 4px;border:1.5px solid var(--border-soft);border-radius:5px;
          font-family:var(--font);font-size:.72rem;text-align:center;" />
      <button class="cq-edit-reask-btn" title="Move to this number" type="button"
        onclick="_editorMoveQuestionTo('${editorKey}', ${i}, '${inputId}')"
        style="padding:2px 7px;">➜</button>
    </span>`;
}

const _CASE_GROUP_COLORS = ['var(--accent)', 'var(--violet)', 'var(--correct-fg)', 'var(--unanswered-fg)', '#C2185B', '#00838F', '#5D4037', '#616161'];
function _caseGroupColor(gid) {
  let h = 0;
  const s = String(gid);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return _CASE_GROUP_COLORS[h % _CASE_GROUP_COLORS.length];
}

/* Scans a question list and returns, in first-seen order:
   - order: [groupId, ...]
   - labelOf: { groupId: 'Case 1' } — a stable, friendly label for display
   - membersOf: { groupId: [questionIndex, ...] } */
function _caseGroupSummarize(questions) {
  const order = [];
  const membersOf = {};
  (questions || []).forEach((q, idx) => {
    const gid = q && q.case_group;
    if (!gid) return;
    if (!membersOf[gid]) { membersOf[gid] = []; order.push(gid); }
    membersOf[gid].push(idx);
  });
  const labelOf = {};
  order.forEach((gid, i) => { labelOf[gid] = `Case ${i + 1}`; });
  return { order, labelOf, membersOf };
}

function _caseGroupNewId() {
  return 'manual_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/* A short read-only preview of the core question's text, used on dependent
   question cards so the user can see at a glance what context/image will
   actually be sent to the AI solver — without a separate editable copy. */
function _caseGroupCorePreviewText(core, maxLen) {
  const t = (core && core.question || '').trim();
  if (!t) return '(core question has no text yet)';
  return t.length > maxLen ? t.slice(0, maxLen).trim() + '…' : t;
}

/* Renders the " Case Link" control block for one question card.
   editorKey: 'cq' | 'admin' — selects which editor's state to read/write. */
function _renderCaseGroupBlock(editorKey, questions, i) {
  const q = questions[i];
  const { labelOf, membersOf } = _caseGroupSummarize(questions);
  const gid = q.case_group || '';
  const color = gid ? _caseGroupColor(gid) : 'var(--border-soft)';

  const coreLabelFor = (g) => {
    const idxs = membersOf[g] || [];
    const coreIdx = idxs.find(idx => questions[idx].case_is_core);
    const others = idxs.filter(idx => idx !== i)
      .map(idx => `Q${idx + 1}${idx === coreIdx ? ' ★core' : ''}`)
      .join(', ');
    return others || 'empty';
  };

  let optsHtml = `<option value="" ${!gid ? 'selected' : ''}>— Not linked to a case —</option>`;
  Object.keys(membersOf).forEach(g => {
    if (g === gid) return;
    optsHtml += `<option value="${escapeHtml(g)}">${labelOf[g]} (${coreLabelFor(g)})</option>`;
  });
  if (gid) {
    optsHtml += `<option value="${escapeHtml(gid)}" selected>${labelOf[gid]} (${coreLabelFor(gid) === 'empty' ? 'only this question so far' : coreLabelFor(gid)})</option>`;
  }
  optsHtml += `<option value="__new__">＋ Start a new case group…</option>`;

  let html = `<div class="case-link-block" style="margin:8px 0;padding:8px 10px;border-radius:8px;
    border:1.5px dashed ${color};background:${gid ? color + '14' : 'var(--surface-2)'};">`;
  html += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <span style="font-size:.78rem;font-weight:800;color:${gid ? color : 'var(--text-muted)'};white-space:nowrap;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Case Link</span>
    <select style="flex:1;min-width:160px;font-family:var(--font);font-size:.78rem;padding:4px 6px;
      border-radius:6px;border:1.5px solid ${color};background:#fff;color:var(--text-main);"
      onchange="_caseGroupOnSelect('${editorKey}', ${i}, this.value)">
      ${optsHtml}
    </select>
    ${gid ? `<button type="button" class="cq-img-action-btn cq-img-remove-btn" onclick="_caseGroupUnlink('${editorKey}', ${i})">✕ Unlink</button>` : ''}
  </div>`;

  if (gid) {
    const memberIdxs = membersOf[gid] || [];
    const isCore = !!q.case_is_core;
    const others = memberIdxs.filter(idx => idx !== i);
    const childCount = questions.filter(o => o.case_group === gid && _cqFindCaseParent(questions, o) === q).length;
    const hasChildren = childCount > 0;

    html += `<div style="font-size:.72rem;color:${color};font-weight:700;margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">`;
    if (isCore) {
      html += `<span><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Root case question — its own text${q.image ? ' &amp; image' : ''} above is the case every linked question depends on${hasChildren ? ' (directly, or via a nested sub-case)' : ''}</span>`;
    } else {
      const parent = _cqFindCaseParent(questions, q);
      const parentIdx = questions.indexOf(parent);
      // "Depends on" — every OTHER member EXCEPT q's own descendants (nesting
      // a question under its own descendant would create a cycle in the tree).
      const descendants = _cqCaseDescendants(questions, q);
      const candidateIdxs = memberIdxs.filter(idx => idx !== i && !descendants.includes(questions[idx]));
      const parentOptsHtml = candidateIdxs.map(idx => {
        const cand = questions[idx];
        const tag = cand.case_is_core ? ' ★ root case' : (_cqIsSubCase(questions, cand) ? ' sub-case' : '');
        return `<option value="${idx}" ${idx === parentIdx ? 'selected' : ''}>Q${idx + 1}${tag}</option>`;
      }).join('');
      html += `<span>↳ Depends on:</span>
        <select style="font-family:var(--font);font-size:.72rem;padding:2px 6px;border-radius:6px;border:1.5px solid ${color};background:#fff;color:var(--text-main);"
          onchange="_caseGroupSetParent('${editorKey}', ${i}, this.value)">
          ${parentOptsHtml}
        </select>
        <button type="button" class="cq-img-action-btn" style="padding:2px 8px;font-size:.68rem;"
          onclick="_caseGroupSetCore('${editorKey}', ${i})">★ Make this the root case instead</button>`;
    }
    if (hasChildren) {
      html += `<span><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> ${childCount} question${childCount !== 1 ? 's' : ''} nested directly under this one${!isCore ? " — it's a sub-case within the case above" : ''}</span>`;
    }
    html += `</div>`;

    html += `<div style="font-size:.7rem;color:${color};margin-top:2px;">
       Linked with ${others.length ? others.map(idx => 'Q' + (idx + 1) + (questions[idx].case_is_core ? ' ★' : '')).join(', ') : '(no other questions yet — link another question to this case)'}
    </div>`;

    if (!isCore) {
      // Preview EVERY ancestor level (root down to the immediate parent),
      // exactly matching what the AI actually receives for this question —
      // see _cqCaseContextBlock. For a plain (non-nested) dependent this is
      // just one box (the root case); for a question nested several
      // sub-cases deep, one box per level, in order.
      const chain = _cqCaseAncestorChain(questions, q);
      html += chain.map(lvl => {
        const lvlIdx = questions.indexOf(lvl);
        return `<div style="margin-top:8px;padding:8px 10px;background:#fff;border:1px solid ${color}55;border-radius:6px;">
          <div style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">
            Context used for solving — Q${lvlIdx + 1}'s own text${lvl.image ? ' + image' : ''}${lvl.case_is_core ? ' (root case)' : ' (nested sub-case)'} — edit Q${lvlIdx + 1} directly to change it
          </div>
          <div style="font-size:.78rem;color:var(--text-main);font-style:italic;">${escapeHtml(_caseGroupCorePreviewText(lvl, 220))}</div>
          ${lvl.image ? `<img src="${lvl.image}" alt="Case context image" style="max-width:140px;max-height:90px;object-fit:contain;display:block;margin-top:6px;border-radius:4px;border:1px solid var(--border-soft-2);" />` : ''}
        </div>`;
      }).join('');
    }
  }
  html += `</div>`;
  return html;
}

function _caseGroupOnSelect(editorKey, i, val) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const q = questions[i];
  const prevGid = q.case_group;
  if (val === '') {
    q.case_group = null; q.case_is_core = false; q.case_link_id = null; q.case_parent_id = null;
  } else if (val === '__new__') {
    q.case_group = _caseGroupNewId();
    q.case_is_core = true; // the question that starts a group is its core by default
    q.case_link_id = null; q.case_parent_id = null;
  } else {
    q.case_group = val;
    q.case_is_core = false; // joining an existing group — it already has a core
    q.case_parent_id = null; // defaults to a direct child of that group's root case; use "Depends on" to nest it deeper
  }
  // The group this question just left (if any) may now have no core left,
  // and anything that was nested under `q` there is now dangling. The group
  // it just joined/started must end up with exactly one core too. Both
  // cases are handled by the same normalization extraction/loading uses.
  if (prevGid && prevGid !== q.case_group) {
    const remaining = questions.filter(o => o.case_group === prevGid);
    _caseGroupEnsureSingleCore(questions, prevGid);
    _cqNormalizeCaseParents(questions, remaining);
  }
  if (q.case_group) {
    const members = questions.filter(o => o.case_group === q.case_group);
    _caseGroupEnsureSingleCore(questions, q.case_group);
    _cqNormalizeCaseParents(questions, members);
  }
  _markQuestionEditDirty();
  ed.rerender();
}

function _caseGroupUnlink(editorKey, i) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const gid = questions[i].case_group;
  questions[i].case_group = null;
  questions[i].case_is_core = false;
  questions[i].case_link_id = null;
  questions[i].case_parent_id = null;
  if (gid) {
    const remaining = questions.filter(o => o.case_group === gid);
    _caseGroupEnsureSingleCore(questions, gid); // promote a remaining member if the core just left
    _cqNormalizeCaseParents(questions, remaining); // re-parent anything that was nested under the question that just left
  }
  _markQuestionEditDirty();
  ed.rerender();
}

/* Re-nests question `i` directly under `targetIdx` — any other member of
   the SAME group, chosen from the "Depends on" dropdown (which already
   excludes q's own descendants, so a cycle can't be requested through the
   UI; this double-checks anyway). Picking the group's root core is the
   same as leaving it unset (a plain, non-nested dependent). Picking any
   other member turns THAT member into a sub-case (lazily assigning it a
   case_link_id the first time something is nested under it) and nests `i`
   under it — this is what lets a case tree grow to any depth the user
   chooses, one link at a time. */
function _caseGroupSetParent(editorKey, i, targetIdxStr) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const q = questions[i];
  const gid = q.case_group;
  if (!gid || q.case_is_core) return;
  const target = questions[parseInt(targetIdxStr, 10)];
  if (!target || target.case_group !== gid || target === q) return;
  if (_cqCaseDescendants(questions, q).includes(target)) return; // would create a cycle — ignore
  q.case_parent_id = target.case_is_core ? null : _caseGroupEnsureLinkId(target);
  _markQuestionEditDirty();
  ed.rerender();
}

/* Manually promotes question `i` to be the ROOT of its own case group,
   demoting whichever question held that role before. */
function _caseGroupSetCore(editorKey, i) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const gid = questions[i].case_group;
  if (!gid) return;
  const members = questions.filter(o => o.case_group === gid);
  members.forEach(o => { o.case_is_core = false; });
  questions[i].case_is_core = true;
  questions[i].case_parent_id = null; // the root never has a parent of its own
  // Promoting a different member to root can turn a previously-valid chain
  // into a cycle (e.g. the OLD root ends up nested somewhere under a
  // question that used to be nested under IT) — repair exactly like any
  // other corrupted chain, falling anything affected back to the new root.
  _cqNormalizeCaseParents(questions, members);
  _markQuestionEditDirty();
  ed.rerender();
}

/* If the question being deleted was the core of a case group — or itself a
   sub-case with its own children — promote/re-parent so the group doesn't
   lose its shared context, or leave a dangling reference, entirely. Called
   by both editors right after splicing a question out. */
function _caseGroupOnQuestionDeleted(questions, deletedQuestion) {
  if (deletedQuestion && deletedQuestion.case_group) {
    const gid = deletedQuestion.case_group;
    const remaining = questions.filter(o => o.case_group === gid);
    _caseGroupEnsureSingleCore(questions, gid);
    _cqNormalizeCaseParents(questions, remaining);
  }
}

