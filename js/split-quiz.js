/* ══════════════════════════════════════════════════════════
   SPLIT QUIZ — helpers + UI
══════════════════════════════════════════════════════════ */

function openSplitPanel(context, quizId) {
  // context: 'preview' | 'saved' | 'adminPublished'
  cqSplitState = {
    context,
    quizId: quizId || null,
    mode: 'equal',
    chunkSize: 20,
    ranges: [{ start: '1', end: '', label: '' }],
    visualCuts: new Set(),
    // Keyed by the stable 0-based question index each part STARTS at (not by
    // the part's on-screen position — see the comment above
    // updateVisualPartLabel() for why that distinction matters).
    visualPartLabels: {}
  };
  if (context === 'preview') {
    renderCQPreview();
  } else if (context === 'adminPublished') {
    _renderAdminAssignedListHTML();
  } else {
    renderCustomQuizModal();
  }
  // Scroll split panel into view
  setTimeout(() => {
    const panelKey = quizId || 'preview';
    const el = document.getElementById('cqSplitPanel_' + panelKey);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 80);
}

function closeSplitPanel() {
  cqSplitState = null;
  renderCQPreview && renderCQPreview();
  renderCustomQuizModal && renderCustomQuizModal();
  if (document.getElementById('adminAssignedSection')) _renderAdminAssignedListHTML();
}

function setSplitMode(mode) {
  if (!cqSplitState) return;
  cqSplitState.mode = mode;
  if (mode === 'visual') {
    if (!cqSplitState.visualCuts) cqSplitState.visualCuts = new Set();
    if (!cqSplitState.visualPartLabels) cqSplitState.visualPartLabels = {};
  }
  // In-place: swaps only the split panel's own markup, so the surrounding
  // modal/list is never touched and the page doesn't jump (see
  // _rerenderSplitPanelInPlace for why a full owner re-render would).
  _rerenderSplitPanelInPlace();
}

function toggleVisualCut(afterIndex) {
  if (!cqSplitState) return;
  if (!cqSplitState.visualCuts) cqSplitState.visualCuts = new Set();
  if (!cqSplitState.visualPartLabels) cqSplitState.visualPartLabels = {};
  if (cqSplitState.visualCuts.has(afterIndex)) {
    cqSplitState.visualCuts.delete(afterIndex);
    // The part that used to START right after this cut (0-based index
    // afterIndex + 1) merges back into the part before it. Drop its
    // now-stale title so a future cut placed at this same spot doesn't
    // resurrect an old, unrelated label.
    delete cqSplitState.visualPartLabels[afterIndex + 1];
  } else {
    cqSplitState.visualCuts.add(afterIndex);
  }
  // Re-render just the visual area without full modal re-render (for performance)
  const containerId = 'cqSplitVisual_' + (cqSplitState.quizId || 'preview');
  const el = document.getElementById(containerId);
  if (el && el.parentNode) {
    const srcQs = _getSplitSourceQuestions() || [];
    const tmp = document.createElement('div');
    tmp.innerHTML = _buildVisualSplitHTML(srcQs);
    el.parentNode.replaceChild(tmp.firstElementChild, el);
  } else {
    _rerenderSplitOwner();
  }
  _updateSplitSummary();
}

function _updateSplitSummary() {
  if (!cqSplitState) return;
  const total = (_getSplitSourceQuestions() || []).length;
  const summaryEl = document.getElementById('cqSplitSummary_' + (cqSplitState.quizId || 'preview'));
  if (summaryEl) summaryEl.innerHTML = _buildSplitSummaryHTML(total);
}

// Returns an array of {colorBg, colorBorder, colorText} for up to 12 groups
const SPLIT_PART_COLORS = [
  { bg: 'var(--chip-blue-bg)', border: '#1976D2', text: 'var(--nav-current)' },
  { bg: 'var(--correct-bg)', border: '#388E3C', text: '#1B5E20' },
  { bg: 'var(--unanswered-bg)', border: '#F57C00', text: 'var(--unanswered-fg)' },
  { bg: '#FCE4EC', border: '#C2185B', text: '#880E4F' },
  { bg: '#E0F2F1', border: '#00796B', text: '#004D40' },
  { bg: 'var(--violet-pale)', border: 'var(--violet)', text: 'var(--violet-darkest)' },
  { bg: '#FFFDE7', border: '#F9A825', text: '#F57F17' },
  { bg: '#E8EAF6', border: '#3949AB', text: '#1A237E' },
  { bg: '#FBE9E7', border: '#D84315', text: '#BF360C' },
  { bg: '#E0F7FA', border: '#0097A7', text: '#006064' },
];

function _getVisualChunksFromCuts(total) {
  if (!cqSplitState || !cqSplitState.visualCuts) return [];
  const cuts = Array.from(cqSplitState.visualCuts).sort((a, b) => a - b);
  const chunks = [];
  let start = 0;
  for (const cutAfter of cuts) {
    if (cutAfter >= 0 && cutAfter < total - 1) {
      chunks.push({ start, end: cutAfter }); // 0-based inclusive
      start = cutAfter + 1;
    }
  }
  chunks.push({ start, end: total - 1 });
  return chunks;
}

function _buildVisualSplitHTML(questions) {
  if (!cqSplitState) return '';
  const total = questions.length;
  const cuts = cqSplitState.visualCuts || new Set();
  if (!cqSplitState.visualPartLabels) cqSplitState.visualPartLabels = {};
  const labels = cqSplitState.visualPartLabels;

  // Compute which group each question belongs to for color coding
  const chunks = _getVisualChunksFromCuts(total);
  const qGroupMap = {}; // qIndex -> chunkIndex
  chunks.forEach((c, ci) => {
    for (let i = c.start; i <= c.end; i++) qGroupMap[i] = ci;
  });

  let html = `<div class="cq-split-visual-list" id="cqSplitVisual_${cqSplitState.quizId || 'preview'}">`;

  // Hint
  html += `<div style="font-size:.75rem;color:var(--violet-dark);font-weight:700;margin-bottom:8px;line-height:1.5;">
    Click <svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> between questions to mark a split point. Click again to remove it.
    ${cuts.size === 0 ? '<span style="color:var(--unanswered-fg);"> — No cuts yet.</span>' : `<span style="color:var(--correct-fg);"> — ${cuts.size} cut${cuts.size !== 1 ? 's' : ''} = ${chunks.length} quizzes.</span>`}
  </div>`;

  questions.forEach((q, i) => {
    const groupIdx = qGroupMap[i] ?? 0;
    const color = SPLIT_PART_COLORS[groupIdx % SPLIT_PART_COLORS.length];
    const isLastInGroup = cuts.has(i);
    const isNewGroup = i > 0 && cuts.has(i - 1);

    // Show part header at group starts
    if (i === 0 || isNewGroup) {
      const partIdx = groupIdx;
      // Stable key: the 0-based question index this part starts at. Unlike
      // partIdx (its position among today's parts), this doesn't shift when
      // a cut is added/removed somewhere else in the list, so a title typed
      // in for "Quiz 3" stays attached to the SAME questions even after the
      // parts get renumbered around it.
      const labelKey = chunks[groupIdx] ? chunks[groupIdx].start : i;
      const labelVal = labels[labelKey] || '';
      const partColor = SPLIT_PART_COLORS[partIdx % SPLIT_PART_COLORS.length];
      html += `<div class="cq-split-part-header" style="background:${partColor.bg};border:1.5px solid ${partColor.border};">
        <span style="font-size:.72rem;font-weight:800;color:${partColor.text};">
          <svg class="sicon" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Quiz ${partIdx + 1}
        </span>
        <input type="text" class="cq-split-part-title-input" placeholder="Optional title for Quiz ${partIdx + 1}…"
          value="${escapeHtml(labelVal)}"
          oninput="updateVisualPartLabel(${labelKey}, this.value)"
          style="border-color:${partColor.border};" />
      </div>`;
    }

    // Question row
    const qText = q.question ? (q.question.length > 100 ? q.question.slice(0, 100) + '…' : q.question) : '(no text)';
    const partColor = SPLIT_PART_COLORS[groupIdx % SPLIT_PART_COLORS.length];
    html += `<div class="cq-split-q-row" style="border-color:${partColor.border};background:${partColor.bg};">
      <span class="cq-split-q-num" style="background:${partColor.border};">Q${i + 1}</span>
      <span class="cq-split-q-text">${escapeHtml(qText)}</span>
    </div>`;

    // Scissors row (between questions, not after last)
    if (i < total - 1) {
      const isCut = cuts.has(i);
      html += `<div class="cq-scissors-row${isCut ? ' cut' : ''}" onclick="toggleVisualCut(${i})" title="${isCut ? 'Remove cut here' : 'Cut here — split into separate quiz'}">
        <div class="cq-scissors-line"></div>
        <button class="cq-scissors-btn" type="button"><svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg></button>
        <div class="cq-scissors-line"></div>
        ${isCut ? `<span style="position:absolute;left:50%;transform:translateX(-50%) translateX(22px);font-size:.68rem;font-weight:800;color:var(--violet-darkest);white-space:nowrap;pointer-events:none;">— split here —</span>` : ''}
      </div>`;
    }
  });

  html += `</div>`;
  return html;
}

// `key` is the stable 0-based question index the part starts at (see the
// comment in _buildVisualSplitHTML), NOT its position among today's parts —
// that position can shift whenever a cut is added or removed anywhere else
// in the list, which previously caused a typed-in title to appear to
// "disappear" (it was still saved, just under a position that no longer
// pointed at the same part). Every reader of visualPartLabels — this
// function, _buildVisualSplitHTML, _buildSplitSummaryHTML, and
// executeSplitQuiz — must stay keyed the same way.
function updateVisualPartLabel(key, val) {
  if (!cqSplitState) return;
  if (!cqSplitState.visualPartLabels) cqSplitState.visualPartLabels = {};
  cqSplitState.visualPartLabels[key] = val;
  _updateSplitSummary();
}

function setSplitChunkSize(val) {
  if (!cqSplitState) return;
  cqSplitState.chunkSize = parseInt(val, 10) || 10;
  const panelKey = cqSplitState.quizId || 'preview';
  const total = (_getSplitSourceQuestions() || []).length;
  // Targeted DOM updates only — fires on every keystroke, so re-rendering
  // the whole panel (let alone the whole modal) here would tear down and
  // recreate the number input the user is actively typing into, stealing
  // focus/cursor position after each digit and jumping the page's scroll.
  const countEl = document.getElementById('cqSplitChunkCount_' + panelKey);
  if (countEl) countEl.textContent = _buildChunkCountLabel(total, cqSplitState.chunkSize);
  const summaryEl = document.getElementById('cqSplitSummary_' + panelKey);
  if (summaryEl) summaryEl.innerHTML = _buildSplitSummaryHTML(total);
}

function addSplitRange() {
  if (!cqSplitState) return;
  cqSplitState.ranges.push({ start: '', end: '', label: '' });
  _rerenderSplitPanelInPlace();
}

function removeSplitRange(idx) {
  if (!cqSplitState) return;
  cqSplitState.ranges.splice(idx, 1);
  if (!cqSplitState.ranges.length) cqSplitState.ranges.push({ start: '', end: '', label: '' });
  _rerenderSplitPanelInPlace();
}

function updateSplitRange(idx, field, val) {
  if (!cqSplitState || !cqSplitState.ranges[idx]) return;
  cqSplitState.ranges[idx][field] = val;
  // Live-update summary without full re-render (just update summary div)
  const total = _getSplitSourceQuestions()?.length || 0;
  const summaryEl = document.getElementById('cqSplitSummary_' + (cqSplitState.quizId || 'preview'));
  if (summaryEl) summaryEl.innerHTML = _buildSplitSummaryHTML(total);
}

function _rerenderSplitOwner() {
  if (!cqSplitState) return;
  if (cqSplitState.context === 'preview') renderCQPreview();
  else if (cqSplitState.context === 'adminPublished') _renderAdminAssignedListHTML();
  else renderCustomQuizModal();
}

// Re-renders ONLY the split panel's own DOM node in place, leaving every
// other part of the owning modal/list untouched.
//
// Why this exists: the owner render functions (renderCQPreview,
// renderCustomQuizModal, _renderAdminAssignedListHTML) rebuild their
// entire container's innerHTML from scratch. That container is nested
// inside the scrollable overlay the split panel lives in, and replacing
// all of its content resets that overlay's scroll position back to the
// top — so every click on a split-mode tab, or Add/Remove Range, used to
// yank the user's scroll position away from the very panel they were
// interacting with. Swapping just the panel's own element via
// replaceChild leaves everything above and below it completely
// undisturbed, so the enclosing scroll position never moves.
function _rerenderSplitPanelInPlace() {
  if (!cqSplitState) return;
  const panelKey = cqSplitState.quizId || 'preview';
  const el = document.getElementById('cqSplitPanel_' + panelKey);
  if (!el || !el.parentNode) {
    // Panel not found in the DOM (shouldn't normally happen while a split
    // is open) — fall back to a full owner re-render so the UI still ends
    // up correct even though scroll position may shift in this edge case.
    _rerenderSplitOwner();
    return;
  }
  const total = (_getSplitSourceQuestions() || []).length;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderSplitPanel(cqSplitState.context, cqSplitState.quizId, total);
  const newEl = tmp.firstElementChild;
  if (newEl) el.parentNode.replaceChild(newEl, el);
}

function _getSplitSourceQuestions() {
  if (!cqSplitState) return null;
  if (cqSplitState.context === 'preview') return cqGeneratedQuestions || [];
  if (cqSplitState.context === 'adminPublished') {
    const entry = adminAssignedEntries.find(x => x.id === cqSplitState.quizId);
    return entry ? (entry.questions || []) : [];
  }
  // If this saved quiz is currently open in its inline editor, split from the
  // live working copy (cqEditQuestions) rather than storage — otherwise any
  // not-yet-saved edits, like questions just merged in, would be missing.
  if (cqEditingQuizId === cqSplitState.quizId && cqEditQuestions) return cqEditQuestions;
  const quizzes = loadCustomQuizzes();
  const q = quizzes.find(x => x.id === cqSplitState.quizId);
  return q ? q.questions : [];
}

function _computeEqualChunks(total, chunkSize) {
  const chunks = [];
  if (!chunkSize || chunkSize < 1 || total < 1) return chunks;
  for (let s = 1; s <= total; s += chunkSize) {
    chunks.push({ start: s, end: Math.min(s + chunkSize - 1, total) });
  }
  return chunks;
}

// Small "(N total → M quizzes)" text shown next to the Equal Chunks input.
// Pulled out into its own helper so it can be reused both when the split
// panel is first rendered and when it's live-updated on every keystroke
// (see setSplitChunkSize), without duplicating the pluralization logic.
function _buildChunkCountLabel(total, chunkSize) {
  const n = _computeEqualChunks(total, chunkSize).length;
  return `(${total} total \u2192 ${n} quiz${n !== 1 ? 'zes' : ''})`;
}

function _computeCustomChunks() {
  if (!cqSplitState) return [];
  return cqSplitState.ranges.map(r => ({
    start: parseInt(r.start, 10),
    end: parseInt(r.end, 10),
    label: r.label.trim()
  })).filter(c => !isNaN(c.start) && !isNaN(c.end) && c.start >= 1 && c.end >= c.start);
}

function _buildSplitSummaryHTML(total) {
  if (!cqSplitState || !total) return '';
  let chunks;
  if (cqSplitState.mode === 'equal') {
    chunks = _computeEqualChunks(total, cqSplitState.chunkSize);
  } else if (cqSplitState.mode === 'visual') {
    // Build 1-based chunks from visualCuts
    const rawChunks = _getVisualChunksFromCuts(total); // 0-based inclusive
    const labels = cqSplitState.visualPartLabels || {};
    chunks = rawChunks.map(c => ({
      start: c.start + 1,
      end: c.end + 1,
      label: (labels[c.start] || '').trim()
    }));
  } else {
    chunks = _computeCustomChunks();
  }
  if (!chunks.length) return `<span style="color:var(--unanswered-fg);font-size:.78rem;font-weight:700;"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No valid ranges defined yet.</span>`;
  const coveredSet = new Set();
  chunks.forEach(c => { for (let i = c.start; i <= Math.min(c.end, total); i++) coveredSet.add(i); });
  const uncovered = total - coveredSet.size;
  let html = `Will create <strong>${chunks.length}</strong> quiz${chunks.length !== 1 ? 'zes' : ''}: `;
  chunks.forEach((c, i) => {
    const outOfRange = c.start > total || c.end > total;
    html += `<span class="cq-split-chip${outOfRange ? ' warn' : ''}">
      ${c.label || ('Part ' + (i + 1))}: Q${c.start}–Q${Math.min(c.end, total)} (${Math.min(c.end, total) - c.start + 1} Qs)
    </span>`;
  });
  if (uncovered > 0 && cqSplitState.mode === 'custom') {
    html += `<span class="cq-split-chip warn"><svg class="sicon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${uncovered} question${uncovered !== 1 ? 's' : ''} not covered</span>`;
  }
  return html;
}

function renderSplitPanel(context, quizId, totalQuestions) {
  if (!cqSplitState) return '';
  if (cqSplitState.context !== context || cqSplitState.quizId !== (quizId || null)) return '';
  const panelKey = quizId || 'preview';
  const panelId = 'cqSplitPanel_' + panelKey;
  const summaryId = 'cqSplitSummary_' + panelKey;
  const statusId = 'cqSplitStatus_' + panelKey;
  const mode = cqSplitState.mode || 'equal';
  const isEqual = mode === 'equal';
  const isCustom = mode === 'custom';
  const isVisual = mode === 'visual';
  const total = totalQuestions || 0;

  let html = `<div class="cq-split-panel" id="${panelId}">
    <div class="cq-split-panel-title">
      <span><svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Split into Multiple Quizzes</span>
      <button class="cq-btn cq-btn-secondary" onclick="closeSplitPanel()" style="padding:4px 10px;font-size:.75rem;">✕ Cancel</button>
    </div>
    <div class="cq-split-mode-tabs">
      <button class="cq-split-mode-btn${isEqual ? ' active' : ''}" onclick="setSplitMode('equal')"><svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Equal Chunks</button>
      <button class="cq-split-mode-btn${isCustom ? ' active' : ''}" onclick="setSplitMode('custom')"><svg class="sicon" viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> Custom Ranges</button>
      <button class="cq-split-mode-btn${isVisual ? ' active' : ''}" onclick="setSplitMode('visual')"><svg class="sicon" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Visual Split</button>
    </div>`;

  if (isEqual) {
    html += `<div class="cq-split-range-row">
      <label>Questions per quiz:</label>
      <input type="number" min="1" max="${total}" value="${cqSplitState.chunkSize}"
        oninput="setSplitChunkSize(this.value)" />
      <span id="cqSplitChunkCount_${panelKey}" style="font-size:.78rem;color:var(--violet-dark);font-weight:600;">${_buildChunkCountLabel(total, cqSplitState.chunkSize)}</span>
    </div>`;
  } else if (isCustom) {
    html += `<div style="font-size:.76rem;color:var(--violet-dark);font-weight:700;margin-bottom:8px;">
      Define ranges (1–${total}). Each range becomes a separate quiz.
    </div>`;
    cqSplitState.ranges.forEach((r, i) => {
      html += `<div class="cq-split-range-row">
        <label>Q</label>
        <input type="number" min="1" max="${total}" value="${escapeHtml(r.start)}" placeholder="From"
          oninput="updateSplitRange(${i},'start',this.value)" />
        <label>–</label>
        <input type="number" min="1" max="${total}" value="${escapeHtml(r.end)}" placeholder="To"
          oninput="updateSplitRange(${i},'end',this.value)" />
        <input type="text" value="${escapeHtml(r.label)}" placeholder="Title (optional)"
          oninput="updateSplitRange(${i},'label',this.value)" />
        <button class="cq-split-remove-btn" onclick="removeSplitRange(${i})" title="Remove this range">✕</button>
      </div>`;
    });
    html += `<button class="cq-split-add-range-btn" onclick="addSplitRange()">＋ Add Range</button>`;
  } else if (isVisual) {
    const srcQs = _getSplitSourceQuestions() || [];
    html += _buildVisualSplitHTML(srcQs);
  }

  html += `<div class="cq-split-summary" id="${summaryId}">${_buildSplitSummaryHTML(total)}</div>`;
  html += `<div class="cq-split-status" id="${statusId}"></div>`;
  html += `<div class="cq-split-actions">`;
  if (context === 'adminPublished') {
    html += `<button class="cq-btn" id="cqSplitExecPublishBtn_${panelKey}" onclick="executeSplitQuiz('publish')"
        title="Publish the split parts as new curriculum lectures and remove the original lecture">
        <svg class="sicon" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Split &amp; Publish to Curriculum</button>
      <button class="cq-btn cq-btn-secondary" id="cqSplitExecCustomBtn_${panelKey}" onclick="executeSplitQuiz('custom')"
        style="background:var(--violet);color:#fff;" title="Save the split parts as custom quizzes — the curriculum lecture stays untouched">
        <svg class="sicon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Split to Custom Quizzes</button>`;
  } else {
    html += `<button class="cq-btn" id="cqSplitExecBtn_${panelKey}" onclick="executeSplitQuiz()"><svg class="sicon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6M20 4L8.12 15.88M20 20L14 14"/></svg> Create Split Quizzes</button>`;
  }
  html += `<button class="cq-btn cq-btn-secondary" id="cqSplitCancelBtn_${panelKey}" onclick="closeSplitPanel()">Cancel</button>
  </div>`;
  html += `</div>`;
  return html;
}

/* Locks (or unlocks) an open split panel while executeSplitQuiz's async
   write is in flight: every button inside — mode tabs, range add/remove,
   both execute pathways, Cancel — becomes inert (reusing .cq-bulk-lock,
   the same dim/disable treatment the AI bulk tools use elsewhere), and a
   spinner status line appears under the summary. Looked up fresh by id
   each call rather than cached, since the panel can be several seconds
   into this call before it resolves. */
function _setSplitPanelBusy(panelKey, busy, label) {
  const panel = document.getElementById('cqSplitPanel_' + panelKey);
  if (panel) {
    panel.classList.toggle('cq-bulk-lock', busy);
    panel.querySelectorAll('button').forEach(btn => { btn.disabled = busy; });
  }
  const statusEl = document.getElementById('cqSplitStatus_' + panelKey);
  if (statusEl) {
    statusEl.innerHTML = busy
      ? `<div class="cq-status info"><div class="cq-spinner"></div> ${escapeHtml(label || 'Working…')}</div>`
      : '';
  }
}

async function executeSplitQuiz(targetMode) {
  if (!cqSplitState) return;
  const srcQuestions = _getSplitSourceQuestions();
  if (!srcQuestions || !srcQuestions.length) return;
  const total = srcQuestions.length;

  let chunks;
  if (cqSplitState.mode === 'equal') {
    chunks = _computeEqualChunks(total, cqSplitState.chunkSize);
  } else if (cqSplitState.mode === 'visual') {
    const rawChunks = _getVisualChunksFromCuts(total); // 0-based inclusive
    if (!rawChunks.length) { alert('No cuts defined yet. Click the scissors between questions to split.'); return; }
    const labels = cqSplitState.visualPartLabels || {};
    chunks = rawChunks.map(c => ({
      start: c.start + 1,
      end: c.end + 1,
      label: (labels[c.start] || '').trim()
    }));
  } else {
    chunks = _computeCustomChunks();
    // Validate
    const invalid = chunks.filter(c => c.start < 1 || c.end > total || c.start > c.end);
    if (invalid.length) {
      alert(`Some ranges are out of bounds (valid range: 1–${total}). Please fix them.`);
      return;
    }
  }

  if (!chunks.length) { alert('No valid ranges to create quizzes from.'); return; }

  // Determine base title
  let baseTitle;
  if (cqSplitState.context === 'preview') {
    const titleInput = document.getElementById('cqTitleInput');
    baseTitle = (titleInput && titleInput.value.trim()) || cqGeneratedTitle || 'Custom Quiz';
  } else if (cqSplitState.context === 'adminPublished') {
    const src = adminAssignedEntries.find(x => x.id === cqSplitState.quizId);
    baseTitle = src ? (src.lectureName || src.id) : 'Published Lecture';
  } else {
    const quizzes = loadCustomQuizzes();
    const src = quizzes.find(x => x.id === cqSplitState.quizId);
    baseTitle = src ? src.title : 'Custom Quiz';
  }

  const isCurriculumPublish = cqSplitState.context === 'adminPublished' && targetMode === 'publish';
  const confirmMsg = isCurriculumPublish
    ? `This will replace the curriculum lecture "${baseTitle}" with ${chunks.length} new lecture${chunks.length !== 1 ? 's' : ''} in its place. The original lecture will be removed. Continue?`
    : `This will create ${chunks.length} new quiz${chunks.length !== 1 ? 'zes' : ''} from "${baseTitle}". Continue?`;
  if (!confirm(confirmMsg)) return;

  // Everything from here on writes to Storage/Firestore and can take a
  // few seconds (especially the curriculum-publish pathway, which uploads
  // images per new lecture) — lock the panel and show a spinner for the
  // duration so the split can't be double-submitted with no feedback.
  const panelKey = cqSplitState.quizId || 'preview';
  _setSplitPanelBusy(panelKey, true, isCurriculumPublish ? 'Splitting & publishing…' : 'Splitting…');

  // ── Admin-published curriculum lectures: the admin chooses between two
  // pathways —
  // 'publish' (normal pathway): the split parts REPLACE the original
  // lecture as new published curriculum lectures — live for all users.
  // 'custom': the split parts go into the admin's own Custom Quizzes
  // instead, leaving the original curriculum lecture untouched, so the
  // admin can review/edit each part before publishing it themselves. ──
  if (isCurriculumPublish) {
    const origLectureId = cqSplitState.quizId;
    const subject = adminTargetSubject;
    try {
      const publishedAt = Date.now();
      const newLectures = [];
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const partQuestions = JSON.parse(JSON.stringify(srcQuestions.slice(c.start - 1, c.end))).map(q => {
          delete q.imageUrl;
          delete q.sharedImageIdx;
          delete q.pubImageIdx;
          if (!q.qid) q.qid = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          return q;
        });
        const lectureName = ((cqSplitState.mode === 'custom' || cqSplitState.mode === 'visual') && c.label)
          ? c.label
          : `${baseTitle} — Part ${i + 1} (Q${c.start}–Q${Math.min(c.end, total)})`;
        const lectureId = 'pub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + i;

        // Opportunistic migration: inline any legacy remote image before
        // writing this new lecture — in the normal case this is a no-op.
        await ensureInlineImages(partQuestions);

        const { putContentItem } = await import('./content-client.js');
        await putContentItem('curriculum', subject, lectureId, {
          id: lectureId,
          lectureName,
          questions: partQuestions,
          sourceTitle: baseTitle,
          sourceType: 'split',
          publishedBy: window._currentUser ? window._currentUser.uid : null,
          publishedAt: publishedAt + i,
          order: publishedAt + i
        });
        newLectures.push({ lectureId, lectureName, questions: partQuestions });
      }

      // Remove the original lecture now that its replacements are live.
      const { deleteContentItem } = await import('./content-client.js');
      await deleteContentItem('curriculum', subject, origLectureId);

      // Update in-memory subject: drop the old lecture, add the new ones.
      // Images are already resolved, permanent R2 URLs (putContentItem
      // mutated them in place during upload) — no separate hydrate needed.
      if (subjects[subject].lectures) delete subjects[subject].lectures[baseTitle];
      if (!subjects[subject].lectures) subjects[subject].lectures = {};
      for (const nl of newLectures) {
        subjects[subject].lectures[nl.lectureName] = nl.questions;
      }

      // If the original lecture was open in the editor, close it.
      if (adminEditMode === 'published' && adminEditingPublishedId === origLectureId) {
        adminEditMode = null;
        adminEditQuestions = null;
        adminEditingPublishedId = null;
        adminEditingPublishedName = '';
      }
      // Manifest bumps for the removed original and each new part already
      // happened server-side in the Worker (as part of the writes/delete
      // above) — no separate calls needed here.

      cqSplitState = null;
      renderAdminAssignedList();
      if (selectedSubject === subject) selectSubject(subject);
      alert(`Published ${newLectures.length} new lecture${newLectures.length !== 1 ? 's' : ''} from "${baseTitle}" to ${subjects[subject].label || subject}, replacing the original lecture.`);
    } catch (e) {
      _setSplitPanelBusy(panelKey, false);
      alert('Failed to split & publish: ' + (e.message || e));
    }
    return;
  }

  if (cqSplitState.context === 'adminPublished') {
    const customQuizzes = loadCustomQuizzes();
    const newCustomQuizzes = chunks.map((c, i) => {
      const partQuestions = JSON.parse(JSON.stringify(srcQuestions.slice(c.start - 1, c.end)));
      // Strip published-lecture-specific image sentinels; images are already
      // hydrated inline as q.image at this point (see openAdminSplitPanel),
      // and custom quizzes manage their own image storage separately.
      partQuestions.forEach(q => { delete q.imageUrl; delete q.sharedImageIdx; delete q.pubImageIdx; });
      return {
        id: 'cq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + i,
        title: ((cqSplitState.mode === 'custom' || cqSplitState.mode === 'visual') && c.label)
          ? c.label
          : `${baseTitle} — Part ${i + 1} (Q${c.start}–Q${Math.min(c.end, total)})`,
        questions: partQuestions,
        createdAt: Date.now() + i
      };
    });

    try {
      newCustomQuizzes.reverse().forEach(q => customQuizzes.unshift(q));
      await saveCustomQuizzesList(customQuizzes);
    } catch (e) {
      _setSplitPanelBusy(panelKey, false);
      alert('Failed to create split quizzes: ' + (e.message || e));
      return;
    }

    cqSplitState = null;
    _renderAdminAssignedListHTML();
    alert(`Created ${newCustomQuizzes.length} split quiz${newCustomQuizzes.length !== 1 ? 'zes' : ''} from "${baseTitle}".\n\nThese were NOT published directly to students — they've been added to your Custom Quizzes, where you can review and publish each one individually when ready.`);
    return;
  }

  const quizzes = loadCustomQuizzes();
  const srcQuiz = cqSplitState.quizId ? quizzes.find(q => q.id === cqSplitState.quizId) : null;
  const splitCollectionId = _cqTargetCollectionId(srcQuiz);
  const newQuizzes = chunks.map((c, i) => ({
    id: 'cq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + i,
    title: ((cqSplitState.mode === 'custom' || cqSplitState.mode === 'visual') && c.label)
      ? c.label
      : `${baseTitle} — Part ${i + 1} (Q${c.start}–Q${Math.min(c.end, total)})`,
    questions: srcQuestions.slice(c.start - 1, c.end),
    createdAt: Date.now() + i,
    collectionId: splitCollectionId
  }));

  // Insert new quizzes at top
  newQuizzes.reverse().forEach(q => quizzes.unshift(q));
  try {
    await saveCustomQuizzesList(quizzes);
  } catch (e) {
    _setSplitPanelBusy(panelKey, false);
    alert('Failed to create split quizzes: ' + (e.message || e));
    return;
  }

  // If preview context, also clear preview state
  if (cqSplitState.context === 'preview') {
    cqGeneratedQuestions = null;
    cqSelectedFiles = [];
    cqLectureFiles = [];
    cqGeneratedTitle = '';
  }

  cqSplitState = null;
  renderCustomQuizModal();
  const statusEl = document.getElementById('cqStatus');
  if (statusEl) statusEl.innerHTML = `<div class="cq-status success"><svg class="sicon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Created ${newQuizzes.length} split quiz${newQuizzes.length !== 1 ? 'zes' : ''} from "${escapeHtml(baseTitle)}"!</div>`;
}

async function deleteCustomQuiz(id) {
  if (!confirm('Delete this custom quiz? This cannot be undone.')) return;
  let quizzes = loadCustomQuizzes();
  quizzes = quizzes.filter(q => q.id !== id);
  // No Firestore cleanup needed anymore — custom quizzes (and their images,
  // kept inline) live entirely in local storage; saveCustomQuizzesList's
  // local-storage diff already removes this quiz's entry cleanly.
  await saveCustomQuizzesList(quizzes);
  renderCustomQuizModal();
}

/* Quick standalone rename for a saved custom quiz — just its title, no
   need to open the full question editor for that. Reuses the same
   saveCustomQuizzesList() round-trip deleteCustomQuiz above already uses;
   a custom quiz's images are stored inline (as data: URLs, right in
   IndexedDB) so a rename-only re-save doesn't need to touch them at all. */
async function renameCustomQuiz(id) {
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz) return;
  const current = quiz.title || 'Untitled Quiz';
  const newTitle = prompt(`Rename quiz "${current}" to:`, current);
  if (newTitle === null) return; // cancelled
  const trimmed = newTitle.trim();
  if (!trimmed || trimmed === current) return;
  quiz.title = trimmed;
  await saveCustomQuizzesList(quizzes);
  renderCustomQuizModal();
}

function startCustomQuiz(id) {
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz || !quiz.questions || !quiz.questions.length) return;

  const minsInput = document.getElementById('cqMins_' + id);
  const shuffleInput = document.getElementById('cqShuffle_' + id);
  let mins = minsInput ? parseInt(minsInput.value, 10) : NaN;
  if (!mins || mins <= 0) mins = Math.max(5, quiz.questions.length);
  const shuffle = shuffleInput ? shuffleInput.checked : false;

  let combined = JSON.parse(JSON.stringify(quiz.questions));
  // Always pass through the group-aware layout — see the matching comment
  // in app-core.js's startQuiz() for why this runs even when shuffle is off.
  combined = _cqGroupAwareOrder(combined, shuffle);

  selectedSubject = 'Custom Quizzes';
  currentLecture = quiz.title;
  currentQuestions = combined;
  currentIndex = 0; userAnswers = {}; markedSet = new Set();
  questionTimes = {}; correctToWrong = 0; wrongToCorrect = 0; changeLog = [];
  timeLeft = mins * 60;
  currentQuizSource = 'custom';
  // No Year/Module for a custom quiz — grouped under its own bucket in
  // Statistics instead of the curriculum tree (see buildCurriculumStatsTree()
  // in app-core.js). Clearing this explicitly also prevents it from
  // accidentally inheriting whatever Year/Module was last browsed.
  currentQuizYear = ''; currentQuizModule = ''; currentQuizComponents = null;

  closeCustomQuizzes();
  showScreen('quiz');
  renderQuestion();
  startTimer();
}

/* ── Taking several saved custom quizzes together in one sitting ── */
function toggleCqMultiSelect(id, checked) {
  if (checked) cqMultiSelected.add(id); else cqMultiSelected.delete(id);
  renderCustomQuizModal();
}

function clearCqMultiSelect() {
  cqMultiSelected = new Set();
  renderCustomQuizModal();
}

function startCustomQuizzesMulti() {
  const quizzes = loadCustomQuizzes();
  const selected = quizzes.filter(q => cqMultiSelected.has(q.id));
  if (!selected.length) return;

  const minsInput = document.getElementById('cqMultiMins');
  const shuffleInput = document.getElementById('cqMultiShuffle');
  const totalQs = selected.reduce((sum, q) => sum + q.questions.length, 0);
  let mins = minsInput ? parseInt(minsInput.value, 10) : NaN;
  if (!mins || mins <= 0) mins = Math.max(5, totalQs);
  const shuffle = shuffleInput ? shuffleInput.checked : false;

  // Each saved quiz's case-group ids are only guaranteed unique *within
  // that quiz* — two different quizzes could coincidentally reuse the same
  // group id (e.g. both had it as their first extracted file). Namespace
  // every group id by its source quiz here, on this ephemeral combined
  // copy only, so a case cluster from one quiz can never accidentally
  // merge with an unrelated one from another quiz.
  // Each saved quiz's case-group ids (and, within a group, its sub-case
  // case_link_id/case_parent_id ids) are only guaranteed unique *within
  // that quiz* — two different quizzes could coincidentally reuse the same
  // ids (e.g. both had it as their first extracted file). Namespace all
  // three by their source quiz here, on this ephemeral combined copy only,
  // so a case cluster — and any sub-cases nested inside it — from one quiz
  // can never accidentally merge with an unrelated one from another quiz.
  let combined = [];
  selected.forEach(quiz => {
    const qs = JSON.parse(JSON.stringify(quiz.questions));
    qs.forEach(q => {
      if (q.case_group) q.case_group = quiz.id + '::' + q.case_group;
      if (q.case_link_id) q.case_link_id = quiz.id + '::' + q.case_link_id;
      if (q.case_parent_id) q.case_parent_id = quiz.id + '::' + q.case_parent_id;
    });
    combined = combined.concat(qs);
  });

  // Always pass through the group-aware layout — see the matching comment
  // in app-core.js's startQuiz() for why this runs even when shuffle is off.
  combined = _cqGroupAwareOrder(combined, shuffle);

  selectedSubject = 'Custom Quizzes';
  currentLecture = selected.length === 1
    ? selected[0].title
    : `${selected.length} quizzes (${selected.map(q => q.title).join(', ')})`;
  currentQuestions = combined;
  currentIndex = 0; userAnswers = {}; markedSet = new Set();
  questionTimes = {}; correctToWrong = 0; wrongToCorrect = 0; changeLog = [];
  timeLeft = mins * 60;
  currentQuizSource = 'custom';
  currentQuizYear = ''; currentQuizModule = ''; currentQuizComponents = null;

  cqMultiSelected = new Set();
  closeCustomQuizzes();
  showScreen('quiz');
  renderQuestion();
  startTimer();
}

function goHome() {
  stopTimer();
  showScreen('home');
}

