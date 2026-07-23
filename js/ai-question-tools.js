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

   This block lets the user opt back INTO thinking, per tool, if they'd
   rather trade speed/cost for a chance at higher quality. Each of the five
   tools below is a COMPLETELY INDEPENDENT switch: turning bulk Fill Choices
   on has no effect on the per-question Fill Choices button, or on Add
   Choice, or on Refine, and vice versa. There is exactly one on/off state
   per tool — not per question — so every checkbox for the same tool
   (a per-question tool's checkbox appears on every question card; a bulk
   tool's checkbox appears in more than one panel) always shows and stays
   in sync with that one shared value. Persisted in localStorage so the
   choice survives a reload. */
const AI_TOOLS_THINKING_STORE = 'aiToolsThinkingSettings';
const _AI_TOOLS_THINKING_DEFAULTS = {
  refineSingle: false, // 🪄 Refine Question (per-question button)
  fillSingle:   false, // 🧩 Fill Choices (per-question button)
  addChoice:    false, // ➕ Add Choice (AI) (per-question button)
  fillBulk:     false, // 🧩 Fill Choices — bulk (post-extraction pass / "Fill Choices (All)")
  refineBulk:   false  // 🪄 Refine Questions — bulk (post-extraction pass / "Refine Questions (All)")
};
function _aiToolsLoadThinkingSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_TOOLS_THINKING_STORE) || '{}');
    const out = {};
    Object.keys(_AI_TOOLS_THINKING_DEFAULTS).forEach(k => { out[k] = !!raw[k]; });
    return out;
  } catch (e) {
    return Object.assign({}, _AI_TOOLS_THINKING_DEFAULTS);
  }
}
let _aiToolsThinking = _aiToolsLoadThinkingSettings();
function _aiToolsThinkingOn(toolKey) { return !!_aiToolsThinking[toolKey]; }
/* generationConfig fragment for a given tool: omit thinkingConfig entirely
   when the user has switched thinking ON (Gemini's own dynamic default then
   applies, exactly like AI Solve already runs today), or force it to 0 when
   OFF — the original, still-default, behaviour. */
function _aiToolsGenConfigExtra(toolKey) {
  return _aiToolsThinkingOn(toolKey) ? {} : { thinkingConfig: { thinkingBudget: 0 } };
}
function _aiToolsSetThinking(toolKey, on) {
  _aiToolsThinking[toolKey] = !!on;
  try { localStorage.setItem(AI_TOOLS_THINKING_STORE, JSON.stringify(_aiToolsThinking)); } catch (e) {}
  // Sync every rendered checkbox for THIS tool only, wherever it appears —
  // never touches a checkbox belonging to a different tool.
  document.querySelectorAll(`.ai-thinking-cb[data-tool="${toolKey}"]`).forEach(cb => {
    cb.checked = on;
    const wrap = cb.closest('.ai-thinking-toggle');
    if (wrap) wrap.classList.toggle('ai-thinking-on', on);
  });
}
const _AI_THINKING_LABELS = {
  refineSingle: 'Refine Question',
  fillSingle:   'Fill Choices',
  addChoice:    'Add Choice',
  fillBulk:     'Fill Choices (bulk)',
  refineBulk:   'Refine Questions (bulk)'
};
/* Compact pill-checkbox, safe to render many times for the same toolKey
   (every per-question card renders its own copy) — all copies stay in sync
   via the querySelectorAll sync in _aiToolsSetThinking above.
   `variant` colors the pill to match the button it belongs to, so it reads
   as part of that specific tool rather than a generic setting floating
   nearby: 'violet' (default, Refine), 'amber' (Fill Choices), 'green'
   (Add Choice). Callers also nest this right next to its own trigger
   button (see _renderAiRefineTools / _renderAiChoiceTools) — color plus
   placement together make the pairing unambiguous even when a Stop button
   sits close by too. */
function _renderAiThinkingToggle(toolKey, variant, extraStyle) {
  const on = _aiToolsThinkingOn(toolKey);
  const label = _AI_THINKING_LABELS[toolKey] || toolKey;
  const variantClass = variant && variant !== 'violet' ? ` ai-thinking-${variant}` : '';
  return `<label class="ai-thinking-toggle${variantClass}${on ? ' ai-thinking-on' : ''}" style="${extraStyle || ''}"
      title="When ON, lets Gemini think before answering for ${escapeHtml(label)} — can improve quality but is slower and uses more tokens. OFF by default, since this task is small and quick enough not to need it.">
    <input type="checkbox" class="ai-thinking-cb" data-tool="${toolKey}" ${on ? 'checked' : ''}
      onchange="_aiToolsSetThinking('${toolKey}', this.checked)">
    <span class="ai-thinking-cb-box"></span>
    <span class="ai-thinking-cb-label">🧠 Thinking</span>
  </label>`;
}

// Per-question UI state for the "Custom Instructions" box (whether it's
// open, and its draft text) — keyed by `${editorKey}_${i}` since each
// editor keeps its own independent set of question cards.
const _aiToolsCustomPromptText = {};
function _aiToolsKey(editorKey, i) { return editorKey + '_' + i; }

/* ── Per-question AI lock ──
   Refine Question, Fill Choices, Add Choice (AI), and the existing 🤖 AI
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
    `cqAiSolveBtn_${editorKey}_${i}`,   // now available in every editor, not just 'cq'
    `aiSolveSrcCaret_${editorKey}_${i}` // the ▾ source picker toggle next to it
  ];
}
function _aiToolsSyncButtons(editorKey, i, busy, action) {
  const ids = _aiToolsButtonIds(editorKey, i);
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });

  // Which button id corresponds to which action name.
  const idMap = {
    refine:      `aiRefineBtn_${editorKey}_${i}`,
    addChoice:   `aiAddChoiceBtn_${editorKey}_${i}`,
    fillChoices: `aiFillChoicesBtn_${editorKey}_${i}`,
    solve:       `cqAiSolveBtn_${editorKey}_${i}`
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
    refine:      `aiRefineStopBtn_${editorKey}_${i}`,
    addChoice:   `aiAddChoiceStopBtn_${editorKey}_${i}`,
    fillChoices: `aiFillChoicesStopBtn_${editorKey}_${i}`,
    solve:       `cqAiSolveStopBtn_${editorKey}_${i}`
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
function _aiToolsStatusEl(editorKey, i) {
  return document.getElementById(`aiToolsStatus_${editorKey}_${i}`);
}
function _aiToolsSetStatus(editorKey, i, html) {
  const el = _aiToolsStatusEl(editorKey, i);
  if (el) el.innerHTML = html;
}
function _aiToolsLoadingHTML(label) {
  return `<div class="cq-status info" style="font-size:.75rem;padding:5px 10px;">
    <div class="cq-spinner" style="width:12px;height:12px;border-width:2px;"></div> ${label}</div>`;
}
function _aiToolsErrorHTML(msg) {
  return `<div class="cq-status warning" style="font-size:.75rem;padding:5px 10px;">⚠️ ${escapeHtml(msg)}</div>`;
}
/* Every AI tool call shares the same active Gemini key used everywhere else
   in the app (extraction, AI Solve, explanations) — if none is configured
   yet, point the user at where to add one instead of silently failing. */
function _aiToolsRequireKey(editorKey, i) {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML('Add a Gemini API key (⚙️ API Keys) to use AI tools.'));
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
  return draft ? '⚙️ Instructions •' : '⚙️ Instructions';
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

/* Renders the "🤖 AI Solve" + "🪄 Refine Question" toolbar, each with its
   own ▾ caret opening a popover scoped to THAT action only — AI Solve's
   caret picks the source to solve from; Refine's caret holds the custom
   instructions used only when refining. Keeping both as the same
   button+caret+popover shape (rather than one popover and one free-floating
   "Custom Instructions" button) makes it visually unambiguous which
   settings belong to which action. Placed directly under the question
   textarea in every editor. editorKey: 'cq' | 'admin' | 'customQuiz'.
   See aiSolveQuestion()/_toggleAiSourcePicker() and
   aiRefineQuestion()/_toggleAiRefineInstrPicker() further down. */
function _renderAiRefineTools(editorKey, i) {
  const busy = _aiToolsIsBusy(editorKey, i);
  const activeAction = _aiToolsActiveAction[_aiToolsKey(editorKey, i)];
  return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-2px 0 8px;">
      <div style="display:flex;">
        <button class="cq-edit-reask-btn" type="button" id="cqAiSolveBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
          title="Ask AI to solve this question using the source chosen below"
          onclick="aiSolveQuestion('${editorKey}', ${i})"
          style="background:var(--correct-bg);color:var(--correct-fg);border-color:var(--green-pale-border);border-top-right-radius:0;border-bottom-right-radius:0;">🤖 AI Solve</button>
        <button class="cq-edit-reask-btn" type="button" id="aiSolveSrcCaret_${editorKey}_${i}" ${busy ? 'disabled' : ''}
          title="Choose what AI Solve should rely on: general AI knowledge, or a specific source"
          onclick="_toggleAiSourcePicker('${editorKey}', ${i})"
          style="background:#F1F8F4;color:var(--correct-fg);border-color:var(--green-pale-border);border-left:none;border-top-left-radius:0;border-bottom-left-radius:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(_aiSolveSourceShortLabel(editorKey, i))} ▾</button>
      </div>
      <button class="ai-tool-stop-btn" type="button" id="cqAiSolveStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'solve' ? 'display:inline-block;' : ''}"
        title="Stop AI Solve" onclick="_aiToolsStopAction('${editorKey}', ${i})">⏹ Stop</button>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;">
          <button class="cq-edit-reask-btn" type="button" id="aiRefineBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
            title="Use AI to rewrite this question with clear, exam-style phrasing and no grammar mistakes or typos"
            onclick="aiRefineQuestion('${editorKey}', ${i})"
            style="background:var(--violet-pale);color:var(--violet-dark);border-color:var(--violet-border);border-top-right-radius:0;border-bottom-right-radius:0;">🪄 Refine Question</button>
          <button class="cq-edit-reask-btn" type="button" id="aiRefineInstrCaret_${editorKey}_${i}" ${busy ? 'disabled' : ''}
            title="Optional custom instructions used only when refining this question"
            onclick="_toggleAiRefineInstrPicker('${editorKey}', ${i})"
            style="background:#F3EEFC;color:var(--violet-dark);border-color:var(--violet-border);border-left:none;border-top-left-radius:0;border-bottom-left-radius:0;">${_aiRefineInstrCaretLabel(editorKey, i)} ▾</button>
        </div>
        ${_renderAiThinkingToggle('refineSingle', 'violet')}
      </div>
      <button class="ai-tool-stop-btn" type="button" id="aiRefineStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'refine' ? 'display:inline-block;' : ''}"
        title="Stop Refine Question" onclick="_aiToolsStopAction('${editorKey}', ${i})">⏹ Stop</button>
    </div>
    <div id="aiSourcePicker_${editorKey}_${i}" class="ai-source-picker" style="display:none;"></div>
    <div id="aiRefineInstrPicker_${editorKey}_${i}" class="ai-source-picker" style="display:none;"></div>
    <div id="aiToolsStatus_${editorKey}_${i}" style="margin:-3px 0 8px;"></div>`;
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
      <button class="cq-edit-reask-btn" type="button" id="aiAddChoiceBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
        title="Let AI write one more plausible answer choice for this question"
        onclick="aiAddChoice('${editorKey}', ${i})"
        style="background:var(--correct-bg);color:var(--correct-fg);border-color:var(--green-pale-border);">🤖 Add Choice (AI)</button>
      ${_renderAiThinkingToggle('addChoice', 'green')}
      </div>
      <button class="ai-tool-stop-btn" type="button" id="aiAddChoiceStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'addChoice' ? 'display:inline-block;' : ''}"
        title="Stop Add Choice" onclick="_aiToolsStopAction('${editorKey}', ${i})">⏹ Stop</button>`;
  }
  if (optCount < 4 && nextKey) {
    html += `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <button class="cq-edit-reask-btn" type="button" id="aiFillChoicesBtn_${editorKey}_${i}" ${busy ? 'disabled' : ''}
        title="Let AI fill in the remaining choices (up to 4 total)"
        onclick="aiFillChoices('${editorKey}', ${i})"
        style="background:var(--unanswered-bg);color:var(--unanswered-fg);border-color:var(--amber-strong);">🧩 Fill Choices (AI)</button>
      ${_renderAiThinkingToggle('fillSingle', 'amber')}
      </div>
      <button class="ai-tool-stop-btn" type="button" id="aiFillChoicesStopBtn_${editorKey}_${i}"
        style="${busy && activeAction === 'fillChoices' ? 'display:inline-block;' : ''}"
        title="Stop Fill Choices" onclick="_aiToolsStopAction('${editorKey}', ${i})">⏹ Stop</button>`;
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
   per-question "🪄 Refine Question" button, but as a standalone function so
   the bulk post-extraction pass (cqBulkRefineQuestions) can reuse it without
   needing an editor/card in the DOM. Returns the refined question string,
   or throws on failure. */
async function _aiRefineQuestionCall(apiKey, questions, q, custom, token, toolKey) {
  const optEntries = getOptionEntries(q);
  const optsText = optEntries.map(([k, v]) => `${k}. ${v}`).join('\n') || '(none yet)';
  const { textBlock: caseBlock, imagePart } = _aiToolsCaseContext(questions, q);

  const prompt = `You are an exam-writing expert. Rewrite ONLY the question stem below so it reads like a polished, professionally written exam question.
Rules:
- Fix all grammar, spelling, and typo issues.
- Use clear, formal, exam-style phrasing and structure.
- Do NOT change what the question is actually asking, its topic, or any fact/number/name in it.
- Do NOT reference or rewrite the answer choices — they're given only as context.
- Keep it roughly the same length unless told otherwise below.
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
      responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 2048,
      // Gemini 2.5 Flash reasons by default, and those "thinking" tokens are
      // drawn from the SAME maxOutputTokens budget as the visible JSON
      // answer. For a short, deterministic rewrite like this, that reasoning
      // pass isn't needed by default — and left dynamic, it could
      // unpredictably eat most of the budget, leaving too little for the
      // actual answer and truncating it mid-string. Off by default reclaims
      // the whole budget for the real output and is also faster; the user
      // can opt back into thinking per-tool via the 🧠 Thinking checkbox
      // (see _aiToolsGenConfigExtra) if they'd rather trade that for a
      // chance at higher quality.
      ..._aiToolsGenConfigExtra(toolKey || 'refineSingle')
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
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML('🪄 Refining question…'));

  try {
    q.question = await _aiRefineQuestionCall(apiKey, questions, q, custom, token, 'refineSingle');
    _markQuestionEditDirty();
    ed.rerender(); // rebuilds this card fresh, which also naturally re-enables its buttons
  } catch (e) {
    if (!(e && e._cancelled)) {
      _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML(e.message || 'Could not refine this question.'));
    }
  } finally {
    if (_aiToolsCancelToken[key] === token) delete _aiToolsCancelToken[key];
    _aiToolsSetBusy(editorKey, i, false, 'refine');
  }
}

/* Shared distractor generator used by both Fill Choices and Add Choice (AI).
   Asks for exactly `count` new, plausible-but-incorrect answer choices that
   fit the question's subject, style, and difficulty — distinct from every
   existing choice and from each other, and not generic filler. */
async function _aiGenerateDistractors(apiKey, questions, q, optEntries, count, token, toolKey) {
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
      responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 2048,
      // See matching comment in _aiRefineQuestionCall — writing a few
      // distractor choices doesn't need Gemini 2.5 Flash's default
      // reasoning pass, so it's off by default, freeing the full token
      // budget for the actual answer instead of risking it being squeezed
      // out and truncated. Each caller (Fill Choices single/bulk, Add
      // Choice) passes its own toolKey, so the user's 🧠 Thinking choice
      // for one of those never affects the others.
      ..._aiToolsGenConfigExtra(toolKey || 'fillSingle')
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
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML(`🧩 Filling ${missing.length} more choice${missing.length !== 1 ? 's' : ''}…`));

  try {
    const newVals = await _aiGenerateDistractors(apiKey, questions, q, optEntries, missing.length, token, 'fillSingle');
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
    ed.rerender();
  } catch (e) {
    if (!(e && e._cancelled)) {
      _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML(e.message || 'Could not generate choices.'));
    }
  } finally {
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'fillChoices');
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
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML('🤖 AI is writing a new choice…'));

  try {
    const newVals = await _aiGenerateDistractors(apiKey, questions, q, optEntries, 1, token, 'addChoice');
    const val = newVals[0] || '';
    if (!q.optionsOrder) q.optionsOrder = optEntries.map(([k, v]) => ({ key: k, value: v }));
    q.options[nextKey] = val;
    q.optionsOrder.push({ key: nextKey, value: val });
    // Defensive guarantee: the correct answer is exactly what it was before.
    q.answer = answerBefore;
    _markQuestionEditDirty();
    ed.rerender();
  } catch (e) {
    if (!(e && e._cancelled)) {
      _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML(e.message || 'Could not generate a new choice.'));
    }
  } finally {
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'addChoice');
  }
}

function _cqGroupAwareShuffle(arr) {
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
  // Within each case-group block, the core question (the one holding the
  // shared case/vignette/image) must always lead, with its dependents kept
  // in their existing relative order behind it — regardless of how the
  // group's members were ordered going in.
  blocks.forEach(block => {
    if (block.length < 2) return;
    const coreIdx = block.findIndex(q => q.case_is_core);
    if (coreIdx > 0) {
      const [core] = block.splice(coreIdx, 1);
      block.unshift(core);
    }
  });
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flat();
}

/* Shared markup for the "waiting for the nearest checkpoint" banner shown
   while cqPauseRequested is true but the loop hasn't actually reached a
   safe checkpoint yet. Includes a "pause now" button that lets the user
   skip waiting for that checkpoint — see cqRequestPauseSkip(). Once that's
   been clicked, swap the button for a small status line instead of hiding
   the whole banner, so the user still sees it's being handled. */
function _cqPausingBannerHTML() {
  const skipPart = (typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested)
    ? `<div style="margin-top:6px;font-style:italic;">⏳ Stepping back to the last checkpoint instead…</div>`
    : `<div style="margin-top:6px;">
        <button class="cq-btn cq-btn-secondary" type="button" style="padding:4px 10px;font-size:.72rem;"
          onclick="cqRequestPauseSkip()">⏭️ Don't wait — pause now (retries this step)</button>
      </div>`;
  return `<div class="cq-status warning cq-pausing-banner" style="margin-top:6px;">
    ⏳ Waiting for the nearest checkpoint to pause safely — this finishes the current step first so nothing already done is lost.
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
  return `<div class="cq-status info with-progress">
    <div class="cq-status-row"><div class="cq-spinner"></div> ${message}</div>
    <div class="cq-progress-track"><div class="cq-progress-fill" style="width:${pct}%;"></div></div>
    <div class="cq-progress-label">${pct}%</div>
  </div>${pausingNote}`;
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
   pick up a different key if the user opened 🔑 Manage APIs while paused. */
function _cqActiveGenBtn() {
  return document.getElementById('cqGenerateBtn') || document.getElementById('cqLectureGenBtn');
}

function cqRequestPause() {
  if (!cqBusy || cqIsPaused || cqPauseRequested) return;
  cqPauseRequested = true;
  cqPauseSkipRequested = false;
  const pauseBtn = document.getElementById('cqPauseBtn');
  if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = '⏳ Pausing…'; }

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
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = '⏳ Stopping…'; }
}

function cqResumeGeneration() {
  if (!cqResumeResolve) return;
  const resolve = cqResumeResolve;
  cqResumeResolve = null;
  const pauseBtn = document.getElementById('cqPauseBtn');
  if (pauseBtn) { pauseBtn.disabled = false; pauseBtn.textContent = '⏸️ Pause'; }
  const resumeBtn = document.getElementById('cqResumeBtn');
  if (resumeBtn) resumeBtn.style.display = 'none';
  if (pauseBtn) pauseBtn.style.display = 'inline-flex';
  const genBtn = _cqActiveGenBtn();
  if (genBtn) genBtn.textContent = '⏳ Generating…';
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

  const pauseBtn  = document.getElementById('cqPauseBtn');
  const resumeBtn = document.getElementById('cqResumeBtn');
  if (pauseBtn)  pauseBtn.style.display  = 'none';
  if (resumeBtn) resumeBtn.style.display = 'inline-flex';
  const genBtn = _cqActiveGenBtn();
  if (genBtn) genBtn.textContent = '⏸️ Paused';

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
      `⏸️ Paused — everything done so far is safe. Open 🔑 Manage APIs to switch keys, then press ▶️ Resume to continue right where this left off.`);
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
    `⏸️ Paused automatically — Gemini kept rate-limiting (429) repeatedly while trying to finish${what}, so this stepped back to before it instead of waiting indefinitely. Nothing is lost — switch your API key (🔑 Manage APIs) and press ▶️ Resume to retry it.`);
}

