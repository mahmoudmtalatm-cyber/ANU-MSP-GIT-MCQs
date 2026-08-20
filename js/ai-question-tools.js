/* ══════════════════════════════════════════════════════════
   AI QUESTION TOOLS — Refine Question / Fill Choices / Add Choice
   Available on every question card, in every question editor
   (extraction review, admin publish/edit, write-your-own custom
   quiz editor) via the shared _caseGroupEditors registry, so this
   is written once and works everywhere without duplication.
══════════════════════════════════════════════════════════ */

// Model is now configured in one place: GEMINI_PRIMARY_MODEL / GEMINI_FALLBACK_MODEL
// in gemini-uploads.js (loaded before this file) — see geminiEndpoint().

/* ── Optional "thinking" toggle for the lightweight AI tools ──
   Refine Question, Fill Choices, Add Choice, and their bulk counterparts
   (bulk Fill Choices, bulk Refine Questions) all disable Gemini's default
   reasoning pass (thinkingConfig: { thinkingBudget: 0 }) because these are
   small, deterministic tasks that don't need it — see the comments at each
   call site for why that was added in the first place.

   This block lets the user opt back INTO thinking, if they'd rather trade
   speed/cost for a chance at higher quality. The two BULK tools
   (fillBulk/refineBulk act on every question in one pass, so there's
   exactly one instance of each button anywhere on the page) share ONE
   persisted value each, same as before: flip it once and it stays flipped
   next time you open the app, and every rendered copy of that same bulk
   checkbox (it can appear in more than one panel) stays in sync.

   The three PER-QUESTION tools (Refine Question / Fill Choices / Add
   Choice) are different: every question card renders its own copy, and
   each one now remembers its OWN on/off state, independently of every
   other question — turning it on for question 3 has no effect on
   question 7, even though both show the same "<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Fill Choices" button.
   That state is keyed by `${editorKey}_${i}_${toolKey}` and lives only in
   memory for the current session (not persisted): a question's index can
   point at a completely different question next time the editor opens
   (after adding/removing/reordering questions), so remembering "index 3
   was ON" across a reload wouldn't reliably mean the question the user
   actually turned it on for. */
const AI_TOOLS_THINKING_STORE = 'aiToolsThinkingSettings';
const _AI_TOOLS_BULK_THINKING_DEFAULTS = {
  fillBulk:     false, // <svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Fill Choices — bulk (post-extraction pass / "Fill Choices (All)")
  refineBulk:   false  // <svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Questions — bulk (post-extraction pass / "Refine Questions (All)")
};
// Which tool keys are per-question (vs. the shared/persisted bulk ones
// above) — checked by every function below to decide which store to use.
const _AI_TOOLS_PER_QUESTION_KEYS = {
  refineSingle: 1, // <svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Question (per-question button)
  fillSingle:   1, // <svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Fill Choices (per-question button)
  addChoice:    1  // <svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Choice (AI) (per-question button)
};
function _aiToolsLoadThinkingSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_TOOLS_THINKING_STORE) || '{}');
    const out = {};
    Object.keys(_AI_TOOLS_BULK_THINKING_DEFAULTS).forEach(k => { out[k] = !!raw[k]; });
    return out;
  } catch (e) {
    return Object.assign({}, _AI_TOOLS_BULK_THINKING_DEFAULTS);
  }
}
let _aiToolsThinkingBulk = _aiToolsLoadThinkingSettings(); // { fillBulk, refineBulk } — persisted
let _aiToolsThinkingByQuestion = {}; // { "<editorKey>_<i>_<toolKey>": true|false } — in-memory only
function _aiToolsThinkingByQuestionKey(toolKey, editorKey, i) { return `${editorKey}_${i}_${toolKey}`; }
function _aiToolsThinkingOn(toolKey, editorKey, i) {
  if (_AI_TOOLS_PER_QUESTION_KEYS[toolKey]) return !!_aiToolsThinkingByQuestion[_aiToolsThinkingByQuestionKey(toolKey, editorKey, i)];
  return !!_aiToolsThinkingBulk[toolKey];
}
/* generationConfig fragment for a given tool (and, for a per-question
   tool, which question) — omit thinkingConfig entirely when the user has
   switched thinking ON (Gemini's own dynamic default then applies, exactly
   like AI Solve already runs today), or force it to 0 when OFF — the
   original, still-default, behaviour. editorKey/i are only meaningful (and
   only need to be passed) for a per-question toolKey. */
function _aiToolsGenConfigExtra(toolKey, editorKey, i) {
  return _aiToolsThinkingOn(toolKey, editorKey, i) ? {} : { thinkingConfig: { thinkingBudget: 0 } };
}
function _aiThinkingCbId(toolKey, editorKey, i) {
  return `aiThinkingCb_${editorKey}_${i}_${toolKey}`;
}
function _aiToolsSetThinking(toolKey, on, editorKey, i) {
  if (_AI_TOOLS_PER_QUESTION_KEYS[toolKey]) {
    // Per-question: update only THIS question's stored state and THIS
    // question's checkbox, found by its own unique id — never touches any
    // other question's checkbox for the same tool.
    _aiToolsThinkingByQuestion[_aiToolsThinkingByQuestionKey(toolKey, editorKey, i)] = !!on;
    const cb = document.getElementById(_aiThinkingCbId(toolKey, editorKey, i));
    if (cb) {
      cb.checked = on;
      const wrap = cb.closest('.ai-thinking-toggle');
      if (wrap) wrap.classList.toggle('ai-thinking-on', on);
    }
    return;
  }
  // Bulk tool: one shared, persisted value — sync every rendered checkbox
  // for THIS tool, wherever it appears (there's normally just one, but a
  // bulk panel can in principle be rendered in more than one place).
  _aiToolsThinkingBulk[toolKey] = !!on;
  try { localStorage.setItem(AI_TOOLS_THINKING_STORE, JSON.stringify(_aiToolsThinkingBulk)); } catch (e) {}
  document.querySelectorAll(`.ai-thinking-cb[data-tool="${toolKey}"]`).forEach(cb => {
    cb.checked = on;
    const wrap = cb.closest('.ai-thinking-toggle');
    if (wrap) wrap.classList.toggle('ai-thinking-on', on);
  });
}
const _AI_THINKING_LABELS = {
  refineSingle: 'Refine Question',
  fillSingle: 'Fill Choices',
  addChoice: 'Add Choice',
  fillBulk: 'Fill Choices (bulk)',
  refineBulk: 'Refine Questions (bulk)'
};
/* Pill-checkbox for one tool. For a BULK toolKey, safe to render many
   times (all copies stay in sync via the querySelectorAll sync above) —
   just call with (toolKey, variant). For a PER-QUESTION toolKey, pass
   editorKey/i too so its state and its checkbox id are scoped to that one
   question only (see the header comment above for why).
   `variant` colors the pill to match the button it belongs to, so it reads
   as part of that specific tool rather than a generic setting floating
   nearby: 'violet' (default, Refine), 'amber' (Fill Choices), 'green'
   (Add Choice). Callers also nest this right next to its own trigger
   button (see _renderAiRefineTools / _renderAiChoiceTools) — color plus
   placement together make the pairing unambiguous even when a Stop button
   sits close by too. */
function _renderAiThinkingToggle(toolKey, variant, extraStyle, editorKey, i) {
  const on = _aiToolsThinkingOn(toolKey, editorKey, i);
  const label = _AI_THINKING_LABELS[toolKey] || toolKey;
  const variantClass = variant && variant !== 'violet' ? ` ai-thinking-${variant}` : '';
  const isPerQuestion = !!_AI_TOOLS_PER_QUESTION_KEYS[toolKey];
  const idAttr = isPerQuestion ? ` id="${_aiThinkingCbId(toolKey, editorKey, i)}"` : '';
  const onchangeArgs = isPerQuestion
    ? `'${toolKey}', this.checked, '${editorKey}', ${i}`
    : `'${toolKey}', this.checked`;
  return `<label class="ai-thinking-toggle${variantClass}${on ? ' ai-thinking-on' : ''}" style="${extraStyle || ''}"
      title="When ON, lets Gemini think before answering for ${escapeHtml(label)}${isPerQuestion ? ' on this question only' : ''} — can improve quality but is slower and uses more tokens. OFF by default, since this task is small and quick enough not to need it.">
    <input type="checkbox" class="ai-thinking-cb" data-tool="${toolKey}"${idAttr} ${on ? 'checked' : ''}
      onchange="_aiToolsSetThinking(${onchangeArgs})">
    <span class="ai-thinking-cb-box"></span>
    <span class="ai-thinking-cb-label"><svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg> Thinking</span>
  </label>`;
}

// Per-question UI state for the "Custom Instructions" box (whether it's
// open, and its draft text) — keyed by `${editorKey}_${i}` since each
// editor keeps its own independent set of question cards.
const _aiToolsCustomPromptText = {};
function _aiToolsKey(editorKey, i) { return editorKey + '_' + i; }

/* ── Per-question AI lock ──
   Refine Question, Fill Choices, Add Choice (AI), and the existing <svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI
   Solve button all mutate the SAME question object. Without a lock, firing
   two of them at once on the same question is a real race: e.g. AI Solve
   could read/settle on a fabricated distractor that Fill Choices is still
   in the middle of writing in, or set an answer letter that Add Choice
   then reassigns to a different option. This lock makes those five actions
   mutually exclusive per question (not per editor) — other questions, and
   other editors, are completely unaffected. */
const _aiToolsBusy = {};
// One cancel token per question (same keying as _aiToolsBusy), live only
// while that question's AI tool call is in flight — see _stopAllAiProcesses()
// and the menu-close guard (_guardedClose).
const _aiToolsCancelToken = {};
// Tracks WHICH action is running per question (e.g. 'refine', 'fillChoices',
// 'addChoice', 'solve') so the spinner can be shown on that one specific
// button, while its siblings are merely disabled (see _aiToolsSyncButtons).
const _aiToolsActiveAction = {};
function _aiToolsIsBusy(editorKey, i) { return !!_aiToolsBusy[_aiToolsKey(editorKey, i)]; }
function _aiToolsSetBusy(editorKey, i, busy, action) {
  const key = _aiToolsKey(editorKey, i);
  if (busy) { _aiToolsBusy[key] = true; _aiToolsActiveAction[key] = action; }
  else { delete _aiToolsBusy[key]; delete _aiToolsActiveAction[key]; }
  _aiToolsSyncButtons(editorKey, i, busy, action);
}
/* Disables/enables every AI-tool button on this specific question card
   while a lock is held, so the user can see (and can't accidentally
   trigger) an overlapping action — success paths also re-render the whole
   card, which naturally restores normal (enabled) buttons anyway.
   Additionally, whichever button actually triggered this run gets a small
   spinning circle inserted into it (via `action`), so it's obvious AT A
   GLANCE which of the several AI tools is the one currently working —
   the other, merely-disabled buttons stay plain. */
function _aiToolsButtonIds(editorKey, i) {
  return [
    `aiRefineBtn_${editorKey}_${i}`,
    `aiRefineInstrCaret_${editorKey}_${i}`,
    `aiAddChoiceBtn_${editorKey}_${i}`,
    `aiFillChoicesBtn_${editorKey}_${i}`,
    `cqAiSolveBtn_${editorKey}_${i}`, // now available in every editor, not just 'cq'
    `aiSolveSrcCaret_${editorKey}_${i}`, // the ▾ source picker toggle next to it
    `aiReextractImageBtn_${editorKey}_${i}`, // <svg class="sicon" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Re-extract Image (currently only rendered in 'cq')
    `aiReextractInstrCaret_${editorKey}_${i}` // its ▾ custom-instructions caret
  ];
}
/* Whether `action` is the specific one currently running on this question
   (as opposed to just "something is busy") — used both by _aiToolsSyncButtons
   below (imperative update at the moment a run starts/ends) and by the
   button templates themselves (_aiToolsBtnActiveClass/_aiToolsBtnSpinnerHTML,
   used in _renderAiRefineTools/_renderAiChoiceTools/renderCQPreview) so the
   correct button still shows its highlight + spinner after a mid-run
   rebuild — e.g. the editor re-renders because the user opened and closed
   <svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage APIs while this action was still running. Without baking this
   into the template too, only the imperative DOM insert would show it, and
   that's wiped out the moment the button's HTML gets replaced wholesale. */
function _aiToolsActionIsActive(editorKey, i, action) {
  return _aiToolsIsBusy(editorKey, i) && _aiToolsActiveAction[_aiToolsKey(editorKey, i)] === action;
}
function _aiToolsBtnActiveClass(editorKey, i, action) {
  return _aiToolsActionIsActive(editorKey, i, action) ? ' cq-edit-reask-btn-active' : '';
}
function _aiToolsBtnSpinnerHTML(editorKey, i, action) {
  return _aiToolsActionIsActive(editorKey, i, action) ? '<span class="ai-btn-spinner"></span>' : '';
}
function _aiToolsSyncButtons(editorKey, i, busy, action) {
  const ids = _aiToolsButtonIds(editorKey, i);
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });

  // Which button id corresponds to which action name.
  const idMap = {
    refine: `aiRefineBtn_${editorKey}_${i}`,
    addChoice: `aiAddChoiceBtn_${editorKey}_${i}`,
    fillChoices: `aiFillChoicesBtn_${editorKey}_${i}`,
    solve: `cqAiSolveBtn_${editorKey}_${i}`,
    reextractImage: `aiReextractImageBtn_${editorKey}_${i}`
  };
  const activeId = action && idMap[action];
  const activeEl = activeId && document.getElementById(activeId);
  if (activeEl) {
    activeEl.classList.toggle('cq-edit-reask-btn-active', busy);
    const existingSpinner = activeEl.querySelector('.ai-btn-spinner');
    if (busy && !existingSpinner) {
      activeEl.insertAdjacentHTML('afterbegin', '<span class="ai-btn-spinner"></span>');
    } else if (!busy && existingSpinner) {
      existingSpinner.remove();
    }
  }

  // Show the Stop button belonging to whichever action just started; hide
  // every other feature's Stop button on this card (only one of these four
  // can ever be running at once per question, thanks to the busy lock).
  const stopIdMap = {
    refine: `aiRefineStopBtn_${editorKey}_${i}`,
    addChoice: `aiAddChoiceStopBtn_${editorKey}_${i}`,
    fillChoices: `aiFillChoicesStopBtn_${editorKey}_${i}`,
    solve: `cqAiSolveStopBtn_${editorKey}_${i}`,
    reextractImage: `aiReextractStopBtn_${editorKey}_${i}`
  };
  Object.values(stopIdMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (busy && id === stopIdMap[action]) ? 'inline-block' : 'none';
  });
}

/* Stops whichever single-question AI tool (Solve / Refine / Add Choice /
   Fill Choices) is currently running on this specific question, without
   touching any other question or editor. Mirrors _cancelAiToken's hard,
   immediate abort — the in-flight request is cut right away, not just
   flagged to stop at its next checkpoint. */
function _aiToolsStopAction(editorKey, i) {
  const key = _aiToolsKey(editorKey, i);
  _cancelAiToken(_aiToolsCancelToken[key]);
}
function _aiToolsStatusId(editorKey, i) {
  return `aiToolsStatus_${editorKey}_${i}`;
}
function _aiToolsStatusEl(editorKey, i) {
  return document.getElementById(_aiToolsStatusId(editorKey, i));
}
/* Cached (see js/dom-utils.js) so any status box driven by a per-question
   AI tool can restore its content immediately if the question's card gets
   rebuilt mid-run (e.g. the editor re-renders because the user switched
   API keys via <svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage APIs while the tool was still working) — without
   this, the freshly-rendered card would show a blank status box (just the
   Stop button, since that part is already driven by live busy state) until
   the in-flight request happens to finish. Takes the DOM id directly so it
   also covers status boxes that don't share the standard
   `aiToolsStatus_<editorKey>_<i>` id — e.g. Re-extract Image's own
   `aiReextractStatus_cq_<i>` box (see cqReextractImage in ai-solve.js). */
function _aiToolsSetStatusById(id, html) {
  setCachedStatusHTML(id, html);
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function _aiToolsSetStatus(editorKey, i, html) {
  _aiToolsSetStatusById(_aiToolsStatusId(editorKey, i), html);
}
function _aiToolsLoadingHTML(label) {
  return `<div class="cq-status info" style="font-size:.75rem;padding:5px 10px;">
    <div class="cq-spinner" style="width:12px;height:12px;border-width:2px;"></div> ${label}</div>`;
}
function _aiToolsErrorHTML(msg) {
  return `<div class="cq-status warning" style="font-size:.75rem;padding:5px 10px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escapeHtml(msg)}</div>`;
}
/* Every AI tool call shares the same active Gemini key used everywhere else
   in the app (extraction, AI Solve, explanations) — if none is configured
   yet, point the user at where to add one instead of silently failing. */
function _aiToolsRequireKey(editorKey, i) {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Add a Gemini API key (<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> API Keys) to use AI tools.'));
    return null;
  }
  return apiKey;
}
function _aiCustomPromptChanged(editorKey, i, val) {
  _aiToolsCustomPromptText[_aiToolsKey(editorKey, i)] = val;
  const caret = document.getElementById(`aiRefineInstrCaret_${editorKey}_${i}`);
  if (caret) caret.innerHTML = _aiRefineInstrCaretLabel(editorKey, i) + ' ▾';
}
function _aiRefineInstrCaretLabel(editorKey, i) {
  const draft = (_aiToolsCustomPromptText[_aiToolsKey(editorKey, i)] || '').trim();
  return draft ? '<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Instructions •' : '<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Instructions';
}
/* Strips ```json fences (Gemini sometimes adds them despite the mime type
   request) before parsing — same tolerant pattern used elsewhere in the app.
   On a malformed/truncated response (occasionally the model's output gets
   cut off before finishing, even within these tools' own small token
   budget), this throws a clear, actionable error instead of letting a raw
   native SyntaxError like "Unterminated string in JSON at position 117"
   reach the user. */
function _aiToolsParseJSON(text) {
  const clean = (text || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('The AI response was cut off or malformed — please try again.');
  }
}

/* Builds the "shared case" context that AI Solve/Explain/Chat already use
   (see _cqCaseContextBlock) for the AI Tools too (Refine Question, Fill
   Choices, Add Choice) — WITHOUT this, a dependent question in a case
   cluster hands the model only its own short stub text, with no idea what
   patient scenario/vignette (or accompanying image) it's actually about,
   which can produce distractors or rewording that don't fit the real case.
   Returns { textBlock, imagePart } — textBlock is '' for standalone/core
   questions, imagePart is null if there's no shared (or own) image. */
function _aiToolsCaseContext(questions, q) {
  const textBlock = _cqCaseContextBlock(questions, q);
  const img = q.image || _cqFindCaseGroupImage(questions, q);
  let imagePart = null;
  if (img) {
    const match = img.match(/^data:([^;]+);base64,(.+)$/);
    if (match) imagePart = { mime_type: match[1], data: match[2] };
  }
  return { textBlock, imagePart };
}

/* Renders the " AI Solve" + " Refine Question" toolbar, each with its
   own ▾ caret opening a popover scoped to THAT action only — AI Solve's
   caret picks the source to solve from; Refine's caret holds the custom
   instructions used only when refining. Keeping both as the same
   button+caret+popover shape (rather than one popover and one free-floating
   "Custom Instructions" button) makes it visually unambiguous which
   settings belong to which action. Placed directly under the question
   textarea in every editor. editorKey: 'cq' | 'admin' | 'customQuiz'.
   See aiSolveQuestion()/_toggleAiSourcePicker() and
   aiRefineQuestion()/_toggleAiRefineInstrPicker() further down. */
/* Shared "how was this question answered" pill — shown next to Q<N> in
   every editor that can run AI Solve on a question (post-extraction
   preview, Admin editor, Custom-Quiz editor). Previously this markup only
   existed inline inside the post-extraction preview's render loop
   (js/ai-solve.js), so a question AI-guessed via the Admin or Custom-Quiz
   editor's "AI Solve" (per-question or "AI Solve All") looked identical
   to one answered correctly by hand — nothing there told you to verify
   it. Pulling it out here so all three call it means the badge now stays
   in sync everywhere instead of drifting if only one copy gets updated.
   `no_answer_key` only ever gets set during extraction (see
   js/ai-solve.js), so it's simply never true outside that preview — safe
   to check unconditionally here rather than special-casing editorKey. */
function _renderAiSolveStatusBadge(q) {
  if (!q) return '';
  if (q.ai_guessed) {
    return `<span title="AI answered this from its own knowledge — answer was not found in the provided source. Please verify." style="background:var(--amber-pale);color:var(--unanswered-fg);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--amber-mid);"><svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg> AI Guess</span>`;
  }
  if (q.ai_answered) {
    return `<span title="AI answered this question from the provided source" style="background:var(--violet-pale);color:var(--violet-dark);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--violet-border);"><svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI-answered</span>`;
  }
  if (q.no_answer_key) {
    return `<span title="No answer key found in the PDF — please set the correct answer manually" style="background:var(--unanswered-bg);color:var(--unanswered-fg);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--amber-strong);"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No Key</span>`;
  }
  return '';
}

function _renderAiRefineTools(editorKey, i) {
  const busy = _aiToolsIsBusy(editorKey, i);
  const activeAction = _aiToolsActiveAction[_aiToolsKey(editorKey, i)];
  const statusId = _aiToolsStatusId(editorKey, i);
  const cachedStatus = busy ? getCachedStatusHTML(statusId) : '';
  return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-2px 0 8px;">
      <div style="display:flex;">
        <button class="cq-edit-reask-btn${_aiToolsBtnActiveClass(editorKey, i, 'solve')}" type="button" id="cqAiSolveBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
          title="Ask AI to solve this question using the source chosen below"
          onclick="aiSolveQuestion('${editorKey}', ${i})"
          style="background:var(--correct-bg);color:var(--correct-fg);border-color:var(--green-pale-border);border-top-right-radius:0;border-bottom-right-radius:0;">${_aiToolsBtnSpinnerHTML(editorKey, i, 'solve')}<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI Solve</button>
        <button class="cq-edit-reask-btn" type="button" id="aiSolveSrcCaret_${editorKey}_${i}" ${busy ? 'disabled' : ''}
          title="Choose what AI Solve should rely on: general AI knowledge, or a specific source"
          onclick="_toggleAiSourcePicker('${editorKey}', ${i})"
          style="background:#F1F8F4;color:var(--correct-fg);border-color:var(--green-pale-border);border-left:none;border-top-left-radius:0;border-bottom-left-radius:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_aiSolveSourceShortHTML(editorKey, i)} ▾</button>
      </div>
      <button class="ai-tool-stop-btn" type="button" id="cqAiSolveStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'solve' ? 'display:inline-block;' : ''}"
        title="Stop AI Solve" onclick="_aiToolsStopAction('${editorKey}', ${i})"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;">
          <button class="cq-edit-reask-btn${_aiToolsBtnActiveClass(editorKey, i, 'refine')}" type="button" id="aiRefineBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
            title="Use AI to rewrite this question with clear, exam-style phrasing and no grammar mistakes or typos"
            onclick="aiRefineQuestion('${editorKey}', ${i})"
            style="background:var(--violet-pale);color:var(--violet-dark);border-color:var(--violet-border);border-top-right-radius:0;border-bottom-right-radius:0;">${_aiToolsBtnSpinnerHTML(editorKey, i, 'refine')}<svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Question</button>
          <button class="cq-edit-reask-btn" type="button" id="aiRefineInstrCaret_${editorKey}_${i}" ${busy ? 'disabled' : ''}
            title="Optional custom instructions used only when refining this question"
            onclick="_toggleAiRefineInstrPicker('${editorKey}', ${i})"
            style="background:#F3EEFC;color:var(--violet-dark);border-color:var(--violet-border);border-left:none;border-top-left-radius:0;border-bottom-left-radius:0;">${_aiRefineInstrCaretLabel(editorKey, i)} ▾</button>
        </div>
        ${_renderAiThinkingToggle('refineSingle', 'violet', undefined, editorKey, i)}
      </div>
      <button class="ai-tool-stop-btn" type="button" id="aiRefineStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'refine' ? 'display:inline-block;' : ''}"
        title="Stop Refine Question" onclick="_aiToolsStopAction('${editorKey}', ${i})"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>
    </div>
    <div id="aiSourcePicker_${editorKey}_${i}" class="ai-source-picker" style="display:none;"></div>
    <div id="aiRefineInstrPicker_${editorKey}_${i}" class="ai-source-picker" style="display:none;"></div>
    <div id="${statusId}" style="margin:-3px 0 8px;">${cachedStatus}</div>`;
}

/* Renders the choice-related AI buttons (Add Choice AI, and Fill Choices
   when under 4 options) — placed next to the existing "＋ Add Option"
   button in every editor's options footer. */
function _renderAiChoiceTools(editorKey, i, optCount, nextKey) {
  const busy = _aiToolsIsBusy(editorKey, i);
  const activeAction = _aiToolsActiveAction[_aiToolsKey(editorKey, i)];
  let html = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;align-items:center;">`;
  if (nextKey) {
    html += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <button class="cq-edit-reask-btn${_aiToolsBtnActiveClass(editorKey, i, 'addChoice')}" type="button" id="aiAddChoiceBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
        title="Let AI write one more plausible answer choice for this question"
        onclick="aiAddChoice('${editorKey}', ${i})"
        style="background:var(--correct-bg);color:var(--correct-fg);border-color:var(--green-pale-border);">${_aiToolsBtnSpinnerHTML(editorKey, i, 'addChoice')}<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> Add Choice (AI)</button>
      ${_renderAiThinkingToggle('addChoice', 'green', undefined, editorKey, i)}
      </div>
      <button class="ai-tool-stop-btn" type="button" id="aiAddChoiceStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'addChoice' ? 'display:inline-block;' : ''}"
        title="Stop Add Choice" onclick="_aiToolsStopAction('${editorKey}', ${i})"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>`;
  }
  if (optCount < 4 && nextKey) {
    html += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <button class="cq-edit-reask-btn${_aiToolsBtnActiveClass(editorKey, i, 'fillChoices')}" type="button" id="aiFillChoicesBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
        title="Let AI fill in the remaining choices (up to 4 total)"
        onclick="aiFillChoices('${editorKey}', ${i})"
        style="background:var(--unanswered-bg);color:var(--unanswered-fg);border-color:var(--amber-strong);">${_aiToolsBtnSpinnerHTML(editorKey, i, 'fillChoices')}<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Fill Choices (AI)</button>
      ${_renderAiThinkingToggle('fillSingle', 'amber', undefined, editorKey, i)}
      </div>
      <button class="ai-tool-stop-btn" type="button" id="aiFillChoicesStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'fillChoices' ? 'display:inline-block;' : ''}"
        title="Stop Fill Choices" onclick="_aiToolsStopAction('${editorKey}', ${i})"><svg class="sicon" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg> Stop</button>`;
  }
  html += `</div>`;
  return html;
}

/* ── Refine Question ──
   Rewrites the question stem into clear, grammatically-correct, exam-style
   phrasing without changing what's actually being asked, the topic, or any
   fact/name/number in it, and without touching the answer choices. An
   optional per-question custom instruction can ask for more — it only
   overrides the default rules above where the two genuinely conflict on
   that specific point; everything else still applies. */
/* Shared refine-prompt caller — builds the same prompt/rules used by the
   per-question "<svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refine Question" button, but as a standalone function so
   the bulk post-extraction pass (cqBulkRefineQuestions) can reuse it without
   needing an editor/card in the DOM. Returns the refined question string,
   or throws on failure. */
async function _aiRefineQuestionCall(apiKey, questions, q, custom, token, toolKey, editorKey, i) {
  const optEntries = getOptionEntries(q);
  const optsText = optEntries.map(([k, v]) => `${k}. ${v}`).join('\n') || '(none yet)';
  const { textBlock: caseBlock, imagePart } = _aiToolsCaseContext(questions, q);

  const prompt = `You are an exam-writing expert. Rewrite ONLY the question stem below so it reads like a polished, professionally written exam question.
Rules:
- Fix all grammar, spelling, and typo issues.
- Use clear, formal, exam-style phrasing and structure.
- Do NOT change what the question is actually asking, its topic, or any fact/number/name in it.
- Preserve every symbol, Greek letter, subscript/superscript, and special character exactly as given (e.g. β, α, μg, Na+, CO2, ≥, →) — reproduce the real character, never spell it out as a word (do not turn "β-blocker" into "beta-blocker") and never drop it.
- Do NOT reference or rewrite the answer choices — they're given only as context.
- Keep it roughly the same length unless told otherwise below.
- Small, natural phrasing variation between rewrites is fine; the underlying meaning must stay identical every time.
${caseBlock ? `\nThis question depends on a shared case/vignette${imagePart ? ' (and an accompanying image, attached below)' : ''}, given below for CONTEXT ONLY — do NOT rewrite it, repeat it, or fold it into your output. Only rewrite the "Original question" text itself, using the case to make sure your rewording still makes sense against it:\n${caseBlock}` : ''}
${custom ? `\nADDITIONAL INSTRUCTIONS FROM THE EDITOR (apply these too — if one of them genuinely conflicts with a rule above, THIS instruction wins for that specific point only; every other rule above still applies):\n"""${custom}"""\n` : ''}
Original question:
"""${q.question}"""

Answer choices (context only — do not rewrite them):
${optsText}

Respond ONLY with a JSON object: {"question": "the refined question text"}. No markdown, no preamble.`;

  const parts = [{ text: prompt }];
  if (imagePart) {
    parts.push({ text: '(Shared case image, for context only:)' });
    parts.push({ inline_data: imagePart });
  }

  const url = geminiEndpoint();
  const data = await callGeminiWithRetry(url, {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json', maxOutputTokens: 2048,
      // temperature: 0.4 — mostly consistent rewrites with a little room
      // for natural phrasing variation. Auto-stripped on a fallback-model
      // switch (see GEMINI_SAMPLING_PARAM_KEYS in gemini-uploads.js) — the
      // rule added to the prompt above is the backstop for that case.
      temperature: 0.4,
      // Gemini 2.5 Flash reasons by default, and those "thinking" tokens are
      // drawn from the SAME maxOutputTokens budget as the visible JSON
      // answer. For a short, deterministic rewrite like this, that reasoning
      // pass isn't needed by default — and left dynamic, it could
      // unpredictably eat most of the budget, leaving too little for the
      // actual answer and truncating it mid-string. Off by default reclaims
      // the whole budget for the real output and is also faster; the user
      // can opt back into thinking per-tool via the Thinking checkbox
      // (see _aiToolsGenConfigExtra) if they'd rather trade that for a
      // chance at higher quality.
      ..._aiToolsGenConfigExtra(toolKey || 'refineSingle', editorKey, i)
    }
  }, { cancelToken: token, apiKey });
  const textOut = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
  const parsed = _aiToolsParseJSON(textOut);
  const refined = (parsed && typeof parsed.question === 'string') ? parsed.question.trim() : '';
  if (!refined) throw new Error('AI did not return a refined question.');
  return refined;
}

async function aiRefineQuestion(editorKey, i) {
  if (_aiToolsIsBusy(editorKey, i)) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Another AI action is already running on this question — please wait for it to finish.'));
    return;
  }
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const q = questions[i];
  if (!q.question || !q.question.trim()) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Write the question text first.'));
    return;
  }
  const apiKey = _aiToolsRequireKey(editorKey, i);
  if (!apiKey) return;

  const custom = (_aiToolsCustomPromptText[_aiToolsKey(editorKey, i)] || '').trim();
  const key = _aiToolsKey(editorKey, i);
  const token = { cancelled: false };
  _aiToolsCancelToken[key] = token;
  _aiToolsSetBusy(editorKey, i, true, 'refine');
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML('<svg class="sicon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Refining question…'));

  try {
    q.question = await _aiRefineQuestionCall(apiKey, questions, q, custom, token, 'refineSingle', editorKey, i);
    _markQuestionEditDirty();
    // Clear the busy lock (and its cached status) BEFORE rerendering — the
    // freshly-rebuilt card restores its status box from cache only while
    // still "busy" (see cachedStatus in _renderAiRefineTools), so clearing
    // busy first guarantees the rebuilt card starts with an empty status
    // box instead of resurrecting the now-stale "Refining question…" bar.
    if (_aiToolsCancelToken[key] === token) delete _aiToolsCancelToken[key];
    _aiToolsSetBusy(editorKey, i, false, 'refine');
    ed.rerender(); // rebuilds this card fresh, which also naturally re-enables its buttons
  } catch (e) {
    if (_aiToolsCancelToken[key] === token) delete _aiToolsCancelToken[key];
    _aiToolsSetBusy(editorKey, i, false, 'refine');
    // On a genuine error, leave the message up for the user to read. On a
    // Stop-button cancellation there's nothing to report — explicitly clear
    // the status box so the "Refining question…" bar doesn't stay stuck on
    // screen forever (nothing else was going to rerender this card to
    // clear it for us, unlike the success path above).
    _aiToolsSetStatus(editorKey, i, (e && e._cancelled) ? '' : _aiToolsErrorHTML(e.message || 'Could not refine this question.'));
  }
}

/* Shared distractor generator used by both Fill Choices and Add Choice (AI).
   Asks for exactly `count` new, plausible-but-incorrect answer choices that
   fit the question's subject, style, and difficulty — distinct from every
   existing choice and from each other, and not generic filler. */
async function _aiGenerateDistractors(apiKey, questions, q, optEntries, count, token, toolKey, editorKey, i) {
  const existingText = optEntries.map(([k, v]) => `${k}. ${v}`).join('\n') || '(none)';
  const correctVal = (optEntries.find(([k]) => k === q.answer) || [])[1] || '';
  const { textBlock: caseBlock, imagePart } = _aiToolsCaseContext(questions, q);

  const prompt = `You are an exam-writing expert creating additional multiple-choice answer options (distractors) for an existing question.
${caseBlock ? `\nThis question depends on a shared case/vignette${imagePart ? ' (and an accompanying image, attached below)' : ''} — use it to make sure your distractors actually fit the scenario, but don't rewrite or repeat it:\n${caseBlock}` : ''}
Question:
"""${q.question}"""

Existing answer choices:
${existingText}
${correctVal ? `\nThe correct answer is: "${correctVal}"` : ''}

Write exactly ${count} NEW answer choice${count !== 1 ? 's' : ''} that:
- Is/are plausible and on-topic — the kind of mistake a student who half-understands the material might pick.
- Match the style, tone, length, and level of detail of the existing choices.
- Is/are clearly and unambiguously INCORRECT (do not duplicate or restate the correct answer).
- Is/are distinct from every existing choice and from each other.
- Are NOT generic filler like "None of the above", "All of the above", or "I don't know".
- Draw from varied angles (different mechanisms, related-but-wrong conditions, common misconceptions) rather than minor rewordings of the same idea.
- Use real symbols where relevant (Greek letters like β/α/γ/μ, ion notation like Na+/K+/Ca2+, arrows/comparisons like ↑/↓/≥), matching the style of the existing choices — never spell a symbol out as a word.

Respond ONLY with a JSON object: {"choices": [${Array(count).fill('"..."').join(', ')}]} containing exactly ${count} string${count !== 1 ? 's' : ''}, in order. No markdown, no preamble.`;

  const parts = [{ text: prompt }];
  if (imagePart) {
    parts.push({ text: '(Shared case image, for context only:)' });
    parts.push({ inline_data: imagePart });
  }

  const url = geminiEndpoint();
  const data = await callGeminiWithRetry(url, {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json', maxOutputTokens: 2048,
      // temperature: 0.7 — distractors benefit from more creative variety
      // than a refine/rewrite task does, so several choices don't all read
      // the same way. Auto-stripped on a fallback-model switch (see
      // GEMINI_SAMPLING_PARAM_KEYS in gemini-uploads.js) — the "varied
      // angles" rule added to the prompt above is the backstop for that
      // case.
      temperature: 0.7,
      // See matching comment in _aiRefineQuestionCall — writing a few
      // distractor choices doesn't need Gemini 2.5 Flash's default
      // reasoning pass, so it's off by default, freeing the full token
      // budget for the actual answer instead of risking it being squeezed
      // out and truncated. Each caller (Fill Choices single/bulk, Add
      // Choice) passes its own toolKey, so the user's Thinking choice
      // for one of those never affects the others.
      ..._aiToolsGenConfigExtra(toolKey || 'fillSingle', editorKey, i)
    }
  }, { cancelToken: token, apiKey });
  const textOut = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');

  let choicesRaw;
  try {
    choicesRaw = _aiToolsParseJSON(textOut).choices;
  } catch (e) {
    // Response got cut off mid-generation — salvage whichever choices were
    // already fully written instead of failing the whole request over a
    // trailing partial one (relevant when count > 1, e.g. Fill Choices
    // asking for several distractors at once).
    const salvage = parseGeminiJsonObjectArrayField(textOut, 'choices');
    if (!salvage.data || !salvage.data.length) throw e;
    choicesRaw = salvage.data;
  }

  let choices = Array.isArray(choicesRaw) ? choicesRaw.filter(c => typeof c === 'string' && c.trim()) : [];
  if (!choices.length) throw new Error('AI did not return usable choices.');
  while (choices.length < count) choices.push('');
  return choices.slice(0, count);
}

const _AI_TOOLS_ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];

/* ── Fill Choices ──
   Tops a question up to 4 total answer choices, generating only the
   missing ones — existing choices (and which one is correct) are untouched. */
async function aiFillChoices(editorKey, i) {
  if (_aiToolsIsBusy(editorKey, i)) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Another AI action is already running on this question — please wait for it to finish.'));
    return;
  }
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const q = questions[i];
  if (!q.question || !q.question.trim()) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Write the question text first.'));
    return;
  }
  const optEntries = getOptionEntries(q);
  const usedKeys = optEntries.map(([k]) => k);
  const missing = _AI_TOOLS_ALL_KEYS.filter(k => !usedKeys.includes(k)).slice(0, Math.max(0, 4 - optEntries.length));
  if (!missing.length) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('This question already has 4 or more choices.'));
    return;
  }
  const apiKey = _aiToolsRequireKey(editorKey, i);
  if (!apiKey) return;

  // Snapshot the current answer letter — Fill Choices must NEVER change which
  // option is marked correct, only add new (incorrect) distractor text.
  const answerBefore = q.answer;

  const _key = _aiToolsKey(editorKey, i);
  const token = { cancelled: false };
  _aiToolsCancelToken[_key] = token;
  _aiToolsSetBusy(editorKey, i, true, 'fillChoices');
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML(`<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Filling ${missing.length} more choice${missing.length !== 1 ? 's' : ''}…`));

  try {
    const newVals = await _aiGenerateDistractors(apiKey, questions, q, optEntries, missing.length, token, 'fillSingle', editorKey, i);
    if (!q.optionsOrder) q.optionsOrder = optEntries.map(([k, v]) => ({ key: k, value: v }));
    missing.forEach((optKey, idx) => {
      const val = newVals[idx] || '';
      q.options[optKey] = val;
      q.optionsOrder.push({ key: optKey, value: val });
    });
    // Defensive guarantee: the correct answer is exactly what it was before —
    // this action only ever adds new wrong choices, never picks or changes one.
    q.answer = answerBefore;
    _markQuestionEditDirty();
    // Clear busy (and its cached status) before rerendering — see the
    // matching comment in aiRefineQuestion for why the order matters.
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'fillChoices');
    ed.rerender();
  } catch (e) {
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'fillChoices');
    _aiToolsSetStatus(editorKey, i, (e && e._cancelled) ? '' : _aiToolsErrorHTML(e.message || 'Could not generate choices.'));
  }
}

/* ── Add Choice (AI) ──
   Adds exactly one new, AI-written, plausible answer choice — regardless
   of how many choices already exist (up to the 10-choice max). */
async function aiAddChoice(editorKey, i) {
  if (_aiToolsIsBusy(editorKey, i)) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Another AI action is already running on this question — please wait for it to finish.'));
    return;
  }
  const ed = _caseGroupEditors[editorKey];
  const questions = ed && ed.getQuestions();
  if (!questions || !questions[i]) return;
  const q = questions[i];
  if (!q.question || !q.question.trim()) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Write the question text first.'));
    return;
  }
  const optEntries = getOptionEntries(q);
  const usedKeys = optEntries.map(([k]) => k);
  const nextKey = _AI_TOOLS_ALL_KEYS.find(k => !usedKeys.includes(k));
  if (!nextKey) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Maximum of 10 choices reached.'));
    return;
  }
  const apiKey = _aiToolsRequireKey(editorKey, i);
  if (!apiKey) return;

  // Snapshot the current answer letter — adding a choice must NEVER change
  // which option is marked correct, only append one new (incorrect) option.
  const answerBefore = q.answer;

  const _key = _aiToolsKey(editorKey, i);
  const token = { cancelled: false };
  _aiToolsCancelToken[_key] = token;
  _aiToolsSetBusy(editorKey, i, true, 'addChoice');
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML('<svg class="sicon" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="13.5" r="1"/><circle cx="15" cy="13.5" r="1"/><path d="M9 17h6M12 8V4M2 12v4M22 12v4"/></svg> AI is writing a new choice…'));

  try {
    const newVals = await _aiGenerateDistractors(apiKey, questions, q, optEntries, 1, token, 'addChoice', editorKey, i);
    const val = newVals[0] || '';
    if (!q.optionsOrder) q.optionsOrder = optEntries.map(([k, v]) => ({ key: k, value: v }));
    q.options[nextKey] = val;
    q.optionsOrder.push({ key: nextKey, value: val });
    // Defensive guarantee: the correct answer is exactly what it was before.
    q.answer = answerBefore;
    _markQuestionEditDirty();
    // Clear busy (and its cached status) before rerendering — see the
    // matching comment in aiRefineQuestion for why the order matters.
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'addChoice');
    ed.rerender();
  } catch (e) {
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'addChoice');
    _aiToolsSetStatus(editorKey, i, (e && e._cancelled) ? '' : _aiToolsErrorHTML(e.message || 'Could not generate a new choice.'));
  }
}

/* Lays out one case-group's members (already filtered to just that group,
   in whatever order they arrived) into the fixed, deterministic order the
   quiz-taking screen and every shuffle must always present them in: the
   root case first, then — immediately after it — each of its direct
   dependents, each IMMEDIATELY followed by that dependent's own whole
   subtree (if it's a sub-case with further questions nested under it),
   recursively, to any depth. Sibling order within each level is preserved
   exactly as given (which callers arrange to be the original quiz order),
   so nothing here ever reorders siblings on its own — only shuffle (below)
   does that, and only at the top level between whole blocks/trees, never
   within one. Falls back to appending anything unreachable (e.g. from a
   corrupted/cyclic parent chain that somehow slipped past
   _cqNormalizeCaseParents) rather than silently dropping a question. */
function _cqCaseTreeOrder(members) {
  if (members.length < 2) return members;
  const root = members.find(q => q.case_is_core) || members[0];
  const childrenOf = new Map();
  members.forEach(m => childrenOf.set(m, []));
  members.forEach(m => {
    if (m === root) return;
    const parent = _cqFindCaseParent(members, m) || root;
    (childrenOf.get(parent) || childrenOf.get(root)).push(m);
  });
  const ordered = [];
  const visit = (node) => { ordered.push(node); (childrenOf.get(node) || []).forEach(visit); };
  visit(root);
  members.forEach(m => { if (!ordered.includes(m)) ordered.push(m); }); // safety net, see comment above
  return ordered;
}

/* Splits `arr` into top-level "blocks" — each standalone question is its
   own one-item block, and each case group (root + its ENTIRE nested tree,
   at any depth) becomes one block laid out via _cqCaseTreeOrder above —
   then either shuffles the blocks (shuffle=true) or leaves them in their
   original relative order (shuffle=false), and flattens back into one
   array. Either way, a case tree's internal order/contiguity is never
   touched: shuffle only ever reshuffles WHICH BLOCK comes where, so a
   student always sees a whole case (and everything nested inside it, in
   the order described above) together and in the right relative order,
   whether or not shuffle is on. */
function _cqGroupAwareOrder(arr, shuffle) {
  const blocks = [];
  const blockByGroup = {};
  arr.forEach(q => {
    const gid = q && q.case_group;
    if (gid) {
      if (!blockByGroup[gid]) { blockByGroup[gid] = []; blocks.push(blockByGroup[gid]); }
      blockByGroup[gid].push(q);
    } else {
      blocks.push([q]);
    }
  });
  const laidOut = blocks.map(_cqCaseTreeOrder);
  if (shuffle) {
    for (let i = laidOut.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [laidOut[i], laidOut[j]] = [laidOut[j], laidOut[i]];
    }
  }
  return laidOut.flat();
}
// Back-compat name for existing call sites — shuffled order.
function _cqGroupAwareShuffle(arr) { return _cqGroupAwareOrder(arr, true); }
// Same block layout, but WITHOUT reshuffling block order — used for
// "normal" (non-shuffled) mode, so even there a case tree that somehow
// arrived out of order/non-contiguous (e.g. after manual editing) always
// renders correctly grouped and in the right nested order.
function _cqGroupAwareCanonicalOrder(arr) { return _cqGroupAwareOrder(arr, false); }

/* Shared markup for the "waiting for the nearest checkpoint" banner shown
   while cqPauseRequested is true but the loop hasn't actually reached a
   safe checkpoint yet. Includes a "pause now" button that lets the user
   skip waiting for that checkpoint — see cqRequestPauseSkip(). Once that's
   been clicked, swap the button for a small status line instead of hiding
   the whole banner, so the user still sees it's being handled. */
function _cqPausingBannerHTML() {
  const skipPart = (typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested)
    ? `<div style="margin-top:6px;font-style:italic;"><svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Stepping back to the last checkpoint instead…</div>`
    : `<div style="margin-top:6px;">
        <button class="cq-btn cq-btn-secondary" type="button" style="padding:4px 10px;font-size:.72rem;"
          onclick="cqRequestPauseSkip()"><svg class="sicon" viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg> Don't wait — pause now (retries this step)</button>
      </div>`;
  return `<div class="cq-status warning cq-pausing-banner" style="margin-top:6px;">
    <svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Waiting for the nearest checkpoint to pause safely — this finishes the current step first so nothing already done is lost.
    ${skipPart}
  </div>`;
}

/* Renders a status box with a real progress bar underneath the spinner/text.
   `percent` is a plain 0–100 number the caller already knows client-side
   (e.g. "file 2 of 5 done" → 40%) — this never triggers, waits on, or costs
   an extra AI call; it's purely a visual reflection of work already tracked. */
function _cqProgressStatusHTML(message, percent) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  // If the user has clicked Pause but the loop hasn't reached a safe
  // checkpoint yet, keep reminding them it's on its way there — this is
  // rebuilt on every progress tick, so it survives the frequent innerHTML
  // overwrites that happen while a pause is pending.
  const pausingNote = (typeof cqPauseRequested !== 'undefined' && cqPauseRequested)
    ? _cqPausingBannerHTML()
    : '';
  // If every configured API key is currently rate-limited, let anyone
  // watching this run know it's still working — just cycling through keys
  // automatically and retrying — rather than looking stalled. See
  // js/api-rotation.js for the actual rotation logic.
  const rotationNote = (typeof allKeysRateLimited === 'function' && allKeysRateLimited())
    ? _apiAllRateLimitedBannerHTML()
    : '';
  return `<div class="cq-status info with-progress">
    <div class="cq-status-row"><div class="cq-spinner"></div> ${message}</div>
    <div class="cq-progress-track"><div class="cq-progress-fill" style="width:${pct}%;"></div></div>
    <div class="cq-progress-label">${pct}%</div>
  </div>${pausingNote}${rotationNote}`;
}

/* ── Pause / resume for the extraction & generation loops ──
   The loops below are plain `for` loops inside an `async function`, so all
   their state (accumulated questions, current file index, etc.) already
   lives in local variables that stay alive across an `await`. That means
   "pausing" doesn't need to save/restore any state at all — it just needs
   to `await` an unresolved Promise at a safe checkpoint (between files /
   between AI-solve batches) until the user clicks Resume, which resolves
   it and lets the loop fall through to the next line exactly where it left
   off. Nothing extracted so far is ever discarded.

   Because getActiveApiKey() always reads the currently-active key fresh,
   any loop that re-reads it right after a checkpoint will automatically
   pick up a different key if the user opened <svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage APIs while paused. */
function _cqActiveGenBtn() {
  return document.getElementById('cqGenerateBtn') || document.getElementById('cqLectureGenBtn');
}

function cqRequestPause() {
  if (!cqBusy || cqIsPaused || cqPauseRequested) return;
  cqPauseRequested = true;
  cqPauseSkipRequested = false;
  const pauseBtn = document.getElementById('cqPauseBtn');
  if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Pausing…'; }

  // Let the user know right away — pausing isn't instant, it takes effect at
  // the next safe checkpoint (between files/batches), so tell them what's
  // happening instead of leaving them wondering. This note also gets baked
  // into every progress update via _cqProgressStatusHTML() below, so it
  // survives the frequent innerHTML overwrites that happen while waiting.
  const statusEl = document.getElementById('cqStatus');
  if (statusEl && !statusEl.querySelector('.cq-pausing-banner')) {
    statusEl.insertAdjacentHTML('beforeend', _cqPausingBannerHTML());
  }
}

/* Lets the user skip waiting for the current file/batch/question to finish
   naturally once Pause has been clicked — instead, aborts whatever request
   is in flight right now (via the shared cancel token) and steps back to
   the LAST COMPLETED checkpoint, exactly like the automatic rate-limit
   pause fallback already does (see cqFallbackPauseForRateLimit). The
   in-flight item is simply retried, not lost, once the user resumes. Only
   meaningful while "Pausing…" hasn't reached a safe checkpoint on its own
   yet — once actually paused, there's nothing left to skip. */
function cqRequestPauseSkip() {
  if (!cqBusy || cqIsPaused || !cqPauseRequested || cqPauseSkipRequested) return;
  cqPauseSkipRequested = true;
  if (typeof cqCancelToken !== 'undefined' && cqCancelToken) _cancelAiToken(cqCancelToken);
  const statusEl = document.getElementById('cqStatus');
  if (statusEl) {
    const banner = statusEl.querySelector('.cq-pausing-banner');
    if (banner) banner.outerHTML = _cqPausingBannerHTML();
  }
}

function cqRequestStop() {
  if (!cqBusy) return;
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
  const stopBtn = document.getElementById('cqStopBtn');
  if (stopBtn) { stopBtn.disabled = true; stopBtn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Stopping…'; }
}

function cqResumeGeneration() {
  if (!cqResumeResolve) return;
  const resolve = cqResumeResolve;
  cqResumeResolve = null;
  const pauseBtn = document.getElementById('cqPauseBtn');
  if (pauseBtn) { pauseBtn.disabled = false; pauseBtn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause'; }
  const resumeBtn = document.getElementById('cqResumeBtn');
  if (resumeBtn) resumeBtn.style.display = 'none';
  if (pauseBtn) pauseBtn.style.display = 'inline-flex';
  const genBtn = _cqActiveGenBtn();
  if (genBtn) genBtn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Generating…';
  resolve();
}

/* Does the actual work of sitting paused: swap buttons, show a banner with
   the given message, and block (via an unresolved Promise, not polling)
   until cqResumeGeneration() is clicked. Shared by the two ways a pause
   can start — the user clicking ⏸️ Pause, and the automatic rate-limit
   fallback below. */
async function _cqEnterPause(statusEl, message) {
  cqPauseRequested = false;
  cqPauseSkipRequested = false;
  cqIsPaused = true;

  const pauseBtn = document.getElementById('cqPauseBtn');
  const resumeBtn = document.getElementById('cqResumeBtn');
  if (pauseBtn) pauseBtn.style.display = 'none';
  if (resumeBtn) resumeBtn.style.display = 'inline-flex';
  const genBtn = _cqActiveGenBtn();
  if (genBtn) genBtn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Paused';

  if (statusEl) {
    // The "waiting for checkpoint" note has done its job now that we've
    // actually reached one — swap it for the real paused banner.
    const pausingBanner = statusEl.querySelector('.cq-pausing-banner');
    if (pausingBanner) pausingBanner.remove();
    statusEl.insertAdjacentHTML('beforeend',
      `<div class="cq-status warning cq-pause-banner" style="margin-top:6px;">${message}</div>`);
  }

  await new Promise(resolve => { cqResumeResolve = resolve; });

  cqIsPaused = false;
  if (statusEl) {
    const banner = statusEl.querySelector('.cq-pause-banner');
    if (banner) banner.remove();
  }

  // The user may have confirmed switching API keys while this was paused —
  // that ends the run instead of resuming it.
  if (typeof cqStopRequested !== 'undefined' && cqStopRequested) {
    const e = new Error('Aborted — the active API key was switched while paused.');
    e._cqStopped = true;
    throw e;
  }

  return getActiveApiKey();
}

/* Call at a safe checkpoint (top of a file/batch iteration). Returns the
   currently-active API key — refreshed in case the user switched keys
   while paused, so the very next request already uses it. */
async function cqCheckPause(statusEl) {
  if (typeof cqStopRequested !== 'undefined' && cqStopRequested) {
    const e = new Error('Aborted — the active API key was switched, which forcibly ends this run.');
    e._cqStopped = true;
    throw e;
  }
  if (cqPauseRequested) {
    return _cqEnterPause(statusEl,
      `<svg class="sicon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Paused — everything done so far is safe. Open <svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage APIs to switch keys, then press <svg class="sicon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume to continue right where this left off.`);
  }
  return getActiveApiKey();
}

/* Fallback used when the user has clicked Pause but the *current* file/
   batch can't get there on its own — Gemini keeps returning 429 (rate
   limited) over and over. Rather than let callGeminiWithRetry keep backing
   off forever and leave Pause stuck at "Pausing…" indefinitely, it bails
   out after several successive 429s and we pause right here instead —
   i.e. fall back to the last completed checkpoint. The file/batch that was
   being worked on is simply retried (not skipped) once the user resumes,
   ideally with a different, non-rate-limited key. */
async function cqFallbackPauseForRateLimit(statusEl, whatLabel) {
  const what = whatLabel ? ` for ${escapeHtml(whatLabel)}` : '';
  return _cqEnterPause(statusEl,
    `<svg class="sicon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Paused automatically — Gemini kept rate-limiting (429) repeatedly while trying to finish${what}, so this stepped back to before it instead of waiting indefinitely. Nothing is lost — switch your API key (<svg class="sicon" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Manage APIs) and press <svg class="sicon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume to retry it.`);
}

