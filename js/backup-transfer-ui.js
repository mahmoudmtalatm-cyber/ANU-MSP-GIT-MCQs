/* =============================================================================
   backup-transfer-ui.js

   The interface for everything js/local-store.js does under the hood:
   file-based export/import, which always works and doubles as a backup.

   Plain script (not a module) — its open/close functions are called
   directly from onclick="" attributes in index.html, which can only reach
   global functions. Internally it uses dynamic import() to reach the
   ES-module pieces (local-store.js, content-client.js), same pattern
   used throughout the rest of the app's plain scripts.

   Build 70 additions:
   - Every async action here (export, import, P2P send, P2P receive) now
     shows a stylised in-progress bar, then a solid done/failed result bar
     — instead of plain spinner text — via _backupProgressHTML() /
     _backupResultHTML() below.
   - Export gained an optional custom file name field
     (_backupResolveExportFilename()).
   - Import (file or P2P) now always asks first, via
     _backupConfirmImportFlow(): whether to merge with or replace existing
     on-device data, and — when a backup contains both custom quizzes and
     stats — which of the two to actually load.
   - P2P send now also renders a QR code of the transfer code
     (_backupRenderSendQr()); P2P receive gained a "Scan QR" camera option
     (_backupStartQrScan()) alongside the existing manual code entry —
     the manual/typed path is untouched, this is purely additive.
   - QR generation/scanning use vendored local libraries
     (js/vendor/qrcode-generator.min.js, js/vendor/jsQR.min.js) — lazy
     loaded on first use, same pattern gemini-uploads.js already uses for
     pdf.js — so this never depends on a CDN being reachable and costs
     nothing until someone actually sends/scans.

   Build 71 fix:
   - P2P send/receive (including "📷 Scan QR", which immediately calls
     startReceive() once a code is found) failed for every signed-OUT user
     with Firestore's raw "Missing or insufficient permissions" — the
     p2pSignaling collection required `request.auth != null` in
     firestore.rules, which guest use of this local-first feature never
     satisfied. Fixed at the rules level (see firestore.rules — the
     transfer code, not auth, was already the real protection). This file
     additionally gained _backupFriendlyP2PError() so that if a permission
     error is ever hit again (e.g. rules not yet redeployed), the message
     shown says so plainly instead of surfacing the raw Firestore string.

   Build 72 follow-up:
   - The error kept recurring after 71 because Firestore only enforces
     whatever rules are currently PUBLISHED to the live project — editing
     firestore.rules in the repo has zero effect until it's actually
     deployed there (Firebase Console → Firestore Database → Rules →
     paste → Publish, or `firebase deploy --only firestore:rules` in a
     project with the Firebase CLI set up). _backupFriendlyP2PError()'s
     message now says this explicitly instead of just "permission
     denied," since that was the actual missing step, not another code
     bug.

   Build 73 — QR removed, modal rebuilt as a proper two-card layout:
   - Removed the QR code feature entirely (send-side generation and
     receive-side camera scanning), along with `js/vendor/qrcode-
     generator.min.js` and `js/vendor/jsQR.min.js`. The manual transfer
     code (copy on send, type on receive) was always the primary path
     and is untouched — this only removes the QR shortcut around it.
   - The modal body no longer builds its layout from ad-hoc inline
     `style=""` attributes. It's now two clearly separated, titled cards
     (`.backup-card`) — File and Device-to-device — each with its own
     icon header, action-button row (`.backup-actions`), and status
     area, all driven by real CSS classes in css/styles.css so the
     look stays consistent and easy to restyle later. The button rows
     wrap responsively at narrow widths instead of relying on inline
     flex-wrap rules scattered through the markup.

   Build 74 — "What to include" selection restyled:
   - The plain "Custom quizzes" / "Stats" checkboxes are now stylish,
     card-like toggle chips (`.backup-toggle-chip`) that highlight when
     checked, laid out in a wrapping row (`.backup-toggle-group`).
   - The quiz picker is now a bordered panel with a distinct header row
     (select-all + a live count badge) and a scrollable list of
     individually selectable quizzes that highlight on hover
     (`.backup-quiz-picker-header` / `.backup-quiz-list` /
     `.backup-quiz-row`) instead of a flat stack of checkboxes.
   - No behavior changed — same ids, same onchange handlers
     (`_backupToggleAllQuizzes`, `_backupQuizItemChanged`) — this is
     purely a visual pass.

   Build 77 — P2P direct-device transfer removed entirely:
   - Removed the whole "Direct device-to-device transfer" card and its
     four handler functions (`_backupStartP2PSend`, `_backupCopyP2PCode`,
     `_backupRenderP2PReceiveEntry`, `_backupRunP2PReceive`), plus the
     Firestore-specific `_backupFriendlyP2PError()` helper. `js/p2p-
     transfer.js` — the module those functions imported from — is deleted
     from the project outright.
   - The `p2pSignaling` collection and its rules in `firestore.rules` are
     removed too, since nothing writes to it anymore.
   - Export/Import (file-based) is untouched and is now the only backup
     path presented in this modal — same ids, same handlers
     (`_backupDoExport`, `_backupDoImport`, `_backupConfirmImportFlow`).
   ============================================================================= */

let _backupSelectedQuizIds = null; // null = "all" (no explicit selection made yet)

function openBackupTransfer() {
  document.getElementById('backupOverlay').classList.remove('hidden');
  renderBackupTransferModal();
}

function closeBackupTransfer() {
  document.getElementById('backupOverlay').classList.add('hidden');
}

async function renderBackupTransferModal() {
  const body = document.getElementById('backupBody');
  const { listCustomQuizzes, listQuizCollections } = await import('./local-store.js');
  const quizzes = await listCustomQuizzes();
  window._cachedQuizCollections = await listQuizCollections(); // warm cache for the chip helper below
  const defaultExportName = `anu-msp-backup-${new Date().toISOString().slice(0, 10)}`;

  body.innerHTML = `
    <div class="backup-intro">
      Your custom quizzes and stats live on this device to keep the app free to run.
      That means clearing your browser data, switching browsers, or losing this
      device means this data is gone unless you've backed it up. Use either option
      below whenever you want — both work, pick whichever's easier right now.
    </div>

    <div class="backup-card">
      <div class="backup-card-header">
        <span class="backup-card-icon">📁</span>
        <div>
          <div class="backup-card-title">Export / Import</div>
          <div class="backup-card-subtitle">A file you keep — works everywhere, no connection needed</div>
        </div>
      </div>

      <div class="backup-card-body">
        <div class="backup-field-group">
          <div class="backup-field-label">What to include</div>
          <div class="backup-toggle-group">
            <label class="backup-toggle-chip"><input type="checkbox" id="backupIncludeQuizzes" checked><span>📝 Custom quizzes</span></label>
            <label class="backup-toggle-chip"><input type="checkbox" id="backupIncludeStats" checked><span>📊 Stats / history</span></label>
          </div>
          <div id="backupQuizPicker" class="backup-quiz-picker" ${quizzes.length ? '' : 'style="display:none;"'}>
            <div class="backup-quiz-picker-header">
              <label class="backup-quiz-row backup-quiz-all"><input type="checkbox" id="backupQuizAll" checked onchange="_backupToggleAllQuizzes(this.checked)"><span>All quizzes</span></label>
              <span class="backup-quiz-count">${quizzes.length}</span>
            </div>
            <div class="backup-quiz-list">
              ${quizzes.map(q => `<label class="backup-quiz-row backup-quiz-item"><input type="checkbox" class="backupQuizItem" value="${q.id}" checked onchange="_backupQuizItemChanged()"><span>${escapeHtml(q.title || 'Untitled quiz')}</span></label>`).join('')}
            </div>
          </div>
        </div>

        <div class="backup-filename-row">
          <label for="backupExportName">File name (optional)</label>
          <input type="text" id="backupExportName" class="backup-text-input" placeholder="${escapeHtml(defaultExportName)}" maxlength="80" />
        </div>

        <div class="backup-actions">
          <button class="stats-open-btn" onclick="_backupDoExport()">⬇️ Export to file</button>
          <button class="stats-open-btn" onclick="document.getElementById('backupImportFileInput').click()">⬆️ Import from file</button>
          <input type="file" id="backupImportFileInput" accept="application/json" style="display:none" onchange="_backupDoImport(this.files[0])">
        </div>
        <div id="backupFileStatus" class="backup-status-area"></div>
      </div>
    </div>
  `;

  _backupRenderReminderNote();
}

function _backupToggleAllQuizzes(checked) {
  document.querySelectorAll('.backupQuizItem').forEach(cb => cb.checked = checked);
}
function _backupQuizItemChanged() {
  const all = document.querySelectorAll('.backupQuizItem');
  const allChecked = [...all].every(cb => cb.checked);
  document.getElementById('backupQuizAll').checked = allChecked;
}

async function _backupBuildSelectedPayload() {
  const { buildExportPayload } = await import('./local-store.js');
  const includeQuizzes = document.getElementById('backupIncludeQuizzes').checked;
  const includeStats = document.getElementById('backupIncludeStats').checked;
  let quizIds = null;
  if (includeQuizzes) {
    const checked = [...document.querySelectorAll('.backupQuizItem:checked')].map(cb => cb.value);
    const allBox = document.getElementById('backupQuizAll');
    if (allBox && !allBox.checked) quizIds = checked; // explicit partial selection
  }
  return buildExportPayload({ includeQuizzes, includeStats, quizIds });
}

/* ── Unified progress / result bar ──
   A small stylised "in progress" bar (animated moving stripes — none of
   these operations have a real byte-level percentage to report, so this
   is intentionally indeterminate) that gets replaced by a solid, colored
   "finished" bar once the operation settles — green for success, red for
   failure. Used by every async action in this menu: export and import.
   `message` may contain simple inline HTML (e.g. a bolded count),
   matching how the rest of this file already builds its status strings. */
function _backupProgressHTML(message) {
  return `<div class="backup-progress-wrap">
    <div class="backup-progress-row"><span class="backup-progress-dot"></span> ${message}</div>
    <div class="backup-progress-track"><div class="backup-progress-fill"></div></div>
  </div>`;
}
function _backupResultHTML(ok, message) {
  return `<div class="backup-result-bar ${ok ? 'ok' : 'fail'}">
    <span class="backup-result-icon">${ok ? '✅' : '❌'}</span>
    <span class="backup-result-msg">${message}</span>
  </div>`;
}

async function _backupDoExport() {
  const statusEl = document.getElementById('backupFileStatus');
  statusEl.innerHTML = _backupProgressHTML('Preparing your file…');
  try {
    const { downloadExportFile, markBackedUp } = await import('./local-store.js');
    const payload = await _backupBuildSelectedPayload();
    const filename = _backupResolveExportFilename();
    downloadExportFile(payload, filename);
    markBackedUp();
    statusEl.innerHTML = _backupResultHTML(true, `Downloaded as <strong>${escapeHtml(filename)}</strong> — save it somewhere you'll remember (Downloads folder, your own cloud drive, etc.)`);
  } catch (e) {
    statusEl.innerHTML = _backupResultHTML(false, `Export failed: ${escapeHtml(e.message || String(e))}`);
  }
}

/** Reads the optional custom name field and turns it into a safe, unique
 *  filename — falling back to the usual dated default when left blank. */
function _backupResolveExportFilename() {
  const input = document.getElementById('backupExportName');
  const raw = input ? input.value.trim() : '';
  const defaultName = `anu-msp-backup-${new Date().toISOString().slice(0, 10)}`;
  // Strip characters that are awkward/unsafe as filenames across OSes,
  // then collapse whitespace to single dashes so the download looks tidy.
  let name = raw ? raw.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-') : defaultName;
  if (!name) name = defaultName;
  if (!/\.json$/i.test(name)) name += '.json';
  return name;
}

/**
 * Confirmation step for file import: inspects
 * the payload without writing anything, then renders an inline panel
 * (into the same status element the caller is already using) asking:
 *   - which data type(s) to load, only shown when the backup actually has
 *     both custom quizzes and stats and thus a real choice exists;
 *   - whether to merge with this device's existing data (default, safest)
 *     or delete it first and replace it with the incoming set.
 * Resolves with either { proceed: false } (user cancelled) or
 * { proceed: true, mode, includeQuizzes, includeStats } ready to hand
 * straight to applyImportPayload().
 */
async function _backupConfirmImportFlow(payload, statusEl) {
  const { inspectImportPayload } = await import('./local-store.js');
  const info = inspectImportPayload(payload);
  if (!info.valid) {
    throw new Error('This file doesn\u2019t look like a valid backup for this app.');
  }
  if (!info.hasQuizzes && !info.hasStats) {
    throw new Error('This backup is empty \u2014 nothing to import.');
  }

  return new Promise((resolve) => {
    const bothPresent = info.hasQuizzes && info.hasStats;
    const parts = [];
    if (info.hasQuizzes) parts.push(`${info.quizCount} custom quiz${info.quizCount === 1 ? '' : 'zes'}`);
    if (info.hasStats) parts.push(`${info.statsCount} stats entr${info.statsCount === 1 ? 'y' : 'ies'}`);

    statusEl.innerHTML = `
      <div class="backup-import-confirm">
        <div class="backup-import-confirm-summary">This backup has <strong>${parts.join(' &amp; ')}</strong>.</div>
        ${bothPresent ? `
        <div class="backup-import-type-row">
          <label><input type="checkbox" id="backupImportIncludeQuizzes" checked> Custom quizzes (${info.quizCount})</label>
          <label><input type="checkbox" id="backupImportIncludeStats" checked> Stats / history (${info.statsCount})</label>
        </div>` : ''}
        <div class="backup-mode-row">
          <label class="backup-mode-opt">
            <input type="radio" name="backupImportMode" value="merge" checked>
            <span>🔀 Merge with what's already on this device <em>(recommended)</em></span>
          </label>
          <label class="backup-mode-opt">
            <input type="radio" name="backupImportMode" value="replace">
            <span>🗑️ Delete this device's existing data first, then load this backup</span>
          </label>
        </div>
        <div class="backup-confirm-actions">
          <button class="stats-open-btn" id="backupImportApplyBtn" type="button">✅ Apply</button>
          <button class="stats-open-btn backup-cancel-btn" id="backupImportCancelBtn" type="button">✖️ Cancel</button>
        </div>
      </div>`;

    document.getElementById('backupImportApplyBtn').onclick = () => {
      const includeQuizzes = bothPresent ? document.getElementById('backupImportIncludeQuizzes').checked : info.hasQuizzes;
      const includeStats = bothPresent ? document.getElementById('backupImportIncludeStats').checked : info.hasStats;
      const mode = document.querySelector('input[name="backupImportMode"]:checked').value;
      resolve({ proceed: true, mode, includeQuizzes, includeStats });
    };
    document.getElementById('backupImportCancelBtn').onclick = () => resolve({ proceed: false });
  });
}

async function _backupDoImport(file) {
  const statusEl = document.getElementById('backupFileStatus');
  if (!file) return;
  statusEl.innerHTML = _backupProgressHTML('Reading backup file…');
  try {
    const text = await file.text();
    const payload = JSON.parse(text);

    const choice = await _backupConfirmImportFlow(payload, statusEl);
    if (!choice.proceed) { statusEl.innerHTML = ''; return; }

    statusEl.innerHTML = _backupProgressHTML('Importing…');
    const { applyImportPayload } = await import('./local-store.js');
    const result = await applyImportPayload(payload, choice);
    await _backupRefreshAfterImport();
    const collectionsNote = result.collections && result.collections.added
      ? `, ${result.collections.added} collection${result.collections.added !== 1 ? 's' : ''} restored`
      : '';
    statusEl.innerHTML = _backupResultHTML(true, `Imported: ${result.quizzes.added} quiz(zes) added (${result.quizzes.skipped} already had)${collectionsNote}, ${result.attempts.added} stats entries added (${result.attempts.skipped} already had).`);
    // Give the result bar a moment on screen before the quiz picker above
    // refreshes to reflect the newly-imported quizzes.
    setTimeout(() => renderBackupTransferModal(), 1800);
  } catch (e) {
    statusEl.innerHTML = _backupResultHTML(false, `Import failed: ${escapeHtml(e.message || String(e))}. Make sure you picked a real backup file from this app.`);
  }
}

/** After a file import, refresh in-memory state so the rest of the app (Stats, Custom Quizzes) reflects it immediately, without needing a page reload. */
async function _backupRefreshAfterImport() {
  const { listCustomQuizzes, listQuizCollections } = await import('./local-store.js');
  window._cachedCustomQuizzes = await listCustomQuizzes();
  window._cachedQuizCollections = await listQuizCollections();
  if (window._currentUser && typeof loadStatsFromFirestore === 'function') {
    await loadStatsFromFirestore();
  }
  if (typeof renderCustomQuizModal === 'function') renderCustomQuizModal();
  if (typeof renderStatsModal === 'function') renderStatsModal();
}

/* ── Gentle backup reminder ──
   Shown as a small, non-alarming note inside this modal (never a blocking
   dialog), and as a subtle badge on the home-screen button so it's
   noticeable without being pushy. */
async function _backupRenderReminderNote() {
  const { shouldShowBackupReminder } = await import('./local-store.js');
  if (!shouldShowBackupReminder()) return;
  const body = document.getElementById('backupBody');
  const note = document.createElement('div');
  note.className = 'backup-reminder-note';
  note.innerHTML = `💡 It's been a while since your last backup — worth taking a minute to export or transfer a copy.`;
  body.prepend(note);
}

/** Called once, near app startup, to set the subtle badge on the home-screen button if a backup is overdue. */
async function checkBackupReminderBadge() {
  try {
    const { shouldShowBackupReminder } = await import('./local-store.js');
    const btn = document.querySelector('[onclick="openBackupTransfer()"]');
    if (btn && (await shouldShowBackupReminder())) {
      btn.innerHTML = '💾&nbsp; Backup &amp; Transfer <span style="opacity:.7;font-size:.8em;">●</span>';
    }
  } catch (e) { /* non-critical, fail silently */ }
}
document.addEventListener('DOMContentLoaded', () => setTimeout(checkBackupReminderBadge, 1500));
