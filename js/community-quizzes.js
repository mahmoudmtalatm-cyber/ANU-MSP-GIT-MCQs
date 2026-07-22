/* ══════════════════════════════════════════════════════════
   MERGE QUIZZES INTO EDITOR
   A picker modal, opened from the extract/generate preview,
   the custom-quiz editor, or the admin editor (via the shared
   _caseGroupEditors registry), that lets the user append any
   number of other quizzes — community, saved custom, or
   official curriculum lectures — onto the one currently open
   in that editor. Selection only; nothing is written until the
   editor's own "Save" is used afterwards.
══════════════════════════════════════════════════════════ */
let mergeEditorKey = null;    // 'cq' | 'admin' | 'customQuiz' — which _caseGroupEditors entry to append into
let mergeTab       = 'community'; // 'community' | 'custom' | 'curriculum'

let mergeCommTab           = 'browse'; // 'browse' | 'mine'
let mergeCommSearch        = '';
let mergeCommYearFilter    = '';
let mergeCommModuleFilter  = '';
let mergeCommSubjectFilter = '';
let mergeCommSort          = 'newest';
let mergeSelectedCommunity = new Set(); // shared quiz ids

let mergeCustomSearch      = '';
let mergeSelectedCustom    = new Set(); // custom quiz ids

let mergeCurrYear          = '';
let mergeCurrModule        = '';
let mergeCurrSubject       = '';
let mergeSelectedCurriculum = new Set(); // "subjectKey::lectureName"

function openMergePicker(editorKey) {
  const ed = _caseGroupEditors[editorKey];
  if (!ed || !ed.getQuestions()) return;
  mergeEditorKey = editorKey;
  mergeTab = 'community';
  mergeCommTab = 'browse';
  mergeCommSearch = ''; mergeCommYearFilter = ''; mergeCommModuleFilter = ''; mergeCommSubjectFilter = ''; mergeCommSort = 'newest';
  mergeSelectedCommunity = new Set();
  mergeCustomSearch = '';
  mergeSelectedCustom = new Set();
  mergeCurrYear = ''; mergeCurrModule = ''; mergeCurrSubject = '';
  mergeSelectedCurriculum = new Set();
  document.getElementById('mergeQuizOverlay').classList.remove('hidden');
  renderMergePicker();
}

function closeMergePicker() {
  document.getElementById('mergeQuizOverlay').classList.add('hidden');
  mergeEditorKey = null;
}

function mergeSetTab(tab) {
  mergeTab = tab;
  renderMergePicker();
}

function _mergeTotalSelected() {
  return mergeSelectedCommunity.size + mergeSelectedCustom.size + mergeSelectedCurriculum.size;
}

function _mergeUpdateFooter() {
  const total = _mergeTotalSelected();
  const countEl = document.getElementById('mergeFooterCount');
  const btnEl   = document.getElementById('mergeConfirmBtn');
  if (countEl) countEl.textContent = `${total} question set${total !== 1 ? 's' : ''} selected`;
  if (btnEl) { btnEl.disabled = !total; btnEl.textContent = total ? `🧩 Merge ${total} Selected` : '🧩 Merge Selected'; }
}

function renderMergePicker() {
  const body = document.getElementById('mergeQuizBody');
  if (!body) return;
  const total = _mergeTotalSelected();

  let html = `<div class="community-section-tabs">
    <button class="community-tab-btn ${mergeTab==='community'?'active':''}" onclick="mergeSetTab('community')">&#127758; Community (${mergeSelectedCommunity.size || ''})</button>
    <button class="community-tab-btn ${mergeTab==='custom'?'active':''}" onclick="mergeSetTab('custom')">&#128218; My Custom Quizzes (${mergeSelectedCustom.size || ''})</button>
    <button class="community-tab-btn ${mergeTab==='curriculum'?'active':''}" onclick="mergeSetTab('curriculum')">&#127973; Curriculum (${mergeSelectedCurriculum.size || ''})</button>
  </div>
  <div id="mergeTabContent" style="margin-top:10px;"></div>
  <div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border,#E0E0E0);
    display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
    <div id="mergeFooterCount" style="font-size:.85rem;font-weight:700;color:var(--text-muted);">
      ${total} question set${total !== 1 ? 's' : ''} selected
    </div>
    <div style="display:flex;gap:8px;">
      <button class="cq-btn cq-btn-secondary" onclick="closeMergePicker()">✖ Cancel</button>
      <button class="cq-btn" id="mergeConfirmBtn" ${!total ? 'disabled' : ''} onclick="confirmMergeSelectedQuizzes()">${total ? `🧩 Merge ${total} Selected` : '🧩 Merge Selected'}</button>
    </div>
  </div>`;

  body.innerHTML = html;
  renderMergeTabContent();
}

function renderMergeTabContent() {
  if (mergeTab === 'community') _mergeLoadCommunityTab();
  else if (mergeTab === 'custom') _renderMergeCustomTab();
  else _renderMergeCurriculumTab();
}

/* ── Community tab ── */
async function ensureSharedQuizzesLoaded(forceReload) {
  if (_allSharedQuizzes.length && !forceReload) return true;
  try {
    const serverVer = forceReload ? null : await _fetchSharedServerVersion();
    const localVer  = _readSharedCacheVer();
    const cached    = await _readCache();
    if (!forceReload && serverVer && localVer === serverVer && cached && cached.shared) {
      _allSharedQuizzes = cached.shared;
      return true;
    }
    const snap = await window._getDocs(window._collection(window._db, 'sharedQuizzes'));
    _allSharedQuizzes = [];
    snap.forEach(d => _allSharedQuizzes.push(d.data()));
    const existing = (await _readCache()) || {};
    existing.shared = _allSharedQuizzes;
    await _writeCache(existing);
    let verToStore = forceReload ? await _fetchSharedServerVersion() : serverVer;
    if (!verToStore) verToStore = await bumpSharedQuizzesVersion();
    if (verToStore) _writeSharedCacheVer(verToStore);
    return true;
  } catch (e) { return false; }
}

async function _mergeLoadCommunityTab() {
  const el = document.getElementById('mergeTabContent');
  if (!el) return;
  if (!window._currentUser) {
    el.innerHTML = `<div class="community-empty">Please sign in to browse community quizzes.</div>`;
    return;
  }
  if (!_allSharedQuizzes.length) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);"><div style="font-size:1.6rem;margin-bottom:8px;">&#8987;</div>Loading community quizzes…</div>`;
  }
  const ok = await ensureSharedQuizzesLoaded(false);
  if (mergeTab !== 'community') return; // user switched tabs while this was loading
  if (!ok) { el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--wrong-fg);">&#10060; Failed to load community quizzes.</div>`; return; }
  _renderMergeCommunityList();
}

function mergeCommOnSearchInput(val) {
  mergeCommSearch = val;
  window._mergeCommSearchFocused = true;
  const el = document.getElementById('mergeCommSearchInput');
  window._mergeCommSearchPos = el ? el.selectionStart : null;
  _renderMergeCommunityList();
}

function _renderMergeCommunityList() {
  const el = document.getElementById('mergeTabContent');
  if (!el) return;

  const myUid = window._currentUser ? window._currentUser.uid : null;
  const shared = _allSharedQuizzes;
  const myShared = shared.filter(q => q.authorUid === myUid);
  let pool = mergeCommTab === 'mine' ? myShared : shared;

  const q = mergeCommSearch.toLowerCase().trim();
  if (q) {
    pool = pool.filter(item => {
      const inTitle  = (item.title || '').toLowerCase().includes(q);
      const inAuthor = (item.authorName || '').toLowerCase().includes(q);
      const inCat    = (item.category || '').toLowerCase().includes(q);
      const inTags   = (item.tags || []).some(t => t.includes(q));
      return inTitle || inAuthor || inCat || inTags;
    });
  }
  if (mergeCommYearFilter)    pool = pool.filter(item => (item.year || '') === mergeCommYearFilter);
  if (mergeCommModuleFilter)  pool = pool.filter(item => (item.module || '') === mergeCommModuleFilter);
  if (mergeCommSubjectFilter) pool = pool.filter(item => (item.subjectKey || '') === mergeCommSubjectFilter);

  if (mergeCommSort === 'newest')    pool = [...pool].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  else if (mergeCommSort === 'oldest')    pool = [...pool].sort((a, b) => (a.sharedAt || 0) - (b.sharedAt || 0));
  else if (mergeCommSort === 'az')        pool = [...pool].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else if (mergeCommSort === 'questions') pool = [...pool].sort((a, b) => (b.questionCount || 0) - (a.questionCount || 0));

  const allYears   = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
  const allModules = mergeCommYearFilter
    ? Object.keys(curriculum[mergeCommYearFilter] || {})
    : [...new Set(shared.map(i => i.module).filter(Boolean))].sort();
  const allSubjects = (mergeCommYearFilter && mergeCommModuleFilter)
    ? (curriculum[mergeCommYearFilter][mergeCommModuleFilter] || []).filter(k => subjects[k])
    : [...new Set(shared.map(i => i.subjectKey).filter(Boolean))];

  const searchVal = escapeHtml(mergeCommSearch);

  let html = `
    <div class="community-section-tabs">
      <button class="community-tab-btn ${mergeCommTab === 'browse' ? 'active' : ''}" onclick="mergeCommTab='browse';mergeCommSearch='';mergeCommYearFilter='';mergeCommModuleFilter='';mergeCommSubjectFilter='';_renderMergeCommunityList()">&#127758; Browse All (${shared.length})</button>
      <button class="community-tab-btn ${mergeCommTab === 'mine' ? 'active' : ''}" onclick="mergeCommTab='mine';_renderMergeCommunityList()">&#128100; My Shared (${myShared.length})</button>
    </div>
    <div class="comm-filter-bar">
      <div class="comm-search-wrap">
        <span class="comm-search-icon">🔍</span>
        <input class="comm-search-input" id="mergeCommSearchInput" type="text"
               placeholder="Search by title, author, category or tag…"
               value="${searchVal}" oninput="mergeCommOnSearchInput(this.value)" />
      </div>
      <div class="comm-filter-row">
        <select class="comm-filter-select" onchange="mergeCommYearFilter=this.value;mergeCommModuleFilter='';mergeCommSubjectFilter='';_renderMergeCommunityList()">
          <option value="">All Years</option>
          ${allYears.map(y => `<option value="${escapeHtml(y)}" ${mergeCommYearFilter === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
        </select>
        <select class="comm-filter-select" onchange="mergeCommModuleFilter=this.value;mergeCommSubjectFilter='';_renderMergeCommunityList()" ${!mergeCommYearFilter ? 'disabled' : ''}>
          <option value="">All Modules</option>
          ${allModules.map(m => `<option value="${escapeHtml(m)}" ${mergeCommModuleFilter === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <select class="comm-filter-select" onchange="mergeCommSubjectFilter=this.value;_renderMergeCommunityList()" ${!mergeCommModuleFilter ? 'disabled' : ''}>
          <option value="">All Subjects</option>
          ${allSubjects.map(k => {
            const lbl = (subjects[k] && (subjects[k].label || k)) || k;
            const ico = (subjects[k] && subjects[k].icon) || '';
            return `<option value="${escapeHtml(k)}" ${mergeCommSubjectFilter === k ? 'selected' : ''}>${ico} ${escapeHtml(lbl)}</option>`;
          }).join('')}
        </select>
        <select class="comm-filter-select" onchange="mergeCommSort=this.value;_renderMergeCommunityList()">
          <option value="newest" ${mergeCommSort==='newest'?'selected':''}>🕐 Newest</option>
          <option value="oldest" ${mergeCommSort==='oldest'?'selected':''}>🕐 Oldest</option>
          <option value="az"     ${mergeCommSort==='az'?'selected':''}>🔤 A → Z</option>
          <option value="questions" ${mergeCommSort==='questions'?'selected':''}>📝 Most Questions</option>
        </select>
      </div>
      <div class="comm-results-count">${pool.length} quiz${pool.length !== 1 ? 'zes' : ''} shown</div>
    </div>`;

  if (!pool.length) {
    html += `<div class="community-empty">
      <div class="ce-icon">${mergeCommSearch || mergeCommYearFilter || mergeCommModuleFilter || mergeCommSubjectFilter ? '🔍' : '&#127758;'}</div>
      No quizzes match.
    </div>`;
  } else {
    pool.forEach(item => {
      const isOwn = item.authorUid === myUid;
      const date  = new Date(item.sharedAt).toLocaleDateString();
      const catBadge = (item.year || item.subjectLabel)
        ? `<span class="comm-cat-badge">${[item.year, item.module, item.subjectLabel].filter(Boolean).map(escapeHtml).join(' › ')}</span>`
        : (item.category ? `<span class="comm-cat-badge">${escapeHtml(item.category)}</span>` : '');
      const checked = mergeSelectedCommunity.has(item.id);
      html += `<div class="community-quiz-item">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
          <input type="checkbox" style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
            ${checked ? 'checked' : ''} onchange="mergeToggleCommunity('${escapeHtml(item.id)}', this.checked)" />
          <div style="flex:1;min-width:0;">
            <div class="community-quiz-title">${escapeHtml(item.title)}</div>
            <div class="community-quiz-meta">
              ${catBadge}
              ${item.questionCount} question${item.questionCount !== 1 ? 's' : ''}
              &nbsp;&middot;&nbsp; &#128100; ${escapeHtml(item.authorName)}
              ${isOwn ? ' <span class="share-chip">You</span>' : ''}
              &nbsp;&middot;&nbsp; &#128197; ${date}
            </div>
          </div>
        </label>
      </div>`;
    });
  }

  el.innerHTML = html;

  const searchEl = document.getElementById('mergeCommSearchInput');
  if (searchEl && document.activeElement !== searchEl && window._mergeCommSearchFocused) {
    const pos = window._mergeCommSearchPos || searchEl.value.length;
    searchEl.focus();
    try { searchEl.setSelectionRange(pos, pos); } catch(e) {}
    window._mergeCommSearchFocused = false;
  }
}

function mergeToggleCommunity(id, checked) {
  if (checked) mergeSelectedCommunity.add(id); else mergeSelectedCommunity.delete(id);
  _mergeUpdateFooter();
}

/* ── Custom quizzes tab ── */
function mergeCustomOnSearchInput(val) {
  mergeCustomSearch = val;
  _renderMergeCustomTab();
}

function _renderMergeCustomTab() {
  const el = document.getElementById('mergeTabContent');
  if (!el) return;

  // Can't merge a saved quiz into itself while editing it.
  const excludeId = (mergeEditorKey === 'customQuiz' && !cqCreatingNew) ? cqEditingQuizId : null;
  let quizzes = loadCustomQuizzes().filter(q => q.id !== excludeId && (q.questions || []).length);

  const s = mergeCustomSearch.toLowerCase().trim();
  if (s) quizzes = quizzes.filter(q => (q.title || '').toLowerCase().includes(s));

  let html = `<div class="comm-filter-bar">
    <div class="comm-search-wrap">
      <span class="comm-search-icon">🔍</span>
      <input class="comm-search-input" type="text" placeholder="Search your custom quizzes…"
             value="${escapeHtml(mergeCustomSearch)}" oninput="mergeCustomOnSearchInput(this.value)" />
    </div>
    <div class="comm-results-count">${quizzes.length} quiz${quizzes.length !== 1 ? 'zes' : ''} shown</div>
  </div>`;

  if (!quizzes.length) {
    html += `<div class="community-empty"><div class="ce-icon">📭</div>No custom quizzes to merge from.</div>`;
  } else {
    quizzes.forEach(q => {
      const checked = mergeSelectedCustom.has(q.id);
      html += `<div class="cq-quiz-item">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;flex:1;">
          <input type="checkbox" style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
            ${checked ? 'checked' : ''} onchange="mergeToggleCustom('${escapeHtml(q.id)}', this.checked)" />
          <div>
            <div class="cq-quiz-name">${escapeHtml(q.title)}</div>
            <div class="cq-quiz-meta">${q.questions.length} question${q.questions.length !== 1 ? 's' : ''} &middot; created ${new Date(q.createdAt).toLocaleDateString()}</div>
          </div>
        </label>
      </div>`;
    });
  }
  el.innerHTML = html;
}

function mergeToggleCustom(id, checked) {
  if (checked) mergeSelectedCustom.add(id); else mergeSelectedCustom.delete(id);
  _mergeUpdateFooter();
}

/* ── Curriculum tab ── */
function mergeOnYearChange(val) { mergeCurrYear = val; mergeCurrModule = ''; mergeCurrSubject = ''; _renderMergeCurriculumTab(); }
function mergeOnModuleChange(val) { mergeCurrModule = val; mergeCurrSubject = ''; _renderMergeCurriculumTab(); }
function mergeOnSubjectChange(val) { mergeCurrSubject = val; _renderMergeCurriculumTab(); }

function _renderMergeCurriculumTab() {
  const el = document.getElementById('mergeTabContent');
  if (!el) return;

  const years   = Object.keys(curriculum);
  const modules = mergeCurrYear ? Object.keys(curriculum[mergeCurrYear] || {}) : [];
  const subs    = (mergeCurrYear && mergeCurrModule) ? (curriculum[mergeCurrYear][mergeCurrModule] || []).filter(k => subjects[k]) : [];

  let html = `<div class="admin-field">
      <label>Year</label>
      <select onchange="mergeOnYearChange(this.value)">
        <option value="">— Select year —</option>
        ${years.map(y => `<option value="${escapeHtml(y)}" ${mergeCurrYear === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
      </select>
    </div>
    <div class="admin-field">
      <label>Module</label>
      <select onchange="mergeOnModuleChange(this.value)" ${!mergeCurrYear ? 'disabled' : ''}>
        <option value="">— Select module —</option>
        ${modules.map(m => `<option value="${escapeHtml(m)}" ${mergeCurrModule === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
      </select>
    </div>
    <div class="admin-field">
      <label>Subject</label>
      <select onchange="mergeOnSubjectChange(this.value)" ${!mergeCurrModule ? 'disabled' : ''}>
        <option value="">— Select subject —</option>
        ${subs.map(s => `<option value="${escapeHtml(s)}" ${mergeCurrSubject === s ? 'selected' : ''}>${escapeHtml(subjects[s].label || s)}</option>`).join('')}
      </select>
    </div>`;

  if (mergeCurrSubject && subjects[mergeCurrSubject]) {
    const lectures = Object.keys(subjects[mergeCurrSubject].lectures || {});
    if (!lectures.length) {
      html += `<div class="community-empty"><div class="ce-icon">📭</div>No lectures in this subject yet.</div>`;
    } else {
      lectures.forEach(lname => {
        const qCount = subjects[mergeCurrSubject].lectures[lname].length;
        const key = mergeCurrSubject + '::' + lname;
        const checked = mergeSelectedCurriculum.has(key);
        html += `<div class="cq-quiz-item">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;">
            <input type="checkbox" style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
              ${checked ? 'checked' : ''} onchange="mergeToggleCurriculum('${escapeHtml(key)}', this.checked)" />
            <div style="flex:1;">
              <div class="cq-quiz-name">${escapeHtml(lname)}</div>
            </div>
            <span style="font-size:.78rem;color:var(--accent);font-weight:700;">${qCount}q</span>
          </label>
        </div>`;
      });
    }
  } else {
    html += `<div class="community-empty"><div class="ce-icon">🏥</div>Select a year, module and subject to see its lectures.</div>`;
  }

  el.innerHTML = html;
}

function mergeToggleCurriculum(key, checked) {
  if (checked) mergeSelectedCurriculum.add(key); else mergeSelectedCurriculum.delete(key);
  _mergeUpdateFooter();
}

/* ── Perform the merge ── */
/* Deep-clones a source question list for merging into an editor, namespacing
   any case_group ids with a source-specific prefix so a case cluster from
   one merged-in quiz can never collide with one from another, and stripping
   image sentinels that only resolve against their original source collection
   (the actual image data, already hydrated into q.image, is kept). */
function _mergeCloneQuestions(rawQuestions, namespace, sourceLabel) {
  const qs = JSON.parse(JSON.stringify(rawQuestions || []));
  qs.forEach(q => {
    if (q.case_group) q.case_group = namespace + '::' + q.case_group;
    delete q.sharedImageIdx;
    delete q.pubImageIdx;
    // Merged-in questions came from a different quiz/source entirely, so
    // they have no valid position in *this* editor's source document.
    // Never offer Re-extract controls for them, and never let them count
    // toward the source-relative numbering used when re-extracting the
    // questions that actually did come from this session's source.
    q._notExtractable = true;
    // Transient — shows a "from: <quiz>" badge in the editor so it's obvious
    // which merged-in quiz a question came from before the merge is saved.
    // Stripped out by _stripEditorTransientFields right before saving.
    if (sourceLabel) q._mergeSourceLabel = sourceLabel;
  });
  return qs;
}

/* Small pill showing which merged-in quiz a question came from, while the
   merge is still unsaved. Nothing is rendered once the label is stripped
   at save time. */
function _renderMergeSourceBadge(q) {
  if (!q || !q._mergeSourceLabel) return '';
  return `<span title="Merged in from this quiz — not yet saved"
      style="background:#ECEFF1;color:#455A64;font-size:.68rem;font-weight:700;
        border-radius:20px;padding:2px 8px;white-space:nowrap;border:1.5px solid #B0BEC5;">
      🔀 ${escapeHtml(q._mergeSourceLabel)}</span>`;
}

/* Removes editor-only fields that should never be persisted, called right
   before a question set is written to storage. */
function _stripEditorTransientFields(questions) {
  (questions || []).forEach(q => { delete q._mergeSourceLabel; });
}

async function confirmMergeSelectedQuizzes() {
  const ed = mergeEditorKey && _caseGroupEditors[mergeEditorKey];
  const target = ed && ed.getQuestions();
  if (!ed || !target) { closeMergePicker(); return; }
  const total = _mergeTotalSelected();
  if (!total) return;

  const btn = document.getElementById('mergeConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Merging…'; }

  try {
    let appended = [];

    // Community-sourced quizzes: images may still need hydrating from the
    // shared subcollection (community list caches sentinels, not always the
    // raw base64) before they can live in the editor.
    for (const id of mergeSelectedCommunity) {
      const item = _allSharedQuizzes.find(q => q.id === id);
      if (!item || !item.questions) continue;
      const restored = restoreOptionsOrder(JSON.parse(JSON.stringify(item.questions)));
      await hydrateSharedQuizImages(id, restored);
      await hydrateQuizImages(restored);
      appended = appended.concat(_mergeCloneQuestions(restored, 'comm_' + id, item.title || 'Community quiz'));
    }

    // Saved custom quizzes are already hydrated in memory.
    const customQuizzes = loadCustomQuizzes();
    mergeSelectedCustom.forEach(id => {
      const quiz = customQuizzes.find(q => q.id === id);
      if (!quiz) return;
      appended = appended.concat(_mergeCloneQuestions(quiz.questions, quiz.id, quiz.title || 'Custom quiz'));
    });

    // Curriculum lectures are already hydrated in memory.
    mergeSelectedCurriculum.forEach(key => {
      const sep = key.indexOf('::');
      const subjectKey = key.slice(0, sep), lectureName = key.slice(sep + 2);
      const qs = subjects[subjectKey] && subjects[subjectKey].lectures && subjects[subjectKey].lectures[lectureName];
      if (!qs) return;
      appended = appended.concat(_mergeCloneQuestions(qs, 'curr_' + key, lectureName || 'Lecture'));
    });

    target.push(...appended);
    closeMergePicker();
    ed.rerender();
  } catch (e) {
    if (btn) { btn.disabled = false; }
    alert('Failed to merge quizzes: ' + (e.message || e));
    _mergeUpdateFooter();
  }
}

