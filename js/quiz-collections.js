/* ══════════════════════════════════════════════════════════
   QUIZ COLLECTIONS — nested folders for Custom Quizzes

   Lets a student organize their own quizzes into folders, with folders
   inside folders to whatever depth they want (a collection's `parentId`
   just points at another collection, or is null for top-level). A quiz
   opts into a folder via its own `collectionId` field — no collectionId
   (or a collectionId whose folder no longer exists) means "Uncategorized".

   Storage: collections live in IndexedDB via js/local-store.js
   (listQuizCollections/saveQuizCollection/deleteQuizCollectionRaw), never
   Firestore — exactly like the quizzes themselves. This file mirrors the
   load-cache/save-and-recache pattern js/firebase-storage.js already uses
   for the quizzes (loadCustomQuizzes()/saveCustomQuizzesList()):
   `window._cachedQuizCollections` is the live in-memory array, and every
   mutation here writes through to IndexedDB THEN updates that cache before
   re-rendering, so the two never drift apart mid-session.

   UI: a collapsible tree sidebar (renderCqCollectionsSidebarHTML) sits
   beside the "Your Custom Quizzes" list in js/firebase-storage.js's
   renderCustomQuizModal(); a breadcrumb (renderCqBreadcrumbHTML) shows
   where you are, and _filterQuizzesByActiveCollection() narrows the quiz
   list to match. Quizzes can be filed into a folder by dragging their card
   onto a tree node, or — for touch/keyboard users, since native HTML5 drag
   isn't reliable on mobile — via the 📁 Move button's dropdown on every
   quiz card (and a bulk "Move to…" for multi-selected quizzes). Folders
   themselves are draggable too, for reordering/re-nesting; a drop is
   rejected with a friendly message if it would nest a folder inside its
   own subtree.
══════════════════════════════════════════════════════════ */

const CQ_UNCATEGORIZED = '__uncategorized__';
const CQ_COLLECTION_COLORS = ['#0E6E82', '#7E57C2', '#4C9A6B', '#D99A45', '#B23A3A', '#B8934A', '#2E8FA3', '#66808F'];
const CQ_COLLECTION_ICONS = ['📁', '🗂️', '📚', '🧬', '💊', '🫀', '🧠', '🩺', '🔬', '🧪', '🎓', '⭐', '🔥', '🎯', '✅', '📊', '📌', '🧩'];

let cqActiveCollectionId = null;         // null = "All Quizzes"; CQ_UNCATEGORIZED; or a collection id
let cqExpandedCollections = _cqReadExpandedFromStorage();
let cqDraggedQuizId = null;
let cqDraggedCollectionId = null;
let cqEditingCollectionId = null;
let cqNewCollectionParentId = undefined; // undefined = no inline "new folder" form open; null = form open at root
let cqCollectionMenuOpenFor = null;      // collection id whose ⋮ popover is open
let cqCollectionMoveMenuFor = null;      // quiz id whose 📁 Move popover is open
let cqBulkMoveMenuOpen = false;
let cqSidebarMobileOpen = false;         // mobile (<720px): drawer hidden by default
let cqSidebarCollapsed = _cqReadCollapsedFromStorage(); // desktop (≥720px): sidebar shown by default, collapsible via header button

// Delete-collection confirmation modal state (see cqDeleteCollection() below).
let _cqDeleteModalEl = null;
let _cqDeleteModalCollId = null;
let _cqDeleteModalStep = 1; // 1 = choose an option, 2 = destructive confirmation

function _cqReadExpandedFromStorage() {
  try { return new Set(JSON.parse(localStorage.getItem('cqExpandedCollections') || '[]')); }
  catch { return new Set(); }
}
function _cqPersistExpanded() {
  try { localStorage.setItem('cqExpandedCollections', JSON.stringify([...cqExpandedCollections])); } catch {}
}

function _cqReadCollapsedFromStorage() {
  try { return localStorage.getItem('cqSidebarCollapsed') === '1'; }
  catch { return false; }
}
function _cqPersistCollapsed() {
  try { localStorage.setItem('cqSidebarCollapsed', cqSidebarCollapsed ? '1' : '0'); } catch {}
}

/** Resets the transient (popover/drag/editing) UI state — called from
 *  openCustomQuizzes() so a stray open menu never survives a modal
 *  close/reopen. Deliberately does NOT reset cqActiveCollectionId, so
 *  browsing a folder persists across opening/closing the modal in the
 *  same session, the same way scroll position would. */
function cqResetCollectionsTransientState() {
  cqDraggedQuizId = null;
  cqDraggedCollectionId = null;
  cqEditingCollectionId = null;
  cqNewCollectionParentId = undefined;
  cqCollectionMenuOpenFor = null;
  cqCollectionMoveMenuFor = null;
  cqBulkMoveMenuOpen = false;
  _cqCloseDeleteCollectionModal();
}

// ---------------------------------------------------------------------------
// Cache load/save — mirrors loadCustomQuizzes()/saveCustomQuizzesList() in
// js/firebase-storage.js.
// ---------------------------------------------------------------------------

function loadQuizCollections() {
  return window._cachedQuizCollections || [];
}

/** Updates the in-memory cache only — callers persist the actually-changed
 *  collection(s) via saveQuizCollection/deleteQuizCollectionRaw themselves
 *  first (no bulk diff needed here, unlike quizzes, since collections are
 *  edited one at a time). */
function saveQuizCollectionsList(arr) {
  window._cachedQuizCollections = arr;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function _collectionChildren(collections, parentId) {
  return collections
    .filter(c => (c.parentId || null) === (parentId || null))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
}

/** This collection's id plus every descendant id, at any depth. */
function _collectionDescendantIds(collections, id) {
  const out = [id];
  _collectionChildren(collections, id).forEach(c => out.push(..._collectionDescendantIds(collections, c.id)));
  return out;
}

/** Root -> ... -> this collection, as an ordered array. */
function _collectionPath(collections, id) {
  const path = [];
  let cur = collections.find(c => c.id === id);
  const seen = new Set(); // guards against a corrupted parentId cycle
  while (cur && !seen.has(cur.id)) {
    path.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? collections.find(c => c.id === cur.parentId) : null;
  }
  return path;
}

/** Quiz count for a folder, including everything nested inside its subfolders. */
function _quizCountForCollection(quizzes, collections, id) {
  const ids = new Set(_collectionDescendantIds(collections, id));
  return quizzes.filter(q => q.collectionId && ids.has(q.collectionId)).length;
}

function _filterQuizzesByActiveCollection(quizzes, collections) {
  if (cqActiveCollectionId == null) return quizzes;
  if (cqActiveCollectionId === CQ_UNCATEGORIZED) {
    // Also catches a quiz whose folder was deleted through some other path
    // and left a dangling collectionId, so it never silently disappears.
    const liveIds = new Set(collections.map(c => c.id));
    return quizzes.filter(q => !q.collectionId || !liveIds.has(q.collectionId));
  }
  const ids = new Set(_collectionDescendantIds(collections, cqActiveCollectionId));
  return quizzes.filter(q => q.collectionId && ids.has(q.collectionId));
}

/** Resolves the folder a newly-created quiz should land in: the source
 *  quiz's own folder when spinning one quiz off another (split, "save
 *  edits as new quiz"), otherwise whatever folder is currently being
 *  browsed — so creating a quiz while inside "Cardio" files it straight
 *  into Cardio instead of dumping it in Uncategorized. */
function _cqTargetCollectionId(sourceQuiz) {
  if (sourceQuiz && sourceQuiz.collectionId) return sourceQuiz.collectionId;
  if (cqActiveCollectionId && cqActiveCollectionId !== CQ_UNCATEGORIZED) return cqActiveCollectionId;
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderCqCollectionsSidebarHTML(quizzes, collections) {
  const roots = _collectionChildren(collections, null);
  const allActive = cqActiveCollectionId == null;
  const uncatActive = cqActiveCollectionId === CQ_UNCATEGORIZED;
  const liveIds = new Set(collections.map(c => c.id));
  const uncatCount = quizzes.filter(q => !q.collectionId || !liveIds.has(q.collectionId)).length;

  return `
  <button class="cq-coll-mobile-toggle" onclick="cqToggleSidebarMobile()">
    📁 ${cqSidebarMobileOpen ? 'Hide Folders ✕' : 'Browse Folders ▾'}
  </button>
  <button class="cq-coll-reopen-btn" onclick="cqToggleSidebarCollapsed()" title="Show the folders panel">📁 Show Folders ▸</button>
  <div class="cq-coll-sidebar ${cqSidebarMobileOpen ? 'mobile-open' : ''}">
    <div class="cq-coll-sidebar-header">
      <span>📁 Collections</span>
      <div class="cq-coll-header-actions">
        <button class="cq-coll-new-btn" title="New top-level collection" onclick="cqStartNewCollection(null)">➕ New</button>
        <button class="cq-coll-collapse-btn" title="Hide the folders panel" onclick="cqToggleSidebarCollapsed()">◂</button>
      </div>
    </div>
    <div class="cq-coll-tree">
      <div class="cq-coll-row cq-coll-pseudo ${allActive ? 'active' : ''}" onclick="cqSelectCollection(null)"
           ondragover="cqRootDragOver(event)" ondragleave="cqRootDragLeave(event)" ondrop="cqRootDrop(event)">
        <span class="cq-coll-caret empty"></span>
        <span class="cq-coll-icon">🗂️</span>
        <span class="cq-coll-name">All Quizzes</span>
        <span class="cq-coll-count">${quizzes.length}</span>
      </div>
      ${cqNewCollectionParentId === null ? _renderNewCollectionInlineForm(null, 1) : ''}
      ${roots.map(c => _renderCollectionNode(collections, quizzes, c, 1)).join('')}
      <div class="cq-coll-row cq-coll-pseudo ${uncatActive ? 'active' : ''}" onclick="cqSelectCollection('${CQ_UNCATEGORIZED}')"
           ondragover="cqUncatDragOver(event)" ondragleave="cqUncatDragLeave(event)" ondrop="cqUncatDrop(event)">
        <span class="cq-coll-caret empty"></span>
        <span class="cq-coll-icon">📭</span>
        <span class="cq-coll-name">Uncategorized</span>
        <span class="cq-coll-count">${uncatCount}</span>
      </div>
    </div>
  </div>`;
}

function _renderCollectionNode(collections, quizzes, node, depth) {
  const children = _collectionChildren(collections, node.id);
  const hasChildren = children.length > 0;
  const expanded = cqExpandedCollections.has(node.id);
  const isActive = cqActiveCollectionId === node.id;
  const isEditing = cqEditingCollectionId === node.id;
  const menuOpen = cqCollectionMenuOpenFor === node.id;
  const count = _quizCountForCollection(quizzes, collections, node.id);
  const swatchStyle = node.color
    ? `background:color-mix(in srgb, ${node.color} 22%, transparent);box-shadow:inset 0 0 0 1.5px color-mix(in srgb, ${node.color} 55%, transparent);`
    : '';

  return `<div class="cq-coll-node" style="--depth:${depth}">
    <div class="cq-coll-row ${isActive ? 'active' : ''}"
         draggable="${isEditing ? 'false' : 'true'}"
         ondragstart="cqCollectionDragStart(event,'${node.id}')"
         ondragend="cqCollectionDragEnd(event)"
         ondragover="cqCollectionDragOver(event,'${node.id}')"
         ondragleave="cqCollectionDragLeave(event)"
         ondrop="cqCollectionDrop(event,'${node.id}')"
         onclick="${isEditing ? '' : `cqSelectCollection('${node.id}')`}">
      <span class="cq-coll-caret ${hasChildren ? '' : 'empty'}" onclick="event.stopPropagation(); cqToggleCollectionExpand('${node.id}')">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
      <span class="cq-coll-icon" style="${swatchStyle}">${escapeHtml(node.icon || '📁')}</span>
      ${isEditing
        ? `<input type="text" class="cq-coll-rename-input" id="cqCollRename_${node.id}" value="${escapeHtml(node.name)}"
             onclick="event.stopPropagation()"
             onkeydown="event.stopPropagation(); if(event.key==='Enter'){cqRenameCollectionCommit('${node.id}', this.value)} else if(event.key==='Escape'){cqRenameCollectionCancel()}"
             onblur="cqRenameCollectionCommit('${node.id}', this.value)" />`
        : `<span class="cq-coll-name">${escapeHtml(node.name)}</span>`}
      <span class="cq-coll-count">${count}</span>
      <span class="cq-coll-menu-btn" data-coll-menu-btn="${node.id}" onclick="event.stopPropagation(); cqToggleCollectionMenu('${node.id}')">⋮</span>
      ${menuOpen ? _renderCollectionMenuHTML(node) : ''}
    </div>
    ${cqNewCollectionParentId === node.id ? _renderNewCollectionInlineForm(node.id, depth + 1) : ''}
    ${(hasChildren && expanded) ? `<div class="cq-coll-children">${children.map(c => _renderCollectionNode(collections, quizzes, c, depth + 1)).join('')}</div>` : ''}
  </div>`;
}

function _renderCollectionMenuHTML(node) {
  return `<div class="cq-coll-menu" id="cqCollMenu_${node.id}" onclick="event.stopPropagation()">
    <button onclick="cqStartNewCollection('${node.id}')">➕ New subfolder</button>
    <button onclick="cqRenameCollectionStart('${node.id}')">✏️ Rename</button>
    <div class="cq-coll-menu-label">Color</div>
    <div class="cq-coll-menu-colors">
      ${CQ_COLLECTION_COLORS.map(c => `<span class="cq-coll-swatch ${node.color === c ? 'selected' : ''}" style="background:${c}" onclick="cqSetCollectionColor('${node.id}','${c}')"></span>`).join('')}
    </div>
    <div class="cq-coll-menu-label">Icon</div>
    <div class="cq-coll-menu-icons">
      ${CQ_COLLECTION_ICONS.map(ic => `<span class="cq-coll-icon-opt ${node.icon === ic ? 'selected' : ''}" onclick="cqSetCollectionIcon('${node.id}','${ic}')">${ic}</span>`).join('')}
    </div>
    <button class="danger" onclick="cqDeleteCollection('${node.id}')">🗑️ Delete folder</button>
  </div>`;
}

function _renderNewCollectionInlineForm(parentId, depth) {
  return `<div class="cq-coll-node" style="--depth:${depth}">
    <div class="cq-coll-row cq-coll-new-row">
      <span class="cq-coll-caret empty"></span>
      <span class="cq-coll-icon">📁</span>
      <input type="text" class="cq-coll-rename-input" id="cqNewCollNameInput" placeholder="Folder name…"
        onkeydown="if(event.key==='Enter'){cqCommitNewCollection(${parentId === null ? 'null' : `'${parentId}'`}, this.value)} else if(event.key==='Escape'){cqCancelNewCollection()}" />
      <button class="cq-coll-new-confirm" onclick="cqCommitNewCollection(${parentId === null ? 'null' : `'${parentId}'`}, document.getElementById('cqNewCollNameInput').value)">✓</button>
      <button class="cq-coll-new-cancel" onclick="cqCancelNewCollection()">✕</button>
    </div>
  </div>`;
}

function renderCqBreadcrumbHTML(collections) {
  if (cqActiveCollectionId == null) {
    return `<div class="cq-coll-breadcrumb"><span class="crumb current">🗂️ All Quizzes</span></div>`;
  }
  if (cqActiveCollectionId === CQ_UNCATEGORIZED) {
    return `<div class="cq-coll-breadcrumb"><span class="crumb" onclick="cqSelectCollection(null)">🗂️ All Quizzes</span><span class="sep">›</span><span class="crumb current">📭 Uncategorized</span></div>`;
  }
  const path = _collectionPath(collections, cqActiveCollectionId);
  if (!path.length) { cqActiveCollectionId = null; return renderCqBreadcrumbHTML(collections); } // folder no longer exists
  const crumbs = [`<span class="crumb" onclick="cqSelectCollection(null)">🗂️ All Quizzes</span>`];
  path.forEach((c, i) => {
    const isLast = i === path.length - 1;
    crumbs.push(`<span class="sep">›</span><span class="crumb ${isLast ? 'current' : ''}" ${isLast ? '' : `onclick="cqSelectCollection('${c.id}')"`}>${escapeHtml(c.icon || '📁')} ${escapeHtml(c.name)}</span>`);
  });
  return `<div class="cq-coll-breadcrumb">${crumbs.join('')}</div>`;
}

/** Small pill shown on a quiz card (and reused in the merge-quiz picker)
 *  naming which folder a quiz lives in — omitted entirely for an
 *  uncategorized quiz, so the common case stays visually quiet. */
function _quizCollectionChipHTML(quiz, collections) {
  if (!quiz.collectionId) return '';
  const col = collections.find(c => c.id === quiz.collectionId);
  if (!col) return '';
  const path = _collectionPath(collections, col.id);
  const label = path.map(c => c.name).join(' / ');
  const color = col.color || 'var(--accent)';
  return `<span class="cq-coll-chip" title="${escapeHtml(label)}" style="color:${color};border-color:${color};background:color-mix(in srgb, ${color} 12%, white);">${escapeHtml(col.icon || '📁')} ${escapeHtml(label)}</span>`;
}

/** Flat, indented list of every folder — used inside the 📁 Move
 *  dropdowns (single-quiz and bulk). `currentId` gets a ✓/highlight. */
function _renderCollectionOptionRows(collections, currentId, onPick) {
  const rows = [`<button class="${!currentId ? 'current' : ''}" onclick="${onPick(null)}">📭 Uncategorized</button>`];
  const walk = (parentId, depth) => {
    _collectionChildren(collections, parentId).forEach(c => {
      rows.push(`<button class="${currentId === c.id ? 'current' : ''}" style="padding-left:${10 + depth * 14}px" onclick="${onPick(c.id)}">${escapeHtml(c.icon || '📁')} ${escapeHtml(c.name)}</button>`);
      walk(c.id, depth + 1);
    });
  };
  walk(null, 0);
  return rows.join('');
}

function _renderQuizMoveMenuHTML(quiz) {
  const collections = loadQuizCollections();
  const rows = _renderCollectionOptionRows(collections, quiz.collectionId,
    id => `cqMoveQuizToCollection('${quiz.id}', ${id === null ? 'null' : `'${id}'`})`);
  return `<div class="cq-move-menu" id="cqMoveMenu_${quiz.id}" onclick="event.stopPropagation()">${rows}</div>`;
}

function _renderBulkMoveMenuHTML() {
  const collections = loadQuizCollections();
  const rows = _renderCollectionOptionRows(collections, undefined,
    id => `cqMoveMultipleToCollection(${id === null ? 'null' : `'${id}'`})`);
  return `<div class="cq-move-menu" id="cqBulkMoveMenu" onclick="event.stopPropagation()">${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Actions — selection / expand / mobile drawer
// ---------------------------------------------------------------------------

function cqSelectCollection(id) {
  cqActiveCollectionId = id;
  cqCollectionMoveMenuFor = null;
  cqBulkMoveMenuOpen = false;
  cqSidebarMobileOpen = false;
  if (id && id !== CQ_UNCATEGORIZED) {
    _collectionPath(loadQuizCollections(), id).forEach(c => cqExpandedCollections.add(c.id));
    _cqPersistExpanded();
  }
  renderCustomQuizModal();
}

function cqToggleCollectionExpand(id) {
  if (cqExpandedCollections.has(id)) cqExpandedCollections.delete(id); else cqExpandedCollections.add(id);
  _cqPersistExpanded();
  renderCustomQuizModal();
}

function cqToggleSidebarMobile() {
  cqSidebarMobileOpen = !cqSidebarMobileOpen;
  renderCustomQuizModal();
}

/** Desktop (≥720px) equivalent of cqToggleSidebarMobile() — collapses the
 *  fixed sidebar column entirely (quiz list takes the full width) rather
 *  than overlaying it as a drawer, since there's room to spare either way
 *  at that size. Persisted so the choice sticks across sessions. */
function cqToggleSidebarCollapsed() {
  cqSidebarCollapsed = !cqSidebarCollapsed;
  _cqPersistCollapsed();
  renderCustomQuizModal();
}

// ---------------------------------------------------------------------------
// Actions — create / rename / delete / recolor / re-icon a folder
// ---------------------------------------------------------------------------

function cqStartNewCollection(parentId) {
  cqNewCollectionParentId = parentId === undefined ? null : parentId;
  cqCollectionMenuOpenFor = null;
  if (parentId) { cqExpandedCollections.add(parentId); _cqPersistExpanded(); }
  renderCustomQuizModal();
  setTimeout(() => { const el = document.getElementById('cqNewCollNameInput'); if (el) el.focus(); }, 30);
}

function cqCancelNewCollection() {
  cqNewCollectionParentId = undefined;
  renderCustomQuizModal();
}

async function cqCommitNewCollection(parentId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) { cqCancelNewCollection(); return; }
  const collections = loadQuizCollections();
  const siblings = _collectionChildren(collections, parentId);
  const { saveQuizCollection } = await import('./local-store.js');
  const saved = await saveQuizCollection({
    name: trimmed, parentId: parentId || null,
    icon: '📁', color: null, order: siblings.length, createdAt: Date.now()
  });
  saveQuizCollectionsList([...collections, saved]);
  cqNewCollectionParentId = undefined;
  cqActiveCollectionId = saved.id;
  renderCustomQuizModal();
}

function cqRenameCollectionStart(id) {
  cqEditingCollectionId = id;
  cqCollectionMenuOpenFor = null;
  renderCustomQuizModal();
  setTimeout(() => { const el = document.getElementById('cqCollRename_' + id); if (el) { el.focus(); el.select(); } }, 30);
}

function cqRenameCollectionCancel() {
  cqEditingCollectionId = null;
  renderCustomQuizModal();
}

async function cqRenameCollectionCommit(id, name) {
  if (cqEditingCollectionId !== id) return; // Enter already committed before blur fired — no-op
  cqEditingCollectionId = null;
  const trimmed = (name || '').trim();
  const collections = loadQuizCollections();
  const col = collections.find(c => c.id === id);
  if (!col || !trimmed || trimmed === col.name) { renderCustomQuizModal(); return; }
  col.name = trimmed;
  const { saveQuizCollection } = await import('./local-store.js');
  await saveQuizCollection(col);
  saveQuizCollectionsList(collections);
  renderCustomQuizModal();
}

async function cqSetCollectionColor(id, color) {
  const collections = loadQuizCollections();
  const col = collections.find(c => c.id === id);
  if (!col) return;
  col.color = color;
  const { saveQuizCollection } = await import('./local-store.js');
  await saveQuizCollection(col);
  saveQuizCollectionsList(collections);
  renderCustomQuizModal();
}

async function cqSetCollectionIcon(id, icon) {
  const collections = loadQuizCollections();
  const col = collections.find(c => c.id === id);
  if (!col) return;
  col.icon = icon;
  const { saveQuizCollection } = await import('./local-store.js');
  await saveQuizCollection(col);
  saveQuizCollectionsList(collections);
  renderCustomQuizModal();
}

/** Gathers the numbers the delete-collection modal needs: how many
 *  subfolders sit anywhere underneath (any depth), and how many quizzes
 *  are filed either directly inside this folder or inside one of those
 *  subfolders. */
function _cqCollectionDeleteStats(id) {
  const collections = loadQuizCollections();
  const quizzes = loadCustomQuizzes();
  const col = collections.find(c => c.id === id);
  const directChildren = _collectionChildren(collections, id);
  const allIds = new Set(_collectionDescendantIds(collections, id)); // includes id itself
  const nestedFolderCount = allIds.size - 1;
  const directQuizCount = quizzes.filter(q => q.collectionId === id).length;
  const totalNestedQuizCount = quizzes.filter(q => q.collectionId && allIds.has(q.collectionId)).length;
  return { col, directChildren, allIds, nestedFolderCount, directQuizCount, totalNestedQuizCount };
}

/** Opens the delete-folder modal, offering a choice between the original,
 *  non-destructive behavior (subfolders move up, quizzes become
 *  Uncategorized — nothing is ever deleted) and permanently deleting the
 *  folder along with everything filed inside it, at any depth. The
 *  destructive option needs a second, explicit confirmation step before
 *  anything is actually removed. */
function cqDeleteCollection(id) {
  const { col } = _cqCollectionDeleteStats(id);
  if (!col) return;
  cqCollectionMenuOpenFor = null;
  renderCustomQuizModal(); // close the ⋮ popover behind the modal
  _cqDeleteModalCollId = id;
  _cqDeleteModalStep = 1;
  const el = document.createElement('div');
  el.className = 'qm-overlay';
  el.id = 'cqDeleteCollModal';
  el.addEventListener('mousedown', (e) => { if (e.target === el) _cqCloseDeleteCollectionModal(); });
  document.body.appendChild(el);
  _cqDeleteModalEl = el;
  _cqRenderDeleteCollectionModal();
}

function _cqCloseDeleteCollectionModal() {
  if (_cqDeleteModalEl) { _cqDeleteModalEl.remove(); _cqDeleteModalEl = null; }
  _cqDeleteModalCollId = null;
  _cqDeleteModalStep = 1;
}

function _cqRenderDeleteCollectionModal() {
  if (!_cqDeleteModalEl) return;
  const { col, nestedFolderCount, totalNestedQuizCount } = _cqCollectionDeleteStats(_cqDeleteModalCollId);
  if (!col) { _cqCloseDeleteCollectionModal(); return; }

  if (_cqDeleteModalStep === 1) {
    _cqDeleteModalEl.innerHTML = `
      <div class="qm-modal">
        <div class="qm-title">🗑️ Delete "${escapeHtml(col.name)}"</div>
        ${(nestedFolderCount || totalNestedQuizCount) ? `<div class="cq-del-summary">
          ${nestedFolderCount ? `<div>📁 ${nestedFolderCount} subfolder${nestedFolderCount !== 1 ? 's' : ''} inside</div>` : ''}
          ${totalNestedQuizCount ? `<div>📝 ${totalNestedQuizCount} quiz${totalNestedQuizCount !== 1 ? 'zes' : ''} filed inside (including subfolders)</div>` : ''}
        </div>` : ''}
        <div class="cq-del-options">
          <label class="cq-del-opt">
            <input type="radio" name="cqDelMode" value="keep" checked>
            <div>
              <div class="cq-del-opt-title">📤 Just remove this folder</div>
              <div class="cq-del-opt-desc">Nothing is deleted — subfolders move up${col.parentId ? " to this folder's parent" : ' to the top level'}, and any quiz filed directly here becomes Uncategorized.</div>
            </div>
          </label>
          <label class="cq-del-opt">
            <input type="radio" name="cqDelMode" value="everything">
            <div>
              <div class="cq-del-opt-title">🔥 Delete everything inside</div>
              <div class="cq-del-opt-desc">Permanently deletes this folder, every subfolder inside it, and every quiz filed anywhere inside — this can't be undone.</div>
            </div>
          </label>
        </div>
        <div class="qm-actions">
          <button class="qm-btn primary" onclick="_cqDeleteCollectionModalNext()">Continue</button>
          <button class="qm-btn secondary" onclick="_cqCloseDeleteCollectionModal()">Cancel</button>
        </div>
      </div>`;
  } else {
    const pieces = [];
    pieces.push(`${nestedFolderCount ? nestedFolderCount + 1 : 1} folder${nestedFolderCount ? 's' : ''}`);
    if (totalNestedQuizCount) pieces.push(`${totalNestedQuizCount} quiz${totalNestedQuizCount !== 1 ? 'zes' : ''}`);
    _cqDeleteModalEl.innerHTML = `
      <div class="qm-modal">
        <div class="qm-title">🔥 Permanently delete "${escapeHtml(col.name)}"?</div>
        <div class="qm-status err">This will permanently delete ${pieces.join(' and ')}. This action can't be undone.</div>
        <div class="qm-actions">
          <button class="qm-btn danger" onclick="_cqDeleteCollectionExecute('everything')">🔥 Yes, delete everything</button>
          <button class="qm-btn secondary" onclick="_cqDeleteCollectionModalBack()">◀ Back</button>
        </div>
      </div>`;
  }
}

function _cqDeleteCollectionModalNext() {
  const checked = document.querySelector('input[name="cqDelMode"]:checked');
  const mode = checked ? checked.value : 'keep';
  if (mode === 'keep') { _cqDeleteCollectionExecute('keep'); return; }
  _cqDeleteModalStep = 2;
  _cqRenderDeleteCollectionModal();
}

function _cqDeleteCollectionModalBack() {
  _cqDeleteModalStep = 1;
  _cqRenderDeleteCollectionModal();
}

/** Actually performs the delete, once the user has committed to a mode.
 *  'keep' is the original, non-destructive behavior: subfolders move up
 *  to this folder's own parent, and any quiz filed directly inside becomes
 *  Uncategorized. 'everything' permanently deletes this folder, every
 *  subfolder nested inside it (at any depth), and every quiz filed
 *  anywhere in that subtree. */
async function _cqDeleteCollectionExecute(mode) {
  const id = _cqDeleteModalCollId;
  const { col } = _cqCollectionDeleteStats(id);
  _cqCloseDeleteCollectionModal();
  if (!col) return;

  const collections = loadQuizCollections();
  const quizzes = loadCustomQuizzes();
  const { deleteQuizCollectionRaw } = await import('./local-store.js');

  if (mode === 'everything') {
    const allIds = new Set(_collectionDescendantIds(collections, id)); // this folder + every nested subfolder
    for (const cid of allIds) await deleteQuizCollectionRaw(cid);
    saveQuizCollectionsList(collections.filter(c => !allIds.has(c.id)));
    const remainingQuizzes = quizzes.filter(q => !q.collectionId || !allIds.has(q.collectionId));
    if (remainingQuizzes.length !== quizzes.length) await saveCustomQuizzesList(remainingQuizzes);
    if (cqActiveCollectionId && allIds.has(cqActiveCollectionId)) cqActiveCollectionId = null;
    allIds.forEach(cid => cqExpandedCollections.delete(cid));
  } else {
    const { saveQuizCollection } = await import('./local-store.js');
    const children = _collectionChildren(collections, id);
    const directQuizCount = quizzes.filter(q => q.collectionId === id).length;
    children.forEach(c => { c.parentId = col.parentId || null; });
    quizzes.forEach(q => { if (q.collectionId === id) q.collectionId = null; });
    for (const c of children) await saveQuizCollection(c);
    await deleteQuizCollectionRaw(id);
    if (directQuizCount) await saveCustomQuizzesList(quizzes);
    saveQuizCollectionsList(collections.filter(c => c.id !== id));
    if (cqActiveCollectionId === id) cqActiveCollectionId = null;
    cqExpandedCollections.delete(id);
  }

  _cqPersistExpanded();
  renderCustomQuizModal();
}

async function cqReparentCollection(id, newParentId) {
  const collections = loadQuizCollections();
  const col = collections.find(c => c.id === id);
  if (!col) return;
  col.parentId = newParentId || null;
  const { saveQuizCollection } = await import('./local-store.js');
  await saveQuizCollection(col);
  saveQuizCollectionsList(collections);
  if (newParentId) { cqExpandedCollections.add(newParentId); _cqPersistExpanded(); }
  renderCustomQuizModal();
}

// ---------------------------------------------------------------------------
// Actions — move a quiz into a folder (drag-and-drop, or the 📁 Move menu)
// ---------------------------------------------------------------------------

async function cqMoveQuizToCollection(quizId, collectionId) {
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === quizId);
  if (!quiz) return;
  quiz.collectionId = collectionId || null;
  await saveCustomQuizzesList(quizzes);
  cqCollectionMoveMenuFor = null;
  renderCustomQuizModal();
}

function cqToggleQuizMoveMenu(quizId) {
  cqCollectionMoveMenuFor = cqCollectionMoveMenuFor === quizId ? null : quizId;
  cqBulkMoveMenuOpen = false;
  renderCustomQuizModal();
}

function cqToggleBulkMoveMenu() {
  cqBulkMoveMenuOpen = !cqBulkMoveMenuOpen;
  cqCollectionMoveMenuFor = null;
  renderCustomQuizModal();
}

async function cqMoveMultipleToCollection(collectionId) {
  const quizzes = loadCustomQuizzes();
  const target = collectionId || null;
  let changed = false;
  cqMultiSelected.forEach(id => {
    const quiz = quizzes.find(q => q.id === id);
    if (quiz) { quiz.collectionId = target; changed = true; }
  });
  if (changed) await saveCustomQuizzesList(quizzes);
  cqBulkMoveMenuOpen = false;
  renderCustomQuizModal();
}

// ---------------------------------------------------------------------------
// Drag & drop wiring
// ---------------------------------------------------------------------------

function cqQuizDragStart(e, id) {
  cqDraggedQuizId = id;
  cqDraggedCollectionId = null;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', 'quiz:' + id); } catch (_) {}
  e.currentTarget.classList.add('cq-dragging');
}
function cqQuizDragEnd() { _cqClearDragState(); }

function cqCollectionDragStart(e, id) {
  cqDraggedCollectionId = id;
  cqDraggedQuizId = null;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', 'collection:' + id); } catch (_) {}
  e.currentTarget.classList.add('cq-dragging');
}
function cqCollectionDragEnd() { _cqClearDragState(); }

function _cqClearDragState() {
  cqDraggedQuizId = null;
  cqDraggedCollectionId = null;
  document.querySelectorAll('.cq-dragging').forEach(el => el.classList.remove('cq-dragging'));
  document.querySelectorAll('.cq-drop-target').forEach(el => el.classList.remove('cq-drop-target'));
}

function cqCollectionDragOver(e, targetId) {
  if (!cqDraggedQuizId && !cqDraggedCollectionId) return;
  if (cqDraggedCollectionId === targetId) return; // can't drop a folder on itself
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('cq-drop-target');
}
function cqCollectionDragLeave(e) { e.currentTarget.classList.remove('cq-drop-target'); }

async function cqCollectionDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('cq-drop-target');
  if (cqDraggedQuizId) {
    const quizId = cqDraggedQuizId;
    _cqClearDragState();
    await cqMoveQuizToCollection(quizId, targetId);
    return;
  }
  if (cqDraggedCollectionId) {
    const draggedId = cqDraggedCollectionId;
    _cqClearDragState();
    if (draggedId === targetId) return;
    const collections = loadQuizCollections();
    const descendants = new Set(_collectionDescendantIds(collections, draggedId));
    if (descendants.has(targetId)) {
      alert("Can't move a folder into one of its own subfolders.");
      return;
    }
    await cqReparentCollection(draggedId, targetId);
  }
}

function cqRootDragOver(e) { if (cqDraggedCollectionId) { e.preventDefault(); e.currentTarget.classList.add('cq-drop-target'); } }
function cqRootDragLeave(e) { e.currentTarget.classList.remove('cq-drop-target'); }
async function cqRootDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('cq-drop-target');
  if (!cqDraggedCollectionId) { _cqClearDragState(); return; }
  const draggedId = cqDraggedCollectionId;
  _cqClearDragState();
  await cqReparentCollection(draggedId, null);
}

function cqUncatDragOver(e) { if (cqDraggedQuizId) { e.preventDefault(); e.currentTarget.classList.add('cq-drop-target'); } }
function cqUncatDragLeave(e) { e.currentTarget.classList.remove('cq-drop-target'); }
async function cqUncatDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('cq-drop-target');
  if (!cqDraggedQuizId) { _cqClearDragState(); return; }
  const quizId = cqDraggedQuizId;
  _cqClearDragState();
  await cqMoveQuizToCollection(quizId, null);
}

// ---------------------------------------------------------------------------
// ⋮ / 📁 popover open state + rendering
// ---------------------------------------------------------------------------

function cqToggleCollectionMenu(id) {
  cqCollectionMenuOpenFor = cqCollectionMenuOpenFor === id ? null : id;
  cqNewCollectionParentId = undefined;
  renderCustomQuizModal();
}

// Close any open ⋮/📁 popover on an outside click — mirrors the pattern
// js/icon-picker.js already uses for its own popover.
document.addEventListener('click', (e) => {
  if (cqCollectionMenuOpenFor) {
    const menu = document.getElementById('cqCollMenu_' + cqCollectionMenuOpenFor);
    const btn = document.querySelector(`[data-coll-menu-btn="${cqCollectionMenuOpenFor}"]`);
    if (!(menu && menu.contains(e.target)) && !(btn && btn.contains(e.target))) {
      cqCollectionMenuOpenFor = null;
      if (document.getElementById('customQuizBody')) renderCustomQuizModal();
    }
  }
  if (cqCollectionMoveMenuFor) {
    const menu = document.getElementById('cqMoveMenu_' + cqCollectionMoveMenuFor);
    const btn = document.querySelector(`[data-move-btn="${cqCollectionMoveMenuFor}"]`);
    if (!(menu && menu.contains(e.target)) && !(btn && btn.contains(e.target))) {
      cqCollectionMoveMenuFor = null;
      if (document.getElementById('customQuizBody')) renderCustomQuizModal();
    }
  }
  if (cqBulkMoveMenuOpen) {
    const menu = document.getElementById('cqBulkMoveMenu');
    const btn = document.getElementById('cqBulkMoveBtn');
    if (!(menu && menu.contains(e.target)) && !(btn && btn.contains(e.target))) {
      cqBulkMoveMenuOpen = false;
      if (document.getElementById('customQuizBody')) renderCustomQuizModal();
    }
  }
});
