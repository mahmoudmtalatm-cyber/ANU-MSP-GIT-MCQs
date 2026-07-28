/* =============================================================================
   backup-transfer-ui.js

   The interface for everything js/local-store.js and js/p2p-transfer.js
   already do under the hood: export/import (file-based, always works,
   doubles as backup) and P2P direct-device transfer (private, no server
   round-trip for the actual data). Both are first-class, equally visible
   options here — neither is presented as a fallback to the other.

   Plain script (not a module) — its open/close functions are called
   directly from onclick="" attributes in index.html, which can only reach
   global functions. Internally it uses dynamic import() to reach the
   ES-module pieces (local-store.js, p2p-transfer.js, content-client.js),
   same pattern used throughout the rest of the app's plain scripts.

   Load-options picker (merge/replace + which parts to load) and the
   animated progress bar are shared by BOTH import paths (file and P2P)
   via _backupRunTransferStep() / _backupShowLoadPicker(), so the two
   stay in sync instead of drifting into two separate implementations.
   ============================================================================= */

let _backupSelectedQuizIds = null; // null = "all" (no explicit selection made yet)
let _backupPendingPayload = null; // payload awaiting the user's merge/replace + parts choice
let _backupPendingSource = null;  // 'file' | 'p2p' — which status box to report into

function openBackupTransfer() {
  document.getElementById('backupOverlay').classList.remove('hidden');
  renderBackupTransferModal();
}

function closeBackupTransfer() {
  document.getElementById('backupOverlay').classList.add('hidden');
}

async function renderBackupTransferModal() {
  const body = document.getElementById('backupBody');
  const { listCustomQuizzes } = await import('./local-store.js');
  const quizzes = await listCustomQuizzes();
  const todayStamp = new Date().toISOString().slice(0, 10);

  body.innerHTML = `
    <div style="background:var(--card-bg,rgba(255,255,255,.04));border-radius:12px;padding:14px 16px;margin-bottom:16px;font-size:.86rem;line-height:1.5;color:var(--text-muted);">
      Your custom quizzes and stats live on this device to keep the app free to run.
      That means clearing your browser data, switching browsers, or losing this
      device means this data is gone unless you've backed it up. Use either option
      below whenever you want — both work, pick whichever's easier right now.
    </div>

    <div class="stats-section">
      <div class="stats-section-title">📁 Export / Import (a file — works everywhere)</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <div style="font-weight:600;margin-bottom:6px;">What to include:</div>
          <label style="display:block;margin-bottom:4px;"><input type="checkbox" id="backupIncludeQuizzes" checked> Custom quizzes</label>
          <label style="display:block;margin-bottom:8px;"><input type="checkbox" id="backupIncludeStats" checked> Stats / history</label>
          <div id="backupQuizPicker" style="max-height:140px;overflow-y:auto;border:1px solid var(--border-color,#3334);border-radius:8px;padding:8px;${quizzes.length ? '' : 'display:none;'}">
            <label style="display:block;font-size:.85rem;margin-bottom:4px;"><input type="checkbox" id="backupQuizAll" checked onchange="_backupToggleAllQuizzes(this.checked)"> All quizzes (${quizzes.length})</label>
            ${quizzes.map(q => `<label style="display:block;font-size:.83rem;margin-left:14px;color:var(--text-muted);"><input type="checkbox" class="backupQuizItem" value="${q.id}" checked onchange="_backupQuizItemChanged()"> ${escapeHtml(q.title || 'Untitled quiz')}</label>`).join('')}
          </div>
          <div class="backup-filename-row">
            <label for="backupFilenameInput" style="font-size:.85rem;color:var(--text-muted);white-space:nowrap;">File name:</label>
            <input type="text" id="backupFilenameInput" placeholder="anu-msp-backup-${todayStamp}" value="anu-msp-backup-${todayStamp}">
            <span style="font-size:.8rem;color:var(--text-muted);">.json</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="stats-open-btn" onclick="_backupDoExport()">⬇️ Export to file</button>
          <button class="stats-open-btn" onclick="document.getElementById('backupImportFileInput').click()">⬆️ Import from file</button>
          <input type="file" id="backupImportFileInput" accept="application/json" style="display:none" onchange="_backupPickFile(this.files[0])">
        </div>
        <div id="backupFileStatus" style="font-size:.85rem;"></div>
      </div>
    </div>

    <div class="stats-section">
      <div class="stats-section-title">📡 Direct device-to-device transfer</div>
      <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:10px;">
        More private — your data goes straight between the two devices, never
        sitting on a server. Both devices need this page open at the same time.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <button class="stats-open-btn" onclick="_backupStartP2PSend()">📤 Send from this device</button>
        <button class="stats-open-btn" onclick="_backupStartP2PReceive()">📥 Receive on this device</button>
      </div>
      <div id="backupP2PStatus" style="font-size:.85rem;"></div>
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

/** Sanitizes a user-provided file name into something safe to use as a download filename. */
function _backupSanitizeFilename(name) {
  const fallback = `anu-msp-backup-${new Date().toISOString().slice(0, 10)}`;
  const trimmed = (name || '').trim().replace(/\.json$/i, '');
  const safe = trimmed.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 100);
  return (safe || fallback) + '.json';
}

/* ── Animated progress bar (shared by export, import, and both P2P directions) ──
   Indeterminate (sliding) by default; call with a 0-100 pct to switch to a
   determinate fill, e.g. once we know real byte/step progress. */
function _backupProgressHtml(label, pct = null) {
  const determinate = pct !== null;
  return `
    <div class="backup-progress-wrap">
      <div class="backup-progress-label">${escapeHtml(label)}</div>
      <div class="backup-progress-track">
        <div class="backup-progress-fill${determinate ? ' is-determinate' : ''}" style="${determinate ? `--pct:${Math.max(0, Math.min(100, pct))}%` : ''}"></div>
      </div>
    </div>`;
}

async function _backupDoExport() {
  const statusEl = document.getElementById('backupFileStatus');
  statusEl.innerHTML = _backupProgressHtml('Preparing your export…');
  try {
    const { downloadExportFile, markBackedUp } = await import('./local-store.js');
    const payload = await _backupBuildSelectedPayload();
    const nameInput = document.getElementById('backupFilenameInput');
    const filename = _backupSanitizeFilename(nameInput ? nameInput.value : '');
    downloadExportFile(payload, filename);
    markBackedUp();
    statusEl.innerHTML = `<span style="color:var(--correct-fg,#4caf50);">✅ Downloaded as <strong>${escapeHtml(filename)}</strong> — save it somewhere you'll remember (Downloads folder, your own cloud drive, etc.)</span>`;
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ Export failed: ${escapeHtml(e.message || String(e))}</span>`;
  }
}

/** Step 1 of import-from-file: just read + parse the file, then hand off to the shared load-options picker. */
async function _backupPickFile(file) {
  const statusEl = document.getElementById('backupFileStatus');
  if (!file) return;
  statusEl.innerHTML = _backupProgressHtml('Reading file…');
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || payload.__app !== 'anu-msp-question-bank') {
      throw new Error('This file doesn\u2019t look like a valid backup for this app.');
    }
    _backupPendingPayload = payload;
    _backupPendingSource = 'file';
    _backupShowLoadPicker(statusEl, payload);
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ ${escapeHtml(e.message || String(e))}</span>`;
  }
}

/**
 * Renders the merge/replace + "what to load" picker into the given status
 * element, based on what the payload actually contains (skips offering a
 * choice for a part that isn't in the file/transfer at all).
 */
async function _backupShowLoadPicker(statusEl, payload) {
  const { describeImportPayload } = await import('./local-store.js');
  const info = describeImportPayload(payload);

  if (!info.hasQuizzes && !info.hasStats) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ That backup doesn\u2019t contain any quizzes or stats to load.</span>`;
    _backupPendingPayload = null;
    return;
  }

  const partsHtml = `
    <div class="blo-parts">
      ${info.hasQuizzes ? `<label><input type="checkbox" id="bloLoadQuizzes" checked> Custom quizzes (${info.quizCount})</label>` : ''}
      ${info.hasStats ? `<label><input type="checkbox" id="bloLoadStats" checked> Stats / history (${info.statCount})</label>` : ''}
    </div>`;

  statusEl.innerHTML = `
    <div class="backup-load-options">
      <div class="blo-title">How should this be loaded?</div>
      <div class="blo-mode-choice">
        <label class="blo-mode-card is-selected" id="bloModeMergeCard">
          <div><input type="radio" name="bloMode" id="bloModeMerge" value="merge" checked onchange="_backupModeChanged()"><span class="blo-mode-name">Merge</span></div>
          <div class="blo-mode-desc">Keep what's already on this device and add anything new. Exact duplicates are skipped.</div>
        </label>
        <label class="blo-mode-card" id="bloModeReplaceCard">
          <div><input type="radio" name="bloMode" id="bloModeReplace" value="replace" onchange="_backupModeChanged()"><span class="blo-mode-name">Replace</span></div>
          <div class="blo-mode-desc">Delete what's currently on this device first, then load this backup as the new complete set.</div>
        </label>
      </div>
      ${partsHtml}
      <div class="blo-actions">
        <button class="stats-open-btn" onclick="_backupConfirmLoad()">✅ Load now</button>
        <button class="stats-open-btn" onclick="_backupCancelLoad()">Cancel</button>
      </div>
    </div>`;
}

function _backupModeChanged() {
  const merge = document.getElementById('bloModeMerge').checked;
  document.getElementById('bloModeMergeCard').classList.toggle('is-selected', merge);
  document.getElementById('bloModeReplaceCard').classList.toggle('is-selected', !merge);
}

function _backupCancelLoad() {
  _backupPendingPayload = null;
  _backupPendingSource = null;
  const statusEl = document.getElementById(_backupPendingSource === 'p2p' ? 'backupP2PStatus' : 'backupFileStatus');
  if (statusEl) statusEl.innerHTML = '';
  document.getElementById('backupFileStatus').innerHTML = '';
  document.getElementById('backupP2PStatus').innerHTML = '';
}

/** Reads the picker's chosen mode + parts and actually applies the pending payload. */
async function _backupConfirmLoad() {
  const source = _backupPendingSource;
  const statusEl = document.getElementById(source === 'p2p' ? 'backupP2PStatus' : 'backupFileStatus');
  const payload = _backupPendingPayload;
  if (!payload) return;

  const mode = document.getElementById('bloModeReplace') && document.getElementById('bloModeReplace').checked ? 'replace' : 'merge';
  const loadQuizzesBox = document.getElementById('bloLoadQuizzes');
  const loadStatsBox = document.getElementById('bloLoadStats');
  const loadQuizzes = loadQuizzesBox ? loadQuizzesBox.checked : true;
  const loadStats = loadStatsBox ? loadStatsBox.checked : true;

  statusEl.innerHTML = _backupProgressHtml(mode === 'replace' ? 'Replacing existing data…' : 'Merging data…');
  try {
    const { applyImportPayload } = await import('./local-store.js');
    const result = await applyImportPayload(payload, { mode, loadQuizzes, loadStats });
    await _backupRefreshAfterImport();

    const parts = [];
    if (loadQuizzes) {
      parts.push(mode === 'replace'
        ? `${result.quizzes.added} quiz(zes) loaded (${result.quizzes.replaced || 0} previous removed)`
        : `${result.quizzes.added} quiz(zes) added (${result.quizzes.skipped} already had)`);
    }
    if (loadStats) {
      parts.push(mode === 'replace'
        ? `${result.attempts.added} stats entries loaded (${result.attempts.replaced || 0} previous removed)`
        : `${result.attempts.added} stats entries added (${result.attempts.skipped} already had)`);
    }
    statusEl.innerHTML = `<span style="color:var(--correct-fg,#4caf50);">✅ ${parts.join(', ') || 'Nothing selected to load.'}</span>`;
    _backupPendingPayload = null;
    _backupPendingSource = null;
    renderBackupTransferModal();
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ Import failed: ${escapeHtml(e.message || String(e))}</span>`;
  }
}

/** After any import (file or P2P), refresh in-memory state so the rest of the app (Stats, Custom Quizzes) reflects it immediately, without needing a page reload. */
async function _backupRefreshAfterImport() {
  const { listCustomQuizzes } = await import('./local-store.js');
  window._cachedCustomQuizzes = await listCustomQuizzes();
  if (window._currentUser && typeof loadStatsFromFirestore === 'function') {
    await loadStatsFromFirestore();
  }
  if (typeof renderCustomQuizModal === 'function') renderCustomQuizModal();
  if (typeof renderStatsModal === 'function') renderStatsModal();
}

async function _backupStartP2PSend() {
  const statusEl = document.getElementById('backupP2PStatus');
  try {
    const payload = await _backupBuildSelectedPayload();
    const { startSend } = await import('./p2p-transfer.js');
    statusEl.innerHTML = _backupProgressHtml('Setting up…');
    await startSend(payload, (status, code) => {
      if (status === 'waiting-for-receiver' && code) {
        statusEl.innerHTML = `
          📤 Ready — tell the other device to tap "Receive on this device" and enter this code:
          <div class="p2p-code-box">
            <span class="p2p-code-value" id="p2pCodeValue">${escapeHtml(code)}</span>
            <button class="p2p-code-copy-btn" onclick="_backupCopyP2PCode('${code}')">📋 Copy</button>
          </div>`;
        return;
      }
      if (status === 'connected') statusEl.innerHTML = _backupProgressHtml('🔗 Connected! Sending…');
      if (status === 'done') statusEl.innerHTML = `<span style="color:var(--correct-fg,#4caf50);">✅ Sent successfully.</span>`;
    });
    const { markBackedUp } = await import('./local-store.js');
    markBackedUp();
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ ${escapeHtml(e.message || String(e))} — you can always use Export/Import instead.</span>`;
  }
}

/** Copies the P2P transfer code to the clipboard, with a graceful fallback for browsers/contexts where the Clipboard API is unavailable (e.g. non-HTTPS). */
async function _backupCopyP2PCode(code) {
  try {
    await navigator.clipboard.writeText(code);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* best-effort */ }
    document.body.removeChild(ta);
  }
  const btn = document.querySelector('.p2p-code-copy-btn');
  if (btn) {
    const original = btn.textContent;
    btn.textContent = '✅ Copied';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }
}

async function _backupStartP2PReceive() {
  const statusEl = document.getElementById('backupP2PStatus');
  const code = prompt('Enter the code shown on the sending device:');
  if (!code) return;
  try {
    statusEl.innerHTML = _backupProgressHtml('Connecting…');
    const { startReceive } = await import('./p2p-transfer.js');
    const payload = await startReceive(code.trim().toUpperCase(), (status) => {
      const messages = { 'looking-for-sender': '🔍 Looking for the other device…', connecting: '🔗 Connecting…' };
      statusEl.innerHTML = _backupProgressHtml(messages[status] || status);
    });
    _backupPendingPayload = payload;
    _backupPendingSource = 'p2p';
    await _backupShowLoadPicker(statusEl, payload);
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ ${escapeHtml(e.message || String(e))} — you can always use Export/Import instead.</span>`;
  }
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
  note.style.cssText = 'background:var(--warn-bg,rgba(255,193,7,.12));border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:.85rem;';
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
