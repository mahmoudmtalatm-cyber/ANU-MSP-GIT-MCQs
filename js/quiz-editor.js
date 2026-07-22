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
      ✏️ Editing — ${adminEditQuestions.length} question${adminEditQuestions.length !== 1 ? 's' : ''}
    </div>
    <div style="font-size:.74rem;color:var(--text-muted);font-weight:600;">
      🔘 = correct answer &nbsp;·&nbsp; 🔗 = linked case questions
    </div>
  </div>`;
  html += _renderBulkAiToolsPanel('admin', adminEditQuestions);
  html += `<div id="adminBulkLockWrap"${_editorBulkBusy.admin ? ' class="cq-bulk-lock"' : ''}>`;
  html += `<div class="cq-preview-list" id="adminEditList">`;

  adminEditQuestions.forEach((q, i) => {
    const optEntries = getOptionEntries(q);
    const usedKeys   = optEntries.map(([k]) => k);
    const nextKey    = ALL_KEYS.find(k => !usedKeys.includes(k));

    html += `<div class="cq-preview-q cq-editable-q" id="adminEditQ_${i}">`;

    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">
      <span style="background:var(--accent);color:#fff;font-size:.72rem;font-weight:800;
        border-radius:20px;padding:2px 9px;white-space:nowrap;flex-shrink:0;">Q${i + 1}</span>
      ${_renderMergeSourceBadge(q)}
      <span style="flex:1;font-size:.75rem;font-weight:700;color:var(--text-muted);">Question Text</span>
      ${_renderReorderButtons('admin', i, adminEditQuestions.length)}
      <button class="cq-edit-reask-btn" title="Delete this question"
        onclick="adminEditDeleteQuestion(${i})"
        style="background:var(--wrong-bg);color:var(--wrong-fg);border-color:var(--red-soft-border);">🗑 Delete</button>
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
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;">📷 Question Image</div>
          <label class="cq-img-action-btn" title="Upload a different image">
            🔄 Change Image
            <input type="file" accept="image/*" style="display:none;" onchange="adminEditReplaceImage(${i}, event)" />
          </label>
          <button class="cq-img-action-btn cq-img-remove-btn" onclick="adminEditRemoveImage(${i})" type="button">🗑️ Remove Image</button>
        </div>
      </div>`;
    } else {
      html += `<label class="cq-img-upload-label" title="Attach an image to this question">
        🖼️ Add Image (optional)
        <input type="file" accept="image/*" style="display:none;" onchange="adminEditReplaceImage(${i}, event)" />
      </label>`;
    }
    html += `</div>`;

    /* ── Manual case-group link ── */
    html += _renderCaseGroupBlock('admin', adminEditQuestions, i);

    html += `<div style="font-size:.72rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;">
      Answer Choices &nbsp;<span style="font-weight:500;text-transform:none;letter-spacing:0;">— select the correct answer with 🔘</span>
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
    <button class="cq-btn cq-btn-secondary" onclick="openMergePicker('admin')" style="background:var(--violet);color:#fff;">🧩 Merge Quizzes In</button>
    ${adminEditMode === 'published' ? `
      <button class="cq-btn cq-btn-secondary" onclick="openAdminSplitPanel('${adminEditingPublishedId}')"
        style="background:var(--violet);color:#fff;" title="Split into multiple quizzes">✂️ Split into Multiple</button>
      <button class="cq-btn" onclick="adminSavePublishedEdits()" title="Implement these edits on the curriculum lecture">💾 Save Changes</button>
      <button class="cq-btn cq-btn-secondary" onclick="adminSaveEditsAsCustomQuiz()"
        style="background:var(--violet);color:#fff;" title="Save these edits as a new custom quiz — the curriculum lecture stays untouched">📄 Save as Custom Quiz</button>
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
  adminEditQuestions.splice(idx, 1);
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
      ✏️ ${cqCreatingNew ? 'Writing a new quiz' : 'Editing'} — ${cqEditQuestions.length} question${cqEditQuestions.length !== 1 ? 's' : ''}
    </div>
    <div style="font-size:.74rem;color:var(--text-muted);font-weight:600;">
      🔘 = correct answer &nbsp;·&nbsp; 🔗 = linked case questions
    </div>
  </div>`;
  html += _renderBulkAiToolsPanel('customQuiz', cqEditQuestions);
  html += `<div id="customQuizBulkLockWrap"${_editorBulkBusy.customQuiz ? ' class="cq-bulk-lock"' : ''}>`;
  html += `<div class="cq-preview-list" id="cqCustomEditList_${key}">`;

  cqEditQuestions.forEach((q, i) => {
    const optEntries = getOptionEntries(q);
    const usedKeys   = optEntries.map(([k]) => k);
    const nextKey    = ALL_KEYS.find(k => !usedKeys.includes(k));

    html += `<div class="cq-preview-q cq-editable-q" id="cqCustomEditQ_${i}">`;

    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">
      <span style="background:var(--accent);color:#fff;font-size:.72rem;font-weight:800;
        border-radius:20px;padding:2px 9px;white-space:nowrap;flex-shrink:0;">Q${i + 1}</span>
      ${_renderMergeSourceBadge(q)}
      <span style="flex:1;font-size:.75rem;font-weight:700;color:var(--text-muted);">Question Text</span>
      ${_renderReorderButtons('customQuiz', i, cqEditQuestions.length)}
      <button class="cq-edit-reask-btn" title="Delete this question"
        onclick="cqEditDeleteQuestion(${i})"
        style="background:var(--wrong-bg);color:var(--wrong-fg);border-color:var(--red-soft-border);">🗑 Delete</button>
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
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;">📷 Question Image</div>
          <label class="cq-img-action-btn" title="Upload a different image">
            🔄 Change Image
            <input type="file" accept="image/*" style="display:none;" onchange="cqEditReplaceImage(${i}, event)" />
          </label>
          <button class="cq-img-action-btn cq-img-remove-btn" onclick="cqEditRemoveImage(${i})" type="button">🗑️ Remove Image</button>
        </div>
      </div>`;
    } else {
      html += `<label class="cq-img-upload-label" title="Attach an image to this question">
        🖼️ Add Image (optional)
        <input type="file" accept="image/*" style="display:none;" onchange="cqEditReplaceImage(${i}, event)" />
      </label>`;
    }
    html += `</div>`;

    /* ── Manual case-group link ── */
    html += _renderCaseGroupBlock('customQuiz', cqEditQuestions, i);

    html += `<div style="font-size:.72rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;">
      Answer Choices &nbsp;<span style="font-weight:500;text-transform:none;letter-spacing:0;">— select the correct answer with 🔘</span>
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
    <button class="cq-btn cq-btn-secondary" onclick="openMergePicker('customQuiz')" style="background:var(--violet);color:#fff;">🧩 Merge Quizzes In</button>
    ${!cqCreatingNew ? `
      <button class="cq-btn cq-btn-secondary" onclick="openSplitPanel('saved', '${cqEditingQuizId}')"
        style="background:var(--violet);color:#fff;" title="Split into multiple quizzes">✂️ Split into Multiple</button>
    ` : ''}
    <button class="cq-btn" onclick="saveCustomQuizEdits()">💾 Save Changes</button>
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
  if (statusEl) statusEl.innerHTML = `<div class="cq-status info">💾 Saving…</div>`;

  const quizzes = loadCustomQuizzes();

  if (cqCreatingNew) {
    quizzes.push({
      id: 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      title: cqNewQuizTitle.trim(),
      questions: JSON.parse(JSON.stringify(cqEditQuestions)),
      createdAt: Date.now()
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
    if (statusEl) statusEl.innerHTML = `<div class="cq-status warning">⚠️ Save failed: ${escapeHtml(e.message || String(e))}</div>`;
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
    const col  = window._collection(window._db, 'publishedQuestions', subj, 'lectures');
    const snap = await window._getDocs(col);
    const entries = [];
    snap.forEach(d => entries.push({ id: d.id, ...d.data() }));
    entries.sort((a, b) => (a.order ?? a.publishedAt ?? 0) - (b.order ?? b.publishedAt ?? 0));

    const idx = entries.findIndex(e => e.id === lectureId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= entries.length) return; // already at an edge

    const a = entries[idx];
    const b = entries[swapIdx];
    const aOrder = a.order ?? a.publishedAt ?? 0;
    const bOrder = b.order ?? b.publishedAt ?? 0;

    await window._setDoc(
      window._doc(window._db, 'publishedQuestions', subj, 'lectures', a.id),
      { order: bOrder }, { merge: true }
    );
    await window._setDoc(
      window._doc(window._db, 'publishedQuestions', subj, 'lectures', b.id),
      { order: aOrder }, { merge: true }
    );

    // Only these two quizzes are invalidated for every other user — nothing
    // else they've already cached is touched.
    const now = Date.now();
    await _updatePublishedManifest(subj, a.id, now);
    await _updatePublishedManifest(subj, b.id, now + 1);

    // Refresh in-memory ordering + whatever the admin currently has open
    await loadPublishedQuestionsIntoSubjects();
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
  sec.innerHTML = `<div class="admin-assigned-title">Published lectures in "${escapeHtml(subjects[subj].label || subj)}" <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-muted);">— use ⬆️⬇️ to set the order students see</span></div>`;

  let entries = [];
  try {
    const col = window._collection(window._db, 'publishedQuestions', subj, 'lectures');
    const snap = await window._getDocs(col);
    snap.forEach(d => entries.push({ id: d.id, ...d.data() }));
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
  // the "📚 Manage Curriculum" tab. Showing them here too was redundant
  // and easy to trigger by mistake mid-publish. It does let the admin pick
  // where the new quiz will land relative to these, via before/after markers.
  const simple = adminActiveTab !== 'curriculum';

  sec.innerHTML = simple
    ? `<div class="admin-assigned-title">Publish Here — "${escapeHtml(subjects[subj].label || subj)}" <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-muted);">— tap 📤 Publish Here to choose where the new quiz lands in the list below</span></div>`
    : `<div class="admin-assigned-title">Published lectures in "${escapeHtml(subjects[subj].label || subj)}" <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-muted);">— use ⬆️⬇️ to set the order students see</span></div>`;

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
    // Renders as ONE column: a "📤 Publish Here" gap marker before each
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
          <span class="admin-publish-here-btn">${active ? '📍 Publishing Here ✓' : '📤 Publish Here'}</span>
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
        <span style="color:var(--accent);cursor:pointer;font-weight:800;" onclick="adminJumpToCurriculumQuizzes()">📚 Manage Curriculum</span>.
      </div>`;
    return;
  }

  entries.forEach((e, idx) => {
    sec.innerHTML += `
      <div class="admin-assigned-item">
        <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">
          <button class="admin-remove-btn" style="padding:3px 8px;background:var(--surface-2);color:var(--accent);border:1.5px solid var(--border-soft);line-height:1;" title="Move up"
            onclick="adminSwapLectureOrder('${e.id}','up')" ${idx === 0 ? 'disabled' : ''}>⬆️</button>
          <button class="admin-remove-btn" style="padding:3px 8px;background:var(--surface-2);color:var(--accent);border:1.5px solid var(--border-soft);line-height:1;" title="Move down"
            onclick="adminSwapLectureOrder('${e.id}','down')" ${idx === entries.length - 1 ? 'disabled' : ''}>⬇️</button>
        </div>
        <div class="admin-assigned-info">
          <div class="admin-assigned-name">${escapeHtml(e.lectureName || e.id)}</div>
          <div class="admin-assigned-path">${(e.questions || []).length} question${(e.questions||[]).length !== 1 ? 's' : ''} · ${escapeHtml(adminTargetYear)} → ${escapeHtml(adminTargetModule)} → ${escapeHtml(subjects[subj].label || subj)}</div>
        </div>
        <button class="admin-remove-btn" style="background:var(--violet-pale);color:var(--violet-dark);border:1.5px solid var(--violet-mid-border);"
          onclick="adminEditPublished('${e.id}')">✏️ Edit</button>
        <button class="admin-remove-btn" style="background:var(--chip-blue-bg);color:var(--nav-current);border:1.5px solid var(--nav-default);"
          onclick="adminOpenMoveQuiz('${e.id}', '${(e.lectureName||e.id).replace(/'/g,"\'")}')">📋 Copy/Move</button>
        <button class="admin-remove-btn" onclick="adminRemovePublished('${e.id}')">🗑 Delete</button>
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
// subject's full quiz-management view in "📚 Manage Curriculum". This is a
// deliberate one-time hand-off — it copies the Publish tab's destination
// into the Curriculum tab's own (otherwise entirely separate) navigation
// state, rather than the two tabs sharing state all the time.
function adminJumpToCurriculumQuizzes() {
  adminTargetYear    = adminPubTargetYear;
  adminTargetModule  = adminPubTargetModule;
  adminTargetSubject = adminPubTargetSubject;
  adminCurrNavLevel = 'quizzes';
  adminSwitchTab('curriculum');
}

/* Opens the Split Quiz panel for a published curriculum lecture.
   Hydrates its images first (published lectures store images in a
   separate Firestore subcollection) so the split-off quizzes keep them. */
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
    const ref  = window._doc(window._db, 'publishedQuestions', adminTargetSubject, 'lectures', lectureId);
    const snap = await window._getDoc(ref);
    if (!snap.exists()) { alert('Could not find this lecture.'); return; }
    const data = snap.data();

    adminEditMode = 'published';
    adminEditingPublishedId   = lectureId;
    adminEditingPublishedName = data.lectureName || lectureId;
    adminEditQuestions = JSON.parse(JSON.stringify(data.questions || []));
    // Hydrate images from the subcollection so they appear in the editor
    await hydratePublishedLectureImages(adminTargetSubject, lectureId, adminEditQuestions);
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
   "💾 Save Changes" pathway (adminSavePublishedEdits, below) remains the
   way to actually implement the edits on the curriculum. */
async function adminSaveEditsAsCustomQuiz() {
  if (!adminEditQuestions || !adminEditQuestions.length) return;
  const defaultTitle = (adminEditingPublishedName || 'Custom Quiz') + ' (copy)';
  const title = prompt('Save these edits as a new custom quiz — the curriculum lecture will not be changed. Title:', defaultTitle);
  if (title === null) return; // cancelled
  const finalTitle = title.trim() || defaultTitle;

  const statusEl = document.getElementById('adminEditStatus');
  if (statusEl) statusEl.innerHTML = `<div class="cq-status">⏳ Saving as custom quiz…</div>`;

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

    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ Saved as custom quiz "${escapeHtml(finalTitle)}" — the curriculum lecture was not changed.</div>`;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">❌ Failed to save: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function adminSavePublishedEdits() {
  if (!adminEditQuestions || !adminEditingPublishedId) return;
  const lectureId = adminEditingPublishedId;
  const statusEl = document.getElementById('adminEditStatus');
  if (statusEl) statusEl.innerHTML = `<div class="cq-status">⏳ Saving…</div>`;

  try {
    _cqNormalizeCaseGroups(adminEditQuestions);
    _stripEditorTransientFields(adminEditQuestions);
    const cleanQuestions = JSON.parse(JSON.stringify(adminEditQuestions)).map(q => {
      delete q.imageUrl;
      delete q.sharedImageIdx;
      delete q.pubImageIdx; // will be re-assigned after upload
      return q;
    });

    // Re-upload images into the subcollection (handles new images added during edit,
    // and also re-saves existing ones so no image is ever lost)
    if (statusEl) statusEl.innerHTML = `<div class="cq-status">⏳ Uploading images…</div>`;
    await uploadPublishedLectureImages(adminTargetSubject, lectureId, cleanQuestions);

    const ref = window._doc(window._db, 'publishedQuestions', adminTargetSubject, 'lectures', lectureId);
    const snap = await window._getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    const updatedAt = Date.now();

    await window._setDoc(ref, cleanForFirestore({
      ...existing,
      id: lectureId,
      lectureName: adminEditingPublishedName,
      questions: cleanQuestions,
      publishedBy: window._currentUser ? window._currentUser.uid : null,
      publishedAt: existing.publishedAt || updatedAt,
      updatedAt,
      order: existing.order != null ? existing.order : updatedAt // preserve admin-set position; backfill if missing
    }));

    // Update in-memory subject (hydrate images from subcollection for immediate use)
    const hydratedForMemory = JSON.parse(JSON.stringify(cleanQuestions));
    await hydratePublishedLectureImages(adminTargetSubject, lectureId, hydratedForMemory);
    if (!subjects[adminTargetSubject].lectures) subjects[adminTargetSubject].lectures = {};
    subjects[adminTargetSubject].lectures[adminEditingPublishedName] = hydratedForMemory;

    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ Changes saved!</div>`;

    // Only THIS quiz's cache entry is invalidated for every other user —
    // everything else they've already cached stays untouched.
    await _updatePublishedManifest(adminTargetSubject, lectureId, updatedAt);

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
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">❌ Failed: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function adminRemovePublished(lectureId) {
  if (!confirm('Remove this lecture from the question bank? This affects all users.')) return;
  try {
    // Look up the lecture name before deleting so we can remove it from memory
    const ref = window._doc(window._db, 'publishedQuestions', adminTargetSubject, 'lectures', lectureId);
    const snap = await window._getDoc(ref);
    const lectureName = snap.exists() ? (snap.data().lectureName || lectureId) : null;

    // Delete images subcollection first, then the lecture doc itself
    await deletePublishedLectureImages(adminTargetSubject, lectureId);
    await window._deleteDoc(ref);

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

    _idbDelete('published:' + adminTargetSubject + ':' + lectureId);
    await _updatePublishedManifest(adminTargetSubject, lectureId, null);
    renderAdminAssignedList();
    if (selectedSubject === adminTargetSubject) selectSubject(adminTargetSubject);
  } catch (e) {
    alert('Failed to remove: ' + (e.message || e));
  }
}

async function adminPublishQuiz() {
  if (adminBusy) return;
  if (!adminSelectedQuiz || !adminPubTargetSubject) return;
  const targetSubject = adminPubTargetSubject;

  const nameInput = document.getElementById('adminLectureName');
  let lectureName = (nameInput?.value || '').trim();
  if (!lectureName) lectureName = adminSelectedQuiz.title;

  const statusEl = document.getElementById('adminStatus');
  adminBusy = true;
  const btn = document.getElementById('adminPublishBtn');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = `<div class="cq-status">⏳ Publishing…</div>`;

  try {
    let questions;
    if (adminEditMode === 'publish' && adminEditQuestions) {
      // Use the admin-edited working copy as-is (images already inline as data URLs)
      _cqNormalizeCaseGroups(adminEditQuestions);
      _stripEditorTransientFields(adminEditQuestions);
      questions = adminEditQuestions;
    } else {
      // Restore options order if this quiz came from a shared/community doc
      questions = adminSelectedQuiz.questions;
      if (adminSelectedQuiz.sourceType === 'community') {
        questions = restoreOptionsOrder(questions);
        // Hydrate any shared images so q.image is present before saving
        await hydrateSharedQuizImages(adminSelectedQuiz.sourceId, questions);
      } else {
        // Make sure custom-quiz images are hydrated too
        await hydrateQuizImages(questions);
      }
    }

    // Deep-clone + strip source-specific sentinels so each question is clean
    const cleanQuestions = JSON.parse(JSON.stringify(questions)).map(q => {
      delete q.imageUrl;
      delete q.sharedImageIdx;
      delete q.pubImageIdx; // will be re-assigned below after image upload
      return q;
    });

    const lectureId = 'pub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Upload images into a separate subcollection so the lecture doc stays under Firestore's
    // 1 MB limit — and so the published lecture is fully self-contained, independent of the
    // source quiz.  Even if the source quiz is later deleted, images remain here.
    if (statusEl) statusEl.innerHTML = `<div class="cq-status">⏳ Uploading images…</div>`;
    await uploadPublishedLectureImages(targetSubject, lectureId, cleanQuestions);

    const publishedAt = Date.now();

    // Work out where in the list this new quiz should sit. Default: newest
    // goes last (order = publishedAt, the largest of all existing values).
    // If the admin picked a before/after spot in the picker, compute an
    // order value that slots it exactly there — midpoint between the two
    // neighboring order values (or one below/above the first/last entry).
    let order = publishedAt;
    const pos = adminPublishInsertPosition;
    if (pos) {
      try {
        const col  = window._collection(window._db, 'publishedQuestions', targetSubject, 'lectures');
        const snap = await window._getDocs(col);
        const existing = [];
        snap.forEach(d => existing.push({ id: d.id, ...d.data() }));
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

    const ref = window._doc(window._db, 'publishedQuestions', targetSubject, 'lectures', lectureId);
    await window._setDoc(ref, cleanForFirestore({
      id: lectureId,
      lectureName,
      questions: cleanQuestions,
      sourceTitle: adminSelectedQuiz.title,
      sourceType: adminSelectedQuiz.sourceType,
      publishedBy: window._currentUser ? window._currentUser.uid : null,
      publishedAt,
      order // newest goes last by default, or the admin-chosen before/after spot
    }));

    // Merge into the in-memory subject so it's usable immediately.
    // Build a hydrated copy (with q.image restored) for in-memory use,
    // while cleanQuestions (with pubImageIdx sentinels) was what we saved to Firestore.
    const hydratedForMemory = JSON.parse(JSON.stringify(cleanQuestions));
    await hydratePublishedLectureImages(targetSubject, lectureId, hydratedForMemory);
    if (!subjects[targetSubject].lectures) subjects[targetSubject].lectures = {};
    subjects[targetSubject].lectures[lectureName] = hydratedForMemory;

    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ Published "${escapeHtml(lectureName)}" to ${escapeHtml(subjects[targetSubject].label || targetSubject)}!</div>`;
    if (nameInput) nameInput.value = '';

    // Only THIS new quiz shows up as changed for every other user —
    // their cache for every other quiz/subject stays untouched.
    await _updatePublishedManifest(targetSubject, lectureId, publishedAt);

    // Close the editor after a successful publish
    adminEditMode = null;
    adminEditQuestions = null;
    const editorArea = document.getElementById('adminEditorArea');
    if (editorArea) editorArea.innerHTML = '';

    // Reset the insert-position picker for next time
    adminPublishInsertPosition = null;

    // Refresh subject view if currently open
    if (selectedSubject === targetSubject) selectSubject(targetSubject);

    renderAdminAssignedList();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">❌ Failed: ${escapeHtml(e.message || String(e))}</div>`;
  } finally {
    adminBusy = false;
    if (btn) btn.disabled = false;
  }
}

