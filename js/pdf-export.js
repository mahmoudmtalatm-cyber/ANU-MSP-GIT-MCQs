/* =============================================================================
   pdf-export.js

   Drop #100 — "Export to PDF" inside the <svg class="sicon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Backup & Transfer modal.

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
  teal:   { name: '🟦 Teal (default)', base: '#0E6E82', dark: '#0A3F52', light: '#29C2D9', pale: '#E4F3F6' },
  violet: { name: '🟪 Violet',         base: '#6B4FA0', dark: '#4E3878', light: '#7E57C2', pale: '#EFEAF8' },
  gold:   { name: '🟧 Gold',           base: '#C98D1F', dark: '#8A5E12', light: '#E7B65C', pale: '#FBF1DE' },
  forest: { name: '🟩 Forest',         base: '#2E7A4F', dark: '#1F5C3B', light: '#4C9A6B', pale: '#E5F3EC' },
  berry:  { name: '🟥 Berry',          base: '#B23A3A', dark: '#8F2A2A', light: '#D97A7A', pale: '#F8DADA' },
};
const PDX_TEXT_SIZES = { small: { q: 10.5, opt: 9.5, label: 8.5 }, medium: { q: 12, opt: 10.5, label: 9.5 }, large: { q: 13.5, opt: 12, label: 10.5 } };
const PDX_IMAGE_SIZES = { small: 90, medium: 160, large: 230 }; // max image height, in pt

/* ── Selection & UI state ── */
let _pdxTab = 'curriculum'; // 'curriculum' | 'community' | 'custom'
let _pdxSelCurriculum = new Set(); // "subjectKey::lectureName"
let _pdxSelCommunity = new Set(); // shared quiz ids
let _pdxSelCustom = new Set(); // custom quiz ids
let _pdxCurrYear = '';
let _pdxCurrModule = '';
let _pdxCurrSubject = '';
let _pdxCommSearch = '';
let _pdxCommScope = 'browse'; // 'browse' | 'mine' — mirrors communityTab on the real screen
let _pdxCommYearFilter = '';
let _pdxCommModuleFilter = '';
let _pdxCommSubjectFilter = '';
let _pdxCommSort = 'newest';
let _pdxSettings = { textSize: 'medium', imageSize: 'medium', theme: 'teal' };
let _pdxAssetCache = { logo: null, qr: null };

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
          <button class="community-tab-btn ${_pdxTab === 'curriculum' ? 'active' : ''}" data-tab="curriculum" onclick="pdxSetTab('curriculum')">${SOURCE_TAB_ICONS.curriculum.full} ${_pdxSelCurriculum.size ? `(${_pdxSelCurriculum.size})` : ''}</button>
          <button class="community-tab-btn ${_pdxTab === 'community' ? 'active' : ''}" data-tab="community" onclick="pdxSetTab('community')">${SOURCE_TAB_ICONS.community.full} ${_pdxSelCommunity.size ? `(${_pdxSelCommunity.size})` : ''}</button>
          <button class="community-tab-btn ${_pdxTab === 'custom' ? 'active' : ''}" data-tab="custom" onclick="pdxSetTab('custom')">${SOURCE_TAB_ICONS.custom.full} ${_pdxSelCustom.size ? `(${_pdxSelCustom.size})` : ''}</button>
        </div>
        <div id="pdxTabContent" class="pdx-tab-content"></div>

        <div class="pdx-selection-bar">
          <span id="pdxSelectionCount">${_pdxTotalSelected()} item${_pdxTotalSelected() === 1 ? '' : 's'} selected</span>
          <button class="pdx-clear-btn" onclick="pdxClearAll()"><svg class="sicon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Clear All</button>
        </div>
      </div>

      <div class="pdx-settings-col">
        <div class="pdx-settings-card">
          <div class="pdx-settings-title"><svg class="sicon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3c1.9 0 3.5-1.6 3.5-3.5C21 6.9 17 2 12 2z"/><circle cx="6.5" cy="11.5" r="1.5"/><circle cx="9.5" cy="7.5" r="1.5"/><circle cx="14.5" cy="7.5" r="1.5"/><circle cx="17.5" cy="11.5" r="1.5"/></svg> Look &amp; Feel</div>

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
          <div class="pdx-settings-title"><svg class="sicon" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Live Preview <span class="pdx-preview-tag">sample page — not real content</span></div>
          <div id="pdxPreview" class="pdx-preview-page"></div>
        </div>
      </div>
    </div>

    <div class="pdx-footer">
      <div id="pdxGenStatus" class="backup-status-area"></div>
      <div class="pdx-footer-actions">
        <button class="cq-btn cq-btn-secondary" onclick="closePdfExport()">✖ Close</button>
        <button class="cq-btn" id="pdxGenerateBtn" onclick="pdxGenerate()" ${_pdxTotalSelected() ? '' : 'disabled'}><svg class="sicon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Generate PDF</button>
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
  _pdxSyncTabButtons();
}
/* Keeps the tab bar's active highlight AND its "(N)" counts in sync with
   state, independent of whichever tab's content last got re-rendered —
   called both on selection changes and on every tab switch, since
   switching tabs never re-renders the tab bar markup itself. */
function _pdxSyncTabButtons() {
  const counts = { curriculum: _pdxSelCurriculum.size, community: _pdxSelCommunity.size, custom: _pdxSelCustom.size };
  // NOTE: SOURCE_TAB_ICONS values are trusted, hardcoded <svg> markup
  // (shared with the other source-tab pickers — see dom-utils.js), not
  // plain text, so this MUST use innerHTML. Assigning markup like this to
  // .textContent doesn't render it — it prints the raw "<svg ...>" tag
  // as literal text, which is the bug this comment exists to prevent
  // reintroducing. Nothing user-controlled is interpolated here.
  document.querySelectorAll('.pdx-source-tabs .community-tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    if (!tab) return;
    btn.classList.toggle('active', tab === _pdxTab);
    btn.innerHTML = `${SOURCE_TAB_ICONS[tab].full} ${counts[tab] ? `(${counts[tab]})` : ''}`.trim();
  });
}
function pdxClearAll() {
  _pdxSelCurriculum = new Set();
  _pdxSelCommunity = new Set();
  _pdxSelCustom = new Set();
  pdxRenderTabContent();
  _pdxRefreshChrome();
}

function pdxSetTab(tab) {
  _pdxTab = tab;
  _pdxSyncTabButtons();
  pdxRenderTabContent();
}
function pdxRenderTabContent() {
  if (_pdxTab === 'curriculum') _pdxRenderCurriculumTab();
  else if (_pdxTab === 'community') _pdxRenderCommunityTab();
  else _pdxRenderCustomTab();
}

/* ══════════════════════════════════════════════════════════
   CURRICULUM TAB — Year → Module → Subject drilldown, same
   dropdown pattern as the Merge picker (community-quizzes.js),
   plus a "＋ Whole …" shortcut at every level so a whole year,
   module, or subject can be queued in one click instead of
   checking every lecture by hand.
══════════════════════════════════════════════════════════ */
function pdxOnYearChange(v) { _pdxCurrYear = v; _pdxCurrModule = ''; _pdxCurrSubject = ''; _pdxRenderCurriculumTab(); }
function pdxOnModuleChange(v) { _pdxCurrModule = v; _pdxCurrSubject = ''; _pdxRenderCurriculumTab(); }
function pdxOnSubjectChange(v) { _pdxCurrSubject = v; _pdxRenderCurriculumTab(); }

function _pdxAllLecturesUnder(year, mod, subjectKey) {
  const out = [];
  const years = year ? [year] : Object.keys(curriculum);
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
function pdxToggleWholeYear(year, checked) {
  _pdxAllLecturesUnder(year).forEach(k => checked ? _pdxSelCurriculum.add(k) : _pdxSelCurriculum.delete(k));
  _pdxRenderCurriculumTab(); _pdxRefreshChrome();
}
function pdxToggleWholeModule(year, mod, checked) {
  _pdxAllLecturesUnder(year, mod).forEach(k => checked ? _pdxSelCurriculum.add(k) : _pdxSelCurriculum.delete(k));
  _pdxRenderCurriculumTab(); _pdxRefreshChrome();
}
function pdxToggleWholeSubject(year, mod, subjKey, checked) {
  _pdxAllLecturesUnder(year, mod, subjKey).forEach(k => checked ? _pdxSelCurriculum.add(k) : _pdxSelCurriculum.delete(k));
  _pdxRenderCurriculumTab(); _pdxRefreshChrome();
}
function pdxToggleLecture(key, checked) {
  if (checked) _pdxSelCurriculum.add(key); else _pdxSelCurriculum.delete(key);
  _pdxRefreshChrome();
  const badge = document.getElementById('pdxSubjectSelectedBadge');
  if (badge) badge.textContent = _pdxAllLecturesUnder(_pdxCurrYear, _pdxCurrModule, _pdxCurrSubject).filter(k => _pdxSelCurriculum.has(k)).length;
}

/* Same breadcrumb pattern as the admin " Publish Quizzes" destination
   picker (js/admin-panel.js → adminAssignBreadcrumbHtml). */
function _pdxCurrBreadcrumbHtml() {
  let html = `<div class="curr-breadcrumb">`;
  html += `<span class="curr-crumb ${!_pdxCurrYear ? 'active' : ''}" onclick="pdxOnYearChange('')"> Years</span>`;
  if (_pdxCurrYear) html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${!_pdxCurrModule ? 'active' : ''}" onclick="pdxOnModuleChange('')">${escapeHtml(_pdxCurrYear)}</span>`;
  if (_pdxCurrModule) html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb ${!_pdxCurrSubject ? 'active' : ''}" onclick="pdxOnSubjectChange('')">${escapeHtml(_pdxCurrModule)}</span>`;
  if (_pdxCurrSubject) html += `<span class="curr-crumb-sep">›</span><span class="curr-crumb active">${escapeHtml((subjects[_pdxCurrSubject] && subjects[_pdxCurrSubject].label) || _pdxCurrSubject)}</span>`;
  html += `</div>`;
  return html;
}

/* Reuses the exact same card/breadcrumb drilldown as the admin " Publish
   Quizzes" destination picker (adminPublishTargetPickerHtml in
   js/admin-panel.js) — same .curr-section/.curr-item-row/.curr-breadcrumb
   classes — extended one level further to Lecture, and with a "select
   this whole thing" checkbox on every row instead of a single-destination
   pick, so a whole year/module/subject can be queued in one click. */
function _pdxRenderCurriculumTab() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;

  let html = `<div class="curr-section pdx-curr-section">`;
  html += _pdxCurrBreadcrumbHtml();

  if (_pdxCurrSubject) html += `<button class="curr-back-btn" onclick="pdxOnSubjectChange('')">← Back to Subjects</button>`;
  else if (_pdxCurrModule) html += `<button class="curr-back-btn" onclick="pdxOnModuleChange('')">← Back to Modules</button>`;
  else if (_pdxCurrYear) html += `<button class="curr-back-btn" onclick="pdxOnYearChange('')">← Back to Years</button>`;

  html += `<div style="margin-top:9px;display:flex;flex-direction:column;gap:6px;">`;

  if (!_pdxCurrYear) {
    const years = Object.keys(curriculum);
    if (!years.length) {
      html += `<div class="community-empty"><div class="ce-icon"></div>No curriculum published yet.</div>`;
    } else {
      years.forEach(y => {
        const all = _pdxAllLecturesUnder(y);
        const sel = all.filter(k => _pdxSelCurriculum.has(k)).length;
        html += `<div class="curr-item-row">
          <input type="checkbox" class="pdx-row-check" ${all.length && sel === all.length ? 'checked' : ''}
            onchange="pdxToggleWholeYear('${escapeHtml(y)}', this.checked)" title="Select this whole year" />
          <div class="pdx-curr-click" onclick="pdxOnYearChange('${escapeHtml(y)}')">
            <div>
              <div class="curr-item-name"> ${escapeHtml(y)}</div>
              <div class="curr-item-sub">${Object.keys(curriculum[y] || {}).length} module(s)${sel ? ` · ${sel}/${all.length} lecture(s) selected` : ''}</div>
            </div>
            <span class="curr-item-arrow">▶</span>
          </div>
        </div>`;
      });
    }
  } else if (!_pdxCurrModule) {
    const mods = Object.keys(curriculum[_pdxCurrYear] || {});
    if (!mods.length) {
      html += `<div class="community-empty"><div class="ce-icon"></div>No modules in ${escapeHtml(_pdxCurrYear)} yet.</div>`;
    } else {
      mods.forEach(m => {
        const all = _pdxAllLecturesUnder(_pdxCurrYear, m);
        const sel = all.filter(k => _pdxSelCurriculum.has(k)).length;
        const subCount = (curriculum[_pdxCurrYear][m] || []).filter(k => subjects[k]).length;
        html += `<div class="curr-item-row">
          <input type="checkbox" class="pdx-row-check" ${all.length && sel === all.length ? 'checked' : ''}
            onchange="pdxToggleWholeModule('${escapeHtml(_pdxCurrYear)}', '${escapeHtml(m)}', this.checked)" title="Select this whole module" />
          <div class="pdx-curr-click" onclick="pdxOnModuleChange('${escapeHtml(m)}')">
            <div>
              <div class="curr-item-name">${escapeHtml(_moduleIcon(_pdxCurrYear, m))} ${escapeHtml(m)}</div>
              <div class="curr-item-sub">${subCount} subject(s)${sel ? ` · ${sel}/${all.length} lecture(s) selected` : ''}</div>
            </div>
            <span class="curr-item-arrow">▶</span>
          </div>
        </div>`;
      });
    }
  } else if (!_pdxCurrSubject) {
    const subs = (curriculum[_pdxCurrYear][_pdxCurrModule] || []).filter(k => subjects[k]);
    if (!subs.length) {
      html += `<div class="community-empty"><div class="ce-icon"></div>No subjects in ${escapeHtml(_pdxCurrModule)} yet.</div>`;
    } else {
      subs.forEach(s => {
        const all = _pdxAllLecturesUnder(_pdxCurrYear, _pdxCurrModule, s);
        const sel = all.filter(k => _pdxSelCurriculum.has(k)).length;
        html += `<div class="curr-item-row">
          <input type="checkbox" class="pdx-row-check" ${all.length && sel === all.length ? 'checked' : ''}
            onchange="pdxToggleWholeSubject('${escapeHtml(_pdxCurrYear)}', '${escapeHtml(_pdxCurrModule)}', '${escapeHtml(s)}', this.checked)" title="Select this whole subject" />
          <div class="pdx-curr-click" onclick="pdxOnSubjectChange('${escapeHtml(s)}')">
            <div>
              <div class="curr-item-name">${escapeHtml(subjects[s].icon || '')} ${escapeHtml(subjects[s].label || s)}</div>
              <div class="curr-item-sub">${all.length} lecture(s)${sel ? ` · ${sel} selected` : ''}</div>
            </div>
            <span class="curr-item-arrow">▶</span>
          </div>
        </div>`;
      });
    }
  } else {
    const lectures = Object.keys((subjects[_pdxCurrSubject] || {}).lectures || {});
    if (!lectures.length) {
      html += `<div class="community-empty"><div class="ce-icon"><svg class="hicon" style="width:40px;height:40px;" viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>No lectures in this subject yet.</div>`;
    } else {
      const selectedHere = lectures.filter(l => _pdxSelCurriculum.has(`${_pdxCurrSubject}::${l}`)).length;
      html += `<div class="pdx-lecture-list-header">Lectures <span class="backup-quiz-count" id="pdxSubjectSelectedBadge">${selectedHere}</span></div>
      <div style="display:flex;gap:8px;margin:6px 0 8px;">
        <button type="button" style="flex:1;padding:6px;border-radius:6px;border:1.5px solid var(--accent);background:var(--surface-2-hover);color:var(--accent);font-weight:700;cursor:pointer;font-size:.8rem;" onclick="pdxToggleWholeSubject('${escapeHtml(_pdxCurrYear)}', '${escapeHtml(_pdxCurrModule)}', '${escapeHtml(_pdxCurrSubject)}', true)">☑ Select All</button>
        <button type="button" style="flex:1;padding:6px;border-radius:6px;border:1.5px solid var(--border-soft);background:var(--surface-2);color:var(--text-muted);font-weight:700;cursor:pointer;font-size:.8rem;" onclick="pdxToggleWholeSubject('${escapeHtml(_pdxCurrYear)}', '${escapeHtml(_pdxCurrModule)}', '${escapeHtml(_pdxCurrSubject)}', false)">☐ Clear All</button>
      </div>
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
  }

  html += `</div></div>`;
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
  if (!_allSharedQuizzes.length) el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);"><div style="margin-bottom:8px;display:flex;justify-content:center;color:var(--text-muted);"><svg style="width:28px;height:28px;" class="hicon spin" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg></div>Loading community quizzes…</div>`;
  // The exact same loader the real " Community Quizzes" screen calls
  // (js/sharing.js → renderCommunityQuizzes → js/community-quizzes.js →
  // ensureSharedQuizzesLoaded) — same cache, same 60s throttle window, so
  // opening this tab counts as "having opened Community Quizzes" for
  // caching purposes; it never triggers a second, separate version check.
  const ok = await ensureSharedQuizzesLoaded(false);
  if (_pdxTab !== 'community') return;
  if (!ok) { el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--wrong-fg);"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Failed to load community quizzes.</div>`; return; }
  _pdxDrawCommunityList();
}

/* Same filter bar (search + cascading Year/Module/Subject + sort) and the
   same Browse All/My Shared split as the real Community Quizzes screen —
   built on the shared _communityComputeView() (js/sharing.js) so both
   screens filter/sort identically. Only the per-item action differs: a
   select-for-export checkbox here instead of Start/Save/Unshare there. */
function _pdxCommBuildListHtml(pool) {
  if (!pool.length) {
    return `<div class="community-empty"><div class="ce-icon"><svg class="hicon" style="width:40px;height:40px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg></div>No quizzes match.</div>`;
  }
  let html = '';
  pool.forEach(item => {
    const checked = _pdxSelCommunity.has(item.id);
    const qCount = Number.isFinite(item.questionCount) ? item.questionCount : (Array.isArray(item.questions) ? item.questions.length : 0);
    const catBadge = (item.year || item.subjectLabel)
      ? `<span class="comm-cat-badge">${[item.year, item.module, item.subjectLabel].filter(Boolean).map(escapeHtml).join(' › ')}</span>`
      : (item.category ? `<span class="comm-cat-badge">${escapeHtml(item.category)}</span>` : '');
    const tagsHtml = (item.tags && item.tags.length)
      ? `<div class="comm-tags-row">${item.tags.map(t => `<span class="comm-tag" onclick="pdxCommSetSearch('${escapeHtml(t)}')" title="Filter by tag">#${escapeHtml(t)}</span>`).join('')}</div>` : '';
    html += `<div class="community-quiz-item">
      <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
        <input type="checkbox" style="margin-top:3px;width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;"
          ${checked ? 'checked' : ''} onchange="pdxToggleCommunity('${escapeHtml(item.id)}', this.checked)" />
        <div style="flex:1;min-width:0;">
          <div class="community-quiz-title">${escapeHtml(item.title)}</div>
          <div class="community-quiz-meta">${catBadge} ${qCount} question${qCount !== 1 ? 's' : ''} &nbsp;·&nbsp; ${escapeHtml(item.authorName)} &nbsp;·&nbsp; ${new Date(item.sharedAt).toLocaleDateString()}</div>
          ${tagsHtml}
        </div>
      </label>
    </div>`;
  });
  return html;
}

// Light path: recomputes the pool and rewrites only the results list +
// count. Used for every search keystroke — the filter bar (including the
// search <input> itself) is left completely alone.
function _pdxDrawCommunityResultsOnly() {
  const { pool } = _communityComputeView({
    scope: _pdxCommScope, search: _pdxCommSearch,
    yearFilter: _pdxCommYearFilter, moduleFilter: _pdxCommModuleFilter, subjectFilter: _pdxCommSubjectFilter,
    sort: _pdxCommSort,
  });
  _commRenderResults({
    idPrefix: 'pdxComm',
    listContainerId: 'pdxCommQuizList',
    resultCount: pool.length,
    listHtml: _pdxCommBuildListHtml(pool),
  });
}

function _pdxDrawCommunityList() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;
  const { pool, shared, myShared, allYears, allModules, allSubjects } = _communityComputeView({
    scope: _pdxCommScope, search: _pdxCommSearch,
    yearFilter: _pdxCommYearFilter, moduleFilter: _pdxCommModuleFilter, subjectFilter: _pdxCommSubjectFilter,
    sort: _pdxCommSort,
  });

  // Full chrome rebuild — tabs + filter bar + a stable list container.
  // Only runs on structural changes (scope/dropdown changes), never on a
  // search keystroke (see pdxCommSearchInput above), so the search
  // <input> stays alive and focused while someone types into it.
  el.innerHTML = `
    <div class="community-section-tabs">
      <button class="community-tab-btn ${_pdxCommScope === 'browse' ? 'active' : ''}" onclick="pdxCommSetScope('browse')"><svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg> Browse All (${shared.length})</button>
      <button class="community-tab-btn ${_pdxCommScope === 'mine' ? 'active' : ''}" onclick="pdxCommSetScope('mine')"><svg class="sicon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> My Shared (${myShared.length})</button>
    </div>
    ${_buildCommFilterBarHTML({
      idPrefix: 'pdxComm',
      searchVal: _pdxCommSearch,
      searchOninput: 'pdxCommSearchInput(this.value)',
      clearOnclick: "pdxCommSetSearch('')",
      yearVal: _pdxCommYearFilter,
      yearOnchange: 'pdxCommSetYearFilter(this.value)',
      allYears,
      moduleVal: _pdxCommModuleFilter,
      moduleOnchange: 'pdxCommSetModuleFilter(this.value)',
      moduleDisabled: !_pdxCommYearFilter,
      allModules,
      subjectVal: _pdxCommSubjectFilter,
      subjectOnchange: 'pdxCommSetSubjectFilter(this.value)',
      subjectDisabled: !_pdxCommModuleFilter,
      allSubjects,
      sortVal: _pdxCommSort,
      sortOnchange: 'pdxCommSetSort(this.value)',
      resultCount: pool.length
    })}
    <div id="pdxCommQuizList">${_pdxCommBuildListHtml(pool)}</div>`;
}
function pdxCommSetScope(scope) {
  _pdxCommScope = scope; _pdxCommSearch = ''; _pdxCommYearFilter = ''; _pdxCommModuleFilter = ''; _pdxCommSubjectFilter = '';
  _pdxDrawCommunityList();
}
// Live typing — only the results list + count get touched (see
// _pdxDrawCommunityResultsOnly below and the matching comment on
// communityOnSearchInput in js/sharing.js). The search <input> is left
// alone, so it never loses focus mid-keystroke.
function pdxCommSearchInput(v) {
  _pdxCommSearch = v;
  _pdxDrawCommunityResultsOnly();
}

// Programmatic search changes (clear button, tag click) — also syncs the
// input's own value, since no keystroke is doing that for us here.
function pdxCommSetSearch(v) {
  _pdxCommSearch = v;
  const input = document.getElementById('pdxCommSearchInput');
  if (input) input.value = v;
  _pdxDrawCommunityResultsOnly();
}
function pdxCommSetYearFilter(v) { _pdxCommYearFilter = v; _pdxCommModuleFilter = ''; _pdxCommSubjectFilter = ''; _pdxDrawCommunityList(); }
function pdxCommSetModuleFilter(v) { _pdxCommModuleFilter = v; _pdxCommSubjectFilter = ''; _pdxDrawCommunityList(); }
function pdxCommSetSubjectFilter(v) { _pdxCommSubjectFilter = v; _pdxDrawCommunityList(); }
function pdxCommSetSort(v) { _pdxCommSort = v; _pdxDrawCommunityList(); }
function pdxToggleCommunity(id, checked) {
  if (checked) _pdxSelCommunity.add(id); else _pdxSelCommunity.delete(id);
  _pdxRefreshChrome();
}

/* ══════════════════════════════════════════════════════════
   CUSTOM QUIZZES TAB — reuses the exact same folder-tree
   sidebar/breadcrumb/filtered-list as the student-facing "
   Custom Quizzes" modal and the admin Publish picker
   (js/quiz-collections.js), just with a select-for-export card
   swapped in for the Start/Edit/Share/Delete/Move actions —
   only what's actually needed here. Registers itself as the
   'pdfExport' host so folder clicks/drags/renames re-render this
   tab instead of one of the other two screens; see
   cqCollectionsHost in js/quiz-collections.js.
══════════════════════════════════════════════════════════ */
async function _pdxRenderCustomTab() {
  const el = document.getElementById('pdxTabContent');
  if (!el) return;
  cqCollectionsHost = 'pdfExport';

  const quizzes = loadCustomQuizzes().filter(q => (q.questions || []).length);
  const collections = loadQuizCollections();

  if (!quizzes.length) {
    el.innerHTML = `<div class="community-empty"><div class="ce-icon"></div>No custom quizzes to export yet.</div>`;
    return;
  }

  // Preserve the folder sidebar's scroll position across re-renders —
  // same reasoning/pattern as renderCustomQuizModal() in firebase-storage.js.
  const prevSidebar = el.querySelector('.cq-coll-sidebar');
  const prevScrollTop = prevSidebar ? prevSidebar.scrollTop : null;

  const visibleQuizzes = _filterQuizzesByActiveCollection(quizzes, collections);
  const itemsHtml = visibleQuizzes.length ? visibleQuizzes.map(q => {
    const sel = _pdxSelCustom.has(q.id);
    const moveOpen = cqCollectionMoveMenuFor === q.id;
    const chip = _quizCollectionChipHTML(q, collections);
    return `
      <div class="admin-quiz-item ${sel ? 'selected' : ''}" draggable="true"
           ondragstart="cqQuizDragStart(event,'${q.id}')" ondragend="cqQuizDragEnd(event)"
           onclick="pdxToggleCustom('${escapeHtml(q.id)}', ${sel ? 'false' : 'true'})">
        <span class="cq-drag-handle" onclick="event.stopPropagation()" title="Drag to a folder">⠿</span>
        <div class="admin-quiz-item-info">
          <div class="admin-quiz-item-title">${escapeHtml(q.title || 'Untitled Quiz')}</div>
          <div class="admin-quiz-item-meta">${(q.questions || []).length} question${(q.questions || []).length !== 1 ? 's' : ''}</div>
          ${chip ? `<div style="margin-top:5px;">${chip}</div>` : ''}
        </div>
        <div class="cq-move-wrap">
          <button class="admin-quiz-move-btn" data-move-btn="${q.id}"
                  onclick="event.stopPropagation(); cqToggleQuizMoveMenu('${q.id}')" title="Move to a folder"></button>
          ${moveOpen ? _renderQuizMoveMenuHTML(q) : ''}
        </div>
        <div class="admin-quiz-item-check">✓</div>
      </div>`;
  }).join('') : `
    <div class="empty-state" style="padding:16px 12px;">
      <div class="empty-icon"></div>
      No quizzes in this folder yet.
    </div>`;

  el.innerHTML = `<div class="cq-coll-layout ${cqSidebarCollapsed ? 'cq-coll-sidebar-collapsed' : ''}">
    ${renderCqCollectionsSidebarHTML(quizzes, collections)}
    <div class="cq-coll-main">
      ${renderCqBreadcrumbHTML(collections)}
      <div class="cq-coll-quiz-list">${itemsHtml}</div>
    </div>
  </div>`;

  if (prevScrollTop != null) {
    const sidebar = el.querySelector('.cq-coll-sidebar');
    if (sidebar) sidebar.scrollTop = prevScrollTop;
  }
}
function pdxToggleCustom(id, checked) {
  if (checked) _pdxSelCustom.add(id); else _pdxSelCustom.delete(id);
  _pdxRefreshChrome();
  _pdxRenderCustomTab();
}

/* ══════════════════════════════════════════════════════════
   LOOK & FEEL SETTINGS + LIVE (DECOY) PREVIEW
   The preview is a plain HTML/CSS mock-up — not the real PDF engine —
   so it updates instantly as sliders/swatches change. It uses placeholder
   sample text/an illustrative image block, never real question content.
══════════════════════════════════════════════════════════ */
function pdxSetTextSize(v) { _pdxSettings.textSize = v; _pdxSyncSettingsUI(); pdxRenderPreview(); }
function pdxSetImageSize(v) { _pdxSettings.imageSize = v; _pdxSyncSettingsUI(); pdxRenderPreview(); }
function pdxSetTheme(v) { _pdxSettings.theme = v; _pdxSyncSettingsUI(); pdxRenderPreview(); }
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
    <div class="pdx-pv-img" style="width:${imgPx}px;height:${imgPx}px;"><svg class="sicon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
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
  return `<div class="backup-result-bar ${ok ? 'ok' : 'fail'}"><span class="backup-result-icon">${ok ? '<svg class="hicon" style="width:17px;height:17px;" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' : '<svg class="hicon" style="width:17px;height:17px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}</span><span class="backup-result-msg">${message}</span></div>`;
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
   drawing loop below uses, so the two never disagree.

   IMPORTANT: `text` here is drawn with jsPDF's doc.text(), not written
   to the DOM — it's plain text baked into the PDF file itself, so it
   must never contain <svg>/HTML markup (jsPDF can't render it, and
   there's no innerHTML step to make sense of it downstream; it would
   print the raw "<svg ...>" tag as literal text on the Contents page).
   Icons belong on the on-screen tab buttons (see SOURCE_TAB_ICONS in
   dom-utils.js) — plain labels only belong here. */
function _pdxBuildOutline(dataset) {
  const out = [];
  for (const year of Object.keys(dataset.curriculum)) {
    out.push({ level: 0, text: year });
    for (const mod of Object.keys(dataset.curriculum[year])) {
      out.push({ level: 1, text: mod });
      for (const subjKey of Object.keys(dataset.curriculum[year][mod])) {
        const subj = subjects[subjKey] || { label: subjKey, icon: '📘' };
        out.push({ level: 2, text: `${subj.icon || '📘'} ${subj.label || subjKey}` });
        dataset.curriculum[year][mod][subjKey].forEach(lecName => out.push({ level: 3, text: lecName }));
      }
    }
  }
  if (dataset.community.groups.length) {
    out.push({ level: 0, text: 'Community Quizzes' });
    dataset.community.groups.forEach(group => {
      out.push({ level: 1, text: group.label });
      group.quizzes.forEach(quiz => out.push({ level: 2, text: quiz.title }));
    });
  }
  if (dataset.custom.groups.length) {
    out.push({ level: 0, text: 'My Custom Quizzes' });
    dataset.custom.groups.forEach(group => {
      out.push({ level: 1, text: group.label });
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

/* Same badge markup/colours as the favicon (assets/brand/logo-mark.svg),
   the header .brand-mark and the intro-screen sigil (index.html) —
   rasterized once to a PNG data URL so jsPDF can draw it, then cached for
   the rest of this export. Built from the same pixel-accurate vector
   trace of the source logo artwork; a PDF page is static, so it's just
   the plain badge with no animation. */
const PDX_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 523 523">
  <g transform="translate(0,523) scale(0.1,-0.1)" fill="#152B55">
    <path d="M1248 5139 c-506 -59 -940 -415 -1099 -902 -67 -205 -64 -130 -64 -1627 0 -1256 1 -1362 18 -1449 96 -509 471 -914 967 -1047 157 -42 208 -44 1543 -44 846 0 1310 4 1374 11 578 64 1040 499 1151 1083 16 83 17 204 17 1451 0 1266 -1 1366 -18 1448 -96 470 -404 839 -837 1000 -53 20 -141 46 -195 58 l-100 23 -1340 2 c-737 1 -1374 -2 -1417 -7z"/>
  </g>
  <g transform="translate(0,523) scale(0.1,-0.1)" fill="#1AD6E5">
    <path d="M1248 5139 c-506 -59 -940 -415 -1099 -902 -67 -205 -64 -130 -64 -1627 0 -1256 1 -1362 18 -1449 96 -509 471 -914 967 -1047 157 -42 208 -44 1543 -44 846 0 1310 4 1374 11 578 64 1040 499 1151 1083 16 83 17 204 17 1451 0 1266 -1 1366 -18 1448 -96 470 -404 839 -837 1000 -53 20 -141 46 -195 58 l-100 23 -1340 2 c-737 1 -1374 -2 -1417 -7z m2698 -189 c258 -23 499 -135 684 -319 159 -158 252 -325 311 -561 l24 -95 0 -1350 c0 -1104 -3 -1363 -14 -1420 -52 -267 -190 -508 -383 -670 -184 -155 -377 -238 -613 -265 -120 -13 -2536 -13 -2665 0 -239 25 -434 109 -619 265 -192 162 -319 379 -378 647 -17 78 -18 163 -18 1428 0 1272 1 1350 19 1430 70 322 251 583 520 750 141 88 312 146 471 160 126 11 2534 11 2661 0z"/>
    <path d="M3382 2722 c-17 -37 -43 -87 -58 -111 -15 -24 -22 -41 -16 -37 6 3 12 3 14 -1 1 -5 38 -26 82 -47 195 -97 326 -316 326 -546 0 -234 -131 -450 -332 -550 -134 -65 -170 -70 -610 -70 l-388 0 -1 373 c-1 204 -1 375 0 380 0 4 -17 7 -38 7 -22 0 -72 7 -111 15 -40 8 -76 13 -81 9 -5 -3 -9 -198 -9 -463 l0 -458 23 -34 c48 -72 33 -70 592 -66 552 4 542 3 692 72 171 79 305 203 398 369 137 246 141 562 9 816 -92 175 -238 312 -415 388 l-47 20 -30 -66z"/>
    <path d="M2258 4084 c-298 -54 -568 -271 -689 -554 -54 -128 -73 -220 -72 -365 0 -238 61 -409 212 -599 l49 -62 -35 -52 c-21 -32 -47 -58 -68 -66 -19 -8 -50 -37 -72 -68 -191 -257 -422 -577 -432 -595 -6 -12 -11 -38 -11 -58 0 -100 101 -172 196 -139 22 8 40 14 41 14 4 0 462 628 472 647 6 12 11 31 11 43 0 24 69 120 86 120 7 0 50 -18 96 -40 138 -65 229 -85 398 -84 119 0 160 4 229 23 197 53 380 174 507 334 226 286 263 671 97 1002 -98 197 -285 368 -494 452 -146 59 -353 78 -521 47z m377 -254 c119 -37 202 -87 290 -175 213 -211 268 -523 141 -790 -198 -416 -731 -529 -1087 -230 -219 184 -300 482 -205 754 36 102 89 185 171 266 100 100 233 170 368 195 83 15 242 5 322 -20z"/>
    <path d="M2393 3708 c-33 -16 -48 -61 -33 -97 14 -34 44 -47 123 -55 170 -15 325 -165 343 -332 9 -86 21 -120 50 -133 38 -17 62 -13 89 14 20 19 25 34 25 77 0 240 -194 472 -437 523 -79 17 -129 18 -160 3z"/>
  </g>
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
    top: margin + 30, // leaves room for the running header band
    bottom: pageH - margin - 24, // leaves room for the running footer
    y: margin + 30,
    settings: _pdxSettings,
    textSizes: PDX_TEXT_SIZES[_pdxSettings.textSize],
    imageMax: PDX_IMAGE_SIZES[_pdxSettings.imageSize],
    outline: [], // [{level, text}] for the Contents page
    pageMeta: {}, // pageNumber -> { breadcrumb, color } for the finishing pass
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
  const sizes = { 1: 14.5, 2: 12, 3: 10.5 };
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