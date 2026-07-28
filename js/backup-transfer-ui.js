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
  const { listCustomQuizzes } = await import('./local-store.js');
  const quizzes = await listCustomQuizzes();

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
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="stats-open-btn" onclick="_backupDoExport()">⬇️ Export to file</button>
          <button class="stats-open-btn" onclick="document.getElementById('backupImportFileInput').click()">⬆️ Import from file</button>
          <input type="file" id="backupImportFileInput" accept="application/json" style="display:none" onchange="_backupDoImport(this.files[0])">
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

async function _backupDoExport() {
  const statusEl = document.getElementById('backupFileStatus');
  try {
    const { downloadExportFile, markBackedUp } = await import('./local-store.js');
    const payload = await _backupBuildSelectedPayload();
    downloadExportFile(payload, `anu-msp-backup-${new Date().toISOString().slice(0, 10)}.json`);
    markBackedUp();
    statusEl.innerHTML = `<span style="color:var(--correct-fg,#4caf50);">✅ Downloaded — save it somewhere you'll remember (Downloads folder, your own cloud drive, etc.)</span>`;
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ Export failed: ${escapeHtml(e.message || String(e))}</span>`;
  }
}

async function _backupDoImport(file) {
  const statusEl = document.getElementById('backupFileStatus');
  if (!file) return;
  statusEl.innerHTML = `⏳ Importing…`;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const { applyImportPayload } = await import('./local-store.js');
    const result = await applyImportPayload(payload);
    await _backupRefreshAfterImport();
    statusEl.innerHTML = `<span style="color:var(--correct-fg,#4caf50);">✅ Imported: ${result.quizzes.added} quiz(zes) added (${result.quizzes.skipped} already had), ${result.attempts.added} stats entries added (${result.attempts.skipped} already had).</span>`;
    renderBackupTransferModal();
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--wrong-fg,#e53935);">❌ Import failed: ${escapeHtml(e.message || String(e))}. Make sure you picked a real backup file from this app.</span>`;
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
    statusEl.innerHTML = `⏳ Setting up…`;
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
      const messages = {
        connected: '🔗 Connected! Sending…',
        done: '✅ Sent successfully.'
      };
      if (messages[status]) statusEl.innerHTML = messages[status];
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
    statusEl.innerHTML = `⏳ Connecting…`;
    const { startReceive } = await import('./p2p-transfer.js');
    const payload = await startReceive(code.trim().toUpperCase(), (status) => {
      const messages = { 'looking-for-sender': '🔍 Looking for the other device…', connecting: '🔗 Connecting…' };
      statusEl.innerHTML = messages[status] || status;
    });
    const { applyImportPayload } = await import('./local-store.js');
    const result = await applyImportPayload(payload);
    await _backupRefreshAfterImport();
    statusEl.innerHTML = `<span style="color:var(--correct-fg,#4caf50);">✅ Received: ${result.quizzes.added} quiz(zes) added, ${result.attempts.added} stats entries added.</span>`;
    renderBackupTransferModal();
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
