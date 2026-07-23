/* ══════════════════════════════════════════════════════════
   GEMINI FILE UPLOADS — no size cap of our own.
   Small files are sent inline as base64 (one request, no extra
   round trip). Anything too big for a single inline request is
   streamed straight to Google's Files API instead and referenced
   by URI — the bytes are sent directly from the File/Blob, so a
   large file never has to be fully base64-encoded in memory first.
   The only real ceiling left is the one the Gemini API itself
   enforces (2GB per file — included on the free tier), so this app
   no longer imposes anything smaller on top of that.
══════════════════════════════════════════════════════════ */
const GEMINI_MAX_FILE_BYTES         = 2 * 1024 * 1024 * 1024; // Gemini Files API hard limit, per file (free tier included)
const GEMINI_INLINE_THRESHOLD_BYTES = 15 * 1024 * 1024;       // stay safely under Gemini's ~20MB inline request cap once base64 (~33%) overhead is added

/* Parses a JSON array returned by Gemini, and — if generation was cut off
   partway through (hit maxOutputTokens, so the JSON is syntactically
   incomplete) — salvages every fully-formed element instead of discarding
   the whole response. Without this, one truncated response used to throw
   away ALL items already generated (a whole file's worth of questions, or
   every choice already written), not just the one that got cut off.

   Returns { data, truncated }:
     - data:      the parsed array (possibly shorter than what the model
                   intended to return), or null if nothing usable was found.
     - truncated: true if repair kicked in, so callers can flag the result
                   as MAX_TOKENS-affected even when the API's own
                   `finishReason` was missing/wrong.

   Repair strategy: walk the raw text tracking string/escape state and
   bracket depth so we only ever cut at a genuine top-level array-element
   boundary — either a '}' that closes an object element back to depth 1,
   or the closing quote of a bare top-level string element (for arrays of
   strings, e.g. {"choices": [...]}'s inner array) — never inside an
   element's own text, which may itself contain literal '}",' sequences. */
function parseGeminiJsonArray(text) {
  const clean = (text || '').replace(/```json|```/g, '').trim();
  try {
    const data = JSON.parse(clean);
    return { data, truncated: false };
  } catch (_) { /* fall through to repair */ }

  if (!clean.startsWith('[')) return { data: null, truncated: false };

  let depth = 0, inString = false, escaped = false, lastElementEnd = -1;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        if (depth === 1) lastElementEnd = i; // closed a bare top-level string element
      }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 1 && ch === '}') lastElementEnd = i; // closed a top-level object element
    }
  }
  if (lastElementEnd === -1) return { data: null, truncated: true };

  try {
    const data = JSON.parse(clean.slice(0, lastElementEnd + 1) + ']');
    return { data, truncated: true };
  } catch (_) {
    return { data: null, truncated: true };
  }
}

/* Same salvage idea as parseGeminiJsonArray, but for a small JSON OBJECT
   whose one array-valued field got cut off mid-generation — e.g.
   {"choices": ["...", "...", "..."]} from the distractor-writing tools,
   where a small maxOutputTokens budget occasionally isn't quite enough.
   Finds `"<fieldName>":` then locates that field's own '[' ... and runs it
   through the same bracket/string-aware repair used above.

   Returns { data, truncated } where `data` is the recovered array (or null
   if nothing after the field name was complete). */
function parseGeminiJsonObjectArrayField(text, fieldName) {
  const clean = (text || '').replace(/```json|```/g, '').trim();
  const keyMatch = clean.match(new RegExp(`"${fieldName}"\\s*:\\s*\\[`));
  if (!keyMatch) return { data: null, truncated: true };
  const arrayText = clean.slice(keyMatch.index + keyMatch[0].length - 1); // from the '[' onward
  return parseGeminiJsonArray(arrayText);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
  return bytes + 'B';
}

/* Throws a friendly error if a file exceeds Gemini's own per-file limit —
   the only size restriction this app enforces. */
function assertWithinGeminiFileLimit(file) {
  if (file.size > GEMINI_MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API, so it can't be uploaded.`);
  }
}

/* Uploads a file to Gemini's resumable Files API and waits for it to
   finish processing. Returns { mime_type, file_uri }. */
async function uploadFileToGeminiFileAPI(file, apiKey, mimeType) {
  mimeType = mimeType || file.type || 'application/octet-stream';

  const startResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: file.name } })
  });
  if (!startResp.ok) throw new Error(`Google rejected the upload of "${file.name}" — please check your connection and try again.`);
  const uploadUrl = startResp.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error(`Google didn't return an upload URL for "${file.name}" — please try again.`);

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(file.size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: file
  });
  if (!uploadResp.ok) throw new Error(`Uploading "${file.name}" to Google failed — please try again.`);
  const info = await uploadResp.json();
  let fileInfo = info && info.file;
  if (!fileInfo || !fileInfo.uri) throw new Error(`Google didn't return a usable reference for "${file.name}".`);

  // Large PDFs/videos can take a few seconds to finish processing server-side.
  let attempts = 0;
  while (fileInfo.state === 'PROCESSING' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const checkResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}`, {
        headers: { 'x-goog-api-key': apiKey }
      });
      if (checkResp.ok) fileInfo = await checkResp.json();
    } catch (e) {}
    attempts++;
  }
  if (fileInfo.state === 'FAILED') throw new Error(`Google failed to process "${file.name}" — try a different file.`);

  return { mime_type: fileInfo.mimeType || mimeType, file_uri: fileInfo.uri };
}

/* Builds a Gemini request "part" for a file: inline base64 for small files,
   automatic Files-API upload for anything bigger. This is the one place
   that decides inline-vs-upload and enforces Gemini's own size ceiling, so
   every upload path in the app behaves consistently and stays Gemini-only. */
async function buildGeminiFilePart(file, apiKey, mimeTypeOverride) {
  assertWithinGeminiFileLimit(file);
  const mimeType = mimeTypeOverride || file.type || 'application/octet-stream';
  if (file.size <= GEMINI_INLINE_THRESHOLD_BYTES) {
    const base64 = await fileToBase64(file);
    return { inline_data: { mime_type: mimeType, data: base64 } };
  }
  const { mime_type, file_uri } = await uploadFileToGeminiFileAPI(file, apiKey, mimeType);
  return { file_data: { mime_type, file_uri } };
}

const CQ_EXTRACTION_PROMPT = `You are extracting multiple-choice quiz questions from an uploaded document (image or PDF).

STRICT RULES — follow exactly, no exceptions:
1. Extract EVERY single question that appears anywhere in the document. Do not skip, merge, summarize, or leave out any question — even ones that look incomplete, partial, blurry, or unusual.
2. Reproduce each question's text EXACTLY as written in the source — same wording, numbers, punctuation, and even typos. Do NOT correct, rephrase, shorten, translate, or "improve" anything.
3. Reproduce EVERY answer choice EXACTLY as written, in the same order, using the same labels (A, B, C, D, E, ... — convert numeric labels like 1,2,3 to A,B,C). Do not omit, reorder, merge, or reword any choice.
4. If the document indicates which choice is correct (circled, bolded, underlined, highlighted, starred, checked, or listed in a separate answer key), use EXACTLY that choice as the "answer" for that question. Do not second-guess or change a marked answer.
5. If a specific question has NO indicated correct answer anywhere in the document, set its "answer" to the special value "__NO_KEY__". Do NOT guess or infer an answer — use "__NO_KEY__" exactly.
6. Do not invent, add, duplicate, or remove any questions or options that are not present in the source document.
7. For each question, set "has_image" to true if THIS SPECIFIC question is accompanied by an image, diagram, figure, table, chart, graph, X-ray, CT scan, ECG, histology slide, or any other visual element that is part of it. Set it to false otherwise.
8. CASE / VIGNETTE CLUSTERS: sometimes a shared clinical case, patient vignette, scenario, lab panel, or image is presented ONCE and then several questions that follow it all refer back to it (e.g. "A 45-year-old man presents with... Questions 12–15 refer to the scenario above."), without repeating that shared information in each question's own text. Whenever you detect this pattern, structure it as ONE core question plus its dependent questions:
   - Identify the ONE question that is paired with the shared case/vignette/scenario/lab panel/image in the source document — this is the CORE question. Its "question" field MUST include the FULL case/vignette text verbatim (reproduced exactly as written, same as any other question text) followed by that question's own actual question — the case must live IN the core question's own text, never only in a separate field. Set "case_is_core" to true on this question. If the image is part of the case, set "has_image" true on this question.
   - For every OTHER question in the cluster (the dependents), keep its "question" field as ONLY that question's own specific wording — do NOT repeat the shared case text inside it, exactly as the source document itself doesn't repeat it. Set "case_is_core" to false (or omit it) on these.
   - Give every question in the cluster — the core question AND every question that depends on it — the SAME "case_group" string (e.g. "case_1", "case_2", ...). Leave "case_group" empty/omitted for standalone questions that don't share context with any other question.
   - Output the core question immediately followed by its dependent questions, in the same order they appear in the source document.
   - Do not invent a cluster — only use "case_group"/"case_is_core" when the source document actually presents shared context that multiple questions depend on. A cluster always needs exactly one core question — never zero, never more than one.
9. CROSS-PAGE CONTINUATIONS: treat the ENTIRE document as one continuous stream of content — page boundaries are just where the scan/print was cut and carry NO semantic meaning. Never let a page break cause you to drop, truncate, or duplicate anything. In particular:
   - A question's stem, its answer choices, and its indicated correct answer may be split across two (or more) pages — e.g. the stem and choices A–C end at the bottom of one page and choice D plus the answer marking appear at the top of the next, or a question appears on one page with its answer key only in an answer-key section on a different/later page. Always look across the WHOLE document and merge these into a single complete question object. Do not treat "no answer choices found on this page" or "question looks cut off at the page edge" as a reason to drop the question — first search the rest of the document (including the next page and any answer-key section) for the missing pieces before falling back to the "no options" or "__NO_KEY__" handling.
   - Likewise, if an answer-key section (e.g. a list like "12-C, 13-A, 14-B...") appears anywhere in the document — even on a page far from the questions themselves, such as at the very end — match each entry to its corresponding question by number and use it to set "answer", even though the key is physically separated from the question text.
   - A case/vignette cluster (rule 8) can itself span a page break — the shared case text may end one page and the dependent questions continue on the next; keep them in the same cluster and never cut the case text short just because the page changed.
   - Never emit a partial or truncated question just because its remaining text, options, or answer live on a different page. If, after checking the entire document, some piece genuinely cannot be found anywhere, apply rule 5 ("__NO_KEY__") for a missing answer, but still include every option and word of stem text that does exist anywhere in the document — do not drop the question outright.

Return ONLY a JSON array, one object per question, in exactly this format:
[
  {
    "question": "exact question text",
    "options": { "A": "exact choice text", "B": "exact choice text", "C": "exact choice text", "D": "exact choice text" },
    "answer": "A",
    "has_image": false,
    "case_group": "",
    "case_is_core": false
  }
]

The "answer" value must be one of the keys present in that question's "options" object. Output nothing besides this JSON array — no markdown fences, no commentary.`;

const CQ_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      question: { type: 'STRING' },
      options: {
        type: 'OBJECT',
        properties: {
          A: { type: 'STRING' }, B: { type: 'STRING' }, C: { type: 'STRING' }, D: { type: 'STRING' },
          E: { type: 'STRING' }, F: { type: 'STRING' }, G: { type: 'STRING' }, H: { type: 'STRING' },
          I: { type: 'STRING' }, J: { type: 'STRING' }
        }
      },
      answer: { type: 'STRING' },
      has_image: { type: 'BOOLEAN' },
      case_group: { type: 'STRING' },
      case_is_core: { type: 'BOOLEAN' }
    },
    required: ['question', 'options', 'answer']
  }
};

/* ── Shared request pacing (prevents hitting Gemini's free-tier RPM cap) ──
   Google's free tier caps Gemini 2.5 Flash at roughly 10–15 requests per
   minute *per project* (see https://ai.google.dev/gemini-api/docs/rate-limits) —
   and that cap is shared across every request this app makes with a given
   key, no matter which feature fired it.

   Extraction only ever sends one request per uploaded file (usually just a
   couple), so it naturally stays well under that cap. The bulk per-question
   passes — AI Solve, Fill Choices, Refine Questions, whether run from the
   post-extraction pipeline or from an editor's own bulk-tools panel — fire
   one request per question (or per 20-question batch, for Solve) and used
   to only pace themselves internally (250ms, or nothing at all) — nowhere
   near enough spacing, and each loop only knew about its OWN requests, so
   two bulk passes running at once (e.g. one editor's Fill Choices while
   another's Refine is also going) could double up and blow through the cap
   even faster.

   This gate enforces one shared minimum spacing between ANY two Gemini
   requests the app sends, tracked globally rather than per-loop, so every
   caller — bulk or single, extraction or editor — automatically queues
   behind the same pace instead of assuming it has the whole rate budget to
   itself. If your key is on a paid tier (much higher RPM), this constant
   can safely be lowered. */
const GEMINI_MIN_REQUEST_SPACING_MS = 6500; // ≈9 requests/minute — a safe margin under the ~10–15 RPM free-tier cap
let _geminiLastRequestAt = 0;
async function _geminiRateGate(cancelToken) {
  const wait = _geminiLastRequestAt + GEMINI_MIN_REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await cancellableSleep(wait, cancelToken);
  _geminiLastRequestAt = Date.now();
}

/* ── Retry helper: retries indefinitely with exponential back-off (2s, 4s, 8s… capped at 30s).
   Only surfaces an error immediately if it's API-key-related
   (HTTP 400 with API_KEY_INVALID / 401 / 403).

   The API key is sent via the `x-goog-api-key` header (Google's documented
   auth method: https://ai.google.dev/gemini-api/docs/api-key), NOT as a
   `?key=` query parameter. As of mid-2026 Google AI Studio issues new keys
   in the "Auth key" format (prefixed `AQ.`, replacing the old `AIza...`
   "Standard key" format) — Auth keys are unreliable when passed as a query
   parameter (inconsistent 401/403/404 responses depending on the account),
   but work correctly via this header regardless of which key format the
   user has. Every caller must pass `apiKey` in the options object instead
   of appending it to `url` itself. ──────── */
async function callGeminiWithRetry(url, bodyObj, { onRetry, cancelToken, pauseCheck, apiKey } = {}) {
  const KEY_ERRORS = ['API_KEY_INVALID', 'API_KEY_NOT_VALID', 'INVALID_API_KEY',
                      'PERMISSION_DENIED', 'API key not valid'];

  function isKeyError(status, data) {
    if (status === 401 || status === 403) return true;
    const msg = (data && data.error && data.error.message) || '';
    const code = (data && data.error && data.error.code) || 0;
    if (code === 400 && KEY_ERRORS.some(k => msg.includes(k))) return true;
    return false;
  }

  // How many *successive* 429s to tolerate, once a pause has actually been
  // requested, before giving up on reaching the next checkpoint normally
  // and falling back to pausing right here instead of retrying forever.
  // While no pause is requested, 429s are retried exactly as before —
  // this only changes behavior when the user is actively trying to pause.
  const RATE_LIMIT_PAUSE_FALLBACK_THRESHOLD = 20;

  // Wait for a shared slot before this call's very first attempt — retries
  // after a failure already back off exponentially below, so they don't
  // need (and shouldn't get) a second helping of this same delay.
  await _geminiRateGate(cancelToken);
  if (cancelToken && cancelToken.cancelled) {
    const e = new Error('cancelled'); e._cancelled = true; throw e;
  }

  let attempt = 0;
  let consecutive429 = 0;
  while (true) {
    // Check for cancellation before every attempt (including between retries)
    if (cancelToken && cancelToken.cancelled) {
      const e = new Error('cancelled'); e._cancelled = true; throw e;
    }
    attempt++;

    // Real abort — not just "ignore the result once it comes back". Stashing
    // the controller on the token means whoever cancels it (e.g. the user
    // confirming they want to switch API keys mid-request) can call
    // controller.abort() and the actual network request is killed immediately.
    const controller = new AbortController();
    if (cancelToken) cancelToken.controller = controller;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-goog-api-key'] = apiKey;
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: controller.signal
      });
      if (cancelToken) cancelToken.controller = null;
      const data = await resp.json();

      if (!resp.ok) {
        const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
        const err = new Error(msg);
        err._httpStatus = resp.status;
        err._apiData    = data;
        // Always surface key errors immediately — no point retrying
        if (isKeyError(resp.status, data)) throw Object.assign(err, { _keyError: true });

        if (resp.status === 429) {
          consecutive429++;
          if (pauseCheck && pauseCheck() && consecutive429 >= RATE_LIMIT_PAUSE_FALLBACK_THRESHOLD) {
            throw Object.assign(err, { _rateLimitPauseFallback: true });
          }
        } else {
          consecutive429 = 0;
        }

        if (onRetry) onRetry(attempt);
        // Cancellable sleep between retries
        await cancellableSleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000), cancelToken);
        continue;
      }

      // Even on success, honor a cancellation that happened while this request was in flight
      if (cancelToken && cancelToken.cancelled) {
        const e = new Error('cancelled'); e._cancelled = true; throw e;
      }

      return data; // success
    } catch (err) {
      if (cancelToken) cancelToken.controller = null;
      // fetch() rejects with an AbortError the instant controller.abort() is called
      if (err.name === 'AbortError' || (cancelToken && cancelToken.cancelled)) {
        const e = new Error('cancelled'); e._cancelled = true; throw e;
      }
      if (err._keyError || err._cancelled || err._rateLimitPauseFallback) throw err; // propagate immediately
      consecutive429 = 0; // a non-HTTP-429 failure (network error etc.) resets the streak
      if (onRetry) onRetry(attempt);
      await cancellableSleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000), cancelToken);
    }
  }
}

/* Resolves after `ms` OR immediately if cancelToken.cancelled becomes true */
function cancellableSleep(ms, cancelToken) {
  return new Promise(resolve => {
    if (cancelToken && cancelToken.cancelled) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    if (cancelToken) {
      // Poll every 100 ms so cancellation is near-instant even mid-sleep
      const poll = setInterval(() => {
        if (cancelToken.cancelled) { clearTimeout(t); clearInterval(poll); resolve(); }
      }, 100);
      // Also clear the poll when the timer fires naturally
      setTimeout(() => clearInterval(poll), ms + 50);
    }
  });
}

/* ── Load an HTMLImageElement from a data-URL ── */
function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

/* ── Render a single PDF page to a canvas using pdf.js, return dataURL ── */
async function renderPdfPageToDataUrl(base64Data, pageNum) {
  // Lazy-load pdf.js from CDN
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload  = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const pdfLib = window.pdfjsLib;
  const binary = atob(base64Data);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pdf  = await pdfLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(pageNum);
  const scale    = 2;
  const viewport = page.getViewport({ scale });
  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/* ── Ask Gemini for bounding boxes of visual elements for each image-bearing question ── */
/* filePart: a Gemini request part for the source document — either
   { inline_data: {...} } for small files or { file_data: {...} } for large
   ones uploaded via the Files API. Callers build this via buildGeminiFilePart
   so this function works the same regardless of source file size. */
async function getBoundingBoxes(questions, filePart, apiKey) {
  const imageQs = questions.map((q, i) => ({ idx: i, q })).filter(({ q }) => q.has_image);
  if (!imageQs.length) return;

  const descriptions = imageQs.map(({ idx, q }) =>
    `Q${idx + 1}: "${q.question.substring(0, 200)}"`
  ).join('\n');

  const prompt = `You are given a document. For each question below, locate the visual element (image, diagram, figure, table, chart, X-ray, ECG, histology slide, graph, etc.) associated with it.

For each question, return the bounding box of ONLY that visual element on the page where it appears, as normalized coordinates (0.0 to 1.0 relative to the full page width and height). Also return the 1-based page number where the visual element appears.

Questions:
${descriptions}

Return ONLY a JSON array — one entry per question — in exactly this format:
[
  { "q_index": 1, "page": 1, "x": 0.05, "y": 0.10, "w": 0.90, "h": 0.35 }
]

Where:
- q_index matches the Q number above (1-based)
- page is the 1-based page number containing this visual element
- x, y = top-left corner of the bounding box (normalized 0–1)
- w, h = width and height of the bounding box (normalized 0–1)

If you cannot find a visual element for a question, omit that entry from the array.
Output nothing besides the JSON array.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CQ_MODEL}:generateContent`;
  try {
    await _geminiRateGate();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            filePart,
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 }
      })
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const textOut = ((data.candidates || [])[0]?.content?.parts || [])
      .map(p => p.text || '').join('').trim();
    if (!textOut) return;
    const clean = textOut.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return null;
  }
}

/* ── Crop a region from a rendered image using Canvas ── */
async function cropRegionFromDataUrl(pageDataUrl, pageWidth, pageHeight, box) {
  const img = await loadImageFromDataUrl(pageDataUrl);
  const sx = Math.max(0, Math.round(box.x * pageWidth));
  const sy = Math.max(0, Math.round(box.y * pageHeight));
  const sw = Math.min(Math.round(box.w * pageWidth),  pageWidth  - sx);
  const sh = Math.min(Math.round(box.h * pageHeight), pageHeight - sy);
  if (sw <= 0 || sh <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width  = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

/* ── Compress / resize a base64 data URL so it fits well under Firestore's 1 MB doc limit.
   Target: ≤ 800 px on the longest side, JPEG quality 0.82.
   Returns the compressed data URL (always image/jpeg). ── */
async function compressImageDataUrl(dataUrl, maxPx = 800, quality = 0.82) {
  try {
    const img = await loadImageFromDataUrl(dataUrl);
    let { naturalWidth: w, naturalHeight: h } = img;
    if (w > maxPx || h > maxPx) {
      if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
      else        { w = Math.round(w * maxPx / h); h = maxPx; }
    }
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (e) {
    return dataUrl; // fallback: return original if compression fails
  }
}

/* ── Main: extract images from source for all has_image questions ──
   Accepts the File itself (not raw base64) so it can decide, via
   buildGeminiFilePart, whether to send it inline or through Gemini's
   Files API depending on size — this is what makes bounding-box lookups
   work correctly for large PDFs/images, not just the initial extraction.
   An already-built `filePart` can optionally be passed in (e.g. by the
   main extraction call, which builds one anyway) to avoid uploading the
   same large file to the Files API twice. ── */
async function extractImagesForQuestions(questions, file, apiKey, filePart) {
  const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const isPdf = mimeType === 'application/pdf';

  // Step 1: ask Gemini for bounding boxes of all image-bearing questions at once.
  // Reuse a pre-built part when given one; otherwise build it now (inline for
  // small files, Files API upload for large ones — same size ceiling as
  // question extraction, so this never hits Gemini's ~20MB inline cap).
  const part = filePart || await buildGeminiFilePart(file, apiKey, mimeType);
  const boxes = await getBoundingBoxes(questions, part, apiKey);
  if (!boxes || !Array.isArray(boxes) || !boxes.length) return;

  // Build a map: question index (0-based) → box info
  const boxMap = {};
  boxes.forEach(b => {
    if (typeof b.q_index === 'number') {
      boxMap[b.q_index - 1] = b; // convert to 0-based
    }
  });

  // Step 2: render pages and crop. This happens entirely in the browser via
  // Canvas/pdf.js, so it needs the raw bytes locally regardless of file size —
  // that's a local-memory concern, not a Gemini request-size one, so it's
  // read here lazily, only once we know there's actually something to crop.
  const sourceBase64 = await fileToBase64(file);
  const pageCache = {}; // page number → { dataUrl, width, height }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.has_image) continue;
    const box = boxMap[i];
    if (!box) continue;

    try {
      const pageNum = box.page || 1;

      if (!pageCache[pageNum]) {
        if (isPdf) {
          pageCache[pageNum] = await renderPdfPageToDataUrl(sourceBase64, pageNum);
        } else {
          // Single image — treat as page 1
          const img = await loadImageFromDataUrl(`data:${mimeType};base64,${sourceBase64}`);
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          pageCache[pageNum] = {
            dataUrl: canvas.toDataURL('image/png'),
            width: img.naturalWidth,
            height: img.naturalHeight
          };
        }
      }

      const { dataUrl, width, height } = pageCache[pageNum];
      const cropped = await cropRegionFromDataUrl(dataUrl, width, height, box);
      if (cropped) q.image = await compressImageDataUrl(cropped);

    } catch (e) {
      // Skip silently
    }
  }
}

// AI-answer questions that have no key in the PDF
// Source file helpers for AI Answer Mode
function setupSourceDropzone() {
  const dz = document.getElementById('cqSourceDropzone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => {
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over');
  }));
  dz.addEventListener('drop', e => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    files.forEach(acceptSourceFile);
  });
}

function handleCqSourceFileSelect(event) {
  const files = Array.from((event.target && event.target.files) || []);
  files.forEach(acceptSourceFile);
  event.target.value = '';
}

function acceptSourceFile(file) {
  const isPdf   = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');

  if (!isPdf && !isImage) {
    alert(`"${file.name}" isn't an image or PDF — please upload an image (JPG/PNG/WEBP) or a PDF file.`);
    return;
  }
  if (file.size > GEMINI_MAX_FILE_BYTES) {
    alert(`"${file.name}" is ${formatBytes(file.size)} — that's over Google's ${formatBytes(GEMINI_MAX_FILE_BYTES)} per-file limit for the Gemini API, so it can't be used.`);
    return;
  }
  const mimeType = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');
  cqAiSourceFiles.push({ file, mimeType, name: file.name });
  renderCustomQuizModal();
}

function cqRemoveSourceFile(idx) {
  cqAiSourceFiles.splice(idx, 1);
  renderCustomQuizModal();
}

// General-purpose AI solver: solves questions at given indices using Gemini.
// targetIdxs: array of question indices to solve (can be no-key or keyed questions)
// sourceText: optional reference text
// sourceFiles: optional array of {file, mimeType, name}
// onlyIfNoKey: if true, only process questions with no_answer_key (legacy behaviour)
async function cqAiSolveQuestions(questions, targetIdxs, sourceText, sourceFiles, statusEl, cancelToken) {
  if (!targetIdxs || !targetIdxs.length) return;

  let apiKey = getGeminiKey();
  if (!apiKey) { console.warn('cqAiSolveQuestions: no Gemini API key'); return; }

  const hasSource = (sourceText && sourceText.trim()) || (sourceFiles && sourceFiles.length > 0);

  const systemInstruction = hasSource
    ? 'You are a medical/academic expert. Reference source material is provided (text and/or images/PDFs). ' +
      'For each question, answer based on the source. ' +
      'If the answer is clearly found in the source, set found_in_source to true; otherwise set it to false and use your own knowledge. ' +
      'Some questions may include an image — analyse it carefully. ' +
      'Respond ONLY with a JSON array.'
    : 'You are a medical/academic expert. Answer each question using your expert knowledge. ' +
      'Since no source is provided, set found_in_source to false for all. ' +
      'Some questions may include an image — analyse it carefully. ' +
      'Respond ONLY with a JSON array.';

  // Build source parts (shared across all chunks)
  const sourceParts = [];
  if (sourceText && sourceText.trim()) {
    sourceParts.push({ text: '## Reference Source Material (Text)\n' + sourceText.trim() + '\n\n---\n' });
  }
  if (sourceFiles && sourceFiles.length > 0) {
    sourceParts.push({ text: '## Reference Source Material (Images/PDFs):' });
    for (let sfi = 0; sfi < sourceFiles.length; sfi++) {
      const sf = sourceFiles[sfi];
      sourceParts.push({ text: 'Source file ' + (sfi + 1) + ' (' + sf.name + '):' });
      sourceParts.push(await buildGeminiFilePart(sf.file, apiKey, sf.mimeType));
    }
    sourceParts.push({ text: '---' });
  }

  const instructionPart = {
    text: 'For each question below, determine the correct answer letter. ' +
          'Respond ONLY with a JSON array (one object per question, same order) with keys:\n' +
          '  "index": the number inside [index:N]\n' +
          '  "answer": the correct option letter (e.g. "A")\n' +
          '  "found_in_source": true if the answer was clearly found in the provided source material, false if you used your own knowledge\n' +
          'No explanation, no preamble, no markdown.'
  };

  // Chunk into batches of 20 to stay well within token limits
  const CHUNK_SIZE = 20;
  const chunks = [];
  for (let i = 0; i < targetIdxs.length; i += CHUNK_SIZE) {
    chunks.push(targetIdxs.slice(i, i + CHUNK_SIZE));
  }

  let totalSolved = 0;
  const errors = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    if (cancelToken && cancelToken.cancelled) break;
    // Safe checkpoint between batches — lets the user pause and switch keys
    // without losing any batches already solved.
    apiKey = (await cqCheckPause(statusEl)) || apiKey;
    if (cancelToken && cancelToken.cancelled) break;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CQ_MODEL}:generateContent`;

    const chunk = chunks[ci];

    if (statusEl) {
      const label = chunks.length > 1
        ? `🤖 AI is solving questions… (batch ${ci + 1} of ${chunks.length})`
        : `🤖 AI is solving ${chunk.length} question${chunk.length !== 1 ? 's' : ''}…`;
      statusEl.innerHTML = _cqProgressStatusHTML(label, (ci / chunks.length) * 100);
    }

    const parts = [...sourceParts, instructionPart];

    chunk.forEach((qi, serial) => {
      const q = questions[qi];
      const opts = Object.entries(q.options).map(([k, v]) => '  ' + k + '. ' + v).join('\n');
      let qText = 'Question ' + (serial + 1) + ' [index:' + qi + ']:\n';
      qText += _cqCaseContextBlock(questions, q);
      qText += q.question + '\n' + opts;
      parts.push({ text: qText });
      const imgForThis = q.image || _cqFindCaseGroupImage(questions, q);
      if (imgForThis) {
        const match = imgForThis.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({ text: '(Image for question ' + (serial + 1) + ':)' });
          parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
        }
      }
    });

    try {
      const data = await callGeminiWithRetry(url, {
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8192 }
      }, { pauseCheck: () => cqPauseRequested, cancelToken: cancelToken, apiKey });

      const textOut = ((data.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('');
      const cleanText = textOut.replace(/```json|```/g, '').trim();

      const { data: answers, truncated } = parseGeminiJsonArray(cleanText);
      if (!answers) {
        errors.push(`Batch ${ci + 1}: Could not parse AI response (response may have been truncated).`);
        continue;
      }
      if (truncated) {
        errors.push(`Batch ${ci + 1}: response was cut off partway through — recovered ${answers.length} answer${answers.length !== 1 ? 's' : ''} from it; the rest of this batch may need re-running.`);
      }

      if (Array.isArray(answers)) {
        answers.forEach(item => {
          const qi = item.index;
          const ans = (item.answer || '').trim().toUpperCase();
          if (questions[qi] !== undefined && questions[qi].options && questions[qi].options[ans]) {
            questions[qi].answer      = ans;
            questions[qi].ai_answered = true;
            questions[qi].ai_guessed  = !item.found_in_source;
            totalSolved++;
          }
        });
      } else {
        errors.push(`Batch ${ci + 1}: AI returned unexpected format (not an array).`);
      }
    } catch (e) {
      if (e._cancelled) {
        // User clicked "pause now" instead of waiting for this batch to
        // finish — step back to the last completed checkpoint (before this
        // batch) instead of losing the whole run. A plain Stop leaves
        // cqPauseSkipRequested false, so it still just breaks as before.
        if (typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested) {
          cqPauseSkipRequested = false;
          cqCancelToken = { cancelled: false }; // old token is permanently cancelled — start fresh
          cancelToken = cqCancelToken;
          apiKey = (await _cqEnterPause(statusEl,
            `⏸️ Paused — stepped back to before ${chunks.length > 1 ? `batch ${ci + 1} of ${chunks.length}` : 'this batch'} so nothing already done is lost. Open 🔑 Manage APIs to switch keys, then press ▶️ Resume to continue.`)) || apiKey;
          ci--; // retry this same batch once resumed
          continue;
        }
        break; // user stopped — not an error, just stop here
      }
      if (e._rateLimitPauseFallback) {
        apiKey = await cqFallbackPauseForRateLimit(statusEl, chunks.length > 1 ? `batch ${ci + 1} of ${chunks.length}` : null);
        ci--; // retry this same batch (not counted as an error) once resumed
        continue;
      }
      console.warn('cqAiSolveQuestions batch ' + (ci + 1) + ' failed:', e);
      errors.push(`Batch ${ci + 1}: ${e.message || String(e)}`);
    }
  }

  // Surface any errors to the user
  if (errors.length > 0 && statusEl) {
    const errHtml = errors.map(err => `<div>⚠️ ${escapeHtml(err)}</div>`).join('');
    statusEl.insertAdjacentHTML('beforeend',
      `<div class="cq-status warning" style="margin-top:6px;">
        🤖 AI Solve encountered issues — ${totalSolved} question${totalSolved !== 1 ? 's' : ''} solved successfully:<br>${errHtml}
      </div>`
    );
  }
}

// Backward-compat wrapper used in the extraction flow for no-key questions
async function cqAiAnswerMissingKeys(questions, sourceText, sourceFiles, statusEl, cancelToken) {
  const noKeyIdxs = questions.map((q, i) => q.no_answer_key ? i : -1).filter(i => i >= 0);
  await cqAiSolveQuestions(questions, noKeyIdxs, sourceText, sourceFiles, statusEl, cancelToken);
}

/* ── Post-extraction bulk pass: Fill Choices ──
   Tops every extracted question up to 4 answer choices (same rules as the
   single-question "🧩 Fill Choices (AI)" tool: only adds missing distractors,
   never touches which option is marked correct). Runs strictly one question
   at a time — never in parallel with itself or with the refine pass — since
   both this and Refine Questions mutate the same question objects, and the
   whole point of running them sequentially is to avoid that exact race. */
async function cqBulkFillChoices(questions, statusEl, cancelToken) {
  const idxs = questions.map((q, i) => i).filter(i => {
    const q = questions[i];
    return q && q.question && q.question.trim() && getOptionEntries(q).length < 4;
  });
  if (!idxs.length) return { done: 0, errors: [] };

  let apiKey = getActiveApiKey();
  if (!apiKey) return { done: 0, errors: ['No active API key.'] };

  let done = 0;
  const errors = [];
  for (let n = 0; n < idxs.length; n++) {
    if (cancelToken && cancelToken.cancelled) break;
    apiKey = (await cqCheckPause(statusEl)) || apiKey;
    if (cancelToken && cancelToken.cancelled) break;
    const qi = idxs[n];
    const q = questions[qi];
    if (statusEl) {
      statusEl.innerHTML = _cqProgressStatusHTML(
        `🧩 Filling choices… (${n + 1} of ${idxs.length})`, (n / idxs.length) * 100);
    }
    try {
      const optEntries = getOptionEntries(q);
      const usedKeys = optEntries.map(([k]) => k);
      const missing = _AI_TOOLS_ALL_KEYS.filter(k => !usedKeys.includes(k)).slice(0, Math.max(0, 4 - optEntries.length));
      if (!missing.length) continue;
      const answerBefore = q.answer;
      const newVals = await _aiGenerateDistractors(apiKey, questions, q, optEntries, missing.length, cancelToken, 'fillBulk');
      if (!q.optionsOrder) q.optionsOrder = optEntries.map(([k, v]) => ({ key: k, value: v }));
      missing.forEach((key, idx) => {
        const val = newVals[idx] || '';
        q.options[key] = val;
        q.optionsOrder.push({ key, value: val });
      });
      q.answer = answerBefore; // never change which choice is correct
      done++;
    } catch (e) {
      if (e._cancelled) {
        // User clicked "pause now" instead of waiting for this question to
        // finish — step back to the last completed checkpoint instead of
        // losing the whole run. A plain Stop leaves cqPauseSkipRequested
        // false, so it still just breaks as before.
        if (typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested) {
          cqPauseSkipRequested = false;
          cqCancelToken = { cancelled: false }; // old token is permanently cancelled — start fresh
          cancelToken = cqCancelToken;
          apiKey = (await _cqEnterPause(statusEl,
            `⏸️ Paused — stepped back to before question ${n + 1} of ${idxs.length} so nothing already done is lost. Open 🔑 Manage APIs to switch keys, then press ▶️ Resume to continue.`)) || apiKey;
          n--; // retry this same question once resumed
          continue;
        }
        break; // user stopped — not an error, just stop here
      }
      if (e._rateLimitPauseFallback) {
        apiKey = await cqFallbackPauseForRateLimit(statusEl, `question ${n + 1} of ${idxs.length}`);
        n--; // retry this same question once resumed
        continue;
      }
      errors.push(`Question ${qi + 1}: ${e.message || String(e)}`);
    }
    // No fixed sleep here anymore — _geminiRateGate() inside callGeminiWithRetry
    // already paces every request centrally, shared across every bulk/single
    // AI call in the app, not just this loop.
  }
  return { done, errors };
}

/* ── Post-extraction bulk pass: Refine Questions ──
   Rewrites every extracted question's stem into clean exam-style phrasing
   (same rules/prompt as the single-question "🪄 Refine Question" tool),
   optionally guided by a shared custom-instructions box. Also strictly
   one-at-a-time — see note above cqBulkFillChoices. */
async function cqBulkRefineQuestions(questions, customInstructions, statusEl, cancelToken) {
  const idxs = questions.map((q, i) => i).filter(i => questions[i] && questions[i].question && questions[i].question.trim());
  if (!idxs.length) return { done: 0, errors: [] };

  let apiKey = getActiveApiKey();
  if (!apiKey) return { done: 0, errors: ['No active API key.'] };

  const custom = (customInstructions || '').trim();
  let done = 0;
  const errors = [];
  for (let n = 0; n < idxs.length; n++) {
    if (cancelToken && cancelToken.cancelled) break;
    apiKey = (await cqCheckPause(statusEl)) || apiKey;
    if (cancelToken && cancelToken.cancelled) break;
    const qi = idxs[n];
    const q = questions[qi];
    if (statusEl) {
      statusEl.innerHTML = _cqProgressStatusHTML(
        `🪄 Refining question wording… (${n + 1} of ${idxs.length})`, (n / idxs.length) * 100);
    }
    try {
      q.question = await _aiRefineQuestionCall(apiKey, questions, q, custom, cancelToken, 'refineBulk');
      done++;
    } catch (e) {
      if (e._cancelled) {
        // User clicked "pause now" instead of waiting for this question to
        // finish — step back to the last completed checkpoint instead of
        // losing the whole run. A plain Stop leaves cqPauseSkipRequested
        // false, so it still just breaks as before.
        if (typeof cqPauseSkipRequested !== 'undefined' && cqPauseSkipRequested) {
          cqPauseSkipRequested = false;
          cqCancelToken = { cancelled: false }; // old token is permanently cancelled — start fresh
          cancelToken = cqCancelToken;
          apiKey = (await _cqEnterPause(statusEl,
            `⏸️ Paused — stepped back to before question ${n + 1} of ${idxs.length} so nothing already done is lost. Open 🔑 Manage APIs to switch keys, then press ▶️ Resume to continue.`)) || apiKey;
          n--; // retry this same question once resumed
          continue;
        }
        break; // user stopped — not an error, just stop here
      }
      if (e._rateLimitPauseFallback) {
        apiKey = await cqFallbackPauseForRateLimit(statusEl, `question ${n + 1} of ${idxs.length}`);
        n--; // retry this same question once resumed
        continue;
      }
      errors.push(`Question ${qi + 1}: ${e.message || String(e)}`);
    }
    // No fixed sleep here anymore — _geminiRateGate() inside callGeminiWithRetry
    // already paces every request centrally, shared across every bulk/single
    // AI call in the app, not just this loop.
  }
  return { done, errors };
}

