/* ══════════════════════════════════════════════════════════
   AI SOLVE — per-question source picker
   Every question card's 🤖 AI Solve button now has a ▾ caret beside it
   that lets the admin choose, PER QUESTION, whether to solve using pure
   AI knowledge, the bulk source already configured for this editor (the
   text/files pasted into "AI Solve All" / MCQ-extraction settings), or
   any source saved to the shared library below. Adding a brand-new
   source from this picker saves it to that library, so it immediately
   becomes available as a choice for every OTHER question too — in this
   editor and any other editor — not just the one it was added from.
   Library is in-memory only (cleared on page reload), same lifetime as
   the existing bulk-source textareas.
══════════════════════════════════════════════════════════ */

// { id, label, text, files: [{file, mimeType, name}] }
let _aiSourceLibrary = [];
let _aiSourceLibraryCounter = 0;

// Per-question choice of what AI Solve should rely on, keyed by
// `${editorKey}_${i}`. { type: 'ai' } | { type: 'bulk' } | { type: 'lib', id }
const _aiSolveSourceChoice = {};

// Draft state for the inline "add new source" form, keyed the same way,
// cleared once the source is saved (or the form is cancelled/re-opened).
const _aiSourceAddDraft = {};

function _aiSolveBulkSourceHasContent(editorKey) {
  if (editorKey === 'cq') return !!(cqAiSourceFiles && cqAiSourceFiles.length);
  return !!(_editorBulkAiSourceFiles[editorKey] && _editorBulkAiSourceFiles[editorKey].length);
}
function _aiSolveBulkSourceLabel(editorKey) {
  return editorKey === 'cq' ? 'Bulk / extraction source' : 'Editor bulk source';
}

// Computes the un-chosen default live (never cached): bulk source if this
// editor currently has one configured, otherwise plain AI knowledge. Kept
// live (not written into _aiSolveSourceChoice) so that adding/clearing a
// bulk source AFTER a card was first rendered still updates that card's
// displayed default immediately, for every question that hasn't had an
// explicit choice made yet.
function _aiSolveDefaultChoice(editorKey) {
  return _aiSolveBulkSourceHasContent(editorKey) ? { type: 'bulk' } : { type: 'ai' };
}
// Returns the user's EXPLICIT choice for this question if one was ever
// made (via the picker, or by saving a new source) — otherwise the live
// default above. Only an explicit pick gets written into
// _aiSolveSourceChoice; until then, nothing is cached for this question.
function _aiSolveGetChoice(editorKey, i) {
  const key = _aiToolsKey(editorKey, i);
  return _aiSolveSourceChoice[key] || _aiSolveDefaultChoice(editorKey);
}

function _aiSolveSourceShortLabel(editorKey, i) {
  const choice = _aiSolveGetChoice(editorKey, i);
  if (choice.type === 'bulk') return '📚 ' + _aiSolveBulkSourceLabel(editorKey);
  if (choice.type === 'lib') {
    const src = _aiSourceLibrary.find(s => s.id === choice.id);
    if (src) return '📄 ' + src.label;
  }
  return '🧠 AI knowledge';
}

// Shared open/close logic for every per-question "button + ▾ caret +
// popover" control (AI Solve's source picker, Refine's instructions
// popover, and any future ones). Only one such popover stays open at a
// time. `pickerId`/`caretId` are the DOM ids; `buildHtml` renders the
// popover's contents fresh each time it opens.
function _toggleAiPopover(pickerId, caretId, buildHtml) {
  const el = document.getElementById(pickerId);
  if (!el) return;
  const showing = el.style.display !== 'none';
  document.querySelectorAll('.ai-source-picker').forEach(p => { if (p !== el) p.style.display = 'none'; });
  if (showing) { el.style.display = 'none'; return; }
  el.dataset.caret = caretId;
  el.innerHTML = buildHtml();
  el.style.display = 'block';
}

function _toggleAiSourcePicker(editorKey, i) {
  _toggleAiPopover(`aiSourcePicker_${editorKey}_${i}`, `aiSolveSrcCaret_${editorKey}_${i}`,
    () => _renderAiSourcePickerHTML(editorKey, i));
}

function _toggleAiRefineInstrPicker(editorKey, i) {
  _toggleAiPopover(`aiRefineInstrPicker_${editorKey}_${i}`, `aiRefineInstrCaret_${editorKey}_${i}`,
    () => _renderAiRefineInstrPickerHTML(editorKey, i));
}

// Content of Refine's instructions popover — deliberately labeled so it's
// unambiguous this text is used ONLY by 🪄 Refine Question, never by AI Solve.
function _renderAiRefineInstrPickerHTML(editorKey, i) {
  const key = _aiToolsKey(editorKey, i);
  const draft = _aiToolsCustomPromptText[key] || '';
  return `<div class="ai-source-picker-inner" style="max-width:290px;">
    <div class="ai-source-picker-title">🪄 Custom Instructions — Refine Question only</div>
    <div style="font-size:.71rem;color:var(--text-muted);padding:0 6px 6px;line-height:1.35;">
      Optional extra guidance used only when you click 🪄 Refine Question on this question.
      It has no effect on 🤖 AI Solve. Only overrides the default refine rules (grammar, exam phrasing) where it truly conflicts.
    </div>
    <textarea id="aiCustomPromptInput_${editorKey}_${i}" rows="3"
      oninput="_aiCustomPromptChanged('${editorKey}', ${i}, this.value)"
      placeholder="e.g. &quot;make it about penicillin resistance&quot;, &quot;keep it to one sentence&quot;"
      style="width:100%;resize:vertical;font-size:.78rem;padding:6px 8px;border:1.5px solid #D8C4EA;
        border-radius:6px;font-family:var(--font);background:#FAF7FD;box-sizing:border-box;">${escapeHtml(draft)}</textarea>
  </div>`;
}

function _renderAiSourcePickerHTML(editorKey, i) {
  const choice = _aiSolveGetChoice(editorKey, i);
  const isSel = (t, id) => choice.type === t && (t !== 'lib' || choice.id === id);
  let html = `<div class="ai-source-picker-inner">`;
  html += `<div class="ai-source-picker-title">🤖 Solve using…</div>`;
  html += `<div class="ai-source-opt${isSel('ai') ? ' ai-source-opt-active' : ''}" onclick="_aiSolvePickSource('${editorKey}', ${i}, 'ai', null)">🧠 AI knowledge only${isSel('ai') ? ' ✓' : ''}</div>`;
  if (_aiSolveBulkSourceHasContent(editorKey)) {
    html += `<div class="ai-source-opt${isSel('bulk') ? ' ai-source-opt-active' : ''}" onclick="_aiSolvePickSource('${editorKey}', ${i}, 'bulk', null)">📚 ${escapeHtml(_aiSolveBulkSourceLabel(editorKey))}${isSel('bulk') ? ' ✓' : ''}</div>`;
  }
  if (_aiSourceLibrary.length) {
    html += `<div class="ai-source-picker-divider"></div>`;
    _aiSourceLibrary.forEach(src => {
      html += `<div class="ai-source-opt${isSel('lib', src.id) ? ' ai-source-opt-active' : ''}" onclick="_aiSolvePickSource('${editorKey}', ${i}, 'lib', '${src.id}')">
        <span style="flex:1;">📄 ${escapeHtml(src.label)}${isSel('lib', src.id) ? ' ✓' : ''}</span>
        <span class="ai-source-opt-remove" title="Remove this source" onclick="event.stopPropagation();_aiSourceLibraryRemove('${src.id}', '${editorKey}', ${i})">✕</span>
      </div>`;
    });
  }
  html += `<div class="ai-source-picker-divider"></div>`;
  html += `<div class="ai-source-add-toggle" onclick="event.stopPropagation();_aiSourceAddFormToggle('${editorKey}', ${i})">➕ Add new source</div>`;
  html += `<div id="aiSourceAddForm_${editorKey}_${i}" style="display:none;margin-top:6px;" onclick="event.stopPropagation();"></div>`;
  html += `</div>`;
  return html;
}

function _aiSolvePickSource(editorKey, i, type, id) {
  _aiSolveSourceChoice[_aiToolsKey(editorKey, i)] = (type === 'lib') ? { type, id } : { type };
  const btn = document.getElementById(`aiSolveSrcCaret_${editorKey}_${i}`);
  if (btn) btn.innerHTML = escapeHtml(_aiSolveSourceShortLabel(editorKey, i)) + ' ▾';
  const picker = document.getElementById(`aiSourcePicker_${editorKey}_${i}`);
  if (picker) picker.style.display = 'none';
}

function _aiSourceAddFormToggle(editorKey, i) {
  const wrap = document.getElementById(`aiSourceAddForm_${editorKey}_${i}`);
  if (!wrap) return;
  const showing = wrap.style.display !== 'none';
  wrap.style.display = showing ? 'none' : '';
  if (!showing) {
    wrap.innerHTML = _renderAiSourceAddFormHTML(editorKey, i);
    _aiSourceSetupDropzone(editorKey, i);
  }
}
function _aiSourceAddFormRerender(editorKey, i) {
  const wrap = document.getElementById(`aiSourceAddForm_${editorKey}_${i}`);
  if (!wrap) return;
  wrap.innerHTML = _renderAiSourceAddFormHTML(editorKey, i);
  _aiSourceSetupDropzone(editorKey, i);
}
function _aiSourceAddDraftChange(editorKey, i, field, val) {
  const dk = _aiToolsKey(editorKey, i);
  if (!_aiSourceAddDraft[dk]) _aiSourceAddDraft[dk] = { label: '', text: '', files: [] };
  _aiSourceAddDraft[dk][field] = val;
}
// Shared by both the click-to-browse input and drag&drop — validates and
// stages one file into the draft, same rules as the bulk solver's own
// reference-source dropzone (acceptSourceFile).
function _aiSourceAddAcceptFile(editorKey, i, file) {
  const dk = _aiToolsKey(editorKey, i);
  if (!_aiSourceAddDraft[dk]) _aiSourceAddDraft[dk] = { label: '', text: '', files: [] };
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) { alert(`"${file.name}" isn't an image or PDF — please upload an image (JPG/PNG/WEBP) or a PDF file.`); return; }
  if (file.size > GEMINI_MAX_FILE_BYTES) { alert(`"${file.name}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API, so it can't be used.`); return; }
  const mimeType = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');
  _aiSourceAddDraft[dk].files.push({ file, mimeType, name: file.name });
}
function _aiSourceAddFileSelect(editorKey, i, input) {
  const files = Array.from((input && input.files) || []);
  files.forEach(f => _aiSourceAddAcceptFile(editorKey, i, f));
  input.value = '';
  _aiSourceAddFormRerender(editorKey, i);
}
function _aiSourceAddRemoveFile(editorKey, i, idx) {
  const dk = _aiToolsKey(editorKey, i);
  if (_aiSourceAddDraft[dk]) _aiSourceAddDraft[dk].files.splice(idx, 1);
  _aiSourceAddFormRerender(editorKey, i);
}
function _aiSourceAddDraftFileListHTML(editorKey, i, files) {
  if (!files || !files.length) return '';
  return `<div class="cq-dz-filelist">` + files.map((f, idx) => `
    <div class="cq-dz-file-item">
      <span>✅ ${escapeHtml(f.name)}</span>
      <button type="button" onclick="event.stopPropagation();_aiSourceAddRemoveFile('${editorKey}', ${i}, ${idx})" title="Remove this file">✕</button>
    </div>`).join('') + `</div>`;
}
// Wires drag&drop on the per-question dropzone. Called after every render
// of the add-source form, since the form is rebuilt via innerHTML each
// time (fresh nodes each time, so there's no stale-listener risk).
function _aiSourceSetupDropzone(editorKey, i) {
  const dz = document.getElementById(`aiSourceDropzone_${editorKey}_${i}`);
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    files.forEach(f => _aiSourceAddAcceptFile(editorKey, i, f));
    _aiSourceAddFormRerender(editorKey, i);
  });
}
function _renderAiSourceAddFormHTML(editorKey, i) {
  const dk = _aiToolsKey(editorKey, i);
  const draft = _aiSourceAddDraft[dk] || { label: '', text: '', files: [] };
  return `
    <input type="text" placeholder="Source name (e.g. Lecture 4 slides)" value="${escapeHtml(draft.label)}"
      oninput="_aiSourceAddDraftChange('${editorKey}', ${i}, 'label', this.value)"
      style="width:100%;font-size:.75rem;padding:5px 7px;border:1.5px solid var(--border-soft);border-radius:5px;margin-bottom:8px;box-sizing:border-box;">
    <div style="font-size:.72rem;font-weight:700;color:var(--violet-dark);margin-bottom:4px;">🖼️ Source images / PDFs</div>
    <div class="cq-dropzone cq-dz-purple ai-source-dz" id="aiSourceDropzone_${editorKey}_${i}"
      onclick="document.getElementById('aiSourceFileInput_${editorKey}_${i}').click()">
      <div class="cq-dz-icon">🖼️📄</div>
      <div class="cq-dz-text">Click to upload, or drag &amp; drop — one or more reference images or PDFs</div>
      ${_aiSourceAddDraftFileListHTML(editorKey, i, draft.files)}
      ${draft.files.length ? `<div class="cq-dz-add-more">➕ Click again to add more files</div>` : ''}
    </div>
    <input type="file" id="aiSourceFileInput_${editorKey}_${i}" accept="image/*,application/pdf" multiple style="display:none;"
      onchange="_aiSourceAddFileSelect('${editorKey}', ${i}, this)">
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button type="button" class="cq-edit-reask-btn" style="background:#1565C0;color:#fff;font-size:.72rem;"
        onclick="_aiSourceAddSave('${editorKey}', ${i})">✅ Save Source</button>
      <button type="button" class="cq-edit-reask-btn" style="font-size:.72rem;"
        onclick="_aiSourceAddFormToggle('${editorKey}', ${i})">Cancel</button>
    </div>`;
}
// Saves the draft to the shared library — this makes it available to
// EVERY question card from now on (see _aiSourceLibrary), not just the one
// it was added from — then immediately selects it for the current question.
function _aiSourceAddSave(editorKey, i) {
  const dk = _aiToolsKey(editorKey, i);
  const draft = _aiSourceAddDraft[dk] || { label: '', text: '', files: [] };
  const label = (draft.label || '').trim();
  const files = draft.files || [];
  if (!label) { alert('Give this source a name.'); return; }
  if (!files.length) { alert('Add at least one reference image or PDF.'); return; }
  const id = 'src_' + (++_aiSourceLibraryCounter) + '_' + Date.now();
  _aiSourceLibrary.push({ id, label, text: '', files });
  delete _aiSourceAddDraft[dk];
  _aiSolvePickSource(editorKey, i, 'lib', id);
}
function _aiSourceLibraryRemove(id, editorKey, i) {
  const idx = _aiSourceLibrary.findIndex(s => s.id === id);
  if (idx === -1) return;
  if (!confirm(`Remove source "${_aiSourceLibrary[idx].label}"? Any question currently set to use it will fall back to AI knowledge.`)) return;
  _aiSourceLibrary.splice(idx, 1);
  Object.keys(_aiSolveSourceChoice).forEach(k => {
    if (_aiSolveSourceChoice[k].type === 'lib' && _aiSolveSourceChoice[k].id === id) delete _aiSolveSourceChoice[k];
  });
  const btn = document.getElementById(`aiSolveSrcCaret_${editorKey}_${i}`);
  if (btn) btn.innerHTML = escapeHtml(_aiSolveSourceShortLabel(editorKey, i)) + ' ▾';
  const picker = document.getElementById(`aiSourcePicker_${editorKey}_${i}`);
  if (picker) { picker.innerHTML = _renderAiSourcePickerHTML(editorKey, i); }
}

// Solve a single question, in ANY editor ('cq' | 'admin' | 'customQuiz'),
// using whichever source the user has picked for it (see picker above).
async function aiSolveQuestion(editorKey, i) {
  // Shares a lock with Refine Question / Fill Choices / Add Choice (AI) on
  // this same question — see _aiToolsBusy — so AI Solve can never settle on
  // an answer while one of those is still mid-write to the same question's
  // options, and vice versa.
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

  const choice = _aiSolveGetChoice(editorKey, i);
  let sourceText = '', sourceFiles = [];
  if (choice.type === 'bulk') {
    if (editorKey === 'cq') { sourceFiles = cqAiSourceFiles || []; }
    else { sourceFiles = _editorBulkAiSourceFiles[editorKey] || []; }
  } else if (choice.type === 'lib') {
    const src = _aiSourceLibrary.find(s => s.id === choice.id);
    if (src) { sourceText = src.text || ''; sourceFiles = src.files || []; }
  }
  // choice.type === 'ai' → leave both empty so cqAiSolveQuestions answers
  // from general knowledge only.

  const _key = _aiToolsKey(editorKey, i);
  const token = { cancelled: false };
  _aiToolsCancelToken[_key] = token;
  _aiToolsSetBusy(editorKey, i, true, 'solve');
  const statusEl = _aiToolsStatusEl(editorKey, i);
  _aiToolsSetStatus(editorKey, i, _aiToolsLoadingHTML('🤖 AI is solving this question…'));
  try {
    await cqAiSolveQuestions(questions, [i], sourceText, sourceFiles, statusEl, token);
  } catch (e) {
    if (!(e && e._cancelled)) {
      _aiToolsSetStatus(editorKey, i, _aiToolsErrorHTML(e.message || 'Could not solve this question.'));
    }
  } finally {
    if (_aiToolsCancelToken[_key] === token) delete _aiToolsCancelToken[_key];
    _aiToolsSetBusy(editorKey, i, false, 'solve');
  }
  _markQuestionEditDirty();
  ed.rerender();
}


/* Extracts questions from a single file — used once per file when the user
   stages multiple images/PDFs to extract from in one go. Returns
   { cleaned, finishReason }. Each returned question is tagged with the File
   it came from (_sourceFile) so re-extract/re-ask actions later know which
   source to go back to.

   onProgress(frac, label): frac is 0–1 progress *within this one file*,
   reported at checkpoints tied to steps that already happen (start of the
   extraction call, after it returns, before/after the image-crop pass) —
   never from a dedicated "progress" AI call, so this adds zero extra load. */
async function _extractQuestionsFromFile(file, apiKey, onProgress) {
  const report = (frac, label) => { if (onProgress) onProgress(frac, label); };

  const mimeType = file.type ||
    (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

  report(0, `Reading "${escapeHtml(file.name)}"…`);
  const filePart = await buildGeminiFilePart(file, apiKey, mimeType);

  const url = geminiEndpoint();

  report(0.1, `Extracting questions from "${escapeHtml(file.name)}"…`);
  const data = await callGeminiWithRetry(url, {
    contents: [{
      parts: [
        filePart,
        { text: CQ_EXTRACTION_PROMPT }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: CQ_RESPONSE_SCHEMA,
      temperature: 0,
      maxOutputTokens: 65536
    }
  }, { pauseCheck: () => cqPauseRequested, cancelToken: cqCancelToken, apiKey });

  const candidate = data && data.candidates && data.candidates[0];
  if (!candidate) throw new Error(`Gemini returned no result for "${file.name}". The file may be unsupported or blocked — try a clearer image or PDF.`);

  let finishReason = candidate.finishReason;
  const textOut = (candidate.content && candidate.content.parts || [])
    .map(p => p.text || '').join('');
  if (!textOut.trim()) throw new Error(`Gemini returned an empty response for "${file.name}". Please try again.`);

  // parseGeminiJsonArray salvages every complete question already generated
  // even if the response was cut off mid-array (large document hit
  // maxOutputTokens) — previously any truncation lost the WHOLE file's
  // questions, not just the last incomplete one.
  const { data: parsed, truncated } = parseGeminiJsonArray(textOut);
  if (truncated) finishReason = 'MAX_TOKENS';

  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error(truncated
      ? `Gemini's response for "${file.name}" was cut off before any complete question came through — try splitting this file into smaller sections.`
      : `No questions could be detected in "${file.name}".`);
  }

  report(0.6, `Processing questions from "${escapeHtml(file.name)}"…`);
  // Case/vignette clusters: the AI assigns "case_1", "case_2"... IDs that are
  // only unique *within this file's own response* — prefix with a per-file
  // token so multiple uploaded files never collide with each other's groups.
  const groupPrefix = `f${_cqNextGroupPrefixId()}`;
  const cleaned = parsed.map(q => {
    if (!q || typeof q.question !== 'string' || !q.options || typeof q.options !== 'object') return null;
    const opts = {};
    Object.entries(q.options)
      .filter(([k, v]) => typeof v === 'string' && v.trim() !== '')
      .sort(([a], [b]) => a.toUpperCase().localeCompare(b.toUpperCase()))
      .forEach(([k, v]) => { opts[k.toUpperCase()] = v; });
    if (!Object.keys(opts).length) return null;
    const rawAnswer = (typeof q.answer === 'string') ? q.answer.trim() : '';
    const noKey = rawAnswer === '__NO_KEY__';
    let answer = noKey ? '' : rawAnswer.toUpperCase();
    if (!noKey && !opts[answer]) answer = Object.keys(opts)[0];
    const optionsOrder = Object.entries(opts).map(([key, value]) => ({ key, value }));
    const rawGroup = (typeof q.case_group === 'string') ? q.case_group.trim() : '';
    return {
      question: q.question, options: opts, optionsOrder, answer,
      has_image: !!q.has_image, no_answer_key: noKey, _sourceFile: file,
      case_group: rawGroup ? `${groupPrefix}:${rawGroup}` : null,
      case_is_core: !!q.case_is_core
    };
  }).filter(Boolean);

  if (!cleaned.length) throw new Error(`The AI response for "${file.name}" did not contain any usable questions.`);

  // Make sure every surviving case cluster has exactly one core question
  // (the one whose own text/image IS the shared case), and that stray
  // single-member "groups" don't stay a real group (nothing to share).
  _cqNormalizeCaseGroups(cleaned);

  // Extract embedded images for questions that have them. This step renders
  // PDF pages / crops regions locally in the browser, which needs the raw
  // bytes as base64 regardless of how the file was sent to Gemini above —
  // so it's read here, lazily, only when there's actually an image to pull.
  const imageQuestions = cleaned.filter(q => q.has_image);
  if (imageQuestions.length > 0) {
    report(0.65, `Extracting images from "${escapeHtml(file.name)}" for ${imageQuestions.length} question${imageQuestions.length !== 1 ? 's' : ''}…`);
    await extractImagesForQuestions(cleaned, file, apiKey, filePart);
  }

  report(1, `Finished "${escapeHtml(file.name)}"`);
  return { cleaned, finishReason };
}

async function generateQuizFromAI() {
  const titleInput  = document.getElementById('cqTitleInput');
  const statusEl    = document.getElementById('cqStatus');
  const genBtn      = document.getElementById('cqGenerateBtn');
  const pauseRow    = document.getElementById('cqPauseRow');
  const pauseBtn    = document.getElementById('cqPauseBtn');
  const resumeBtn   = document.getElementById('cqResumeBtn');

  let apiKey  = getActiveApiKey();
  const title = (titleInput ? titleInput.value : cqGeneratedTitle).trim();

  if (!apiKey)              { statusEl.innerHTML = `<div class="cq-status error">⚠️ Please add a Gemini API key first. <button class="apikey-open-btn ghost" style="margin-top:6px;" onclick="openApiKeyManager(() => renderCustomQuizModal())">🔑 Add API Key</button></div>`; return; }
  if (!cqSelectedFiles.length){ statusEl.innerHTML = `<div class="cq-status error">⚠️ Please upload at least one image or PDF of your quiz first.</div>`; return; }
  if (!title)               { statusEl.innerHTML = `<div class="cq-status error">⚠️ Please give this quiz a title.</div>`; return; }

  cqGeneratedTitle = title;
  cqBusy = true;
  cqPauseRequested = false;
  cqPauseSkipRequested = false;
  cqIsPaused = false;
  cqStopRequested = false;
  cqCancelToken = { cancelled: false };
  if (genBtn) { genBtn.disabled = true; genBtn.textContent = '⏳ Generating…'; }
  if (pauseRow)  pauseRow.style.display  = 'flex';
  if (pauseBtn)  { pauseBtn.style.display = 'inline-flex'; pauseBtn.disabled = false; pauseBtn.textContent = '⏸️ Pause'; }
  if (resumeBtn) resumeBtn.style.display = 'none';
  const stopBtn = document.getElementById('cqStopBtn');
  if (stopBtn) { stopBtn.disabled = false; stopBtn.textContent = '⏹ Stop'; }
  statusEl.innerHTML = _cqProgressStatusHTML(`Reading your file${cqSelectedFiles.length > 1 ? 's' : ''} and extracting all questions…`, 0);

  try {
    let cleaned = [];
    let truncatedFiles = [];
    const totalFiles = cqSelectedFiles.length;
    for (let fi = 0; fi < totalFiles; fi++) {
      // Safe checkpoint — takes effect only if the user clicked Pause, and
      // returns the freshly-active key in case it was switched meanwhile.
      apiKey = await cqCheckPause(statusEl);
      if (!apiKey) throw new Error('No active API key. Add or select one, then click Extract Questions again.');

      const file = cqSelectedFiles[fi];
      const basePct  = (fi / totalFiles) * 100;
      const slicePct = 100 / totalFiles;
      const onProgress = (frac, label) => {
        const prefix = totalFiles > 1 ? `File ${fi + 1} of ${totalFiles} — ` : '';
        statusEl.innerHTML = _cqProgressStatusHTML(prefix + label, basePct + slicePct * frac);
      };

      let result;
      while (true) {
        try {
          result = await _extractQuestionsFromFile(file, apiKey, onProgress);
          break;
        } catch (fileErr) {
          // User clicked "pause now" instead of waiting for this file to
          // finish — abort landed here as a cancellation. Step back to the
          // last completed checkpoint (before this file) rather than losing
          // the whole run, exactly like the automatic rate-limit fallback
          // below, just user-triggered instead of automatic.
          if (fileErr._cancelled && typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested) {
            cqPauseSkipRequested = false;
            cqCancelToken = { cancelled: false }; // old token is permanently cancelled — start fresh
            apiKey = await _cqEnterPause(statusEl,
              `⏸️ Paused — stepped back to before "${escapeHtml(file.name)}" so nothing already done is lost. Open 🔑 Manage APIs to switch keys, then press ▶️ Resume to continue.`);
            if (!apiKey) throw new Error('No active API key. Add or select one, then click Extract Questions again.');
            continue; // retry this same file
          }
          if (fileErr._rateLimitPauseFallback) {
            apiKey = await cqFallbackPauseForRateLimit(statusEl, `"${file.name}"`);
            if (!apiKey) throw new Error('No active API key. Add or select one, then click Extract Questions again.');
            continue; // retry this same file with the (hopefully new) key
          }
          throw fileErr;
        }
      }
      cleaned = cleaned.concat(result.cleaned);
      if (result.finishReason === 'MAX_TOKENS') truncatedFiles.push(file.name);
    }

    if (!cleaned.length) throw new Error('No questions could be detected in the uploaded file(s).');

    cqGeneratedQuestions = cleaned;
    _markQuestionEditDirty(); // freshly extracted content is unsaved — warn before it's closed away

    // Handle questions without answer keys
    const noKeyQs = cleaned.filter(q => q.no_answer_key);
    if (cqAiAnsweringEnabled && cqAiAnswerSubmode === 'all') {
      // Solve ALL questions (including those with existing keys)
      const allIdxs = cleaned.map((_, i) => i);
      statusEl.innerHTML = `<div class="cq-status info"><div class="cq-spinner"></div> 🤖 AI is solving all ${cleaned.length} question${cleaned.length !== 1 ? 's' : ''}… please wait.</div>`;
      await cqAiSolveQuestions(cleaned, allIdxs, cqAiAnswerSource.trim(), cqAiSourceFiles, statusEl, cqCancelToken);
    } else if (cqAiAnsweringEnabled && cqAiAnswerSubmode === 'missing' && noKeyQs.length > 0) {
      // Solve only no-key questions
      statusEl.innerHTML = `<div class="cq-status info"><div class="cq-spinner"></div> 🤖 AI is answering ${noKeyQs.length} question${noKeyQs.length !== 1 ? 's' : ''} without an answer key… please wait.</div>`;
      await cqAiAnswerMissingKeys(cleaned, cqAiAnswerSource.trim(), cqAiSourceFiles, statusEl, cqCancelToken);
    }

    // ── Fill Choices, then Refine Questions — run STRICTLY one after the
    // other (never together, and never alongside the solve/answer step
    // above, which has already finished by this point). All three steps
    // write to the same question objects (answer/options/question text),
    // so firing them concurrently risks one step's write clobbering
    // another's — e.g. Fill Choices adding a distractor while Refine is
    // mid-rewrite of the same question's stem. Running them in this fixed
    // order — Solve/Answer → Fill Choices → Refine — also makes the most
    // sense content-wise: nail down the correct answer first, then pad out
    // the remaining choices around it, and only polish the wording last,
    // once nothing about the question is still changing.
    let fillResult   = null;
    let refineResult = null;
    if (cqFillChoicesToggle) {
      fillResult = await cqBulkFillChoices(cleaned, statusEl, cqCancelToken);
    }
    if (cqRefineToggle) {
      refineResult = await cqBulkRefineQuestions(cleaned, cqRefineCustomInstructions.trim(), statusEl, cqCancelToken);
    }

    let warn = '';
    if (truncatedFiles.length) {
      const fileList = truncatedFiles.map(n => `"${escapeHtml(n)}"`).join(', ');
      warn = ` ⚠️ ${truncatedFiles.length > 1 ? 'These files\' responses were' : 'This file\'s response was'} cut off because the document is very large: ${fileList}. Every complete question up to that point was still recovered, but check below that nothing near the end is missing, and split very long documents into smaller files if needed.`;
    }

    const imgCount    = cleaned.filter(q => q.image).length;
    const imgNote     = imgCount > 0 ? ` · 🖼️ ${imgCount} image${imgCount !== 1 ? 's' : ''} embedded` : '';
    const noKeyCount  = noKeyQs.length;
    const aiCount     = cleaned.filter(q => q.ai_answered).length;
    const guessCount  = cleaned.filter(q => q.ai_guessed).length;
    const solveNote   = cqAiAnsweringEnabled && cqAiAnswerSubmode === 'all' && aiCount > 0
      ? ` · 🤖 ${aiCount} AI-solved${guessCount > 0 ? ' (⚠️ ' + guessCount + ' from own knowledge)' : ''}`
      : noKeyCount > 0 && cqAiAnsweringEnabled && cqAiAnswerSubmode === 'missing' && aiCount > 0
      ? ` · 🤖 ${aiCount} AI-answered${guessCount > 0 ? ' (⚠️ ' + guessCount + ' from own knowledge)' : ''}`
      : noKeyCount > 0 ? ` · ⚠️ ${noKeyCount} without key` : '';
    const fileNote   = cqSelectedFiles.length > 1 ? ` from ${cqSelectedFiles.length} files` : '';
    const fillNote   = fillResult && fillResult.done > 0
      ? ` · 🧩 ${fillResult.done} question${fillResult.done !== 1 ? 's' : ''} filled to 4 choices` : '';
    const refineNote = refineResult && refineResult.done > 0
      ? ` · 🪄 ${refineResult.done} question${refineResult.done !== 1 ? 's' : ''} refined` : '';
    statusEl.innerHTML = `<div class="cq-status success">✅ Extracted ${cleaned.length} question${cleaned.length !== 1 ? 's' : ''}${fileNote}${imgNote}${solveNote}${fillNote}${refineNote}. Review below, then save.${warn}</div>`;

    // Surface any per-question errors from the Fill Choices / Refine passes
    // without blocking the rest of the summary — extraction itself already
    // succeeded, these are just best-effort polish steps.
    [['🧩 Fill Choices', fillResult], ['🪄 Refine Questions', refineResult]].forEach(([label, res]) => {
      if (res && res.errors.length > 0) {
        const errHtml = res.errors.map(err => `<div>⚠️ ${escapeHtml(err)}</div>`).join('');
        statusEl.insertAdjacentHTML('beforeend',
          `<div class="cq-status warning" style="margin-top:6px;">${label} ran into issues on some questions:<br>${errHtml}</div>`
        );
      }
    });
    if (noKeyCount > 0 && !cqAiAnsweringEnabled) {
      statusEl.insertAdjacentHTML('beforeend',
        `<div class="cq-status warning" style="margin-top:6px;">⚠️ ${noKeyCount} question${noKeyCount !== 1 ? 's have' : ' has'} no answer key in the source document and ${noKeyCount !== 1 ? 'are' : 'is'} marked below with a <strong>⚠️ No Key</strong> badge. You can set the correct answer manually, or enable <strong>🤖 AI Answering</strong> before extracting to let AI answer them automatically.</div>`
      );
    }
    if (guessCount > 0) {
      statusEl.insertAdjacentHTML('beforeend',
        `<div class="cq-status warning" style="margin-top:6px;">🧠 ${guessCount} question${guessCount !== 1 ? 's were' : ' was'} answered from AI’s own knowledge (answer not found in the provided source). These are marked with a <strong>🧠 AI Guess</strong> badge — please verify them.</div>`
      );
    }
    renderCQPreview();

  } catch (err) {
    const isKeyErr = err._keyError ||
      /api.?key|invalid.?key|not.?valid|permission.?denied/i.test(err.message || '');
    if (err._cqStopped || err._cancelled) {
      statusEl.innerHTML = '';
    } else if (isKeyErr) {
      statusEl.innerHTML = `<div class="cq-status error">🔑 Your active API key was rejected or is invalid.<br><small>${escapeHtml(err.message || String(err))}</small><br><br>
        <button class="apikey-open-btn ghost" onclick="openApiKeyManager(() => renderCustomQuizModal())">🔑 Choose or Add a Different Key</button>
      </div>`;
    } else {
      statusEl.innerHTML = `<div class="cq-status error">❌ ${escapeHtml(err.message || String(err))}</div>`;
    }
  } finally {
    cqBusy = false;
    cqPauseRequested = false;
    cqPauseSkipRequested = false;
    cqIsPaused = false;
    cqStopRequested = false;
    cqCancelToken = null;
    cqResumeResolve = null;
    if (pauseRow) pauseRow.style.display = 'none';
    const btn = document.getElementById('cqGenerateBtn');
    if (btn) { btn.disabled = false; btn.textContent = '✨ Generate Quiz'; }
  }
}

function buildGenerationPrompt(questionCount, customPrompt) {
  const countInstruction = (questionCount && parseInt(questionCount) > 0)
    ? `Generate exactly ${parseInt(questionCount)} questions.`
    : `Decide the appropriate number of questions based on the content length — aim for roughly 1 question per major concept or topic, with a minimum of 10 and a maximum of 60.`;

  const focusInstruction = (customPrompt && customPrompt.trim())
    ? `Custom focus from the user: "${customPrompt.trim()}"`
    : `Cover all major topics in the material comprehensively.`;

  return `You are an expert medical exam question writer. Read the uploaded lecture material carefully and generate original, high-quality multiple-choice questions (MCQs) based ONLY on the content provided.

QUESTION COUNT: ${countInstruction}

DIFFICULTY: Hard — questions must require reasoning, clinical application, or integration of concepts. Avoid simple recall questions.

QUESTION TYPES:
- At least 50% of questions must be clinical scenario questions. These should start with a patient presentation, e.g.: "A 52-year-old male with a history of hypertension presents to the emergency department with sudden-onset chest pain radiating to the left arm..."
- The remaining questions can test mechanisms, pathophysiology, pharmacology, or key concepts from the lecture.

FOCUS: ${focusInstruction}

STRICT RULES:
1. Write ALL questions yourself — do NOT copy sentences from the lecture verbatim.
2. Every question must have exactly 4 or 5 answer options (A, B, C, D — or A through E).
3. Only one option is correct. Make the distractors plausible and clinically realistic.
4. The correct answer must be definitively supported by the lecture content.
5. Do NOT include any question that cannot be answered from the provided material.
6. Do NOT add explanations, rationales, or commentary.

Return ONLY a JSON array, one object per question, in exactly this format:
[
  {
    "question": "full question text here",
    "options": { "A": "option text", "B": "option text", "C": "option text", "D": "option text" },
    "answer": "A"
  }
]

The "answer" value must be one of the keys present in that question's "options" object. Output nothing besides the JSON array — no markdown fences, no preamble, no commentary.`;
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result || '');
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsText(file);
  });
}

/* onProgress(frac, label): same deterministic, no-extra-AI-call pattern as
   _extractQuestionsFromFile — checkpoints line up with steps that already
   happen (reading, generating, processing). */
async function _generateQuestionsFromLectureFile(file, generationPrompt, apiKey, onProgress) {
  const report = (frac, label) => { if (onProgress) onProgress(frac, label); };
  const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
  const url = geminiEndpoint();

  let requestBody;

  report(0, `Reading "${escapeHtml(file.name)}"…`);
  if (isTxt && file.size <= GEMINI_INLINE_THRESHOLD_BYTES) {
    // Small text file: send as plain text alongside the prompt
    const lectureText = await fileToText(file);
    if (!lectureText.trim()) throw new Error(`"${file.name}" appears to be empty.`);
    requestBody = {
      contents: [{
        parts: [
          { text: `LECTURE CONTENT:\n\n${lectureText}\n\n---\n\n${generationPrompt}` }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: CQ_RESPONSE_SCHEMA,
        temperature: 0.7,
        maxOutputTokens: 65536
      }
    };
  } else {
    // PDF, image, or a text file too big to inline — let buildGeminiFilePart
    // decide between inline base64 and the Files API based on size.
    const mimeType = file.type ||
      (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' :
       isTxt ? 'text/plain' : 'image/jpeg');
    const filePart = await buildGeminiFilePart(file, apiKey, mimeType);
    requestBody = {
      contents: [{
        parts: [
          filePart,
          { text: generationPrompt }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: CQ_RESPONSE_SCHEMA,
        temperature: 0.7,
        maxOutputTokens: 65536
      }
    };
  }

  report(0.15, `Generating questions from "${escapeHtml(file.name)}"…`);
  const data = await callGeminiWithRetry(url, requestBody, { pauseCheck: () => cqPauseRequested, cancelToken: cqCancelToken, apiKey });

  const candidate = data && data.candidates && data.candidates[0];
  if (!candidate) throw new Error(`Gemini returned no result for "${file.name}". The file may be unsupported or too large — try splitting it into smaller sections.`);

  let finishReason = candidate.finishReason;
  const textOut = (candidate.content && candidate.content.parts || [])
    .map(p => p.text || '').join('');
  if (!textOut.trim()) throw new Error(`Gemini returned an empty response for "${file.name}". Please try again.`);

  // See matching comment in _extractQuestionsFromFile — salvages whatever
  // complete questions came through before a truncated response, instead of
  // discarding all of them.
  const { data: parsed, truncated } = parseGeminiJsonArray(textOut);
  if (truncated) finishReason = 'MAX_TOKENS';

  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error(truncated
      ? `Gemini's response for "${file.name}" was cut off before any complete question came through — try reducing the question count or splitting the lecture into smaller sections.`
      : `No questions were generated from "${file.name}". Try uploading a more detailed lecture or reducing the question count.`);
  }

  report(0.75, `Processing questions from "${escapeHtml(file.name)}"…`);
  const cleaned = parsed.map(q => {
    if (!q || typeof q.question !== 'string' || !q.options || typeof q.options !== 'object') return null;
    const opts = {};
    Object.entries(q.options)
      .filter(([k, v]) => typeof v === 'string' && v.trim() !== '')
      .sort(([a], [b]) => a.toUpperCase().localeCompare(b.toUpperCase()))
      .forEach(([k, v]) => { opts[k.toUpperCase()] = v; });
    if (!Object.keys(opts).length) return null;
    let answer = (typeof q.answer === 'string') ? q.answer.trim().toUpperCase() : '';
    if (!opts[answer]) answer = Object.keys(opts)[0];
    const optionsOrder = Object.entries(opts).map(([key, value]) => ({ key, value }));
    return { question: q.question, options: opts, optionsOrder, answer, _sourceFile: file };
  }).filter(Boolean);

  if (!cleaned.length) throw new Error(`The AI response for "${file.name}" did not contain any usable questions.`);

  report(1, `Finished "${escapeHtml(file.name)}"`);
  return { cleaned, finishReason };
}

async function generateQuizFromLecture() {
  const titleInput    = document.getElementById('cqLectureTitleInput');
  const qCountInput   = document.getElementById('cqQCountInput');
  const promptInput   = document.getElementById('cqCustomPromptInput');
  const statusEl      = document.getElementById('cqStatus');
  const genBtn        = document.getElementById('cqLectureGenBtn');
  const pauseRow      = document.getElementById('cqPauseRow');
  const pauseBtn      = document.getElementById('cqPauseBtn');
  const resumeBtn     = document.getElementById('cqResumeBtn');

  let apiKey   = getActiveApiKey();
  const title  = (titleInput  ? titleInput.value  : cqGeneratedTitle).trim();
  const qCount = (qCountInput ? qCountInput.value : cqQuestionCount).trim();
  const prompt = (promptInput ? promptInput.value : cqCustomPrompt).trim();

  if (!apiKey)               { statusEl.innerHTML = `<div class="cq-status error">⚠️ Please add a Gemini API key first. <button class="apikey-open-btn ghost" style="margin-top:6px;" onclick="openApiKeyManager(() => renderCustomQuizModal())">🔑 Add API Key</button></div>`; return; }
  if (!cqLectureFiles.length) { statusEl.innerHTML = `<div class="cq-status error">⚠️ Please upload at least one lecture file first.</div>`; return; }
  if (!title)                { statusEl.innerHTML = `<div class="cq-status error">⚠️ Please give this quiz a title.</div>`; return; }

  cqGeneratedTitle = title;
  cqCustomPrompt   = prompt;
  cqQuestionCount  = qCount;
  cqBusy = true;
  cqPauseRequested = false;
  cqPauseSkipRequested = false;
  cqIsPaused = false;
  cqStopRequested = false;
  cqCancelToken = { cancelled: false };
  if (genBtn) { genBtn.disabled = true; genBtn.textContent = '⏳ Generating…'; }
  if (pauseRow)  pauseRow.style.display  = 'flex';
  if (pauseBtn)  { pauseBtn.style.display = 'inline-flex'; pauseBtn.disabled = false; pauseBtn.textContent = '⏸️ Pause'; }
  if (resumeBtn) resumeBtn.style.display = 'none';
  {
    const stopBtn = document.getElementById('cqStopBtn');
    if (stopBtn) { stopBtn.disabled = false; stopBtn.textContent = '⏹ Stop'; }
  }
  statusEl.innerHTML = _cqProgressStatusHTML(`Reading your lecture${cqLectureFiles.length > 1 ? 's' : ''} and generating questions…`, 0);

  try {
    const generationPrompt = buildGenerationPrompt(qCount, prompt);

    let cleaned = [];
    let truncatedFiles = [];
    const totalFiles = cqLectureFiles.length;
    for (let fi = 0; fi < totalFiles; fi++) {
      // Safe checkpoint — takes effect only if the user clicked Pause, and
      // returns the freshly-active key in case it was switched meanwhile.
      apiKey = await cqCheckPause(statusEl);
      if (!apiKey) throw new Error('No active API key. Add or select one, then click Generate Questions again.');

      const file = cqLectureFiles[fi];
      const basePct  = (fi / totalFiles) * 100;
      const slicePct = 100 / totalFiles;
      const onProgress = (frac, label) => {
        const prefix = totalFiles > 1 ? `Lecture ${fi + 1} of ${totalFiles} — ` : '';
        statusEl.innerHTML = _cqProgressStatusHTML(prefix + label, basePct + slicePct * frac);
      };

      let result;
      while (true) {
        try {
          result = await _generateQuestionsFromLectureFile(file, generationPrompt, apiKey, onProgress);
          break;
        } catch (fileErr) {
          // User clicked "pause now" instead of waiting for this file to
          // finish — step back to the last completed checkpoint (before this
          // file) rather than losing the whole run. See the matching comment
          // in generateQuizFromAI for the full explanation.
          if (fileErr._cancelled && typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested) {
            cqPauseSkipRequested = false;
            cqCancelToken = { cancelled: false }; // old token is permanently cancelled — start fresh
            apiKey = await _cqEnterPause(statusEl,
              `⏸️ Paused — stepped back to before "${escapeHtml(file.name)}" so nothing already done is lost. Open 🔑 Manage APIs to switch keys, then press ▶️ Resume to continue.`);
            if (!apiKey) throw new Error('No active API key. Add or select one, then click Generate Questions again.');
            continue; // retry this same file
          }
          if (fileErr._rateLimitPauseFallback) {
            apiKey = await cqFallbackPauseForRateLimit(statusEl, `"${file.name}"`);
            if (!apiKey) throw new Error('No active API key. Add or select one, then click Generate Questions again.');
            continue; // retry this same file with the (hopefully new) key
          }
          throw fileErr;
        }
      }
      cleaned = cleaned.concat(result.cleaned);
      if (result.finishReason === 'MAX_TOKENS') truncatedFiles.push(file.name);
    }

    if (!cleaned.length) throw new Error('No questions were generated. Try uploading a more detailed lecture or reducing the question count.');

    cqGeneratedQuestions = cleaned;
    _markQuestionEditDirty(); // freshly generated content is unsaved — warn before it's closed away

    let warn = '';
    if (truncatedFiles.length) {
      const fileList = truncatedFiles.map(n => `"${escapeHtml(n)}"`).join(', ');
      warn = ` ⚠️ ${truncatedFiles.length > 1 ? 'These files\' responses were' : 'This file\'s response was'} cut off because the document is very large: ${fileList}. Every complete question up to that point was still recovered, but try splitting very long documents into smaller files for a full set.`;
    }

    const clinicalCount = cleaned.filter(q =>
      /\b(patient|presents|year.old|male|female|man|woman|child|boy|girl|case|history|examination|complains|admitted|brought|referred)\b/i.test(q.question)
    ).length;
    const clinicalPct = Math.round((clinicalCount / cleaned.length) * 100);
    const fileNote = cqLectureFiles.length > 1 ? ` from ${cqLectureFiles.length} files` : '';

    statusEl.innerHTML = `<div class="cq-status success">✅ Generated ${cleaned.length} question${cleaned.length !== 1 ? 's' : ''}${fileNote} (${clinicalPct}% clinical scenarios). Review below, then save.${warn}</div>`;
    renderCQPreview();

  } catch (err) {
    const isKeyErr = err._keyError ||
      /api.?key|invalid.?key|not.?valid|permission.?denied/i.test(err.message || '');
    if (err._cqStopped || err._cancelled) {
      statusEl.innerHTML = `<div class="cq-status warning">⏹️ Stopped. Nothing generated before the abort was lost, but you'll need to click <strong>Generate Questions</strong> again to continue.</div>`;
    } else if (isKeyErr) {
      statusEl.innerHTML = `<div class="cq-status error">🔑 Your active API key was rejected or is invalid.<br><small>${escapeHtml(err.message || String(err))}</small><br><br>
        <button class="apikey-open-btn ghost" onclick="openApiKeyManager(() => renderCustomQuizModal())">🔑 Choose or Add a Different Key</button>
      </div>`;
    } else {
      statusEl.innerHTML = `<div class="cq-status error">❌ ${escapeHtml(err.message || String(err))}</div>`;
    }
  } finally {
    cqBusy = false;
    cqPauseRequested = false;
    cqPauseSkipRequested = false;
    cqIsPaused = false;
    cqStopRequested = false;
    cqCancelToken = null;
    cqResumeResolve = null;
    if (pauseRow) pauseRow.style.display = 'none';
    const btn = document.getElementById('cqLectureGenBtn');
    if (btn) { btn.disabled = false; btn.textContent = '🧠 Generate Questions'; }
  }
}

function renderCQPreview() {
  const area = document.getElementById('cqPreviewArea');
  if (!area) return;
  if (!cqGeneratedQuestions) { area.innerHTML = ''; return; }

  // Remember scroll position of the inner question list — it gets torn down
  // and rebuilt below, which would otherwise reset it to the top (Q1) on
  // every single edit (image change, option edit, delete, etc.)
  const _prevList = document.getElementById('cqPreviewList');
  const _prevScrollTop = _prevList ? _prevList.scrollTop : null;

  // All next-available option keys
  const ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:8px 0 10px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;">
      ✏️ Review &amp; Edit — ${cqGeneratedQuestions.length} question${cqGeneratedQuestions.length !== 1 ? 's' : ''}
    </div>
    <div style="font-size:.74rem;color:var(--text-muted);font-weight:600;">
      Click any field to edit &nbsp;·&nbsp; 🔘 = correct answer &nbsp;·&nbsp; 🤖 = re-ask AI &nbsp;·&nbsp; 🔗 = linked case questions
    </div>
  </div>`;
  html += `<div class="cq-preview-list" id="cqPreviewList">`;

  cqGeneratedQuestions.forEach((q, i) => {
    const optEntries = getOptionEntries(q);
    const usedKeys   = optEntries.map(([k]) => k);
    const nextKey    = ALL_KEYS.find(k => !usedKeys.includes(k));

    html += `<div class="cq-preview-q cq-editable-q" id="cqQ_${i}">`;

    /* ── Question header ── */
    const qBadge = q.ai_guessed
      ? `<span title="AI answered this from its own knowledge — answer was not found in the provided source. Please verify." style="background:var(--amber-pale);color:var(--unanswered-fg);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--amber-mid);">🧠 AI Guess</span>`
      : q.ai_answered
      ? `<span title="AI answered this question from the provided source" style="background:var(--violet-pale);color:var(--violet-dark);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--violet-border);">🤖 AI-answered</span>`
      : q.no_answer_key
      ? `<span title="No answer key found in the PDF — please set the correct answer manually" style="background:var(--unanswered-bg);color:var(--unanswered-fg);font-size:.68rem;font-weight:800;border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid var(--amber-strong);">⚠️ No Key</span>`
      : '';
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">
      <span style="background:var(--accent);color:#fff;font-size:.72rem;font-weight:800;
        border-radius:20px;padding:2px 9px;white-space:nowrap;flex-shrink:0;">Q${i + 1}</span>
      ${qBadge}
      ${_renderMergeSourceBadge(q)}
      <span style="flex:1;font-size:.75rem;font-weight:700;color:var(--text-muted);">Question Text</span>
      ${_renderReorderButtons('cq', i, cqGeneratedQuestions.length)}
      <button class="cq-edit-reask-btn" title="Delete this question"
        onclick="cqDeleteQuestion(${i})"
        style="background:var(--wrong-bg);color:var(--wrong-fg);border-color:var(--red-soft-border);">🗑 Delete</button>
    </div>`;

    /* ── Question textarea ── */
    html += `<textarea class="cq-edit-textarea" rows="2"
      oninput="cqEditQuestion(${i}, this.value)"
      style="width:100%;resize:vertical;margin-bottom:8px;">${escapeHtml(q.question)}</textarea>`;

    /* ── AI Question Tools: Refine Question + custom instructions ── */
    html += _renderAiRefineTools('cq', i);

    /* ── Image area ── */
    html += `<div class="cq-img-edit-row" style="margin-bottom:8px;">`;
    if (q.image) {
      html += `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;
        background:var(--surface-2);border:1.5px solid var(--border-soft);border-radius:8px;padding:8px 10px;">
        <div style="flex-shrink:0;border-radius:5px;overflow:hidden;border:1px solid var(--border-soft-2);background:#fff;">
          <img src="${q.image}" alt="Question image"
            style="max-width:200px;max-height:130px;object-fit:contain;display:block;" />
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;justify-content:center;">
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;">📷 Question Image</div>
          <label class="cq-img-action-btn" title="Upload a different image">
            🔄 Change Image
            <input type="file" accept="image/*" style="display:none;" onchange="cqReplaceImage(${i}, event)" />
          </label>
          <button class="cq-img-action-btn cq-img-remove-btn" onclick="cqRemoveImage(${i})" type="button">🗑️ Remove Image</button>
        </div>
      </div>`;
    } else if (q.has_image) {
      html += `<div style="padding:8px 12px;background:var(--unanswered-bg);border:1.5px dashed var(--unanswered-fg);
        border-radius:7px;font-size:.78rem;color:#795500;font-weight:700;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          ⚠️ AI detected an image for this question but couldn't extract it
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <label class="cq-img-action-btn" style="color:var(--accent);border-color:var(--accent);" title="Upload image manually">
            📎 Upload Image Manually
            <input type="file" accept="image/*" style="display:none;" onchange="cqReplaceImage(${i}, event)" />
          </label>
        </div>
      </div>`;
    } else {
      html += `<label class="cq-img-upload-label" title="Attach an image to this question">
        🖼️ Add Image (optional)
        <input type="file" accept="image/*" style="display:none;" onchange="cqReplaceImage(${i}, event)" />
      </label>`;
    }
    html += `</div>`; // end img-edit-row

    /* ── Manual case-group link ── */
    html += _renderCaseGroupBlock('cq', cqGeneratedQuestions, i);

    /* ── Options label ── */
    html += `<div style="font-size:.72rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;">
      Answer Choices &nbsp;<span style="font-weight:500;text-transform:none;letter-spacing:0;">— select the correct answer with 🔘</span>
    </div>`;

    /* ── Options rows ── */
    html += `<div style="display:flex;flex-direction:column;gap:5px;" id="cqOpts_${i}">`;
    optEntries.forEach(([k, v]) => {
      const isCorrect = k === q.answer;
      html += `<div class="cq-opt-edit-row${isCorrect ? ' cq-opt-correct' : ''}" id="cqOptRow_${i}_${k}">
        <label class="cq-opt-correct-radio" title="Set as correct answer">
          <input type="radio" name="cqAnswer_${i}" value="${k}" ${isCorrect ? 'checked' : ''}
            onchange="cqSetAnswer(${i}, '${k}')" />
          <span class="cq-radio-dot"></span>
        </label>
        <span class="cq-opt-key">${k}.</span>
        <input type="text" class="cq-opt-text-input" value="${escapeHtml(v)}"
          oninput="cqEditOption(${i}, '${k}', this.value)"
          placeholder="Option ${k} text…" />
        ${isCorrect ? '<span class="cq-correct-badge">✔ Correct</span>' : ''}
        <button onclick="cqDeleteOption(${i}, '${k}')" type="button" title="Remove this option"
          style="background:none;border:none;cursor:pointer;color:var(--red-soft-border);font-size:.9rem;
          padding:2px 4px;border-radius:4px;flex-shrink:0;line-height:1;transition:color .15s;"
          onmouseover="this.style.color='var(--wrong-fg)'" onmouseout="this.style.color='var(--red-soft-border)'">✕</button>
      </div>`;
    });
    html += `</div>`; // end opts

    /* ── Add option button (if there are remaining keys) ── */
    if (nextKey) {
      html += `<button onclick="cqAddOption(${i})" type="button"
        style="margin-top:5px;background:var(--surface-2);color:var(--accent);border:1.5px dashed var(--border-soft);
        border-radius:7px;padding:5px 12px;font-family:var(--font);font-size:.78rem;font-weight:700;
        cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;"
        onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--surface-2-hover)';"
        onmouseout="this.style.borderColor='var(--border-soft)';this.style.background='var(--surface-2)';">
        ＋ Add Option ${nextKey}
      </button>`;
    }

    /* ── AI Question Tools: Add Choice (AI) / Fill Choices (AI) ── */
    html += _renderAiChoiceTools('cq', i, optEntries.length, nextKey);

    html += `</div>`; // end .cq-editable-q
  });

  html += `</div>`;

  /* ── Add question + save/discard ── */
  html += `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <button class="cq-btn" onclick="saveGeneratedCustomQuiz()">💾 Save Quiz</button>
    <button class="cq-btn cq-btn-secondary" onclick="cqAddBlankQuestion()"
      style="background:var(--green-mid);">＋ Add Question</button>
    <button class="cq-btn cq-btn-secondary" onclick="openMergePicker('cq')"
      style="background:var(--violet);color:#fff;">🧩 Merge Quizzes In</button>
    <button class="cq-btn cq-btn-secondary" onclick="openSplitPanel('preview', null)"
      style="background:var(--violet);color:#fff;">✂️ Split into Multiple</button>
    <button class="cq-btn cq-btn-secondary" onclick="discardGeneratedQuiz()">✖ Discard</button>
  </div>`;

  html += renderSplitPanel('preview', null, cqGeneratedQuestions.length);

  area.innerHTML = html;

  // Restore scroll position (unless this is the very first render)
  if (_prevScrollTop !== null) {
    const _newList = document.getElementById('cqPreviewList');
    if (_newList) _newList.scrollTop = _prevScrollTop;
  }
}

/* ── Edit helpers for the preview ── */
function cqEditQuestion(idx, val) {
  if (!cqGeneratedQuestions || !cqGeneratedQuestions[idx]) return;
  cqGeneratedQuestions[idx].question = val;
  _markQuestionEditDirty();
}

function cqEditOption(idx, key, val) {
  if (!cqGeneratedQuestions || !cqGeneratedQuestions[idx]) return;
  cqGeneratedQuestions[idx].options[key] = val;
  // keep optionsOrder in sync
  const order = cqGeneratedQuestions[idx].optionsOrder;
  if (order) {
    const entry = order.find(o => o.key === key);
    if (entry) entry.value = val;
  }
  _markQuestionEditDirty();
}

function cqSetAnswer(idx, key) {
  if (!cqGeneratedQuestions || !cqGeneratedQuestions[idx]) return;
  cqGeneratedQuestions[idx].answer = key;
  _markQuestionEditDirty();
  // Re-render just the option rows for this question to update correct highlights
  const q = cqGeneratedQuestions[idx];
  getOptionEntries(q).forEach(([k]) => {
    const row = document.getElementById(`cqOptRow_${idx}_${k}`);
    if (!row) return;
    const isNowCorrect = k === key;
    row.classList.toggle('cq-opt-correct', isNowCorrect);
    // Update or remove correct badge
    let badge = row.querySelector('.cq-correct-badge');
    if (isNowCorrect && !badge) {
      badge = document.createElement('span');
      badge.className = 'cq-correct-badge';
      badge.textContent = '✔ Correct';
      row.appendChild(badge);
    } else if (!isNowCorrect && badge) {
      badge.remove();
    }
  });
}

function cqRemoveImage(idx) {
  if (!cqGeneratedQuestions || !cqGeneratedQuestions[idx]) return;
  cqGeneratedQuestions[idx].image    = undefined;
  cqGeneratedQuestions[idx].has_image = false;
  _markQuestionEditDirty();
  renderCQPreview();
}

function cqReplaceImage(idx, event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !cqGeneratedQuestions || !cqGeneratedQuestions[idx]) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    // Compress before storing
    try {
      cqGeneratedQuestions[idx].image    = await compressImageDataUrl(dataUrl);
      cqGeneratedQuestions[idx].has_image = true;
    } catch(e) {
      cqGeneratedQuestions[idx].image    = dataUrl;
      cqGeneratedQuestions[idx].has_image = true;
    }
    _markQuestionEditDirty();
    renderCQPreview();
  };
  reader.readAsDataURL(file);
}

/* ── Delete a question from the preview ── */
function cqDeleteQuestion(idx) {
  if (!cqGeneratedQuestions) return;
  if (!confirm(`Remove Q${idx + 1} from the quiz?`)) return;
  cqGeneratedQuestions.splice(idx, 1);
  _markQuestionEditDirty();
  renderCQPreview();
}

/* ── Add a blank question at the end ── */
function cqAddBlankQuestion() {
  if (!cqGeneratedQuestions) cqGeneratedQuestions = [];
  cqGeneratedQuestions.push({
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    optionsOrder: [
      { key: 'A', value: '' }, { key: 'B', value: '' },
      { key: 'C', value: '' }, { key: 'D', value: '' }
    ],
    answer: 'A',
    has_image: false,
    // Marks this question as having no counterpart in the source document
    // (it was typed in by hand, not extracted). Kept for provenance/future
    // use even though the preview's re-extract controls have been removed.
    _notExtractable: true
  });
  _markQuestionEditDirty();
  renderCQPreview();
  // Scroll to new question
  setTimeout(() => {
    const last = document.getElementById(`cqQ_${cqGeneratedQuestions.length - 1}`);
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}

/* ── Delete a single option from a question ── */
function cqDeleteOption(qIdx, key) {
  if (!cqGeneratedQuestions || !cqGeneratedQuestions[qIdx]) return;
  const q = cqGeneratedQuestions[qIdx];
  if (Object.keys(q.options).length <= 2) {
    alert('A question must have at least 2 options.');
    return;
  }
  delete q.options[key];
  if (q.optionsOrder) q.optionsOrder = q.optionsOrder.filter(o => o.key !== key);
  // If we deleted the correct answer, pick first remaining
  if (q.answer === key) q.answer = Object.keys(q.options)[0] || '';
  _markQuestionEditDirty();
  renderCQPreview();
}

/* ── Add a new blank option to a question ── */
function cqAddOption(qIdx) {
  const ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];
  if (!cqGeneratedQuestions || !cqGeneratedQuestions[qIdx]) return;
  const q = cqGeneratedQuestions[qIdx];
  const usedKeys = Object.keys(q.options);
  const nextKey = ALL_KEYS.find(k => !usedKeys.includes(k));
  if (!nextKey) return;
  q.options[nextKey] = '';
  if (!q.optionsOrder) q.optionsOrder = usedKeys.map(k => ({ key: k, value: q.options[k] }));
  q.optionsOrder.push({ key: nextKey, value: '' });
  _markQuestionEditDirty();
  renderCQPreview();
  // Focus the new input
  setTimeout(() => {
    const input = document.querySelector(`#cqOptRow_${qIdx}_${nextKey} .cq-opt-text-input`);
    if (input) input.focus();
  }, 60);
}

function discardGeneratedQuiz() {
  cqGeneratedQuestions = null;
  cqSelectedFiles = [];
  cqLectureFiles = [];
  _questionEditDirty = false;
  renderCustomQuizModal();
}

async function saveGeneratedCustomQuiz() {
  if (!cqGeneratedQuestions || !cqGeneratedQuestions.length) return;
  const titleInput = document.getElementById('cqTitleInput');
  const title = (titleInput && titleInput.value.trim()) || cqGeneratedTitle || 'Custom Quiz';

  // Same validation the quiz editor enforces on save — applied HERE too so a
  // question that only made it out of extraction with one option (e.g. the
  // source only had one choice visible, or a choice got missed) is caught
  // immediately, while it's still fresh in the review screen, rather than
  // saving silently and only surfacing as a forced fix-up the next time this
  // quiz happens to be opened for editing.
  for (let i = 0; i < cqGeneratedQuestions.length; i++) {
    const q = cqGeneratedQuestions[i];
    if (!q.question || !q.question.trim()) {
      alert(`Q${i + 1} needs question text before saving.`);
      return;
    }
    const filledOpts = getOptionEntries(q).filter(([, v]) => v && v.trim());
    if (filledOpts.length < 2) {
      alert(`Q${i + 1} only has ${filledOpts.length} option${filledOpts.length === 1 ? '' : 's'} — add at least 2 before saving. Scroll to it below to fix.`);
      return;
    }
    if (!q.answer || !q.options[q.answer] || !q.options[q.answer].trim()) {
      alert(`Q${i + 1} needs a correct answer selected before saving.`);
      return;
    }
  }

  _cqNormalizeCaseGroups(cqGeneratedQuestions);
  _stripEditorTransientFields(cqGeneratedQuestions);

  const quizzes = loadCustomQuizzes();
  quizzes.unshift({
    id: 'cq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    title,
    questions: cqGeneratedQuestions,
    createdAt: Date.now()
  });
  await saveCustomQuizzesList(quizzes);

  cqGeneratedQuestions = null;
  cqSelectedFiles = [];
  cqLectureFiles = [];
  cqGeneratedTitle = '';
  _questionEditDirty = false;

  renderCustomQuizModal();
  const statusEl = document.getElementById('cqStatus');
  if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ Quiz "${escapeHtml(title)}" saved! Start it from the list above.</div>`;
}

