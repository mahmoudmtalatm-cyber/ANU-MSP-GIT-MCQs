/* ══════════════════════════════════════════════════════════
   GENERIC INLINE QUIZ EDITOR
   Operates on `adminEditQuestions`. Used both for
   "edit before publishing" and "edit an already-published lecture".
══════════════════════════════════════════════════════════ */
function renderAdminQuestionEditor(containerId) {
  const area = document.getElementById(containerId);
  if (!area || !adminEditQuestions) { if (area) area.innerHTML = ''; return; }

  // Remember scroll position of the inner question list — it gets torn down
  // and rebuilt below, which would otherwise reset it to the top (Q1) on
  // every single edit (image change, option edit, delete, etc.)
  const _prevList = document.getElementById('adminEditList');
  const _prevScrollTop = _prevList ? _prevList.scrollTop : null;

  const ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:8px 0 10px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;">
      <svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editing — ${adminEditQuestions.length} question${adminEditQuestions.length !== 1 ? 's' : ''}
    </div>
    <div style="font-size:.74rem;color:var(--text-muted);font-weight:600;">
      <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" style="fill:currentColor;stroke:none;"/></svg> = correct answer &nbsp;·&nbsp; <svg class="sicon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> = linked case questions
    </div>
  </div>`;
  html += _renderBulkAiToolsPanel('admin', adminEditQuestions);
  html += `<div id="adminBulkLockWrap"${_editorBulkBusy.admin ? ' class="cq-bulk-lock"' : ''}>`;
  html += `<div class="cq-preview-list" id="adminEditList">`;

  adminEditQuestions.forEach((q, i) => {
    const optEntries = getOptionEntries(q);
    const usedKeys = optEntries.map(([k]) => k);
    const nextKey = ALL_KEYS.find(k => !usedKeys.includes(k));

    html += `<div class="cq-preview-q cq-editable-q" id="adminEditQ_${i}">`;

    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">
      <span style="background:var(--accent);color:#fff;font-size:.72rem;font-weight:800;
        border-radius:20px;padding:2px 9px;white-space:nowrap;flex-shrink:0;">Q${i + 1}</span>
      ${_renderMergeSourceBadge(q)}
      ${_renderContentFilterReviewBadge(q)}
      <span style="flex:1;font-size:.75rem;font-weight:700;color:var(--text-muted);">Question Text</span>
      ${_renderReorderButtons('admin', i, adminEditQuestions.length)}
      <button class="cq-edit-reask-btn" title="Delete this question"
        onclick="adminEditDeleteQuestion(${i})"
        style="background:var(--wrong-bg);color:var(--wrong-fg);border-color:var(--red-soft-border);"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>
    </div>`;

    html += `<textarea class="cq-edit-textarea" rows="2"
      oninput="adminEditQuestionText(${i}, this.value)"
      style="width:100%;resize:vertical;margin-bottom:8px;">${escapeHtml(q.question)}</textarea>`;

    /* ── AI Question Tools: Refine Question + custom instructions ── */
    html += _renderAiRefineTools('admin', i);

    /* Image area */
    html += `<div class="cq-img-edit-row" style="margin-bottom:8px;">`;
    if (q.image) {
      html += `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;
        background:var(--surface-2);border:1.5px solid var(--border-soft);border-radius:8px;padding:8px 10px;">
        <div style="flex-shrink:0;border-radius:5px;overflow:hidden;border:1px solid var(--border-soft-2);background:#fff;">
          <img src="${q.image}" alt="Question image"
            style="max-width:200px;max-height:130px;object-fit:contain;display:block;" />
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;justify-content:center;">
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Question Image</div>
          <label class="cq-img-action-btn" title="Upload a different image">
            <svg class="sicon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Change Image
            <input type="file" accept="image/*" style="display:none;" onchange="adminEditReplaceImage(${i}, event)" />
          </label>
          <button class="cq-img-action-btn cq-img-remove-btn" onclick="adminEditRemoveImage(${i})" type="button"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Remove Image</button>
        </div>
      </div>`;
    } else {
      html += `<label class="cq-img-upload-label" title="Attach an image to this question">
        <svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Add Image (optional)
        <input type="file" accept="image/*" style="display:none;" onchange="adminEditReplaceImage(${i}, event)" />
      </label>`;
    }
    html += `</div>`;

    /* ── Manual case-group link ── */
    html += _renderCaseGroupBlock('admin', adminEditQuestions, i);

    html += `<div style="font-size:.72rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;">
      Answer Choices &nbsp;<span style="font-weight:500;text-transform:none;letter-spacing:0;">— select the correct answer with <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" style="fill:currentColor;stroke:none;"/></svg></span>
    </div>`;

    html += `<div style="display:flex;flex-direction:column;gap:5px;" id="adminEditOpts_${i}">`;
    optEntries.forEach(([k, v]) => {
      const isCorrect = k === q.answer;
      html += `<div class="cq-opt-edit-row${isCorrect ? ' cq-opt-correct' : ''}" id="adminEditOptRow_${i}_${k}">
        <label class="cq-opt-correct-radio" title="Set as correct answer">
          <input type="radio" name="adminEditAnswer_${i}" value="${k}" ${isCorrect ? 'checked' : ''}
            onchange="adminEditSetAnswer(${i}, '${k}')" />
          <span class="cq-radio-dot"></span>
        </label>
        <span class="cq-opt-key">${k}.</span>
        <input type="text" class="cq-opt-text-input" value="${escapeHtml(v)}"
          oninput="adminEditOptionText(${i}, '${k}', this.value)"
          placeholder="Option ${k} text…" />
        ${isCorrect ? '<span class="cq-correct-badge">✔ Correct</span>' : ''}
        <button onclick="adminEditDeleteOption(${i}, '${k}')" type="button" title="Remove this option"
          style="background:none;border:none;cursor:pointer;color:var(--red-soft-border);font-size:.9rem;
          padding:2px 4px;border-radius:4px;flex-shrink:0;line-height:1;transition:color .15s;"
          onmouseover="this.style.color='var(--wrong-fg)'" onmouseout="this.style.color='var(--red-soft-border)'">✕</button>
      </div>`;
    });
    html += `</div>`;

    if (nextKey) {
      html += `<button onclick="adminEditAddOption(${i})" type="button"
        style="margin-top:5px;background:var(--surface-2);color:var(--accent);border:1.5px dashed var(--border-soft);
        border-radius:7px;padding:5px 12px;font-family:var(--font);font-size:.78rem;font-weight:700;
        cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;"
        onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--surface-2-hover)';"
        onmouseout="this.style.borderColor='var(--border-soft)';this.style.background='var(--surface-2)';">
        ＋ Add Option ${nextKey}
      </button>`;
    }

    /* ── AI Question Tools: Add Choice (AI) / Fill Choices (AI) ── */
    html += _renderAiChoiceTools('admin', i, optEntries.length, nextKey);

    html += `</div>`; // end .cq-editable-q
  });

  html += `</div>`;

  html += `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <button class="cq-btn cq-btn-secondary" onclick="adminEditAddBlankQuestion()" style="background:var(--green-mid);">＋ Add Question</button>
    <button class="cq-btn cq-btn-secondary" onclick="openMergePicker('admin')" style="background:var(--violet);color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> Merge Quizzes In</button>
    ${adminEditMode === 'published' ? `
      <button class="cq-btn cq-btn-secondary" onclick="openAdminSplitPanel('${adminEditingPublishedId}')"
        style="background:var(--violet);color:#fff;" title="Split into multiple quizzes"><svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Split into Multiple</button>
      <button class="cq-btn" onclick="adminSavePublishedEdits()" title="Implement these edits on the curriculum lecture"><svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Changes</button>
      <button class="cq-btn cq-btn-secondary" onclick="adminSaveEditsAsCustomQuiz()"
        style="background:var(--violet);color:#fff;" title="Save these edits as a new custom quiz — the curriculum lecture stays untouched"><svg class="sicon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Save as Custom Quiz</button>
      <button class="cq-btn cq-btn-secondary" onclick="adminCancelEditPublished()">✖ Cancel</button>
    ` : `
      <div style="font-size:.78rem;color:var(--text-muted);font-weight:600;">Edits will be used when you publish below.</div>
    `}
  </div>
  ${adminEditMode === 'published' ? renderSplitPanel('adminPublished', adminEditingPublishedId, adminEditQuestions.length) : ''}
  </div>
  <div class="admin-status" id="adminEditStatus"></div>`;

  area.innerHTML = html;
  _editorBulkSourceSetupDropzone('admin');

  // Restore scroll position (unless this is the very first render)
  if (_prevScrollTop !== null) {
    const _newList = document.getElementById('adminEditList');
    if (_newList) _newList.scrollTop = _prevScrollTop;
  }
}

/* Resolves the DOM container id currently hosting the inline question
   editor — differs depending on whether we're editing a quiz before
   publishing it, or editing one that's already published (per-lecture id). */
function _adminEditorContainerId() {
  return adminEditMode === 'published'
    ? ('adminPublishedEditorArea_' + adminEditingPublishedId)
    : 'adminEditorArea';
}

/* ── Edit helpers (mutate adminEditQuestions in place) ── */
function adminEditQuestionText(idx, val) {
  if (!adminEditQuestions || !adminEditQuestions[idx]) return;
  adminEditQuestions[idx].question = val;
  _markQuestionEditDirty();
}

function adminEditOptionText(idx, key, val) {
  if (!adminEditQuestions || !adminEditQuestions[idx]) return;
  adminEditQuestions[idx].options[key] = val;
  const order = adminEditQuestions[idx].optionsOrder;
  if (order) {
    const entry = order.find(o => o.key === key);
    if (entry) entry.value = val;
  }
  _markQuestionEditDirty();
}

function adminEditSetAnswer(idx, key) {
  if (!adminEditQuestions || !adminEditQuestions[idx]) return;
  const q = adminEditQuestions[idx];
  q.answer = key;
  _markQuestionEditDirty();
  getOptionEntries(q).forEach(([k]) => {
    const row = document.getElementById(`adminEditOptRow_${idx}_${k}`);
    if (!row) return;
    const isNowCorrect = k === key;
    row.classList.toggle('cq-opt-correct', isNowCorrect);
    let badge = row.querySelector('.cq-correct-badge');
    if (isNowCorrect && !badge) {
      badge = document.createElement('span');
      badge.className = 'cq-correct-badge';
      badge.textContent = '✔ Correct';
      row.insertBefore(badge, row.querySelector('button'));
    } else if (!isNowCorrect && badge) {
      badge.remove();
    }
  });
}

function adminEditDeleteQuestion(idx) {
  if (!adminEditQuestions) return;
  if (!confirm(`Remove Q${idx + 1} from the quiz?`)) return;
  const [deleted] = adminEditQuestions.splice(idx, 1);
  _caseGroupOnQuestionDeleted(adminEditQuestions, deleted);
  _markQuestionEditDirty();
  renderAdminQuestionEditor(_adminEditorContainerId());
}

function adminEditAddBlankQuestion() {
  if (!adminEditQuestions) adminEditQuestions = [];
  adminEditQuestions.push({
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    optionsOrder: [
      { key: 'A', value: '' }, { key: 'B', value: '' },
      { key: 'C', value: '' }, { key: 'D', value: '' }
    ],
    answer: 'A'
  });
  _markQuestionEditDirty();
  renderAdminQuestionEditor(_adminEditorContainerId());
  setTimeout(() => {
    const last = document.getElementById(`adminEditQ_${adminEditQuestions.length - 1}`);
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}

function adminEditDeleteOption(qIdx, key) {
  if (!adminEditQuestions || !adminEditQuestions[qIdx]) return;
  const q = adminEditQuestions[qIdx];
  if (Object.keys(q.options).length <= 2) {
    alert('A question must have at least 2 options.');
    return;
  }
  delete q.options[key];
  if (q.optionsOrder) q.optionsOrder = q.optionsOrder.filter(o => o.key !== key);
  if (q.answer === key) q.answer = Object.keys(q.options)[0] || '';
  relabelOptionsSequentially(q);
  _markQuestionEditDirty();
  renderAdminQuestionEditor(_adminEditorContainerId());
}

function adminEditAddOption(qIdx) {
  const ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];
  if (!adminEditQuestions || !adminEditQuestions[qIdx]) return;
  const q = adminEditQuestions[qIdx];
  const usedKeys = Object.keys(q.options);
  const nextKey = ALL_KEYS.find(k => !usedKeys.includes(k));
  if (!nextKey) return;
  q.options[nextKey] = '';
  if (!q.optionsOrder) q.optionsOrder = usedKeys.map(k => ({ key: k, value: q.options[k] }));
  q.optionsOrder.push({ key: nextKey, value: '' });
  _markQuestionEditDirty();
  renderAdminQuestionEditor(_adminEditorContainerId());
  setTimeout(() => {
    const input = document.querySelector(`#adminEditOptRow_${qIdx}_${nextKey} .cq-opt-text-input`);
    if (input) input.focus();
  }, 60);
}

function adminEditRemoveImage(idx) {
  if (!adminEditQuestions || !adminEditQuestions[idx]) return;
  delete adminEditQuestions[idx].image;
  _markQuestionEditDirty();
  renderAdminQuestionEditor(_adminEditorContainerId());
}

function adminEditReplaceImage(idx, event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !adminEditQuestions || !adminEditQuestions[idx]) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    try {
      adminEditQuestions[idx].image = await compressImageDataUrl(dataUrl);
    } catch (e) {
      adminEditQuestions[idx].image = dataUrl;
    }
    _markQuestionEditDirty();
    renderAdminQuestionEditor(_adminEditorContainerId());
  };
  reader.readAsDataURL(file);
}

/* ══════════════════════════════════════════════════════════
   INLINE EDITOR FOR SAVED CUSTOM QUIZZES
   Same editing experience as the admin question editor above —
   case links, images, options, add/delete questions — scoped to one
   of the user's own saved quizzes instead of admin-published content.
   Operates on `cqEditQuestions`, a working copy of the quiz being
   edited; nothing is written back until "Save Changes" is clicked.
══════════════════════════════════════════════════════════ */
function openCustomQuizEditor(id) {
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz) return;
  cqCreatingNew = false;
  cqEditingQuizId = id;
  cqEditQuestions = JSON.parse(JSON.stringify(quiz.questions || []));
  _questionEditDirty = false;
  renderCustomQuizModal();
  const area = document.getElementById('cqCustomEditorArea_' + id);
  if (area) area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* Same editor as openCustomQuizEditor above, but mounted inside the admin
   panel's "My Custom Quizzes" list instead of the Custom Quizzes modal —
   lets an admin edit a quiz's questions right where they're picking it for
   assignment, without leaving the admin panel. */
function openAdminCustomQuizEditor(id) {
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz) return;
  cqEditorContext = 'admin';
  cqCreatingNew = false;
  cqEditingQuizId = id;
  cqEditQuestions = JSON.parse(JSON.stringify(quiz.questions || []));
  _questionEditDirty = false;
  renderAdminPanel();
  const area = document.getElementById('adminCqEditorArea_' + id);
  if (area) area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeCustomQuizEditor() {
  _guardedClose(() => {
    const wasAdmin = cqEditorContext === 'admin';
    cqCreatingNew = false;
    cqEditingQuizId = null;
    cqEditQuestions = null;
    cqNewQuizTitle = '';
    cqEditorContext = 'quiz';
    if (wasAdmin) { renderAdminPanel(); } else { renderCustomQuizModal(); }
  });
}

/* Opens the same editor used for existing quizzes, but starting from one
   blank question and no saved quiz behind it yet — "Save Changes" creates
   a brand-new custom quiz instead of updating one. */
function openNewQuizComposer() {
  cqEditingQuizId = null;
  cqCreatingNew = true;
  cqNewQuizTitle = '';
  cqEditQuestions = [{
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    optionsOrder: [
      { key: 'A', value: '' }, { key: 'B', value: '' },
      { key: 'C', value: '' }, { key: 'D', value: '' }
    ],
    answer: 'A'
  }];
  _questionEditDirty = false;
  renderCustomQuizModal();
  const area = document.getElementById('cqNewQuizEditorArea');
  if (area) area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* Resolves the DOM ids the editor should read/write — differs depending on
   whether we're editing an existing saved quiz (namespaced by its id) or
   composing a brand-new one (a single fixed area, since it has no id yet). */
function _cqEditorKey() { return cqCreatingNew ? 'new' : cqEditingQuizId; }
function _cqEditorContainerId() {
  if (cqCreatingNew) return 'cqNewQuizEditorArea';
  return cqEditorContext === 'admin'
    ? ('adminCqEditorArea_' + cqEditingQuizId)
    : ('cqCustomEditorArea_' + cqEditingQuizId);
}

function renderCustomQuizEditor() {
  const key = _cqEditorKey();
  const containerId = _cqEditorContainerId();
  const area = document.getElementById(containerId);
  if (!area || !cqEditQuestions) { if (area) area.innerHTML = ''; return; }

  // Preserve scroll position across re-renders (image change, option edit, etc.)
  const _prevList = document.getElementById('cqCustomEditList_' + key);
  const _prevScrollTop = _prevList ? _prevList.scrollTop : null;

  const ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:8px 0 10px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;">
      <svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> ${cqCreatingNew ? 'Writing a new quiz' : 'Editing'} — ${cqEditQuestions.length} question${cqEditQuestions.length !== 1 ? 's' : ''}
    </div>
    <div style="font-size:.74rem;color:var(--text-muted);font-weight:600;">
      <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" style="fill:currentColor;stroke:none;"/></svg> = correct answer &nbsp;·&nbsp; <svg class="sicon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> = linked case questions
    </div>
  </div>`;
  html += _renderBulkAiToolsPanel('customQuiz', cqEditQuestions);
  html += `<div id="customQuizBulkLockWrap"${_editorBulkBusy.customQuiz ? ' class="cq-bulk-lock"' : ''}>`;
  html += `<div class="cq-preview-list" id="cqCustomEditList_${key}">`;

  cqEditQuestions.forEach((q, i) => {
    const optEntries = getOptionEntries(q);
    const usedKeys = optEntries.map(([k]) => k);
    const nextKey = ALL_KEYS.find(k => !usedKeys.includes(k));

    html += `<div class="cq-preview-q cq-editable-q" id="cqCustomEditQ_${i}">`;

    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">
      <span style="background:var(--accent);color:#fff;font-size:.72rem;font-weight:800;
        border-radius:20px;padding:2px 9px;white-space:nowrap;flex-shrink:0;">Q${i + 1}</span>
      ${_renderMergeSourceBadge(q)}
      ${_renderContentFilterReviewBadge(q)}
      <span style="flex:1;font-size:.75rem;font-weight:700;color:var(--text-muted);">Question Text</span>
      ${_renderReorderButtons('customQuiz', i, cqEditQuestions.length)}
      <button class="cq-edit-reask-btn" title="Delete this question"
        onclick="cqEditDeleteQuestion(${i})"
        style="background:var(--wrong-bg);color:var(--wrong-fg);border-color:var(--red-soft-border);"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>
    </div>`;

    html += `<textarea class="cq-edit-textarea" rows="2"
      oninput="cqEditQuestionText(${i}, this.value)"
      style="width:100%;resize:vertical;margin-bottom:8px;">${escapeHtml(q.question)}</textarea>`;

    /* ── AI Question Tools: Refine Question + custom instructions ── */
    html += _renderAiRefineTools('customQuiz', i);

    /* Image area */
    html += `<div class="cq-img-edit-row" style="margin-bottom:8px;">`;
    if (q.image) {
      html += `<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;
        background:var(--surface-2);border:1.5px solid var(--border-soft);border-radius:8px;padding:8px 10px;">
        <div style="flex-shrink:0;border-radius:5px;overflow:hidden;border:1px solid var(--border-soft-2);background:#fff;">
          <img src="${q.image}" alt="Question image"
            style="max-width:200px;max-height:130px;object-fit:contain;display:block;" />
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;justify-content:center;">
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;"><svg class="sicon" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Question Image</div>
          <label class="cq-img-action-btn" title="Upload a different image">
            <svg class="sicon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Change Image
            <input type="file" accept="image/*" style="display:none;" onchange="cqEditReplaceImage(${i}, event)" />
          </label>
          <button class="cq-img-action-btn cq-img-remove-btn" onclick="cqEditRemoveImage(${i})" type="button"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Remove Image</button>
        </div>
      </div>`;
    } else {
      html += `<label class="cq-img-upload-label" title="Attach an image to this question">
        <svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Add Image (optional)
        <input type="file" accept="image/*" style="display:none;" onchange="cqEditReplaceImage(${i}, event)" />
      </label>`;
    }
    html += `</div>`;

    /* ── Manual case-group link ── */
    html += _renderCaseGroupBlock('customQuiz', cqEditQuestions, i);

    html += `<div style="font-size:.72rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;">
      Answer Choices &nbsp;<span style="font-weight:500;text-transform:none;letter-spacing:0;">— select the correct answer with <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" style="fill:currentColor;stroke:none;"/></svg></span>
    </div>`;

    html += `<div style="display:flex;flex-direction:column;gap:5px;" id="cqCustomEditOpts_${i}">`;
    optEntries.forEach(([k, v]) => {
      const isCorrect = k === q.answer;
      html += `<div class="cq-opt-edit-row${isCorrect ? ' cq-opt-correct' : ''}" id="cqCustomEditOptRow_${i}_${k}">
        <label class="cq-opt-correct-radio" title="Set as correct answer">
          <input type="radio" name="cqCustomEditAnswer_${i}" value="${k}" ${isCorrect ? 'checked' : ''}
            onchange="cqEditSetAnswer(${i}, '${k}')" />
          <span class="cq-radio-dot"></span>
        </label>
        <span class="cq-opt-key">${k}.</span>
        <input type="text" class="cq-opt-text-input" value="${escapeHtml(v)}"
          oninput="cqEditOptionText(${i}, '${k}', this.value)"
          placeholder="Option ${k} text…" />
        ${isCorrect ? '<span class="cq-correct-badge">✔ Correct</span>' : ''}
        <button onclick="cqEditDeleteOption(${i}, '${k}')" type="button" title="Remove this option"
          style="background:none;border:none;cursor:pointer;color:var(--red-soft-border);font-size:.9rem;
          padding:2px 4px;border-radius:4px;flex-shrink:0;line-height:1;transition:color .15s;"
          onmouseover="this.style.color='var(--wrong-fg)'" onmouseout="this.style.color='var(--red-soft-border)'">✕</button>
      </div>`;
    });
    html += `</div>`;

    if (nextKey) {
      html += `<button onclick="cqEditAddOption(${i})" type="button"
        style="margin-top:5px;background:var(--surface-2);color:var(--accent);border:1.5px dashed var(--border-soft);
        border-radius:7px;padding:5px 12px;font-family:var(--font);font-size:.78rem;font-weight:700;
        cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;"
        onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--surface-2-hover)';"
        onmouseout="this.style.borderColor='var(--border-soft)';this.style.background='var(--surface-2)';">
        ＋ Add Option ${nextKey}
      </button>`;
    }

    /* ── AI Question Tools: Add Choice (AI) / Fill Choices (AI) ── */
    html += _renderAiChoiceTools('customQuiz', i, optEntries.length, nextKey);

    html += `</div>`; // end .cq-editable-q
  });

  html += `</div>`;

  html += `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <button class="cq-btn cq-btn-secondary" onclick="cqEditAddBlankQuestion()" style="background:var(--green-mid);">＋ Add Question</button>
    <button class="cq-btn cq-btn-secondary" onclick="openMergePicker('customQuiz')" style="background:var(--violet);color:#fff;"><svg class="sicon" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> Merge Quizzes In</button>
    ${!cqCreatingNew ? `
      <button class="cq-btn cq-btn-secondary" onclick="openSplitPanel('saved', '${cqEditingQuizId}')"
        style="background:var(--violet);color:#fff;" title="Split into multiple quizzes"><svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Split into Multiple</button>
    ` : ''}
    <button class="cq-btn" onclick="saveCustomQuizEdits()"><svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Changes</button>
    <button class="cq-btn cq-btn-secondary" onclick="closeCustomQuizEditor()">✖ Cancel</button>
  </div>
  ${!cqCreatingNew ? renderSplitPanel('saved', cqEditingQuizId, cqEditQuestions.length) : ''}
  </div>
  <div class="admin-status" id="cqCustomEditStatus_${key}"></div>`;

  area.innerHTML = html;
  _editorBulkSourceSetupDropzone('customQuiz');

  if (_prevScrollTop !== null) {
    const _newList = document.getElementById('cqCustomEditList_' + key);
    if (_newList) _newList.scrollTop = _prevScrollTop;
  }
}

/* ── Edit helpers (mutate cqEditQuestions in place) ── */
function cqEditQuestionText(idx, val) {
  if (!cqEditQuestions || !cqEditQuestions[idx]) return;
  cqEditQuestions[idx].question = val;
  _markQuestionEditDirty();
}

function cqEditOptionText(idx, key, val) {
  if (!cqEditQuestions || !cqEditQuestions[idx]) return;
  cqEditQuestions[idx].options[key] = val;
  const order = cqEditQuestions[idx].optionsOrder;
  if (order) {
    const entry = order.find(o => o.key === key);
    if (entry) entry.value = val;
  }
  _markQuestionEditDirty();
}

function cqEditSetAnswer(idx, key) {
  if (!cqEditQuestions || !cqEditQuestions[idx]) return;
  const q = cqEditQuestions[idx];
  q.answer = key;
  _markQuestionEditDirty();
  getOptionEntries(q).forEach(([k]) => {
    const row = document.getElementById(`cqCustomEditOptRow_${idx}_${k}`);
    if (!row) return;
    const isNowCorrect = k === key;
    row.classList.toggle('cq-opt-correct', isNowCorrect);
    let badge = row.querySelector('.cq-correct-badge');
    if (isNowCorrect && !badge) {
      badge = document.createElement('span');
      badge.className = 'cq-correct-badge';
      badge.textContent = '✔ Correct';
      row.insertBefore(badge, row.querySelector('button'));
    } else if (!isNowCorrect && badge) {
      badge.remove();
    }
  });
}

function cqEditDeleteQuestion(idx) {
  if (!cqEditQuestions) return;
  if (!confirm(`Remove Q${idx + 1} from the quiz?`)) return;
  const [deleted] = cqEditQuestions.splice(idx, 1);
  _caseGroupOnQuestionDeleted(cqEditQuestions, deleted);
  _markQuestionEditDirty();
  renderCustomQuizEditor();
}

function cqEditAddBlankQuestion() {
  if (!cqEditQuestions) cqEditQuestions = [];
  cqEditQuestions.push({
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    optionsOrder: [
      { key: 'A', value: '' }, { key: 'B', value: '' },
      { key: 'C', value: '' }, { key: 'D', value: '' }
    ],
    answer: 'A'
  });
  _markQuestionEditDirty();
  renderCustomQuizEditor();
  setTimeout(() => {
    const last = document.getElementById(`cqCustomEditQ_${cqEditQuestions.length - 1}`);
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}

function cqEditDeleteOption(qIdx, key) {
  if (!cqEditQuestions || !cqEditQuestions[qIdx]) return;
  const q = cqEditQuestions[qIdx];
  if (Object.keys(q.options).length <= 2) {
    alert('A question must have at least 2 options.');
    return;
  }
  delete q.options[key];
  if (q.optionsOrder) q.optionsOrder = q.optionsOrder.filter(o => o.key !== key);
  if (q.answer === key) q.answer = Object.keys(q.options)[0] || '';
  relabelOptionsSequentially(q);
  _markQuestionEditDirty();
  renderCustomQuizEditor();
}

function cqEditAddOption(qIdx) {
  const ALL_KEYS = ['A','B','C','D','E','F','G','H','I','J'];
  if (!cqEditQuestions || !cqEditQuestions[qIdx]) return;
  const q = cqEditQuestions[qIdx];
  const usedKeys = Object.keys(q.options);
  const nextKey = ALL_KEYS.find(k => !usedKeys.includes(k));
  if (!nextKey) return;
  q.options[nextKey] = '';
  if (!q.optionsOrder) q.optionsOrder = usedKeys.map(k => ({ key: k, value: q.options[k] }));
  q.optionsOrder.push({ key: nextKey, value: '' });
  _markQuestionEditDirty();
  renderCustomQuizEditor();
  setTimeout(() => {
    const input = document.querySelector(`#cqCustomEditOptRow_${qIdx}_${nextKey} .cq-opt-text-input`);
    if (input) input.focus();
  }, 60);
}

function cqEditRemoveImage(idx) {
  if (!cqEditQuestions || !cqEditQuestions[idx]) return;
  delete cqEditQuestions[idx].image;
  delete cqEditQuestions[idx].imageUrl;
  _markQuestionEditDirty();
  renderCustomQuizEditor();
}

function cqEditReplaceImage(idx, event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !cqEditQuestions || !cqEditQuestions[idx]) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    try {
      cqEditQuestions[idx].image = await compressImageDataUrl(dataUrl);
    } catch (e) {
      cqEditQuestions[idx].image = dataUrl;
    }
    delete cqEditQuestions[idx].imageUrl; // stale pointer — a fresh image is (re)uploaded on save
    _markQuestionEditDirty();
    renderCustomQuizEditor();
  };
  reader.readAsDataURL(file);
}

/* Validates the working copy, then writes it back into the saved quiz
   list via the normal save path (handles Firestore image upload / local
   storage the same way every other custom-quiz save already does). If
   `cqCreatingNew` is set, this creates a fresh quiz instead of updating one. */
async function saveCustomQuizEdits() {
  if (!cqEditQuestions) return;
  if (!cqCreatingNew && !cqEditingQuizId) return;

  if (cqCreatingNew && !cqNewQuizTitle.trim()) {
    alert('Give your quiz a title first.');
    return;
  }
  if (!cqEditQuestions.length) {
    alert('Add at least one question first.');
    return;
  }

  for (let i = 0; i < cqEditQuestions.length; i++) {
    const q = cqEditQuestions[i];
    if (!q.question || !q.question.trim()) { alert(`Q${i + 1} needs question text.`); return; }
    const filledOpts = getOptionEntries(q).filter(([, v]) => v && v.trim());
    if (filledOpts.length < 2) { alert(`Q${i + 1} needs at least 2 filled-in options.`); return; }
    if (!q.answer || !q.options[q.answer] || !q.options[q.answer].trim()) {
      alert(`Q${i + 1} needs a correct answer selected.`);
      return;
    }
  }

  _cqNormalizeCaseGroups(cqEditQuestions);
  _stripEditorTransientFields(cqEditQuestions);

  const statusEl = document.getElementById('cqCustomEditStatus_' + _cqEditorKey());
  if (statusEl) statusEl.innerHTML = `<div class="cq-status info"><svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Saving…</div>`;

  const quizzes = loadCustomQuizzes();

  if (cqCreatingNew) {
    quizzes.push({
      id: 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      title: cqNewQuizTitle.trim(),
      questions: JSON.parse(JSON.stringify(cqEditQuestions)),
      createdAt: Date.now(),
      collectionId: _cqTargetCollectionId(null)
    });
  } else {
    const quiz = quizzes.find(q => q.id === cqEditingQuizId);
    if (!quiz) return;
    quiz.questions = JSON.parse(JSON.stringify(cqEditQuestions));
  }

  try {
    await saveCustomQuizzesList(quizzes);
    const wasAdmin = cqEditorContext === 'admin';
    cqCreatingNew = false;
    cqEditingQuizId = null;
    cqEditQuestions = null;
    cqNewQuizTitle = '';
    cqEditorContext = 'quiz';
    _questionEditDirty = false;
    if (wasAdmin) { renderAdminPanel(); } else { renderCustomQuizModal(); }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status warning"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Save failed: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

/* Swap a published lecture's position with its immediate neighbor (up/down)
   within its subject. Updates both lectures' 'order' field in Firestore,
   bumps both entries' manifest timestamp so every user's cache picks up
   the new order on their next load, and refreshes the current view. */
async function adminSwapLectureOrder(lectureId, direction) {
  const subj = _pubListSubject();
  if (!subj) return;
  try {
    const { fetchCurriculumManifest, putContentItem } = await import('./content-client.js');
    const manifest = await fetchCurriculumManifest();
    const lectureIds = Object.keys(manifest[subj] || {});
    const entries = [];
    for (const lecId of lectureIds) {
      const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${subj}/${lecId}.json`);
      if (resp.ok) entries.push({ id: lecId, ...(await resp.json()) });
    }
    entries.sort((a, b) => (a.order ?? a.publishedAt ?? 0) - (b.order ?? b.publishedAt ?? 0));

    const idx = entries.findIndex(e => e.id === lectureId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= entries.length) return; // already at an edge

    const a = entries[idx];
    const b = entries[swapIdx];
    const aOrder = a.order ?? a.publishedAt ?? 0;
    const bOrder = b.order ?? b.publishedAt ?? 0;

    // Each write here is a normal authorized content write — updates that
    // one lecture's `order` field and (server-side, in the Worker) bumps
    // just its own manifest entry, same as any other edit. Opportunistic
    // migration: inline any legacy remote image while we're touching it anyway.
    await ensureInlineImages(a.questions);
    await ensureInlineImages(b.questions);
    await putContentItem('curriculum', subj, a.id, { ...a, order: bOrder });
    await putContentItem('curriculum', subj, b.id, { ...b, order: aOrder });

    // Refresh in-memory ordering + whatever the admin currently has open
    // (skip throttle: this write just changed the manifest and must show immediately)
    await loadPublishedQuestionsIntoSubjects(true);
    if (selectedSubject === subj) selectSubject(subj);
    renderAdminAssignedList();
  } catch (e) {
    alert('Failed to reorder: ' + (e.message || e));
  }
}

async function renderAdminAssignedList() {
  const sec = document.getElementById('adminAssignedSection');
  if (!sec) return;
  const subj = _pubListSubject();
  if (!subj) { sec.innerHTML = ''; return; }
  sec.innerHTML = `<div class="admin-assigned-title">Published lectures in "${escapeHtml(subjects[subj].label || subj)}" <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-muted);">— use <svg class="sicon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg><svg class="sicon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg> to set the order students see</span></div>`;

  let entries = [];
  try {
    const { fetchCurriculumManifest } = await import('./content-client.js');
    const manifest = await fetchCurriculumManifest();
    const lectureIds = Object.keys(manifest[subj] || {});
    await Promise.all(lectureIds.map(async (lecId) => {
      const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${subj}/${lecId}.json`);
      if (resp.ok) entries.push({ id: lecId, ...(await resp.json()) });
    }));
  } catch (e) {
    sec.innerHTML += `<div style="color:var(--text-muted);font-size:.82rem;">Could not load published lectures.</div>`;
    return;
  }

  entries.sort((a, b) => (a.order ?? a.publishedAt ?? 0) - (b.order ?? b.publishedAt ?? 0));
  adminAssignedEntries = entries;

  // A previously-chosen before/after insertion target might no longer
  // exist in this subject's freshly-loaded list — drop it if so.
  if (adminPublishInsertPosition && !entries.some(e => e.id === adminPublishInsertPosition.lectureId)) {
    adminPublishInsertPosition = null;
  }

  _renderAdminAssignedListHTML();
}

/* Rebuilds the #adminAssignedSection HTML from the already-fetched
   adminAssignedEntries cache — no Firestore round-trip. Used to
   re-render the Split Quiz panel (mode switches, range/label edits,
   visual cut toggles) without re-querying the database each time. */
function _renderAdminAssignedListHTML() {
  const sec = document.getElementById('adminAssignedSection');
  if (!sec) return;
  const entries = adminAssignedEntries;
  const subj = _pubListSubject();
  if (!subj) { sec.innerHTML = ''; return; }

  // The "Publish Quizzes" tab only needs a quick read-only glance at what's
  // already there (so the admin doesn't duplicate a lecture by accident) —
  // reordering, editing, copy/move, and delete all live one place now:
  // the " Manage Curriculum" tab. Showing them here too was redundant
  // and easy to trigger by mistake mid-publish. It does let the admin pick
  // where the new quiz will land relative to these, via before/after markers.
  const simple = adminActiveTab !== 'curriculum';

  sec.innerHTML = simple
    ? `<div class="admin-assigned-title">Publish Here — "${escapeHtml(subjects[subj].label || subj)}" <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-muted);">— tap <svg class="sicon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Publish Here to choose where the new quiz lands in the list below</span></div>`
    : `<div class="admin-assigned-title">Published lectures in "${escapeHtml(subjects[subj].label || subj)}" <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-muted);">— use <svg class="sicon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg><svg class="sicon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg> to set the order students see</span></div>`;

  if (!entries.length) {
    if (simple) {
      // Nothing published yet — there's only one possible spot, so no gap
      // markers are needed; publishing always lands at the end (empty list).
      sec.innerHTML += `<div style="color:var(--text-muted);font-size:.82rem;">No quizzes have been published to this subject yet — the new quiz will be the first one.</div>`;
    } else {
      sec.innerHTML += `<div style="color:var(--text-muted);font-size:.82rem;">No quizzes have been published to this subject yet.</div>`;
    }
    return;
  }

  if (simple) {
    // Renders as ONE column: a " Publish Here" gap marker before each
    // quiz, the quiz itself (read-only, same card style as the quiz-picker
    // list above), then a final gap marker after the last quiz for the
    // default "append at the end" spot — so there's exactly one way to pick
    // a spot, no separate before/after buttons to reconcile.
    const pos = adminPublishInsertPosition;
    const gapHtml = (activeCheck, onclick) => {
      const active = activeCheck;
      return `
        <div class="admin-publish-here-gap ${active ? 'admin-publish-here-active' : ''}" onclick="${onclick}" title="Publish the new quiz here">
          <span class="admin-publish-here-line"></span>
          <span class="admin-publish-here-btn">${active ? '<svg class="sicon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Publishing Here ✓' : '<svg class="sicon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Publish Here'}</span>
          <span class="admin-publish-here-line"></span>
        </div>`;
    };
    entries.forEach(e => {
      const isActiveGap = !!(pos && pos.lectureId === e.id && pos.position === 'before');
      sec.innerHTML += gapHtml(isActiveGap, `adminSetPublishInsertPosition('${e.id}','before')`);
      sec.innerHTML += `
        <div class="admin-quiz-item" style="cursor:default;">
          <div class="admin-quiz-item-info">
            <div class="admin-quiz-item-title">${escapeHtml(e.lectureName || e.id)}</div>
            <div class="admin-quiz-item-meta">${(e.questions || []).length} question${(e.questions||[]).length !== 1 ? 's' : ''}</div>
          </div>
        </div>`;
    });
    // Final gap = default behavior (append at the end) = no insert position set.
    sec.innerHTML += gapHtml(!pos, `adminClearPublishInsertPosition()`);
    sec.innerHTML += `
      <div style="font-size:.76rem;color:var(--text-muted);font-weight:600;margin-top:8px;">
        Need to edit, reorder, copy/move, or delete one of these? Head to
        <span style="color:var(--accent);cursor:pointer;font-weight:800;" onclick="adminJumpToCurriculumQuizzes()"><svg class="sicon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> Manage Curriculum</span>.
      </div>`;
    return;
  }

  entries.forEach((e, idx) => {
    sec.innerHTML += `
      <div class="admin-assigned-item">
        <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">
          <button class="admin-remove-btn" style="padding:3px 8px;background:var(--surface-2);color:var(--accent);border:1.5px solid var(--border-soft);line-height:1;" title="Move up"
            onclick="adminSwapLectureOrder('${e.id}','up')" ${idx === 0 ? 'disabled' : ''} aria-label="Move up"><svg class="sicon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg></button>
          <button class="admin-remove-btn" style="padding:3px 8px;background:var(--surface-2);color:var(--accent);border:1.5px solid var(--border-soft);line-height:1;" title="Move down"
            onclick="adminSwapLectureOrder('${e.id}','down')" ${idx === entries.length - 1 ? 'disabled' : ''} aria-label="Move down"><svg class="sicon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>
        </div>
        <div class="admin-assigned-info">
          <div class="admin-assigned-name">${escapeHtml(e.lectureName || e.id)}</div>
          <div class="admin-assigned-path">${(e.questions || []).length} question${(e.questions||[]).length !== 1 ? 's' : ''} · ${escapeHtml(adminTargetYear)} → ${escapeHtml(adminTargetModule)} → ${escapeHtml(subjects[subj].label || subj)}</div>
        </div>
        <button class="admin-remove-btn" style="background:var(--violet-pale);color:var(--violet-dark);border:1.5px solid var(--violet-mid-border);"
          onclick="adminEditPublished('${e.id}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>
        <button class="admin-remove-btn" style="background:var(--unanswered-bg);color:var(--unanswered-fg);border:1.5px solid var(--amber-strong);"
          onclick="adminRenamePublished('${e.id}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2.83 12.8a2 2 0 0 1 0-2.83L10 2.8a2 2 0 0 1 1.41-.59H19a2 2 0 0 1 2 2v7.59a2 2 0 0 1-.59 1.41z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Rename</button>
        <button class="admin-remove-btn" style="background:var(--chip-blue-bg);color:var(--nav-current);border:1.5px solid var(--nav-default);"
          onclick="adminOpenMoveQuiz('${e.id}', '${(e.lectureName||e.id).replace(/'/g,"\'")}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Copy/Move</button>
        <button class="admin-remove-btn" onclick="adminRemovePublished('${e.id}')"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>
      </div>
      <div id="adminPublishedEditorArea_${e.id}"></div>`;
  });

  // If currently editing one of these, render its editor
  if (adminEditMode === 'published' && adminEditingPublishedId) {
    renderAdminQuestionEditor('adminPublishedEditorArea_' + adminEditingPublishedId);
  }
}

// Toggle which existing quiz the about-to-be-published one should land
// before/after. Clicking the already-selected button clears it (back to
// the default: append at the end).
function adminSetPublishInsertPosition(lectureId, position) {
  if (adminPublishInsertPosition && adminPublishInsertPosition.lectureId === lectureId && adminPublishInsertPosition.position === position) {
    adminPublishInsertPosition = null;
  } else {
    adminPublishInsertPosition = { lectureId, position };
  }
  _renderAdminAssignedListHTML();
}
function adminClearPublishInsertPosition() {
  adminPublishInsertPosition = null;
  _renderAdminAssignedListHTML();
}

// Shortcut from the simplified "Publish Quizzes" list straight to the same
// subject's full quiz-management view in " Manage Curriculum". This is a
// deliberate one-time hand-off — it copies the Publish tab's destination
// into the Curriculum tab's own (otherwise entirely separate) navigation
// state, rather than the two tabs sharing state all the time.
function adminJumpToCurriculumQuizzes() {
  adminTargetYear = adminPubTargetYear;
  adminTargetModule = adminPubTargetModule;
  adminTargetSubject = adminPubTargetSubject;
  adminCurrNavLevel = 'quizzes';
  adminSwitchTab('curriculum');
}

/* Opens the Split Quiz panel for a published curriculum lecture.
   hydratePublishedLectureImages() is a no-op under the current inline-
   image architecture (kept only for call-site compatibility) — a
   published lecture's images are already part of its own JSON. */
async function openAdminSplitPanel(lectureId) {
  const entry = adminAssignedEntries.find(x => x.id === lectureId);
  if (!entry) return;
  if (!entry._splitImagesHydrated) {
    await hydratePublishedLectureImages(adminTargetSubject, lectureId, entry.questions || []);
    entry._splitImagesHydrated = true;
  }
  openSplitPanel('adminPublished', lectureId);
}

/* Load a published lecture's questions into the inline editor */
async function adminEditPublished(lectureId) {
  try {
    const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${adminTargetSubject}/${lectureId}.json`);
    if (!resp.ok) { alert('Could not find this lecture.'); return; }
    const data = await resp.json();

    adminEditMode = 'published';
    adminEditingPublishedId = lectureId;
    adminEditingPublishedName = data.lectureName || lectureId;
    adminEditQuestions = JSON.parse(JSON.stringify(data.questions || []));
    // Images are already inline (data: URLs) right on each question —
    // no hydrate step needed, and replacing one is just overwriting the
    // field like any other edit; there's no separate object to release.
    _questionEditDirty = false;

    renderAdminAssignedList();
    setTimeout(() => {
      const el = document.getElementById('adminPublishedEditorArea_' + lectureId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  } catch (e) {
    alert('Failed to load lecture: ' + (e.message || e));
  }
}

/* Quick standalone rename for an already-published quiz — updates just its
   display name (Firestore's `lectureName` field) without opening the full
   question editor or touching any question/image data. Mirrors the
   "<svg class="sicon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3c1.9 0 3.5-1.6 3.5-3.5C21 6.9 17 2 12 2z"/><circle cx="6.5" cy="11.5" r="1.5"/><circle cx="9.5" cy="7.5" r="1.5"/><circle cx="14.5" cy="7.5" r="1.5"/><circle cx="17.5" cy="11.5" r="1.5"/></svg> Icon" / "<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Rename" split used for Years/Modules/Subjects in
   js/curriculum-admin.js: changing what something is called shouldn't
   require going through its full edit flow. `subjects[subj].lectures` is
   keyed by lecture NAME (see adminSavePublishedEdits/adminRemovePublished
   above), so the in-memory entry has to move to the new key too, not just
   have its value patched. */
async function adminRenamePublished(lectureId) {
  const entry = adminAssignedEntries.find(x => x.id === lectureId);
  const current = (entry && entry.lectureName) || lectureId;
  const newName = prompt(`Rename quiz "${current}" to:`, current);
  if (newName === null) return; // cancelled
  const trimmed = newName.trim();
  if (!trimmed || trimmed === current) return;

  try {
    const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${adminTargetSubject}/${lectureId}.json`);
    if (!resp.ok) { alert('Could not find this lecture.'); return; }
    const data = await resp.json();
    const updatedAt = Date.now();
    // Opportunistic migration: if this lecture predates inline image
    // storage and still has a question pointing at a separately-hosted
    // image, inline it now rather than just passing it through unchanged.
    await ensureInlineImages(data.questions);
    const { putContentItem } = await import('./content-client.js');
    await putContentItem('curriculum', adminTargetSubject, lectureId, { ...data, lectureName: trimmed, updatedAt });

    // Move the in-memory entry over to its new name key.
    const lectures = subjects[adminTargetSubject] && subjects[adminTargetSubject].lectures;
    if (lectures && lectures[current]) {
      lectures[trimmed] = lectures[current];
      delete lectures[current];
    }
    if (entry) entry.lectureName = trimmed;
    // If this same lecture is (or was just) open in the full editor, keep
    // its editor title in sync too, so Edit → Save Changes below
    // doesn't silently revert the rename.
    if (adminEditingPublishedId === lectureId) adminEditingPublishedName = trimmed;
    // Manifest bump happens server-side in the Worker automatically, as
    // part of the authorized write above — no separate call needed here.

    _renderAdminAssignedListHTML();
    if (selectedSubject === adminTargetSubject) selectSubject(adminTargetSubject);
  } catch (e) {
    alert('Failed to rename: ' + (e.message || e));
  }
}

function adminCancelEditPublished() {
  _guardedClose(() => {
    const id = adminEditingPublishedId;
    adminEditMode = null;
    adminEditQuestions = null;
    adminEditingPublishedId = null;
    adminEditingPublishedName = '';
    if (id) {
      const el = document.getElementById('adminPublishedEditorArea_' + id);
      if (el) el.innerHTML = '';
    }
  });
}

/* Save edits made to an already-published lecture */
/* Lets an admin spin off their in-editor changes to a published curriculum
   lecture (e.g. after merging in extra questions) as a brand-new custom
   quiz, WITHOUT touching the published lecture at all. The normal
   "<svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Changes" pathway (adminSavePublishedEdits, below) remains the
   way to actually implement the edits on the curriculum. */
async function adminSaveEditsAsCustomQuiz() {
  if (!adminEditQuestions || !adminEditQuestions.length) return;
  const defaultTitle = (adminEditingPublishedName || 'Custom Quiz') + ' (copy)';
  const title = prompt('Save these edits as a new custom quiz — the curriculum lecture will not be changed. Title:', defaultTitle);
  if (title === null) return; // cancelled
  const finalTitle = title.trim() || defaultTitle;

  const statusEl = document.getElementById('adminEditStatus');
  if (statusEl) statusEl.innerHTML = `<div class="cq-status"><svg class="sicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Saving as custom quiz…</div>`;

  try {
    // Clone before normalizing/stripping so the live working copy — and the
    // separate "Save Changes to curriculum" pathway — is left untouched.
    const questions = JSON.parse(JSON.stringify(adminEditQuestions));
    _cqNormalizeCaseGroups(questions);
    _stripEditorTransientFields(questions);

    const quizzes = loadCustomQuizzes();
    quizzes.unshift({
      id: 'cq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      title: finalTitle,
      questions,
      createdAt: Date.now()
    });
    await saveCustomQuizzesList(quizzes);

    if (statusEl) statusEl.innerHTML = `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Saved as custom quiz "${escapeHtml(finalTitle)}" — the curriculum lecture was not changed.</div>`;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Failed to save: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function adminSavePublishedEdits() {
  if (!adminEditQuestions || !adminEditingPublishedId) return;
  const lectureId = adminEditingPublishedId;
  const statusEl = document.getElementById('adminEditStatus');
  if (statusEl) statusEl.innerHTML = `<div class="cq-status"><svg class="sicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Saving…</div>`;

  try {
    _cqNormalizeCaseGroups(adminEditQuestions);
    _stripEditorTransientFields(adminEditQuestions);
    const cleanQuestions = JSON.parse(JSON.stringify(adminEditQuestions)).map(q => {
      delete q.imageUrl;
      delete q.sharedImageIdx;
      delete q.pubImageIdx;
      if (!q.qid) q.qid = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); // backfill for pre-existing lectures
      return q;
    });

    if (statusEl) statusEl.innerHTML = `<div class="cq-status"><svg class="sicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Saving…</div>`;

    // In the normal case every image is already inline; this only does
    // real work if this lecture predates inline image storage.
    await ensureInlineImages(cleanQuestions);

    // Fetch the existing record first (for fields we want to preserve —
    // publishedAt, order, sourceTitle/sourceType) rather than a Firestore getDoc.
    const existingResp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${adminTargetSubject}/${lectureId}.json`);
    const existing = existingResp.ok ? await existingResp.json() : {};
    const updatedAt = Date.now();

    const { putContentItem } = await import('./content-client.js');
    await putContentItem('curriculum', adminTargetSubject, lectureId, {
      ...existing,
      id: lectureId,
      lectureName: adminEditingPublishedName,
      questions: cleanQuestions, // images are inline data: URLs — a changed image is just an overwritten field, nothing separate to release
      publishedBy: window._currentUser ? window._currentUser.uid : null,
      publishedAt: existing.publishedAt || updatedAt,
      updatedAt,
      order: existing.order != null ? existing.order : updatedAt // preserve admin-set position; backfill if missing
    });
    // Manifest bump (appConfig/publishedManifest) happens server-side in the
    // Worker, right after this authorized write succeeds — the separate
    // _updatePublishedManifest() call that used to be needed here is gone,
    // since it would now just be a redundant second write to the same doc.

    // Update in-memory subject — cleanQuestions already has resolved R2
    // image URLs at this point (putContentItem mutates them in place).
    if (!subjects[adminTargetSubject].lectures) subjects[adminTargetSubject].lectures = {};
    subjects[adminTargetSubject].lectures[adminEditingPublishedName] = cleanQuestions;

    if (statusEl) statusEl.innerHTML = `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Changes saved!</div>`;

    if (selectedSubject === adminTargetSubject) selectSubject(adminTargetSubject);

    // Close editor after a short delay so the user sees the success message
    _questionEditDirty = false;
    setTimeout(() => {
      adminEditMode = null;
      adminEditQuestions = null;
      adminEditingPublishedId = null;
      adminEditingPublishedName = '';
      renderAdminAssignedList();
    }, 900);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Failed: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function adminRemovePublished(lectureId) {
  if (!confirm('Remove this lecture from the question bank? This affects all users.')) return;
  try {
    // Look up the lecture name before deleting so we can remove it from memory
    const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${adminTargetSubject}/${lectureId}.json`);
    const lectureName = resp.ok ? ((await resp.json()).lectureName || lectureId) : null;

    // Deletes the content + images (also releasing their refcounts) and
    // updates the manifest, all server-side in the Worker.
    const { deleteContentItem } = await import('./content-client.js');
    await deleteContentItem('curriculum', adminTargetSubject, lectureId);

    // Remove from in-memory subject too
    if (lectureName && subjects[adminTargetSubject].lectures) {
      delete subjects[adminTargetSubject].lectures[lectureName];
    }

    // If this lecture was being edited, close the editor
    if (adminEditMode === 'published' && adminEditingPublishedId === lectureId) {
      adminEditMode = null;
      adminEditQuestions = null;
      adminEditingPublishedId = null;
      adminEditingPublishedName = '';
    }

    renderAdminAssignedList();
    if (selectedSubject === adminTargetSubject) selectSubject(adminTargetSubject);
  } catch (e) {
    alert('Failed to remove: ' + (e.message || e));
  }
}

/**
 * Publishes ONE quiz into `targetSubject` under `lectureName`, using
 * `questionsOverride` (an admin-edited working copy) if given, otherwise
 * the quiz's own stored questions. This is the single unit of work shared
 * by both the single-quiz and multi-quiz batch paths in adminPublishQuiz()
 * below — it does not touch the DOM or any adminSelected* state, so it's
 * safe to call in a loop. Reads `adminPublishInsertPosition` for
 * before/after placement, exactly as the original single-publish flow did.
 * Returns the new lectureId on success; throws on failure.
 */
async function _adminPublishOneQuiz(quizObj, targetSubject, lectureName, questionsOverride) {
  let questions;
  if (questionsOverride) {
    // Use the admin-edited working copy as-is
    _cqNormalizeCaseGroups(questionsOverride);
    _stripEditorTransientFields(questionsOverride);
    questions = questionsOverride;
  } else {
    // Restore options order if this quiz came from a shared/community doc
    questions = quizObj.questions;
    if (quizObj.sourceType === 'community') {
      questions = restoreOptionsOrder(questions);
    } else {
      // Make sure custom-quiz images are hydrated too
      await hydrateQuizImages(questions);
    }
  }

  // Images are stored INLINE in the published lecture's JSON now (a
  // data: URL right on the question) — so every question needs its
  // image actually inlined before this gets written. In the normal
  // case (a fresh custom quiz, or a community quiz shared after this
  // change) that's already true and this is a no-op; it only does real
  // work for an older, not-yet-migrated community quiz still pointing
  // at a separately-hosted image URL.
  await ensureInlineImages(questions);

  // Deep-clone + strip source-specific sentinels so each question is clean.
  // Assign a STABLE id to every question that doesn't already have one —
  // this must survive community -> publish -> later-edit unchanged, since
  // it's what image references and (if ever needed) retake snapshots key
  // off, instead of array position (which breaks silently on reorder).
  const cleanQuestions = JSON.parse(JSON.stringify(questions)).map(q => {
    delete q.imageUrl;
    delete q.sharedImageIdx;
    delete q.pubImageIdx;
    if (!q.qid) q.qid = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    return q;
  });

  const lectureId = 'pub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const publishedAt = Date.now();

  // Work out where in the list this new quiz should sit. Default: newest
  // goes last (order = publishedAt, the largest of all existing values).
  // If the admin picked a before/after spot in the picker, compute an
  // order value that slots it exactly there — midpoint between the two
  // neighboring order values (or one below/above the first/last entry).
  // Content now lives in R2, not a queryable Firestore collection, so
  // existing lectures' order/publishedAt are read from R2 directly here
  // (admin-only, infrequent action — the cost of a few extra reads is
  // fine for this, unlike the student-facing hot paths elsewhere).
  let order = publishedAt;
  const pos = adminPublishInsertPosition;
  if (pos) {
    try {
      const { fetchCurriculumManifest } = await import('./content-client.js');
      const manifest = await fetchCurriculumManifest();
      const lecIds = Object.keys(manifest[targetSubject] || {});
      const existing = [];
      for (const lecId of lecIds) {
        const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${targetSubject}/${lecId}.json`);
        if (resp.ok) existing.push({ id: lecId, ...(await resp.json()) });
      }
      existing.sort((a, b) => (a.order ?? a.publishedAt ?? 0) - (b.order ?? b.publishedAt ?? 0));
      const idx = existing.findIndex(e => e.id === pos.lectureId);
      if (idx !== -1) {
        const targetOrder = existing[idx].order ?? existing[idx].publishedAt ?? 0;
        if (pos.position === 'before') {
          const prev = existing[idx - 1];
          order = prev ? ((prev.order ?? prev.publishedAt ?? 0) + targetOrder) / 2 : targetOrder - 1;
        } else {
          const next = existing[idx + 1];
          order = next ? (targetOrder + (next.order ?? next.publishedAt ?? 0)) / 2 : targetOrder + 1;
        }
      }
    } catch (e) {
      // If this lookup fails for any reason, just fall back to appending at the end.
    }
  }

  const { putContentItem } = await import('./content-client.js');
  await putContentItem('curriculum', targetSubject, lectureId, {
    id: lectureId,
    lectureName,
    questions: cleanQuestions, // images are inline data: URLs, already baked into the JSON — nothing further happens to them here
    sourceTitle: quizObj.title,
    sourceType: quizObj.sourceType,
    publishedBy: window._currentUser ? window._currentUser.uid : null,
    publishedAt,
    order
  });
  // Manifest bump (appConfig/publishedManifest) happens server-side in the
  // Worker, right after putContentItem's write succeeds above.

  // Merge into the in-memory subject so it's usable immediately —
  // cleanQuestions already has real, resolved R2 image URLs at this
  // point (putContentItem mutates them in place during upload), so no
  // separate hydrate step is needed.
  if (!subjects[targetSubject].lectures) subjects[targetSubject].lectures = {};
  subjects[targetSubject].lectures[lectureName] = cleanQuestions;

  return lectureId;
}

/**
 * Publishes everything currently queued in adminSelectedQuizzes into
 * adminPubTargetSubject. A single queued quiz keeps the original
 * behavior exactly (stays selected afterward, so it can be re-published
 * elsewhere under a different name without re-picking it). Two or more
 * queued quizzes publish SEQUENTIALLY — each one is fully awaited before
 * the next starts, never in parallel — so writes can't race each other
 * and a failure partway through only affects the quizzes after it; the
 * ones that already succeeded are removed from the queue and the ones
 * that failed stay queued for a retry.
 */
async function adminPublishQuiz() {
  if (adminBusy) return;
  if (!adminSelectedQuizzes.size || !adminPubTargetSubject) return;
  const targetSubject = adminPubTargetSubject;
  const statusEl = document.getElementById('adminStatus');

  adminBusy = true;
  const btn = document.getElementById('adminPublishBtn');
  if (btn) btn.disabled = true;

  const entries = Array.from(adminSelectedQuizzes.entries());

  try {
    if (entries.length === 1) {
      const [, quizObj] = entries[0];
      const nameInput = document.getElementById('adminLectureName');
      let lectureName = (nameInput?.value || '').trim();
      if (!lectureName) lectureName = quizObj.title;

      if (statusEl) statusEl.innerHTML = `<div class="cq-status"><svg class="sicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Publishing…</div>`;
      try {
        const questionsOverride = (adminEditMode === 'publish' && adminEditQuestions) ? adminEditQuestions : null;
        await _adminPublishOneQuiz(quizObj, targetSubject, lectureName, questionsOverride);

        if (statusEl) statusEl.innerHTML = `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Published "${escapeHtml(lectureName)}" to ${escapeHtml(subjects[targetSubject].label || targetSubject)}!</div>`;
        if (nameInput) nameInput.value = '';

        // Close the editor after a successful publish
        adminEditMode = null;
        adminEditQuestions = null;
        const editorArea = document.getElementById('adminEditorArea');
        if (editorArea) editorArea.innerHTML = '';

        // Reset the insert-position picker for next time
        adminPublishInsertPosition = null;

        if (selectedSubject === targetSubject) selectSubject(targetSubject);
        renderAdminAssignedList();
      } catch (e) {
        if (statusEl) statusEl.innerHTML = `<div class="cq-status error"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Failed: ${escapeHtml(e.message || String(e))}</div>`;
      }
      return;
    }

    // ── Batch publish: 2+ quizzes queued ──
    const total = entries.length;
    let publishedCount = 0;
    const failures = [];

    // If the admin picked a "before/after this lecture" insert spot, chain
    // subsequent "after X" publishes off the quiz just published (instead
    // of re-targeting the original anchor every time) — otherwise each new
    // "after X" insert would land right next to X again, reversing the
    // batch's order. "before X" already chains correctly with no
    // adjustment needed, since each new insert naturally lands the
    // closest to X so far.
    let chainPos = adminPublishInsertPosition ? { ...adminPublishInsertPosition } : null;

    for (let i = 0; i < total; i++) {
      const [key, quizObj] = entries[i];
      if (statusEl) statusEl.innerHTML = `<div class="cq-status"><svg class="sicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Publishing ${i + 1}/${total}: "${escapeHtml(quizObj.title)}"…</div>`;

      adminPublishInsertPosition = chainPos;
      try {
        const lectureId = await _adminPublishOneQuiz(quizObj, targetSubject, quizObj.title, null);
        publishedCount++;
        adminSelectedQuizzes.delete(key);
        if (chainPos && chainPos.position === 'after') {
          chainPos = { lectureId, position: 'after' };
        }
      } catch (e) {
        console.warn(`Publish failed for "${quizObj.title}":`, e);
        failures.push({ title: quizObj.title, message: e.message || String(e) });
      }
    }

    adminPublishInsertPosition = null;
    adminEditMode = null;
    adminEditQuestions = null;

    if (selectedSubject === targetSubject) selectSubject(targetSubject);
    renderAdminAssignedList();

    const resultHtml = failures.length
      ? `<div class="cq-status ${publishedCount ? '' : 'error'}">${publishedCount ? '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'} Published ${publishedCount}/${total}. Failed: ${failures.map(f => `"${escapeHtml(f.title)}" — ${escapeHtml(f.message)}`).join('; ')}</div>`
      : `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Published all ${publishedCount} quizzes to ${escapeHtml(subjects[targetSubject].label || targetSubject)}!</div>`;

    adminLastPublishResult = resultHtml;
    renderAdminAssignForm();
    const freshStatus = document.getElementById('adminStatus');
    if (freshStatus) freshStatus.innerHTML = resultHtml;
  } finally {
    adminBusy = false;
    const freshBtn = document.getElementById('adminPublishBtn');
    if (freshBtn) freshBtn.disabled = false;
  }
}

