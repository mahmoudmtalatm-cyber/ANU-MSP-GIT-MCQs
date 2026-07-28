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
   ============================================================================= */

let _backupSelectedQuizIds = null; // null = "all" (no explicit selection made yet)

function openBackupTransfer() {
  document.getElementById('backupOverlay').classList.remove('hidden');
  renderBackupTransferModal();
}

function closeBackupTransfer() {
  document.getElementById('backupOverlay').classList.add('hidden');
  _backupStopQrScan(); // never leave the camera running once the modal is closed
}

async function renderBackupTransferModal() {
  const body = document.getElementById('backupBody');
  const { listCustomQuizzes } = await import('./local-store.js');
  const quizzes = await listCustomQuizzes();
  const defaultExportName = `anu-msp-backup-${new Date().toISOString().slice(0, 10)}`;

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
        <div class="backup-filename-row">
          <label for="backupExportName">File name (optional)</label>
          <input type="text" id="backupExportName" class="backup-text-input" placeholder="${escapeHtml(defaultExportName)}" maxlength="80" />
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="stats-open-btn" onclick="_backupDoExport()">⬇️ Export to file</button>
          <button class="stats-open-btn" onclick="document.getElementById('backupImportFileInput').click()">⬆️ Import from file</button>
          <input type="file" id="backupImportFileInput" accept="application/json" style="display:none" onchange="_backupDoImport(this.files[0])">
        </div>
        <div id="backupFileStatus"></div>
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
        <button class="stats-open-btn" onclick="_backupRenderP2PReceiveEntry()">📥 Receive on this device</button>
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

/* ── Unified progress / result bar ──
   A small stylised "in progress" bar (animated moving stripes — none of
   these operations have a real byte-level percentage to report, so this
   is intentionally indeterminate) that gets replaced by a solid, colored
   "finished" bar once the operation settles — green for success, red for
   failure. Used by every async action in this menu: export, import
   (file or P2P), and P2P send/receive. `message` may contain simple
   inline HTML (e.g. a bolded count), matching how the rest of this file
   already builds its status strings. */
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
 * Shared confirmation step for BOTH import paths (file and P2P): inspects
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
    statusEl.innerHTML = _backupResultHTML(true, `Imported: ${result.quizzes.added} quiz(zes) added (${result.quizzes.skipped} already had), ${result.attempts.added} stats entries added (${result.attempts.skipped} already had).`);
    // Give the result bar a moment on screen before the quiz picker above
    // refreshes to reflect the newly-imported quizzes.
    setTimeout(() => renderBackupTransferModal(), 1800);
  } catch (e) {
    statusEl.innerHTML = _backupResultHTML(false, `Import failed: ${escapeHtml(e.message || String(e))}. Make sure you picked a real backup file from this app.`);
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
    statusEl.innerHTML = _backupProgressHTML('Setting up…');
    await startSend(payload, (status, code) => {
      if (status === 'waiting-for-receiver' && code) {
        statusEl.innerHTML = `
          <div class="backup-progress-row" style="margin-bottom:10px;"><span class="backup-progress-dot"></span> Waiting for the other device — tell it to tap "Receive on this device":</div>
          <div class="p2p-code-box">
            <span class="p2p-code-value" id="p2pCodeValue">${escapeHtml(code)}</span>
            <button class="p2p-code-copy-btn" onclick="_backupCopyP2PCode('${code}')">📋 Copy</button>
          </div>
          <div class="backup-qr-hint">Or scan this instead of typing the code:</div>
          <div class="backup-qr-box" id="backupQrBox"><div class="backup-qr-loading">Generating QR code…</div></div>`;
        _backupRenderSendQr(code);
        return;
      }
      if (status === 'connected') {
        statusEl.innerHTML = _backupProgressHTML('Connected! Sending…');
      } else if (status === 'done') {
        statusEl.innerHTML = _backupResultHTML(true, 'Sent successfully.');
      }
    });
    const { markBackedUp } = await import('./local-store.js');
    markBackedUp();
  } catch (e) {
    statusEl.innerHTML = _backupResultHTML(false, `${escapeHtml(e.message || String(e))} — you can always use Export/Import instead.`);
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

// ---------------------------------------------------------------------------
// QR CODE — generation (sending side) and camera scanning (receiving side).
// Both libraries are vendored locally under js/vendor/ (not loaded from a
// CDN) and lazy-loaded on first use, so nothing here costs anything until
// someone actually sends or scans, and neither ever depends on a third
// party being reachable. See js/vendor/*.LICENSE for attribution.
// ---------------------------------------------------------------------------

function _backupLoadScriptOnce(src, globalCheck) {
  if (globalCheck()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Couldn\u2019t load a required file \u2014 check your connection.'));
    document.head.appendChild(script);
  });
}
function _backupEnsureQrGenLib() {
  return _backupLoadScriptOnce('js/vendor/qrcode-generator.min.js', () => typeof window.qrcode === 'function');
}
function _backupEnsureQrScanLib() {
  return _backupLoadScriptOnce('js/vendor/jsQR.min.js', () => typeof window.jsQR === 'function');
}

/** Renders a QR code encoding the plain transfer code into #backupQrBox — additive alongside the existing text code + copy button, never replacing them. */
async function _backupRenderSendQr(code) {
  const box = document.getElementById('backupQrBox');
  if (!box) return;
  try {
    await _backupEnsureQrGenLib();
    const qr = window.qrcode(0, 'M'); // type 0 = smallest size that fits the data
    qr.addData(code);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    const svg = box.querySelector('svg');
    if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
  } catch (e) {
    box.innerHTML = `<div class="backup-qr-unavailable">QR code unavailable right now — the code above still works.</div>`;
  }
}

/** Renders the manual-code / scan-QR entry UI for the receiving side, replacing the previous prompt()-based flow with something themed and inline. */
function _backupRenderP2PReceiveEntry() {
  const statusEl = document.getElementById('backupP2PStatus');
  statusEl.innerHTML = `
    <div class="backup-receive-entry">
      <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:8px;">Enter the code shown on the sending device, or scan its QR code.</div>
      <div class="backup-receive-row">
        <input type="text" id="backupReceiveCodeInput" class="backup-code-input" maxlength="8" placeholder="CODE" autocapitalize="characters" autocomplete="off" />
        <button class="stats-open-btn" id="backupReceiveConnectBtn" type="button">▶️ Connect</button>
        <button class="stats-open-btn" id="backupReceiveScanBtn" type="button">📷 Scan QR</button>
      </div>
      <div id="backupScanArea"></div>
    </div>`;

  const codeInput = document.getElementById('backupReceiveCodeInput');
  const goConnect = () => {
    const code = codeInput.value.trim();
    if (code) _backupRunP2PReceive(code);
  };
  document.getElementById('backupReceiveConnectBtn').onclick = goConnect;
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goConnect(); });
  document.getElementById('backupReceiveScanBtn').onclick = () => _backupStartQrScan();
}

let _backupScanStream = null;
let _backupScanRAF = null;

/** Opens the camera and scans for a QR code, filling the code field and starting the transfer automatically the moment one's found. Manual entry above is untouched and always available as a fallback. */
async function _backupStartQrScan() {
  const area = document.getElementById('backupScanArea');
  if (!area) return;
  area.innerHTML = `
    <div class="backup-scan-box">
      <div class="backup-scan-video-wrap">
        <video id="backupScanVideo" class="backup-scan-video" playsinline muted></video>
        <div class="backup-scan-frame"></div>
      </div>
      <div class="backup-scan-hint">Point the camera at the QR code shown on the other device.</div>
      <button class="stats-open-btn backup-cancel-btn" id="backupScanCancelBtn" type="button">✖️ Cancel scan</button>
    </div>`;
  document.getElementById('backupScanCancelBtn').onclick = () => _backupStopQrScan();

  try {
    await _backupEnsureQrScanLib();
    _backupScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    area.innerHTML = `<div class="backup-scan-error">❌ Couldn't access the camera (${escapeHtml(e.message || String(e))}) — type the code above instead.</div>`;
    return;
  }

  const video = document.getElementById('backupScanVideo');
  if (!video) { _backupStopQrScan(); return; } // area got rebuilt/closed mid-setup
  video.srcObject = _backupScanStream;
  await video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = () => {
    if (!_backupScanStream) return; // scan was cancelled or already matched
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(frame.data, frame.width, frame.height);
      if (found && found.data) {
        const code = found.data.trim();
        _backupStopQrScan();
        const input = document.getElementById('backupReceiveCodeInput');
        if (input) input.value = code.toUpperCase();
        _backupRunP2PReceive(code);
        return;
      }
    }
    _backupScanRAF = requestAnimationFrame(tick);
  };
  _backupScanRAF = requestAnimationFrame(tick);
}

/** Stops the camera + scan loop and clears the scan area, if either is active. Safe to call any time, including when nothing is running. */
function _backupStopQrScan() {
  if (_backupScanRAF) { cancelAnimationFrame(_backupScanRAF); _backupScanRAF = null; }
  if (_backupScanStream) { _backupScanStream.getTracks().forEach(t => t.stop()); _backupScanStream = null; }
  const area = document.getElementById('backupScanArea');
  if (area) area.innerHTML = '';
}

/** Runs the actual P2P receive connection + import for a given code (typed or scanned), shared by both entry points. */
async function _backupRunP2PReceive(code) {
  const statusEl = document.getElementById('backupP2PStatus');
  _backupStopQrScan(); // camera's done its job once we have a code
  statusEl.innerHTML = _backupProgressHTML('Connecting…');
  try {
    const { startReceive } = await import('./p2p-transfer.js');
    const payload = await startReceive(code.trim().toUpperCase(), (status) => {
      const messages = { 'looking-for-sender': 'Looking for the other device…', connecting: 'Connecting…' };
      statusEl.innerHTML = _backupProgressHTML(messages[status] || status);
    });

    const choice = await _backupConfirmImportFlow(payload, statusEl);
    if (!choice.proceed) { statusEl.innerHTML = ''; return; }

    statusEl.innerHTML = _backupProgressHTML('Importing…');
    const { applyImportPayload } = await import('./local-store.js');
    const result = await applyImportPayload(payload, choice);
    await _backupRefreshAfterImport();
    statusEl.innerHTML = _backupResultHTML(true, `Received: ${result.quizzes.added} quiz(zes) added, ${result.attempts.added} stats entries added.`);
    setTimeout(() => renderBackupTransferModal(), 1800);
  } catch (e) {
    statusEl.innerHTML = _backupResultHTML(false, `${escapeHtml(e.message || String(e))} — you can always use Export/Import instead.`);
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
