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
let mergeEditorKey = null; // 'cq' | 'admin' | 'customQuiz' — which _caseGroupEditors entry to append into
let mergeTab = 'community'; // 'community' | 'custom' | 'curriculum'

let mergeCommTab = 'browse'; // 'browse' | 'mine'
let mergeCommSearch = '';
let mergeCommYearFilter = '';
let mergeCommModuleFilter = '';
let mergeCommSubjectFilter = '';
let mergeCommSort = 'newest';
let mergeSelectedCommunity = new Set(); // shared quiz ids

let mergeCustomSearch = '';
let mergeSelectedCustom = new Set(); // custom quiz ids

let mergeCurrYear = '';
let mergeCurrModule = '';
let mergeCurrSubject = '';
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
  const btnEl = document.getElementById('mergeConfirmBtn');
  if (countEl) countEl.textContent = `${total} question set${total !== 1 ? 's' : ''} selected`;
  if (btnEl) { btnEl.disabled = !total; btnEl.innerHTML = total ? `<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Merge ${total} Selected` : '<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Merge Selected'; }
}

function renderMergePicker() {
  const body = document.getElementById('mergeQuizBody');
  if (!body) return;
  const total = _mergeTotalSelected();

  let html = `<div class="community-section-tabs">
    <button class="community-tab-btn ${mergeTab==='community'?'active':''}" onclick="mergeSetTab('community')">${SOURCE_TAB_ICONS.community.full} (${mergeSelectedCommunity.size || ''})</button>
    <button class="community-tab-btn ${mergeTab==='custom'?'active':''}" onclick="mergeSetTab('custom')">${SOURCE_TAB_ICONS.custom.full} (${mergeSelectedCustom.size || ''})</button>
    <button class="community-tab-btn ${mergeTab==='curriculum'?'active':''}" onclick="mergeSetTab('curriculum')">${SOURCE_TAB_ICONS.curriculum.full} (${mergeSelectedCurriculum.size || ''})</button>
  </div>
  <div id="mergeTabContent" style="margin-top:10px;"></div>
  <div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border,#E0E0E0);
    display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
    <div id="mergeFooterCount" style="font-size:.85rem;font-weight:700;color:var(--text-muted);">
      ${total} question set${total !== 1 ? 's' : ''} selected
    </div>
    <div style="display:flex;gap:8px;">
      <button class="cq-btn cq-btn-secondary" onclick="closeMergePicker()">✖ Cancel</button>
      <button class="cq-btn" id="mergeConfirmBtn" ${!total ? 'disabled' : ''} onclick="confirmMergeSelectedQuizzes()">${total ? `<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Merge ${total} Selected` : '<svg class="sicon" viewBox="0 0 24 24"><path d="M11 4a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1 2 2 0 1 0 0 4 1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-2a1 1 0 0 1-1-1 2 2 0 1 0-4 0 1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1 2 2 0 1 0 0-4 1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h2a1 1 0 0 0 1-1z"/></svg> Merge Selected'}</button>
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

/* ── Community tab ──
   Per-quiz granular caching (fixes the real bug in the previous single-
   global-version scheme, which forced a full re-fetch of every community
   quiz whenever any ONE of them changed). One cheap manifest read tells us
   every quiz's own version; only changed/new ones are actually fetched.

   Checked at most once per page load in practice: _allSharedQuizzes is an
   in-memory (module-level) cache, so every re-open of the Community
   Quizzes modal, the merge picker, or the admin Manage-Community tab
   within the same page load reuses it with zero calls of any kind (see
   the early-return on the very next line) — see build #80's README entry
   for the full before/after.

   The lastVersionCheck:community throttle below covers the remaining case
   a plain in-memory cache can't: a page REFRESH (which clears the
   in-memory cache) happening again within a minute of the last real
   check — e.g. a flaky connection, or a student bouncing between tabs.
   When that happens, this rebuilds the list straight from IndexedDB with
   NO network calls at all (not even the one cheap manifest read), rather
   than re-verifying against the server so soon. */
async function ensureSharedQuizzesLoaded(forceReload) {
  if (_allSharedQuizzes.length && !forceReload) return true;
  try {
    const lastCheckKey = 'lastVersionCheck:community';
    const withinThrottle = !forceReload &&
      (Date.now() - parseInt(localStorage.getItem(lastCheckKey) || '0', 10)) < 60 * 1000;

    if (withinThrottle) {
      const knownIds = (await window._idbGet('communityKnownIds').catch(() => null)) || [];
      if (knownIds.length) {
        const rebuilt = await Promise.all(
          knownIds.map(id => window._idbGet(`content:community:${id}`).catch(() => null))
        );
        if (rebuilt.every(Boolean)) {
          _allSharedQuizzes = rebuilt;
          console.log(`[cache] community quizzes: recent check (<60s ago) trusted, rebuilt ${rebuilt.length} from IndexedDB — 0 network calls`);
          return true;
        }
        // Fall through to a real check below — some previously-known quiz
        // is missing from IndexedDB (e.g. storage was cleared), so trusting
        // the throttle here would risk showing an incomplete list.
      }
    }

    const { fetchCommunityManifest } = await import('./content-client.js');
    const manifest = await fetchCommunityManifest();
    localStorage.setItem(lastCheckKey, String(Date.now()));
    const quizIds = Object.keys(manifest);

    const prevKnownIds = (await window._idbGet('communityKnownIds').catch(() => null)) || [];
    const resolved = [];
    let cacheHits = 0, fetched = 0, failed = 0;

    await Promise.all(quizIds.map(async (quizId) => {
      const ver = manifest[quizId];
      const idbKey = `content:community:${quizId}`;
      const cached = await window._idbGet(idbKey).catch(() => null);

      if (cached && cached.__version === ver) {
        cacheHits++;
        resolved.push(cached);
        return;
      }
      try {
        const resp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/community/${quizId}.json`);
        if (!resp.ok) { failed++; return; } // 404 or transient error — skip, don't break the whole list
        const data = await resp.json();
        data.__version = ver;
        await window._idbSet(idbKey, data);
        fetched++;
        resolved.push(data);
      } catch (e) { failed++; /* skip this one quiz, keep the rest of the list working */ }
    }));

    console.log(`[cache] community quizzes: ${cacheHits} from IndexedDB, ${fetched} fetched from Worker${failed ? `, ${failed} failed` : ''} (of ${quizIds.length} total)`);

    // Drop local cache entries for quizzes that no longer exist at all.
    for (const oldId of prevKnownIds) {
      if (!quizIds.includes(oldId)) await window._idbDelete(`content:community:${oldId}`).catch(() => {});
    }
    await window._idbSet('communityKnownIds', quizIds);

    _allSharedQuizzes = resolved;
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
  if (!ok) { el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--wrong-fg);"><svg class="micon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Failed to load community quizzes.</div>`; return; }
  _renderMergeCommunityList();
}

// Typing only ever needs the results list refreshed — see the matching
// comment on communityOnSearchInput (js/sharing.js) for why this (rather
// than a full _renderMergeCommunityList()) is what keeps the search box
// itself from flickering on every keystroke.
function mergeCommOnSearchInput(val) {
  mergeCommSearch = val;
  _renderMergeCommunityResultsOnly();
}

// Programmatic search changes (currently just the clear button) — also
// syncs the input's own value, since there's no keystroke doing that.
function mergeCommSetSearch(val) {
  mergeCommSearch = val;
  const input = document.getElementById('mergeCommSearchInput');
  if (input) input.value = val;
  _renderMergeCommunityResultsOnly();
}

function _mergeCommComputePool() {
  const myUid = window._currentUser ? window._currentUser.uid : null;
  const shared = _allSharedQuizzes;
  const myShared = shared.filter(q => q.authorUid === myUid);
  let pool = mergeCommTab === 'mine' ? myShared : shared;

  const q = mergeCommSearch.toLowerCase().trim();
  if (q) {
    pool = pool.filter(item => {
      const inTitle = (item.title || '').toLowerCase().includes(q);
      const inAuthor = (item.authorName || '').toLowerCase().includes(q);
      const inCat = (item.category || '').toLowerCase().includes(q);
      const inTags = (item.tags || []).some(t => t.includes(q));
      return inTitle || inAuthor || inCat || inTags;
    });
  }
  if (mergeCommYearFilter) pool = pool.filter(item => (item.year || '') === mergeCommYearFilter);
  if (mergeCommModuleFilter) pool = pool.filter(item => (item.module || '') === mergeCommModuleFilter);
  if (mergeCommSubjectFilter) pool = pool.filter(item => (item.subjectKey || '') === mergeCommSubjectFilter);

  if (mergeCommSort === 'newest') pool = [...pool].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  else if (mergeCommSort === 'oldest') pool = [...pool].sort((a, b) => (a.sharedAt || 0) - (b.sharedAt || 0));
  else if (mergeCommSort === 'az') pool = [...pool].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else if (mergeCommSort === 'questions') pool = [...pool].sort((a, b) => (b.questionCount || 0) - (a.questionCount || 0));

  return { pool, shared, myShared, myUid };
}

function _mergeCommBuildListHtml(pool, myUid) {
  if (!pool.length) {
    return `<div class="community-empty">
      <div class="ce-icon">${mergeCommSearch || mergeCommYearFilter || mergeCommModuleFilter || mergeCommSubjectFilter ? '' : '<svg class="hicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>'}</div>
      No quizzes match.
    </div>`;
  }
  let html = '';
  pool.forEach(item => {
    const isOwn = item.authorUid === myUid;
    const date = new Date(item.sharedAt).toLocaleDateString();
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
            &nbsp;&middot;&nbsp; <svg class="sicon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(item.authorName)}
            ${isOwn ? ' <span class="share-chip">You</span>' : ''}
            &nbsp;&middot;&nbsp; <svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${date}
          </div>
        </div>
      </label>
    </div>`;
  });
  return html;
}

// Light path: recomputes the pool and rewrites only the results list +
// count. Used for every search keystroke.
function _renderMergeCommunityResultsOnly() {
  const { pool, myUid } = _mergeCommComputePool();
  _commRenderResults({
    idPrefix: 'mergeComm',
    listContainerId: 'mergeCommQuizList',
    resultCount: pool.length,
    listHtml: _mergeCommBuildListHtml(pool, myUid),
  });
}

function _renderMergeCommunityList() {
  const el = document.getElementById('mergeTabContent');
  if (!el) return;

  const { pool, shared, myShared, myUid } = _mergeCommComputePool();

  const allYears = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
  const allModules = mergeCommYearFilter
    ? Object.keys(curriculum[mergeCommYearFilter] || {})
    : [...new Set(shared.map(i => i.module).filter(Boolean))].sort();
  const allSubjects = (mergeCommYearFilter && mergeCommModuleFilter)
    ? (curriculum[mergeCommYearFilter][mergeCommModuleFilter] || []).filter(k => subjects[k])
    : [...new Set(shared.map(i => i.subjectKey).filter(Boolean))];

  // Full chrome rebuild — tabs + filter bar + a stable list container.
  // Only runs on structural changes (open, tab switch, dropdown change),
  // never on a search keystroke (see mergeCommOnSearchInput above), so
  // the search <input> stays alive and focused while someone types.
  el.innerHTML = `
    <div class="community-section-tabs">
      <button class="community-tab-btn ${mergeCommTab === 'browse' ? 'active' : ''}" onclick="mergeCommTab='browse';mergeCommSearch='';mergeCommYearFilter='';mergeCommModuleFilter='';mergeCommSubjectFilter='';_renderMergeCommunityList()"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg> Browse All (${shared.length})</button>
      <button class="community-tab-btn ${mergeCommTab === 'mine' ? 'active' : ''}" onclick="mergeCommTab='mine';_renderMergeCommunityList()"><svg class="sicon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> My Shared (${myShared.length})</button>
    </div>
    ${_buildCommFilterBarHTML({
      idPrefix: 'mergeComm',
      searchVal: mergeCommSearch,
      searchOninput: 'mergeCommOnSearchInput(this.value)',
      clearOnclick: "mergeCommSetSearch('')",
      yearVal: mergeCommYearFilter,
      yearOnchange: "mergeCommYearFilter=this.value;mergeCommModuleFilter='';mergeCommSubjectFilter='';_renderMergeCommunityList()",
      allYears,
      moduleVal: mergeCommModuleFilter,
      moduleOnchange: "mergeCommModuleFilter=this.value;mergeCommSubjectFilter='';_renderMergeCommunityList()",
      moduleDisabled: !mergeCommYearFilter,
      allModules,
      subjectVal: mergeCommSubjectFilter,
      subjectOnchange: 'mergeCommSubjectFilter=this.value;_renderMergeCommunityList()',
      subjectDisabled: !mergeCommModuleFilter,
      allSubjects,
      sortVal: mergeCommSort,
      sortOnchange: 'mergeCommSort=this.value;_renderMergeCommunityList()',
      resultCount: pool.length
    })}
    <div id="mergeCommQuizList">${_mergeCommBuildListHtml(pool, myUid)}</div>`;
}

function mergeToggleCommunity(id, checked) {
  if (checked) mergeSelectedCommunity.add(id); else mergeSelectedCommunity.delete(id);
  _mergeUpdateFooter();
}

/* ── Custom quizzes tab ── */
// Same split as the community tab above: typing only rewrites the
// results list + count, never the search box itself.
function mergeCustomOnSearchInput(val) {
  mergeCustomSearch = val;
  _renderMergeCustomResultsOnly();
}

function _mergeCustomComputeList() {
  // Can't merge a saved quiz into itself while editing it.
  const excludeId = (mergeEditorKey === 'customQuiz' && !cqCreatingNew) ? cqEditingQuizId : null;
  let quizzes = loadCustomQuizzes().filter(q => q.id !== excludeId && (q.questions || []).length);

  const s = mergeCustomSearch.toLowerCase().trim();
  if (s) quizzes = quizzes.filter(q => (q.title || '').toLowerCase().includes(s));
  return quizzes;
}

function _mergeCustomBuildListHtml(quizzes) {
  if (!quizzes.length) {
    return `<div class="community-empty"><div class="ce-icon"><svg class="hicon" style="width:40px;height:40px;" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>No custom quizzes to merge from.</div>`;
  }
  let html = '';
  quizzes.forEach(q => {
    const checked = mergeSelectedCustom.has(q.id);
    html += `<div class="cq-quiz-item">
      <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;flex:1;">
        <input type="checkbox" style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
          ${checked ? 'checked' : ''} onchange="mergeToggleCustom('${escapeHtml(q.id)}', this.checked)" />
        <div>
          <div class="cq-quiz-name">${escapeHtml(q.title)}</div>
          <div class="cq-quiz-meta">${q.questions.length} question${q.questions.length !== 1 ? 's' : ''} &middot; created ${new Date(q.createdAt).toLocaleDateString()}</div>
          ${_quizCollectionChipHTML(q, loadQuizCollections()) ? `<div style="margin-top:4px;">${_quizCollectionChipHTML(q, loadQuizCollections())}</div>` : ''}
        </div>
      </label>
    </div>`;
  });
  return html;
}

function _renderMergeCustomResultsOnly() {
  const quizzes = _mergeCustomComputeList();
  _commRenderResults({
    idPrefix: 'mergeCustom',
    listContainerId: 'mergeCustomQuizList',
    resultCount: quizzes.length,
    listHtml: _mergeCustomBuildListHtml(quizzes),
  });
}

function _renderMergeCustomTab() {
  const el = document.getElementById('mergeTabContent');
  if (!el) return;

  const quizzes = _mergeCustomComputeList();

  el.innerHTML = `<div class="comm-filter-bar">
    <div class="comm-search-wrap">
      <span class="comm-search-icon"><svg class="hicon" style="width:14px;height:14px;" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
      <input class="comm-search-input" id="mergeCustomSearchInput" type="text" placeholder="Search your custom quizzes…"
             value="${escapeHtml(mergeCustomSearch)}" oninput="mergeCustomOnSearchInput(this.value)" />
    </div>
    <div class="comm-results-count" id="mergeCustomResultsCount">${_commResultsCountLabel(quizzes.length)}</div>
  </div>
  <div id="mergeCustomQuizList">${_mergeCustomBuildListHtml(quizzes)}</div>`;
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

  const years = Object.keys(curriculum);
  const modules = mergeCurrYear ? Object.keys(curriculum[mergeCurrYear] || {}) : [];
  const subs = (mergeCurrYear && mergeCurrModule) ? (curriculum[mergeCurrYear][mergeCurrModule] || []).filter(k => subjects[k]) : [];

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
      html += `<div class="community-empty"><div class="ce-icon"><svg class="hicon" style="width:40px;height:40px;" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>No lectures in this subject yet.</div>`;
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
    html += `<div class="community-empty"><div class="ce-icon"><svg class="hicon" style="width:40px;height:40px;" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div>Select a year, module and subject to see its lectures.</div>`;
  }

  el.innerHTML = html;
}

function mergeToggleCurriculum(key, checked) {
  if (checked) mergeSelectedCurriculum.add(key); else mergeSelectedCurriculum.delete(key);
  _mergeUpdateFooter();
}

/* ── Perform the merge ── */
/* Deep-clones a source question list for merging into an editor, namespacing
   any case_group ids (and, within a group, its case_link_id/case_parent_id
   sub-case ids) with a source-specific prefix so a case cluster — and any
   sub-cases nested inside it — from one merged-in quiz can never collide
   with one from another, and stripping legacy image sentinels that only
   resolve against their original source collection. By the time this runs,
   the caller has already made sure any still-remote image is pulled down
   into a real local data URL via ensureInlineImages(), so q.image here is
   a genuinely independent copy, not a live reference back to the source
   quiz. */
function _mergeCloneQuestions(rawQuestions, namespace, sourceLabel) {
  const qs = JSON.parse(JSON.stringify(rawQuestions || []));
  qs.forEach(q => {
    if (q.case_group) q.case_group = namespace + '::' + q.case_group;
    if (q.case_link_id) q.case_link_id = namespace + '::' + q.case_link_id;
    if (q.case_parent_id) q.case_parent_id = namespace + '::' + q.case_parent_id;
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
      <svg class="sicon" viewBox="0 0 24 24"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> ${escapeHtml(q._mergeSourceLabel)}</span>`;
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
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Merging…'; }

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
      // A community quiz's images are inline by default now, so in the
      // normal case there's nothing left to pull down here — but a
      // merged-in question is just as much a permanent local copy as
      // anything from "Save to Mine", so any question from an older,
      // not-yet-migrated quiz still pointing at a remote image gets
      // inlined here too, rather than being left depending on that
      // source quiz's images still existing after this merge is saved.
      await ensureInlineImages(restored);
      appended = appended.concat(_mergeCloneQuestions(restored, 'comm_' + id, item.title || 'Community quiz'));
    }

    // Saved custom quizzes are already hydrated in memory.
    const customQuizzes = loadCustomQuizzes();
    mergeSelectedCustom.forEach(id => {
      const quiz = customQuizzes.find(q => q.id === id);
      if (!quiz) return;
      appended = appended.concat(_mergeCloneQuestions(quiz.questions, quiz.id, quiz.title || 'Custom quiz'));
    });

    // Curriculum lectures are already hydrated in memory; still runs
    // ensureInlineImages defensively in case an older, not-yet-migrated
    // lecture still has a remote image reference.
    for (const key of mergeSelectedCurriculum) {
      const sep = key.indexOf('::');
      const subjectKey = key.slice(0, sep), lectureName = key.slice(sep + 2);
      const qs = subjects[subjectKey] && subjects[subjectKey].lectures && subjects[subjectKey].lectures[lectureName];
      if (!qs) continue;
      const restoredCurr = JSON.parse(JSON.stringify(qs));
      await ensureInlineImages(restoredCurr);
      appended = appended.concat(_mergeCloneQuestions(restoredCurr, 'curr_' + key, lectureName || 'Lecture'));
    }

    target.push(...appended);
    closeMergePicker();
    ed.rerender();
  } catch (e) {
    if (btn) { btn.disabled = false; }
    alert('Failed to merge quizzes: ' + (e.message || e));
    _mergeUpdateFooter();
  }
}