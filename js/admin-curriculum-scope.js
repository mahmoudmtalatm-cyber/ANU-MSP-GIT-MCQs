/* ══════════════════════════════════════════════════════════
   SCOPED CURRICULUM PERMISSIONS
   ─────────────────────────────────────────────
   Lets an 'admins'-permission holder grant the 'curriculum' permission
   either for the WHOLE curriculum, or narrowed down to specific
   Year(s) / Module(s) / Subject(s) — mirrored and enforced server-side
   in firestore.rules (curriculumScopeAllowsSubject / _curriculumScopeIsAll).

   Roster entry shape (appConfig/adminRoster.admins[email]):
     {
       permissions: ['curriculum', ...],
       curriculumScope: {
         type: 'all'
       }
       // — or —
       curriculumScope: {
         type: 'scoped',
         years: {
           "Year 2": true, // whole year
           "Year 3": {
             "Module 4": true, // whole module
             "Module 5": ["subjKeyA", "subjKeyB"] // specific subjects only
           }
         }
       },
       addedBy, addedAt
     }

   Admins created before this feature existed have no curriculumScope
   field at all — getCurriculumScope() treats that as 'all', so nothing
   changes for them.

   NOTE ON SCOPE GRANULARITY: this intentionally stops at the Subject
   level — there is no per-quiz permission. Quiz-level management (the
   "Manage Curriculum" tab's Level 4) is simply available for every
   subject the admin's scope covers.

   NOTE ON STRUCTURAL EDITS: only a whole-curriculum ('all') admin may
   add/rename/delete a Year, Module, or Subject, or edit their icons
   (appConfig/curriculumExtensions). A scoped admin can fully manage
   (publish/edit/reorder/delete) quizzes anywhere within their granted
   scope, but cannot reshape the curriculum tree itself — see
   README.md → "Scoped Curriculum Permissions" and the matching comment
   block in firestore.rules for the reasoning.
══════════════════════════════════════════════════════════ */

/* ── Scope model ── */

/* Effective curriculum scope for a user: {type:'all'} for the super admin
   and for anyone with no explicit scope recorded (back-compat with admins
   created before this feature existed); otherwise their stored scope. */
function getCurriculumScope(user) {
  if (isSuperAdmin(user)) return { type: 'all' };
  if (!user || !user.email) return { type: 'scoped', years: {} };
  const email = user.email.toLowerCase();
  const entry = window._adminRoster && window._adminRoster[email];
  if (!entry || !Array.isArray(entry.permissions) || !entry.permissions.includes('curriculum')) {
    return { type: 'scoped', years: {} };
  }
  return entry.curriculumScope || { type: 'all' };
}

function curriculumScopeIsAll(user) {
  return getCurriculumScope(user).type === 'all';
}

/* Tri-state access level for a given Year / Module / Subject under a scope:
   'all' (fully granted), 'partial' (some but not all of what's beneath it
   is granted — Years/Modules only, Subjects are leaves so never partial),
   or 'none'. Used both for filtering nav lists and for rendering the
   scope-picker checkboxes. */
function scopeYearAccess(scope, year) {
  if (!scope || scope.type === 'all') return 'all';
  const y = scope.years && scope.years[year];
  if (y === true) return 'all';
  if (y && typeof y === 'object' && Object.keys(y).length) return 'partial';
  return 'none';
}
function scopeModuleAccess(scope, year, mod) {
  if (!scope || scope.type === 'all') return 'all';
  const y = scope.years && scope.years[year];
  if (y === true) return 'all';
  if (!y || typeof y !== 'object') return 'none';
  const m = y[mod];
  if (m === true) return 'all';
  if (Array.isArray(m) && m.length) return 'partial';
  return 'none';
}
function scopeSubjectAccess(scope, year, mod, key) {
  if (!scope || scope.type === 'all') return 'all';
  const y = scope.years && scope.years[year];
  if (y === true) return 'all';
  if (!y || typeof y !== 'object') return 'none';
  const m = y[mod];
  if (m === true) return 'all';
  if (Array.isArray(m) && m.includes(key)) return 'all';
  return 'none';
}

/* Find which Year/Module a subject key currently lives under, by scanning
   the live curriculum tree (curriculum[year][module] -> [subjectKeys]). */
function _subjectLocation(subjectKey) {
  for (const year of Object.keys(curriculum)) {
    for (const mod of Object.keys(curriculum[year] || {})) {
      if ((curriculum[year][mod] || []).includes(subjectKey)) return { year, module: mod };
    }
  }
  return null;
}

/* Can this user manage (publish / edit / delete quizzes into) this subject,
   per their curriculum scope? Client-side mirror of curriculumScopeAllowsSubject()
   in firestore.rules — keep both in sync if this logic ever changes. */
function canManageSubject(user, subjectKey) {
  if (!hasAdminPermission(user, 'curriculum')) return false;
  const scope = getCurriculumScope(user);
  if (scope.type === 'all') return true;
  const loc = _subjectLocation(subjectKey);
  return loc ? scopeSubjectAccess(scope, loc.year, loc.module, subjectKey) === 'all' : false;
}

/* Is `child` fully contained within `parent`? Used so an admin can never
   grant (or keep) curriculum access wider than their own — the same
   "you can only grant permissions you hold" rule the flat permissions
   list already enforces in assignAdmin(), extended to the finer-grained
   year/module/subject scope. */
function isCurriculumScopeSubset(child, parent) {
  if (!child || child.type === 'all') return !parent || parent.type === 'all';
  if (!parent || parent.type === 'all') return true;
  const childYears = child.years || {};
  for (const year of Object.keys(childYears)) {
    const childVal = childYears[year];
    const pAccess = scopeYearAccess(parent, year);
    if (childVal === true) {
      if (pAccess !== 'all') return false;
      continue;
    }
    if (pAccess === 'all') continue;
    if (pAccess === 'none') return false;
    const parentYear = parent.years[year];
    for (const mod of Object.keys(childVal || {})) {
      const childModVal = childVal[mod];
      const pModAccess = scopeModuleAccess(parent, year, mod);
      if (childModVal === true) {
        if (pModAccess !== 'all') return false;
        continue;
      }
      if (pModAccess === 'all') continue;
      if (pModAccess === 'none') return false;
      const childSubs = Array.isArray(childModVal) ? childModVal : [];
      const parentSubs = Array.isArray(parentYear[mod]) ? parentYear[mod] : [];
      if (!childSubs.every(s => parentSubs.includes(s))) return false;
    }
  }
  return true;
}

/* Clean up a working scope draft into the canonical shape before it's
   persisted — drops empty module/year entries left over from unchecking. */
function _normalizeCurriculumScope(scope) {
  if (!scope || scope.type === 'all') return { type: 'all' };
  const years = {};
  Object.keys(scope.years || {}).forEach(y => {
    const v = scope.years[y];
    if (v === true) { years[y] = true; return; }
    if (v && typeof v === 'object') {
      const mods = {};
      Object.keys(v).forEach(m => {
        const mv = v[m];
        if (mv === true) mods[m] = true;
        else if (Array.isArray(mv) && mv.length) mods[m] = mv.slice();
      });
      if (Object.keys(mods).length) years[y] = mods;
    }
  });
  return { type: 'scoped', years };
}

/* Human-readable summary for the Manage Admins roster list, e.g.
   "Year 2 (whole) · Year 3 › Module 4 (whole) · Year 3 › Module 5 › 2 subject(s)" */
function curriculumScopeSummary(scope) {
  if (!scope || scope.type === 'all') return 'Whole Curriculum';
  const years = scope.years || {};
  const parts = [];
  Object.keys(years).forEach(y => {
    const v = years[y];
    if (v === true) { parts.push(`${y} (whole)`); return; }
    Object.keys(v || {}).forEach(m => {
      const mv = v[m];
      if (mv === true) parts.push(`${y} › ${m} (whole)`);
      else if (Array.isArray(mv) && mv.length) parts.push(`${y} › ${m} › ${mv.length} subject${mv.length !== 1 ? 's' : ''}`);
    });
  });
  return parts.length ? parts.join(' · ') : 'No curriculum access selected';
}

/* ── "Add New Admin" scope-picker UI (Manage Admins tab) ──
   Its own drill-down state, entirely separate from the real Manage
   Curriculum tab's adminCurrNavLevel/adminTargetYear — navigating here
   never affects, and is never affected by, wherever the admin was last
   browsing there. Stops at Subject level (no quiz-level granularity). */
let adminNewAdminScope = { type: 'all' };
let adminScopePickLevel = 'years'; // 'years' | 'modules' | 'subjects'
let adminScopePickYear = '';
let adminScopePickModule = '';

// Which of the 3 "Add New Admin" permission checkboxes are currently
// checked, and the in-progress email draft. Tracked here (not just read
// off the DOM) because every scope-tree interaction below
// (adminScopeSetMode/ToggleYear/ToggleModule/ToggleSubject/Go*/Open*) calls
// a full renderAdminManagePanel() re-render to redraw the tree — and a
// full re-render rebuilds the checkboxes/input from scratch. Without this
// state living outside the DOM, that rebuild would drop back to the
// template's unchecked/empty defaults, which is exactly what used to make
// the 'curriculum' checkbox (and the scope section it reveals) appear to
// un-check itself the moment you picked a Year/Module/Subject or switched
// Whole/Specific mode. Every render now reads from here instead of
// re-deriving "checked" state from a DOM node that's about to be replaced.
let adminNewPermsChecked = { curriculum: false, community: false, admins: false };
let adminNewEmailDraft = '';

function resetAdminNewAdminScopeState() {
  const actingScope = getCurriculumScope(window._currentUser);
  adminNewAdminScope = actingScope.type === 'all' ? { type: 'all' } : { type: 'scoped', years: {} };
  adminScopePickLevel = 'years';
  adminScopePickYear = '';
  adminScopePickModule = '';
}

/* Resets the ENTIRE "Add New Admin" form — permission checkboxes, email
   draft, and curriculum scope/navigation state. Call this (not just
   resetAdminNewAdminScopeState) whenever the form should start fresh:
   opening the admin panel, or after successfully adding an admin. */
function resetAdminNewAdminFormState() {
  adminNewPermsChecked = { curriculum: false, community: false, admins: false };
  adminNewEmailDraft = '';
  resetAdminNewAdminScopeState();
}

/* Called on every "Add New Admin" permission checkbox's onchange. Persists
   the checkbox's checked state (see adminNewPermsChecked above) and, for
   'curriculum' specifically, shows/hides the scope-picker section — via a
   direct style update rather than a full re-render, so toggling a
   permission never disturbs anything else the admin has mid-way filled in. */
function adminOnPermCheckboxChange(perm) {
  const box = document.getElementById('adminNewPerm_' + perm);
  const checked = !!(box && box.checked);
  adminNewPermsChecked[perm] = checked;
  if (perm === 'curriculum') {
    const section = document.getElementById('adminCurrScopeSection');
    if (section) section.style.display = checked ? '' : 'none';
  }
}

function adminScopeSetMode(mode) {
  const actingScope = getCurriculumScope(window._currentUser);
  if (mode === 'all') {
    if (actingScope.type !== 'all') return; // guard — radio should already be disabled
    adminNewAdminScope = { type: 'all' };
  } else if (adminNewAdminScope.type === 'all') {
    adminNewAdminScope = { type: 'scoped', years: {} };
  }
  renderAdminManagePanel();
}

function _ensureScopedYears() {
  if (adminNewAdminScope.type !== 'scoped') adminNewAdminScope = { type: 'scoped', years: {} };
  if (!adminNewAdminScope.years) adminNewAdminScope.years = {};
  return adminNewAdminScope.years;
}
function adminScopeToggleYear(year) {
  const years = _ensureScopedYears();
  if (years[year] === true) delete years[year]; else years[year] = true;
  renderAdminManagePanel();
}
function adminScopeToggleModule(year, mod) {
  const years = _ensureScopedYears();
  if (years[year] === true) return; // whole year already covers every module
  if (!years[year] || typeof years[year] !== 'object') years[year] = {};
  if (years[year][mod] === true) {
    delete years[year][mod];
    if (!Object.keys(years[year]).length) delete years[year];
  } else {
    years[year][mod] = true;
  }
  renderAdminManagePanel();
}
function adminScopeToggleSubject(year, mod, key) {
  const years = _ensureScopedYears();
  if (years[year] === true) return;
  if (!years[year] || typeof years[year] !== 'object') years[year] = {};
  if (years[year][mod] === true) return; // whole module already covers every subject
  let arr = Array.isArray(years[year][mod]) ? years[year][mod].slice() : [];
  if (arr.includes(key)) arr = arr.filter(k => k !== key); else arr.push(key);
  if (arr.length) {
    years[year][mod] = arr;
  } else {
    delete years[year][mod];
    if (!Object.keys(years[year]).length) delete years[year];
  }
  renderAdminManagePanel();
}

function adminScopeGoYears() { adminScopePickYear = ''; adminScopePickModule = ''; adminScopePickLevel = 'years'; renderAdminManagePanel(); }
function adminScopeGoModules() { adminScopePickModule = ''; adminScopePickLevel = 'modules'; renderAdminManagePanel(); }
function adminScopeOpenYear(y) { adminScopePickYear = y; adminScopePickModule = ''; adminScopePickLevel = 'modules'; renderAdminManagePanel(); }
function adminScopeOpenModule(m) { adminScopePickModule = m; adminScopePickLevel = 'subjects'; renderAdminManagePanel(); }

function adminScopeBreadcrumbHtml() {
  let html = `<div class="curr-breadcrumb" style="margin:8px 0 4px;">`;
  html += `<span class="curr-crumb ${adminScopePickLevel === 'years' ? 'active' : ''}" onclick="adminScopeGoYears()"><svg class="micon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Years</span>`;
  if (adminScopePickYear) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${adminScopePickLevel === 'modules' ? 'active' : ''}" onclick="adminScopeGoModules()">${escapeHtml(adminScopePickYear)}</span>`;
  }
  if (adminScopePickModule) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb active">${escapeHtml(adminScopePickModule)}</span>`;
  }
  html += `</div>`;
  return html;
}

function adminScopeTreeHtml() {
  // Only lets the acting admin grant access within branches they themselves
  // can reach — an 'all' admin sees the full tree; a scoped admin only sees
  // (and can drill into) their own granted Years/Modules/Subjects.
  const actingScope = getCurriculumScope(window._currentUser);
  let html = adminScopeBreadcrumbHtml();
  if (adminScopePickLevel === 'modules') html += `<button class="curr-back-btn" type="button" onclick="adminScopeGoYears()">← Back to Years</button>`;
  if (adminScopePickLevel === 'subjects') html += `<button class="curr-back-btn" type="button" onclick="adminScopeGoModules()">← Back to Modules</button>`;

  html += `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;">`;

  if (adminScopePickLevel === 'years') {
    const years = Object.keys(curriculum).filter(y => scopeYearAccess(actingScope, y) !== 'none');
    html += years.length ? years.map(y => {
      const access = scopeYearAccess(adminNewAdminScope, y);
      const modCount = Object.keys(curriculum[y] || {}).length;
      return `
        <div class="curr-item-row scope-pick-row">
          <label class="scope-pick-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" ${access === 'all' ? 'checked' : ''} onchange="adminScopeToggleYear('${escapeHtml(y)}')" />
          </label>
          <div style="flex:1;min-width:0;cursor:pointer;" onclick="adminScopeOpenYear('${escapeHtml(y)}')">
            <div class="curr-item-name"><svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${escapeHtml(y)} ${access === 'partial' ? '<span class="scope-partial-badge">partial</span>' : ''}</div>
            <div class="curr-item-sub">${modCount} module(s)</div>
          </div>
          <span class="curr-item-arrow" onclick="adminScopeOpenYear('${escapeHtml(y)}')">▶</span>
        </div>`;
    }).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No years within your own curriculum access.</div>`;

  } else if (adminScopePickLevel === 'modules') {
    const year = adminScopePickYear;
    const mods = Object.keys(curriculum[year] || {}).filter(m => scopeModuleAccess(actingScope, year, m) !== 'none');
    html += mods.length ? mods.map(m => {
      const access = scopeModuleAccess(adminNewAdminScope, year, m);
      const subjCount = (curriculum[year][m] || []).filter(k => subjects[k]).length;
      return `
        <div class="curr-item-row scope-pick-row">
          <label class="scope-pick-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" ${access === 'all' ? 'checked' : ''} onchange="adminScopeToggleModule('${escapeHtml(year)}','${escapeHtml(m)}')" />
          </label>
          <div style="flex:1;min-width:0;cursor:pointer;" onclick="adminScopeOpenModule('${escapeHtml(m)}')">
            <div class="curr-item-name">${escapeHtml(_moduleIcon(year, m))} ${escapeHtml(m)} ${access === 'partial' ? '<span class="scope-partial-badge">partial</span>' : ''}</div>
            <div class="curr-item-sub">${subjCount} subject(s)</div>
          </div>
          <span class="curr-item-arrow" onclick="adminScopeOpenModule('${escapeHtml(m)}')">▶</span>
        </div>`;
    }).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No modules within your own curriculum access in ${escapeHtml(year)}.</div>`;

  } else {
    const year = adminScopePickYear, mod = adminScopePickModule;
    const keys = (curriculum[year] && curriculum[year][mod])
      ? curriculum[year][mod].filter(k => subjects[k] && scopeSubjectAccess(actingScope, year, mod, k) !== 'none')
      : [];
    html += keys.length ? keys.map(k => {
      const access = scopeSubjectAccess(adminNewAdminScope, year, mod, k);
      const s = subjects[k];
      return `
        <div class="curr-item-row scope-pick-row">
          <label class="scope-pick-checkbox">
            <input type="checkbox" ${access === 'all' ? 'checked' : ''} onchange="adminScopeToggleSubject('${escapeHtml(year)}','${escapeHtml(mod)}','${escapeHtml(k)}')" />
          </label>
          <div style="flex:1;min-width:0;">
            <div class="curr-item-name">${escapeHtml(s.icon || '📘')} ${escapeHtml(s.label || k)}</div>
          </div>
        </div>`;
    }).join('') : `<div style="color:var(--text-muted);font-size:.82rem;">No subjects within your own curriculum access in ${escapeHtml(mod)}.</div>`;
  }

  html += `</div>`;
  return html;
}

/* Full " Curriculum Access" section rendered inside the Add New Admin
   form — hidden by default; shown when the 'curriculum' checkbox is
   checked (adminNewPermsChecked.curriculum, kept in sync by
   adminOnPermCheckboxChange). */
function adminCurrScopePickerSectionHtml() {
  const actingScope = getCurriculumScope(window._currentUser);
  const actingIsAll = actingScope.type === 'all';
  const mode = adminNewAdminScope.type;

  return `
    <div class="curr-section" id="adminCurrScopeSection" style="display:${adminNewPermsChecked.curriculum ? '' : 'none'};margin-top:4px;">
      <div class="curr-section-title"><svg class="micon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Curriculum Access</div>
      <div class="scope-mode-row">
        <label class="scope-mode-opt">
          <input type="radio" name="adminScopeMode" ${mode === 'all' ? 'checked' : ''} ${!actingIsAll ? 'disabled' : ''}
                 onchange="adminScopeSetMode('all')" /> <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg> Whole Curriculum
        </label>
        <label class="scope-mode-opt">
          <input type="radio" name="adminScopeMode" ${mode === 'scoped' ? 'checked' : ''}
                 onchange="adminScopeSetMode('scoped')" /> <svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Specific Year / Module / Subject
        </label>
      </div>
      ${!actingIsAll ? `<div class="scope-hint">You can only grant curriculum access within what you hold: ${escapeHtml(curriculumScopeSummary(actingScope))}</div>` : ''}
      ${mode === 'scoped' ? adminScopeTreeHtml() : ''}
      <div class="scope-selection-summary">Granting: ${escapeHtml(curriculumScopeSummary(adminNewAdminScope))}</div>
    </div>`;
}