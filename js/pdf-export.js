/* =============================================================================
   pdf-export.js

   Drop #100 — "Export to PDF" inside the 💾 Backup & Transfer modal.

   Lets a signed-in student (or admin) turn any mix of Curriculum lectures,
   Community quizzes and their own Custom quizzes into a single, elegantly
   designed PDF study booklet — cover page, an overview/contents page,
   book-style Part/Chapter/Section organisation (Year → Module → Subject →
   Lecture for curriculum picks, folder-grouped for custom quizzes, category-
   grouped for community quizzes), the questions themselves (no answers —
   multiple-choice options only, with any question image inlined and
   resizable), and a colour-coded Answer Key + closing "scan to visit" QR
   page at the very end.

   Depends only on globals already shared by every other plain script in
   this app: `curriculum`, `subjects`, `escapeHtml`, `ensureInlineImages`,
   `loadCustomQuizzes`, `loadQuizCollections`, `_allSharedQuizzes` /
   `ensureSharedQuizzesLoaded` (community-quizzes.js). The PDF engine itself
   (jsPDF) is lazy-loaded from a CDN on first use, exactly like pdf.js is
   lazy-loaded in gemini-uploads.js — this file never touches the network
   until the person actually presses "Generate PDF".

   No answers are ever printed next to a question — every export ends with
   a dedicated Answer Key section instead, and every page (except the cover
   and the closing QR page) carries a slim branded header/footer stamped in
   a single finishing pass once the full page count is known.
   ============================================================================= */

/* ── PDF text safety ──
   jsPDF's built-in fonts (Helvetica/Times/Courier — the only ones used
   here, deliberately, to avoid shipping a multi-hundred-KB embedded font)
   only support the WinAnsi/Latin-1 character set. Emoji, most curly
   punctuation, Greek letters, and many math symbols fall outside that and
   render as garbled boxes/junk glyphs instead of failing loudly — so
   every single string that reaches doc.text()/splitTextToSize() (both
   the PDF's own chrome AND real question/quiz content, which can contain
   any of the above) is routed through this sanitizer first. Common
   symbols are transliterated to a clean ASCII equivalent; anything left
   over that still can't be represented is dropped rather than printed as
   garbage. The on-screen picker UI/live preview are untouched — browsers
   render Unicode and emoji fine, this only applies to text drawn INTO
   the actual PDF. */
const PDX_SYMBOL_MAP = {
  '—': '-', '–': '-', '‑': '-', '‒': '-', '―': '-',
  '…': '...', '·': '.', '•': '*', '∙': '*',
  '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"',
  '‹': '<', '›': '>', '«': '<<', '»': '>>',
  '＋': '+', '×': 'x', '÷': '/', '±': '+/-',
  '≤': '<=', '≥': '>=', '≈': '~', '≠': '!=',
  '→': '->', '←': '<-', '↔': '<->', '∞': 'inf', '°': ' deg',
  'µ': 'u', 'μ': 'u', 'Ω': 'Ohm',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'θ': 'theta', 'λ': 'lambda', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma',
  'τ': 'tau', 'φ': 'phi', 'ω': 'omega', 'Δ': 'Delta', 'Σ': 'Sum',
  '\u00A0': ' ', '\u202F': ' ', '\u2009': ' ', '\u200B': '',
};
function _pdxSafeText(input) {
  if (input == null) return '';
  const out = [];
  for (const ch of String(input)) {
    if (Object.prototype.hasOwnProperty.call(PDX_SYMBOL_MAP, ch)) { out.push(PDX_SYMBOL_MAP[ch]); continue; }
    if (ch.codePointAt(0) <= 0xFF) { out.push(ch); continue; }
    // Emoji, CJK/other scripts, and any other symbol without a mapping
    // above simply can't be drawn by a core PDF font — drop, don't garble.
  }
  return out.join('').replace(/[ \t]{2,}/g, ' ').trim();
}
/* Formats a Date without relying on toLocaleDateString — some locales
   insert a narrow no-break space or other non-Latin1 punctuation between
   parts, which is exactly the kind of thing this whole sanitizer exists
   to avoid needing to clean up after the fact. */
function _pdxFormatDate(d) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/* ── Curated colour palette ──
   Five book-style "part" colours pulled straight from the app's own design
   tokens (css/styles.css :root) so the PDF always feels like a natural
   extension of the site, never a mismatched bolt-on. The person's chosen
   "Theme" picks which one leads (used for the cover + running header); the
   remaining four are still used to colour-code separate Parts of the same
   export (e.g. Year 1 vs Year 2, or Curriculum vs Community vs Custom) so
   a big multi-source export reads as organised and colourful rather than
   one long grey wall of text. */
const PDX_PALETTE = {
  teal:   { name: '🟦 Teal (default)', base: '#0E6E82', dark: '#0A3F52', light: '#29C2D9', pale: '#E4F3F6' },
  violet: { name: '🟪 Violet',         base: '#6B4FA0', dark: '#4E3878', light: '#7E57C2', pale: '#EFEAF8' },
  gold:   { name: '🟧 Gold',           base: '#C98D1F', dark: '#8A5E12', light: '#E7B65C', pale: '#FBF1DE' },
  forest: { name: '🟩 Forest',         base: '#2E7A4F', dark: '#1F5C3B', light: '#4C9A6B', pale: '#E5F3EC' },
  berry:  { name: '🟥 Berry',          base: '#B23A3A', dark: '#8F2A2A', light: '#D97A7A', pale: '#F8DADA' },
};
const PDX_TEXT_SIZES  = { small: { q: 10.5, opt: 9.5,  label: 8.5  }, medium: { q: 12, opt: 10.5, label: 9.5 }, large: { q: 13.5, opt: 12, label: 10.5 } };
const PDX_IMAGE_SIZES = { small: 90, medium: 160, large: 230 }; // max image height, in pt

/* ── Selection & UI state ── */
let _pdxTab            = 'curriculum'; // 'curriculum' | 'community' | 'custom'
let _pdxSelCurriculum  = new Set();    // "subjectKey::lectureName"
let _pdxSelCommunity   = new Set();    // shared quiz ids
let _pdxSelCustom      = new Set();    // custom quiz ids
let _pdxCurrYear       = '';
let _pdxCurrModule     = '';
let _pdxCurrSubject    = '';
let _pdxCommSearch     = '';
let _pdxCustomSearch   = '';
let _pdxSettings       = { textSize: 'medium', imageSize: 'medium', theme: 'teal' };
let _pdxAssetCache     = { logo: null, qr: null };

/* ══════════════════════════════════════════════════════════
   OPEN / CLOSE
══════════════════════════════════════════════════════════ */
function openPdfExport() {
  document.getElementById('pdfExportOverlay').classList.remove('hidden');
  renderPdfExportModal();
}
function closePdfExport() {
  document.getElementById('pdfExportOverlay').classList.add('hidden');
}

async function renderPdfExportModal() {
  const body = document.getElementById('pdfExportBody');
  body.innerHTML = `
    <div class="pdx-intro">
      Build a print-ready PDF study booklet from any mix of official curriculum
      lectures, community quizzes and your own custom quizzes. Questions only —
      no answers shown next to them — with a full answer key at the end.
    </div>

    <div class="pdx-layout">
      <div class="pdx-picker-col">
        <div class="community-section-tabs pdx-source-tabs">
          <button class="community-tab-btn ${_pdxTab === 'curriculum' ? 'active' : ''}" onclick="pdxSetTab('curriculum')">🏛️ Curriculum ${_pdxSelCurriculum.size ? `(${_pdxSelCurriculum.size})` : ''}</button>
          <button class="community-tab-btn ${_pdxTab === 'community'  ? 'active' : ''}" onclick="pdxSetTab('community')">🌐 Community ${_pdxSelCommunity.size ? `(${_pdxSelCommunity.size})` : ''}</button>
          <button class="community-tab-btn ${_pdxTab === 'custom'     ? 'active' : ''}" onclick="pdxSetTab('custom')">🤖 My Custom Quizzes ${_pdxSelCustom.size ? `(${_pdxSelCustom.size})` : ''}</button>
        </div>
        <div id="pdxTabContent" class="pdx-tab-content"></div>

        <div class="pdx-selection-bar">
          <span id="pdxSelectionCount">${_pdxTotalSelected()} item${_pdxTotalSelected() === 1 ? '' : 's'} selected</span>
          <button class="pdx-clear-btn" onclick="pdxClearAll()">🗑 Clear All</button>
        </div>
      </div>

      <div class="pdx-settings-col">
        <div class="pdx-settings-card">
          <div class="pdx-settings-title">🎨 Look &amp; Feel</div>

          <div class="pdx-field-label">Text size</div>
          <div class="pdx-segmented" id="pdxTextSizeGroup">
            ${['small','medium','large'].map(v => `<button type="button" class="pdx-seg-btn ${_pdxSettings.textSize === v ? 'active' : ''}" onclick="pdxSetTextSize('${v}')">${v === 'small' ? 'Aa Small' : v === 'medium' ? 'Aa Medium' : 'Aa Large'}</button>`).join('')}
          </div>

          <div class="pdx-field-label">Image size</div>
          <div class="pdx-segmented" id="pdxImageSizeGroup">
            ${['small','medium','large'].map(v => `<button type="button" class="pdx-seg-btn ${_pdxSettings.imageSize === v ? 'active' : ''}" onclick="pdxSetImageSize('${v}')">${v.charAt(0).toUpperCase()+v.slice(1)}</button>`).join('')}
          </div>

          <div class="pdx-field-label">Colour theme</div>
          <div class="pdx-theme-swatches" id="pdxThemeGroup">
            ${Object.keys(PDX_PALETTE).map(k => `<button type="button" class="pdx-swatch ${_pdxSettings.theme === k ? 'active' : ''}" style="--sw:${PDX_PALETTE[k].base};--sw2:${PDX_PALETTE[k].light}" title="${PDX_PALETTE[k].name}" onclick="pdxSetTheme('${k}')"></button>`).join('')}
          </div>

          <div class="pdx-field-label">File name (optional)</div>
          <input type="text" id="pdxFileName" class="backup-text-input" placeholder="anu-msp-study-pack" maxlength="80" />
        </div>

        <div class="pdx-preview-card">
          <div class="pdx-settings-title">👁️ Live Preview <span class="pdx-preview-tag">sample page — not real content</span></div>
          <div id="pdxPreview" class="pdx-preview-page"></div>
        </div>
      </div>
    </div>

    <div class="pdx-footer">
      <div id="pdxGenStatus" class="backup-status-area"></div>
      <div class="pdx-footer-actions">
        <button class="cq-btn cq-btn-secondary" onclick="closePdfExport()">✖ Close</button>
        <button class="cq-btn" id="pdxGenerateBtn" onclick="pdxGenerate()" ${_pdxTotalSelected() ? '' : 'disabled'}>⬇️ Generate PDF</button>
      </div>
    </div>
  `;
  pdxRenderTabContent();
  pdxRenderPreview();
}

/* ══════════════════════════════════════════════════════════
   SELECTION TOTALS / SUMMARY BAR
══════════════════════════════════════════════════════════ */
function _pdxTotalSelected() {
  return _pdxSelCurriculum.size + _pdxSelCommunity.size + _pdxSelCustom.size;
}
function _pdxRefreshChrome() {
  const countEl = document.getElementById('pdxSelectionCount');
  if (countEl) countEl.textContent = `${_pdxTotalSelected()} item${_pdxTotalSelected() === 1 ? '' : 's'} selected`;
  const btn = document.getElementById('pdxGenerateBtn');
  if (btn) btn.disabled = !_pdxTotalSelected();
  document.querySelectorAll('.pdx-source-tabs .community-tab-btn').forEach((btn, i) => {
    const counts = [_pdxSelCurriculum.size, _pdxSelCommunity.size, _pdxSelCustom.size];
    const labels = ['🏛️ Curriculum', '🌐 Community', '🤖 My Custom Quizzes'];
    btn.textContent = `${labels[i]} ${counts[i] ? `(${counts[i]})` : ''}`.trim();
  });
}
function pdxClearAll() {
  _pdxSelCurriculum = new Set();
  _pdxSelCommunity  = new Set();
  _pdxSelCustom     = new Set();
  pdxRenderTabContent();
  _pdxRefreshChrome();
}

function pdxSetTab(tab) {
  _pdxTab = tab;
  pdxRenderTabContent();
}
function pdxRenderTabContent() {
  if (_pdxTab === 'curriculum')      _pdxRenderCurriculumTab();
  else if (_pdxTab === 'community')  _pdxRenderCommunityTab();
  else                                _pdxRenderCustomTab();
}

/* ══════════════════════════════════════════════════════════
   CURRICULUM TAB — Year → Module → Subject drilldown, same
   dropdown pattern as the Merge picker (community-quizzes.js),
   plus a "＋ Whole …" shortcut at every level so a whole year,
   module, or subject can be queued in one click instead of
   checking every lecture by hand.
══════════════════════════════════════════════════════════ */
function pdxOnYearChange(v)    { _pdxCurrYear = v; _pdxCurrModule = ''; _pdxCurrSubject = ''; _pdxRenderCurriculumTab(); }
function pdxOnModuleChange(v)  { _pdxCurrModule = v; _pdxCurrSubject = ''; _pdxRenderCurriculumTab(); }
function pdxOnSubjectChange(v) { _pdxCurrSubject = v; _pdxRenderCurriculumTab(); }

function _pdxAllLecturesUnder(year, mod, subjectKey) {
  const out = [];
  const years   = year   ? [year]   : Object.keys(curriculum);
  years.forEach(y => {
    const mods = mod ? [mod] : Object.keys(curriculum[y] || {});
    mods.forEach(m => {
      const subs = subjectKey ? [subjectKey] : (curriculum[y][m] || []).filter(k => subjects[k]);
      subs.forEach(s => {
        Object.keys((subjects[s] || {}).lectures || {}).forEach(lec => out.push(`${s}::${lec}`));
      });
    });
  });
  return out;
}
function pdxAddWholeYear() {
  if (!_pdxCurrYear) return;
  _pdxAllLecturesUnder(_pdxCurrYear).forEach(k => _pdxSelCurriculum.add(k));
  _pdxRenderCurriculumTab(); _pdxRefreshChrome();
}
function pdxAddWholeModule() {
  if (!_pdxCurrYear || !_pdxCurrModule) return;
  _pdxAllLecturesUnder(_pdxCurrYear, _pdxCurrModule).forEach(k => _pdxSelCurriculum.add(k));
  _pdxRenderCurriculumTab(); _pdxRefreshChrome();
}
function pdxAddWholeSubject() {
  if (!_pdxCurrSubject) return;
  _pdxAllLecturesUnder(_pdxCurrYear, _pdxCurrModule, _pdxCurrSubject).forEach(k => _pdxSelCurriculum.add(k));
  _pdxRenderCurriculumTab(); _pdxRefreshChrome();
}
function pdxToggleLecture(key, checked) {
  if (checked) _pdxSelCurriculum.add(key); else _pdxSelCurriculum.delete(key);
  _pdxRefreshChrome();
  const badge = document.getElementById('pdxSubjectSelectedBadge');
  if (badge) badge.textContent = _pdxAllLecturesUnder(_pdxCurrYear, _pdxCurrModule, _pdxCurrSubject).filter(k => _pdxSelCurriculum.has(k)).length;
}

function _pdxRenderCurriculumTab() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;
  const years   = Object.keys(curriculum);
  const modules = _pdxCurrYear ? Object.keys(curriculum[_pdxCurrYear] || {}) : [];
  const subs    = (_pdxCurrYear && _pdxCurrModule) ? (curriculum[_pdxCurrYear][_pdxCurrModule] || []).filter(k => subjects[k]) : [];

  let html = `
    <div class="pdx-drill-row">
      <div class="admin-field">
        <label>Year</label>
        <select onchange="pdxOnYearChange(this.value)">
          <option value="">— Select year —</option>
          ${years.map(y => `<option value="${escapeHtml(y)}" ${_pdxCurrYear === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="pdx-whole-btn" ${!_pdxCurrYear ? 'disabled' : ''} onclick="pdxAddWholeYear()">＋ Whole Year</button>
    </div>
    <div class="pdx-drill-row">
      <div class="admin-field">
        <label>Module</label>
        <select onchange="pdxOnModuleChange(this.value)" ${!_pdxCurrYear ? 'disabled' : ''}>
          <option value="">— Select module —</option>
          ${modules.map(m => `<option value="${escapeHtml(m)}" ${_pdxCurrModule === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="pdx-whole-btn" ${!_pdxCurrModule ? 'disabled' : ''} onclick="pdxAddWholeModule()">＋ Whole Module</button>
    </div>
    <div class="pdx-drill-row">
      <div class="admin-field">
        <label>Subject</label>
        <select onchange="pdxOnSubjectChange(this.value)" ${!_pdxCurrModule ? 'disabled' : ''}>
          <option value="">— Select subject —</option>
          ${subs.map(s => `<option value="${escapeHtml(s)}" ${_pdxCurrSubject === s ? 'selected' : ''}>${escapeHtml(subjects[s].label || s)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="pdx-whole-btn" ${!_pdxCurrSubject ? 'disabled' : ''} onclick="pdxAddWholeSubject()">＋ Whole Subject</button>
    </div>`;

  if (_pdxCurrSubject && subjects[_pdxCurrSubject]) {
    const lectures = Object.keys(subjects[_pdxCurrSubject].lectures || {});
    const selectedHere = lectures.filter(l => _pdxSelCurriculum.has(`${_pdxCurrSubject}::${l}`)).length;
    if (!lectures.length) {
      html += `<div class="community-empty"><div class="ce-icon">📭</div>No lectures in this subject yet.</div>`;
    } else {
      html += `<div class="pdx-lecture-list-header">Lectures <span class="backup-quiz-count" id="pdxSubjectSelectedBadge">${selectedHere}</span></div>
      <div class="pdx-lecture-list">`;
      lectures.forEach(lname => {
        const qCount = subjects[_pdxCurrSubject].lectures[lname].length;
        const key = `${_pdxCurrSubject}::${lname}`;
        const checked = _pdxSelCurriculum.has(key);
        html += `<label class="backup-quiz-row backup-quiz-item">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="pdxToggleLecture('${escapeHtml(key).replace(/'/g,"\\'")}', this.checked)" />
          <span>${escapeHtml(lname)} <em class="pdx-qcount">${qCount}q</em></span>
        </label>`;
      });
      html += `</div>`;
    }
  } else {
    html += `<div class="community-empty"><div class="ce-icon">🏥</div>Select a year, module and subject to see its lectures — or use a "＋ Whole …" button above to queue a bigger chunk at once.</div>`;
  }

  el.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════
   COMMUNITY TAB — reuses the same in-memory cache community-
   quizzes.js already keeps warm (_allSharedQuizzes).
══════════════════════════════════════════════════════════ */
async function _pdxRenderCommunityTab() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;
  if (!window._currentUser) {
    el.innerHTML = `<div class="community-empty">Please sign in to browse community quizzes.</div>`;
    return;
  }
  if (!_allSharedQuizzes.length) el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);"><div style="font-size:1.6rem;margin-bottom:8px;">⏳</div>Loading community quizzes…</div>`;
  const ok = await ensureSharedQuizzesLoaded(false);
  if (_pdxTab !== 'community') return;
  if (!ok) { el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--wrong-fg);">❌ Failed to load community quizzes.</div>`; return; }
  _pdxDrawCommunityList();
}
function pdxCommSearchInput(v) { _pdxCommSearch = v; _pdxDrawCommunityList(); }
function _pdxDrawCommunityList() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;
  const q = _pdxCommSearch.toLowerCase().trim();
  let pool = _allSharedQuizzes;
  if (q) pool = pool.filter(item => (item.title || '').toLowerCase().includes(q) || (item.authorName || '').toLowerCase().includes(q));

  let html = `<div class="comm-filter-bar">
      <div class="comm-search-wrap">
        <span class="comm-search-icon">🔍</span>
        <input class="comm-search-input" type="text" placeholder="Search community quizzes…" value="${escapeHtml(_pdxCommSearch)}" oninput="pdxCommSearchInput(this.value)" />
      </div>
      <div class="comm-results-count">${pool.length} quiz${pool.length !== 1 ? 'zes' : ''} shown</div>
    </div>`;

  if (!pool.length) {
    html += `<div class="community-empty"><div class="ce-icon">🌐</div>No quizzes match.</div>`;
  } else {
    pool.forEach(item => {
      const checked = _pdxSelCommunity.has(item.id);
      const catBadge = (item.year || item.subjectLabel)
        ? `<span class="comm-cat-badge">${[item.year, item.module, item.subjectLabel].filter(Boolean).map(escapeHtml).join(' › ')}</span>`
        : (item.category ? `<span class="comm-cat-badge">${escapeHtml(item.category)}</span>` : '');
      html += `<div class="community-quiz-item">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
          <input type="checkbox" style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
            ${checked ? 'checked' : ''} onchange="pdxToggleCommunity('${escapeHtml(item.id)}', this.checked)" />
          <div style="flex:1;min-width:0;">
            <div class="community-quiz-title">${escapeHtml(item.title)}</div>
            <div class="community-quiz-meta">${catBadge} ${item.questionCount} question${item.questionCount !== 1 ? 's' : ''} &nbsp;·&nbsp; 👤 ${escapeHtml(item.authorName)}</div>
          </div>
        </label>
      </div>`;
    });
  }
  el.innerHTML = html;
}
function pdxToggleCommunity(id, checked) {
  if (checked) _pdxSelCommunity.add(id); else _pdxSelCommunity.delete(id);
  _pdxRefreshChrome();
}

/* ══════════════════════════════════════════════════════════
   CUSTOM QUIZZES TAB
══════════════════════════════════════════════════════════ */
async function _pdxRenderCustomTab() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;
  let quizzes = loadCustomQuizzes().filter(q => (q.questions || []).length);
  const s = _pdxCustomSearch.toLowerCase().trim();
  if (s) quizzes = quizzes.filter(q => (q.title || '').toLowerCase().includes(s));
  const collections = loadQuizCollections();

  let html = `<div class="comm-filter-bar">
    <div class="comm-search-wrap">
      <span class="comm-search-icon">🔍</span>
      <input class="comm-search-input" type="text" placeholder="Search your custom quizzes…" value="${escapeHtml(_pdxCustomSearch)}" oninput="pdxCustomSearchInput(this.value)" />
    </div>
    <div class="comm-results-count">${quizzes.length} quiz${quizzes.length !== 1 ? 'zes' : ''} shown</div>
  </div>`;

  if (!quizzes.length) {
    html += `<div class="community-empty"><div class="ce-icon">📭</div>No custom quizzes to export yet.</div>`;
  } else {
    quizzes.forEach(q => {
      const checked = _pdxSelCustom.has(q.id);
      const chip = typeof _quizCollectionChipHTML === 'function' ? _quizCollectionChipHTML(q, collections) : '';
      html += `<div class="cq-quiz-item">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;flex:1;">
          <input type="checkbox" style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
            ${checked ? 'checked' : ''} onchange="pdxToggleCustom('${escapeHtml(q.id)}', this.checked)" />
          <div>
            <div class="cq-quiz-name">${escapeHtml(q.title)}</div>
            <div class="cq-quiz-meta">${(q.questions || []).length} question${(q.questions || []).length !== 1 ? 's' : ''}</div>
            ${chip ? `<div style="margin-top:4px;">${chip}</div>` : ''}
          </div>
        </label>
      </div>`;
    });
  }
  el.innerHTML = html;
}
function pdxCustomSearchInput(v) { _pdxCustomSearch = v; _pdxRenderCustomTab(); }
function pdxToggleCustom(id, checked) {
  if (checked) _pdxSelCustom.add(id); else _pdxSelCustom.delete(id);
  _pdxRefreshChrome();
}

/* ══════════════════════════════════════════════════════════
   LOOK & FEEL SETTINGS + LIVE (DECOY) PREVIEW
   The preview is a plain HTML/CSS mock-up — not the real PDF engine —
   so it updates instantly as sliders/swatches change. It uses placeholder
   sample text/an illustrative image block, never real question content.
══════════════════════════════════════════════════════════ */
function pdxSetTextSize(v)  { _pdxSettings.textSize = v; _pdxSyncSettingsUI(); pdxRenderPreview(); }
function pdxSetImageSize(v) { _pdxSettings.imageSize = v; _pdxSyncSettingsUI(); pdxRenderPreview(); }
function pdxSetTheme(v)     { _pdxSettings.theme = v; _pdxSyncSettingsUI(); pdxRenderPreview(); }
function _pdxSyncSettingsUI() {
  document.querySelectorAll('#pdxTextSizeGroup .pdx-seg-btn').forEach((b, i) => b.classList.toggle('active', ['small','medium','large'][i] === _pdxSettings.textSize));
  document.querySelectorAll('#pdxImageSizeGroup .pdx-seg-btn').forEach((b, i) => b.classList.toggle('active', ['small','medium','large'][i] === _pdxSettings.imageSize));
  document.querySelectorAll('#pdxThemeGroup .pdx-swatch').forEach((b, i) => b.classList.toggle('active', Object.keys(PDX_PALETTE)[i] === _pdxSettings.theme));
}
function pdxRenderPreview() {
  const el = document.getElementById('pdxPreview');
  if (!el) return;
  const theme = PDX_PALETTE[_pdxSettings.theme];
  const tSize = PDX_TEXT_SIZES[_pdxSettings.textSize];
  const imgPx = { small: 46, medium: 74, large: 104 }[_pdxSettings.imageSize];
  el.style.setProperty('--pdx-base', theme.base);
  el.style.setProperty('--pdx-dark', theme.dark);
  el.style.setProperty('--pdx-pale', theme.pale);
  el.innerHTML = `
    <div class="pdx-pv-header" style="background:linear-gradient(120deg, var(--pdx-dark), var(--pdx-base));">
      <span class="pdx-pv-badge"></span> ANU MSP Question Bank
    </div>
    <div class="pdx-pv-crumb" style="color:var(--pdx-base);">Year 1 › Cardiovascular Module › Anatomy</div>
    <div class="pdx-pv-q" style="font-size:${tSize.q}px;">7. Which chamber of the heart receives oxygenated blood from the lungs?</div>
    <div class="pdx-pv-img" style="width:${imgPx}px;height:${imgPx}px;">🖼️</div>
    <div class="pdx-pv-opts" style="font-size:${tSize.opt}px;">
      <div class="pdx-pv-opt"><b style="color:var(--pdx-base);">A</b> Right atrium</div>
      <div class="pdx-pv-opt"><b style="color:var(--pdx-base);">B</b> Left atrium</div>
      <div class="pdx-pv-opt"><b style="color:var(--pdx-base);">C</b> Right ventricle</div>
      <div class="pdx-pv-opt"><b style="color:var(--pdx-base);">D</b> Left ventricle</div>
    </div>
    <div class="pdx-pv-footer">Page 4 · Answers provided at the end</div>
  `;
}

/* ══════════════════════════════════════════════════════════
   GENERATION ENTRY POINT
══════════════════════════════════════════════════════════ */
function _pdxProgressHTML(message) {
  return `<div class="backup-progress-wrap">
    <div class="backup-progress-row"><span class="backup-progress-dot"></span> ${message}</div>
    <div class="backup-progress-track"><div class="backup-progress-fill"></div></div>
  </div>`;
}
function _pdxResultHTML(ok, message) {
  return `<div class="backup-result-bar ${ok ? 'ok' : 'fail'}"><span class="backup-result-icon">${ok ? '✅' : '❌'}</span><span class="backup-result-msg">${message}</span></div>`;
}

async function pdxGenerate() {
  const statusEl = document.getElementById('pdxGenStatus');
  if (!_pdxTotalSelected()) return;
  statusEl.innerHTML = _pdxProgressHTML('Gathering your selected content…');
  try {
    const dataset = await _pdxCollectDataset();
    statusEl.innerHTML = _pdxProgressHTML('Loading the PDF engine…');
    const { jsPDF } = await _pdxLoadJsPDF();

    statusEl.innerHTML = _pdxProgressHTML('Laying out your booklet…');
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const ctx = _pdxNewCtx(doc);

    // Outline is computed up front (from the dataset, not by drawing) so the
    // Contents page — which comes right after the cover — already knows the
    // full chapter structure before a single content page is drawn.
    ctx.outline = _pdxBuildOutline(dataset);

    await _pdxDrawCover(ctx, dataset);
    if (ctx.outline.length > 1) _pdxDrawContentsPage(ctx);

    const answerKey = [];
    let qNum = 1;
    let colorIdx = 0;
    const nextColor = () => { const keys = Object.keys(PDX_PALETTE); const start = keys.indexOf(_pdxSettings.theme); const k = keys[(start + colorIdx) % keys.length]; colorIdx++; return PDX_PALETTE[k]; };

    // ── Curriculum: Year (Part) → Module (Chapter) → Subject (Section) → Lecture (Sub-section)
    const curTree = dataset.curriculum;
    const years = Object.keys(curTree);
    for (const year of years) {
      const color = nextColor();
      _pdxDrawPartDivider(ctx, year, `Curriculum - ${Object.keys(curTree[year]).length} module${Object.keys(curTree[year]).length !== 1 ? 's' : ''}`, color);
      for (const mod of Object.keys(curTree[year])) {
        _pdxDrawBanner(ctx, mod, 1, color, [year]);
        for (const subjKey of Object.keys(curTree[year][mod])) {
          const subj = subjects[subjKey] || { label: subjKey, icon: '📘' };
          _pdxDrawBanner(ctx, subj.label || subjKey, 2, color, [year, mod]);
          for (const lecName of curTree[year][mod][subjKey]) {
            _pdxDrawBanner(ctx, lecName, 3, color, [year, mod, subj.label || subjKey]);
            const questions = (subjects[subjKey].lectures[lecName] || []);
            for (const q of questions) {
              qNum = await _pdxDrawQuestion(ctx, q, qNum, color, [year, mod, subj.label || subjKey, lecName], answerKey);
            }
          }
        }
      }
    }

    // ── Community quizzes: grouped by category label
    if (dataset.community.groups.length) {
      const color = nextColor();
      _pdxDrawPartDivider(ctx, 'Community Quizzes', `${dataset.community.total} quiz${dataset.community.total !== 1 ? 'zes' : ''} shared by fellow students`, color);
      for (const group of dataset.community.groups) {
        _pdxDrawBanner(ctx, group.label, 1, color, ['Community Quizzes']);
        for (const quiz of group.quizzes) {
          _pdxDrawBanner(ctx, `${quiz.title}${quiz.authorName ? ` (by ${quiz.authorName})` : ''}`, 2, color, ['Community Quizzes', group.label]);
          for (const q of quiz.questions) {
            qNum = await _pdxDrawQuestion(ctx, q, qNum, color, ['Community Quizzes', group.label, quiz.title], answerKey);
          }
        }
      }
    }

    // ── Custom quizzes: grouped by folder path
    if (dataset.custom.groups.length) {
      const color = nextColor();
      _pdxDrawPartDivider(ctx, 'My Custom Quizzes', `${dataset.custom.total} quiz${dataset.custom.total !== 1 ? 'zes' : ''} you created`, color);
      for (const group of dataset.custom.groups) {
        _pdxDrawBanner(ctx, group.label, 1, color, ['My Custom Quizzes']);
        for (const quiz of group.quizzes) {
          _pdxDrawBanner(ctx, quiz.title, 2, color, ['My Custom Quizzes', group.label]);
          for (const q of quiz.questions) {
            qNum = await _pdxDrawQuestion(ctx, q, qNum, color, ['My Custom Quizzes', group.label, quiz.title], answerKey);
          }
        }
      }
    }

    statusEl.innerHTML = _pdxProgressHTML('Writing the answer key…');
    _pdxDrawAnswerKey(ctx, answerKey);

    statusEl.innerHTML = _pdxProgressHTML('Adding the closing page…');
    await _pdxDrawClosingPage(ctx);

    statusEl.innerHTML = _pdxProgressHTML('Stamping headers &amp; page numbers…');
    _pdxFinishHeadersFooters(ctx);

    const filename = _pdxResolveFilename();
    doc.save(filename);
    statusEl.innerHTML = _pdxResultHTML(true, `Downloaded as <strong>${escapeHtml(filename)}</strong> — ${qNum - 1} question${qNum - 1 !== 1 ? 's' : ''} across ${doc.getNumberOfPages()} pages.`);
  } catch (e) {
    console.error('PDF export failed:', e);
    statusEl.innerHTML = _pdxResultHTML(false, `Export failed: ${escapeHtml(e.message || String(e))}`);
  }
}

function _pdxResolveFilename() {
  const input = document.getElementById('pdxFileName');
  const raw = input ? input.value.trim() : '';
  const defaultName = `anu-msp-study-pack-${new Date().toISOString().slice(0, 10)}`;
  let name = raw ? raw.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-') : defaultName;
  if (!name) name = defaultName;
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  return name;
}

/* ══════════════════════════════════════════════════════════
   DATASET COLLECTION — resolves the raw selections above into
   fully-loaded question data, grouped for chapter-style layout.
══════════════════════════════════════════════════════════ */
async function _pdxCollectDataset() {
  // Curriculum: subjectKey::lecture -> nested { year: { module: { subjectKey: [lectureNames] } } }
  const curriculumTree = {};
  for (const key of _pdxSelCurriculum) {
    const [subjKey, lecName] = key.split('::');
    outer:
    for (const year of Object.keys(curriculum)) {
      for (const mod of Object.keys(curriculum[year])) {
        if ((curriculum[year][mod] || []).includes(subjKey)) {
          curriculumTree[year] = curriculumTree[year] || {};
          curriculumTree[year][mod] = curriculumTree[year][mod] || {};
          curriculumTree[year][mod][subjKey] = curriculumTree[year][mod][subjKey] || [];
          if (!curriculumTree[year][mod][subjKey].includes(lecName)) curriculumTree[year][mod][subjKey].push(lecName);
          break outer;
        }
      }
    }
  }

  // Community: resolve each id from the already-warm cache, clone + heal images
  const community = { groups: [], total: 0 };
  if (_pdxSelCommunity.size) {
    const byLabel = new Map();
    for (const id of _pdxSelCommunity) {
      const item = (_allSharedQuizzes || []).find(q => q.id === id);
      if (!item) continue;
      const questions = JSON.parse(JSON.stringify(item.questions || []));
      await ensureInlineImages(questions);
      const label = item.year && item.module ? [item.year, item.module, item.subjectLabel].filter(Boolean).join(' › ') : (item.category || 'General');
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push({ title: item.title || 'Untitled quiz', authorName: item.authorName, questions });
      community.total++;
    }
    community.groups = [...byLabel.entries()].map(([label, quizzes]) => ({ label, quizzes }));
  }

  // Custom: resolve each id, group by top-level collection name (folder chain)
  const custom = { groups: [], total: 0 };
  if (_pdxSelCustom.size) {
    const allQuizzes = loadCustomQuizzes();
    const collections = loadQuizCollections();
    const byLabel = new Map();
    for (const id of _pdxSelCustom) {
      const quiz = allQuizzes.find(q => q.id === id);
      if (!quiz) continue;
      const questions = JSON.parse(JSON.stringify(quiz.questions || []));
      await ensureInlineImages(questions);
      let label = 'Uncategorized';
      if (quiz.collectionId && typeof _collectionPath === 'function') {
        const path = _collectionPath(collections, quiz.collectionId);
        if (path.length) label = path.map(c => c.name).join(' › ');
      }
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push({ title: quiz.title || 'Untitled quiz', questions });
      custom.total++;
    }
    custom.groups = [...byLabel.entries()].map(([label, quizzes]) => ({ label, quizzes }));
  }

  return { curriculum: curriculumTree, community, custom };
}

/* Builds the flat [{level, text}] outline used by the Contents page,
   purely from the already-resolved dataset — no drawing, so it can run
   before the cover page even exists. Mirrors the exact grouping the main
   drawing loop below uses, so the two never disagree. */
function _pdxBuildOutline(dataset) {
  const out = [];
  for (const year of Object.keys(dataset.curriculum)) {
    out.push({ level: 0, text: `📅 ${year}` });
    for (const mod of Object.keys(dataset.curriculum[year])) {
      out.push({ level: 1, text: `📦 ${mod}` });
      for (const subjKey of Object.keys(dataset.curriculum[year][mod])) {
        const subj = subjects[subjKey] || { label: subjKey, icon: '📘' };
        out.push({ level: 2, text: `${subj.icon || '📘'} ${subj.label || subjKey}` });
        dataset.curriculum[year][mod][subjKey].forEach(lecName => out.push({ level: 3, text: lecName }));
      }
    }
  }
  if (dataset.community.groups.length) {
    out.push({ level: 0, text: '🌐 Community Quizzes' });
    dataset.community.groups.forEach(group => {
      out.push({ level: 1, text: `📂 ${group.label}` });
      group.quizzes.forEach(quiz => out.push({ level: 2, text: quiz.title }));
    });
  }
  if (dataset.custom.groups.length) {
    out.push({ level: 0, text: '🤖 My Custom Quizzes' });
    dataset.custom.groups.forEach(group => {
      out.push({ level: 1, text: `📁 ${group.label}` });
      group.quizzes.forEach(quiz => out.push({ level: 2, text: quiz.title }));
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════
   PDF ENGINE — jsPDF lazy-load + shared assets
══════════════════════════════════════════════════════════ */
function _pdxLoadJsPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf);
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = () => resolve(window.jspdf);
    script.onerror = () => reject(new Error('Could not load the PDF engine (check your connection).'));
    document.head.appendChild(script);
  });
}

/* Same badge markup/colours as the favicon, header .brand-mark and the
   intro-screen sigil (index.html) — rasterized once to a PNG data URL so
   jsPDF can draw it, then cached for the rest of this export. */
const PDX_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0A3F52"/>
  <circle cx="36" cy="54" r="16" fill="none" stroke="#6FE3F0" stroke-width="11"/>
  <path d="M46 65 L58 78" fill="none" stroke="#6FE3F0" stroke-width="11" stroke-linecap="round"/>
  <path d="M66 30 L66 74" fill="none" stroke="#6FE3F0" stroke-width="11" stroke-linecap="round"/>
  <path d="M66 30 L78 30 A11 10 0 0 1 78 50 L66 50" fill="none" stroke="#6FE3F0" stroke-width="11"/>
  <path d="M66 50 L80 50 A12 12 0 0 1 80 74 L66 74" fill="none" stroke="#6FE3F0" stroke-width="11"/>
</svg>`;

function _pdxRasterizeSvg(svgText, px) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = px; canvas.height = px;
      const c = canvas.getContext('2d');
      c.drawImage(img, 0, 0, px, px);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('logo render failed'));
    img.src = `data:image/svg+xml;base64,${btoa(svgText)}`;
  });
}
async function _pdxGetLogoDataUrl() {
  if (!_pdxAssetCache.logo) _pdxAssetCache.logo = await _pdxRasterizeSvg(PDX_LOGO_SVG, 160);
  return _pdxAssetCache.logo;
}

/* Website QR code — bundled asset (assets/qr-code.png), converted to a
   data URL once and cached. Falls back gracefully (no QR page) if the
   asset can't be reached for any reason, rather than failing the export. */
async function _pdxGetQrDataUrl() {
  if (_pdxAssetCache.qr) return _pdxAssetCache.qr;
  try {
    const resp = await fetch('assets/qr-code.png');
    const blob = await resp.blob();
    _pdxAssetCache.qr = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) { console.warn('QR asset unavailable:', e); _pdxAssetCache.qr = null; }
  return _pdxAssetCache.qr;
}

/* Normalises ANY image source (data: URL or remote URL) into a PNG data
   URL + its natural pixel size, via an offscreen canvas — this sidesteps
   jsPDF's format-sniffing entirely (handles PNG/JPEG/WEBP/GIF uniformly)
   and gives us the aspect ratio needed to size it into the page. Best-
   effort: any failure (timeout, tainted canvas, bad URL) resolves null so
   the caller can simply skip that one image instead of failing the export. */
function _pdxImageInfo(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(null), 9000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1; canvas.height = img.naturalHeight || 1;
        const c = canvas.getContext('2d');
        c.drawImage(img, 0, 0);
        done({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      } catch (e) { done(null); }
    };
    img.onerror = () => { clearTimeout(timer); done(null); };
    img.src = src;
  });
}

/* ══════════════════════════════════════════════════════════
   RENDER CONTEXT — margins, cursor, colour, outline, page meta
══════════════════════════════════════════════════════════ */
function _pdxNewCtx(doc) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 46;
  return {
    doc, pageW, pageH, margin,
    contentW: pageW - margin * 2,
    top: margin + 30,     // leaves room for the running header band
    bottom: pageH - margin - 24, // leaves room for the running footer
    y: margin + 30,
    settings: _pdxSettings,
    textSizes: PDX_TEXT_SIZES[_pdxSettings.textSize],
    imageMax: PDX_IMAGE_SIZES[_pdxSettings.imageSize],
    outline: [],       // [{level, text}] for the Contents page
    pageMeta: {},       // pageNumber -> { breadcrumb, color } for the finishing pass
    contentStartPage: 2, // set once the cover is drawn
  };
}
function _pdxAddOutline(ctx, level, text) { ctx.outline.push({ level, text }); }

function _pdxNewPage(ctx, breadcrumb, color) {
  ctx.doc.addPage();
  const num = ctx.doc.getNumberOfPages();
  ctx.pageMeta[num] = { breadcrumb: breadcrumb || [], color: color || PDX_PALETTE[ctx.settings.theme] };
  ctx.y = ctx.top;
  return num;
}
function _pdxEnsureSpace(ctx, needed, breadcrumb, color) {
  if (ctx.y + needed > ctx.bottom) _pdxNewPage(ctx, breadcrumb, color);
}
function _pdxWrap(ctx, text, maxWidth, size, font, style) {
  ctx.doc.setFont(font, style);
  ctx.doc.setFontSize(size);
  return ctx.doc.splitTextToSize(_pdxSafeText(text), maxWidth);
}

/* ══════════════════════════════════════════════════════════
   COVER PAGE
══════════════════════════════════════════════════════════ */
async function _pdxDrawCover(ctx, dataset) {
  const { doc, pageW, pageH } = ctx;
  const theme = PDX_PALETTE[ctx.settings.theme];
  doc.setFillColor(theme.dark);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(theme.base);
  doc.rect(0, pageH * 0.62, pageW, pageH * 0.38, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.2);
  doc.line(0, pageH * 0.62, pageW, pageH * 0.62);

  try {
    const logo = await _pdxGetLogoDataUrl();
    doc.addImage(logo, 'PNG', pageW / 2 - 34, 96, 68, 68);
  } catch (e) { /* non-fatal — cover still works without the mark */ }

  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bold'); doc.setFontSize(15);
  doc.text('ANU MSP QUESTION BANK', pageW / 2, 196, { align: 'center' });
  doc.setFont('times', 'bold'); doc.setFontSize(27);
  doc.text('Study Pack', pageW / 2, 232, { align: 'center' });

  const items = [];
  const curYears = Object.keys(dataset.curriculum);
  if (curYears.length) items.push(`${curYears.length} curriculum year${curYears.length !== 1 ? 's' : ''}`);
  if (dataset.community.total) items.push(`${dataset.community.total} community quiz${dataset.community.total !== 1 ? 'zes' : ''}`);
  if (dataset.custom.total) items.push(`${dataset.custom.total} custom quiz${dataset.custom.total !== 1 ? 'zes' : ''}`);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5);
  items.forEach((line, i) => doc.text(line, pageW / 2, 270 + i * 18, { align: 'center' }));

  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`Generated ${_pdxFormatDate(new Date())}`, pageW / 2, pageH * 0.62 + 30, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text('Questions only inside - full answer key at the very end', pageW / 2, pageH * 0.62 + 52, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text('Free, community-built ANU MSP question bank', pageW / 2, pageH - 34, { align: 'center' });

  ctx.contentStartPage = 2;
}

/* ══════════════════════════════════════════════════════════
   CONTENTS PAGE — a plain hierarchical overview (no page
   numbers: kept simple and reliable rather than reserving a
   guessed number of pages upfront).
══════════════════════════════════════════════════════════ */
function _pdxDrawContentsPage(ctx) {
  const { doc } = ctx;
  const theme = PDX_PALETTE[ctx.settings.theme];
  _pdxNewPage(ctx, ['Contents'], theme);
  doc.setFont('times', 'bold'); doc.setFontSize(19);
  doc.setTextColor(theme.dark);
  doc.text("What's inside", ctx.margin, ctx.y);
  ctx.y += 10;
  doc.setDrawColor(theme.base); doc.setLineWidth(1.4);
  doc.line(ctx.margin, ctx.y, ctx.margin + 90, ctx.y);
  ctx.y += 26;

  ctx.outline.forEach(entry => {
    const indent = entry.level * 16;
    const size = entry.level === 0 ? 12.5 : entry.level === 1 ? 11 : 10;
    const style = entry.level <= 1 ? 'bold' : 'normal';
    _pdxEnsureSpace(ctx, size + 8, ['Contents'], theme);
    doc.setFont('helvetica', style); doc.setFontSize(size);
    doc.setTextColor(entry.level === 0 ? theme.dark : '#3A4653');
    const lines = doc.splitTextToSize(_pdxSafeText(entry.text), ctx.contentW - indent);
    doc.text(lines, ctx.margin + indent, ctx.y);
    ctx.y += lines.length * (size + 4) + (entry.level === 0 ? 4 : 1);
  });
}

/* ══════════════════════════════════════════════════════════
   PART DIVIDER — one full page per top-level group (a curriculum
   Year, "Community Quizzes", or "My Custom Quizzes").
══════════════════════════════════════════════════════════ */
function _pdxDrawPartDivider(ctx, title, subtitle, color) {
  const { doc, pageW, pageH } = ctx;
  _pdxNewPage(ctx, [title], color);
  doc.setFillColor(color.pale);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(color.dark);
  doc.rect(0, pageH / 2 - 70, pageW, 140, 'F');

  // A simple rule-and-title motif instead of an emoji icon — guaranteed to
  // render cleanly with the PDF's built-in fonts on every platform/viewer.
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(1);
  doc.line(pageW / 2 - 46, pageH / 2 - 34, pageW / 2 + 46, pageH / 2 - 34);
  doc.setFont('times', 'bold'); doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text(_pdxSafeText(title), pageW / 2, pageH / 2 + 14, { align: 'center' });
  doc.line(pageW / 2 - 46, pageH / 2 + 34, pageW / 2 + 46, pageH / 2 + 34);
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    doc.setTextColor(color.dark);
    doc.text(_pdxSafeText(subtitle), pageW / 2, pageH / 2 + 96, { align: 'center' });
  }
  ctx.y = ctx.bottom + 1; // force the next drawn element onto a fresh page
}

/* ══════════════════════════════════════════════════════════
   CHAPTER / SECTION / SUB-SECTION BANNERS (levels 1/2/3)
══════════════════════════════════════════════════════════ */
function _pdxDrawBanner(ctx, title, level, color, breadcrumb) {
  const { doc } = ctx;
  const heights = { 1: 40, 2: 30, 3: 22 };
  const sizes   = { 1: 14.5, 2: 12, 3: 10.5 };
  const h = heights[level];
  if (level === 1) _pdxNewPage(ctx, breadcrumb.concat(title), color); // chapters always start a fresh page
  else _pdxEnsureSpace(ctx, h + 14, breadcrumb.concat(title), color);

  const { doc: d, contentW, margin } = ctx;
  if (level === 1) {
    d.setFillColor(color.dark);
    d.rect(margin, ctx.y, contentW, h, 'F');
    d.setTextColor(255, 255, 255);
  } else if (level === 2) {
    d.setFillColor(color.base);
    d.roundedRect(margin, ctx.y, contentW, h, 5, 5, 'F');
    d.setTextColor(255, 255, 255);
  } else {
    d.setDrawColor(color.base); d.setLineWidth(2.4);
    d.line(margin, ctx.y + h - 2, margin + 26, ctx.y + h - 2);
    d.setTextColor(color.dark);
  }
  d.setFont(level === 1 ? 'times' : 'helvetica', 'bold');
  d.setFontSize(sizes[level]);
  const textY = ctx.y + h / 2 + sizes[level] / 3;
  const safeTitle = _pdxSafeText(title);
  const fitted = d.splitTextToSize(safeTitle, contentW - (level === 3 ? 30 : 28))[0] || safeTitle;
  d.text(fitted, margin + (level === 3 ? 0 : 14), level === 3 ? ctx.y + 12 : textY);
  ctx.y += h + (level === 3 ? 10 : 16);
  ctx.pageMeta[ctx.doc.getNumberOfPages()] = { breadcrumb: breadcrumb.concat(level === 3 ? [] : title), color };
}

/* ══════════════════════════════════════════════════════════
   QUESTION RENDERING — question text, optional image, A–D
   options. Never prints the answer; records it for the key.
══════════════════════════════════════════════════════════ */
async function _pdxDrawQuestion(ctx, q, num, color, breadcrumb, answerKey) {
  const { doc, margin, contentW, textSizes } = ctx;
  const qLines = _pdxWrap(ctx, `${num}. ${q.question || ''}`, contentW - 4, textSizes.q, 'helvetica', 'bold');
  const qHeight = qLines.length * (textSizes.q + 4);

  let imgInfo = null;
  if (q.image) imgInfo = await _pdxImageInfo(q.image);
  let imgH = 0, imgW = 0;
  if (imgInfo) {
    const ratio = imgInfo.width / imgInfo.height;
    imgH = Math.min(ctx.imageMax, imgInfo.height);
    imgW = imgH * ratio;
    if (imgW > contentW * 0.72) { imgW = contentW * 0.72; imgH = imgW / ratio; }
  }

  const options = q.options && typeof q.options === 'object' ? Object.entries(q.options) : [];
  const optLineSets = options.map(([k, v]) => ({ key: k, lines: _pdxWrap(ctx, v, contentW - 34, textSizes.opt, 'helvetica', 'normal') }));
  const optHeight = optLineSets.reduce((sum, o) => sum + o.lines.length * (textSizes.opt + 3.5) + 3, 0);

  const totalHeight = qHeight + (imgH ? imgH + 12 : 0) + optHeight + 20;
  _pdxEnsureSpace(ctx, Math.min(totalHeight, ctx.bottom - ctx.top - 10), breadcrumb, color);

  doc.setTextColor('#182430');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(textSizes.q);
  doc.text(qLines, margin, ctx.y);
  ctx.y += qHeight + 6;

  if (imgInfo) {
    _pdxEnsureSpace(ctx, imgH + 12, breadcrumb, color);
    const x = margin + (contentW - imgW) / 2;
    doc.setDrawColor(color.base); doc.setLineWidth(0.8);
    doc.roundedRect(x - 3, ctx.y - 3, imgW + 6, imgH + 6, 4, 4);
    doc.addImage(imgInfo.dataUrl, 'PNG', x, ctx.y, imgW, imgH);
    ctx.y += imgH + 14;
  }

  optLineSets.forEach(o => {
    const h = o.lines.length * (textSizes.opt + 3.5) + 3;
    _pdxEnsureSpace(ctx, h, breadcrumb, color);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(textSizes.opt);
    doc.setTextColor(color.dark);
    doc.text(_pdxSafeText(o.key), margin + 4, ctx.y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor('#2A3541');
    doc.text(o.lines, margin + 22, ctx.y);
    ctx.y += h;
  });
  ctx.y += 12;

  if (q.answer) answerKey.push({ breadcrumb, num, answer: q.answer, color });
  return num + 1;
}

/* ══════════════════════════════════════════════════════════
   ANSWER KEY — grouped by the same chapter path as the
   questions, colour-matched so cross-referencing is easy.
══════════════════════════════════════════════════════════ */
function _pdxDrawAnswerKey(ctx, entries) {
  if (!entries.length) return;
  const { doc } = ctx;
  const theme = PDX_PALETTE[ctx.settings.theme];
  _pdxNewPage(ctx, ['Answer Key'], theme);
  doc.setFont('times', 'bold'); doc.setFontSize(20);
  doc.setTextColor(theme.dark);
  doc.text('Answer Key', ctx.margin, ctx.y);
  ctx.y += 28;

  const groups = new Map();
  entries.forEach(e => {
    const label = e.breadcrumb.join(' > ');
    if (!groups.has(label)) groups.set(label, { color: e.color, items: [] });
    groups.get(label).items.push(e);
  });

  for (const [label, group] of groups) {
    const headerH = 22;
    _pdxEnsureSpace(ctx, headerH + 16, ['Answer Key'], theme);
    doc.setFillColor(group.color.pale);
    doc.rect(ctx.margin, ctx.y, ctx.contentW, headerH, 'F');
    doc.setDrawColor(group.color.base); doc.setLineWidth(1.4);
    doc.line(ctx.margin, ctx.y, ctx.margin, ctx.y + headerH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.setTextColor(group.color.dark);
    const fittedLabel = doc.splitTextToSize(_pdxSafeText(label), ctx.contentW - 16)[0] || '';
    doc.text(fittedLabel, ctx.margin + 8, ctx.y + 15);
    ctx.y += headerH + 8;

    const perRow = 8;
    const cellW = ctx.contentW / perRow;
    let col = 0;
    doc.setFontSize(9.5);
    group.items.forEach(item => {
      if (col === 0) _pdxEnsureSpace(ctx, 18, ['Answer Key'], theme);
      const x = ctx.margin + col * cellW;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(group.color.base);
      doc.text(`Q${item.num}`, x, ctx.y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor('#2A3541');
      doc.text(_pdxSafeText(item.answer), x + cellW - 14, ctx.y);
      col++;
      if (col >= perRow) { col = 0; ctx.y += 17; }
    });
    if (col !== 0) ctx.y += 17;
    ctx.y += 12;
  }
}

/* ══════════════════════════════════════════════════════════
   CLOSING PAGE — logo + QR code linking back to the site.
══════════════════════════════════════════════════════════ */
async function _pdxDrawClosingPage(ctx) {
  const { doc, pageW, pageH } = ctx;
  const theme = PDX_PALETTE[ctx.settings.theme];
  doc.addPage();
  const pageNum = doc.getNumberOfPages();
  ctx.closingPage = pageNum; // excluded from the running header/footer pass
  doc.setFillColor(theme.dark);
  doc.rect(0, 0, pageW, pageH, 'F');

  try {
    const logo = await _pdxGetLogoDataUrl();
    doc.addImage(logo, 'PNG', pageW / 2 - 26, 70, 52, 52);
  } catch (e) { /* non-fatal */ }

  doc.setFont('times', 'bold'); doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text('Thanks for studying with us!', pageW / 2, 150, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  doc.text('Scan the code below to open the live question bank,', pageW / 2, 174, { align: 'center' });
  doc.text('sync your progress, and get fresh questions any time.', pageW / 2, 190, { align: 'center' });

  const qr = await _pdxGetQrDataUrl();
  if (qr) {
    const size = 176;
    const x = pageW / 2 - size / 2, y = 224;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x - 14, y - 14, size + 28, size + 28, 10, 10, 'F');
    doc.addImage(qr, 'PNG', x, y, size, size);
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.setTextColor(theme.light);
  doc.text('ANU MSP Question Bank', pageW / 2, pageH - 56, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('Free and community-built - made with care by Mahmoud Talat', pageW / 2, pageH - 40, { align: 'center' });
}

/* ══════════════════════════════════════════════════════════
   FINISHING PASS — once every page exists, stamp a slim running
   header (logo mark + site name + current chapter breadcrumb)
   and footer (page number) onto every content page. The cover
   (page 1) and the closing QR page are intentionally skipped so
   they can keep their own full-bleed designs.
══════════════════════════════════════════════════════════ */
function _pdxFinishHeadersFooters(ctx) {
  const { doc, pageW, pageH, margin } = ctx;
  const total = doc.getNumberOfPages();
  for (let p = 2; p < total; p++) {
    if (p === ctx.closingPage) continue;
    doc.setPage(p);
    const meta = ctx.pageMeta[p] || { breadcrumb: [], color: PDX_PALETTE[ctx.settings.theme] };
    const color = meta.color || PDX_PALETTE[ctx.settings.theme];

    // Header band
    doc.setDrawColor(color.base); doc.setLineWidth(0.9);
    doc.line(margin, margin + 16, pageW - margin, margin + 16);
    if (_pdxAssetCache.logo) {
      try { doc.addImage(_pdxAssetCache.logo, 'PNG', margin, margin - 9, 15, 15); } catch (e) {}
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.setTextColor(color.dark);
    doc.text('ANU MSP Question Bank', margin + (_pdxAssetCache.logo ? 20 : 0), margin);
    const crumb = _pdxSafeText((meta.breadcrumb || []).filter(Boolean).join(' > '));
    if (crumb) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.setTextColor('#6B7A88');
      const trimmed = doc.splitTextToSize(crumb, pageW - margin * 2 - 150)[0] || '';
      doc.text(trimmed, pageW - margin, margin, { align: 'right' });
    }

    // Footer
    doc.setDrawColor('#D3E0EA'); doc.setLineWidth(0.6);
    doc.line(margin, pageH - margin - 12, pageW - margin, pageH - margin - 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor('#8496A6');
    doc.text('Questions only - full answer key at the end', margin, pageH - margin);
    doc.text(`Page ${p} of ${total}`, pageW - margin, pageH - margin, { align: 'right' });
  }
}
