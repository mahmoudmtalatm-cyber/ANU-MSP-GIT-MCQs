/* ══════════════════════════════════════════════════════════
   ADMIN — MANAGE CURRICULUM
   UI for admin to create new Years, Modules, and Subjects.
══════════════════════════════════════════════════════════ */

// year -> module -> icon overrides created/edited by admin
let moduleIconMap = {};
// yearIconMap itself lives in app-core.js (declared before curriculum,
// since buildYearGrid() needs it on the very first render) — this file
// just reads/writes it, same as it does with moduleIconMap.

/* ══════════════════════════════════════════════════════════
   CURRICULUM TAB — drill-down navigation
   Years → Modules (within a year) → Subjects (within a module)
     → Quizzes (within a subject, no publish button — management only)
   Each level lets the admin add/rename/delete/edit at that level,
   and click a row to drill into it. adminTargetYear/Module/Subject
   (shared with the Publish tab) track the current drill position.
══════════════════════════════════════════════════════════ */
let adminCurrNavLevel = 'years'; // 'years' | 'modules' | 'subjects' | 'quizzes'

function renderAdminCurriculumPanel() {
  const body = document.getElementById('adminBody');
  if (!body) return;

  if (!hasAdminPermission(window._currentUser, 'curriculum')) {
    body.innerHTML = `<div style="padding:20px;color:var(--text-muted);">You do not have permission to manage the curriculum.</div>`;
    return;
  }

  // Guard against a stale deeper level if its parent selection got cleared
  if (adminCurrNavLevel === 'modules' && !adminTargetYear) adminCurrNavLevel = 'years';
  if (adminCurrNavLevel === 'subjects' && (!adminTargetYear || !adminTargetModule)) adminCurrNavLevel = 'modules';
  if (adminCurrNavLevel === 'quizzes' && (!adminTargetYear || !adminTargetModule || !adminTargetSubject)) adminCurrNavLevel = 'subjects';

  if (adminCurrNavLevel === 'years')    return renderAdminCurrYearsLevel(body);
  if (adminCurrNavLevel === 'modules')  return renderAdminCurrModulesLevel(body);
  if (adminCurrNavLevel === 'subjects') return renderAdminCurrSubjectsLevel(body);
  return renderAdminCurrQuizzesLevel(body);
}

function adminCurrBreadcrumbHtml() {
  let html = `<div class="curr-breadcrumb">`;
  html += `<span class="curr-crumb ${adminCurrNavLevel === 'years' ? 'active' : ''}" onclick="adminCurrGoYears()"><svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Years</span>`;
  if (adminTargetYear) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${adminCurrNavLevel === 'modules' ? 'active' : ''}" onclick="adminCurrGoModules()">${escapeHtml(adminTargetYear)}</span>`;
  }
  if (adminTargetModule) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${adminCurrNavLevel === 'subjects' ? 'active' : ''}" onclick="adminCurrGoSubjects()">${escapeHtml(adminTargetModule)}</span>`;
  }
  if (adminTargetSubject) {
    html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb active">${escapeHtml(subjects[adminTargetSubject]?.label || adminTargetSubject)}</span>`;
  }
  html += `</div>`;
  return html;
}

function adminCurrGoYears() {
  adminTargetYear = ''; adminTargetModule = ''; adminTargetSubject = '';
  adminCurrNavLevel = 'years';
  renderAdminCurriculumPanel();
}
function adminCurrGoModules() {
  adminTargetModule = ''; adminTargetSubject = '';
  adminCurrNavLevel = 'modules';
  renderAdminCurriculumPanel();
}
function adminCurrGoSubjects() {
  adminTargetSubject = '';
  adminCurrNavLevel = 'subjects';
  renderAdminCurriculumPanel();
}
function adminCurrOpenYear(year) {
  adminTargetYear = year; adminTargetModule = ''; adminTargetSubject = '';
  adminCurrNavLevel = 'modules';
  renderAdminCurriculumPanel();
}
function adminCurrOpenModule(mod) {
  adminTargetModule = mod; adminTargetSubject = '';
  adminCurrNavLevel = 'subjects';
  renderAdminCurriculumPanel();
}
function adminCurrOpenSubject(key) {
  adminTargetSubject = key;
  adminCurrNavLevel = 'quizzes';
  renderAdminCurriculumPanel();
}

/* ── LEVEL 1: Years ── */
function renderAdminCurrYearsLevel(body) {
  // Restructuring the curriculum (adding a Year, renaming/deleting one, or
  // editing its icon) is a whole-curriculum operation — see the matching
  // firestore.rules comment on appConfig/curriculumExtensions. A scoped
  // ("specific Year/Module/Subject") admin only sees, and can only drill
  // into, the Years their own access covers; the Add-Year form and every
  // structural edit button are hidden for them entirely.
  const scope  = getCurriculumScope(window._currentUser);
  const isFull = scope.type === 'all';
  const years  = Object.keys(curriculum).filter(y => isFull || scopeYearAccess(scope, y) !== 'none');

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${adminCurrBreadcrumbHtml()}

      <div class="curr-section">
        ${isFull ? `
        <div class="curr-section-title"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add New Academic Year</div>
        <div class="curr-row">
          <div class="curr-field">
            <label>Year Name (e.g. "Fourth Year")</label>
            <input type="text" id="currNewYear" placeholder="Fourth Year" maxlength="40" />
          </div>
          ${iconPickerFieldHtml('currNewYearIcon', _numberEmoji(years.length + 1), 'Icon')}
          <button class="curr-add-btn" onclick="adminAddYear()">Add Year</button>
        </div>
        <div class="curr-status" id="currYearStatus"></div>
        ` : `<div class="scope-hint"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Your curriculum access: ${escapeHtml(curriculumScopeSummary(scope))}. Only whole-curriculum admins can restructure Years/Modules/Subjects — you can still fully manage quizzes anywhere within your access.</div>`}
        <div class="curr-section-title" style="margin-top:10px;margin-bottom:6px;">Existing Years — tap one to manage its modules</div>
        <div id="currYearList">${years.length ? years.map((y, i) => `
          <div class="curr-item-row curr-item-open" onclick="adminCurrOpenYear('${escapeHtml(y)}')">
            <div style="flex:1;">
              <div class="curr-item-name">${escapeHtml(_yearIcon(y, i))} ${escapeHtml(y)}</div>
              <div class="curr-item-sub">${Object.keys(curriculum[y] || {}).length} module(s)</div>
            </div>
            ${isFull ? `
            <button class="curr-item-btn edit" onclick="event.stopPropagation();adminEditYearIcon('${escapeHtml(y)}')"><svg class="sicon" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1a1.6 1.6 0 0 1 1.6-1.6h2c3 0 5.5-2.5 5.5-5.6C22 6 17.5 2 12 2z"/></svg> Icon</button>
            <button class="curr-item-btn edit" onclick="event.stopPropagation();adminRenameYear('${escapeHtml(y)}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Rename</button>
            <button class="curr-item-btn del"  onclick="event.stopPropagation();adminDeleteYear('${escapeHtml(y)}')"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>
            ` : ''}
            <span class="curr-item-arrow">▶</span>
          </div>`).join('') : '<span style="color:var(--text-muted);font-size:.8rem;">None yet</span>'}</div>
      </div>

    </div>
  `;
}

/* ── LEVEL 2: Modules within a Year ── */
function renderAdminCurrModulesLevel(body) {
  const year = adminTargetYear;
  const scope  = getCurriculumScope(window._currentUser);
  const isFull = scope.type === 'all';
  const mods = Object.keys(curriculum[year] || {}).filter(m => isFull || scopeModuleAccess(scope, year, m) !== 'none');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${adminCurrBreadcrumbHtml()}
      <button class="curr-back-btn" onclick="adminCurrGoYears()">← Back to Years</button>

      <div class="curr-section">
        ${isFull ? `
        <div class="curr-section-title"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add New Module to "${escapeHtml(year)}"</div>
        <div class="curr-row">
          <div class="curr-field">
            <label>Module Name (e.g. "Module 5")</label>
            <input type="text" id="currNewModule" placeholder="Module 5" maxlength="60" />
          </div>
          ${iconPickerFieldHtml('currNewModuleIcon', '📚', 'Icon')}
          <button class="curr-add-btn" onclick="adminAddModule()">Add Module</button>
        </div>
        <div class="curr-status" id="currModuleStatus"></div>
        ` : `<div class="scope-hint"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Your curriculum access: ${escapeHtml(curriculumScopeSummary(scope))}. Only whole-curriculum admins can restructure Years/Modules/Subjects.</div>`}
        <div class="curr-section-title" style="margin-top:10px;margin-bottom:6px;">Modules in ${escapeHtml(year)} — tap one to manage its subjects</div>
        <div id="currModuleList">${mods.length ? mods.map(m => `
          <div class="curr-item-row curr-item-open" onclick="adminCurrOpenModule('${escapeHtml(m)}')">
            <div style="flex:1;">
              <div class="curr-item-name">${escapeHtml(_moduleIcon(year, m))} ${escapeHtml(m)}</div>
              <div class="curr-item-sub">${(curriculum[year][m] || []).filter(k => subjects[k]).length} subject(s)</div>
            </div>
            ${isFull ? `
            <button class="curr-item-btn edit" onclick="event.stopPropagation();adminEditModuleIcon('${escapeHtml(year)}','${escapeHtml(m)}')"><svg class="sicon" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1a1.6 1.6 0 0 1 1.6-1.6h2c3 0 5.5-2.5 5.5-5.6C22 6 17.5 2 12 2z"/></svg> Icon</button>
            <button class="curr-item-btn edit" onclick="event.stopPropagation();adminRenameModule('${escapeHtml(year)}','${escapeHtml(m)}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Rename</button>
            <button class="curr-item-btn del"  onclick="event.stopPropagation();adminDeleteModule('${escapeHtml(year)}','${escapeHtml(m)}')"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>
            ` : ''}
            <span class="curr-item-arrow">▶</span>
          </div>`).join('') : `<span style="color:var(--text-muted);font-size:.8rem;">${isFull ? 'No modules yet in this year' : 'No modules within your curriculum access in this year'}</span>`}</div>
      </div>

    </div>
  `;
}

/* ── LEVEL 3: Subjects within a Module ── */
function renderAdminCurrSubjectsLevel(body) {
  const year = adminTargetYear, mod = adminTargetModule;
  const scope  = getCurriculumScope(window._currentUser);
  const isFull = scope.type === 'all';
  const keys = (curriculum[year] && curriculum[year][mod])
    ? curriculum[year][mod].filter(k => subjects[k] && (isFull || scopeSubjectAccess(scope, year, mod, k) === 'all'))
    : [];
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${adminCurrBreadcrumbHtml()}
      <button class="curr-back-btn" onclick="adminCurrGoModules()">← Back to Modules</button>

      <div class="curr-section">
        ${isFull ? `
        <div class="curr-section-title"><svg class="sicon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add New Subject to "${escapeHtml(mod)}"</div>
        <div class="curr-row">
          <div class="curr-field">
            <label>Subject Label (shown to users)</label>
            <input type="text" id="currSubjLabel" placeholder="e.g. Pathology" maxlength="60" />
          </div>
          ${iconPickerFieldHtml('currSubjIcon', '📘', 'Icon')}
        </div>
        <div class="curr-row">
          <div class="curr-field">
            <label>Internal Key (unique ID, letters/numbers/_)</label>
            <input type="text" id="currSubjKey" placeholder="e.g. pathology_4" maxlength="40"
              oninput="this.value=this.value.replace(/[^a-zA-Z0-9_]/g,'')" />
          </div>
          <button class="curr-add-btn secondary" onclick="adminAddSubject()">Add Subject</button>
        </div>
        <div class="curr-status" id="currSubjStatus"></div>
        ` : `<div class="scope-hint"><svg class="sicon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Your curriculum access: ${escapeHtml(curriculumScopeSummary(scope))}. Only whole-curriculum admins can restructure Years/Modules/Subjects — tap a subject below to manage its quizzes.</div>`}
        <div class="curr-section-title" style="margin-top:10px;margin-bottom:6px;">Subjects in ${escapeHtml(mod)} — tap one to manage its quizzes</div>
        <div id="currSubjList" class="curr-list">${keys.length ? keys.map(k => {
          const s = subjects[k];
          return `<div class="curr-item-row curr-item-open" onclick="adminCurrOpenSubject('${escapeHtml(k)}')">
            <div style="flex:1;">
              <div class="curr-item-name">${escapeHtml(s.icon || '📘')} ${escapeHtml(s.label || k)}</div>
              <div class="curr-item-sub">key: ${escapeHtml(k)}</div>
            </div>
            ${isFull ? `
            <button class="curr-item-btn edit" onclick="event.stopPropagation();adminEditSubjectIcon('${escapeHtml(k)}')"><svg class="sicon" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1a1.6 1.6 0 0 1 1.6-1.6h2c3 0 5.5-2.5 5.5-5.6C22 6 17.5 2 12 2z"/></svg> Icon</button>
            <button class="curr-item-btn edit" onclick="event.stopPropagation();adminRenameSubject('${escapeHtml(k)}')"><svg class="sicon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Rename</button>
            <button class="curr-item-btn del"  onclick="event.stopPropagation();adminDeleteSubject('${escapeHtml(k)}')"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>
            ` : ''}
            <span class="curr-item-arrow">▶</span>
          </div>`;
        }).join('') : '<span style="color:var(--text-muted);font-size:.8rem;">No subjects yet in this module</span>'}</div>
      </div>

    </div>
  `;
}

/* ── LEVEL 4: Quizzes within a Subject (management only — no publish button) ──
   Reuses renderAdminAssignedList() (Edit / Copy-Move / Delete / reorder),
   the same list and functions the Publish tab uses after publishing. */
function renderAdminCurrQuizzesLevel(body) {
  // Defensive: if the admin's own scope changed (or was revoked) live while
  // this level was open, don't let a stale deep-link stay parked on a
  // subject they can no longer manage.
  if (!canManageSubject(window._currentUser, adminTargetSubject)) {
    adminCurrGoSubjects();
    return;
  }
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${adminCurrBreadcrumbHtml()}
      <button class="curr-back-btn" onclick="adminCurrGoSubjects()">← Back to Subjects</button>

      <div class="curr-section">
        <div class="curr-section-title"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Manage Quizzes — ${escapeHtml(subjects[adminTargetSubject]?.label || adminTargetSubject)}</div>
        <div style="font-size:.78rem;color:var(--text-muted);font-weight:600;margin-bottom:10px;">
          View, edit, reorder, copy/move, or delete the quizzes published to this subject.
        </div>
        <div class="admin-assigned-section" id="adminAssignedSection"></div>
      </div>

    </div>
  `;
  renderAdminAssignedList();
}

async function adminAddYear() {
  const input  = document.getElementById('currNewYear');
  const iconIn = document.getElementById('currNewYearIcon');
  const status = document.getElementById('currYearStatus');
  const name   = (input?.value || '').trim();
  const icon   = (iconIn?.value || '').trim() || _numberEmoji(Object.keys(curriculum).length + 1);
  if (!name)          { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Please enter a year name.'; status.className = 'curr-status err'; return; }
  if (curriculum[name]) { status.innerHTML = `<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> "${name}" already exists.`; status.className = 'curr-status err'; return; }
  curriculum[name] = {};
  yearIconMap[name] = icon;
  addCustomIcon(icon);
  buildYearGrid();
  status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Saving…'; void 0; status.className = 'curr-status';
  await saveCurriculumStructure();
  status.innerHTML = `<svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Year "${name}" added! You can now add modules to it.`;
  status.className = 'curr-status ok';
  input.value = '';
  selectIconForField('currNewYearIcon', _numberEmoji(Object.keys(curriculum).length + 1));
  setTimeout(() => renderAdminCurriculumPanel(), 400);
}

async function adminEditYearIcon(year) {
  const idx = Object.keys(curriculum).indexOf(year);
  const current = _yearIcon(year, idx < 0 ? 0 : idx);
  const newIcon = prompt(`Set icon for year "${year}" (paste any emoji):`, current);
  if (newIcon === null) return;
  const icon = newIcon.trim() || current;
  yearIconMap[year] = icon;
  addCustomIcon(icon);
  buildYearGrid();
  await saveCurriculumStructure();
  renderAdminCurriculumPanel();
}

async function adminAddModule() {
  const input   = document.getElementById('currNewModule');
  const iconIn  = document.getElementById('currNewModuleIcon');
  const status  = document.getElementById('currModuleStatus');
  const yr  = adminTargetYear;
  const mod = (input?.value || '').trim();
  const icon = (iconIn?.value || '').trim() || '📚';
  if (!yr)  { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Select a year first.'; status.className = 'curr-status err'; return; }
  if (!mod) { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Enter a module name.'; status.className = 'curr-status err'; return; }
  if (!curriculum[yr]) { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Year not found.'; status.className = 'curr-status err'; return; }
  if (curriculum[yr][mod]) { status.innerHTML = `<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Module "${mod}" already exists in ${yr}.`; status.className = 'curr-status err'; return; }
  curriculum[yr][mod] = [];
  if (!moduleIconMap[yr]) moduleIconMap[yr] = {};
  moduleIconMap[yr][mod] = icon;
  buildYearGrid();
  status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Saving…'; void 0; status.className = 'curr-status';
  await saveCurriculumStructure();
  status.innerHTML = `<svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Module "${mod}" added to ${yr}!`;
  status.className = 'curr-status ok';
  input.value = '';
  setTimeout(() => renderAdminCurriculumPanel(), 400);
}

/* Look up the icon for a module: admin-set icon > default */
function _moduleIcon(year, mod) {
  return (moduleIconMap[year] && moduleIconMap[year][mod])
    || '📚';
}

async function adminEditModuleIcon(year, mod) {
  const current = _moduleIcon(year, mod);
  const newIcon = prompt(`Set icon for module "${mod}" (paste any emoji):`, current);
  if (newIcon === null) return;
  const icon = newIcon.trim() || current;
  if (!moduleIconMap[year]) moduleIconMap[year] = {};
  moduleIconMap[year][mod] = icon;
  addCustomIcon(icon);
  buildYearGrid();
  await saveCurriculumStructure();
  renderAdminCurriculumPanel();
}

async function adminAddSubject() {
  const labelIn = document.getElementById('currSubjLabel');
  const iconIn  = document.getElementById('currSubjIcon');
  const keyIn   = document.getElementById('currSubjKey');
  const status  = document.getElementById('currSubjStatus');
  const yr    = adminTargetYear;
  const mod   = adminTargetModule;
  const label = (labelIn?.value || '').trim();
  const icon  = (iconIn?.value  || '').trim() || '📘';
  const key   = (keyIn?.value   || '').trim();
  if (!yr)    { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Select a year.';          status.className = 'curr-status err'; return; }
  if (!mod)   { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Select a module.';        status.className = 'curr-status err'; return; }
  if (!label) { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Enter a subject label.';  status.className = 'curr-status err'; return; }
  if (!key)   { status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Enter an internal key.';  status.className = 'curr-status err'; return; }
  if (subjects[key]) { status.innerHTML = `<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Key "${key}" already exists. Choose another.`; status.className = 'curr-status err'; return; }
  status.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Saving…'; void 0; status.className = 'curr-status';
  subjects[key] = { icon, label, lectures: {} };
  if (!curriculum[yr]) curriculum[yr] = {};
  if (!curriculum[yr][mod]) curriculum[yr][mod] = [];
  if (!curriculum[yr][mod].includes(key)) curriculum[yr][mod].push(key);
  buildYearGrid();
  await saveCurriculumExtensionSubject(key, { icon, label, year: yr, module: mod });
  status.innerHTML = `<svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Subject "${label}" added to ${yr} → ${mod}!`;
  status.className = 'curr-status ok';
  labelIn.value = ''; keyIn.value = '';
  selectIconForField('currSubjIcon', '📘');
  setTimeout(() => renderAdminCurriculumPanel(), 400);
}

/* ══════════════════════════════════════════════════════════
   CURRICULUM EXTENSIONS — admin-created Years / Modules / Subjects
   Stored in a single doc: appConfig/curriculumExtensions
   Shape: {
     years: ["Year Name", ...],
     modules: { "Year Name": ["Module Name", ...] },
     subjects: { [subjectKey]: {icon, label, year, module} }
   }
══════════════════════════════════════════════════════════ */
async function loadCurriculumExtensions() {
  if (!window._db) return;
  try {
    /* ── 1. Check server version (tiny fetch) ── */
    const serverVer  = await _fetchServerCacheVersion();
    const localVer   = _readCacheVer();
    const cached     = await _readCache();

    if (serverVer && localVer === serverVer && cached && cached.curriculum) {
      /* Cache hit — apply immediately, no heavy Firestore read */
      console.log('[cache] curriculum hit, skipping Firestore fetch');
      _applyCurriculumCache(cached);
      return;
    }

    /* ── 2. Cache miss — do the real fetch ── */
    const ref  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
    const snap = await window._getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    // Restore admin-created years
    const extYears = data.years || [];
    extYears.forEach(yr => {
      if (!curriculum[yr]) curriculum[yr] = {};
    });

    // Restore admin-set year icons
    const extYearIcons = data.yearIcons || {};
    yearIconMap = extYearIcons;

    // Restore admin-created modules
    const extModules = data.modules || {};
    Object.entries(extModules).forEach(([yr, mods]) => {
      if (!curriculum[yr]) curriculum[yr] = {};
      (mods || []).forEach(mod => {
        if (!curriculum[yr][mod]) curriculum[yr][mod] = [];
      });
    });

    // Restore admin-set module icons
    const extModuleIcons = data.moduleIcons || {};
    moduleIconMap = extModuleIcons;

    // Restore admin-created subjects
    const extSubjects = data.subjects || {};
    Object.entries(extSubjects).forEach(([key, info]) => {
      if (!subjects[key]) {
        subjects[key] = { icon: info.icon || '📘', label: info.label || key, lectures: {} };
      }
      const year = info.year, mod = info.module;
      if (!year || !mod) return;
      if (!curriculum[year]) curriculum[year] = {};
      if (!curriculum[year][mod]) curriculum[year][mod] = [];
      if (!curriculum[year][mod].includes(key)) curriculum[year][mod].push(key);
    });

    buildYearGrid();
    _reRenderOpenSelections();

    /* ── 3. Save to cache (merge with any existing published cache) ──
       Do this even when the doc didn't exist / was empty, so we still
       record "nothing to load" and skip re-fetching next time. */
    const existing = (await _readCache()) || {};
    existing.curriculum = { extYears, extModules, extModuleIcons, extSubjects, extYearIcons };
    await _writeCache(existing);
    let verToStore = serverVer;
    if (!verToStore) verToStore = await bumpCacheVersion(); // doc doesn't exist yet — create the baseline
    if (verToStore) _writeCacheVer(verToStore);

  } catch (e) {
    console.warn('Failed to load curriculum extensions:', e);
  } finally {
    _fsReady.curriculum = true;
  }
}

/* Persist admin-created Years and Modules structure */
async function saveCurriculumStructure() {
  if (!window._db) return;
  try {
    const ref  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
    const snap = await window._getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    // Collect all admin-added years (those not hardcoded, or just save all)
    const allYears = Object.keys(curriculum);
    const modulesMap = {};
    allYears.forEach(yr => {
      const mods = Object.keys(curriculum[yr] || {});
      if (mods.length > 0) modulesMap[yr] = mods;
    });

    data.years   = allYears;
    data.modules = modulesMap;
    data.moduleIcons = moduleIconMap;
    data.yearIcons = yearIconMap;
    if (!data.subjects) data.subjects = {};
    await window._setDoc(ref, cleanForFirestore(data));
    _clearCache();
    await bumpCacheVersion();
  } catch (e) {
    console.warn('Failed to save curriculum structure:', e);
  }
}


/* ══════════════════════════════════════════════════════════
   QUIZ COPY / MOVE BETWEEN SECTIONS
══════════════════════════════════════════════════════════ */

let _moveQuizLectureId   = null;
let _moveQuizLectureName = null;
let _moveQuizModal       = null;

function adminOpenMoveQuiz(lectureId, encodedName) {
  _moveQuizLectureId   = lectureId;
  _moveQuizLectureName = decodeURIComponent(encodedName);

  // Build year options
  const years = Object.keys(curriculum);
  const yearOpts = years.map(y =>
    `<option value="${escapeHtml(y)}" ${y === adminTargetYear ? 'selected' : ''}>${escapeHtml(y)}</option>`
  ).join('');

  // Build module options for selected year
  const mods = adminTargetYear ? Object.keys(curriculum[adminTargetYear] || {}) : [];
  const modOpts = mods.map(m =>
    `<option value="${escapeHtml(m)}" ${m === adminTargetModule ? 'selected' : ''}>${escapeHtml(m)}</option>`
  ).join('') || `<option value="">— No modules —</option>`;

  // Build subject options for selected year+module
  const subs = (adminTargetYear && adminTargetModule)
    ? (curriculum[adminTargetYear][adminTargetModule] || []).filter(k => subjects[k])
    : [];
  const subjOpts = subs.map(s =>
    `<option value="${escapeHtml(s)}">${escapeHtml(subjects[s].label || s)}</option>`
  ).join('') || `<option value="">— No subjects —</option>`;

  const el = document.createElement('div');
  el.className = 'qm-overlay';
  el.id = 'moveQuizModal';
  el.innerHTML = `
    <div class="qm-modal">
      <div class="qm-title"><svg class="sicon" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Copy / Move Quiz</div>
      <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:14px;">
        Quiz: <strong>${escapeHtml(_moveQuizLectureName)}</strong><br>
        From: <strong>${escapeHtml(adminTargetYear)} → ${escapeHtml(adminTargetModule)} → ${escapeHtml(subjects[adminTargetSubject]?.label || adminTargetSubject)}</strong>
      </div>
      <div class="qm-field">
        <label>Destination Year</label>
        <select id="mqYear" onchange="mqYearChange(this.value)">${yearOpts}</select>
      </div>
      <div class="qm-field">
        <label>Destination Module</label>
        <select id="mqModule" onchange="mqModuleChange(this.value)">${modOpts}</select>
      </div>
      <div class="qm-field">
        <label>Destination Subject</label>
        <select id="mqSubject">${subjOpts}</select>
      </div>
      <div class="qm-field">
        <label>Quiz Name (in destination)</label>
        <input type="text" id="mqName" value="${escapeHtml(_moveQuizLectureName)}" maxlength="120" />
      </div>
      <div id="mqStatus"></div>
      <div class="qm-actions">
        <button class="qm-btn primary" onclick="adminExecMoveQuiz(false)"><svg class="sicon" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Copy</button>
        <button class="qm-btn danger"  onclick="adminExecMoveQuiz(true)"><svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Move (delete original)</button>
        <button class="qm-btn secondary" onclick="adminCloseMoveQuiz()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  _moveQuizModal = el;
}

function mqYearChange(yr) {
  const mods = yr ? Object.keys(curriculum[yr] || {}) : [];
  document.getElementById('mqModule').innerHTML = mods.map(m =>
    `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
  ).join('') || `<option value="">— No modules —</option>`;
  mqModuleChange(mods[0] || '');
}

function mqModuleChange(mod) {
  const yr   = document.getElementById('mqYear').value;
  const subs = (yr && mod) ? (curriculum[yr][mod] || []).filter(k => subjects[k]) : [];
  document.getElementById('mqSubject').innerHTML = subs.map(s =>
    `<option value="${escapeHtml(s)}">${escapeHtml(subjects[s].label || s)}</option>`
  ).join('') || `<option value="">— No subjects —</option>`;
}

async function adminExecMoveQuiz(andDelete) {
  const destYear    = document.getElementById('mqYear')?.value;
  const destModule  = document.getElementById('mqModule')?.value;
  const destSubject = document.getElementById('mqSubject')?.value;
  const destName    = (document.getElementById('mqName')?.value || '').trim() || _moveQuizLectureName;
  const statusEl    = document.getElementById('mqStatus');

  if (!destYear || !destModule || !destSubject) {
    statusEl.className = 'qm-status err';
    statusEl.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Please select a destination year, module, and subject.';
    return;
  }
  if (destSubject === adminTargetSubject && !andDelete) {
    statusEl.className = 'qm-status err';
    statusEl.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Source and destination subject are the same.';
    return;
  }

  statusEl.className = 'qm-status';
  statusEl.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="2.2"/><ellipse cx="12" cy="19" rx="7" ry="2.2"/><path d="M5 5c0 5 5 5 5 7s-5 2-5 7M19 5c0 5-5 5-5 7s5 2 5 7"/></svg> Working…';

  try {
    // Fetch the source lecture from R2 (images already resolved, permanent URLs)
    const srcResp = await fetch(`https://anu-msp-question-bank-worker.mahmoudmtalat.workers.dev/curriculum/${adminTargetSubject}/${_moveQuizLectureId}.json`);
    if (!srcResp.ok) throw new Error('Source lecture not found.');
    const srcData = await srcResp.json();

    const questions = JSON.parse(JSON.stringify(srcData.questions || []));
    // Images are inline data: URLs on each question — copying/moving to a
    // different subject doesn't affect them at all, they're just part of
    // the JSON. Opportunistic migration: inline any legacy remote image
    // reference while we're touching this lecture anyway.
    await ensureInlineImages(questions);

    const newId = 'pub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const publishedAt = Date.now();

    const { putContentItem } = await import('./content-client.js');
    await putContentItem('curriculum', destSubject, newId, {
      id: newId,
      lectureName: destName,
      questions,
      sourceTitle: srcData.sourceTitle || _moveQuizLectureName,
      sourceType:  srcData.sourceType  || 'copy',
      publishedBy: window._currentUser ? window._currentUser.uid : null,
      publishedAt,
      order: publishedAt // appended to the end of the destination subject's list
    });

    // Update in-memory for destination subject
    if (!subjects[destSubject].lectures) subjects[destSubject].lectures = {};
    subjects[destSubject].lectures[destName] = JSON.parse(JSON.stringify(questions));

    // If move: delete original
    if (andDelete) {
      const { deleteContentItem } = await import('./content-client.js');
      await deleteContentItem('curriculum', adminTargetSubject, _moveQuizLectureId); // also updates the manifest server-side
      const srcLecName = srcData.lectureName || _moveQuizLectureId;
      if (subjects[adminTargetSubject].lectures) {
        delete subjects[adminTargetSubject].lectures[srcLecName];
      }
    }

    statusEl.className = 'qm-status ok';
    statusEl.textContent = andDelete
      ? `<svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Moved to ${subjects[destSubject].label || destSubject}!`
      : `<svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Copied to ${subjects[destSubject].label || destSubject}!`;
    // Manifest bump for the new destination lecture already happened
    // server-side in the Worker (as part of putContentItem above) — no
    // separate call needed here.

    // Refresh views
    if (selectedSubject === adminTargetSubject || selectedSubject === destSubject) {
      selectSubject(selectedSubject);
    }
    renderAdminAssignedList();

    setTimeout(() => adminCloseMoveQuiz(), 1000);
  } catch (e) {
    statusEl.className = 'qm-status err';
    statusEl.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ' + (e.message || String(e));
  }
}

function adminCloseMoveQuiz() {
  if (_moveQuizModal) { _moveQuizModal.remove(); _moveQuizModal = null; }
  _moveQuizLectureId = null; _moveQuizLectureName = null;
}

/* ══════════════════════════════════════════════════════════
   CURRICULUM — DELETE / RENAME  Years, Modules, Subjects
══════════════════════════════════════════════════════════ */

/* ── YEAR ── */
async function adminRenameYear(oldName) {
  const newName = prompt(`Rename year "${oldName}" to:`, oldName);
  if (!newName || newName.trim() === oldName) return;
  const n = newName.trim();
  if (curriculum[n]) { alert(`"${n}" already exists.`); return; }
  // Migrate in-memory curriculum
  curriculum[n] = curriculum[oldName];
  delete curriculum[oldName];
  // Migrate the year's icon too, so a rename doesn't reset it back to the
  // auto-numbered fallback
  if (yearIconMap[oldName]) {
    yearIconMap[n] = yearIconMap[oldName];
    delete yearIconMap[oldName];
  }
  // Migrate extensions subjects
  const extRef  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
  const extSnap = await window._getDoc(extRef);
  const ext = extSnap.exists() ? extSnap.data() : {};
  // Update subjects that referenced old year
  if (ext.subjects) {
    Object.values(ext.subjects).forEach(s => { if (s.year === oldName) s.year = n; });
  }
  // Update modules map
  if (ext.modules && ext.modules[oldName]) {
    ext.modules[n] = ext.modules[oldName];
    delete ext.modules[oldName];
  }
  ext.years = Object.keys(curriculum);
  ext.yearIcons = yearIconMap;
  await window._setDoc(extRef, cleanForFirestore(ext));
  _clearCache(); await bumpCacheVersion();
  buildYearGrid();
  renderAdminCurriculumPanel();
}

/* ── CASCADING DELETE HELPERS ──
   Deleting a Year/Module/Subject now permanently removes every subject
   underneath it AND all of that subject's published quizzes from
   Firestore (publishedQuestions/{subject}/lectures/*, their images
   subcollections, and their entries in appConfig/publishedManifest) —
   not just their placement in the curriculum UI. This is destructive
   and irreversible, so every cascading delete requires TWO confirmation
   steps: a plain confirm() describing the blast radius, then a prompt()
   that requires typing the exact name back to proceed. */

/* Step 1: confirm() with the blast-radius summary.
   Step 2: prompt() requiring the admin to type `typeToConfirm` exactly.
   Returns true only if both steps pass. */
function _confirmCascadeDelete(title, detail, typeToConfirm) {
  if (!confirm(`${title}\n\n${detail}\n\nThis cannot be undone.`)) return false;
  const typed = prompt(`FINAL CONFIRMATION — this cannot be undone.\n\nType "${typeToConfirm}" exactly (case-sensitive) to permanently delete this from Firestore:`);
  if (typed === null) return false; // cancelled
  if (typed !== typeToConfirm) {
    alert('Text did not match — deletion cancelled. Nothing was changed.');
    return false;
  }
  return true;
}

/* Permanently deletes every published quiz belonging to one subject:
   each lecture's content + images (via the Worker, which also releases
   their image refcounts) and its local IndexedDB cache entry. The
   Worker's delete handler already cleans up that subject's entry in
   appConfig/publishedManifest once its last lecture is removed — no
   separate manifest cleanup needed here. Also clears the subject's
   in-memory lecture list. Used by adminDeleteSubject/-Module/-Year cascades. */
async function _deleteSubjectQuizzesFromFirestore(subjKey) {
  try {
    const { fetchCurriculumManifest, deleteContentItem } = await import('./content-client.js');
    const manifest = await fetchCurriculumManifest();
    const lectureIds = Object.keys(manifest[subjKey] || {});
    await Promise.all(lectureIds.map(async (lectureId) => {
      await deleteContentItem('curriculum', subjKey, lectureId);
      await _idbDelete('published:' + subjKey + ':' + lectureId);
    }));
  } catch (e) {
    console.warn('Failed to delete published quizzes for subject', subjKey, e);
  }
  if (subjects[subjKey]) subjects[subjKey].lectures = {};
}

async function adminDeleteYear(name) {
  const modCount = Object.keys(curriculum[name] || {}).length;
  const subjKeys = Object.values(curriculum[name] || {}).flat();

  if (!_confirmCascadeDelete(
    `Delete year "${name}"?`,
    `This will PERMANENTLY delete ${modCount} module(s), ${subjKeys.length} subject(s), and ALL of their published quizzes — from the website AND Firestore.`,
    name
  )) return;

  // Cascade: wipe every subject's published quizzes from Firestore first,
  // then drop the subjects themselves from memory.
  for (const key of subjKeys) {
    await _deleteSubjectQuizzesFromFirestore(key);
    delete subjects[key];
  }

  delete curriculum[name];
  delete yearIconMap[name];
  // Remove from extensions
  const extRef  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
  const extSnap = await window._getDoc(extRef);
  const ext = extSnap.exists() ? extSnap.data() : {};
  ext.years = Object.keys(curriculum);
  ext.yearIcons = yearIconMap;
  if (ext.modules) delete ext.modules[name];
  // Remove subjects that belonged to this year
  if (ext.subjects) {
    subjKeys.forEach(k => { delete ext.subjects[k]; });
  }
  await window._setDoc(extRef, cleanForFirestore(ext));
  _clearCache(); await bumpCacheVersion();
  buildYearGrid();
  renderAdminCurriculumPanel();
}

/* ── MODULE ── */
async function adminRenameModule(year, oldMod) {
  const newMod = prompt(`Rename module "${oldMod}" (in ${year}) to:`, oldMod);
  if (!newMod || newMod.trim() === oldMod) return;
  const n = newMod.trim();
  if (curriculum[year][n]) { alert(`"${n}" already exists in ${year}.`); return; }
  curriculum[year][n] = curriculum[year][oldMod];
  delete curriculum[year][oldMod];
  // Carry the icon over to the new module name
  if (moduleIconMap[year] && moduleIconMap[year][oldMod]) {
    moduleIconMap[year][n] = moduleIconMap[year][oldMod];
    delete moduleIconMap[year][oldMod];
  }
  // Update subjects in extensions
  const extRef  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
  const extSnap = await window._getDoc(extRef);
  const ext = extSnap.exists() ? extSnap.data() : {};
  if (ext.subjects) {
    Object.values(ext.subjects).forEach(s => { if (s.year === year && s.module === oldMod) s.module = n; });
  }
  if (ext.modules && ext.modules[year]) {
    ext.modules[year] = Object.keys(curriculum[year]);
  }
  ext.moduleIcons = moduleIconMap;
  ext.years = Object.keys(curriculum);
  await window._setDoc(extRef, cleanForFirestore(ext));
  _clearCache(); await bumpCacheVersion();
  buildYearGrid();
  renderAdminCurriculumPanel();
}

async function adminDeleteModule(year, mod) {
  const subjKeys = curriculum[year][mod] || [];

  if (!_confirmCascadeDelete(
    `Delete module "${mod}" from ${year}?`,
    `This will PERMANENTLY delete ${subjKeys.length} subject(s) and ALL of their published quizzes — from the website AND Firestore.`,
    mod
  )) return;

  // Cascade: wipe every subject's published quizzes from Firestore first,
  // then drop the subjects themselves from memory.
  for (const key of subjKeys) {
    await _deleteSubjectQuizzesFromFirestore(key);
    delete subjects[key];
  }

  delete curriculum[year][mod];
  if (moduleIconMap[year]) delete moduleIconMap[year][mod];
  const extRef  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
  const extSnap = await window._getDoc(extRef);
  const ext = extSnap.exists() ? extSnap.data() : {};
  if (ext.modules && ext.modules[year]) {
    ext.modules[year] = Object.keys(curriculum[year]);
  }
  if (ext.subjects) {
    subjKeys.forEach(k => { delete ext.subjects[k]; });
  }
  ext.moduleIcons = moduleIconMap;
  ext.years = Object.keys(curriculum);
  await window._setDoc(extRef, cleanForFirestore(ext));
  _clearCache(); await bumpCacheVersion();
  buildYearGrid();
  renderAdminCurriculumPanel();
}

/* ── SUBJECT ── */
/* Shared persist step for a label/icon change to an EXISTING subject —
   used by both adminEditSubjectIcon and adminRenameSubject below so each
   only has to touch the one field it actually changed, the same way
   adminEditYearIcon/adminRenameYear and adminEditModuleIcon/adminRenameModule
   split "which emoji" from "what it's called" into two separate actions. */
async function _persistSubjectMeta(key) {
  const extRef  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
  const extSnap = await window._getDoc(extRef);
  const ext = extSnap.exists() ? extSnap.data() : {};
  if (!ext.subjects) ext.subjects = {};
  if (ext.subjects[key]) {
    ext.subjects[key].label = subjects[key].label;
    ext.subjects[key].icon  = subjects[key].icon;
  }
  await window._setDoc(extRef, cleanForFirestore(ext));
  _clearCache(); await bumpCacheVersion();
  buildYearGrid();
  renderAdminCurriculumPanel();
}

async function adminEditSubjectIcon(key) {
  const s = subjects[key];
  if (!s) return;
  const current = s.icon || '📘';
  const newIcon = prompt(`Set icon for subject "${s.label || key}" (paste any emoji):`, current);
  if (newIcon === null) return;
  const icon = newIcon.trim() || current;
  subjects[key].icon = icon;
  addCustomIcon(icon);
  await _persistSubjectMeta(key);
}

async function adminRenameSubject(key) {
  const s = subjects[key];
  if (!s) return;
  const current = s.label || key;
  const newLabel = prompt(`Rename subject "${current}" to:`, current);
  if (!newLabel || newLabel.trim() === current) return;
  subjects[key].label = newLabel.trim();
  await _persistSubjectMeta(key);
}

async function adminDeleteSubject(key) {
  const s = subjects[key];
  const lbl = s?.label || key;

  if (!_confirmCascadeDelete(
    `Delete subject "${lbl}"?`,
    `This will PERMANENTLY delete this subject and ALL of its published quizzes — from the website AND Firestore.`,
    lbl
  )) return;

  await _deleteSubjectQuizzesFromFirestore(key);

  // Remove from curriculum placements
  Object.keys(curriculum).forEach(yr => {
    Object.keys(curriculum[yr] || {}).forEach(mod => {
      curriculum[yr][mod] = (curriculum[yr][mod] || []).filter(k => k !== key);
    });
  });
  // Remove from memory
  delete subjects[key];
  // Persist
  const extRef  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
  const extSnap = await window._getDoc(extRef);
  const ext = extSnap.exists() ? extSnap.data() : {};
  if (ext.subjects) delete ext.subjects[key];
  // Update modules placements
  const modulesMap = {};
  Object.keys(curriculum).forEach(yr => {
    const mods = Object.keys(curriculum[yr] || {});
    if (mods.length) modulesMap[yr] = mods;
  });
  ext.modules = modulesMap;
  ext.years   = Object.keys(curriculum);
  await window._setDoc(extRef, cleanForFirestore(ext));
  _clearCache(); await bumpCacheVersion();
  buildYearGrid();
  renderAdminCurriculumPanel();
}

/* Persist a newly-created Subject (and its Year/Module placement) */
async function saveCurriculumExtensionSubject(key, info) {
  if (!window._db) return;
  try {
    const ref  = window._doc(window._db, 'appConfig', 'curriculumExtensions');
    const snap = await window._getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    if (!data.subjects) data.subjects = {};
    data.subjects[key] = info;
    // Also keep years/modules in sync
    const allYears = Object.keys(curriculum);
    const modulesMap = {};
    allYears.forEach(yr => {
      const mods = Object.keys(curriculum[yr] || {});
      if (mods.length > 0) modulesMap[yr] = mods;
    });
    data.years   = allYears;
    data.modules = modulesMap;
    data.moduleIcons = moduleIconMap;
    data.yearIcons = yearIconMap;
    await window._setDoc(ref, cleanForFirestore(data));
    _clearCache();
    await bumpCacheVersion();
  } catch (e) {
    console.warn('Failed to save curriculum extension:', e);
  }
}