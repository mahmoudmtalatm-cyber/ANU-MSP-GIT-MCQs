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
  resetAdminNewAdminFormState();
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
      const scopeChip = perms.includes('curriculum')
        ? ` · 📍 ${escapeHtml(curriculumScopeSummary(info.curriculumScope || { type: 'all' }))}`
        : '';
      const isAncestor = !isSuperAdmin(user) && isInAssignerChain(actingEmailLower, email);
      const exceedsPerms = !isSuperAdmin(user) && (
        perms.some(p => !actingPerms.includes(p)) ||
        (perms.includes('curriculum') && !isCurriculumScopeSubset(info.curriculumScope || { type: 'all' }, getCurriculumScope(user)))
      );
      const canRemove = isSuperAdmin(user) || (!isAncestor && !exceedsPerms);
      let blockedReason = '';
      if (!canRemove) blockedReason = isAncestor ? "assigned you — can't remove" : "outranks you — can't remove";
      rows += `
        <div class="admin-quiz-item" style="cursor:default;">
          <div class="admin-quiz-item-info">
            <div class="admin-quiz-item-title">${escapeHtml(email)}</div>
            <div class="admin-quiz-item-meta">${escapeHtml(permLabel)}${scopeChip}${info.addedBy ? ' · added by ' + escapeHtml(info.addedBy) : ''}</div>
          </div>
          ${canRemove
            ? `<button class="admin-remove-btn" onclick="adminRemoveAdminUI('${escapeHtml(email)}')">🗑 Remove</button>`
            : `<span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap;">${escapeHtml(blockedReason)}</span>`}
        </div>`;
    });
  }

  const permCheckboxesHtml = ADMIN_PERMISSIONS.map(p => {
    const allowed = actingPerms.includes(p);
    const checked = allowed && adminNewPermsChecked[p];
    return `
      <label style="display:flex;align-items:center;gap:7px;font-size:.85rem;padding:4px 0;${allowed ? '' : 'opacity:.4;cursor:not-allowed;'}">
        <input type="checkbox" id="adminNewPerm_${p}" ${allowed ? '' : 'disabled'}${checked ? ' checked' : ''}
               onchange="adminOnPermCheckboxChange('${p}')" />
        ${escapeHtml(ADMIN_PERMISSION_LABELS[p])}
      </label>`;
  }).join('');

  body.innerHTML = `
    <div style="padding:14px;">
      <h3 style="margin:0 0 10px;font-size:1rem;">Current Admins</h3>
      <div class="admin-quiz-list">${rows}</div>

      <h3 style="margin:22px 0 10px;font-size:1rem;">Add New Admin</h3>
      <input type="email" id="adminNewEmail" placeholder="admin-email@gmail.com" value="${escapeHtml(adminNewEmailDraft)}"
             oninput="adminNewEmailDraft=this.value"
             style="width:100%;box-sizing:border-box;padding:9px 10px;border:1.5px solid #ccc;border-radius:8px;margin-bottom:10px;font-family:inherit;font-size:.9rem;" />
      <div style="display:flex;flex-direction:column;margin-bottom:6px;">${permCheckboxesHtml}</div>
      <div style="font-size:.76rem;color:var(--text-muted);margin-bottom:12px;">You can only grant permissions (and curriculum access) you hold yourself.</div>
      ${adminCurrScopePickerSectionHtml()}
      <button class="admin-assign-btn" id="adminAddAdminBtn" onclick="adminAssignAdminUI()" style="margin-top:14px;">➕ Add Admin</button>
      <div class="admin-status" id="adminManageStatus"></div>

      ${isSuperAdmin(user) ? `
      <h3 style="margin:26px 0 10px;font-size:1rem;">🛠️ Maintenance — inline image storage</h3>
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px;line-height:1.4;">
        Images are now stored inline, right on each question, instead of as separate hosted files. Content shared or
        published before this change may still point at one of those old files. Run these one at a time, in order.
      </div>
      <div style="border:1.5px solid #ccc;border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="font-weight:600;font-size:.9rem;margin-bottom:4px;">Step 1 — Migrate existing content</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:10px;">
          Walks every published curriculum lecture and every community quiz, pulls any remaining old-style image
          down, and re-saves it inline. Safe to run repeatedly — already-inline content is skipped.
        </div>
        <button class="admin-assign-btn" id="adminMigrateImagesBtn" onclick="adminMigrateLegacyImagesUI()">▶️ Migrate all images to inline storage</button>
        <div class="admin-status" id="adminMigrateImagesStatus"></div>
      </div>
      <div style="border:1.5px solid #ccc;border-radius:10px;padding:12px;">
        <div style="font-weight:600;font-size:.9rem;margin-bottom:4px;">Step 2 — Clean up old storage</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:10px;">
          ⚠️ Only run this after Step 1 shows nothing left to migrate. Permanently deletes every old separately-hosted
          image file and its tracking record — there's no undo. Anything not yet migrated will lose its image.
        </div>
        <button class="admin-assign-btn" id="adminSweepImagesBtn" onclick="adminSweepLegacyImagesUI()" style="background:#b23b3b;">🧹 Delete old image storage</button>
        <div class="admin-status" id="adminSweepImagesStatus"></div>
      </div>` : ''}
    </div>`;
}

const _MAINT_WORKER_BASE = 'https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev';

/**
 * Walks every published curriculum lecture and every community quiz,
 * fetching each one's content fresh (not the local IndexedDB cache — this
 * needs the real current state) and inlining any question still pointing
 * at a legacy separately-hosted image (see ensureInlineImages() in
 * firebase-storage.js). Only re-saves an item if it actually had
 * something to inline; already-migrated content (the common case, going
 * forward) is skipped with no write at all. Safe to run repeatedly.
 */
async function adminMigrateLegacyImagesUI() {
  const statusEl = document.getElementById('adminMigrateImagesStatus');
  const btn = document.getElementById('adminMigrateImagesBtn');
  if (btn) btn.disabled = true;

  let scanned = 0, migrated = 0, failed = 0;
  try {
    const { fetchCurriculumManifest, fetchCommunityManifest, putContentItem } = await import('./content-client.js');

    const currManifest = await fetchCurriculumManifest();
    for (const subject of Object.keys(currManifest)) {
      for (const lectureId of Object.keys(currManifest[subject] || {})) {
        scanned++;
        if (statusEl) statusEl.innerHTML = `<div class="cq-status info">⏳ Curriculum: ${scanned} scanned, ${migrated} migrated…</div>`;
        try {
          const resp = await fetch(`${_MAINT_WORKER_BASE}/curriculum/${subject}/${lectureId}.json`);
          if (!resp.ok) continue;
          const data = await resp.json();
          const hadRemote = (data.questions || []).some(q => q.image && /^https?:\/\//i.test(q.image));
          if (!hadRemote) continue; // already inline — nothing to do
          await ensureInlineImages(data.questions);
          await putContentItem('curriculum', subject, lectureId, data);
          migrated++;
        } catch (e) {
          console.warn(`Legacy-image migration failed for curriculum/${subject}/${lectureId}:`, e);
          failed++;
        }
      }
    }

    const commManifest = await fetchCommunityManifest();
    for (const quizId of Object.keys(commManifest)) {
      scanned++;
      if (statusEl) statusEl.innerHTML = `<div class="cq-status info">⏳ Community: ${scanned} scanned, ${migrated} migrated…</div>`;
      try {
        const resp = await fetch(`${_MAINT_WORKER_BASE}/community/${quizId}.json`);
        if (!resp.ok) continue;
        const data = await resp.json();
        const hadRemote = (data.questions || []).some(q => q.image && /^https?:\/\//i.test(q.image));
        if (!hadRemote) continue;
        await ensureInlineImages(data.questions);
        await putContentItem('community', null, quizId, data);
        migrated++;
      } catch (e) {
        console.warn(`Legacy-image migration failed for community/${quizId}:`, e);
        failed++;
      }
    }

    if (statusEl) {
      statusEl.innerHTML = migrated
        ? `<div class="cq-status success">✅ Done — ${scanned} scanned, ${migrated} migrated to inline storage${failed ? `, ⚠️ ${failed} failed (see browser console)` : ''}.</div>`
        : `<div class="cq-status success">✅ Done — ${scanned} scanned, nothing left to migrate${failed ? `, ⚠️ ${failed} failed (see browser console)` : ''}.</div>`;
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">❌ ${escapeHtml(e.message || String(e))}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Permanently deletes every leftover pre-inline-image R2 object and its
 * imageRefcounts/{hash} tracking doc (see the Worker's
 * /_admin/sweep-legacy-images endpoint). Destructive and irreversible —
 * only meaningful once Step 1 above has confirmed nothing is left
 * depending on those old files.
 */
async function adminSweepLegacyImagesUI() {
  if (!confirm("This permanently deletes every old separately-hosted image file and its tracking record — there's no undo, and anything not yet migrated will lose its image. Continue?")) return;
  if (!confirm('Please confirm once more: have you already run Step 1 (Migrate) and confirmed it found nothing left to migrate?')) return;

  const statusEl = document.getElementById('adminSweepImagesStatus');
  const btn = document.getElementById('adminSweepImagesBtn');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = `<div class="cq-status info">⏳ Sweeping old image storage…</div>`;

  try {
    const idToken = await window._currentUser.getIdToken();
    const resp = await fetch(`${_MAINT_WORKER_BASE}/_admin/sweep-legacy-images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` }
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();
    const ownerNote = result.docsWithNoKnownOwner
      ? ` (${result.docsWithNoKnownOwner} record${result.docsWithNoKnownOwner === 1 ? '' : 's'} had no recoverable file location and were only cleared)`
      : '';
    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ Swept ${result.refcountDocsSwept} record${result.refcountDocsSwept === 1 ? '' : 's'} — deleted ${result.objectsDeleted} old image file${result.objectsDeleted === 1 ? '' : 's'}${ownerNote}.</div>`;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<div class="cq-status error">❌ ${escapeHtml(e.message || String(e))}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
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
    await assignAdmin(window._currentUser, email, perms, adminNewAdminScope);
    if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ ${escapeHtml(email.trim().toLowerCase())} added as admin.</div>`;
    resetAdminNewAdminFormState();
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
  const body = document.getElementById('adminBody');

  // Both source tabs — "My Custom Quizzes" and "Community Quizzes" — are
  // just two ways of picking a quiz to publish into the curriculum, so
  // both are gated on 'curriculum' permission alone (the permission that
  // actually governs this whole tab, per adminSwitchTab above). Reading
  // sharedQuizzes itself requires no special permission in firestore.rules
  // either — any signed-in user can read that collection. 'community'
  // permission is reserved for the separate "Manage Community Quiz" tab
  // (moderation/deletion of shared quizzes), which is unrelated to simply
  // using a community quiz as a publish source here.
  if (!canCurriculum) adminSourceTab = 'custom'; // shouldn't happen (Publish tab itself requires 'curriculum'), but guard anyway

  // This panel and js/firebase-storage.js's student-facing Custom Quizzes
  // modal share one folder-tree UI (js/quiz-collections.js) and its
  // underlying state (active folder, expanded nodes, open popovers, etc).
  // Marking this panel as the "host" every time it renders means any
  // folder click / drag / rename fired from in here re-renders THIS panel
  // instead of the (hidden) student-facing modal. See cqCollectionsHost
  // in quiz-collections.js for the full explanation.
  cqCollectionsHost = 'admin';

  let listHtml = '';
  let listWrapClass = 'admin-quiz-list'; // scrollable flat list (community tab, or no custom quizzes yet)
  if (adminSourceTab === 'custom') {
    const quizzes     = loadCustomQuizzes();
    const collections = loadQuizCollections();
    if (!quizzes.length) {
      listHtml = `<div style="color:var(--text-muted);font-size:.88rem;padding:10px;">No custom quizzes found for your account.</div>`;
    } else {
      // Same folder tree + breadcrumb + filtered list as the "🤖 Custom
      // Quizzes" modal (see renderCustomQuizModal in firebase-storage.js),
      // just with admin-style quiz cards (click-to-select + ✓ check)
      // swapped in for the student-facing Start/Edit/Share/Delete ones.
      // Dragging a card onto a folder, or its own 📁 Move button, files it
      // into a collection exactly like it does over there — it's the same
      // underlying data, just browsed from a different screen.
      listWrapClass = 'admin-quiz-list-collections'; // layout owns its own sizing; no extra scroll box needed
      const visibleQuizzes = _filterQuizzesByActiveCollection(quizzes, collections);
      const itemsHtml = visibleQuizzes.length ? visibleQuizzes.map(q => {
        const sel = adminSelectedQuiz && adminSelectedQuiz.sourceType === 'custom' && adminSelectedQuiz.sourceId === q.id;
        const moveOpen = cqCollectionMoveMenuFor === q.id;
        const chip = _quizCollectionChipHTML(q, collections);
        return `
          <div class="admin-quiz-item ${sel ? 'selected' : ''}" draggable="true"
               ondragstart="cqQuizDragStart(event,'${q.id}')" ondragend="cqQuizDragEnd(event)"
               onclick="adminSelectQuiz('custom','${q.id}')">
            <span class="cq-drag-handle" onclick="event.stopPropagation()" title="Drag to a folder">⠿</span>
            <div class="admin-quiz-item-info">
              <div class="admin-quiz-item-title">${escapeHtml(q.title || 'Untitled Quiz')}</div>
              <div class="admin-quiz-item-meta">${(q.questions || []).length} question${(q.questions||[]).length !== 1 ? 's' : ''}</div>
              ${chip ? `<div style="margin-top:5px;">${chip}</div>` : ''}
            </div>
            <div class="cq-move-wrap">
              <button class="admin-quiz-move-btn" data-move-btn="${q.id}"
                      onclick="event.stopPropagation(); cqToggleQuizMoveMenu('${q.id}')" title="Move to a folder">📁</button>
              ${moveOpen ? _renderQuizMoveMenuHTML(q) : ''}
            </div>
            <div class="admin-quiz-item-check">✓</div>
          </div>`;
      }).join('') : `
        <div class="empty-state" style="padding:16px 12px;">
          <div class="empty-icon">📁</div>
          No quizzes in this folder yet — drag a quiz here, or use its 📁 Move button.
        </div>`;

      listHtml = `<div class="cq-coll-layout ${cqSidebarCollapsed ? 'cq-coll-sidebar-collapsed' : ''}">
        ${renderCqCollectionsSidebarHTML(quizzes, collections)}
        <div class="cq-coll-main">
          ${renderCqBreadcrumbHTML(collections)}
          <div class="cq-coll-quiz-list">${itemsHtml}</div>
        </div>
      </div>`;
    }
  } else {
    listHtml = `<div style="text-align:center;padding:20px;color:var(--text-muted);">⏳ Loading community quizzes…</div>`;
  }

  const sourceTabsHtml = `
    <div class="admin-quiz-source-tabs">
      ${canCurriculum ? `<button class="admin-source-tab ${adminSourceTab === 'custom' ? 'active' : ''}" onclick="adminSetSourceTab('custom')">🤖 My Custom Quizzes</button>` : ''}
      ${canCurriculum ? `<button class="admin-source-tab ${adminSourceTab === 'community' ? 'active' : ''}" onclick="adminSetSourceTab('community')">🌐 Community Quizzes</button>` : ''}
    </div>`;

  body.innerHTML = `
    ${sourceTabsHtml}
    <div id="adminCommSectionTabs"></div>
    <div id="adminCommFilterBar"></div>
    <div class="${listWrapClass}" id="adminQuizList">${listHtml}</div>
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
        // Reuse the one, already-fixed per-quiz-granular loader (js/community-quizzes.js)
        // instead of maintaining a third separate copy of the same logic.
        await ensureSharedQuizzesLoaded(false);
        const shared = _allSharedQuizzes.slice();
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
    const { deleteContentItem } = await import('./content-client.js');
    await deleteContentItem('community', null, sourceId); // also releases the quiz's images' refcounts
    adminCommunityCache = (adminCommunityCache || []).filter(q => q.id !== sourceId);
    _allSharedQuizzes = [];

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
    const ok = await ensureSharedQuizzesLoaded(forceReload);
    if (!ok) {
      body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--wrong-fg);">&#10060; Failed to load community quizzes. Please try again.</div>`;
      return;
    }
    adminCommunityCache = _allSharedQuizzes; // keep the Publish tab's copy of the cache in sync too
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

  // A scoped ('specific Year/Module/Subject') curriculum admin only ever
  // sees — and can only publish into — the part of the curriculum their
  // own access covers. This mirrors, and stays consistent with, the
  // firestore.rules server-side check (curriculumScopeAllowsSubject), so
  // this picker never lets someone attempt a publish that would just be
  // rejected by the server.
  const myScope = getCurriculumScope(window._currentUser);

  if (!adminPubTargetYear) {
    const years = Object.keys(curriculum).filter(y => scopeYearAccess(myScope, y) !== 'none');
    html += years.length ? years.map(y => `
      <div class="curr-item-row curr-item-open" onclick="adminOnYearChange('${escapeHtml(y)}')">
        <div style="flex:1;">
          <div class="curr-item-name">📅 ${escapeHtml(y)}</div>
          <div class="curr-item-sub">${Object.keys(curriculum[y] || {}).length} module(s)</div>
        </div>
        <span class="curr-item-arrow">▶</span>
      </div>`).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">${myScope.type === 'all' ? 'No years yet — add one in 📚 Manage Curriculum first.' : 'No years within your curriculum access.'}</div>`;

  } else if (!adminPubTargetModule) {
    const mods = Object.keys(curriculum[adminPubTargetYear] || {}).filter(m => scopeModuleAccess(myScope, adminPubTargetYear, m) !== 'none');
    html += mods.length ? mods.map(m => `
      <div class="curr-item-row curr-item-open" onclick="adminOnModuleChange('${escapeHtml(m)}')">
        <div style="flex:1;">
          <div class="curr-item-name">${escapeHtml(_moduleIcon(adminPubTargetYear, m))} ${escapeHtml(m)}</div>
          <div class="curr-item-sub">${(curriculum[adminPubTargetYear][m] || []).filter(k => subjects[k]).length} subject(s)</div>
        </div>
        <span class="curr-item-arrow">▶</span>
      </div>`).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No modules within your curriculum access in ${escapeHtml(adminPubTargetYear)}.</div>`;

  } else if (!adminPubTargetSubject) {
    const subs = (curriculum[adminPubTargetYear][adminPubTargetModule] || []).filter(k => subjects[k] && scopeSubjectAccess(myScope, adminPubTargetYear, adminPubTargetModule, k) === 'all');
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