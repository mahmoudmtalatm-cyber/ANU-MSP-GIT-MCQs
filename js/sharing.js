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
    await ensureInlineImages(questionsForUpload); // no-op in practice — local custom quizzes are already inline

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
    if (statusEl) statusEl.innerHTML = `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg> "${escapeHtml(quiz.title)}" shared with the community!</div>`;
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
    const modSel = document.getElementById('sqModule');
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
  const modSel = document.getElementById('sqModule');
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
  const year = document.getElementById('sqYear').value;
  const subjSel = document.getElementById('sqSubject');
  subjSel.innerHTML = '<option value="">— Select a subject —</option>';
  if (!year || !mod) { subjSel.disabled = true; return; }
  const keys = (curriculum[year][mod] || []).filter(k => subjects[k]);
  subjSel.innerHTML += keys.map(k => {
    const label = subjects[k].label || k;
    const icon = subjects[k].icon || '';
    return `<option value="${escapeHtml(k)}">${icon} ${escapeHtml(label)}</option>`;
  }).join('');
  subjSel.disabled = false;
  subjSel.value = '';
}

function confirmShareQuiz() {
  const year = document.getElementById('sqYear').value.trim();
  const mod = document.getElementById('sqModule').value.trim();
  const subjKey = document.getElementById('sqSubject').value.trim();
  const rawTags = document.getElementById('sqTags').value;
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
let communityYearFilter = '';
let communityModuleFilter = '';
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
  communityYearFilter = '';
  communityModuleFilter = '';
  communitySubjectFilter = '';
  communitySort = 'newest';
  document.getElementById('communityQuizOverlay').classList.remove('hidden');
  renderCommunityQuizzes();
}

function closeCommunityQuizzes() {
  document.getElementById('communityQuizOverlay').classList.add('hidden');
  fsLoadingHide();
}

// Typing in the search box only ever needs the results list (and its
// count) refreshed — the tabs and the rest of the filter bar don't
// depend on the search text at all. Routing it through this instead of
// a full renderCommunityQuizzes() means the search <input> itself is
// never touched while the person is typing into it, so focus, caret
// position, and (on mobile) the on-screen keyboard all just stay put.
function communityOnSearchInput(val) {
  communitySearchQuery = val;
  const clearBtn = document.getElementById('commClearBtn');
  if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
  _renderCommunityResultsOnly();
}

// For search changes that happen programmatically rather than by typing
// (a tag click, the clear button) — updates the input's own value too,
// since there's no live keystroke already doing that for us.
function communitySetSearch(val) {
  communitySearchQuery = val;
  const input = document.getElementById('commSearchInput');
  if (input) input.value = val;
  const clearBtn = document.getElementById('commClearBtn');
  if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
  _renderCommunityResultsOnly();
}

/* Pure filter + sort + derived-filter-options computation, shared between
   the main " Community Quizzes" screen (renderCommunityQuizzes, right
   below) and the Export to PDF picker's Community tab
   (js/pdf-export.js) — both browse the exact same underlying
   _allSharedQuizzes cache with the exact same search/year/module/subject/
   sort behavior; only the per-item action buttons differ (Start/Save/
   Unshare over there vs. a select-for-export checkbox here), so only the
   markup for those buttons is duplicated, never the filtering logic
   itself. No DOM access, no state mutation — safe to call from anywhere. */
function _communityComputeView({ scope, search, yearFilter, moduleFilter, subjectFilter, sort }) {
  const myUid = window._currentUser ? window._currentUser.uid : null;
  const shared = _allSharedQuizzes;
  const myShared = shared.filter(q => q.authorUid === myUid);

  let pool = scope === 'mine' ? myShared : shared;

  const q = (search || '').toLowerCase().trim();
  if (q) {
    pool = pool.filter(item => {
      const inTitle = (item.title || '').toLowerCase().includes(q);
      const inAuthor = (item.authorName || '').toLowerCase().includes(q);
      const inCat = (item.category || '').toLowerCase().includes(q);
      const inTags = (item.tags || []).some(t => t.includes(q));
      return inTitle || inAuthor || inCat || inTags;
    });
  }
  if (yearFilter) pool = pool.filter(item => (item.year || '') === yearFilter);
  if (moduleFilter) pool = pool.filter(item => (item.module || '') === moduleFilter);
  if (subjectFilter) pool = pool.filter(item => (item.subjectKey || '') === subjectFilter);

  if (sort === 'newest') pool = [...pool].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  else if (sort === 'oldest') pool = [...pool].sort((a, b) => (a.sharedAt || 0) - (b.sharedAt || 0));
  else if (sort === 'az') pool = [...pool].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else if (sort === 'questions') pool = [...pool].sort((a, b) => (b.questionCount || 0) - (a.questionCount || 0));

  const allYears = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
  const allModules = yearFilter
    ? Object.keys(curriculum[yearFilter] || {})
    : [...new Set(shared.map(i => i.module).filter(Boolean))].sort();
  const allSubjects = (yearFilter && moduleFilter)
    ? (curriculum[yearFilter][moduleFilter] || []).filter(k => subjects[k])
    : [...new Set(shared.map(i => i.subjectKey).filter(Boolean))];

  return { pool, shared, myShared, allYears, allModules, allSubjects };
}

// Builds just the result items (or the empty-state block) for the given
// pool — shared between the full render (tab/filter changes) and the
// results-only render (search keystrokes) so the two can never drift
// apart. Also (re)populates window._commQuizCache, which the Start
// button's startCommunityQuizByIdx(idx) looks items up from by index.
function _communityBuildListHtml(pool, myUid) {
  if (!pool.length) {
    const filtered = communitySearchQuery || communityYearFilter || communityModuleFilter || communitySubjectFilter;
    return `<div class="community-empty">
      <div class="ce-icon">${filtered ? '' : (communityTab === 'mine' ? '<svg class="hicon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' : '<svg class="hicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>')}</div>
      ${filtered
        ? 'No quizzes match your search. Try different keywords or clear the filters.'
        : communityTab === 'mine'
          ? 'You haven\'t shared any quizzes yet. Create one and tap the Share button!'
          : 'No community quizzes yet — be the first to share one!'}
    </div>`;
  }

  const _communityQuizzesCache = [];
  let html = '';

  pool.forEach((item, idx) => {
    _communityQuizzesCache[idx] = item;
    const isOwn = item.authorUid === myUid;
    const date = new Date(item.sharedAt).toLocaleDateString();
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
          `<span class="comm-tag" onclick="communitySetSearch('${escapeHtml(t)}')" title="Filter by tag">#${escapeHtml(t)}</span>`
        ).join('')}</div>` : '';

    html += `<div class="community-quiz-item">
      <div class="community-quiz-header">
        <div style="flex:1;min-width:0;">
          <div class="community-quiz-title">${escapeHtml(item.title)}</div>
          <div class="community-quiz-meta">
            ${catBadge}
            ${qCount} question${qCount !== 1 ? 's' : ''}
            &nbsp;&middot;&nbsp; <svg class="sicon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(item.authorName)}
            ${isOwn ? ' <span class="share-chip">You</span>' : ''}
            &nbsp;&middot;&nbsp; <svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${date}
          </div>
          ${tagsHtml}
        </div>
      </div>
      <div class="community-quiz-actions">
        <input type="number" id="cqCommMins_${idx}" value="${Math.max(5, qCount)}" min="1" max="180" title="Duration (minutes)" style="width:64px;padding:7px 8px;border:1.5px solid var(--border-soft);border-radius:6px;font-family:var(--font);font-size:.82rem;background:var(--surface-2);color:var(--text-main);" />
        <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;font-weight:700;color:var(--text-muted);cursor:pointer;">
          <input type="checkbox" id="cqCommShuffle_${idx}" style="width:14px;height:14px;accent-color:var(--accent);" /> <svg class="sicon" viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
        </label>
        <button class="cq-btn" onclick="startCommunityQuizByIdx(${idx})"><svg class="sicon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start</button>
        <button class="cq-save-mine-btn" onclick="importCommunityQuiz('${escapeHtml(item.id)}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save to Mine</button>
        ${isOwn ? `<button class="cq-btn cq-btn-danger" onclick="deleteCommunityQuiz('${escapeHtml(item.id)}')"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Unshare</button>` : ''}
      </div>
    </div>`;
  });

  window._commQuizCache = _communityQuizzesCache;
  return html;
}

// The light path: recomputes the filtered pool and rewrites only the
// results list + its count. Used for every search keystroke — see the
// comment on _commRenderResults (js/dom-utils.js) for why that matters.
function _renderCommunityResultsOnly() {
  const myUid = window._currentUser ? window._currentUser.uid : null;
  const { pool } = _communityComputeView({
    scope: communityTab, search: communitySearchQuery,
    yearFilter: communityYearFilter, moduleFilter: communityModuleFilter, subjectFilter: communitySubjectFilter,
    sort: communitySort,
  });
  _commRenderResults({
    idPrefix: 'comm',
    listContainerId: 'communityQuizList',
    resultCount: pool.length,
    listHtml: _communityBuildListHtml(pool, myUid),
  });
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
    body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);"><div style="margin-bottom:10px;display:flex;justify-content:center;color:var(--text-muted);"><svg class="hicon" style="width:32px;height:32px;" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></div><div style="font-weight:700;">Loading community quizzes…</div></div>`;
    const ok = await ensureSharedQuizzesLoaded(forceReload);
    if (!ok) {
      body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--wrong-fg);"><svg class="micon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Failed to load community quizzes. Please try again.</div>`;
      return;
    }
  } else {
    console.log('[cache] community quizzes hit, skipping fetch');
  }

  const myUid = window._currentUser ? window._currentUser.uid : null;
  const { pool, shared, myShared, allYears, allModules, allSubjects } = _communityComputeView({
    scope: communityTab, search: communitySearchQuery,
    yearFilter: communityYearFilter, moduleFilter: communityModuleFilter, subjectFilter: communitySubjectFilter,
    sort: communitySort,
  });

  // --- Build the chrome (tabs + filter bar) and a stable list container.
  // This full rebuild only ever runs on structural changes — opening the
  // modal, switching tabs, or changing a dropdown — never on a search
  // keystroke (see communityOnSearchInput / _renderCommunityResultsOnly
  // above), so the search <input> itself stays alive and focused while
  // someone types into it.
  const html = `
    <div class="community-section-tabs">
      <button class="community-tab-btn ${communityTab === 'browse' ? 'active' : ''}" onclick="communityTab='browse';communitySearchQuery='';communityYearFilter='';communityModuleFilter='';communitySubjectFilter='';renderCommunityQuizzes()"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg> Browse All (${shared.length})</button>
      <button class="community-tab-btn ${communityTab === 'mine' ? 'active' : ''}" onclick="communityTab='mine';renderCommunityQuizzes()"><svg class="sicon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> My Shared (${myShared.length})</button>
    </div>
    ${_buildCommFilterBarHTML({
      idPrefix: 'comm',
      searchVal: communitySearchQuery,
      searchOninput: 'communityOnSearchInput(this.value)',
      clearOnclick: "communitySetSearch('')",
      yearVal: communityYearFilter,
      yearOnchange: "communityYearFilter=this.value;communityModuleFilter='';communitySubjectFilter='';renderCommunityQuizzes()",
      allYears,
      moduleVal: communityModuleFilter,
      moduleOnchange: "communityModuleFilter=this.value;communitySubjectFilter='';renderCommunityQuizzes()",
      moduleDisabled: !communityYearFilter,
      allModules,
      subjectVal: communitySubjectFilter,
      subjectOnchange: 'communitySubjectFilter=this.value;renderCommunityQuizzes()',
      subjectDisabled: !communityModuleFilter,
      allSubjects,
      sortVal: communitySort,
      sortOnchange: 'communitySort=this.value;renderCommunityQuizzes()',
      resultCount: pool.length
    })}
    <div id="communityQuizList">${_communityBuildListHtml(pool, myUid)}</div>`;

  body.innerHTML = html;
}

async function startCommunityQuizByIdx(idx) {
  const quiz = (window._commQuizCache || [])[idx];
  if (!quiz || !quiz.questions || !quiz.questions.length) return;

  const minsInput = document.getElementById('cqCommMins_' + idx);
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

  selectedSubject = 'Community Quizzes';
  currentLecture = quiz.title + ' (by ' + quiz.authorName + ')';
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
    await hydrateQuizImages(importedQuestions); // resolves any legacy Storage-URL images only; new images are already inline

    // Under the current architecture, a community quiz's images are
    // written INLINE (a data: URL right on the question) — so in the
    // normal case there's nothing left to do here. This only does real
    // work for a quiz that predates that change and still has a question
    // pointing at a separately-hosted image URL; pulling that down into a
    // real local data URL now (same as any other custom-quiz question
    // image — inline in IndexedDB, never a remote reference) is what
    // makes this saved copy independent of wherever that old URL pointed,
    // in case it's ever removed.
    await ensureInlineImages(importedQuestions);

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
    // Deletes the content — its images are inline in the JSON itself, so
    // they're removed along with everything else, nothing separate to clean up.
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