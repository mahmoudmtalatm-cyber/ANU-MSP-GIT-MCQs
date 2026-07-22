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
    visualLabels: {}
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
  if (mode === 'visual' && !cqSplitState.visualCuts) {
    cqSplitState.visualCuts = new Set();
    cqSplitState.visualLabels = {};
  }
  _rerenderSplitOwner();
}

function toggleVisualCut(afterIndex) {
  if (!cqSplitState) return;
  if (!cqSplitState.visualCuts) cqSplitState.visualCuts = new Set();
  if (cqSplitState.visualCuts.has(afterIndex)) {
    cqSplitState.visualCuts.delete(afterIndex);
    if (cqSplitState.visualLabels) delete cqSplitState.visualLabels[afterIndex];
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

function updateVisualLabel(afterIndex, val) {
  if (!cqSplitState) return;
  if (!cqSplitState.visualLabels) cqSplitState.visualLabels = {};
  cqSplitState.visualLabels[afterIndex] = val;
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
  const labels = cqSplitState.visualLabels || {};

  // Compute which group each question belongs to for color coding
  const chunks = _getVisualChunksFromCuts(total);
  const qGroupMap = {}; // qIndex -> chunkIndex
  chunks.forEach((c, ci) => {
    for (let i = c.start; i <= c.end; i++) qGroupMap[i] = ci;
  });

  let html = `<div class="cq-split-visual-list" id="cqSplitVisual_${cqSplitState.quizId || 'preview'}">`;

  // Hint
  html += `<div style="font-size:.75rem;color:var(--violet-dark);font-weight:700;margin-bottom:8px;line-height:1.5;">
    Click ✂️ between questions to mark a split point. Click again to remove it.
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
      const labelKey = i === 0 ? -1 : (i - 1); // the cut index before this group
      // For part 0, no cut before it; for others, the cut is at i-1
      const actualCutKey = i === 0 ? null : i - 1;
      const labelVal = actualCutKey !== null ? (labels[actualCutKey + '_after'] || '') : (labels['start'] || '');
      const partColor = SPLIT_PART_COLORS[partIdx % SPLIT_PART_COLORS.length];
      html += `<div class="cq-split-part-header" style="background:${partColor.bg};border:1.5px solid ${partColor.border};">
        <span style="font-size:.72rem;font-weight:800;color:${partColor.text};">
          📋 Quiz ${partIdx + 1}
        </span>
        <input type="text" placeholder="Optional title for Quiz ${partIdx + 1}…"
          value="${escapeHtml(labelVal)}"
          oninput="updateVisualPartLabel(${partIdx}, this.value)"
          style="flex:1;min-width:120px;padding:3px 8px;border:1.5px solid ${partColor.border};border-radius:6px;
            font-family:var(--font);font-size:.78rem;background:#fff;outline:none;" />
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
        <button class="cq-scissors-btn" type="button">✂️</button>
        <div class="cq-scissors-line"></div>
        ${isCut ? `<span style="position:absolute;left:50%;transform:translateX(-50%) translateX(22px);font-size:.68rem;font-weight:800;color:var(--violet-darkest);white-space:nowrap;pointer-events:none;">— split here —</span>` : ''}
      </div>`;
    }
  });

  html += `</div>`;
  return html;
}

function updateVisualPartLabel(partIdx, val) {
  if (!cqSplitState) return;
  if (!cqSplitState.visualPartLabels) cqSplitState.visualPartLabels = {};
  cqSplitState.visualPartLabels[partIdx] = val;
  _updateSplitSummary();
}

function setSplitChunkSize(val) {
  if (!cqSplitState) return;
  cqSplitState.chunkSize = parseInt(val, 10) || 10;
  _rerenderSplitOwner();
}

function addSplitRange() {
  if (!cqSplitState) return;
  cqSplitState.ranges.push({ start: '', end: '', label: '' });
  _rerenderSplitOwner();
}

function removeSplitRange(idx) {
  if (!cqSplitState) return;
  cqSplitState.ranges.splice(idx, 1);
  if (!cqSplitState.ranges.length) cqSplitState.ranges.push({ start: '', end: '', label: '' });
  _rerenderSplitOwner();
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
    chunks = rawChunks.map((c, i) => ({
      start: c.start + 1,
      end: c.end + 1,
      label: labels[i] || ''
    }));
  } else {
    chunks = _computeCustomChunks();
  }
  if (!chunks.length) return `<span style="color:var(--unanswered-fg);font-size:.78rem;font-weight:700;">⚠️ No valid ranges defined yet.</span>`;
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
    html += `<span class="cq-split-chip warn">⚠️ ${uncovered} question${uncovered !== 1 ? 's' : ''} not covered</span>`;
  }
  return html;
}

function renderSplitPanel(context, quizId, totalQuestions) {
  if (!cqSplitState) return '';
  if (cqSplitState.context !== context || cqSplitState.quizId !== (quizId || null)) return '';
  const panelId = 'cqSplitPanel_' + (quizId || 'preview');
  const summaryId = 'cqSplitSummary_' + (quizId || 'preview');
  const mode = cqSplitState.mode || 'equal';
  const isEqual = mode === 'equal';
  const isCustom = mode === 'custom';
  const isVisual = mode === 'visual';
  const total = totalQuestions || 0;

  let html = `<div class="cq-split-panel" id="${panelId}">
    <div class="cq-split-panel-title">
      <span>✂️ Split into Multiple Quizzes</span>
      <button class="cq-btn cq-btn-secondary" onclick="closeSplitPanel()" style="padding:4px 10px;font-size:.75rem;">✕ Cancel</button>
    </div>
    <div class="cq-split-mode-tabs">
      <button class="cq-split-mode-btn${isEqual ? ' active' : ''}" onclick="setSplitMode('equal')">📐 Equal Chunks</button>
      <button class="cq-split-mode-btn${isCustom ? ' active' : ''}" onclick="setSplitMode('custom')">✏️ Custom Ranges</button>
      <button class="cq-split-mode-btn${isVisual ? ' active' : ''}" onclick="setSplitMode('visual')">✂️ Visual Split</button>
    </div>`;

  if (isEqual) {
    html += `<div class="cq-split-range-row">
      <label>Questions per quiz:</label>
      <input type="number" min="1" max="${total}" value="${cqSplitState.chunkSize}"
        oninput="setSplitChunkSize(this.value)" />
      <span style="font-size:.78rem;color:var(--violet-dark);font-weight:600;">
        (${total} total → ${_computeEqualChunks(total, cqSplitState.chunkSize).length} quiz${_computeEqualChunks(total, cqSplitState.chunkSize).length !== 1 ? 'zes' : ''})
      </span>
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
  html += `<div class="cq-split-actions">`;
  if (context === 'adminPublished') {
    html += `<button class="cq-btn" onclick="executeSplitQuiz('publish')"
        title="Publish the split parts as new curriculum lectures and remove the original lecture">
        🚀 Split &amp; Publish to Curriculum</button>
      <button class="cq-btn cq-btn-secondary" onclick="executeSplitQuiz('custom')"
        style="background:var(--violet);color:#fff;" title="Save the split parts as custom quizzes — the curriculum lecture stays untouched">
        📄 Split to Custom Quizzes</button>`;
  } else {
    html += `<button class="cq-btn" onclick="executeSplitQuiz()">✂️ Create Split Quizzes</button>`;
  }
  html += `<button class="cq-btn cq-btn-secondary" onclick="closeSplitPanel()">Cancel</button>
  </div>`;
  html += `</div>`;
  return html;
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
    if (!rawChunks.length) { alert('No cuts defined yet. Click the ✂️ scissors between questions to split.'); return; }
    const labels = cqSplitState.visualPartLabels || {};
    chunks = rawChunks.map((c, i) => ({
      start: c.start + 1,
      end: c.end + 1,
      label: labels[i] || ''
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

  // ── Admin-published curriculum lectures: the admin chooses between two
  //    pathways —
  //    'publish' (normal pathway): the split parts REPLACE the original
  //    lecture as new published curriculum lectures — live for all users.
  //    'custom': the split parts go into the admin's own Custom Quizzes
  //    instead, leaving the original curriculum lecture untouched, so the
  //    admin can review/edit each part before publishing it themselves. ──
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
          delete q.pubImageIdx; // will be re-assigned after upload
          return q;
        });
        const lectureName = ((cqSplitState.mode === 'custom' || cqSplitState.mode === 'visual') && c.label)
          ? c.label
          : `${baseTitle} — Part ${i + 1} (Q${c.start}–Q${Math.min(c.end, total)})`;
        const lectureId = 'pub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + i;

        await uploadPublishedLectureImages(subject, lectureId, partQuestions);
        const ref = window._doc(window._db, 'publishedQuestions', subject, 'lectures', lectureId);
        await window._setDoc(ref, cleanForFirestore({
          id: lectureId,
          lectureName,
          questions: partQuestions,
          sourceTitle: baseTitle,
          sourceType: 'split',
          publishedBy: window._currentUser ? window._currentUser.uid : null,
          publishedAt: publishedAt + i,
          order: publishedAt + i
        }));
        newLectures.push({ lectureId, lectureName, questions: partQuestions });
      }

      // Remove the original lecture now that its replacements are live.
      await deletePublishedLectureImages(subject, origLectureId);
      await window._deleteDoc(window._doc(window._db, 'publishedQuestions', subject, 'lectures', origLectureId));

      // Update in-memory subject: drop the old lecture, add the new ones.
      if (subjects[subject].lectures) delete subjects[subject].lectures[baseTitle];
      if (!subjects[subject].lectures) subjects[subject].lectures = {};
      for (const nl of newLectures) {
        const hydrated = JSON.parse(JSON.stringify(nl.questions));
        await hydratePublishedLectureImages(subject, nl.lectureId, hydrated);
        subjects[subject].lectures[nl.lectureName] = hydrated;
      }

      // If the original lecture was open in the editor, close it.
      if (adminEditMode === 'published' && adminEditingPublishedId === origLectureId) {
        adminEditMode = null;
        adminEditQuestions = null;
        adminEditingPublishedId = null;
        adminEditingPublishedName = '';
      }

      _idbDelete('published:' + subject + ':' + origLectureId);
      await _updatePublishedManifest(subject, origLectureId, null);
      for (const nl of newLectures) {
        await _updatePublishedManifest(subject, nl.lectureId, publishedAt);
      }

      cqSplitState = null;
      renderAdminAssignedList();
      if (selectedSubject === subject) selectSubject(subject);
      alert(`✅ Published ${newLectures.length} new lecture${newLectures.length !== 1 ? 's' : ''} from "${baseTitle}" to ${subjects[subject].label || subject}, replacing the original lecture.`);
    } catch (e) {
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
      alert('Failed to create split quizzes: ' + (e.message || e));
      return;
    }

    cqSplitState = null;
    _renderAdminAssignedListHTML();
    alert(`✅ Created ${newCustomQuizzes.length} split quiz${newCustomQuizzes.length !== 1 ? 'zes' : ''} from "${baseTitle}".\n\nThese were NOT published directly to students — they've been added to your Custom Quizzes, where you can review and publish each one individually when ready.`);
    return;
  }

  const quizzes = loadCustomQuizzes();
  const newQuizzes = chunks.map((c, i) => ({
    id: 'cq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + i,
    title: ((cqSplitState.mode === 'custom' || cqSplitState.mode === 'visual') && c.label)
      ? c.label
      : `${baseTitle} — Part ${i + 1} (Q${c.start}–Q${Math.min(c.end, total)})`,
    questions: srcQuestions.slice(c.start - 1, c.end),
    createdAt: Date.now() + i
  }));

  // Insert new quizzes at top
  newQuizzes.reverse().forEach(q => quizzes.unshift(q));
  await saveCustomQuizzesList(quizzes);

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
  if (statusEl) statusEl.innerHTML = `<div class="cq-status success">✅ Created ${newQuizzes.length} split quiz${newQuizzes.length !== 1 ? 'zes' : ''} from "${escapeHtml(baseTitle)}"!</div>`;
}

async function deleteCustomQuiz(id) {
  if (!confirm('Delete this custom quiz? This cannot be undone.')) return;
  let quizzes = loadCustomQuizzes();
  quizzes = quizzes.filter(q => q.id !== id);
  await deleteQuizImagesFromStorage(id);
  await saveCustomQuizzesList(quizzes);
  renderCustomQuizModal();
}

function startCustomQuiz(id) {
  const quizzes = loadCustomQuizzes();
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz || !quiz.questions || !quiz.questions.length) return;

  const minsInput     = document.getElementById('cqMins_' + id);
  const shuffleInput  = document.getElementById('cqShuffle_' + id);
  let mins = minsInput ? parseInt(minsInput.value, 10) : NaN;
  if (!mins || mins <= 0) mins = Math.max(5, quiz.questions.length);
  const shuffle = shuffleInput ? shuffleInput.checked : false;

  let combined = JSON.parse(JSON.stringify(quiz.questions));
  if (shuffle) {
    combined = _cqGroupAwareShuffle(combined);
  }

  selectedSubject  = 'Custom Quizzes';
  currentLecture   = quiz.title;
  currentQuestions = combined;
  currentIndex = 0; userAnswers = {}; markedSet = new Set();
  questionTimes = {}; correctToWrong = 0; wrongToCorrect = 0; changeLog = [];
  timeLeft = mins * 60;
  currentQuizSource = 'custom';

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
  const quizzes  = loadCustomQuizzes();
  const selected = quizzes.filter(q => cqMultiSelected.has(q.id));
  if (!selected.length) return;

  const minsInput    = document.getElementById('cqMultiMins');
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
  let combined = [];
  selected.forEach(quiz => {
    const qs = JSON.parse(JSON.stringify(quiz.questions));
    qs.forEach(q => { if (q.case_group) q.case_group = quiz.id + '::' + q.case_group; });
    combined = combined.concat(qs);
  });

  if (shuffle) {
    combined = _cqGroupAwareShuffle(combined);
  }

  selectedSubject  = 'Custom Quizzes';
  currentLecture   = selected.length === 1
    ? selected[0].title
    : `${selected.length} quizzes (${selected.map(q => q.title).join(', ')})`;
  currentQuestions = combined;
  currentIndex = 0; userAnswers = {}; markedSet = new Set();
  questionTimes = {}; correctToWrong = 0; wrongToCorrect = 0; changeLog = [];
  timeLeft = mins * 60;
  currentQuizSource = 'custom';

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

