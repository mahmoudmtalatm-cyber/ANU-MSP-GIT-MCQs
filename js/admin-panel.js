/* ══════════════════════════════════════════════════════════
   ADMIN PANEL — Publish quizzes (custom or community) into
   the official question bank under a chosen Module/Subject.
══════════════════════════════════════════════════════════ */
let adminSourceTab   = 'custom';   // 'custom' | 'community'
let adminSelectedQuiz = null;      // { title, questions, sourceType, sourceId }
// NOTE: adminTargetYear/Module/Subject below are used EXCLUSIVELY by the
// "📚 Manage Curriculum" tab's own drill-down navigation (adminCurrNavLevel
// etc.) — they track where the admin is browsing *in that tab*.
let adminTargetYear   = '';
let adminTargetModule = '';
let adminTargetSubject= '';

// The Publish tab's own "where does this quiz go" destination picker keeps
// a fully separate set of Year/Module/Subject targets so that clicking
// through it never changes — or gets clobbered by — whatever the admin was
// last browsing in the Manage Curriculum tab, and vice versa.
let adminPubTargetYear   = '';
let adminPubTargetModule = '';
let adminPubTargetSubject= '';

// Where to insert a newly-published quiz among a subject's existing
// published quizzes: null = append at the end (default), otherwise
// { lectureId, position } with position 'before' | 'after'.
let adminPublishInsertPosition = null;

let adminCommunityCache = null;
let adminBusy = false;

// Search/filter state for the "🌐 Community Quizzes" source list in the
// Publish tab — mirrors communitySearchQuery/Year/Module/SubjectFilter/Sort
// from the student-facing Community Quizzes browse overlay, kept as its
// own separate set of variables so browsing here never affects, and is
// never affected by, whatever's currently set in that overlay.
let adminCommTab           = 'browse'; // 'browse' | 'mine' — mirrors commManageTab, for the Publish tab's community source list
let adminCommSearchQuery   = '';
let adminCommYearFilter    = '';
let adminCommModuleFilter  = '';
let adminCommSubjectFilter = '';
let adminCommSort          = 'newest';

// "🗂️ Manage Community Quiz" tab — a full admin-side duplicate of the
// student-facing Community Quizzes browse menu (Browse All / My Shared,
// search, cascading Year/Module/Subject filters, sort, tag chips), with
// an admin Delete button added to every card. This is now the ONLY place
// an admin deletes a community-shared quiz from — the Publish Quizzes
// tab keeps its search/filter bar for picking a source to publish, but
// has no delete button anywhere anymore. Kept as its own separate set of
// variables so this tab's browsing/filtering never interferes with the
// student-facing overlay's or the Publish tab's.
let commManageTab           = 'browse'; // 'browse' | 'mine'
let commManageSearchQuery   = '';
let commManageYearFilter    = '';
let commManageModuleFilter  = '';
let commManageSubjectFilter = '';
let commManageSort          = 'newest';

// Inline quiz editor state (used both for "edit before publish" and "edit published lecture")
let adminEditQuestions = null;   // working copy of questions array being edited, or null
let adminEditMode      = null;   // 'publish' | 'published' | null
let adminEditingPublishedId   = null; // lectureId when editing an already-published lecture
let adminEditingPublishedName = '';   // its lecture name

// Cache of the currently-listed published lectures for whichever subject is
// in focus (adminPubTargetSubject in the Publish tab, adminTargetSubject in
// the Curriculum tab — see _pubListSubject()). Populated by
// renderAdminAssignedList(); used as the Split-Quiz source so re-rendering
// the split panel (mode switches, range edits) doesn't need to re-hit
// Firestore every keystroke.
let adminAssignedEntries = [];

let adminActiveTab = 'publish'; // 'publish' | 'curriculum' | 'admins'

// Returns whichever Year/Module/Subject target is relevant to the tab
// currently on screen — the Curriculum tab's own drill-down position, or
// the Publish tab's separate destination-picker selection. Used by the
// shared "already published" list renderer / reorder logic so the exact
// same functions work correctly from either tab without the two tabs'
// navigation state bleeding into each other.
function _pubListSubject() {
  return adminActiveTab === 'curriculum' ? adminTargetSubject : adminPubTargetSubject;
}

/* Build the admin panel tab bar to match exactly what this user is allowed to see. */
function renderAdminPanelTabs() {
  const user = window._currentUser;
  const canCurriculum = hasAdminPermission(user, 'curriculum');
  const canCommunity  = hasAdminPermission(user, 'community');
  const canAdmins     = hasAdminPermission(user, 'admins');

  let html = '';
  // Publish Quizzes now requires 'curriculum' permission — it's the only
  // thing that tab does (pick a source quiz + assign it into the
  // curriculum), and deleting is no longer possible from here at all.
  if (canCurriculum) {
    html += `<button class="admin-panel-tab ${adminActiveTab === 'publish' ? 'active' : ''}" id="adminTabPublish" onclick="adminSwitchTab('publish')">📤 Publish Quizzes</button>`;
  }
  // Manage Community Quiz — a full duplicate of the student-facing
  // Community Quizzes browse menu (search, cascading filters, tags),
  // with an admin Delete button added to every card. This is now the
  // ONLY place a community-shared quiz gets deleted from in the admin
  // panel. Requires 'community' permission, independent of 'curriculum'.
  if (canCommunity) {
    html += `<button class="admin-panel-tab ${adminActiveTab === 'commManage' ? 'active' : ''}" id="adminTabCommManage" onclick="adminSwitchTab('commManage')">🗂️ Manage Community Quiz</button>`;
  }
  if (canCurriculum) {
    html += `<button class="admin-panel-tab ${adminActiveTab === 'curriculum' ? 'active' : ''}" id="adminTabCurriculum" onclick="adminSwitchTab('curriculum')">📚 Manage Curriculum</button>`;
  }
  if (canAdmins) {
    html += `<button class="admin-panel-tab ${adminActiveTab === 'admins' ? 'active' : ''}" id="adminTabAdmins" onclick="adminSwitchTab('admins')">👑 Manage Admins</button>`;
  }
  document.getElementById('adminPanelTabs').innerHTML = html;
}

/* Pick a sensible default tab given this user's permissions. */
function adminDefaultTab() {
  const user = window._currentUser;
  if (hasAdminPermission(user, 'curriculum')) return 'publish';
  if (hasAdminPermission(user, 'community')) return 'commManage';
  if (hasAdminPermission(user, 'admins')) return 'admins';
  return null;
}

function openAdminPanel() {
  if (!isAdminUser(window._currentUser)) {
    alert('You do not have admin access.');
    return;
  }
  adminSourceTab    = 'custom'; // Publish tab is curriculum-only now, so this is always the sensible start
  adminSelectedQuiz = null;
  if (cqEditorContext === 'admin') { cqEditorContext = 'quiz'; cqEditingQuizId = null; cqEditQuestions = null; _questionEditDirty = false; }
  adminTargetYear   = '';
  adminTargetModule = '';
  adminTargetSubject= '';
  adminPubTargetYear   = '';
  adminPubTargetModule = '';
  adminPubTargetSubject= '';
  adminPublishInsertPosition = null;
  adminCommunityCache = null;
  adminCurrNavLevel = 'years';
  adminCommTab           = 'browse';
  adminCommSearchQuery   = '';
  adminCommYearFilter    = '';
  adminCommModuleFilter  = '';
  adminCommSubjectFilter = '';
  adminCommSort          = 'newest';
  commManageTab           = 'browse';
  commManageSearchQuery   = '';
  commManageYearFilter    = '';
  commManageModuleFilter  = '';
  commManageSubjectFilter = '';
  commManageSort          = 'newest';
  const defaultTab = adminDefaultTab();
  if (!defaultTab) {
    alert('You do not have admin access.');
    return;
  }
  adminActiveTab = null; // force adminSwitchTab below to actually render instead of no-op'ing
  document.getElementById('adminOverlay').classList.remove('hidden');
  adminSwitchTab(defaultTab);
}

function closeAdminPanel() {
  _guardedClose(() => {
    document.getElementById('adminOverlay').classList.add('hidden');
    fsLoadingHide();
  });
}

/* Re-render whatever admin panel tab is currently open (if the panel is
   open at all). Called whenever the admin roster changes live, so a
   permission grant/revoke or an assign/remove elsewhere takes effect
   immediately instead of needing a reload. */
function refreshOpenAdminPanel() {
  const overlay = document.getElementById('adminOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  renderAdminPanelTabs();
  if (adminActiveTab === 'admins') renderAdminManagePanel();
  else if (adminActiveTab === 'curriculum') renderAdminCurriculumPanel();
  else if (adminActiveTab === 'publish') renderAdminPanel();
  else if (adminActiveTab === 'commManage') renderAdminManageCommunityPanel();
}

function adminSwitchTab(tab) {
  // Refuse to switch into a tab this user doesn't hold permission for
  // (defends against stale buttons / direct calls, not just hides them).
  const user = window._currentUser;
  if (tab === 'publish' && !hasAdminPermission(user, 'curriculum')) return;
  if (tab === 'commManage' && !hasAdminPermission(user, 'community')) return;
  if (tab === 'curriculum' && !hasAdminPermission(user, 'curriculum')) return;
  if (tab === 'admins' && !hasAdminPermission(user, 'admins')) return;
  if (tab === adminActiveTab) return; // already there — nothing to guard or re-render

  _guardedClose(() => {
    adminActiveTab = tab;
    renderAdminPanelTabs();
    if (tab === 'publish') renderAdminPanel();
    else if (tab === 'commManage') renderAdminManageCommunityPanel();
    else if (tab === 'curriculum') renderAdminCurriculumPanel();
    else if (tab === 'admins') renderAdminManagePanel();
  });
}


/* ══════════════════════════════════════════════════════════
   MANAGE ADMINS TAB
══════════════════════════════════════════════════════════ */
function renderAdminManagePanel() {
  const body = document.getElementById('adminBody');
  if (!body) return;
  const user = window._currentUser;

  if (!hasAdminPermission(user, 'admins')) {
    body.innerHTML = `<div style="padding:20px;color:var(--text-muted);">You do not have permission to manage admins.</div>`;
    return;
  }

  const actingPerms = isSuperAdmin(user) ? ADMIN_PERMISSIONS.slice() : getAdminPermissions(user);
  const roster = window._adminRoster || {};

  let rows = `
    <div class="admin-quiz-item" style="cursor:default;">
      <div class="admin-quiz-item-info">
        <div class="admin-quiz-item-title">👑 ${escapeHtml(SUPER_ADMIN_EMAIL)}</div>
        <div class="admin-quiz-item-meta">Super Admin — full access, permanent, cannot be removed</div>
      </div>
    </div>`;

  const emails = Object.keys(roster).sort();
  const actingEmailLower = user.email ? user.email.toLowerCase() : '';
  if (!emails.length) {
    rows += `<div style="color:var(--text-muted);font-size:.85rem;padding:10px;">No other admins yet.</div>`;
  } else {
    emails.forEach(email => {
      const info  = roster[email] || {};
      const perms = Array.isArray(info.permissions) ? info.permissions : [];
      const permLabel = perms.map(p => ADMIN_PERMISSION_LABELS[p] || p).join(' · ') || '—';
      const isAncestor   = !isSuperAdmin(user) && isInAssignerChain(actingEmailLower, email);
      const exceedsPerms = !isSuperAdmin(user) && perms.some(p => !actingPerms.includes(p));
      const canRemove = isSuperAdmin(user) || (!isAncestor && !exceedsPerms);
      let blockedReason = '';
      if (!canRemove) blockedReason = isAncestor ? "assigned you — can't remove" : "outranks you — can't remove";
      rows += `
        <div class="admin-quiz-item" style="cursor:default;">
          <div class="admin-quiz-item-info">
            <div class="admin-quiz-item-title">${escapeHtml(email)}</div>
            <div class="admin-quiz-item-meta">${escapeHtml(permLabel)}${info.addedBy ? ' · added by ' + escapeHtml(info.addedBy) : ''}</div>
          </div>
          ${canRemove
            ? `<button class="admin-remove-btn" onclick="adminRemoveAdminUI('${escapeHtml(email)}')">🗑 Remove</button>`
            : `<span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap;">${escapeHtml(blockedReason)}</span>`}
        </div>`;
    });
  }

  const permCheckboxesHtml = ADMIN_PERMISSIONS.map(p => {
    const allowed = actingPerms.includes(p);
    return `
      <label style="display:flex;align-items:center;gap:7px;font-size:.85rem;padding:4px 0;${allowed ? '' : 'opacity:.4;cursor:not-allowed;'}">
        <input type="checkbox" id="adminNewPerm_${p}" ${allowed ? '' : 'disabled'} />
        ${escapeHtml(ADMIN_PERMISSION_LABELS[p])}
      </label>`;
  }).join('');

  body.innerHTML = `
    <div style="padding:14px;">
      <h3 style="margin:0 0 10px;font-size:1rem;">Current Admins</h3>
      <div class="admin-quiz-list">${rows}</div>

      <h3 style="margin:22px 0 10px;font-size:1rem;">Add New Admin</h3>
      <input type="email" id="adminNewEmail" placeholder="admin-email@gmail.com"
             style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #ccc;border-radius:8px;margin-bottom:10px;font-family:inherit;font-size:.9rem;" />
      <div style="display:flex;flex-direction:column;margin-bottom:6px;">${permCheckboxesHtml}</div>
      <div style="font-size:.76rem;color:var(--text-muted);margin-bottom:12px;">You can only grant permissions you hold yourself.</div>
      <button class="admin-assign-btn" id="adminAddAdminBtn" onclick="adminAssignAdminUI()">➕ Add Admin</button>
      <div class="admin-status" id="adminManageStatus"></div>
    </div>`;
}

async function adminAssignAdminUI() {
  const statusEl   = document.getElementById('adminManageStatus');
  const emailInput = document.getElementById('adminNewEmail');
  const email = (emailInput ? emailInput.value : '').trim();
  const perms = ADMIN_PERMISSIONS.filter(p => {
    const box = document.getElementById('adminNewPerm_' + p);
    return box && !box.disabled && box.checked;
  });

  const btn = document.getElementById('adminAddAdminBtn');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = `<div class="cq-status info">⏳ Adding admin…</div>`;

  try {
    await assignAdmin(window._currentUser, email, perms);
    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ ${escapeHtml(email.trim().toLowerCase())} added as admin.</div>`;
    setTimeout(() => renderAdminManagePanel(), 600);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">❌ ${escapeHtml(e.message || String(e))}</div>`;
    if (btn) btn.disabled = false;
  }
}

async function adminRemoveAdminUI(email) {
  if (!confirm(`Remove admin access for ${email}?`)) return;
  try {
    await removeAdmin(window._currentUser, email);
    renderAdminManagePanel();
  } catch (e) {
    alert('Failed to remove admin: ' + (e.message || e));
  }
}

function adminSetSourceTab(tab) {
  adminSourceTab = tab;
  adminSelectedQuiz = null;
  if (cqEditorContext === 'admin') { cqEditorContext = 'quiz'; cqEditingQuizId = null; cqEditQuestions = null; _questionEditDirty = false; }
  adminCommTab           = 'browse';
  adminCommSearchQuery   = '';
  adminCommYearFilter    = '';
  adminCommModuleFilter  = '';
  adminCommSubjectFilter = '';
  adminCommSort          = 'newest';
  renderAdminPanel();
}

function adminCommOnSearchInput(val) {
  adminCommSearchQuery = val;
  const clearBtn = document.getElementById('adminCommClearBtn');
  if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
  window._adminCommSearchFocused = true;
  const el = document.getElementById('adminCommSearchInput');
  window._adminCommSearchPos = el ? el.selectionStart : null;
  renderAdminPanel();
}

async function renderAdminPanel() {
  const user = window._currentUser;
  const canCurriculum = hasAdminPermission(user, 'curriculum');
  const canCommunity  = hasAdminPermission(user, 'community');
  const body = document.getElementById('adminBody');

  // Force onto a source tab this user is actually allowed to see.
  if (adminSourceTab === 'custom' && !canCurriculum) adminSourceTab = 'community';
  if (adminSourceTab === 'community' && !canCommunity) adminSourceTab = 'custom';

  let listHtml = '';
  if (adminSourceTab === 'custom') {
    const quizzes = loadCustomQuizzes();
    if (!quizzes.length) {
      listHtml = `<div style="color:var(--text-muted);font-size:.88rem;padding:10px;">No custom quizzes found for your account.</div>`;
    } else {
      listHtml = quizzes.map(q => {
        const sel = adminSelectedQuiz && adminSelectedQuiz.sourceType === 'custom' && adminSelectedQuiz.sourceId === q.id;
        return `
          <div class="admin-quiz-item ${sel ? 'selected' : ''}" onclick="adminSelectQuiz('custom','${q.id}')">
            <div class="admin-quiz-item-info">
              <div class="admin-quiz-item-title">${escapeHtml(q.title || 'Untitled Quiz')}</div>
              <div class="admin-quiz-item-meta">${(q.questions || []).length} question${(q.questions||[]).length !== 1 ? 's' : ''}</div>
            </div>
            <div class="admin-quiz-item-check">✓</div>
          </div>`;
      }).join('');
    }
  } else {
    listHtml = `<div style="text-align:center;padding:20px;color:var(--text-muted);">⏳ Loading community quizzes…</div>`;
  }

  const sourceTabsHtml = `
    <div class="admin-quiz-source-tabs">
      ${canCurriculum ? `<button class="admin-source-tab ${adminSourceTab === 'custom' ? 'active' : ''}" onclick="adminSetSourceTab('custom')">🤖 My Custom Quizzes</button>` : ''}
      ${canCommunity ? `<button class="admin-source-tab ${adminSourceTab === 'community' ? 'active' : ''}" onclick="adminSetSourceTab('community')">🌐 Community Quizzes</button>` : ''}
    </div>`;

  body.innerHTML = `
    ${sourceTabsHtml}
    <div id="adminCommSectionTabs"></div>
    <div id="adminCommFilterBar"></div>
    <div class="admin-quiz-list" id="adminQuizList">${listHtml}</div>
    <div id="adminAssignArea"></div>
  `;

  // Only curriculum-permitted admins get the "assign to curriculum" workflow;
  // a community-only admin just browses/moderates the list above.
  if (canCurriculum) renderAdminAssignForm();

  // If a custom quiz is currently being edited inline from this panel, fill
  // in its editor now that the container div above exists in the DOM.
  if (adminSourceTab === 'custom' && cqEditorContext === 'admin' && cqEditingQuizId) {
    renderCustomQuizEditor();
  }

  if (adminSourceTab === 'community') {
    if (!adminCommunityCache) {
      try {
        // Reuse the version-checked community cache (shared with the browse overlay)
        // instead of always doing a full Firestore read.
        const serverVer = await _fetchSharedServerVersion();
        const localVer  = _readSharedCacheVer();
        const cached     = await _readCache();
        let shared;

        if (serverVer && localVer === serverVer && cached && cached.shared) {
          shared = cached.shared.slice();
        } else {
          const snap = await window._getDocs(window._collection(window._db, 'sharedQuizzes'));
          shared = [];
          snap.forEach(d => shared.push(d.data()));
          const existing = (await _readCache()) || {};
          existing.shared = shared;
          await _writeCache(existing);
          let verToStore = serverVer;
          if (!verToStore) verToStore = await bumpSharedQuizzesVersion(); // establish baseline first time
          if (verToStore) _writeSharedCacheVer(verToStore);
        }

        shared.sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
        adminCommunityCache = shared;
        _allSharedQuizzes = shared; // keep the browse overlay's in-memory copy in sync too
      } catch (e) {
        document.getElementById('adminQuizList').innerHTML =
          `<div style="text-align:center;padding:16px;color:var(--wrong-fg);">❌ Failed to load community quizzes.</div>`;
        return;
      }
    }
    const allShared = adminCommunityCache;
    const myUid = window._currentUser ? window._currentUser.uid : null;
    const myShared = allShared.filter(q => q.authorUid === myUid);

    const sectionTabsEl = document.getElementById('adminCommSectionTabs');
    if (sectionTabsEl) {
      sectionTabsEl.innerHTML = `
        <div class="community-section-tabs">
          <button class="community-tab-btn ${adminCommTab === 'browse' ? 'active' : ''}" onclick="adminCommTab='browse';adminCommSearchQuery='';adminCommYearFilter='';adminCommModuleFilter='';adminCommSubjectFilter='';renderAdminPanel()">&#127758; Browse All (${allShared.length})</button>
          <button class="community-tab-btn ${adminCommTab === 'mine' ? 'active' : ''}" onclick="adminCommTab='mine';renderAdminPanel()">&#128100; My Shared (${myShared.length})</button>
        </div>`;
    }

    // --- Filtering (identical logic to renderCommunityQuizzes) ---
    let shared = adminCommTab === 'mine' ? myShared : allShared;

    const q = adminCommSearchQuery.toLowerCase().trim();
    if (q) {
      shared = shared.filter(item => {
        const inTitle  = (item.title || '').toLowerCase().includes(q);
        const inAuthor = (item.authorName || '').toLowerCase().includes(q);
        const inCat    = (item.category || '').toLowerCase().includes(q);
        const inTags   = (item.tags || []).some(t => t.includes(q));
        return inTitle || inAuthor || inCat || inTags;
      });
    }
    if (adminCommYearFilter) {
      shared = shared.filter(item => (item.year || '') === adminCommYearFilter);
    }
    if (adminCommModuleFilter) {
      shared = shared.filter(item => (item.module || '') === adminCommModuleFilter);
    }
    if (adminCommSubjectFilter) {
      shared = shared.filter(item => (item.subjectKey || '') === adminCommSubjectFilter);
    }

    if (adminCommSort === 'newest') {
      shared = [...shared].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
    } else if (adminCommSort === 'oldest') {
      shared = [...shared].sort((a, b) => (a.sharedAt || 0) - (b.sharedAt || 0));
    } else if (adminCommSort === 'az') {
      shared = [...shared].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (adminCommSort === 'questions') {
      shared = [...shared].sort((a, b) => (b.questionCount || 0) - (a.questionCount || 0));
    }

    // Build cascading filter options from live curriculum + shared quiz metadata
    const allYears   = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
    const allModules = adminCommYearFilter
      ? Object.keys(curriculum[adminCommYearFilter] || {})
      : [...new Set(allShared.map(i => i.module).filter(Boolean))].sort();
    const allSubjects = (adminCommYearFilter && adminCommModuleFilter)
      ? (curriculum[adminCommYearFilter][adminCommModuleFilter] || []).filter(k => subjects[k])
      : [...new Set(allShared.map(i => i.subjectKey).filter(Boolean))];

    const searchVal  = escapeHtml(adminCommSearchQuery);
    const clearStyle = adminCommSearchQuery ? 'display:block' : 'display:none';

    const filterBar = document.getElementById('adminCommFilterBar');
    if (filterBar) {
      filterBar.innerHTML = `
        <div class="comm-filter-bar">
          <div class="comm-search-wrap">
            <span class="comm-search-icon">🔍</span>
            <input class="comm-search-input" id="adminCommSearchInput" type="text"
                   placeholder="Search by title, author, category or tag…"
                   value="${searchVal}"
                   oninput="adminCommOnSearchInput(this.value)" />
            <button class="comm-search-clear" id="adminCommClearBtn" style="${clearStyle}"
                    onclick="adminCommSearchQuery='';document.getElementById('adminCommSearchInput').value='';this.style.display='none';renderAdminPanel()">✕</button>
          </div>
          <div class="comm-filter-row">
            <select class="comm-filter-select" id="adminCommYearFilter"
                    onchange="adminCommYearFilter=this.value;adminCommModuleFilter='';adminCommSubjectFilter='';renderAdminPanel()">
              <option value="">All Years</option>
              ${allYears.map(y => `<option value="${escapeHtml(y)}" ${adminCommYearFilter === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
            </select>
            <select class="comm-filter-select" id="adminCommModuleFilter"
                    onchange="adminCommModuleFilter=this.value;adminCommSubjectFilter='';renderAdminPanel()"
                    ${!adminCommYearFilter ? 'disabled' : ''}>
              <option value="">All Modules</option>
              ${allModules.map(m => `<option value="${escapeHtml(m)}" ${adminCommModuleFilter === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>
            <select class="comm-filter-select" id="adminCommSubjectFilter"
                    onchange="adminCommSubjectFilter=this.value;renderAdminPanel()"
                    ${!adminCommModuleFilter ? 'disabled' : ''}>
              <option value="">All Subjects</option>
              ${allSubjects.map(k => {
                const lbl = (subjects[k] && (subjects[k].label || k)) || k;
                const ico = (subjects[k] && subjects[k].icon) || '';
                return `<option value="${escapeHtml(k)}" ${adminCommSubjectFilter === k ? 'selected' : ''}>${ico} ${escapeHtml(lbl)}</option>`;
              }).join('')}
            </select>
            <select class="comm-filter-select" id="adminCommSortSelect"
                    onchange="adminCommSort=this.value;renderAdminPanel()">
              <option value="newest" ${adminCommSort==='newest'?'selected':''}>🕐 Newest</option>
              <option value="oldest" ${adminCommSort==='oldest'?'selected':''}>🕐 Oldest</option>
              <option value="az"     ${adminCommSort==='az'?'selected':''}>🔤 A → Z</option>
              <option value="questions" ${adminCommSort==='questions'?'selected':''}>📝 Most Questions</option>
            </select>
          </div>
          <div class="comm-results-count">${shared.length} quiz${shared.length !== 1 ? 'zes' : ''} shown</div>
        </div>`;
    }

    const list = document.getElementById('adminQuizList');
    const hasFilters = !!(adminCommSearchQuery || adminCommYearFilter || adminCommModuleFilter || adminCommSubjectFilter);
    if (!shared.length) {
      const emptyMsg = hasFilters
        ? 'No quizzes match your search. Try different keywords or clear the filters.'
        : adminCommTab === 'mine'
          ? "You haven't shared any quizzes yet."
          : 'No community quizzes available.';
      list.innerHTML = `<div style="color:var(--text-muted);font-size:.88rem;padding:10px;">${emptyMsg}</div>`;
      return;
    }
    list.innerHTML = shared.map(q => {
      const sel = adminSelectedQuiz && adminSelectedQuiz.sourceType === 'community' && adminSelectedQuiz.sourceId === q.id;
      return `
        <div class="admin-quiz-item ${sel ? 'selected' : ''}" onclick="adminSelectQuiz('community','${q.id}')">
          <div class="admin-quiz-item-info">
            <div class="admin-quiz-item-title">${escapeHtml(q.title || 'Untitled Quiz')}</div>
            <div class="admin-quiz-item-meta">by ${escapeHtml(q.authorName || 'Unknown')} · ${(q.questions || []).length} question${(q.questions||[]).length !== 1 ? 's' : ''}</div>
          </div>
          <div class="admin-quiz-item-check">✓</div>
        </div>`;
    }).join('');
  }
}

function adminSelectQuiz(sourceType, sourceId) {
  let quiz = null;
  if (sourceType === 'custom') {
    quiz = loadCustomQuizzes().find(q => q.id === sourceId);
  } else {
    quiz = (adminCommunityCache || []).find(q => q.id === sourceId);
  }
  if (!quiz) return;

  adminSelectedQuiz = {
    sourceType,
    sourceId,
    title: quiz.title || 'Untitled Quiz',
    questions: quiz.questions || []
  };
  adminEditQuestions = null;
  adminEditMode      = null;

  renderAdminPanel();
}

/* Delete a source quiz (custom quiz of the admin's own account, or any community/shared quiz) */
// Deletes a community-shared quiz. Only reachable from the "Manage
// Community Quiz" tab now — custom-quiz deletion lives in the user's own
// custom-quiz menu outside the admin panel, so there's no 'custom' branch
// here anymore.
async function adminDeleteSourceQuiz(sourceId) {
  const user = window._currentUser;
  if (!hasAdminPermission(user, 'community')) {
    alert('You do not have permission to manage community quizzes.');
    return;
  }
  if (!confirm('Delete this quiz permanently? This cannot be undone.')) return;
  try {
    const ref = window._doc(window._db, 'sharedQuizzes', sourceId);
    await window._deleteDoc(ref);
    await deleteSharedQuizImages(sourceId);
    adminCommunityCache = (adminCommunityCache || []).filter(q => q.id !== sourceId);
    _allSharedQuizzes = [];
    await bumpSharedQuizzesVersion();

    if (adminSelectedQuiz && adminSelectedQuiz.sourceType === 'community' && adminSelectedQuiz.sourceId === sourceId) {
      adminSelectedQuiz = null;
      adminEditQuestions = null;
      adminEditMode = null;
    }
    if (adminActiveTab === 'commManage') renderAdminManageCommunityPanel();
    else renderAdminPanel();
  } catch (e) {
    alert('Failed to delete: ' + (e.message || e));
  }
}

/* ══════════════════════════════════════════════════════════
   MANAGE COMMUNITY QUIZ TAB
   A full duplicate of the student-facing Community Quizzes browse menu
   (openCommunityQuizzes/renderCommunityQuizzes) — same Browse All / My
   Shared tabs, same search bar, same cascading Year/Module/Subject
   filters + sort, same tag chips and quiz-card metadata — rendered
   inside the admin panel instead of the overlay, with an admin Delete
   button on every card regardless of who authored it. This is the only
   place in the admin panel a community-shared quiz gets deleted from.
   Requires 'community' permission (enforced by adminSwitchTab and,
   ultimately, by the Firestore rules on sharedQuizzes/{docId}).
══════════════════════════════════════════════════════════ */
function commManageOnSearchInput(val) {
  commManageSearchQuery = val;
  const clearBtn = document.getElementById('commManageClearBtn');
  if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
  window._commManageSearchFocused = true;
  const el = document.getElementById('commManageSearchInput');
  window._commManageSearchPos = el ? el.selectionStart : null;
  renderAdminManageCommunityPanel();
}

async function renderAdminManageCommunityPanel(forceReload) {
  const body = document.getElementById('adminBody');
  if (!body) return;

  // Reuse the same version-checked shared-quizzes cache as the student
  // browse overlay and the Publish tab's community source list, so
  // switching between them in one session doesn't re-fetch needlessly.
  if (!_allSharedQuizzes.length || forceReload) {
    body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted);"><div style="font-size:2rem;margin-bottom:10px;">&#8987;</div><div style="font-weight:700;">Loading community quizzes…</div></div>`;
    try {
      const serverVer = forceReload ? null : await _fetchSharedServerVersion();
      const localVer  = _readSharedCacheVer();
      const cached    = await _readCache();

      if (!forceReload && serverVer && localVer === serverVer && cached && cached.shared) {
        _allSharedQuizzes = cached.shared;
      } else {
        const snap = await window._getDocs(window._collection(window._db, 'sharedQuizzes'));
        _allSharedQuizzes = [];
        snap.forEach(d => _allSharedQuizzes.push(d.data()));
        const existing = (await _readCache()) || {};
        existing.shared = _allSharedQuizzes;
        await _writeCache(existing);
        let verToStore = forceReload ? await _fetchSharedServerVersion() : serverVer;
        if (!verToStore) verToStore = await bumpSharedQuizzesVersion(); // establish baseline first time
        if (verToStore) _writeSharedCacheVer(verToStore);
      }
      adminCommunityCache = _allSharedQuizzes; // keep the Publish tab's copy of the cache in sync too
    } catch (e) {
      body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--wrong-fg);">&#10060; Failed to load community quizzes. Please try again.</div>`;
      return;
    }
  }

  const myUid = window._currentUser ? window._currentUser.uid : null;
  const shared = _allSharedQuizzes;
  const myShared = shared.filter(q => q.authorUid === myUid);

  // --- Filtering (identical logic to renderCommunityQuizzes) ---
  let pool = commManageTab === 'mine' ? myShared : shared;

  const q = commManageSearchQuery.toLowerCase().trim();
  if (q) {
    pool = pool.filter(item => {
      const inTitle  = (item.title || '').toLowerCase().includes(q);
      const inAuthor = (item.authorName || '').toLowerCase().includes(q);
      const inCat    = (item.category || '').toLowerCase().includes(q);
      const inTags   = (item.tags || []).some(t => t.includes(q));
      return inTitle || inAuthor || inCat || inTags;
    });
  }
  if (commManageYearFilter) {
    pool = pool.filter(item => (item.year || '') === commManageYearFilter);
  }
  if (commManageModuleFilter) {
    pool = pool.filter(item => (item.module || '') === commManageModuleFilter);
  }
  if (commManageSubjectFilter) {
    pool = pool.filter(item => (item.subjectKey || '') === commManageSubjectFilter);
  }

  if (commManageSort === 'newest') {
    pool = [...pool].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  } else if (commManageSort === 'oldest') {
    pool = [...pool].sort((a, b) => (a.sharedAt || 0) - (b.sharedAt || 0));
  } else if (commManageSort === 'az') {
    pool = [...pool].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (commManageSort === 'questions') {
    pool = [...pool].sort((a, b) => (b.questionCount || 0) - (a.questionCount || 0));
  }

  // Build cascading filter options from live curriculum + shared quiz metadata
  const allYears   = Object.keys(curriculum).filter(y => Object.keys(curriculum[y] || {}).length > 0);
  const allModules = commManageYearFilter
    ? Object.keys(curriculum[commManageYearFilter] || {})
    : [...new Set(shared.map(i => i.module).filter(Boolean))].sort();
  const allSubjects = (commManageYearFilter && commManageModuleFilter)
    ? (curriculum[commManageYearFilter][commManageModuleFilter] || []).filter(k => subjects[k])
    : [...new Set(shared.map(i => i.subjectKey).filter(Boolean))];

  const searchVal  = escapeHtml(commManageSearchQuery);
  const clearStyle = commManageSearchQuery ? 'display:block' : 'display:none';

  let html = `
    <div class="community-section-tabs">
      <button class="community-tab-btn ${commManageTab === 'browse' ? 'active' : ''}" onclick="commManageTab='browse';commManageSearchQuery='';commManageYearFilter='';commManageModuleFilter='';commManageSubjectFilter='';renderAdminManageCommunityPanel()">&#127758; Browse All (${shared.length})</button>
      <button class="community-tab-btn ${commManageTab === 'mine' ? 'active' : ''}" onclick="commManageTab='mine';renderAdminManageCommunityPanel()">&#128100; My Shared (${myShared.length})</button>
    </div>

    <div class="comm-filter-bar">
      <div class="comm-search-wrap">
        <span class="comm-search-icon">🔍</span>
        <input class="comm-search-input" id="commManageSearchInput" type="text"
               placeholder="Search by title, author, category or tag…"
               value="${searchVal}"
               oninput="commManageOnSearchInput(this.value)" />
        <button class="comm-search-clear" id="commManageClearBtn" style="${clearStyle}"
                onclick="commManageSearchQuery='';document.getElementById('commManageSearchInput').value='';this.style.display='none';renderAdminManageCommunityPanel()">✕</button>
      </div>
      <div class="comm-filter-row">
        <select class="comm-filter-select" id="commManageYearFilter"
                onchange="commManageYearFilter=this.value;commManageModuleFilter='';commManageSubjectFilter='';renderAdminManageCommunityPanel()">
          <option value="">All Years</option>
          ${allYears.map(y => `<option value="${escapeHtml(y)}" ${commManageYearFilter === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
        </select>
        <select class="comm-filter-select" id="commManageModuleFilter"
                onchange="commManageModuleFilter=this.value;commManageSubjectFilter='';renderAdminManageCommunityPanel()"
                ${!commManageYearFilter ? 'disabled' : ''}>
          <option value="">All Modules</option>
          ${allModules.map(m => `<option value="${escapeHtml(m)}" ${commManageModuleFilter === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <select class="comm-filter-select" id="commManageSubjectFilter"
                onchange="commManageSubjectFilter=this.value;renderAdminManageCommunityPanel()"
                ${!commManageModuleFilter ? 'disabled' : ''}>
          <option value="">All Subjects</option>
          ${allSubjects.map(k => {
            const lbl = (subjects[k] && (subjects[k].label || k)) || k;
            const ico = (subjects[k] && subjects[k].icon) || '';
            return `<option value="${escapeHtml(k)}" ${commManageSubjectFilter === k ? 'selected' : ''}>${ico} ${escapeHtml(lbl)}</option>`;
          }).join('')}
        </select>
        <select class="comm-filter-select" id="commManageSortSelect"
                onchange="commManageSort=this.value;renderAdminManageCommunityPanel()">
          <option value="newest" ${commManageSort==='newest'?'selected':''}>🕐 Newest</option>
          <option value="oldest" ${commManageSort==='oldest'?'selected':''}>🕐 Oldest</option>
          <option value="az"     ${commManageSort==='az'?'selected':''}>🔤 A → Z</option>
          <option value="questions" ${commManageSort==='questions'?'selected':''}>📝 Most Questions</option>
        </select>
      </div>
      <div class="comm-results-count">${pool.length} quiz${pool.length !== 1 ? 'zes' : ''} shown</div>
    </div>`;

  if (!pool.length) {
    html += `<div class="community-empty">
      <div class="ce-icon">${commManageSearchQuery || commManageYearFilter || commManageModuleFilter || commManageSubjectFilter ? '🔍' : (commManageTab === 'mine' ? '&#128100;' : '&#127758;')}</div>
      ${commManageSearchQuery || commManageYearFilter || commManageModuleFilter || commManageSubjectFilter
        ? 'No quizzes match your search. Try different keywords or clear the filters.'
        : commManageTab === 'mine'
          ? 'You haven\'t shared any quizzes yet.'
          : 'No community quizzes yet.'}
    </div>`;
  } else {
    pool.forEach(item => {
      const isOwn = item.authorUid === myUid;
      const date  = new Date(item.sharedAt).toLocaleDateString();
      const catBadge = (item.year || item.subjectLabel)
        ? `<span class="comm-cat-badge">${[item.year, item.module, item.subjectLabel].filter(Boolean).map(escapeHtml).join(' › ')}</span>`
        : (item.category ? `<span class="comm-cat-badge">${escapeHtml(item.category)}</span>` : '');
      const tagsHtml = (item.tags && item.tags.length)
        ? `<div class="comm-tags-row">${item.tags.map(t =>
            `<span class="comm-tag" onclick="commManageSearchQuery='${escapeHtml(t)}';renderAdminManageCommunityPanel()" title="Filter by tag">#${escapeHtml(t)}</span>`
          ).join('')}</div>` : '';

      html += `<div class="community-quiz-item">
        <div class="community-quiz-header">
          <div style="flex:1;min-width:0;">
            <div class="community-quiz-title">${escapeHtml(item.title)}</div>
            <div class="community-quiz-meta">
              ${catBadge}
              ${item.questionCount} question${item.questionCount !== 1 ? 's' : ''}
              &nbsp;&middot;&nbsp; &#128100; ${escapeHtml(item.authorName)}
              ${isOwn ? ' <span class="share-chip">You</span>' : ''}
              &nbsp;&middot;&nbsp; &#128197; ${date}
            </div>
            ${tagsHtml}
          </div>
          <button class="admin-remove-btn" onclick="adminDeleteSourceQuiz('${escapeHtml(item.id)}')">🗑 Delete</button>
        </div>
      </div>`;
    });
  }

  body.innerHTML = html;

  // Restore search input focus/caret if the admin was mid-typing
  const searchEl = document.getElementById('commManageSearchInput');
  if (searchEl && document.activeElement !== searchEl && window._commManageSearchFocused) {
    const pos = window._commManageSearchPos || searchEl.value.length;
    searchEl.focus();
    try { searchEl.setSelectionRange(pos, pos); } catch(e) {}
    window._commManageSearchFocused = false;
  }
}

/* ── Visual publish-destination picker ──
   Same click-through card style used by the "📚 Manage Curriculum" browser
   (_moduleIcon, .curr-item-row, .curr-back-btn, etc.) so picking where a
   quiz goes is a direct, visual "tap the right box" action. Uses its own
   adminPubTargetYear/Module/Subject state — entirely separate from the
   Curriculum tab's adminTargetYear/Module/Subject — so browsing here never
   affects, and is never affected by, wherever the admin last was in
   📚 Manage Curriculum. Picking a new subject always simply replaces
   whatever was previously chosen. */
function adminAssignBreadcrumbHtml() {
  let html = `<div class="curr-breadcrumb">`;
  html += `<span class="curr-crumb ${!adminPubTargetYear ? 'active' : ''}" onclick="adminOnYearChange('')">📅 Years</span>`;
  if (adminPubTargetYear) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${!adminPubTargetModule ? 'active' : ''}" onclick="adminOnModuleChange('')">${escapeHtml(adminPubTargetYear)}</span>`;
  }
  if (adminPubTargetModule) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${!adminPubTargetSubject ? 'active' : ''}" onclick="adminOnSubjectChange('')">${escapeHtml(adminPubTargetModule)}</span>`;
  }
  if (adminPubTargetSubject) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb active">${escapeHtml(subjects[adminPubTargetSubject]?.label || adminPubTargetSubject)}</span>`;
  }
  html += `</div>`;
  return html;
}

function adminPublishTargetPickerHtml() {
  let html = `<div class="curr-section admin-publish-picker">`;
  html += `<div class="curr-section-title" style="margin-bottom:8px;">📍 Publish Destination</div>`;
  html += adminAssignBreadcrumbHtml();

  if (adminPubTargetSubject) {
    html += `<button class="curr-back-btn" onclick="adminOnSubjectChange('')">← Back to Subjects</button>`;
  } else if (adminPubTargetModule) {
    html += `<button class="curr-back-btn" onclick="adminOnModuleChange('')">← Back to Modules</button>`;
  } else if (adminPubTargetYear) {
    html += `<button class="curr-back-btn" onclick="adminOnYearChange('')">← Back to Years</button>`;
  }

  html += `<div style="margin-top:9px;display:flex;flex-direction:column;gap:6px;">`;

  if (!adminPubTargetYear) {
    const years = Object.keys(curriculum);
    html += years.length ? years.map(y => `
      <div class="curr-item-row curr-item-open" onclick="adminOnYearChange('${escapeHtml(y)}')">
        <div style="flex:1;">
          <div class="curr-item-name">📅 ${escapeHtml(y)}</div>
          <div class="curr-item-sub">${Object.keys(curriculum[y] || {}).length} module(s)</div>
        </div>
        <span class="curr-item-arrow">▶</span>
      </div>`).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No years yet — add one in 📚 Manage Curriculum first.</div>`;

  } else if (!adminPubTargetModule) {
    const mods = Object.keys(curriculum[adminPubTargetYear] || {});
    html += mods.length ? mods.map(m => `
      <div class="curr-item-row curr-item-open" onclick="adminOnModuleChange('${escapeHtml(m)}')">
        <div style="flex:1;">
          <div class="curr-item-name">${escapeHtml(_moduleIcon(adminPubTargetYear, m))} ${escapeHtml(m)}</div>
          <div class="curr-item-sub">${(curriculum[adminPubTargetYear][m] || []).filter(k => subjects[k]).length} subject(s)</div>
        </div>
        <span class="curr-item-arrow">▶</span>
      </div>`).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No modules yet in ${escapeHtml(adminPubTargetYear)}.</div>`;

  } else if (!adminPubTargetSubject) {
    const subs = (curriculum[adminPubTargetYear][adminPubTargetModule] || []).filter(k => subjects[k]);
    html += subs.length ? subs.map(s => `
      <div class="curr-item-row curr-item-open" onclick="adminOnSubjectChange('${escapeHtml(s)}')">
        <div style="flex:1;">
          <div class="curr-item-name">${escapeHtml(subjects[s].icon || '📘')} ${escapeHtml(subjects[s].label || s)}</div>
        </div>
        <span class="curr-item-arrow">▶</span>
      </div>`).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No subjects yet in ${escapeHtml(adminPubTargetModule)}.</div>`;

  } else {
    html += `
      <div class="curr-item-row admin-publish-target-selected">
        <div style="flex:1;">
          <div class="curr-item-name">✅ ${escapeHtml(subjects[adminPubTargetSubject].icon || '📘')} ${escapeHtml(subjects[adminPubTargetSubject].label || adminPubTargetSubject)}</div>
          <div class="curr-item-sub">${escapeHtml(adminPubTargetYear)} → ${escapeHtml(adminPubTargetModule)}</div>
        </div>
      </div>`;
  }

  html += `</div></div>`;
  return html;
}

function adminOnYearChange(val) {
  adminPubTargetYear   = val;
  adminPubTargetModule = '';
  adminPubTargetSubject = '';
  adminPublishInsertPosition = null;
  renderAdminAssignForm();
}
function adminOnModuleChange(val) {
  adminPubTargetModule = val;
  adminPubTargetSubject = '';
  adminPublishInsertPosition = null;
  renderAdminAssignForm();
}
function adminOnSubjectChange(val) {
  adminPubTargetSubject = val;
  adminPublishInsertPosition = null;
  renderAdminAssignForm();
}

function renderAdminAssignForm() {
  const area = document.getElementById('adminAssignArea');
  if (!area) return;

  if (!adminSelectedQuiz) {
    area.innerHTML = '';
    return;
  }

  const qCount = (adminEditMode === 'publish' && adminEditQuestions) ? adminEditQuestions.length : adminSelectedQuiz.questions.length;

  area.innerHTML = `
    <div class="admin-assign-form">
      <div class="admin-assign-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span>Publish "${escapeHtml(adminSelectedQuiz.title)}" (${qCount} q) to:</span>
        <button class="admin-remove-btn" style="background:var(--violet-pale);color:var(--violet-dark);border:1.5px solid var(--violet-mid-border);"
          onclick="adminToggleEditBeforePublish()">
          ${adminEditMode === 'publish' ? '✖ Close Editor' : '✏️ Edit Before Publishing'}
        </button>
      </div>

      <div id="adminEditorArea"></div>

      ${adminPublishTargetPickerHtml()}

      <div class="admin-field">
        <label>Lecture / Topic Name</label>
        <input type="text" id="adminLectureName" placeholder="e.g. Quiz: Liver Pathology (uploaded)" />
      </div>

      <div class="admin-assigned-section" id="adminAssignedSection"></div>

      <button class="admin-assign-btn" id="adminPublishBtn" onclick="adminPublishQuiz()" style="margin-top:14px;"
        ${(!adminPubTargetYear || !adminPubTargetModule || !adminPubTargetSubject) ? 'disabled' : ''}>
        📤 Publish to Question Bank
      </button>
      <div class="admin-status" id="adminStatus"></div>
    </div>
  `;

  if (adminEditMode === 'publish') renderAdminQuestionEditor('adminEditorArea');

  if (adminPubTargetSubject) renderAdminAssignedList();
}

function adminToggleEditBeforePublish() {
  if (adminEditMode === 'publish') {
    _guardedClose(() => {
      adminEditMode = null;
      adminEditQuestions = null;
      renderAdminAssignForm();
    });
    return;
  }
  adminEditMode = 'publish';
  adminEditQuestions = JSON.parse(JSON.stringify(adminSelectedQuiz.questions));
  _questionEditDirty = false;
  renderAdminAssignForm();
}

