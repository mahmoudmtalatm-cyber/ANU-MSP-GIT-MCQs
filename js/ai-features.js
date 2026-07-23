/* ══════════════════════════════════════════════════════════
   API KEY MANAGER — multiple Gemini API keys, one active
   Single shared place used by AI explanations, chat, and
   custom quizzes (extract / generate / AI-answer / AI-solve).
══════════════════════════════════════════════════════════ */

const AI_EXPLAIN_KEY_STORE = 'anu_msp_gemini_api_key'; // legacy single-key store (used for migration only)
const API_KEYS_STORE       = 'anu_msp_gemini_api_keys_v2';     // [{id,label,key,color}]
const API_ACTIVE_ID_STORE  = 'anu_msp_gemini_active_key_id_v2';

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
      const id  = _apiKeyNewId();
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
  return id;
}
function removeApiKeyById(id) {
  let keys = loadApiKeys();
  keys = keys.filter(k => k.id !== id);
  saveApiKeys(keys);
  if (getActiveApiKeyId() === id) {
    setActiveApiKeyId(keys.length ? keys[0].id : '');
  }
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
}
function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  const dots = Math.min(12, Math.max(4, key.length - 8));
  return key.slice(0, 4) + '•'.repeat(dots) + key.slice(-4);
}

/* Small "🔑 API" button shown under each reviewed question, for quick
   access to the API Key Manager without scrolling back to the top. */
function _apiKeyQuickBtnHTML() {
  const entry = getActiveApiKeyEntry();
  if (!entry) return '🔑 Add API Key';
  return `<span class="apikey-dot" style="background:${entry.color || 'var(--accent)'};"></span> ${escapeHtml(entry.label)}`;
}
function _refreshApiKeyQuickButtons() {
  document.querySelectorAll('.ai-apikey-btn').forEach(btn => {
    btn.innerHTML = _apiKeyQuickBtnHTML();
  });
}

/* ── Legacy wrappers (kept so existing call sites keep working) ── */
function getExplainKey() { return getActiveApiKey(); }
function getGeminiKey()  { return getActiveApiKey(); }
/* No-op setters: key editing now only happens through the API Key Manager. */
function setExplainKey() {}
function setGeminiKey()  {}

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
  // Switching keys is always safe if it's already the active one, or if
  // nothing AI-related is actually running right now.
  if (id !== getActiveApiKeyId()) {
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

/* Switches a key's row into edit mode — always reachable via the ✏️ button
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
  const inp    = document.getElementById('apikeyEditInput_' + id);
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
    html += `<div class="apikey-pending-note">⏳ Pick or add an API key below, then close this window to continue.</div>`;
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

  html += `<div class="apikey-list">`;
  if (!keys.length) {
    html += `<div class="apikey-empty"><span class="ns-icon">🔑</span>No API keys yet — add your first one below.</div>`;
  } else {
    keys.forEach((k, idx) => {
      const isActive = k.id === activeId;
      const isEditing = _apiKeyEditingId === k.id;
      const color = k.color || API_KEY_COLORS[idx % API_KEY_COLORS.length];
      html += `<div class="apikey-item ${isActive ? 'active' : ''}" style="--apikey-color:${color};">
        <div class="apikey-num">${idx + 1}</div>
        <div class="apikey-info">
          <div class="apikey-label-row">
            <div class="apikey-label-display">${escapeHtml(k.label)}</div>
            ${isActive ? `<span class="apikey-active-chip">Active</span>` : ''}
          </div>
          ${isEditing ? `
          <div class="apikey-edit-row">
            <input type="password" id="apikeyEditInput_${k.id}" value="${escapeHtml(k.key)}"
              oninput="this.style.borderColor='var(--border-soft)'" placeholder="Paste new Gemini API key" />
          </div>
          <div id="apikeyEditStatus_${k.id}"></div>
          <div class="apikey-edit-actions">
            <button class="apikey-use-btn" id="apikeyEditSaveBtn_${k.id}" onclick="submitEditApiKey('${k.id}')" type="button">💾 Save</button>
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
          <button class="apikey-edit-btn" onclick="startEditApiKey('${k.id}')" title="Edit this key's value">✏️ Edit</button>
          <button class="apikey-del-btn" onclick="deleteApiKeyPrompt('${k.id}', '${escapeHtml(k.label).replace(/'/g, "&#39;")}')">🗑️</button>
        </div>
        `}
      </div>`;
    });
  }
  html += `</div>`;

  const nextColor = _pickRandomApiKeyColor(keys.map(k => k.color));
  html += `<div class="apikey-add-form" id="apiKeyAddForm" data-color="${nextColor}">
    <div class="cq-section-title" style="margin-bottom:0;">➕ Add a New API Key</div>
    <div style="font-size:.78rem;color:var(--text-muted);font-weight:600;">
      Its name and colour are assigned automatically — just paste your Gemini key below.
    </div>
    <div class="apikey-add-row">
      <input type="password" id="apikeyValueInput" placeholder="Paste your Gemini API key here" oninput="this.style.borderColor='var(--border-soft)'" style="flex:1;min-width:180px;" />
    </div>
    <div id="apikeyAddStatus"></div>
    <button class="apikey-save-btn" id="apikeyAddBtn" onclick="submitNewApiKey()" type="button">💾 Save Key</button>
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
const _explainCache = {};   // { qIndex: 'loading' | html-string }
const _explainRawText = {}; // { qIndex: raw AI text } — used to give chat context
let   _explainAllBusy = false;

// ── Cancellation tokens ──
// Each is a plain object { cancelled: false }.
// explainQuestion sets _singleCancelToken[i] before calling the API.
// explainAllQuestions sets _allCancelToken before the loop.
// Stopping checks these between retries and after awaits.
const _singleCancelToken = {};   // { [qIndex]: { cancelled: bool } }
let   _allCancelToken    = null; // { cancelled: bool } | null

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

// ── Shared explanation pool (Firestore-backed, session-isolated) ──
// At the start of each result session we snapshot the pool so concurrent users
// don't interfere with each other while reviewing.  New generations update
// Firestore immediately but other in-progress sessions are unaffected.
let _explainSessionPool = {}; // { questionHash: { text, html } } — frozen at session start
let _explainPoolLoadPromise = null; // resolves once the pool snapshot for the current results view is ready

async function _qHash(text) {
  // Fast deterministic hash for question text used as Firestore document ID
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function _loadExplainPool(questions) {
  // Snapshot Firestore explanations for all questions in this quiz into session memory.
  // Called once when results are built — isolates this reviewer from concurrent updates.
  _explainSessionPool = {};
  if (!window._db) return;
  try {
    await Promise.all(questions.map(async (q) => {
      try {
        const hash = await _qHash(q.question);
        const ref  = window._doc(window._db, 'explanations', hash);
        const snap = await window._getDoc(ref);
        if (snap.exists()) {
          const d = snap.data();
          _explainSessionPool[hash] = { text: d.text || '', html: d.html || '' };
        }
      } catch(e) { /* non-fatal */ }
    }));
  } catch(e) { /* non-fatal */ }
}

async function _saveExplainToPool(questionText, rawText, html) {
  // Save to Firestore and update local session pool
  try {
    const hash = await _qHash(questionText);
    _explainSessionPool[hash] = { text: rawText, html };
    if (!window._db) return;
    const ref = window._doc(window._db, 'explanations', hash);
    await window._setDoc(ref, cleanForFirestore({ text: rawText, html, updatedAt: Date.now() }));
  } catch(e) { /* non-fatal */ }
}

async function _getExplainFromPool(questionText) {
  // Returns { text, html } if cached in session pool, else null
  try {
    const hash = await _qHash(questionText);
    return _explainSessionPool[hash] || null;
  } catch(e) { return null; }
}

/* ── Build Gemini prompt for one question ── */
function buildExplainPrompt(questions, q, userAnswer) {
  const optLines = getOptionEntries(q)
    .map(([k, v]) => `  ${k}. ${v}`)
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

Be as brief as possible while keeping every piece of medical reasoning — cut words, never cut content. Use plain text only — no markdown, no bullet points, no asterisks.`;
}

/* ── Render the "no active API key" prompt inside an explain panel ── */
function renderExplainKeyPrompt(panelEl, onSave, errorMsg) {
  panelEl.innerHTML = `
    <div class="ai-explain-panel">
      <div class="ai-explain-panel-header">
        <span>🔑</span> Gemini API Key Required
      </div>
      <div class="ai-explain-panel-body">
        <div class="ai-key-prompt">
          <div class="ai-key-prompt-title">${errorMsg ? escapeHtml(errorMsg) : 'Add a Gemini API key to enable AI explanations'}</div>
          <div class="ai-key-prompt-sub">Add, choose, or manage your keys in one place — the API Key Manager.</div>
          <div class="ai-key-prompt-row">
            <button onclick="openApiKeyManager(() => { const p = this && this.closest ? this.closest('.ai-explain-panel') : null; })" style="width:100%;justify-content:center;" type="button">🔑 Open API Key Manager</button>
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

/* ── Render an explanation (own or shared) into its panel, with a Regenerate control ── */
function displayExplainPanel(i, html) {
  const panel = document.getElementById(`explainPanel_${i}`);
  if (!panel) return;
  panel.innerHTML = html + `
    <div class="ai-explain-regen-row" style="padding:6px 16px 14px;text-align:right;">
      <button class="ai-explain-regen-btn" onclick="regenerateExplanation(${i})" style="background:none;border:1.5px solid var(--accent);color:var(--accent);border-radius:6px;padding:4px 10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font);">🔄 Regenerate</button>
    </div>`;
}

/* ── Force a fresh AI explanation, bypassing the shared pool and any cached copy ── */
function regenerateExplanation(i) {
  if (_explainCache[i] === 'loading') return;
  _explainCache[i]   = undefined;
  _explainRawText[i] = undefined;
  const panel = document.getElementById(`explainPanel_${i}`);
  if (panel) panel.innerHTML = '';
  explainQuestion(i, true);
}

/* ── Core: fetch explanation for one question index ── */
async function explainQuestion(i, forceRegenerate = false) {
  const btn    = document.getElementById(`explainBtn_${i}`);
  const panel  = document.getElementById(`explainPanel_${i}`);
  if (!btn || !panel) return;

  if (!forceRegenerate) {
    // Already shown — toggle off
    if (_explainCache[i] && _explainCache[i] !== 'loading') {
      if (panel.innerHTML.trim()) { panel.innerHTML = ''; btn.innerHTML = '🤖 Explain'; return; }
      displayExplainPanel(i, _explainCache[i]);
      btn.innerHTML = '🤖 Hide';
      return;
    }
    if (_explainCache[i] === 'loading') return;
  }

  const q = currentQuestions[i];

  if (!forceRegenerate) {
    // Shared explanation pool — if another user already generated this explanation,
    // reuse it instantly (no API key required).
    if (_explainPoolLoadPromise) { try { await _explainPoolLoadPromise; } catch(e) {} }
    const pooled = await _getExplainFromPool(q.question);
    if (pooled && pooled.html) {
      _explainCache[i] = pooled.html;
      _explainRawText[i] = pooled.text;
      displayExplainPanel(i, pooled.html);
      btn.innerHTML = '🤖 Hide';
      return;
    }
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
  btn.innerHTML = '⏳ Explaining…';

  const loadingHTML = () => `
    <div class="ai-explain-panel">
      <div class="ai-explain-panel-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span style="display:flex;align-items:center;gap:8px;">
          <div class="ai-exp-spinner"></div>
          Getting AI explanation…
        </span>
        <button onclick="stopExplainQuestion(${i})" style="background:var(--wrong-fg);color:white;border:none;border-radius:6px;padding:4px 10px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--font);flex-shrink:0;">⏹ Stop</button>
      </div>
    </div>`;

  panel.innerHTML = loadingHTML();

  try {
    const userAnswer = userAnswers[i] || '';
    const prompt     = buildExplainPrompt(currentQuestions, q, userAnswer);
    const url        = geminiEndpoint();

    // Build parts — prepend the question's image if it has one, or fall back
    // to the case group's shared image (i.e. the core question's image) when
    // this is a dependent question in a case cluster.
    const parts = [];
    const explainImg = q.image || _cqFindCaseGroupImage(currentQuestions, q);
    if (explainImg) {
      const base64 = explainImg.split(',')[1] || '';
      const mime   = explainImg.match(/^data:([^;]+)/)?.[1] || 'image/png';
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }
    parts.push({ text: prompt });

    const data = await callGeminiWithRetry(url, {
      contents: [{ parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
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
      if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '🤖 Explain'; }
      return;
    }

    const html = renderExplainText(text, q);
    _explainCache[i] = html;
    _explainRawText[i] = text;

    displayExplainPanel(i, html);
    const b = document.getElementById(`explainBtn_${i}`);
    if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '🤖 Hide'; }

    // Share this explanation so other users reviewing the same question get it instantly
    _saveExplainToPool(q.question, text, html);

  } catch(err) {
    if (err._cancelled) {
      // User stopped — reset quietly
      _explainCache[i] = null;
      const p = document.getElementById(`explainPanel_${i}`);
      if (p) p.innerHTML = '';
      const b = document.getElementById(`explainBtn_${i}`);
      if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '🤖 Explain'; }
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
            <div class="ai-explain-panel-header"><span>⚠️</span> Explanation failed</div>
            <div class="ai-explain-panel-body">
              <div class="ai-exp-error">${escapeHtml(err.message || String(err))}</div>
            </div>
          </div>`;
      }
    }
    const b = document.getElementById(`explainBtn_${i}`);
    if (b) { b.disabled = false; b.classList.remove('loading'); b.innerHTML = '🤖 Explain'; }
  }
}

/* ── Parse AI text into structured HTML ── */
function renderExplainText(text, q) {
  // Build a lookup map: option key → { label, cls }
  const sectionMeta = {};
  sectionMeta['__overview__'] = { label: 'Question Overview', cls: 'question-label' };
  sectionMeta['__correct__']  = { label: `✔ Correct — ${q.answer}. ${q.options[q.answer] || ''}`, cls: 'correct-label' };
  getOptionEntries(q).forEach(([k, v]) => {
    if (k !== q.answer) {
      sectionMeta[`__wrong_${k}__`] = { label: `✘ Wrong — ${k}. ${v}`, cls: 'wrong-label' };
    }
  });

  // Build a single regex that matches ANY of the known headers, capturing which key matched.
  // We use a unified scan: find every header occurrence in the text, tag it, then sort by position.
  const headerDefs = [
    { key: '__overview__', re: /QUESTION\s+OVERVIEW\s*:/i },
    { key: '__correct__',  re: /CORRECT\s+ANSWER\s*(?:—|-|–)?[^:\n]*:/i },
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
  let html = '<div class="ai-explain-panel"><div class="ai-explain-panel-header"><span>🤖</span> AI Explanation</div><div class="ai-explain-panel-body">';

  if (hits.length === 0) {
    // Parsing found nothing — show raw text as fallback
    html += `<div class="exp-section"><div>${escapeHtml(text)}</div></div>`;
  } else {
    hits.forEach((hit, idx) => {
      const bodyStart = hit.headerEnd;
      const bodyEnd   = idx + 1 < hits.length ? hits[idx + 1].start : text.length;
      const body      = text.slice(bodyStart, bodyEnd).trim();
      const meta      = sectionMeta[hit.key];
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
  if (btn) { btn.disabled = false; btn.innerHTML = '🤖 Explain All'; }
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
  _allCancelToken  = batchToken;

  const btn = document.getElementById('explainAllBtn');
  if (btn) {
    btn.disabled = false; // keep it clickable so it acts as Stop
    btn.innerHTML = '⏹ Stop All';
    btn.onclick   = stopExplainAll;
  }

  for (let i = 0; i < currentQuestions.length; i++) {
    // Bail out if the batch was cancelled between questions
    if (batchToken.cancelled) break;

    // Skip already-explained
    if (_explainCache[i] && _explainCache[i] !== 'loading') {
      const p = document.getElementById(`explainPanel_${i}`);
      if (p && !p.innerHTML.trim()) displayExplainPanel(i, _explainCache[i]);
      const b = document.getElementById(`explainBtn_${i}`);
      if (b) b.innerHTML = '🤖 Hide';
      continue;
    }

    _explainCache[i] = undefined;
    await explainQuestion(i);  // explainQuestion manages its own _singleCancelToken

    // If cancelled mid-question, stop the batch
    if (batchToken.cancelled) break;

    // If a key prompt appeared, pause the batch and let the user enter a key
    const panel = document.getElementById(`explainPanel_${i}`);
    if (panel && panel.querySelector('#explainKeyInput')) {
      _explainAllBusy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '🤖 Explain All'; btn.onclick = explainAllQuestions; }
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
  _allCancelToken  = null;
  if (btn) {
    btn.disabled  = false;
    btn.innerHTML = batchToken.cancelled ? '🤖 Explain All' : '🤖 Explained ✓';
    btn.onclick   = explainAllQuestions;
  }
}

/* ══════════════════════════════════════════════════════════
   AI CHAT — per-question chat with attachments
══════════════════════════════════════════════════════════ */
// Model is now configured in one place: GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL
// in gemini-uploads.js (loaded before this file) — see geminiEndpoint().

// Conversation state, keyed by question index
const _chatHistory     = {}; // { qIndex: [{role:'user'|'model', parts:[{text}|{inline_data}|{file_data},_name]}] }
const _chatPending     = {}; // { qIndex: [{file, name, mimeType, previewUrl}] } — attachments staged but not yet sent
const _chatBusy        = {}; // { qIndex: bool }
const _chatCancelToken = {}; // { qIndex: {cancelled:bool} }
const _chatError       = {}; // { qIndex: errorMessage }

/* ── Toggle the chat panel open/closed ── */
function toggleChatPanel(i) {
  const panel = document.getElementById(`chatPanel_${i}`);
  const btn   = document.getElementById(`chatBtn_${i}`);
  if (!panel) return;

  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    panel.innerHTML = '';
    if (btn) btn.innerHTML = '💬 Chat';
    return;
  }

  panel.classList.add('open');
  if (btn) btn.innerHTML = '💬 Hide Chat';
  renderChatPanel(i);
}

/* ── Build the system instruction for the chat, including any existing explanation ── */
function buildChatSystemInstruction(i) {
  const q = currentQuestions[i];
  const userAnswer = userAnswers[i] || '';
  const optLines = getOptionEntries(q).map(([k, v]) => `  ${k}. ${v}`).join('\n');
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

  ctx += `\n\nThe student may attach images or files (e.g. photos of notes, diagrams, or screenshots) — consider their contents when responding. Default to short, direct replies; expand only if the question truly needs it. Plain text only — no markdown, no asterisks.`;
  return ctx;
}

/* ── Render the chat panel UI for question i ── */
function renderChatPanel(i) {
  const panel = document.getElementById(`chatPanel_${i}`);
  if (!panel) return;

  const history = _chatHistory[i] || [];
  const pending = _chatPending[i] || [];
  const busy    = !!_chatBusy[i];
  const error   = _chatError[i];

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
            bodyHTML += `<div class="ai-chat-file-chip">📎 ${escapeHtml(p._name || 'attachment')}</div>`;
          }
        } else if (p.file_data) {
          bodyHTML += `<div class="ai-chat-file-chip">📎 ${escapeHtml(p._name || 'attachment')}</div>`;
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
          <button class="ai-chat-stop-btn" onclick="stopChat(${i})">⏹ Stop</button>
        </div>
      </div>`;
  } else if (error) {
    msgsHTML += `
      <div class="ai-chat-msg model">
        <div class="ai-chat-bubble ai-chat-error">
          <div class="ai-chat-error-row">
            <span>⚠️ ${escapeHtml(error)}</span>
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
      return `<div class="ai-chat-pending-item"><span>📎 ${escapeHtml(a.name)} <span style="opacity:.65;">(${formatBytes(a.file.size)})</span></span><button onclick="removeChatAttachment(${i},${idx})">✕</button></div>`;
    }).join('') + `</div>`;
  }

  panel.innerHTML = `
    <div class="ai-chat-box">
      <div class="ai-chat-header"><span>💬</span> Chat about this question</div>
      <div class="ai-chat-messages" id="chatMessages_${i}">${msgsHTML}</div>
      ${attachHTML}
      <div class="ai-chat-input-row">
        <input type="file" id="chatFileInput_${i}" multiple accept="image/*,.pdf,.txt,.csv" style="display:none" onchange="handleChatFileSelect(${i}, this)" />
        <button class="ai-chat-attach-btn" type="button" title="Attach file" onclick="document.getElementById('chatFileInput_${i}').click()" ${busy ? 'disabled' : ''}>📎</button>
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
      if (p.file_data)   return { file_data: { mime_type: p.file_data.mime_type, file_uri: p.file_data.file_uri } };
      return { text: p.text };
    })
  }));
}

/* ── Send the staged message (text + attachments) ── */
async function sendChatMessage(i) {
  if (_chatBusy[i]) return;

  const input = document.getElementById(`chatTextInput_${i}`);
  const text  = input ? input.value.trim() : '';
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
      const mime   = chatImg.match(/^data:([^;]+)/)?.[1] || 'image/png';
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
      generationConfig: { temperature: 0.4, maxOutputTokens: 1536 }
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
const CQ_KEY           = 'anu_msp_custom_quizzes_v1';
// Model is now configured in one place: GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL
// in gemini-uploads.js (loaded before this file) — see geminiEndpoint().

/* ── PER-USER CACHE for Custom Quizzes ──────────────────────
   These are private, so each user gets their own tiny version
   doc instead of the shared appConfig/cacheVersion doc:
     Server doc : users/{uid}/meta/cacheVersion  { v: <ms> }
     Local keys : anu_msp_cq_full_cache_<uid>
                  anu_msp_cq_full_cache_ver_<uid>
   saveCustomQuizzesList() bumps the doc (and refreshes the local
   cache immediately, so the very next load is already warm).
   loadCustomQuizzesFromFirestore() checks the doc before doing
   the full collection read + per-question image hydration. */
function _cqCacheKey(uid)    { return 'anu_msp_cq_full_cache_' + uid; }
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

let cqSelectedFiles      = []; // array of File — quiz images/PDFs to extract questions from
let cqGeneratedQuestions = null;
let cqGeneratedTitle    = '';
let cqBusy              = false;

// ── Pause / resume (lets the user swap to a different API key mid-run
//    without losing any work already extracted/generated) ──
let cqPauseRequested = false; // user clicked Pause, take effect at next safe checkpoint
let cqIsPaused        = false; // actually sitting paused right now
let cqResumeResolve   = null;  // resolves the in-flight "await" that's holding the loop

// While cqPauseRequested is true but cqIsPaused is still false (i.e. the
// loop hasn't reached its next natural checkpoint yet), the user can click
// a second "pause now" action to skip waiting for that checkpoint — this
// aborts whatever's in flight right now and steps back to the LAST
// completed checkpoint instead, exactly like the automatic rate-limit
// pause fallback already does. Nothing extracted/generated so far is lost;
// only the one file/batch/question in flight is retried once resumed.
let cqPauseSkipRequested = false;

// ── Hard stop (used when the user confirms switching API keys mid-run —
//    unlike Pause, this actually ends the run instead of just holding it) ──
let cqStopRequested = false;  // set true to end the run at the next checkpoint / in-flight request
let cqCancelToken    = null;  // { cancelled: bool } | null — passed to callGeminiWithRetry so an
                               // in-flight request also stops as soon as it comes back

// ── NEW: Generate from lecture state ──
let cqMode              = 'extract'; // 'extract' | 'generate'
let cqLectureFiles      = []; // array of File — lecture material to generate new questions from
let cqCustomPrompt      = '';
let cqQuestionCount     = '';

// ── AI Answering (single menu: master switch + submenu picking exactly
// one behavior — replaces the old separate "AI Answer Mode" / "AI Solve
// All" toggles, which as two independent switches could be turned on
// together and silently conflict) ──
let cqAiAnsweringEnabled = false;    // master on/off for AI answering
let cqAiAnswerSubmode   = 'missing'; // 'missing' (only fill no-key questions) | 'all' (solve/verify every question)
let cqAiAnswerSource    = '';     // kept for compatibility with cqAiSolveQuestions' signature — always '' now that reference sources are files-only (no more paste-text UI)
let cqAiSourceFiles     = [];     // optional source images/PDFs (array of {base64, mimeType, name})

// ── Post-extraction AI polish (Refine Question / Fill Choices) ──
// These reuse the exact same per-question AI tools available in the editor
// (see "AI QUESTION TOOLS" above), just run once automatically across every
// question right after extraction instead of one at a time by hand.
let cqRefineToggle              = false; // whether to AI-refine every extracted question's wording
let cqRefineCustomInstructions  = '';    // optional custom instructions applied to every refine call
let cqFillChoicesToggle         = false; // whether to AI-fill every question up to 4 answer choices

// ── Split quiz into multiple quizzes ──
let cqSplitState = null;
// shape when active: { context: 'preview'|'saved', quizId: null|string,
//   mode: 'equal'|'custom'|'visual', chunkSize: number,
//   ranges: [{start:'', end:'', label:''}],
//   visualCuts: Set of question indices (0-based) after which to cut,
//   visualLabels: {cutIndex: string} — label for each resulting part }

// ── Inline editing of an already-saved custom quiz ──
let cqEditingQuizId = null; // id of the saved quiz currently being edited, or null
let cqEditQuestions = null; // working copy of that quiz's questions while the editor is open

// Where the inline editor above is currently mounted: the normal Custom
// Quizzes modal, or the admin panel's "My Custom Quizzes" list. Controls
// which container id the editor renders into and which screen refreshes
// itself once the editor closes or saves.
let cqEditorContext = 'quiz'; // 'quiz' | 'admin'

// ── Writing a brand-new quiz by hand (no AI) — reuses the same editor
//    as above, just starts from a blank slate instead of an existing quiz ──
let cqCreatingNew  = false; // true while the "write your own" composer is open
let cqNewQuizTitle = '';    // title for the quiz currently being composed

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
      <span>✅ ${escapeHtml(f.name)} <span style="opacity:.65;">(${formatBytes(f.size)})</span></span>
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

/* -- Case / vignette clusters --
   Some source documents present one shared stem/case/image and then several
   questions that all refer back to it without repeating that context. The
   question whose own text/image actually presents that case is the "core"
   question of the group; every other member is a "dependent" that just
   points at it via case_group. There is deliberately no separate/duplicated
   case-text field to keep in sync — the core question's own "question" and
   "image" fields ARE the case, so editing the case just means editing the
   core question itself, and there's only ever one place that can drift. */

let _cqGroupPrefixCounter = 0;
function _cqNextGroupPrefixId() { return ++_cqGroupPrefixCounter; }

/* Returns the core question object for whichever group `q` belongs to
   (could be `q` itself if it IS the core), or null if `q` isn't grouped or
   its group currently has no core assigned. */
function _cqFindCoreQuestion(questions, q) {
  if (!q || !q.case_group) return null;
  if (q.case_is_core) return q;
  return questions.find(o => o.case_group === q.case_group && o.case_is_core) || null;
}

/* The shared image for a case cluster is simply the core question's own
   image — nothing is duplicated onto siblings (which would bypass the
   Firestore image-subcollection pipeline used for saved/shared/published
   quizzes and could bloat those documents). */
function _cqFindCaseGroupImage(questions, q) {
  const core = _cqFindCoreQuestion(questions, q);
  return (core && core.image) ? core.image : null;
}

/* Shared helper for every AI feature (solve, explain, chat) that needs to
   give the model the case/vignette a dependent question belongs to. Returns
   '' for standalone questions and for the core question itself (its own
   "question" text already IS the case, so it needs no prefix). For a
   dependent, returns the core's live question text wrapped with a label,
   ready to prepend to that dependent's own prompt text. */
function _cqCaseContextBlock(questions, q) {
  if (!q || !q.case_group || q.case_is_core) return '';
  const core = _cqFindCoreQuestion(questions, q);
  if (!core || !core.question || !core.question.trim()) return '';
  return 'Shared case/vignette this question belongs to:\n' + core.question.trim() + '\n\n';
}

function _cqNormalizeCaseGroups(questions) {
  const byGroup = {};
  questions.forEach(q => {
    if (q.case_group) (byGroup[q.case_group] = byGroup[q.case_group] || []).push(q);
  });
  Object.entries(byGroup).forEach(([gid, members]) => {
    if (members.length < 2) {
      members.forEach(q => { q.case_group = null; q.case_is_core = false; });
      delete byGroup[gid];
    }
  });
  // Every surviving group must have EXACTLY one core question (the one that
  // holds the case/image the others depend on) — never zero, never more
  // than one, so shuffling and display always know which question to lead
  // the group with and which question's text/image to pull as context.
  Object.keys(byGroup).forEach(gid => _caseGroupEnsureSingleCore(questions, gid));
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
   later). These helpers add a small "🔗 Case Link" control to every
   question card in BOTH inline editors (the extraction review screen and
   the generic admin quiz editor) so the user can see which question is the
   core case-holder, which questions depend on it, and freely create/join/
   leave a group before saving — using the same case_group / case_is_core
   fields the automatic detection uses, so both paths stay fully
   compatible. There's nothing else to edit here: the case IS the core
   question, so changing it just means editing that question directly. */

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
const _editorBulkBusy = { admin: false, customQuiz: false };
// Which bulk tool ('Solve' | 'Fill' | 'Refine') is currently running, per
// editor — lets the Stop button next to just that tool's button show up,
// while its two sibling tools stay merely disabled (they can't run at the
// same time anyway; _editorBulkGuard enforces that).
const _editorBulkActiveTool = { admin: null, customQuiz: null };
// One cancel token per editor, live only while a bulk pass is running —
// see _stopAllAiProcesses() and the menu-close guard (_guardedClose).
const _editorBulkCancelToken = { admin: null, customQuiz: null };
const _editorBulkAiSourceFiles = { admin: [], customQuiz: [] };
const _editorBulkRefineInstructions = { admin: '', customQuiz: '' };

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
  ['Solve', 'Fill', 'Refine'].forEach(name => {
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
// available per-question; every tool here still runs one question at a
// time under the hood, applying its action to each question in the quiz.
function _renderBulkAiToolsPanel(editorKey, questions) {
  const busy = _editorBulkBusy[editorKey];
  const activeTool = _editorBulkActiveTool[editorKey];
  const n = questions.length;
  return `
  <div class="cq-bulk-ai-panel">
    <div class="cq-bulk-ai-title">🤖 AI Tools — Whole Quiz
      <span style="font-weight:600;opacity:.7;">(${n} question${n !== 1 ? 's' : ''})</span>
    </div>
    <div class="cq-bulk-ai-subtitle">Each tool below runs on every question in this quiz. Open a tool's ⚙️ to set instructions for that tool only.</div>

    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkSolveBtn" type="button"
          ${busy ? 'disabled' : ''} onclick="_editorBulkAiSolve('${editorKey}')"
          style="background:#1565C0;color:#fff;">🤖 AI Solve All</button>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkSolveStopBtn"
          style="${busy && activeTool === 'Solve' ? 'display:inline-block;' : ''}"
          title="Stop AI Solve All" onclick="_editorBulkStopTool('${editorKey}')">⏹ Stop</button>
      </div>
      <details class="cq-bulk-ai-opts">
        <summary>⚙️ AI Solve settings</summary>
        <div style="margin-top:8px;">
          <div class="cq-bulk-ai-label">📚 Reference source (optional) — upload images/PDFs for the AI to use, or leave empty to answer from general knowledge</div>
          <div class="cq-dropzone cq-dz-purple" id="${editorKey}BulkSourceDropzone"
            style="${busy ? 'pointer-events:none;opacity:.55;' : ''}"
            onclick="document.getElementById('${editorKey}BulkSourceFileInput').click()">
            <div class="cq-dz-icon">🖼️📄</div>
            <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
            ${_editorBulkSourceFileListHTML(editorKey, _editorBulkAiSourceFiles[editorKey])}
            ${_editorBulkAiSourceFiles[editorKey].length ? `<div class="cq-dz-add-more">➕ Click again to add more files</div>` : ''}
          </div>
          <input type="file" id="${editorKey}BulkSourceFileInput" accept="image/*,application/pdf" multiple style="display:none;" ${busy ? 'disabled' : ''}
            onchange="_editorBulkSourceFileSelect('${editorKey}', this)">
          <div class="cq-bulk-ai-scope">Used only by 🤖 AI Solve All — no effect on Fill Choices or Refine Questions. Any source added here is also selectable per-question (as "Editor bulk source").</div>
        </div>
      </details>
    </div>

    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkFillBtn" type="button"
            ${busy ? 'disabled' : ''} onclick="_editorBulkFillChoices('${editorKey}')"
            style="background:var(--unanswered-fg);color:#fff;">🧩 Fill Choices (All)</button>
          ${_renderAiThinkingToggle('fillBulk', 'amber')}
        </div>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkFillStopBtn"
          style="${busy && activeTool === 'Fill' ? 'display:inline-block;' : ''}"
          title="Stop Fill Choices" onclick="_editorBulkStopTool('${editorKey}')">⏹ Stop</button>
        <span class="cq-bulk-ai-no-opts">Tops up missing answer choices.</span>
      </div>
    </div>

    <div class="cq-bulk-ai-tool">
      <div class="cq-bulk-ai-tool-row">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button class="cq-btn cq-btn-secondary" id="${editorKey}BulkRefineBtn" type="button"
            ${busy ? 'disabled' : ''} onclick="_editorBulkRefineQuestions('${editorKey}')"
            style="background:var(--violet-dark);color:#fff;">🪄 Refine Questions (All)</button>
          ${_renderAiThinkingToggle('refineBulk', 'violet')}
        </div>
        <button class="ai-tool-stop-btn" type="button" id="${editorKey}BulkRefineStopBtn"
          style="${busy && activeTool === 'Refine' ? 'display:inline-block;' : ''}"
          title="Stop Refine Questions" onclick="_editorBulkStopTool('${editorKey}')">⏹ Stop</button>
      </div>
      <details class="cq-bulk-ai-opts">
        <summary>⚙️ Refine Questions settings</summary>
        <div style="margin-top:8px;">
          <div class="cq-bulk-ai-label">🪄 Custom instructions for Refine (optional)</div>
          <textarea class="cq-textarea" rows="2" id="${editorKey}BulkRefineInput" ${busy ? 'disabled' : ''}
            oninput="_editorBulkRefineInstructions['${editorKey}'] = this.value"
            placeholder="e.g. keep each question to one sentence">${escapeHtml(_editorBulkRefineInstructions[editorKey] || '')}</textarea>
          <div class="cq-bulk-ai-scope">Used only by 🪄 Refine Questions (All) — no effect on AI Solve or Fill Choices.</div>
        </div>
      </details>
    </div>

    <div id="${editorKey}BulkAiStatus" style="margin-top:8px;"></div>
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
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML('Add a Gemini API key (⚙️ API Keys) to use AI tools.');
    return null;
  }
  return { ed, questions };
}

// Renders the staged reference files for a bulk panel's dropzone, with a
// per-file remove button — same shape/markup as every other reference-
// source dropzone in the app, just keyed by editor instead of by question.
function _editorBulkSourceFileListHTML(editorKey, files) {
  if (!files || !files.length) return '';
  return `<div class="cq-dz-filelist">` + files.map((f, idx) => `
    <div class="cq-dz-file-item">
      <span>✅ ${escapeHtml(f.name)}</span>
      <button type="button" onclick="event.stopPropagation();_editorBulkSourceRemoveFile('${editorKey}', ${idx})" title="Remove this file">✕</button>
    </div>`).join('') + `</div>`;
}
// Shared validation with every other reference-source dropzone in the app
// (extraction's cqSourceDropzone, the per-question source library form).
function _editorBulkSourceAcceptFile(editorKey, file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) { alert(`"${file.name}" isn't an image or PDF — please upload an image (JPG/PNG/WEBP) or a PDF file.`); return; }
  if (file.size > GEMINI_MAX_FILE_BYTES) { alert(`"${file.name}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API, so it can't be used.`); return; }
  const mimeType = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');
  _editorBulkAiSourceFiles[editorKey].push({ file, mimeType, name: file.name });
}
function _editorBulkSourceFileSelect(editorKey, input) {
  const files = Array.from((input && input.files) || []);
  files.forEach(f => _editorBulkSourceAcceptFile(editorKey, f));
  input.value = '';
  _editorBulkRerender(editorKey);
}
function _editorBulkSourceRemoveFile(editorKey, idx) {
  _editorBulkAiSourceFiles[editorKey].splice(idx, 1);
  _editorBulkRerender(editorKey);
}
// Wires drag&drop on the bulk panel's reference dropzone. Called after
// every full render of the editor (the panel is rebuilt via innerHTML
// each time, same as every other dropzone in this file, so there's no
// stale-listener risk).
function _editorBulkSourceSetupDropzone(editorKey) {
  const dz = document.getElementById(`${editorKey}BulkSourceDropzone`);
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    files.forEach(f => _editorBulkSourceAcceptFile(editorKey, f));
    _editorBulkRerender(editorKey);
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
  const statusEl = _editorBulkStatusEl(editorKey);
  if (statusEl) statusEl.innerHTML = _cqProgressStatusHTML('🤖 AI is solving all questions…', 0);
  try {
    const sourceFiles = _editorBulkAiSourceFiles[editorKey] || [];
    const allIdxs = questions.map((q, i) => i).filter(i => questions[i] && questions[i].question && questions[i].question.trim());
    await cqAiSolveQuestions(questions, allIdxs, '', sourceFiles, statusEl, token);
    if (statusEl) statusEl.innerHTML = token.cancelled
      ? `<div class="cq-status warning">⏹ AI Solve stopped.</div>`
      : `<div class="cq-status success">✅ AI Solve finished — ${allIdxs.length} question${allIdxs.length !== 1 ? 's' : ''} checked.</div>`;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML(e.message || 'AI Solve failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Solve');
    _markQuestionEditDirty();
    ed.rerender();
  }
}

async function _editorBulkFillChoices(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;
  _editorBulkSetBusy(editorKey, true, 'Fill');
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  const statusEl = _editorBulkStatusEl(editorKey);
  if (statusEl) statusEl.innerHTML = _cqProgressStatusHTML('🧩 Filling choices…', 0);
  try {
    const { done, errors } = await cqBulkFillChoices(questions, statusEl, token);
    let html = token.cancelled
      ? `<div class="cq-status warning">⏹ Fill Choices stopped — topped up ${done} question${done !== 1 ? 's' : ''} so far.</div>`
      : `<div class="cq-status success">✅ Fill Choices finished — topped up ${done} question${done !== 1 ? 's' : ''}.</div>`;
    if (errors.length) html += errors.map(e => `<div class="cq-status warning" style="margin-top:4px;">⚠️ ${escapeHtml(e)}</div>`).join('');
    if (statusEl) statusEl.innerHTML = html;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML(e.message || 'Fill Choices failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Fill');
    _markQuestionEditDirty();
    ed.rerender();
  }
}

async function _editorBulkRefineQuestions(editorKey) {
  const ctx = _editorBulkGuard(editorKey);
  if (!ctx) return;
  const { ed, questions } = ctx;
  _editorBulkSetBusy(editorKey, true, 'Refine');
  const token = { cancelled: false };
  _editorBulkCancelToken[editorKey] = token;
  const statusEl = _editorBulkStatusEl(editorKey);
  if (statusEl) statusEl.innerHTML = _cqProgressStatusHTML('🪄 Refining question wording…', 0);
  try {
    const custom = (_editorBulkRefineInstructions[editorKey] || '').trim();
    const { done, errors } = await cqBulkRefineQuestions(questions, custom, statusEl, token);
    let html = token.cancelled
      ? `<div class="cq-status warning">⏹ Refine stopped — rewrote ${done} question${done !== 1 ? 's' : ''} so far.</div>`
      : `<div class="cq-status success">✅ Refine finished — rewrote ${done} question${done !== 1 ? 's' : ''}.</div>`;
    if (errors.length) html += errors.map(e => `<div class="cq-status warning" style="margin-top:4px;">⚠️ ${escapeHtml(e)}</div>`).join('');
    if (statusEl) statusEl.innerHTML = html;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _aiToolsErrorHTML(e.message || 'Refine failed.');
  } finally {
    _editorBulkCancelToken[editorKey] = null;
    _editorBulkSetBusy(editorKey, false, 'Refine');
    _markQuestionEditDirty();
    ed.rerender();
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
  const upDisabled   = i === 0;
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

/* Renders the "🔗 Case Link" control block for one question card.
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
    <span style="font-size:.78rem;font-weight:800;color:${gid ? color : 'var(--text-muted)'};white-space:nowrap;">🔗 Case Link</span>
    <select style="flex:1;min-width:160px;font-family:var(--font);font-size:.78rem;padding:4px 6px;
      border-radius:6px;border:1.5px solid ${color};background:#fff;color:var(--text-main);"
      onchange="_caseGroupOnSelect('${editorKey}', ${i}, this.value)">
      ${optsHtml}
    </select>
    ${gid ? `<button type="button" class="cq-img-action-btn cq-img-remove-btn" onclick="_caseGroupUnlink('${editorKey}', ${i})">✕ Unlink</button>` : ''}
  </div>`;

  if (gid) {
    const memberIdxs = membersOf[gid] || [];
    const coreIdx = memberIdxs.find(idx => questions[idx].case_is_core);
    const isCore = !!q.case_is_core;
    const others = memberIdxs.filter(idx => idx !== i);

    html += `<div style="font-size:.72rem;color:${color};font-weight:700;margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">`;
    if (isCore) {
      html += `<span>🧩 Core question — its own text${q.image ? ' &amp; image' : ''} above is the case every linked question depends on</span>`;
    } else if (coreIdx !== undefined) {
      html += `<span>↳ Depends on Q${coreIdx + 1}</span>
        <button type="button" class="cq-img-action-btn" style="padding:2px 8px;font-size:.68rem;"
          onclick="_caseGroupSetCore('${editorKey}', ${i})">★ Make this the core question instead</button>`;
    } else {
      html += `<span>⚠️ No core question set for this case yet</span>
        <button type="button" class="cq-img-action-btn" style="padding:2px 8px;font-size:.68rem;"
          onclick="_caseGroupSetCore('${editorKey}', ${i})">★ Make this the core question</button>`;
    }
    html += `</div>`;

    html += `<div style="font-size:.7rem;color:${color};margin-top:2px;">
      🔗 Linked with ${others.length ? others.map(idx => 'Q' + (idx + 1) + (idx === coreIdx ? ' ★' : '')).join(', ') : '(no other questions yet — link another question to this case)'}
    </div>`;

    if (!isCore && coreIdx !== undefined) {
      const core = questions[coreIdx];
      html += `<div style="margin-top:8px;padding:8px 10px;background:#fff;border:1px solid ${color}55;border-radius:6px;">
        <div style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">
          Context used for solving (Q${coreIdx + 1}'s own text${core.image ? ' + image' : ''}) — edit Q${coreIdx + 1} directly to change it
        </div>
        <div style="font-size:.78rem;color:var(--text-main);font-style:italic;">${escapeHtml(_caseGroupCorePreviewText(core, 220))}</div>
        ${core.image ? `<img src="${core.image}" alt="Core question image" style="max-width:140px;max-height:90px;object-fit:contain;display:block;margin-top:6px;border-radius:4px;border:1px solid var(--border-soft-2);" />` : ''}
      </div>`;
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
    q.case_group = null; q.case_is_core = false;
  } else if (val === '__new__') {
    q.case_group = _caseGroupNewId();
    q.case_is_core = true; // the question that starts a group is its core by default
  } else {
    q.case_group = val;
    q.case_is_core = false; // joining an existing group — it already has a core
  }
  // The group this question just left (if any) may now have no core left;
  // the group it just joined/started must end up with exactly one.
  if (prevGid && prevGid !== q.case_group) _caseGroupEnsureSingleCore(questions, prevGid);
  if (q.case_group) _caseGroupEnsureSingleCore(questions, q.case_group);
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
  if (gid) _caseGroupEnsureSingleCore(questions, gid); // promote a remaining member if the core just left
  _markQuestionEditDirty();
  ed.rerender();
}

/* Manually promotes question `i` to be the core of its own case group,
   demoting whichever question held that role before. */
function _caseGroupSetCore(editorKey, i) {
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const gid = questions[i].case_group;
  if (!gid) return;
  questions.forEach(o => { if (o.case_group === gid) o.case_is_core = false; });
  questions[i].case_is_core = true;
  _markQuestionEditDirty();
  ed.rerender();
}

/* If the question being deleted was the core of a case group, promote a
   remaining member so the group doesn't lose its shared context entirely.
   Called by both editors right after splicing a question out. */
function _caseGroupOnQuestionDeleted(questions, deletedQuestion) {
  if (deletedQuestion && deletedQuestion.case_group) {
    _caseGroupEnsureSingleCore(questions, deletedQuestion.case_group);
  }
}

