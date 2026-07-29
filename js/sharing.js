/* ══════════════════════════════════════════════════════════
   SHARE CUSTOM QUIZ
══════════════════════════════════════════════════════════ */
// Share Quiz modal state
let _shareQuizResolve = null;
let _shareQuizId = null;

async function shareCustomQuiz(id) {
  if (!window._currentUser) {
    alert('Please sign in to share quizzes with the community.');
    return;
  }
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz) return;

  const displayName = await getOrPromptDisplayName();
  if (!displayName) return; // cancelled

  // Open share-quiz modal to collect category + tags
  const shareDetails = await openShareQuizModal(quiz.title);
  if (!shareDetails) return; // user cancelled

  try {
    const sharedId = 'sq_' + window._currentUser.uid + '_' + id;

    await hydrateQuizImages(quiz.questions);

    const questionsForUpload = JSON.parse(JSON.stringify(quiz.questions)).map(q => {
      if (q.imageUrl && q.imageUrl.startsWith('firestore://')) delete q.imageUrl;
      return q;
    });

    const { putContentItem } = await import('./content-client.js');
    await putContentItem('community', null, sharedId, {
      id: sharedId,
      originalId: id,
      title: quiz.title,
      questions: questionsForUpload,
      authorUid: window._currentUser.uid, // enforced/overridden server-side by the Worker regardless — see index.js
      authorName: displayName,
      sharedAt: Date.now(),
      questionCount: quiz.questions.length,
      category: shareDetails.category || '',
      year: shareDetails.year || '',
      module: shareDetails.module || '',
      subjectKey: shareDetails.subjectKey || '',
      subjectLabel: shareDetails.subjectLabel || '',
      tags: shareDetails.tags || []
    });

    quiz.sharedAt = Date.now();
    await saveCustomQuizzesList(quizzes);
    _allSharedQuizzes = []; // invalidate in-memory cache so community list refreshes on next open
    renderCustomQuizModal();

    const statusEl = document.getElementById('cqStatus');
    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">&#127758; "${escapeHtml(quiz.title)}" shared with the community!</div>`;
  } catch(e) {
    alert('Failed to share quiz: ' + (e.message || e));
  }
}

function openShareQuizModal(quizTitle) {
  return new Promise(resolve => {
    _shareQuizResolve = resolve;
    document.getElementById('sqQuizName').textContent = quizTitle;
    document.getElementById('sqTags').value = '';

    // Populate Year dropdown from live curriculum object
    const yearSel = document.getElementById('sqYear');
    const modSel  = document.getElementById('sqModule');
    const subjSel = document.getElementById('sqSubject');

    const years = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
    yearSel.innerHTML = '<option value="">— Select a year —</option>' +
      years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    yearSel.value = '';
    modSel.innerHTML = '<option value="">— Select a module —</option>';
    modSel.disabled = true;
    subjSel.innerHTML = '<option value="">— Select a subject —</option>';
    subjSel.disabled = true;

    document.getElementById('shareQuizOverlay').classList.remove('hidden');
    setTimeout(() => yearSel.focus(), 50);
  });
}

function sqOnYearChange(year) {
  const modSel  = document.getElementById('sqModule');
  const subjSel = document.getElementById('sqSubject');
  modSel.innerHTML = '<option value="">— Select a module —</option>';
  subjSel.innerHTML = '<option value="">— Select a subject —</option>';
  subjSel.disabled = true;
  if (!year) { modSel.disabled = true; return; }
  const mods = Object.keys(curriculum[year] || {});
  modSel.innerHTML += mods.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  modSel.disabled = false;
  modSel.value = '';
}

function sqOnModuleChange(mod) {
  const year    = document.getElementById('sqYear').value;
  const subjSel = document.getElementById('sqSubject');
  subjSel.innerHTML = '<option value="">— Select a subject —</option>';
  if (!year || !mod) { subjSel.disabled = true; return; }
  const keys = (curriculum[year][mod] || []).filter(k => subjects[k]);
  subjSel.innerHTML += keys.map(k => {
    const label = subjects[k].label || k;
    const icon  = subjects[k].icon  || '';
    return `<option value="${escapeHtml(k)}">${icon} ${escapeHtml(label)}</option>`;
  }).join('');
  subjSel.disabled = false;
  subjSel.value = '';
}

function confirmShareQuiz() {
  const year     = document.getElementById('sqYear').value.trim();
  const mod      = document.getElementById('sqModule').value.trim();
  const subjKey  = document.getElementById('sqSubject').value.trim();
  const rawTags  = document.getElementById('sqTags').value;
  const tags = rawTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

  if (!year || !mod || !subjKey) {
    alert('Please select a Year, Module, and Subject before sharing.');
    return;
  }

  const subjLabel = (subjects[subjKey] && (subjects[subjKey].label || subjKey)) || subjKey;
  document.getElementById('shareQuizOverlay').classList.add('hidden');
  if (_shareQuizResolve) {
    _shareQuizResolve({
      year, module: mod, subjectKey: subjKey, subjectLabel: subjLabel,
      // flat category string for backwards-compatible search/display
      category: `${year} › ${mod} › ${subjLabel}`,
      tags
    });
    _shareQuizResolve = null;
  }
}

function cancelShareQuiz() {
  document.getElementById('shareQuizOverlay').classList.add('hidden');
  if (_shareQuizResolve) { _shareQuizResolve(null); _shareQuizResolve = null; }
}

/* ── Restore options object from optionsOrder array (set by shareCustomQuiz) ── */
function restoreOptionsOrder(questions) {
  return questions.map(q => {
    if (!Array.isArray(q.optionsOrder) || !q.optionsOrder.length) return q;
    const opts = {};
    q.optionsOrder.forEach(({ key, value }) => { opts[key] = value; });
    const { optionsOrder, ...rest } = q;
    return { ...rest, options: opts };
  });
}

/* ══════════════════════════════════════════════════════════
   COMMUNITY QUIZZES MODAL
══════════════════════════════════════════════════════════ */
let communityTab = 'browse'; // 'browse' | 'mine'
let communitySearchQuery = '';
let communityYearFilter    = '';
let communityModuleFilter  = '';
let communitySubjectFilter = '';
let communitySort = 'newest';
let _allSharedQuizzes = []; // cache for client-side filtering

function openCommunityQuizzes() {
  if (!window._currentUser) {
    alert('Please sign in to access Community Quizzes.');
    return;
  }
  communityTab = 'browse';
  communitySearchQuery = '';
  communityYearFilter    = '';
  communityModuleFilter  = '';
  communitySubjectFilter = '';
  communitySort = 'newest';
  document.getElementById('communityQuizOverlay').classList.remove('hidden');
  renderCommunityQuizzes();
}

function closeCommunityQuizzes() {
  document.getElementById('communityQuizOverlay').classList.add('hidden');
  fsLoadingHide();
}

function communityOnSearchInput(val) {
  communitySearchQuery = val;
  document.getElementById('commClearBtn').style.display = val ? 'block' : 'none';
  window._commSearchFocused = true;
  const el = document.getElementById('commSearchInput');
  window._commSearchPos = el ? el.selectionStart : null;
  renderCommunityQuizzes();
}

async function renderCommunityQuizzes(forceReload) {
  const body = document.getElementById('communityQuizBody');

  // Only fetch when opening fresh or forced — ensureSharedQuizzesLoaded
  // (js/community-quizzes.js) does the actual per-quiz granular caching;
  // this used to be a SEPARATE, duplicate copy of that same logic (with
  // the old single-global-version bug) — removed in favor of the one,
  // already-fixed implementation, so there's no risk of the two drifting
  // out of sync with each other again.
  if (!_allSharedQuizzes.length || forceReload) {
    body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);"><div style="font-size:2rem;margin-bottom:10px;">&#8987;</div><div style="font-weight:700;">Loading community quizzes…</div></div>`;
    const ok = await ensureSharedQuizzesLoaded(forceReload);
    if (!ok) {
      body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--wrong-fg);">&#10060; Failed to load community quizzes. Please try again.</div>`;
      return;
    }
  } else {
    console.log('[cache] community quizzes hit, skipping fetch');
  }

  const myUid = window._currentUser ? window._currentUser.uid : null;
  const shared = _allSharedQuizzes;
  const myShared = shared.filter(q => q.authorUid === myUid);

  // --- Filtering ---
  let pool = communityTab === 'mine' ? myShared : shared;

  // Search
  const q = communitySearchQuery.toLowerCase().trim();
  if (q) {
    pool = pool.filter(item => {
      const inTitle  = (item.title || '').toLowerCase().includes(q);
      const inAuthor = (item.authorName || '').toLowerCase().includes(q);
      const inCat   = (item.category || '').toLowerCase().includes(q);
      const inTags  = (item.tags || []).some(t => t.includes(q));
      return inTitle || inAuthor || inCat || inTags;
    });
  }

  // Hierarchical curriculum filter
  if (communityYearFilter) {
    pool = pool.filter(item => (item.year || '') === communityYearFilter);
  }
  if (communityModuleFilter) {
    pool = pool.filter(item => (item.module || '') === communityModuleFilter);
  }
  if (communitySubjectFilter) {
    pool = pool.filter(item => (item.subjectKey || '') === communitySubjectFilter);
  }

  // Sorting
  if (communitySort === 'newest') {
    pool = [...pool].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  } else if (communitySort === 'oldest') {
    pool = [...pool].sort((a, b) => (a.sharedAt || 0) - (b.sharedAt || 0));
  } else if (communitySort === 'az') {
    pool = [...pool].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (communitySort === 'questions') {
    pool = [...pool].sort((a, b) => (b.questionCount || 0) - (a.questionCount || 0));
  }

  // Build cascading filter options from live curriculum + shared quiz metadata
  const allYears   = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
  const allModules = communityYearFilter
    ? Object.keys(curriculum[communityYearFilter] || {})
    : [...new Set(shared.map(i => i.module).filter(Boolean))].sort();
  const allSubjects = (communityYearFilter && communityModuleFilter)
    ? (curriculum[communityYearFilter][communityModuleFilter] || []).filter(k => subjects[k])
    : [...new Set(shared.map(i => i.subjectKey).filter(Boolean))];

  // --- Build HTML ---
  const searchVal = escapeHtml(communitySearchQuery);
  const clearStyle = communitySearchQuery ? 'display:block' : 'display:none';

  let html = `
    <div class="community-section-tabs">
      <button class="community-tab-btn ${communityTab === 'browse' ? 'active' : ''}" onclick="communityTab='browse';communitySearchQuery='';communityYearFilter='';communityModuleFilter='';communitySubjectFilter='';renderCommunityQuizzes()">&#127758; Browse All (${shared.length})</button>
      <button class="community-tab-btn ${communityTab === 'mine' ? 'active' : ''}" onclick="communityTab='mine';renderCommunityQuizzes()">&#128100; My Shared (${myShared.length})</button>
    </div>

    <div class="comm-filter-bar">
      <div class="comm-search-wrap">
        <span class="comm-search-icon">🔍</span>
        <input class="comm-search-input" id="commSearchInput" type="text"
               placeholder="Search by title, author, category or tag…"
               value="${searchVal}"
               oninput="communityOnSearchInput(this.value)" />
        <button class="comm-search-clear" id="commClearBtn" style="${clearStyle}"
                onclick="communitySearchQuery='';document.getElementById('commSearchInput').value='';this.style.display='none';renderCommunityQuizzes()">✕</button>
      </div>
      <div class="comm-filter-row">
        <select class="comm-filter-select" id="commYearFilter"
                onchange="communityYearFilter=this.value;communityModuleFilter='';communitySubjectFilter='';renderCommunityQuizzes()">
          <option value="">All Years</option>
          ${allYears.map(y => `<option value="${escapeHtml(y)}" ${communityYearFilter === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
        </select>
        <select class="comm-filter-select" id="commModuleFilter"
                onchange="communityModuleFilter=this.value;communitySubjectFilter='';renderCommunityQuizzes()"
                ${!communityYearFilter ? 'disabled' : ''}>
          <option value="">All Modules</option>
          ${allModules.map(m => `<option value="${escapeHtml(m)}" ${communityModuleFilter === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <select class="comm-filter-select" id="commSubjectFilter"
                onchange="communitySubjectFilter=this.value;renderCommunityQuizzes()"
                ${!communityModuleFilter ? 'disabled' : ''}>
          <option value="">All Subjects</option>
          ${allSubjects.map(k => {
            const lbl = (subjects[k] && (subjects[k].label || k)) || k;
            const ico = (subjects[k] && subjects[k].icon) || '';
            return `<option value="${escapeHtml(k)}" ${communitySubjectFilter === k ? 'selected' : ''}>${ico} ${escapeHtml(lbl)}</option>`;
          }).join('')}
        </select>
        <select class="comm-filter-select" id="commSortSelect"
                onchange="communitySort=this.value;renderCommunityQuizzes()">
          <option value="newest" ${communitySort==='newest'?'selected':''}>🕐 Newest</option>
          <option value="oldest" ${communitySort==='oldest'?'selected':''}>🕐 Oldest</option>
          <option value="az"     ${communitySort==='az'?'selected':''}>🔤 A → Z</option>
          <option value="questions" ${communitySort==='questions'?'selected':''}>📝 Most Questions</option>
        </select>
      </div>
      <div class="comm-results-count">${pool.length} quiz${pool.length !== 1 ? 'zes' : ''} shown</div>
    </div>`;

  if (!pool.length) {
    html += `<div class="community-empty">
      <div class="ce-icon">${communitySearchQuery || communityYearFilter || communityModuleFilter || communitySubjectFilter ? '🔍' : (communityTab === 'mine' ? '&#128100;' : '&#127758;')}</div>
      ${communitySearchQuery || communityYearFilter || communityModuleFilter || communitySubjectFilter
        ? 'No quizzes match your search. Try different keywords or clear the filters.'
        : communityTab === 'mine'
          ? 'You haven\'t shared any quizzes yet. Create one and tap the &#128279; Share button!'
          : 'No community quizzes yet — be the first to share one!'}
    </div>`;
  } else {
    const _communityQuizzesCache = [];

    pool.forEach((item, idx) => {
      _communityQuizzesCache[idx] = item;
      const isOwn = item.authorUid === myUid;
      const date  = new Date(item.sharedAt).toLocaleDateString();
      // Legacy/migrated items may be missing questionCount; fall back to
      // the actual questions array, then to 0, so Math.max() below can
      // never receive NaN (which the browser rejects on a number input's
      // value attribute and logs a console warning for on every render).
      const qCount = Number.isFinite(item.questionCount)
        ? item.questionCount
        : (Array.isArray(item.questions) ? item.questions.length : 0);
      const catBadge = (item.year || item.subjectLabel)
        ? `<span class="comm-cat-badge">${[item.year, item.module, item.subjectLabel].filter(Boolean).map(escapeHtml).join(' › ')}</span>`
        : (item.category ? `<span class="comm-cat-badge">${escapeHtml(item.category)}</span>` : '');
      const tagsHtml = (item.tags && item.tags.length)
        ? `<div class="comm-tags-row">${item.tags.map(t =>
            `<span class="comm-tag" onclick="communitySearchQuery='${escapeHtml(t)}';renderCommunityQuizzes()" title="Filter by tag">#${escapeHtml(t)}</span>`
          ).join('')}</div>` : '';

      html += `<div class="community-quiz-item">
        <div class="community-quiz-header">
          <div style="flex:1;min-width:0;">
            <div class="community-quiz-title">${escapeHtml(item.title)}</div>
            <div class="community-quiz-meta">
              ${catBadge}
              ${qCount} question${qCount !== 1 ? 's' : ''}
              &nbsp;&middot;&nbsp; &#128100; ${escapeHtml(item.authorName)}
              ${isOwn ? ' <span class="share-chip">You</span>' : ''}
              &nbsp;&middot;&nbsp; &#128197; ${date}
            </div>
            ${tagsHtml}
          </div>
        </div>
        <div class="community-quiz-actions">
          <input type="number" id="cqCommMins_${idx}" value="${Math.max(5, qCount)}" min="1" max="180" title="Duration (minutes)" style="width:64px;padding:7px 8px;border:1.5px solid var(--border-soft);border-radius:6px;font-family:var(--font);font-size:.82rem;background:var(--surface-2);color:var(--text-main);" />
          <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;font-weight:700;color:var(--text-muted);cursor:pointer;">
            <input type="checkbox" id="cqCommShuffle_${idx}" style="width:14px;height:14px;accent-color:var(--accent);" /> &#128256;
          </label>
          <button class="cq-btn" onclick="startCommunityQuizByIdx(${idx})">&#9654; Start</button>
          <button class="cq-save-mine-btn" onclick="importCommunityQuiz('${escapeHtml(item.id)}')">&#128229; Save to Mine</button>
          ${isOwn ? `<button class="cq-btn cq-btn-danger" onclick="deleteCommunityQuiz('${escapeHtml(item.id)}')">&#128465; Unshare</button>` : ''}
        </div>
      </div>`;
    });

    window._commQuizCache = _communityQuizzesCache;
  }

  body.innerHTML = html;

  // Restore search input focus/caret if user was typing
  const searchEl = document.getElementById('commSearchInput');
  if (searchEl && document.activeElement !== searchEl && window._commSearchFocused) {
    const pos = window._commSearchPos || searchEl.value.length;
    searchEl.focus();
    try { searchEl.setSelectionRange(pos, pos); } catch(e) {}
    window._commSearchFocused = false;
  }
}

async function startCommunityQuizByIdx(idx) {
  const quiz = (window._commQuizCache || [])[idx];
  if (!quiz || !quiz.questions || !quiz.questions.length) return;

  const minsInput    = document.getElementById('cqCommMins_' + idx);
  const shuffleInput = document.getElementById('cqCommShuffle_' + idx);
  let mins = minsInput ? parseInt(minsInput.value, 10) : NaN;
  if (!mins || mins <= 0) mins = Math.max(5, quiz.questions.length);
  const shuffle = shuffleInput ? shuffleInput.checked : false;

  let combined = restoreOptionsOrder(JSON.parse(JSON.stringify(quiz.questions)));
  // Hydrate images: new quizzes use the shared subcollection (sharedImageIdx sentinel);
  // legacy quizzes may have inline base64 or Storage URLs.
  await hydrateSharedQuizImages(quiz.id, combined);
  await hydrateQuizImages(combined); // handles any legacy Storage URLs still present
  // Always pass through the group-aware layout — see the matching comment
  // in app-core.js's startQuiz() for why this runs even when shuffle is off.
  combined = _cqGroupAwareOrder(combined, shuffle);

  selectedSubject  = 'Community Quizzes';
  currentLecture   = quiz.title + ' (by ' + quiz.authorName + ')';
  currentQuestions = combined;
  currentIndex = 0; userAnswers = {}; markedSet = new Set();
  questionTimes = {}; correctToWrong = 0; wrongToCorrect = 0; changeLog = [];
  timeLeft = mins * 60;
  currentQuizSource = 'community';
  // No Year/Module for a community quiz — grouped under its own bucket in
  // Statistics instead of the curriculum tree; see buildCurriculumStatsTree()
  // in app-core.js.
  currentQuizYear = ''; currentQuizModule = ''; currentQuizComponents = null;

  closeCommunityQuizzes();
  showScreen('quiz');
  renderQuestion();
  startTimer();
}

async function importCommunityQuiz(sharedId) {
  if (!window._currentUser) {
    alert('Please sign in to save quizzes.');
    return;
  }
  // Find the quiz from R2 (already-resolved images, no separate hydrate needed)
  try {
    const { getCommunityQuiz } = await import('./content-client.js');
    const q = await getCommunityQuiz(sharedId);
    if (!q) { alert('Quiz not found.'); return; }

    const quizzes = loadCustomQuizzes();
    // Avoid duplicates
    const alreadyExists = quizzes.some(cq => cq.originalSharedId === sharedId);
    if (alreadyExists) { alert('You already have this quiz saved.'); return; }

    const importedQuestions = restoreOptionsOrder(q.questions);
    await hydrateQuizImages(importedQuestions); // resolves any legacy Storage-URL images only; R2 images are already real URLs

    // A community quiz's images live at community/{sharedId}/images/... in
    // R2, kept alive only by that share's own image refcount — if the
    // original share is later deleted, that refcount drops to zero and the
    // image is deleted for good, breaking any saved copy still pointing at
    // it. So this isn't a fully independent copy just because the question
    // text has been cloned into this user's own quiz list: the images
    // still point straight back at the community post. Pull every
    // still-remote image down into a real local data URL first, exactly
    // like any other custom-quiz question image (inline in IndexedDB, never
    // a remote reference) — that's what actually makes this copy survive
    // the original share being edited or deleted later.
    await downloadRemoteQuizImages(importedQuestions);

    quizzes.unshift({
      id: 'cq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      title: q.title + ' (Community)',
      questions: importedQuestions,
      createdAt: Date.now(),
      originalSharedId: sharedId,
      importedFrom: q.authorName,
      collectionId: _cqTargetCollectionId(null)
    });
    await saveCustomQuizzesList(quizzes);
    alert(`"${q.title}" saved to your Custom Quizzes!`);
  } catch(e) {
    alert('Failed to import quiz: ' + (e.message || e));
  }
}

async function deleteCommunityQuiz(sharedId) {
  if (!window._currentUser) return;
  if (!confirm('Remove this quiz from the community? Other users won\'t be able to find it anymore.')) return;
  try {
    const { getCommunityQuiz, deleteContentItem } = await import('./content-client.js');
    const q = await getCommunityQuiz(sharedId, { skipThrottle: true });
    if (q && q.authorUid !== window._currentUser.uid) {
      alert('You can only remove your own shared quizzes.');
      return;
    }
    // Deletes the content AND releases its images' refcounts (deleting the
    // actual R2 image only if nothing else — e.g. a student's already-saved
    // custom-quiz copy — still needs it; but per the design, saved copies
    // are full independent copies, so this only ever protects against a
    // rare identical-image-reused-elsewhere case, same as curriculum).
    await deleteContentItem('community', null, sharedId);

    // Clear sharedAt from local quiz cache
    const quizzes = loadCustomQuizzes();
    const localQuiz = quizzes.find(q => 'sq_' + window._currentUser.uid + '_' + q.id === sharedId);
    if (localQuiz) { delete localQuiz.sharedAt; await saveCustomQuizzesList(quizzes); }

    // Invalidate in-memory cache so the community list refreshes fresh
    _allSharedQuizzes = [];
    renderCommunityQuizzes(true);
    renderCustomQuizModal();
  } catch(e) {
    alert('Failed to remove quiz: ' + (e.message || e));
  }
}

