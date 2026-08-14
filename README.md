# ANU MSP Question Bank

A free, community-driven MCQ practice platform built for ANU MSP students —
browse the official curriculum by year/module/subject/lecture, take timed
quizzes, track your stats, and build or share your own quizzes. Admins can
publish official question sets and use built-in AI tools (Google Gemini) to
extract questions from lecture slides, generate new ones, auto-answer, and
write explanations.

It's a single-page app: no backend server, no build step. Firebase
(Auth + Firestore) handles accounts, data storage, and syncing; everything
else is plain HTML/CSS/JavaScript.

> Open source and free to fork. See [Getting started](#getting-started) to
> stand up your own copy with your own Firebase project.

## Features

- **Curriculum browser** — Year → Module → Subject → Lecture, with a
  timed quiz mode, question navigator, flagging, and a results screen.
- **Persistent statistics** — local, per-device history (IndexedDB, see
  [Project structure](#project-structure) → `local-store.js`), with a
  dynamic Year → Module → Subject breakdown, a drill-down flowchart, and
  per-subject "toggle menu" quiz-title lists — see changelog **#83**.
- **Custom quizzes** — write your own, or generate one from pasted MCQs
  or lecture material using Gemini.
  - **Collections** — organize your custom quizzes into folders, nested
    to any depth (a folder inside a folder inside a folder, etc). Drag a
    quiz card onto a folder in the sidebar to file it, or use its 📁 Move
    button/the bulk "Move to…" action for a non-drag alternative; drag
    folders themselves onto each other to re-nest or reorder them. See
    changelog **#85**. The same folder browser is also available to
    admins in the "📤 Publish Quizzes" tab's "🤖 My Custom Quizzes" source
    picker, so publishing into the curriculum can be filtered by folder
    too — see changelog **#98**.
- **Community quizzes** — browse, take, and share quizzes made by other
  students; merge questions from one quiz into another.
- **Backup & Transfer** — export your custom quizzes/stats to a JSON file
  (and re-import it anywhere), or **export a designed PDF study booklet**
  from any mix of curriculum lectures, community quizzes, and your own
  custom quizzes — cover page, book-style chapters, resizable text/images,
  a colour theme, questions only (no answers shown), and a full answer key
  at the end. See changelog **#100**.
- **AI tools** (Gemini, bring-your-own API key) — extract questions from
  slides/PDFs, generate new questions, auto-answer, refine question
  wording, fill in missing choices, and produce step-by-step explanations
  or a per-question AI chat.
  - **🤖 Ask AI** — on the results screen, next to Explain and Chat, a
    dropdown lets you send the question (plus any AI explanation or chat
    already generated for it) to ChatGPT, Claude, Gemini, Perplexity,
    DeepSeek, Grok, or "copy for another AI" — opening the real site in a
    new tab so you continue in your own account, no API key of ours
    needed. See changelog **#110**.
  - **Smart multi-key rotation** — add more than one Gemini API key and
    the app automatically rotates between them whenever one gets rate
    limited, with no interruption to whatever's currently running. See
    [Smart API key rotation](#smart-api-key-rotation) below for the full
    behavior.
  - Extraction/generation runs (⏸️ Pause / ▶️ Resume / ⏹ Stop) cover the
    whole pipeline — extraction, AI answering, Fill Choices, and Refine
    Questions all share one cancel token, so ⏹ Stop aborts whichever of
    those is currently running, immediately, not just at the next
    checkpoint. While ⏸️ Pause is waiting for its next natural checkpoint
    (between files/batches/questions), a "⏭️ pause now" option lets you
    skip that wait and step back to the last completed checkpoint instead
    — the in-progress file/batch/question is simply retried once you
    press ▶️ Resume, nothing already done is lost.
  - ⏸️ Pause / ▶️ Resume / ⏹ Stop, live progress, and per-question/bulk
    AI-tool status all keep displaying correctly even if the surrounding
    modal or editor gets re-rendered while they're mid-run — e.g. opening
    🔑 Manage APIs and switching keys without stopping the run first. See
    `js/dom-utils.js` for how.
  - Every Gemini request the app makes — extraction, AI Solve, Fill
    Choices, Refine Questions, explanations, chat — shares one global
    pacing clock (`GEMINI_MIN_REQUEST_SPACING_MS` in `gemini-uploads.js`),
    so the app self-throttles under Google's free-tier rate cap (~10–15
    requests/minute per project) even when several bulk tools are running
    at once across different editors. If your key is on a paid tier with
    a much higher limit, that constant can be safely lowered.
  - Extraction sends the whole source PDF to Gemini in a single request
    (not split page-by-page), and the extraction prompt (`CQ_EXTRACTION_PROMPT`
    in `gemini-uploads.js`) explicitly instructs the model to treat page
    breaks as non-semantic — so a question's stem, choices, or marked
    answer that spans two pages (or an answer-key section that's separated
    from its questions) gets merged into one complete question instead of
    being truncated or dropped.
  - Extraction and lecture-based generation both constrain Gemini's output
    with an explicit `responseSchema` (`CQ_RESPONSE_SCHEMA` in
    `gemini-uploads.js`), on top of `responseMimeType: 'application/json'` —
    this makes the model far less likely to drift from the expected
    question/options/answer shape in the first place.
  - If a response is still cut off mid-array despite that (a very large
    document that runs past the model's own output-token cap), the app no
    longer discards the whole file's results: `parseGeminiJsonArray`
    (`gemini-uploads.js`) walks the raw JSON tracking string/bracket state and
    recovers every fully-formed question up to the cut-off point. The review
    screen is flagged with a ⚠️ naming the specific file(s) that were cut
    off, so you know exactly what to check and which file to consider
    splitting. This applies to extraction, lecture-based generation, and
    bulk AI-answering alike.
  - The single-question AI tools (🪄 Refine Question, 🧩 Fill Choices,
    ➕ Add Choice — in `ai-question-tools.js`) had the same truncation
    problem on a smaller scale: their own small per-question token budget
    could occasionally cut a response off mid-JSON, and the raw
    `JSON.parse` error (e.g. "Unterminated string in JSON at position…")
    used to be shown to the user verbatim. `_aiToolsParseJSON` now always
    throws a clear, actionable message instead, and Fill Choices/Add
    Choice additionally salvage any already-complete distractor choices
    via `parseGeminiJsonObjectArrayField` rather than failing the whole
    request over one trailing partial choice. Token budgets for both tools
    were also raised (1024 → 2048) as extra headroom.
  - The actual root cause of that truncation: Gemini 2.5 Flash reasons
    ("thinks") by default before writing its answer, and those thinking
    tokens are drawn from the *same* `maxOutputTokens` budget as the
    visible response — with the budget dynamic and unpredictable per
    request, it could occasionally consume most of a small budget and
    leave too little for the actual JSON, truncating it. Both calls now
    set `thinkingConfig: { thinkingBudget: 0 }` (Refine Question and the
    shared distractor generator behind Fill Choices/Add Choice) — these
    are short, deterministic rewrite/generation tasks that don't need a
    reasoning pass, so disabling it reclaims the whole budget for the
    real answer and is faster too. (Extraction and lecture-generation
    keep thinking enabled, since their much larger 65536-token budget and
    genuinely harder task — parsing a whole document's worth of questions
    — benefit more from it.)
  - Thinking is opt-in per tool: a small 🧠 Thinking pill-checkbox now sits
    beside 🪄 Refine Question, 🧩 Fill Choices, and ➕ Add Choice on every
    question card, and beside their bulk counterparts (🧩 Fill Choices
    (All) / 🪄 Refine Questions (All), in both the post-extraction settings
    panel and every editor's "Whole Quiz" AI tools panel — Admin, Custom
    Quiz, and the extraction preview itself. These are **five
    completely independent switches** — `refineSingle`, `fillSingle`,
    `addChoice`, `fillBulk`, `refineBulk` — persisted in `localStorage`
    (`aiToolsThinkingSettings`). Turning bulk Fill Choices on has no effect
    on the per-question Fill Choices button, or on Add Choice, or on
    Refine, and vice versa; every checkbox for the same tool (a
    per-question tool's checkbox is duplicated on every question card)
    stays in sync with that one shared value, without touching any other
    tool's setting. See `_aiToolsGenConfigExtra` / `_aiToolsSetThinking` /
    `_renderAiThinkingToggle` in `ai-question-tools.js`. Off remains the
    default for all five, matching the behaviour above; switching one on
    lets Gemini's default reasoning pass run for that tool, trading some
    speed/cost for a chance at higher-quality output. Each pill is nested
    directly against its own trigger button (in its own tight flex group,
    separate from that row's ⏹ Stop button) and color-matched to it —
    violet for Refine, amber for Fill Choices, green for Add Choice — so
    it's visually unambiguous which checkbox controls which tool even when
    several buttons sit close together on the same row. Every row (and each
    button+toggle group within it) uses `flex-wrap: wrap`, so on narrow/
    mobile screens a whole cluster drops to its own line — or, in the
    worst case, the toggle drops directly under its own button — instead of
    ever forcing the row to scroll sideways; a `max-width: 480px` rule
    also shrinks the pill itself to match the app's existing small-screen
    sizing for other AI-tool controls.
  - **🔁 Re-extract Image** — on the post-extraction review screen, any
    question with an embedded image gets a Re-extract Image button next to
    🔄 Change Image, so a bad auto-crop (wrong region, too tight/wide, wrong
    page) can be fixed by asking Gemini to try again against the original
    source file instead of only being fixable by a manual re-upload. Its
    own ⚙️ Instructions caret opens a small popover (same button+caret+
    popover shape as 🪄 Refine Question's) for an optional correction —
    e.g. "widen the frame, it's cutting off the left edge" or "wrong
    position, it's actually the graph on the next page" — which gets
    appended to the bounding-box prompt (`getBoundingBoxes` in
    `gemini-uploads.js`) and takes priority over the model's own judgement.
    It's only shown for questions that still have a traceable source file
    (`q._sourceFile`) and aren't `_notExtractable` (hand-typed questions,
    or ones merged in from another quiz — see `_mergeCloneQuestions` in
    `community-quizzes.js` — have nothing to re-extract against). It
    appears in **both** image states a question can be in: once an image
    has already been cropped (to try a better one), and — just as
    importantly — while the question is still showing "⚠️ AI detected an
    image for this question but couldn't extract it" (previously the only
    way to resolve that state was a manual upload; the button and its
    `_reextractControlsHTML`/`_reextractExtrasHTML` markup are now shared
    between both branches in `renderCQPreview`, `ai-solve.js`, rather than
    only being built inside the has-image branch). It shares
    the same per-question busy lock as Refine/Solve/Fill Choices/Add Choice
    (`_aiToolsSetBusy('cq', i, …)` in `ai-question-tools.js`), so it can't
    run at the same time as another AI tool mutating that question, and
    reuses the exact same extraction engine as the initial bulk pass
    (`extractImagesForQuestions`/`getBoundingBoxes`), including its
    `temperature: 0` and shared fallback-model handling — a miss (image
    still not found) is treated as best-effort, same as the first pass,
    and just leaves a message suggesting a correction or a manual upload
    instead of failing loudly. Like every other single-question AI tool on
    this card, it shows a spinner on its own button while running and gets
    a real ⏹ Stop button, backed by the same `cancelToken`/`AbortController`
    plumbing `callGeminiWithRetry` already used elsewhere, so Stop
    immediately aborts the in-flight request rather than just hiding the
    busy state while it keeps running unseen. It also counts toward the
    app's unsaved-progress guard
    (`_hasUnsavedProgress` in `app-core.js`, via the shared `_aiToolsBusy`
    lock it already uses) — closing or navigating away from the tab while a
    re-extract is in flight prompts the browser's native "leave site?"
    confirmation, same as every other in-flight AI action.
  - **"Whole Quiz" AI Tools panel on the extraction preview** — the same
    🤖 AI Solve All / 🧩 Fill Choices (All) / 🪄 Refine Questions (All) panel
    already available on the Admin and Custom Quiz editors (`admin` and
    `customQuiz` in the shared `_caseGroupEditors` registry,
    `ai-features.js`) now also renders above the post-extraction preview
    (`cq`) — in case some questions never got a per-question AI button
    pressed during extraction itself. It's the exact same
    `_renderBulkAiToolsPanel`/`_editorBulkGuard`/`_editorBulkSetBusy`
    machinery, locking the whole preview (every per-question AI button,
    reordering, add/delete/save, merge, split) for the duration of a
    bulk pass, exactly as it already does for the other two editors —
    running any bulk tool here can't race with a per-question tool
    editing the same question, or with another bulk tool in the same
    preview.
  - **🖼️ Re-extract Missing Images (All)** — a fourth bulk tool, shown only
    on the extraction preview's panel, for the "⚠️ AI detected an image for
    this question but couldn't extract it" case (shown per-question when
    `has_image` is true but `image` never got filled in). Rather than
    reopening each such question and clicking 🔁 Re-extract Image one at a
    time, this retries every eligible question in one pass — grouped and
    requested **per source file**, reusing `extractImagesForQuestions`
    exactly as the original extraction pass does (which itself batches
    `GEMINI_BOUNDING_BOX_BATCH_SIZE` image-bearing questions per Gemini
    request). This is deliberately **not** an additive per-question loop
    making one request per image; it's the same file-scoped batching used
    when the quiz was first extracted, just re-run only for whatever's
    still missing. Eligibility matches the single-question control exactly
    (`q._sourceFile` set and not `_notExtractable`) — hand-typed questions
    or ones merged in from another quiz have no source to re-extract
    against, and are called out separately in the result summary rather
    than silently skipped. Shares the same ⏸️ Pause/▶️ Resume/⏹ Stop
    checkpoint machinery as every other bulk pass (`cqCheckPause` /
    `_cqEnterPause` / `cqFallbackPauseForRateLimit`), stepping back one
    file at a time rather than losing the whole run. See
    `cqBulkReextractMissingImages` (`gemini-uploads.js`) and
    `_editorBulkReextractImages` (`ai-features.js`).
  - **Reorder-proof question identity** — every extracted question is
    tagged once, at extraction time, with `_extractedQuestionNumber`: its
    actual position in Gemini's original response for that file (set in
    `_extractQuestionsFromFile`, `ai-solve.js`). The preview lets questions
    be freely reordered, deleted, or merged in alongside another quiz's
    questions afterwards — all of which change where a question sits in
    the live array — but `getBoundingBoxes` and `extractImagesForQuestions`
    (`gemini-uploads.js`) label and look up each question by this fixed
    number instead of its current array position, so Re-extract Image
    always asks about (and correctly places the result back onto) the
    right question no matter how the list has been reshuffled since
    extraction. (Questions without the field — already-saved quizzes from
    before this, or hand-typed ones — fall back to live position, same as
    before.)
  - Freshly extracted/generated questions are validated (question text
    present, 2+ filled options, a valid answer selected) before the initial
    save — the same rule the quiz editor already enforced on every later
    edit (`saveGeneratedCustomQuiz` in `ai-solve.js`, matching
    `saveCustomQuizEdits` in `quiz-editor.js`). Previously a question could
    slip through extraction with only one option and save without
    complaint, only to force you to add a second option the next time you
    opened it for editing; now that's caught immediately on the review
    screen, right after extraction, while it's easy to fix.
- **Admin panel** — publish quizzes into the official bank, manage the
  curriculum tree (years/modules/subjects), manage other admins and their
  permissions, and edit/split/reorder published lectures.
- **Scoped curriculum permissions** — an `admins`-permission holder can
  grant the `curriculum` permission for the whole curriculum, or narrow it
  to specific Year(s), Module(s), or Subject(s) via the same
  click-through Year → Module → Subject picker used elsewhere in the admin
  panel. A scoped admin only sees and can manage quizzes within their
  granted slice; only a whole-curriculum admin can restructure the
  curriculum tree itself (add/rename/delete Years, Modules, Subjects).
  Enforced both client-side and, authoritatively, in `firestore.rules`.
  See [Scoped Curriculum Permissions](#scoped-curriculum-permissions) below.
- **Offline-friendly caching** — curriculum and published questions are
  cached locally and versioned so returning users don't re-fetch
  everything on every visit.

## Tech stack

- Vanilla HTML / CSS / JavaScript (no framework, no bundler)
- [Firebase](https://firebase.google.com/) — Authentication (Google
  sign-in) and Firestore (database)
- [Google Gemini API](https://ai.google.dev/) — optional, powers all AI
  features; each user supplies their own API key, stored locally in
  their browser
- [jsPDF](https://github.com/parallax/jsPDF) — lazy-loaded from cdnjs the
  first time someone actually presses "Generate PDF" in **Export to
  PDF**; nothing is downloaded on page load. See changelog **#100**.

## Project structure

```
anu-msp-question-bank/
├── index.html                    # Page shell — markup for every screen/modal
├── css/
│   └── styles.css                # All styles (design tokens, layout, components)
├── js/
│   ├── config/
│   │   ├── firebase-config.example.js   # Template — copy this file
│   │   └── firebase-config.js           # Your real keys (git-ignored)
│   ├── firebase-init.js          # Firebase SDK bootstrap, auth-state listener
│   ├── intro-animation.js        # One-off splash/intro animation
│   ├── dom-utils.js               # Self-healing live DOM references + status-
│   │                              #   HTML cache, used by any long-running
│   │                              #   background flow (extraction, generation,
│   │                              #   AI tools) so its UI survives the host
│   │                              #   modal/editor being re-rendered mid-run
│   ├── app-core.js               # State, screen navigation, quiz engine
│   │                              #   (timer, render/navigate/mark/submit),
│   │                              #   subject selection, persistent stats
│   ├── ai-features.js            # Gemini API key manager, AI explanations,
│   │                              #   AI chat, AI-generated custom quizzes
│   ├── api-rotation.js           # Smart multi-key rotation engine — tracks
│   │                              #   per-key rate-limit state and decides
│   │                              #   when/where to auto-rotate (see below)
│   ├── ai-question-tools.js      # Refine question / fill choices / add choice
│   ├── ai-solve.js               # Per-question "AI solve" source picker
│   ├── gemini-uploads.js         # Gemini file-upload helpers (images/PDFs)
│   ├── firebase-storage.js       # Firebase Storage helpers for quiz images
│   │                              #   and Statistics wrong-question images
│   ├── split-quiz.js             # Split a long quiz into smaller ones
│   ├── quiz-collections.js       # Nested folder system for custom quizzes —
│   │                              #   tree UI, drag-and-drop, move menus
│   ├── sharing.js                # Share-quiz links + shared quiz image helpers
│   ├── community-quizzes.js      # Browse/merge community-submitted quizzes
│   ├── user-profile.js           # Display name + misc Firestore utilities
│   ├── data-sync.js              # Local cache, published-quiz manifest,
│   │                              #   one-time data migrations
│   ├── content-client.js         # Read-only fetch helpers for published
│   │                              #   curriculum content served from R2
│   ├── migration.js              # One-time move of legacy Firestore-stored
│   │                              #   stats/custom quizzes to local storage
│   ├── local-store.js            # Custom quizzes + nested collections/folders
│   │                              #   + stats/history — all local (IndexedDB),
│   │                              #   never Firestore; export/import payload
│   │                              #   + merge-vs-replace import logic lives here
│   ├── backup-transfer-ui.js     # Backup & Transfer modal: file export/
│   │                              #   import (merge/replace choice, custom
│   │                              #   file name) and the entry point for
│   │                              #   PDF export (see pdf-export.js)
│   ├── pdf-export.js             # 🖨️ Export to PDF — source picker
│   │                              #   (curriculum/community/custom), text/
│   │                              #   image size + colour theme controls,
│   │                              #   live decoy preview, and the jsPDF-
│   │                              #   based generation engine (cover,
│   │                              #   contents, chapters, answer key,
│   │                              #   closing QR page)
│   ├── icon-picker.js            # Icon library + reusable icon-picker widget
│   ├── admin-panel.js            # Publish flow, manage admins, manage
│   │                              #   community submissions
│   ├── admin-curriculum-scope.js # Scoped curriculum-permission model:
│   │                              #   grant a curriculum admin the whole
│   │                              #   curriculum or specific Year/Module/
│   │                              #   Subject(s); the Add-Admin scope picker
│   ├── quiz-editor.js            # Inline editors for published & custom quizzes
│   └── curriculum-admin.js       # Admin curriculum tree management
├── assets/
│   └── qr-code.png               # Site QR code, stamped on the closing
│                                  #   page of every PDF export
├── firestore.rules               # Firestore security rules (owner-only data,
│                                  #   public reads, roster-based admin perms)
├── package.json                  # Convenience scripts for a local dev server
├── .gitignore
└── LICENSE
```

The JavaScript is split by feature area rather than converted into ES
modules — every file (except `firebase-init.js`) still shares one global
scope, exactly like the original single-file app, so no behavior changed
during the split. `firebase-init.js` is the only ES module, since it needs
`import` to load the Firebase SDK and your config.

## Getting started

### 1. Clone and configure Firebase

```bash
git clone https://github.com/YOUR_USERNAME/anu-msp-question-bank.git
cd anu-msp-question-bank
cp js/config/firebase-config.example.js js/config/firebase-config.js
```

Then:

1. Create a project at the [Firebase console](https://console.firebase.google.com).
2. **Authentication** → Sign-in method → enable **Google**.
3. **Firestore Database** → create a database (production mode), then
   paste the contents of [`firestore.rules`](./firestore.rules) into
   the Rules tab. This is the actual ruleset this app runs on — it
   enforces per-user ownership on personal data (stats, custom quizzes,
   profiles), public read access to the published question bank, and a
   roster-based (`curriculum` / `community` / `admins`) permission model
   for everything admin-only — including per-Year/Module/Subject scoping
   for the `curriculum` permission (see
   [Scoped curriculum permissions](#scoped-curriculum-permissions)). If
   you fork this project, update the hardcoded `isSuperAdmin()` email at
   the top to your own account before deploying.
4. **Project settings → General → Your apps** → add a Web app, and copy
   the generated config object into `js/config/firebase-config.js`.

`firebase-config.js` is listed in `.gitignore`, so your keys never get
committed.

### 2. Run it locally

No build step is required — it's static files. Any local web server works,
for example:

```bash
npm run dev
# or: npx serve .
# or: python3 -m http.server 5173
```

Then open the printed local URL in your browser.

### 3. Make yourself an admin

The super-admin email is checked in **two places**, and both must match:

- `js/app-core.js` — the `SUPER_ADMIN_EMAIL` constant (client-side UI gating)
- `firestore.rules` — the `isSuperAdmin()` function (server-side enforcement)

Update both to your own Google account email before deploying. That
account will always have full admin permissions (publishing quizzes,
managing the curriculum, and managing other admins) and can grant
permissions to other accounts from the in-app **Admin Panel** afterward.
Non-super admins get their permissions from the `appConfig/adminRoster`
Firestore document, which the Admin Panel manages for you.

### 4. (Optional) Add your own Gemini API key

AI features are opt-in per user — each person adds their own key from
the app's **Manage APIs** button (Google AI Studio issues free keys at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Nothing
AI-related is required for the core quiz/browsing experience to work.

> **Note on key formats:** since mid-2026 Google AI Studio issues new Gemini
> keys as "Auth keys" (prefixed `AQ.`, replacing the older `AIza...`
> "Standard key" format — see [Google's key docs](https://ai.google.dev/gemini-api/docs/api-key)).
> Both formats work with this app: every Gemini request sends the key via
> the `x-goog-api-key` HTTP header (Google's documented method) rather than
> the old `?key=` URL parameter, which is unreliable for Auth keys.

> **Note on the Gemini model used:** the app targets one model, configured
> in a single place — `GEMINI_PRIMARY_MODEL` in `js/gemini-uploads.js`
> (currently `gemini-2.5-flash`). Every AI feature (extraction, AI Solve,
> chat, explain, bulk tools, bounding-box detection) builds its request
> through the shared `geminiEndpoint()` helper in that file, so there's
> only one constant to change if you ever want to switch models.
>
> If Google renames or retires that model for a given account, requests
> come back as either `404 Not Found` or `400 Bad Request` (which one
> depends on the account and API version) — the app treats both the same
> way. Rather than get stuck retrying an identical broken request
> forever, the app self-heals: the first 400 or 404 automatically
> switches every subsequent request to `GEMINI_FALLBACK_MODEL`
> (`gemini-flash-latest`, Google's own auto-updating "current stable
> Flash" alias). This only ever switches once per session — if the
> fallback model *itself* later returns a 400/404, that's treated as a
> genuine error (bad key, quota, network, account issue) rather than
> "wrong model" and is retried the normal way, since there's no second
> model left to fall back to. Genuine key errors (401/403, or a 400 that
> names an `API_KEY_*` problem) are excluded from the fallback check
> entirely and always surface immediately instead. The existing
> retry-with-backoff behavior is unchanged either way — a 400/404 doesn't
> stop the retry loop, it just corrects the request so the retry loop it
> was already going to run has a real chance of succeeding. This logic
> lives in one shared helper, `resolveGeminiFallbackUrl()` in
> `js/gemini-uploads.js`, used by both the main request path and the
> bounding-box helper so they can never drift out of sync with each
> other. (The bounding-box helper additionally gets one extra retry
> attempt beyond the switch itself, since it's a best-effort feature that
> otherwise only got two tries total.)
>
> **Note on `temperature`:** `GEMINI_FALLBACK_MODEL` (`gemini-flash-latest`)
> currently resolves to a Gemini 3.x model, which rejects the sampling
> parameters `temperature` / `top_p` / `top_k` with an HTTP 400 if they're
> present in `generationConfig` at all. Rather than remove `temperature`
> everywhere (which would work, but flattens every feature to Gemini's
> default of ~1.0 even on the primary model, where the tuned value is fine),
> each feature sets its own tuned `temperature` unconditionally —
> deterministic (`0`) for extraction, solving, and bounding-box detection;
> a little variation (`0.4`–`0.6`) for explain/refine/chat; more (`0.7`) for
> distractor generation, which benefits from varied wrong answers. A shared
> helper, `_stripGeminiSamplingParams()` in `js/gemini-uploads.js`, deletes
> `GEMINI_SAMPLING_PARAM_KEYS` (`temperature`/`topP`/`topK`) from the
> in-flight request body at the exact moment `resolveGeminiFallbackUrl()`
> switches a request to the fallback model — so the primary model keeps its
> tuned values, and the fallback model never sees a key it would reject.
> Both call sites that can trigger a fallback switch (the main retry loop in
> `callGeminiWithRetry`, and the bounding-box helper's own retry loop) pass
> their request body through so this applies uniformly everywhere.
>
> **Note on `temperature` and the fallback model's own guidance:** stripping
> the field on a fallback call is the correct fix, but it also means a
> request that lands on the fallback model no longer gets any steering from
> `temperature` at all — Google's own guidance for the Gemini 3.x family
> (what `GEMINI_FALLBACK_MODEL` resolves to) is to leave `temperature` at
> its default and steer output through the prompt/system-instruction text
> instead, since the parameter itself is being phased out for that model
> family. Every feature that tunes `temperature` now also has a matching
> one-line instruction baked directly into its prompt, so the intended
> behavior holds even on a fallback-model call where the parameter itself
> never arrives:
> - **Deterministic (`0`) features** — extraction (`CQ_EXTRACTION_PROMPT`),
>   AI Solve (`systemInstruction` in `cqAiSolveQuestions`), and bounding-box
>   detection all end with an explicit "be fully deterministic" line.
> - **Mild-variation features** — Refine Question (`0.4`) and Explain
>   (`0.3`) each have a line clarifying that only small, natural wording
>   variation is expected and the underlying content/reasoning must stay
>   identical; the follow-up chat (`0.4`) has an equivalent line about never
>   contradicting something already established in the conversation.
> - **More-variety features** — question generation from lecture material
>   (`0.7`) and distractor generation (`0.7`) both have a rule asking the
>   model to actively favor varied phrasing/angles rather than defaulting to
>   the most generic option every time.
>
> **Note on `thinkingConfig`:** the fallback model rejects this field too,
> for the same reason as the sampling params above, but it's set by a
> different (and much smaller) set of features — only Refine Question,
> Fill Choices, and Add Choice ever include
> `generationConfig.thinkingConfig: { thinkingBudget: 0 }` (to keep those
> quick rewrite/generation calls fast by default; see the 🧠 Thinking
> toggle on each). Before this was fixed, falling back to
> `GEMINI_FALLBACK_MODEL` on those three tools specifically could get
> stuck retrying the exact same rejected `thinkingConfig` forever, since
> nothing ever removed it from the body — every other feature never sets
> this field at all, so they never hit it, and a key that never needed the
> fallback model never hit it either. `_stripGeminiThinkingConfig()`
> deletes it at the same moment `_stripGeminiSamplingParams()` runs, so
> the very next retry against the fallback model is clean.
>
> **Note on a request that starts ALREADY on the fallback model:** both
> strips above originally only ran *reactively* — at the exact moment
> `resolveGeminiFallbackUrl()` decided to switch a request from the
> primary model to the fallback mid-loop. That covers a request that
> starts on the primary model and gets rejected once, but not a request
> that's already pointed at the fallback from its very first attempt —
> which happens whenever an earlier, unrelated call this session already
> resolved `_geminiResolvedModel` to the fallback (e.g. extraction already
> discovered this key needs it, and now Refine Question runs for the first
> time). That first attempt still carried whatever `temperature`/
> `thinkingConfig` the feature unconditionally set, drew an immediate 400
> from the fallback model, and `resolveGeminiFallbackUrl`'s own "already on
> the fallback, nothing left to switch to" early return skipped the strip
> entirely — so the exact same rejected body kept getting resent forever,
> an infinite 400 loop on every retry that looked identical to the
> original bug from the outside (this is what showed up as Refine
> Question/Fill Choices/Add Choice still 400ing even after the reactive
> fix above). `_stripGeminiFallbackIncompatibleParamsIfNeeded()` closes
> this gap: both `callGeminiWithRetry` and the bounding-box helper now also
> strip proactively, once, before their very first attempt, whenever the
> URL they're about to call already points at the fallback model —
> regardless of whether the switch is happening in this call or already
> happened in an earlier one.
>
> **Note on key changes and the fallback model:** whether a given model
> works can depend on the account/project behind a particular key — so
> resolving to the fallback on one key doesn't mean the next key needs it
> too. Every time the *active* key actually changes — whether that's you
> picking a different one from **🔑 Manage APIs**, or the rotation engine
> below switching automatically — the app resets back to
> `GEMINI_PRIMARY_MODEL` and tries it fresh on the new key, exactly as if
> the site had just been opened, only falling back again if that key
> genuinely needs it too (`resetGeminiModelResolution()` in
> `js/gemini-uploads.js`, called from `useApiKey()` in `js/ai-features.js`
> for a manual switch, and from `_tryRotate()` inside
> `callGeminiWithRetry` for an automatic one).
>
> **Note on the bounding-box helper's retry loop:** everything above
> describes a period where `getBoundingBoxes` (`js/gemini-uploads.js`) had
> its *own* small hand-rolled fetch loop, separate from
> `callGeminiWithRetry`, that only knew how to self-heal a 400/404
> model-routing error — any other failure, most importantly a plain 429
> rate limit, gave up immediately and silently. Because bounding-box
> lookup is one batched request covering every image-bearing question in
> a file, a single 429 wiped out *every* image in that file at once — the
> more image-heavy questions a document had, the more likely this was to
> happen. `getBoundingBoxes` has since been rewritten to call
> `callGeminiWithRetry` directly instead of maintaining its own loop, so
> it now gets the exact same backoff/rotation/pause-fallback handling as
> every other Gemini call in the app, and a 429 storm during image
> extraction behaves the same way one would during question extraction
> (retry → rotate → pause-and-ask, instead of a silent partial result).
> This also meant threading two new parameters — `pauseCheck` (lets a
> 429 streak fall back into the ⏸️/▶️ pause UI) and `fileForReupload`
> (lets a stale Files API reference from an old key get silently
> refreshed mid-retry) — from `extractImagesForQuestions` down into
> `getBoundingBoxes`. `extractImagesForQuestions` builds `fileForReupload`
> itself from the file it's already given, so no call site needs to pass
> it; `pauseCheck` is threaded in from the bulk pass
> (`_extractQuestionsFromFile` in `js/ai-solve.js`, which already has the
> pause UI to fall back into) and intentionally left unset by the
> single-question 🔁 Re-extract Image path (`cqReextractImage`), matching
> every other per-question AI tool, which just retries in place until it
> succeeds or the user hits its own ⏹ Stop.
>
> **Note on batching:** the fix above still asked about *every*
> image-bearing question in a file in one request — retry/rotate/pause now
> covered a rate limit on that request, but the request itself stayed one
> big all-or-nothing unit, with two lingering problems. First,
> `maxOutputTokens` on it is a fixed 4096 — a file with enough image
> questions could produce a response that gets cut off mid-array, which
> (at the time) failed `JSON.parse` outright and silently lost every image
> in the file, not just the ones past the cutoff (see the next note — this
> specific half of the problem has since been fixed a second, more direct
> way too). Second, a batch that genuinely can't be recovered even after
> all of `callGeminiWithRetry`'s retries/rotation still meant the whole
> file came back with zero images, instead of just the unlucky subset.
> `extractImagesForQuestions` now splits image-bearing questions into
> batches of `GEMINI_BOUNDING_BOX_BATCH_SIZE` (15) and calls
> `getBoundingBoxes` once per batch, merging the results — each batch's
> response stays comfortably under the token limit, and a batch that can't
> be recovered only costs its own questions their image, while every other
> batch in the file is still requested and resolved independently.
> Cancellation and the pause-fallback signal still propagate immediately
> out of the whole loop, same as before — those are real state the caller
> needs to react to, not a per-batch miss.
>
> **Note on salvaging a truncated batch:** batching (previous note) makes a
> genuinely truncated bounding-box response rare, but doesn't make it
> impossible — a batch of unusually long question text can still, in
> principle, push a response past `maxOutputTokens`. `getBoundingBoxes`
> used to hand its raw response straight to `JSON.parse`, which throws on
> the very first syntactically incomplete character — meaning a response
> cut off mid-way through, say, the 12th of 15 entries lost all 11
> complete ones that came before it too, not just the unfinished 12th. It
> now runs the response through `parseGeminiJsonArray()` (the same
> bracket/string-aware repair question extraction has used since the
> `_extractQuestionsFromFile` truncation fix), which walks the text and
> cuts cleanly at the last fully-formed `{ q_index, page, x, y, w, h }`
> entry, so a truncated batch salvages every entry that finished
> generating instead of losing the entire batch over the one that didn't.

### Smart API key rotation

Every Gemini request in the app goes through one shared function,
`callGeminiWithRetry` (`js/gemini-uploads.js`), which delegates all
rotation *decisions* to `js/api-rotation.js`. Add more than one key in
**🔑 Manage APIs** and this kicks in automatically — no extra setup
required.

- **Smart Rotation toggle** — a switch at the top of **🔑 Manage APIs**
  lets you turn the whole engine off without deleting your other keys.
  On (default): rate-limited/invalid keys are skipped automatically, as
  described below. Off: the app stays on whichever key is active and
  retries/backs off on that key alone, even if healthier keys are
  configured — useful if you want to test one key in isolation or keep
  usage pinned to a specific account. The setting is saved per browser
  (`localStorage`, key `anu_msp_smart_rotation_enabled_v1`) and takes
  effect immediately, including on a run that's already in progress.
  Every rotation decision in the app funnels through a single function,
  `pickNextApiKey()` in `js/api-rotation.js`, so this one flag is the only
  thing that needed to change to gate the entire feature.

- **Rate-limit detection** — a key is marked rate-limited after **2
  consecutive HTTP 429 responses**. A single 429, or a 429 followed by a
  success, doesn't count — only an unbroken streak of two.
- **Model-error detection** — the same 2-strikes rule applies to plain
  HTTP 400 responses that *aren't* about the key itself (a genuinely
  invalid/revoked key is handled separately below, and rotates away
  immediately without waiting for 2). Two consecutive plain 400s in a
  row on one key excludes it exactly like a 429 streak would — same
  rotation trigger, same 60-second cooldown — the only difference is
  cosmetic: the API Key Manager's status chip reads **"⚠️ Model Error"**
  instead of "⏳ Rate-limited" so you can tell the two apart at a glance.
- **Automatic rotation** — the instant a key crosses that threshold, the
  app switches the active key to the next configured one and retries
  immediately (no extra backoff wait — a fresh key doesn't need one).
  This happens *inside* the same network call that hit the rate limit, so
  whatever was running (an extraction, a bulk Fill Choices pass, an AI
  chat reply) simply continues from exactly where it was — no lost
  progress, no restarted loop, no user action needed.
- **Every rotation starts the new key on the primary model again** — see
  the note above. A key that needed the fallback model doesn't force that
  choice onto the key rotated in next.
- **If every key is rate-limited**, rotation doesn't stop — it keeps
  cycling between all of them (a key's limit can lift again at any
  moment, especially per-minute caps), while showing a note asking you to
  add another key for full speed. That note shows up in three places: the
  API Key Manager, the "currently using…" badges in the Custom Quizzes
  modal, and the progress box of whatever AI run is active.
- **New keys are picked up instantly** — pasting in a new key while an AI
  process is already running doesn't require restarting it. Rotation
  always reads the live key list, and if a process happens to be waiting
  out a retry delay with nowhere left to rotate to, adding a key wakes it
  early instead of waiting out that delay first.
- **Live UI everywhere** — the API Key Manager's "✓ In use" button, the
  small 🔑 quick-access buttons under each question, and the "Using API
  N: …" badges all update the moment a rotation happens, not just when
  you manually switch keys yourself.
- **Large-file uploads survive a rotation.** Files under Gemini's inline
  size threshold are sent as base64 and work under any key unchanged, but
  larger files (PDFs/videos routed through Google's Files API) are
  scoped to the key/project that uploaded them — so if a rotation happens
  mid-extraction on one of those, the app silently re-uploads the file
  under the new key before retrying, rather than failing with a stale
  reference.
- **A single misbehaving key never blocks the others.** If a key comes
  back invalid/revoked (401/403), the app rotates away from it once
  immediately (no need to wait for 3 strikes, since that failure mode
  isn't rate-limit-related) rather than halting the whole run — it only
  surfaces an error if no other key is available either.
- **Manually switching keys works the same way, on purpose.** Picking a
  different key yourself from **🔑 Manage APIs** while something is
  running asks for confirmation first (switching aborts that run — see
  below), and whatever you start next on the new key begins on the
  primary model, same as any other key change (see the note above).
- **A single-key setup behaves exactly as before** — rotation only ever
  activates when 2+ keys are configured; with one key, a rate limit is
  still retried with the existing exponential backoff (2s, 4s, 8s… capped
  at 30s), unchanged from prior versions.

## Admin permission boundaries: `curriculum` vs `community`

The **📤 Publish Quizzes** tab is gated entirely by the `curriculum`
permission — it's the only permission that matters there. Inside it, an
admin can pick a quiz to publish from **either** source list:

- **🤖 My Custom Quizzes** — their own custom quizzes.
- **🌐 Community Quizzes** — anyone's shared community quizzes.

Both source lists are shown to any admin holding `curriculum`, regardless
of whether they also hold `community`. This is intentional: publishing a
quiz into the curriculum only ever writes to `publishedQuestions`, which
`firestore.rules` gates on `isCurriculumAdmin()` alone, and reading
`sharedQuizzes` requires nothing more than being signed in. `community`
permission is reserved for the separate **🗂️ Manage Community Quiz**
tab — moderating/deleting other users' shared quizzes — which is a
distinct, unrelated capability from simply using a community quiz as a
publish source.

## Scoped curriculum permissions

By default, granting an admin the `curriculum` permission gives them
publish/edit/delete access to the **entire** curriculum. From **Admin
Panel → Manage Admins → Add New Admin**, whoever holds the `admins`
permission can instead narrow that down when checking `curriculum`:

- **🌍 Whole Curriculum** — the classic, unrestricted grant.
- **🎯 Specific Year / Module / Subject** — opens the same
  click-through Year → Module → Subject navigator used elsewhere in the
  admin panel. Checking a Year grants everything under it; checking a
  Module grants every subject in it; checking individual subjects grants
  just those. A partially-covered Year/Module shows a "partial" badge.

A few rules keep this from ever letting someone escalate their own
access:

- **You can only grant what you already hold.** The picker only ever
  shows Years/Modules/Subjects the *acting* admin's own scope covers, and
  `assignAdmin()` re-validates that the chosen scope is a strict subset
  of the acting admin's scope (`isCurriculumScopeSubset()` in
  `js/admin-curriculum-scope.js`) before saving.
- **Scoped admins can't reshape the curriculum tree.** Adding, renaming,
  or deleting a Year/Module/Subject (or changing its icon) requires the
  `curriculum` permission **and** a `type: 'all'` scope — a scoped admin
  can fully publish, edit, reorder, and delete quizzes anywhere within
  their granted slice, but can't invent new subjects to grant themselves
  access to, or rename their way around their own boundary.
- **"Outranks you" also checks scope, not just the flat permission
  list.** In Manage Admins, a scoped curriculum admin can't remove
  another admin whose curriculum access exceeds their own, even if both
  simply hold the `curriculum` tag.
- **Enforced server-side, not just in the UI.** `firestore.rules`
  independently re-checks the acting user's recorded `curriculumScope`
  against the specific `subject` being written to
  `publishedQuestions/{subject}/...`, by looking up that subject's
  Year/Module placement in `appConfig/curriculumExtensions`. A scoped
  admin cannot bypass their limits by calling the Firestore SDK directly.

Roster entries created before this feature existed have no
`curriculumScope` field at all — both the client and the rules treat that
as `{ type: 'all' }`, so nothing changes for existing admins.

**Note on the "Add New Admin" form's state:** every click inside the
Year/Module/Subject scope picker (and the Whole/Specific mode switch)
re-renders the whole Manage Admins panel to redraw the tree. The
permission checkboxes, the curriculum scope selection, and the email
field are therefore kept in plain JS variables
(`adminNewPermsChecked`, `adminNewAdminScope`, `adminNewEmailDraft` in
`js/admin-curriculum-scope.js`) and re-applied on every render, rather
than being read back off the DOM — otherwise a re-render would silently
reset them to their unchecked/empty defaults mid-way through filling out
the form. `resetAdminNewAdminFormState()` clears all three together
whenever the form should start fresh (opening the admin panel, or after
successfully adding an admin).

## Adding questions

Questions are stored in Firestore, not hardcoded, so the primary way to
add them is through the app itself once you're an admin:

- **Admin Panel → Publish** a custom or community quiz into a chosen
  Module/Subject/Lecture, or
- **Admin Panel → Manage Curriculum** to create the Year/Module/Subject
  structure first, then publish into it.

Every question follows this shape:

```js
{
  question: "The question text",
  image: "https://example.com/image.png", // optional
  options: { A: "...", B: "...", C: "...", D: "..." },
  answer: "A" // must match one of the option keys
}
```

## Deploying change #56 to an existing live project (one-time)

If you're updating an already-live deployment (not a fresh install), the
new curriculum/community reads go **only** through R2/the Worker — there
is no Firestore fallback. Existing published lectures and community
quizzes must be copied into R2 *before* this app code goes live, or
they'll simply be missing until re-published. Use the separate
`legacy-content-to-r2-migration` tool (kept outside this project, since
it's a one-time script, not part of the running app) — see its own
README for exact steps. It's read-only against Firestore's existing
content and safe to run at any time, including against a live project
with active users, since nothing currently deployed reads from R2 yet.

Recommended order: deploy the Worker → run the migration tool → verify
a few items → deploy this app code → monitor → only then retire the old
Firestore-side curriculum/community data.

## Changelog

Newer entries first. Each numbered project drop corresponds to one focused
change (see the filename of whichever zip you're reading from).

- **126 — Fixed custom quizzes (and quiz collections/stats/attempt history)
  appearing to vanish after a page refresh, for any signed-out or
  not-yet-signed-in use of the app.** Saving a quiz always wrote correctly
  to IndexedDB (`js/local-store.js`) and showed up immediately in the same
  session, since `saveCustomQuizzesList()` (`js/firebase-storage.js`) sets
  the in-memory `window._cachedCustomQuizzes` cache directly on save. The
  bug was on the READ side after a refresh: `js/firebase-init.js`'s
  `onAuthStateChanged` handler only ever reloaded
  `window._cachedCustomQuizzes` / `window._cachedQuizCollections` /
  `window._quizAttempts` from IndexedDB inside its `if (user)` branch — a
  leftover from before custom quizzes/stats moved from Firestore to local
  storage, when signing in was in fact what triggered the Firestore fetch.
  Once everything moved to local storage (an IndexedDB store that's
  per-device, not per-account) that guard was stale: a signed-out user's
  data was safely sitting in IndexedDB the whole time, but nothing ever
  read it back into memory on refresh, so `loadCustomQuizzes()`
  (`js/firebase-storage.js`) fell back to its `|| []` default and the
  custom-quizzes list rendered empty. The matching stats loader,
  `loadStatsFromFirestore()` (`js/app-core.js`), had the identical bug via
  its own `if (!window._currentUser) return;` guard.
  - Both loads now happen unconditionally in `onAuthStateChanged`,
    regardless of whether `user` is set — they're pure local-storage
    reads with no Firestore dependency left, so there's no reason to gate
    them on sign-in state. Sign-in-only steps (the one-time Firestore→
    local migration for pre-existing accounts, display-name pre-load,
    admin manifest backfill) stay exactly as gated as before.
  - The migration step now runs *after* this local-storage load rather
    than before it, and — if it actually pulled anything down from
    Firestore — triggers one more local-storage reload immediately after,
    so a freshly-migrated account sees its recovered quizzes/stats without
    needing a second refresh.
- **125 — Content Filter's strict source-matching prompt (`CQ_STRICT_SOURCE_SYSTEM_INSTRUCTION`,
  `js/gemini-uploads.js`) is now actually wired up and in effect — it was
  written and threaded through `cqAiSolveQuestions()`'s `strictSourceCheck`
  parameter, but the one call site that needed it, `cqRunContentFilterPass()`,
  was never updated to pass it, so Content Filter was still running the
  lenient "clearly found in the source" wording used by Solve All / Answer
  Missing Keys. A question only on the same broad topic as the source (same
  subject/organ system/chapter, but not the specific fact the question
  needs) could pass `found_in_source: true` and stay in the set.**
  - `cqRunContentFilterPass()` now calls `cqAiSolveQuestions(…, true)`,
    switching it onto `CQ_STRICT_SOURCE_SYSTEM_INSTRUCTION` and the
    matching strict `found_in_source` line in `instructionPart` — both
    already existed, only the call site was missing the flag.
  - This only tightens what Content Filter accepts as "found in the
    source" when deciding what to keep or remove. It does not touch how
    any question gets *answered* — `answer` is graded independently of
    `found_in_source` in both the lenient and strict prompts, Content
    Filter always restores each surviving question's original answer
    after its internal check (unchanged), and AI Solve / Answer Missing
    Keys never pass `strictSourceCheck`, so their own answers and
    wording are completely unaffected.
- **124 — Fixed AI Solve / Content Filter losing track of reference-source
  files after a mid-run API key rotation, instead of every batch after the
  rotation failing on a stale file reference.** `cqAiSolveQuestions()`
  (`js/gemini-uploads.js` — the shared engine behind Solve All, Answer
  Missing Keys, and Content Filter's internal check) builds its reference
  sources' request parts (`sourceParts`) once and reuses the same array
  across every batch, which is correct and intentional — see the
  "identified missing file re-upload logic during API key rotation"
  investigation this closes out. The gap: `callGeminiWithRetry()` already
  knew how to re-upload a Files-API document under a newly-rotated key
  (added for the single-file extraction pipeline), but only supported ONE
  such file per request and `cqAiSolveQuestions()` never told it about its
  source files at all — so a rotation mid-batch (rate limit or an invalid
  key) left `sourceParts` holding a `file_uri` scoped to the OLD key's
  project, and every subsequent batch in that run would fail against it.
  - `callGeminiWithRetry()`'s rotation handling is now multi-file aware:
    `_findFileDataPartRefs()` (replacing the old single-result
    `_findFileDataPartRef()`, kept as a thin back-compat wrapper) locates
    every `file_data` reference in a request instead of just the first,
    and `fileForReupload` now accepts either a single `{ file, mimeType }`
    (unchanged for the single-file extraction/generation callers) or an
    array of them for requests carrying several source files — each is
    re-uploaded and patched into the request in place, matched to its
    `file_data` reference by position. On success, the returned object
    now also carries `__rotatedFileParts` (an array) alongside the
    existing single-file `__rotatedFilePart`.
  - `cqAiSolveQuestions()` now tracks, per source file, whether its part
    became a `file_data` reference (large enough to need the Files API)
    or was inlined as base64 (small enough not to need re-uploading at
    all), passes the former list in as `fileForReupload`, and — this is
    the actual fix — applies `__rotatedApiKey` / `__rotatedFileParts` back
    onto its own `apiKey` and `sourceParts` after every batch, not just
    inside the one in-flight request that happened to trigger the
    rotation. Every later batch in the same run now picks up the freshly
    re-uploaded reference and the new key, instead of repeating the same
    failure batch after batch.
- **123 — Content Filter now shows the same live "(batch N of M)" progress
  bar Solve All does, instead of sitting on a static message for the whole
  run.** `cqRunContentFilterPass()` (`js/gemini-uploads.js`) drives its
  internal check through `cqAiSolveQuestions()`, which already tracks and
  reports batch-by-batch progress — but Content Filter was always handing
  it `createSilentStatusStub()` (added in #122) so that chatter never
  reached the screen, leaving the tool's own status box frozen on
  "Checking questions against the source…" at 0% until the entire run
  finished.
  - `cqAiSolveQuestions()` now takes an optional `progressLabel` — an
    `{ icon, multi, single(n) }` wording override — so callers that reuse
    it for a different purpose can re-word its per-batch text instead of
    only being able to silence it. Defaults to the existing "AI is
    solving…" wording (`CQ_SOLVE_PROGRESS_LABEL`) when omitted, so Solve
    All / Answer Missing Keys are unaffected.
  - `cqRunContentFilterPass()` now takes an optional `statusEl` and, when
    given one, passes it straight through to `cqAiSolveQuestions()` along
    with `_cqContentFilterProgressLabel` — the same batch progress bar,
    re-worded to "Checking questions against the source… (batch N of M)".
    Both call sites (the post-extraction "Content Filter" bulk AI tool in
    `js/ai-features.js`, and the pre-extraction toggle in
    `js/ai-solve.js`) now pass their live `statusEl` through. Omitting the
    argument still falls back to the silent stub, so the fix is
    backward-compatible with any other caller.
  - Pause/resume and rate-limit banners now surface during a Content
    Filter run too, matching Solve All, since they ride the same
    `statusEl` instead of being swallowed.
- **122 — Fixed a crash ("statusEl.insertAdjacentHTML is not a function")
  that could abort extraction partway through the pre-extraction Content
  Filter pass (#120).** `cqRunContentFilterPass()` (`js/gemini-uploads.js`)
  runs its internal check via `cqAiSolveQuestions()` but wants that call's
  own progress/pause chatter to stay silent, so it hands it a throwaway
  `statusEl` — previously a bare `{ innerHTML: '' }` object literal. That
  covered plain `.innerHTML =` writes, but `cqAiSolveQuestions()` and the
  shared pause helpers it can call into (`cqCheckPause()`,
  `_cqEnterPause()`, `cqFallbackPauseForRateLimit()`, all in
  `js/ai-question-tools.js`) also call `.insertAdjacentHTML()` (to report
  per-batch errors, or show a pause banner) and `.querySelector()` (to
  find/replace/remove that banner) on it — neither of which a plain
  object implements. The moment a silent Content Filter run actually hit
  a per-batch error, an automatic rate-limit pause, or a manual pause
  mid-filter, one of those calls would throw and abort the whole
  extraction, discarding everything already extracted.
  - Fixed by replacing the one-off literal with `createSilentStatusStub()`
    (`js/dom-utils.js`), a small reusable stub that implements
    `innerHTML`, `insertAdjacentHTML()`, and `querySelector()` as no-ops —
    it absorbs every write/read those shared helpers make and stays
    silent, instead of missing methods the moment an edge case is hit.
    Documented alongside `liveRef()`/`liveStatusRef()` so any future
    "give this an internal call a status target it should ignore" need
    reaches for the same helper instead of another bare literal.
- **121 — Fixed Content Filter silently overwriting answers it was only
  ever supposed to be checking, not solving.** `cqRunContentFilterPass()`
  (`js/gemini-uploads.js`, added in #120) borrows `cqAiSolveQuestions()`
  purely to learn whether each answer was found in the reference source —
  but that function's actual job is to solve/verify, so as a side effect
  it was also overwriting every checked question's `answer` with
  whatever the AI came up with, regardless of what the source's own
  answer key said, and regardless of whether "Solve/verify all
  questions" was even toggled on. A run of Content Filter with that
  toggle off — its normal, most common use — was quietly re-answering
  every surviving question anyway.
  - Fixed by snapshotting each question's `answer` immediately before the
    internal solve call and restoring it immediately after, before
    filtering runs. The AI's response is now used only for what Content
    Filter actually needs — `found_in_source`, to decide keep-or-remove —
    and never reaches the output. Whether questions get genuinely
    re-solved is controlled solely by the separate "Solve/verify all
    questions" toggle, same as before this fix; if that ran too, it
    already did so as its own earlier step, upstream of Content Filter
    entirely.
  - One fix in the shared helper covers both call sites from #120 — the
    post-extraction "Content Filter" bulk AI tool and the new
    pre-extraction toggle alike.
- **120 — "Content Filter" is now also a pre-extraction toggle, right next
  to Fill Choices and Refine Questions — not just a post-extraction bulk
  tool you had to open the editor to find.** Lives in the "Create a New
  Quiz with AI" tab (`js/firebase-storage.js`, `renderCustomQuizModal()`),
  styled to match its own severity (red, like the "wrong answer" palette)
  rather than the amber/violet used by Fill Choices/Refine, since removing
  questions is a more consequential action than polishing them.
  - Gets its own required reference-source dropzone
    (`cqFilterSourceDropzone` / `cqFilterSourceFiles`, distinct from AI
    Answering's optional one, `cqAiSourceFiles`, for the same reason #118
    kept the editor's two source lists separate: one tool's source being
    optional and the other's mandatory means they can't safely share a
    list) — new helpers `setupFilterSourceDropzone()`,
    `handleCqFilterSourceFileSelect()`, `acceptFilterSourceFile()`, and
    `cqRemoveFilterSourceFile()` in `js/gemini-uploads.js`, mirroring the
    existing `*SourceFile*` helpers exactly. `generateQuizFromAI()`
    (`js/ai-solve.js`) now also refuses to start — same as the
    already-existing missing-API-key/no-file/no-title checks — if the
    toggle is on with no file uploaded yet.
  - The actual filtering logic (drop any question the AI could only
    answer from its own knowledge rather than the source) previously
    lived only inside `_editorBulkContentFilter()`
    (`js/ai-features.js`). It's now factored out into a shared
    `cqRunContentFilterPass(questions, sourceFiles, cancelToken)`
    (`js/gemini-uploads.js`), which both `_editorBulkContentFilter()` and
    the new pre-extraction step in `generateQuizFromAI()` call — so the
    filtering behavior (and any future fix to it) only has to exist, and
    be fixed, in one place.
  - Runs, when enabled, immediately after the existing Solve/Answer step
    and strictly before Fill Choices/Refine Questions — added to the
    "Multiple AI steps selected" sequential-run notice in that same
    order. Filtering first (rather than last) avoids spending Fill
    Choices/Refine AI calls on a question that's about to be deleted for
    failing the filter anyway. The final extraction summary line gains a
    "N filtered out" note alongside the existing AI-solved/filled/refined
    counts when it runs.
  - The post-extraction "Content Filter" bulk AI tool from #118 is
    unchanged in behavior or location — this just adds an earlier,
    automatic way to run the same pass, it doesn't replace the manual one.
- **119 — Fixed "Copy question image" (and the image half of any
  combined text+image copy) always failing with "can't copy in this
  browser", on every browser, not just some.** Root cause in
  `js/ai-external-send.js`: every image this app stores has already been
  compressed through a canvas as JPEG (`compressImageDataUrl()` in
  `js/gemini-uploads.js`), but the Clipboard API's image write only
  reliably accepts PNG — handing `ClipboardItem` a JPEG blob throws
  instead of copying, and does so consistently across Chrome, Firefox,
  and Safari alike, which is why it looked like every browser was
  broken rather than one. `_extAiCopyImage()` and
  `_extAiCopyTextAndImage()` both now run the image through a new
  `_extAiImageToPngBlob()` first — a plain canvas re-encode to PNG,
  regardless of the source image's original format — before handing it
  to `ClipboardItem`, so the write always uses a type the browser will
  actually accept.
- **118 — New bulk AI tool: "Content Filter" — removes any question the
  AI can only answer from its own knowledge, not from a required
  reference source.** Lives in the same whole-quiz AI Tools panel as AI
  Solve All / Fill Choices / Refine Questions (see #100-ish onward for
  that panel's history) and looks and behaves like them — its own
  button, its own Stop button, its own "settings" `<details>` with a
  reference-source dropzone — but with no per-question equivalent, since
  filtering only makes sense as a whole-quiz pass.
  - Deliberately reuses AI Solve All's own engine, `cqAiSolveQuestions()`
    (`js/gemini-uploads.js`), rather than a separate answer-checking
    implementation: "was this question's answer found in the source" is
    exactly what that engine already determines per question via
    `found_in_source`/`ai_guessed`. `_editorBulkContentFilter()`
    (`js/ai-features.js`) runs it across every question, then removes
    every one left flagged `ai_guessed` — walking the list backward so
    splicing is safe, and calling the same `_caseGroupOnQuestionDeleted()`
    housekeeping a manual per-question delete uses, so a removed question
    never leaves a case group's linking broken.
  - The reference source is **required** — unlike AI Solve All's optional
    one, a Content Filter run with no source would be indistinguishable
    from "filters out nothing", so the button refuses to run and shows an
    error status until at least one file is uploaded.
  - Deliberately quiet about the mechanics: `cqAiSolveQuestions()`'s own
    per-batch progress text ("AI is solving questions… (batch N of M)")
    is swallowed via a throwaway status target rather than shown, and
    both `ai_answered`/`ai_guessed` are stripped from every surviving
    question afterward — a question either made it through the filter or
    it didn't, so there's no "AI-answered"/"AI Guess" badge left over to
    advertise how each one was scored. The only feedback is a generic
    "Checking questions against the source…" progress line while it
    runs, and a clean "N question(s) removed, M remain" summary at the end.
  - Its dropzone reuses AI Solve All's exact component
    (`_editorBulkSourceFileListHTML()`/`_editorBulkSourceAcceptFile()`/
    `_editorBulkSourceFileSelect()`/`_editorBulkSourceRemoveFile()`/
    `_editorBulkSourceSetupDropzone()`), generalized to take a `toolKey`
    ('Solve' or 'Filter') so the two tools can each have independent
    files and DOM ids without colliding or duplicating code — Content
    Filter gets its own `_editorBulkFilterSourceFiles` store rather than
    sharing AI Solve All's `_editorBulkAiSourceFiles`, since one tool's
    source being optional and the other's mandatory means they can't
    safely be the same list.
  - Stopping mid-run, and the "AI is busy" close-guard on the editor
    modal, both work automatically with no extra wiring — `_stopAllAiProcesses()`
    and `_editorBulkSetBusy()` already key off `_editorBulkCancelToken`/
    tool-name lists generically, and Content Filter was simply added to
    both.
- **117 — The "Ask AI" selection toast now gives situation-specific
  instructions instead of a generic "asking X next" line, and the toast
  that used to follow an actual send is gone for anything that opens a
  new tab.** Two changes to `js/ai-external-send.js`, both in the same
  spirit — say something the student will actually use, and only when
  they're actually looking at this page to read it:
  - The toast shown right after selecting a specific assistant
    (`_extAiSelectionInstructionText()`, replacing #116's
    `_extAiSelectionToastText()`) now describes what tapping the
    resulting "Ask ‹Name›" button will do, in one of four ways depending
    on the assistant and the question: pre-fill support with no image
    ("opens with the question already typed in and ready to send"),
    pre-fill support with an image (notes the image is copied separately
    since a URL can't carry it, and needs pasting in before sending),
    no pre-fill support with no image ("the question is copied — paste
    it in and send once it opens"), and no pre-fill support with an
    image (same, but "the question and image are copied together").
  - `sendQuestionToExternalAi()` no longer shows a toast once a real
    site actually opens in a new tab, since by the time that tab has
    loaded the student has already moved their attention there — a
    toast left behind on this page mostly goes unseen. The
    situation-specific instructions above are the only feedback for that
    path now. A toast still fires for "Copy for another AI" (never opens
    a site) and for any provider where opening didn't happen — both
    cases where the student is still looking at this page. The
    now-simpler function drops the dead message-building branches for
    outcomes that could never be shown anymore.
- **116 — Selecting an AI in the "Ask AI" picker goes back to just
  selecting — it no longer sends.** Follows immediately after #115,
  which (per that step's request) made a tap send right away. This
  undoes that specifically: tapping a specific assistant (anything but
  "Copy for another AI") now closes the picker, remembers it as the
  default (turning the button into the one-click "Ask ‹Name›" split
  control, per #114), and shows a toast that tells the student what
  tapping "Ask ‹Name›" will do next — but doesn't copy or open anything
  itself. The actual send only happens once "Ask ‹Name›" is tapped
  afterward. Concretely, `js/ai-external-send.js` gets
  `_extAiSelectProviderInMenu()` back as a thin selection step (picker
  row `onclick` points to it again instead of calling
  `sendQuestionToExternalAi()` directly), and a new
  `_extAiSelectionToastText()` supplies the instructional toast wording
  (replacing #115's confirmation-after-sending toast for this path).
  "Copy for another AI" is unchanged from #115/#113: it never becomes a
  one-click default, so selecting it is still the only way to use it —
  it copies the prompt immediately and leaves the picker open, since
  there's no later "Ask" button for it to defer to. "Copy question
  image" is unaffected either way.
- **115 — Selecting an AI in the "Ask AI" picker now sends right away
  again, and the picker no longer asks for a separate Send tap.** Undoes
  #113's select-then-confirm step in `js/ai-external-send.js`: tapping a
  specific assistant in the dropdown immediately copies/opens it and
  shows the confirmation toast (e.g. "Opened ChatGPT, pre-filled with
  the question.") right there — the same message that used to wait for
  a separate Send button press now appears the moment the assistant is
  picked. The in-between preview line ("Opens ChatGPT with the question
  already typed in…") and the Send button are both removed, since
  there's no longer a pending selection for them to describe or confirm.
  Concretely, each row in the picker now calls `sendQuestionToExternalAi()`
  directly instead of `_extAiSelectProviderInMenu()` (removed, along with
  `_extAiConfirmSend()`, `_extAiPreviewText()`, and `_extAiSendLabel()`),
  and the matching CSS for the preview line and Send button
  (`.ai-send-menu-preview`, `.ai-send-menu-send`, `.ai-send-menu-item.is-selected`)
  was removed from `css/styles.css`. #114's default-remembering is
  unaffected — a specific assistant is still saved as the default the
  moment it's tapped, since that happens inside `sendQuestionToExternalAi()`
  itself. "Copy for another AI" still leaves the picker open afterward
  (it only writes to the clipboard, never opens a site), and "Copy
  question image" is unchanged.
- **114 — Selecting an AI in the "Ask AI" picker now remembers it right
  away, not only once Send is pressed.** One change to
  `_extAiSelectProviderInMenu()` in `js/ai-external-send.js`, following
  up on #113's select-then-send picker: tapping a specific assistant
  (anything but "Copy for another AI") now sets it as the remembered
  default immediately, the same moment it's selected — the student no
  longer has to reselect it on their next question just because they
  closed the picker without pressing Send this time. The picker still
  doesn't copy or open anything until Send is actually pressed; only
  *which assistant is remembered* now updates at selection time. Under
  the hood this reuses the existing default-setting path
  (`_extAiSetDefaultProvider()`), which already rebuilds the button and
  reopens the picker fresh with the new default preselected — so
  selecting a real provider no longer needs a separate manual DOM patch
  for the highlight/preview/Send-button update; only "Copy for another
  AI" (which never sets a default) still gets one, since it isn't one
  specific assistant to remember.
- **113 — "Ask AI" picker: selecting an assistant no longer sends right
  away, messaging is simplified for mobile, and copy actions leave the
  picker open.** Three changes to `js/ai-external-send.js`, all confined
  to the dropdown opened by the caret / "Ask AI" button:
  - **Select, then Send.** Tapping an assistant in the list used to send
    to it immediately. It now only *selects* it — the row highlights, and
    a one-line preview appears explaining exactly what will happen
    (`_extAiPreviewText()`), e.g. "Opens ChatGPT with the question already
    typed in and ready to go" or "Copies the question, then opens
    Claude — paste it in once it loads." Nothing is copied or opened
    until the new **Send** button at the bottom of the picker is pressed
    (`_extAiConfirmSend()`). If a default assistant is already remembered
    it's preselected when the picker opens, so Send is ready immediately,
    but it still needs that explicit tap — no accidental sends from a
    stray click on the list. The one-click "Ask ‹Name›" split button
    (from #112) is unaffected: it already knows its target and still
    sends in a single click by design, since reselecting was never part
    of that path.
  - **Simpler, mobile-safe messaging.** Every message in the flow —
    the per-provider preview, the Send button label, and the toast shown
    after sending — was rewritten to drop keyboard-shortcut phrasing like
    "Ctrl/Cmd+V", since a large share of students use this from a phone,
    where there's no Ctrl or Cmd key. Instructions just say "paste it
    in"; press-and-hold works the same way. The old dedicated "image"
    hint banner at the top of the picker is gone — its explanation is now
    folded into the same live, per-provider preview line instead of a
    separate static paragraph, so there's one simpler place to read what
    will happen rather than two.
  - **Copy actions keep the picker open.** "Copy question image" no
    longer closes the picker when clicked — it copies and stays open, so
    a student can copy the image and still pick/send a provider
    afterward, or copy it again. The same applies to selecting "Copy for
    another AI" and pressing Send: since that option only writes to the
    clipboard and never opens a site, confirming it no longer closes the
    picker either, in case the student wants to try a specific assistant
    next. Every other provider still closes the picker on Send, since
    opening its real site in a new tab reads as the interaction being
    finished.
  - **Removed "Forget default AI."** With the picker's own Send button
    always requiring a fresh tap-to-confirm, there was no longer a
    distinct need for a separate action just to clear the remembered
    default back to "no default" — reopening the picker (via the caret)
    and sending to a different assistant already changes it in one step,
    the same way it always could. Removing the menu item keeps the
    picker shorter without losing any capability.
- **112 — "Ask AI" gets a remembered default assistant, and images are now
  auto-copied on send instead of a separate manual step.** Two changes to
  `js/ai-external-send.js`:
  - **Default AI.** Whichever assistant the student picks from the "Ask AI"
    dropdown is now remembered (`localStorage`, `_extAiSetDefaultProvider()`)
    and turns the button into a one-click split control: "Ask ChatGPT" (or
    whichever was picked) sends straight there, and a small caret beside it
    reopens the picker to send this one question elsewhere or change the
    default — with the current default marked "✓ Default" in the list and a
    "Forget default AI" entry to go back to the plain picker. The default is
    shared across every question on the results screen and updates all of
    them at once (`_extAiRefreshAllButtons()`). "Copy for another AI" is
    excluded — it's a generic fallback, not one assistant to remember.
  - **Image auto-copy.** A question's image no longer needs the separate
    "Copy question image" click to travel along with a send. For prefill
    sites (ChatGPT, Perplexity) the image is copied to the clipboard
    automatically right after opening, ready to paste in next to the
    pre-filled text. For every other AI, the prompt and the image are
    written to the clipboard together as one combined clipboard item — two
    representations of the same item (`_extAiCopyTextAndImage()`), so a
    single paste can hand a rich composer both at once — falling back to a
    text-only copy if the browser can't do a combined write. "Copy question
    image" stays in the menu as a manual option for re-copying the image on
    its own. The dropdown now opens with a hint banner explaining which of
    the two behaviors applies, before the student picks, and each provider's
    subtitle reflects it too (`_extAiSubtitleFor()`).
- **111 — Fixed the "Ask AI" dropdown (#110) being clipped instead of
  shown.** The menu was rendered as an absolutely-positioned child inside
  `.ai-send-wrap`, which sits inside `.r-content` → `.r-card` →
  `.results-body`. `.r-card` uses `overflow: hidden` for its rounded
  corners and colored side strip, and `.results-body` is itself a scroll
  container — both clip any child that visually extends past their box,
  so the dropdown was being cut off (often to nothing visible) instead of
  floating above the card. It's now rendered as a "portal": appended
  directly to `<body>` and positioned with `position: fixed` using
  coordinates computed from the Ask AI button's `getBoundingClientRect()`
  (`positionAskAiMenu()` in `js/ai-external-send.js`), the same pattern
  used by most dropdown/popover libraries to escape a clipping ancestor.
  It now also flips to open **above** the button when there isn't room
  below, clamps horizontally so it can't run off either edge of the
  viewport, gets a `max-height` with its own scroll for very short
  screens, and stays correctly positioned under the button on scroll or
  resize while open. Below 480px wide it's unaffected — the existing
  fixed, full-width bottom-sheet layout still applies, taking priority
  over the new inline positioning.
- **110 — Added "🤖 Ask AI": send a results-screen question to an external
  AI chat site, with a provider picker.** A new button sits in the results
  card's AI row, next to 🪄 Explain and 💬 Chat. Clicking it opens a
  dropdown — styled after the app's other dropdown pickers (e.g. the
  custom-quiz collections menu) — listing ChatGPT, Claude, Gemini,
  Perplexity, DeepSeek, Grok, and a generic "Copy for another AI"
  fallback. Picking one sends the student to that AI's real website in a
  new tab, in their own account, with no Gemini API key (or any API key
  of ours) involved:
  - **ChatGPT** (`chatgpt.com/?q=…`) and **Perplexity**
    (`perplexity.ai/search?q=…`) genuinely pre-fill/auto-run the prompt —
    verified current behavior for both sites, not assumed. Claude, Gemini,
    DeepSeek, and Grok don't offer an equivalent URL parameter, so for
    those (and whenever a prompt is too long to safely put in a URL — over
    `EXTERNAL_AI_MAX_PREFILL_LEN`, 6000 characters) the app instead copies
    the full prompt to the clipboard and opens the site, with a toast
    telling the student to paste it in. "Copy for another AI" always just
    copies, for any assistant not in the list.
  - **Same context every time, nothing re-typed.** `buildExternalAiPrompt()`
    (new `js/ai-external-send.js`) builds the prompt from the exact same
    pieces `buildExplainPrompt()`/`buildChatSystemInstruction()` already
    send to Gemini: the question, options, correct answer, the student's
    own answer, and — for a question that's part of a shared case/vignette
    — the same "linked" ancestor-case context block
    (`_cqCaseContextBlock()`) used for extraction and chat. If an AI
    explanation was already generated for this question on-screen, it's
    included so the new assistant can build on it rather than start over;
    if the on-screen AI chat has any messages, the full transcript is
    appended too, so switching assistants mid-conversation doesn't lose
    anything.
  - **Images.** Since a browser can't hand another site's composer a file
    automatically, a question with an image gets a second menu row, "Copy
    question image" (`copyQuestionImageForAi()`), that copies the image
    itself to the clipboard via the Clipboard API (`ClipboardItem`) so the
    student can paste it into the chat right after the prompt; the prompt
    text also notes the image exists either way.
  - **Theming & responsiveness.** Three new tokens (`--extai-pale`,
    `--extai-fg`, `--extai-border`, `--extai-border-strong`) give the
    button its own accent, distinct from the violet Explain and sky Chat
    surfaces but inside the same design system. The dropdown wraps like
    every other button in that row on narrow cards, and below 480px wide
    it switches to a fixed, full-width bottom sheet instead of a floating
    panel that could otherwise run off-screen. A small theme-matched
    toast confirms exactly what happened (opened + pre-filled / opened +
    "paste it in" / copied only) so the outcome is never ambiguous.
- **109 — Hid the page-level scrollbar on the home screen.** The home
  screen's content scrolls the page itself (`html`/`body`) rather than
  an internal `.xxx-body` pane, so it was picking up the app's shared
  `::-webkit-scrollbar` styling — a thin colored track/thumb pinned to
  the right edge — which read as a stray scroll rail rather than part of
  the page while scrolling up and down. `html`/`body` now suppress that
  scrollbar specifically (`scrollbar-width: none` +
  `::-webkit-scrollbar { display: none }`) while scrolling itself is
  untouched; internal panes like `.admin-body` and `.results-body` keep
  their own visible scrollbar as before.
- **108 — Replaced the remaining ⌛ hourglass emoji loading indicators with
  the app's standard SVG spinner.** The Admin Panel's "Manage Community
  Quizzes" loading state (`renderAdminManageCommunityPanel()` in
  `js/admin-panel.js`) and the merge-conflict picker's Community tab
  loading state (`_mergeLoadCommunityTab()` in `js/community-quizzes.js`)
  were still rendering a plain `&#8987;` emoji, out of step with every
  other loading state in the app, which uses the shared `sicon`/`hicon`
  spinner SVG with the `.spin` rotation class. Both now render that same
  spinner for visual consistency.
- **104 — Fixed raw `<svg ...>` markup rendering as literal text in the
  Export to PDF picker's source tabs, and in the exported PDF's own
  Contents page.** The Curriculum/Community/My Custom Quizzes tab
  buttons in the PDF export modal correctly showed their icons on first
  paint, but the moment a selection changed (or the tab switched), the
  count-refresh code that keeps the tab bar's `(N)` badges and active
  highlight in sync rewrote each button's label via `.textContent`
  instead of `.innerHTML`. `.textContent` doesn't render HTML — it
  prints it as literal text, so every tab immediately started showing
  its raw `<svg class="sicon" viewBox="0 0 24 24">...` markup instead of
  the icon. Separately, the same icon+label strings had been reused
  verbatim as plain text for the exported PDF's Table of Contents
  (`_pdxBuildOutline`, drawn with jsPDF's `doc.text()`), which can't
  render `<svg>` at all — every curriculum year/module and the
  "Community Quizzes"/"My Custom Quizzes" section headers were printing
  the raw tag straight into the downloaded PDF. Both were the same root
  cause: markup meant for `.innerHTML` ending up in a plain-text sink.
  Both were the same root cause: markup meant for `.innerHTML` ending up
  in a plain-text sink. A follow-up full-repo audit (every `.textContent =`
  assignment, every jsPDF `doc.text()`/`splitTextToSize()` call, plus
  `innerText`, `<option>`/`new Option()`, `alert()`/`confirm()`,
  `.title`/`aria-label`/`placeholder` attributes, `createTextNode`, and
  every accumulator variable — `errHtml`, `bodyHTML`, `finalHtml`,
  `msgsHTML` — that carries `<svg>` markup, tracing each through to its
  eventual write) turned up one more live instance: the "Move/Copy
  lecture" success message in the admin curriculum manager
  (`js/curriculum-admin.js`) had the exact same `.textContent` mistake —
  one line out of five status writes in that function, the other four
  already correct. Fixed the same way. No further instances found
  anywhere in the codebase.
  - **`js/dom-utils.js`**: added a new shared `SOURCE_TAB_ICONS` constant
    — `{ curriculum, community, custom }`, each `{ icon, label, full }`
    — as the single source of truth for these three tab icons, loaded
    before every screen that uses them (see script order in
    `index.html`). Previously the same icon markup was hand-duplicated
    in three files (and, for "My Custom Quizzes", had drifted into two
    *different* icons depending on which render path drew it — fixed by
    standardizing on the file icon used everywhere else in the app).
  - **`js/pdf-export.js`**: `_pdxSyncTabButtons()` now writes
    `.innerHTML` (not `.textContent`) and reads from `SOURCE_TAB_ICONS`;
    the modal's initial tab-bar markup does too. `_pdxBuildOutline()`
    now pushes plain text only (year/module/group names, no icon
    markup) — icons belong on-screen, never inside PDF-drawn text.
  - **`js/community-quizzes.js`**, **`js/admin-panel.js`**: the merge
    picker's and admin publish panel's source tabs now read from the
    same shared `SOURCE_TAB_ICONS` instead of their own hardcoded copies.
  - **`js/curriculum-admin.js`**: `.textContent` → `.innerHTML` for the
    Move/Copy lecture success message, matching the other four status
    writes in the same function.

- **103 — AI extraction: fixed questions/choices being dropped at page
  breaks.** Rule 9 (CROSS-PAGE CONTINUATIONS) in `CQ_EXTRACTION_PROMPT`
  already told Gemini that page breaks carry no semantic meaning, but two
  concrete failure patterns were still slipping through in practice: (a) a
  question whose stem and *some* choices end at the bottom of one page,
  with its *remaining* choices at the top of the next, coming back with
  only the choices that happened to be on the first page; and (b) a
  question whose stem is at the bottom of one page with *all* of its
  choices at the top of the next, getting dropped entirely because no
  single page showed a complete question. Rule 9 now names both patterns
  explicitly (as Pattern A and Pattern B) with the exact wrong-vs-correct
  behavior for each, adds an instruction to mentally stitch the bottom
  portion of every page directly onto the top portion of the next and read
  that as one uninterrupted block *before* extracting — not just for
  pages that already look cut off, but for every page transition in the
  document — and closes with an explicit final verification pass:
  re-check every page boundary for an orphaned stem (choices missing/
  incomplete) or orphaned choices (no stem above them) and merge before
  finalizing the output.
  - **`js/gemini-uploads.js`**: rewrote rule 9 inside `CQ_EXTRACTION_PROMPT`
    (used by `_extractQuestionsFromFile` in `js/ai-solve.js`, the only
    place this prompt is sent) — prompt-only change, no code paths, no
    response schema changes.
  - This is a prompt-engineering fix: extraction is still a single Gemini
    request per uploaded file (see "Extraction sends the whole source PDF
    to Gemini in a single request" above), so there's no page-by-page
    chunking step in the app itself to patch — the fix is making the
    model's own page-boundary handling more explicit and harder to skip.
    As with any LLM-based extraction, this improves reliability but isn't
    a hard guarantee; always skim the extraction review screen before
    saving, especially around page breaks in the source file.

- **100 — 💾 Backup tab can now export a designed PDF study booklet.** A
  third card, "🖨️ Export to PDF", sits below Export/Import and Community
  Quizzes/curriculum browsing in the Backup & Transfer modal. It opens a
  dedicated picker where a student can multi-select any mix of official
  curriculum lectures (whole years, whole modules, whole subjects, or
  individual lectures), community quizzes, and their own custom quizzes,
  choose a text size, an image size, and one of five colour themes with a
  live "decoy" preview (a mock sample page, not real content, that updates
  instantly as settings change), then generate a single PDF. The PDF
  itself is deliberately book-like: a full-bleed cover page (logo + site
  name + a summary of what's inside), a "What's inside" contents overview,
  and then Part/Chapter/Section/Sub-section dividers — curriculum picks
  are organized Year → Module → Subject → Lecture exactly the same way
  whether the person picked a whole year or a single lecture; community
  picks are grouped by year/module/subject when known (else by category);
  custom quizzes are grouped by their folder path (see **Collections**
  below). Every question shows its text, its image (if any) sized per the
  chosen setting, and its A–D options — **never the answer**. A single,
  colour-matched Answer Key section at the very end lists every answer
  grouped by the same chapter path the questions used, and the booklet
  always closes with a page carrying the site's QR code (scan to open the
  live app) beneath the logo. Every content page (except the cover and
  the closing QR page) carries a slim running header (logo mark, site
  name, current chapter breadcrumb) and footer (page number, a reminder
  that answers are at the end), stamped in one finishing pass once the
  full page count is known.
  - **`js/pdf-export.js`** *(new file)*: owns the entire feature —
    picker state (`_pdxSelCurriculum`/`_pdxSelCommunity`/`_pdxSelCustom`,
    all `Set`s), the Year/Module/Subject drilldown (mirrors the existing
    Merge-picker dropdown pattern in `community-quizzes.js`, plus "＋
    Whole Year/Module/Subject" one-click shortcuts that queue every
    lecture underneath instantly), the Community and Custom tabs (reusing
    `_allSharedQuizzes`/`ensureSharedQuizzesLoaded`, `loadCustomQuizzes`,
    `loadQuizCollections`/`_collectionPath`/`_quizCollectionChipHTML` —
    zero new data-layer code, 100% reuse of what backup-transfer-ui.js
    and community-quizzes.js already keep warm), the Look & Feel panel
    (text size / image size / theme swatches) with its live decoy
    preview, and the actual generation engine. The engine lazy-loads
    **jsPDF 2.5.1 from cdnjs** on first use — the exact same "only touch
    the network when the feature is actually used" pattern `pdf.js`
    already uses in `gemini-uploads.js` — so nothing is downloaded until
    someone presses "Generate PDF". Every question image (already a
    `data:` URL in the vast majority of cases thanks to `ensureInlineImages`,
    reused as-is here) is normalized through an offscreen canvas into a
    PNG before `addImage()`, sidestepping jsPDF's format-sniffing for
    PNG/JPEG/WEBP/GIF uniformly; any image that fails to load (bad URL,
    CORS, timeout) is silently skipped rather than failing the whole
    export, matching the app's existing best-effort image-healing
    philosophy. The brand mark is rasterized once at runtime from the
    exact same inline SVG markup already used for the favicon/header
    `.brand-mark`, so the logo can never drift out of sync with the rest
    of the site. Colour theming pulls five curated palettes straight from
    `css/styles.css`'s own design tokens (teal/violet/gold/forest/berry)
    — the person's chosen theme leads the cover and running header, and
    the remaining four automatically colour-code separate top-level
    sections (e.g. Year 1 vs. Year 2, or Curriculum vs. Community vs.
    Custom) so a large multi-source export reads as organized rather than
    one long grey wall of text.
  - **`js/backup-transfer-ui.js`**: added the "🖨️ Export to PDF" card
    (`openPdfExport()`) inside `renderBackupTransferModal()`; no other
    logic in this file changed.
  - **`index.html`**: added the `#pdfExportOverlay` modal shell (mirrors
    the existing `#backupOverlay`/`#mergeQuizOverlay` markup pattern) and
    the `<script src="js/pdf-export.js">` include, right after
    `backup-transfer-ui.js`.
  - **`css/styles.css`**: added the `.pdx-*` block — a responsive
    two-column layout (source picker left, settings + live preview right)
    that collapses to a single stacked column under 760px, reusing
    existing tokens/components wherever one already fit (`.admin-field`,
    `.comm-*` search/list classes, `.cq-quiz-item`, `.backup-quiz-row`,
    `.cq-btn`) so the new UI matches the rest of the app instead of
    introducing a parallel design language.
  - **`assets/qr-code.png`** *(new file)*: the site's QR code (scans to
    the live GitHub Pages URL), stamped on the closing page of every
    generated PDF.

- **99 — Publish Quizzes tab now supports multi-select, sequential batch
  publishing.** The "📤 Publish Quizzes" source picker (both "🤖 My Custom
  Quizzes" and "🌐 Community Quizzes") now lets an admin check any number
  of quiz cards — clicking a card toggles it in/out of the batch, other
  already-checked cards are untouched, and a card stays checked across a
  source-tab switch, so a batch can mix custom and community quizzes
  together. A "✓ N quizzes selected" bar (with a 🗑 Clear All) sits above
  the source list whenever anything's queued.
  - **`js/admin-panel.js`**: `adminSelectedQuiz` (a single quiz object) is
    replaced by `adminSelectedQuizzes`, a `Map` keyed by
    `${sourceType}:${sourceId}` (`_adminQuizKey()`) so selection order is
    preserved and a custom/community id collision is impossible.
    `adminSelectQuiz()` now toggles a key in/out of the map instead of
    always replacing it; `adminRemoveSelectedQuiz()` and
    `adminClearSelectedQuizzes()` cover the per-row ✕ and the bulk clear.
    `renderAdminAssignForm()` branches on selection size: exactly one
    queued quiz keeps the original single-quiz form (title, "✏️ Edit
    Before Publishing", editable Lecture Name field) completely
    unchanged; two or more render a batch summary listing each queued
    quiz with its own ✕, a total question count, and a note that each
    publishes under its own title. "Edit Before Publishing" is
    unavailable once 2+ quizzes are queued (editing only ever applied to
    one quiz at a time) and closes automatically the moment a second quiz
    gets checked.
  - **`js/quiz-editor.js`**: `adminPublishQuiz()`'s original single-quiz
    publish body was extracted into `_adminPublishOneQuiz()`, a pure
    "publish this one quiz object" helper with no DOM/selection-state
    dependency, so it can be called safely in a loop. `adminPublishQuiz()`
    itself now branches on how many quizzes are queued: exactly one keeps
    the exact original behavior (stays selected after a successful
    publish, so it can be republished elsewhere immediately). Two or more
    publish **sequentially** — each quiz is fully awaited before the next
    one starts, never in parallel, so writes can't race each other or the
    shared curriculum-order lookup. Progress shows "Publishing i/N:
    'title'…"; a quiz is only removed from the queue once its own publish
    succeeds, so a mid-batch failure leaves just the not-yet-attempted and
    failed quizzes still checked (ready to retry) while everything before
    it is already safely published, and the final status line reports
    exactly how many of the batch succeeded plus which ones failed and
    why. When the admin picked a "publish before/after this lecture"
    insert spot, an `"after X"` placement chains off the quiz just
    published (instead of re-targeting `X` every time), so a multi-quiz
    batch lands in the exact order it was selected in rather than
    reversing; `"before X"` already chained correctly with no change
    needed.
  - **`css/styles.css`**: added `.admin-selection-bar` (the persistent
    "N selected" bar) and `.admin-multi-quiz-list`/`-row`/`-info`/`-title`/
    `-meta`/`-remove` (the batch summary rows), reusing the existing
    admin-panel color tokens and the same `flex-wrap` responsive pattern
    already used by `.admin-quiz-item`, so both scale down cleanly on
    narrow screens without a dedicated media query.

- **98 — Admin Publish tab now browses Collections, not just a flat
  list.** The "📤 Publish Quizzes" tab's "🤖 My Custom Quizzes" source
  picker reuses the exact same folder tree/breadcrumb UI as the
  student-facing "🤖 Custom Quizzes" modal (see **Collections**,
  changelog **#85**) — same sidebar with nested folders, same drag-a-card-
  onto-a-folder or 📁 Move-button filing, same folder create/rename/
  recolor/re-icon/delete menu — so an admin can find and file a quiz to
  publish exactly the way they'd browse it as a student, instead of
  scrolling one long flat list.
  - **`js/quiz-collections.js`**: this file's entire folder tree UI was
    written assuming a single caller (`renderCustomQuizModal()`). It's now
    shared by two hosts, so every internal re-render call goes through a
    new `_cqRerenderCollectionsUI()` indirection instead of calling
    `renderCustomQuizModal()` directly; a `cqCollectionsHost` flag
    (`'custom'` | `'admin'`), set at the top of each host's own render
    function every time it runs, decides which one actually gets
    re-rendered. No other behavior changed — folders, drag/drop, the
    delete-folder modal, etc. all work identically from either screen.
  - **`js/admin-panel.js`**: `renderAdminPanel()`'s "custom" source branch
    now renders `renderCqCollectionsSidebarHTML()` +
    `renderCqBreadcrumbHTML()` + the folder-filtered quiz list (via
    `_filterQuizzesByActiveCollection()`) instead of a flat
    `loadCustomQuizzes()` map. Each admin quiz card keeps its original
    click-to-select + ✓ check (that part of the workflow — picking which
    quiz to publish — didn't change), and gained a drag handle and a
    compact 📁 move button reusing `_renderQuizMoveMenuHTML()`.
  - **`css/styles.css`**: widened `.admin-modal` (640px → 820px) to give
    the folder sidebar + quiz list room to sit side by side the way they
    do in the wider Custom Quizzes modal — it still stacks into a
    full-width drawer below 720px, same responsive breakpoint the
    Collections layout already used. Added `.admin-quiz-list-collections`
    (the folder layout owns its own height/scrolling, so the old fixed
    240px scroll box is dropped only for this view) and a compact
    icon-only `.admin-quiz-move-btn` sized to match the existing card
    design instead of reusing the modal's larger labeled Move button.

- **97 — Replaced the entire hash-addressed R2 image system (#91–#96)
  with inline images: every question's image now lives directly inside
  its own quiz/lecture JSON, as a `data:` URL, exactly like any other
  field.** No more separate image objects, no content hashing, no
  refcounting, no dedup, no reference-linking — an image is just part of
  the content it belongs to, saved and deleted along with it. This
  removes an entire class of bug this session kept finding new instances
  of (#91, #92, #95's leak, #96's redundant round-trip): a "saved"/
  "published" copy secretly still depending on some other item's storage
  staying alive. That dependency can no longer exist, by construction.
  - **`worker-index.js`**: removed `incrementImageRefcount()`,
    `decrementImageRefcountAndMaybeDelete()`, `sha256Hex()`, the entire
    image-hash PUT branch, and the DELETE handler's per-image release
    logic. PUT now just writes whatever JSON the client sends; DELETE
    just deletes it. ~30% shorter. Also fixed a real (previously latent)
    bug surfaced while building the migration tool below: the community
    write path unconditionally stamped `authorUid` to whoever's currently
    writing — harmless while only an author could ever rewrite their own
    quiz, but it would have silently reassigned authorship to whichever
    admin ran a bulk migration. `authorUid` is now only set on a
    genuinely new quiz; an existing quiz's authorship is preserved
    regardless of who (author or admin) is currently writing to it.
  - **`content-client.js`**: `putContentItem()` is now a plain write —
    removed all per-image upload/reference logic and `r2ImageUploadUrl()`.
  - **`firebase-storage.js`**: renamed `downloadRemoteQuizImages()` →
    `ensureInlineImages()` — the one canonical "make sure every image is
    a local `data:` URL" step, now called before every write path in the
    app (save, merge, share, publish, rename, swap order, split, move)
    rather than just "Save to Mine"/merge. The old legacy Firestore-
    subcollection custom-quiz image code (`hydrateQuizImages`'s sentinel
    resolution, already-dead `uploadQuizImagesToStorage`) is untouched —
    a separate, already-obsolete system from before local custom quizzes
    moved to IndexedDB, unrelated to this conversion.
  - **`user-profile.js`**: deleted the dead, already-unused legacy
    `uploadImageToR2`/`uploadSharedQuizImages`/`deleteSharedQuizImages`/
    `uploadPublishedLectureImages`/`deletePublishedLectureImages`
    functions (superseded by `content-client.js` well before this session).
  - **`sharing.js`, `community-quizzes.js`, `quiz-editor.js`,
    `curriculum-admin.js`, `split-quiz.js`, `backup-transfer-ui.js`**:
    every write path updated to call `ensureInlineImages()` first and to
    stop referencing the removed refcount/reference-hash machinery in
    comments. Stripped the now-meaningless `__previousImageUrl`
    bookkeeping from `quiz-editor.js`'s published-lecture edit flow —
    replacing an image is just overwriting a field now, nothing to release.
  - **Migration tool** (new, in `js/admin-panel.js`'s "👑 Manage Admins"
    tab, super-admin only): "▶️ Migrate all images to inline storage"
    walks every published curriculum lecture and every community quiz,
    inlines any question still pointing at an old separately-hosted
    image, and re-saves only the ones that needed it. Safe to re-run —
    already-migrated content is skipped with no write. This is what
    makes existing content actually use the new system, not just new
    writes going forward.
  - **Cleanup tool** (new: `POST /_admin/sweep-legacy-images` in
    `worker-index.js`, plus `firestoreListCollection()` in
    `lib/firebaseAdmin.js` to support it, plus a "🧹 Delete old image
    storage" button in the same admin panel): once migration confirms
    nothing depends on the old system anymore, permanently deletes every
    leftover `imageRefcounts/{hash}` doc and its R2 object. Destructive,
    irreversible, and deliberately gated to the super-admin account
    specifically (not the broader admin roster) — double-confirmed on
    the client before it's ever called.
  - **Tradeoff, stated plainly**: inline images can no longer be
    deduplicated across different quizzes/lectures (the whole point of
    #95's dedup was cross-item sharing) — the exact same image used in
    two places now costs storage twice. In exchange, the entire
    orphan-leak/duplicate-storage/reference-linking bug class this
    session kept encountering is structurally impossible from here on.

- **96 — Closed the follow-up flagged in #95: publishing a community quiz
  to curriculum no longer downloads and re-uploads the image over the
  network at all.** #95 made the Worker dedupe by content hash, so a
  published lecture's image never gets stored twice — but the browser
  was still doing a full round trip for nothing: fetching the source
  image into memory and re-uploading the identical bytes, only for the
  Worker to discard them and just link to the existing object. Removed
  that entirely.
  - **Worker** (`worker-index.js`): the image PUT route now also accepts
    an `X-Reference-Hash` header in place of a request body — "link this
    already-existing image, no bytes needed." Only accepted for a hash
    that's already tracked with a known `ownerKey` (see #95); a malformed
    hash or one with no backing object is rejected with `400`, so a
    client can never inflate a refcount for bytes nobody actually
    uploaded to this server.
  - **Client** (`content-client.js`): `putContentItem()` now branches on
    the image's current value — `data:` URL → uploads the bytes (genuinely
    new); already `${WORKER_BASE_URL}/.../images/...` → sends the hash
    alone via `X-Reference-Hash`, no body, no download; anything else is
    left untouched (shouldn't occur in this app, since every image is
    always one of those two things).
  - **Admin publish flow** (`quiz-editor.js`): removed the
    `downloadRemoteQuizImages()` call #92 added before publish — no
    longer needed, since `putContentItem()` now handles an already-
    self-hosted image URL directly. A community quiz's image is never
    downloaded into the browser at all during publish anymore; it goes
    straight from "community's R2 URL" to "linked into the curriculum
    lecture" via one lightweight, bodyless request.
  - #91's and #93's downloads are unaffected and still necessary — those
    save to *local* IndexedDB storage, which has no concept of "reference
    an existing server-side hash," so an actual local copy of the bytes
    genuinely has to exist on-device for those paths.

- **95 — Fixed: publishing a community quiz to curriculum (#92) stored a
  full duplicate copy of every image, and the image-refcount system had
  a latent bug that could permanently leak one of the two copies in R2
  regardless.** `imageRefcounts/{hash}` (`worker-index.js`) only ever
  tracked a raw `count`, never *where the bytes physically live* — but
  R2 object keys are scoped per item (`{r2KeyPrefix}/images/{hash}.ext`),
  not globally by hash. So when #92 made publish-from-community re-upload
  the source image (to make the published lecture independent), the
  Worker's dedup check (`head()` on this item's own path) could never
  find the byte-identical copy already sitting under the *community*
  post's own prefix — it always wrote a second physical copy. Worse: the
  shared, prefix-blind refcount meant that even with two copies existing,
  deleting either the community post or the curriculum lecture first
  would silently decrement the *shared* count without necessarily
  deleting anything at that item's own path — permanently orphaning
  whichever copy's "turn" never came up, with no record left once the
  count reached zero.
  - `imageRefcounts/{hash}` now also records `ownerKey`: the R2 key that
    *actually* holds this hash's bytes, set once on first write and never
    changed after. `incrementImageRefcount()` takes this as a parameter;
    `decrementImageRefcountAndMaybeDelete()` deletes from the recorded
    `ownerKey` instead of assuming the deleting item's own prefix —
    correct regardless of which item created the object or which one
    happens to be the last to release it.
  - The PUT image-upload handler now checks the refcount doc *first*: if
    `ownerKey` is already set (this item's own upload, or a completely
    different item that happened to upload byte-identical bytes), it
    just points at the existing object and bumps the count — **no bytes
    are written a second time**. A hash with no tracked owner yet (a
    genuinely new image, or a legacy doc from before this fix) falls back
    to a `head()` check on this item's own path before deciding a write
    is actually needed, then records itself as the owner going forward.
  - Fully backward compatible: every refcount doc created before this
    fix has no `ownerKey`, so its cleanup behavior is unchanged (delete
    from the deleting item's own prefix) — correct for all of them, since
    no hash was ever shared across items before #92 existed anyway. Only
    hashes uploaded from this point forward get real cross-item dedup.
  - **No client-side changes were needed at all** — `putContentItem()`
    (`content-client.js`) already just uses whatever `key` the server
    returns as the image's final URL, so a deduped response pointing at
    a different item's existing object works transparently. The client
    still re-fetches and re-uploads the source image's bytes over the
    network during publish (same as #92) — the Worker just no longer
    stores or counts them a second time. Skipping that redundant network
    round-trip entirely (detecting a same-origin source URL and sending a
    lightweight "reference this hash" request instead of the full image
    bytes) would need a small new endpoint; flagging it as a possible
    follow-up rather than folding it in here, since it's a bandwidth
    optimization on top of an already-correct storage fix, not a
    correctness fix itself.

- **94 — Fixed the actual root cause of the backup-export image bug (#93
  was a real but secondary fix — this is the one that mattered): the
  downloaded backup `.json` file itself could come out truncated/
  corrupted whenever it included images, even for a brand-new quiz whose
  image was already a clean local `data:` URL from the moment it was
  saved.** `downloadExportFile()` (`local-store.js`) built the file as a
  Blob and triggered its download via a detached `<a>` element, then
  called `URL.revokeObjectURL(url)` *synchronously*, immediately after
  `.click()` — before the browser had necessarily finished reading the
  Blob and writing it to disk. For a small, text-only payload that race
  is essentially always won invisibly; the moment a quiz has an embedded
  base64 image (easily hundreds of KB to a few MB, and typically
  serialized near the end of its question), it becomes a real race, and
  losing it truncates or corrupts exactly the image data — independent
  of whether that image was ever remote, so completely unrelated to
  #91/#92/#93. This is why testing with a fresh, already-healthy quiz
  still showed a broken image in the downloaded file.
  - `downloadExportFile()` now attaches the `<a>` to the document before
    `.click()` (some browsers only reliably trigger a download-via-anchor
    when it's actually in the DOM) and delays `URL.revokeObjectURL()` by
    4 seconds instead of calling it synchronously — the standard
    mitigation for this exact "download started, Blob revoked before it
    finished being read" race, since there's no browser event for
    "the download fully read the Blob."

- **93 — Fixed: the same "broken image icon" bug could also surface in a
  downloaded backup file (and on re-import), even for quizzes that looked
  fine in the app.** #91/#92 made "Save to Mine," "Merge Quizzes In," and
  admin-publish-from-community all pull remote images down into a local
  `data:` URL at save time — but that download is intentionally
  best-effort and silent on failure (a transient network hiccup, the
  Worker briefly unreachable, etc.), so an image could still end up
  saved with a live `http(s)://` URL rather than a truly local copy. The
  backup/export path (`_backupDoExport` → `buildExportPayload()` in
  `local-store.js`) never re-checked this — it just serialized whatever
  was already sitting in IndexedDB — so a still-remote image got baked
  straight into the downloaded `.json` file. That file is meant to be a
  fully self-contained, restore-anywhere-anytime backup, but a baked-in
  remote URL quietly re-introduces the exact same dependency on the
  original community/curriculum post surviving, just relocated to
  whenever the backup is later restored (often long after the original
  source is gone).
  - Added `_backupHealQuizImages()` (`backup-transfer-ui.js`) — scans a
    given list of already-loaded quizzes for any question still pointing
    at a remote image, and re-runs `downloadRemoteQuizImages()` (the
    same helper from #91) on it, persisting the repair back to IndexedDB
    via the normal `saveCustomQuiz()` write path.
  - **Export**: `_backupDoExport()` now calls this (via
    `_backupHealSelectedQuizImages()`) on whichever quizzes are actually
    selected for the export, right before the file is built — giving any
    still-remote image one more chance to be pulled down while its
    source might still be reachable, before it's locked into a portable
    file.
  - **Import**: `_backupDoImport()` now also runs a repair pass
    (`_backupHealAllQuizImagesAfterImport()`) across every on-device
    quiz right after applying an imported payload — this catches a
    backup file that was itself exported from another device/session
    before it ever got healed, and, as a side effect, opportunistically
    repairs any older quiz on this device that predates #91/#92 too.
  - Both passes are best-effort and silent per-image, same as the helper
    they call: if a source image is already gone by the time healing
    runs, that question is no worse off than before this fix — it's
    still a broken image icon, just not a new failure mode.

- **92 — Fixed: the same "broken image icon" bug from #91 was still
  reachable through a path #91 didn't cover — an admin publishing a
  community-sourced quiz to the official curriculum.** `adminPublishQuiz()`
  (`quiz-editor.js`) wrote the new curriculum lecture straight from the
  community quiz's questions, and `putContentItem()` (`content-client.js`)
  only re-uploads an image if it's still a `data:` URL — a community
  question's `q.image` is already a *resolved* `https://` R2 URL by that
  point, so it was skipped and left pointing at the community post's own
  storage (`community/{sharedId}/images/{hash}.*`, governed by that post's
  own image refcount — see #91). Net effect: any officially published
  lecture created from a community quiz stayed silently dependent on that
  original community post never being edited or deleted — and since a
  published lecture is visible to every student, not just the one who
  imported it, this was the more consequential version of the same bug.
  The same gap existed whether or not the admin used "✏️ Edit Before
  Publishing" first — `adminToggleEditBeforePublish()`
  (`admin-panel.js`) clones `adminSelectedQuiz.questions` into a working
  copy with no hydration step at all, so a stale inline comment claiming
  those images were "already inline as data URLs" was simply wrong for a
  community source.
  - `adminPublishQuiz()` now calls the same `downloadRemoteQuizImages()`
    helper #91 added (`firebase-storage.js`) unconditionally, right before
    `putContentItem()`, regardless of which branch produced `questions` —
    every remaining remote image is pulled down into a real local `data:`
    URL first, so `putContentItem()`'s existing upload step re-hosts it
    fresh under the new lecture's own `curriculum/` prefix. A quiz
    selected for publishing here is always a custom or community source
    (never an already-published curriculum lecture — see
    `adminSelectQuiz()`), so this can never mistakenly re-upload an
    already-owned curriculum image.
  - **Not automatically retroactive**: this only protects lectures
    published *after* this fix. A curriculum lecture published from a
    community quiz *before* this fix may already have a live dependency
    on that community post; if so, re-publishing it (with the source quiz
    still available) re-runs it through the fixed path and makes it
    independent. Let us know if a bulk repair pass across existing
    lectures would help and it can be added as a follow-up admin tool.

- **91 — Fixed: a community quiz's images disappeared (broken image icon)
  from your own saved copy once the original share was deleted.** "Save to
  Mine" (`importCommunityQuiz`) and "🧩 Merge Quizzes In" both cloned a
  community quiz's question text into your own quiz, but left `q.image`
  pointing straight at that quiz's own R2-hosted image URL
  (`community/{sharedId}/images/{hash}.*`) instead of an actual local
  copy. Those images are only kept alive by that *specific* community
  post's own image refcount (`worker-index.js`'s `decrementImage
  RefcountAndMaybeDelete`) — nothing ever bumped that refcount for a
  saved/merged-in copy, since no such copy re-uploads or re-references the
  image at all. So the moment the original author (or an admin) deleted
  the shared quiz, its refcount dropped to zero, the Worker deleted the
  R2 object outright, and every "independent" saved/merged copy that
  still pointed at that same URL was left with a dead link.
  - Added `downloadRemoteQuizImages()` (`firebase-storage.js`, alongside
    `hydrateQuizImages`/the new shared `_urlToDataUrl()` helper both now
    use) — fetches any still-remote (`http(s)://`) question image and
    resolves it to a real local `data:` URL in place. Already-local
    (`data:`) images and image-less questions are left untouched.
  - `importCommunityQuiz()` (`sharing.js`) now calls it right before the
    quiz is written to `Your Custom Quizzes`, so the saved copy's images
    live inline in this device's IndexedDB from that point on — exactly
    like any other custom quiz's images — with zero remaining dependency
    on the community post they came from.
  - `confirmMergeSelectedQuizzes()` (`community-quizzes.js`) — the "🧩 Merge
    Quizzes In" picker had the identical gap for community-sourced
    questions merged into an existing quiz/lecture; fixed the same way,
    and corrected a stale comment on `_mergeCloneQuestions()` that had
    incorrectly claimed this was already handled.
  - Deliberately *not* a Worker/refcount-side fix: the app already has a
    working, unused-until-now local-storage path for custom quiz images
    (plain inline `data:` URLs in IndexedDB — see `local-store.js`), so
    the fix reuses that existing architecture instead of adding a new
    server-side dependency for something that only needs to happen once,
    client-side, at save time.

- **90 — Fixed two bugs in the custom-quiz Collections folders: picking a
  color visibly did nothing, and picking a new color/icon reset the
  folder-tree scroll position back to the top.**
  - **Color had no visible effect**: the sidebar's folder icon applied the
    chosen color via CSS `color` on the emoji glyph itself — but color
    emoji (📁, 🧬, 🩺, etc.) are rendered as fixed full-color glyphs by the
    browser/OS and simply ignore the `color` property, so the swatch was
    saved correctly (its "selected" ring in the picker updated fine) but
    never showed up anywhere. Fixed by giving `.cq-coll-icon` a proper
    padded, rounded shape and applying the chosen color as a background
    tint + inset border instead (`color-mix(...)`, same technique already
    used successfully by the quiz-card folder chip) — the same approach
    that already worked for chips now also works for the tree icon.
  - **Folder tree jumped to the top on every color/icon pick**: `.cq-coll-
    sidebar` is its own independently-scrollable box (`overflow-y: auto`),
    but `renderCustomQuizModal()` rebuilds the *entire* modal body's
    `innerHTML` on every change, including this sidebar — with no scroll
    position ever saved or restored, so scrolling down to a folder further
    down the list and picking a color/icon on it snapped the whole tree
    back to the top. Fixed the same way `renderAdminQuestionEditor()`
    already handles this for its own question list: capture `.cq-coll-
    sidebar`'s `scrollTop` immediately before the rebuild, restore it
    right after.

- **89 — Fixed: deleting an answer choice left the remaining choices
  mislettered (e.g. deleting B out of A/B/C/D left A, C, D instead of
  relettering to A, B, C).** All three places a choice can be deleted —
  the admin question editor, the custom-quiz editor (`quiz-editor.js`),
  and the AI-generation/extraction review screen (`ai-solve.js`) — removed
  the option from `options`/`optionsOrder` but never re-sequenced the
  letters of what was left, so gaps accumulated with every deletion and a
  question could end up displaying choices "A, C, F" instead of a clean
  run starting at A.
  - Added a shared `relabelOptionsSequentially()` helper (`app-core.js`,
    next to `getOptionEntries()`) that all three delete-option functions
    now call: it walks the question's remaining choices in their existing
    order and reassigns clean, contiguous `A, B, C…` keys, rewriting both
    `options` and `optionsOrder` and carrying `answer` along to whatever
    new letter the correct choice lands on — including when the deleted
    choice *was* the correct answer (the existing "pick the first
    remaining option" fallback now also gets relettered correctly instead
    of keeping its old, possibly non-`A` letter).
  - No visual/markup changes — this is a data-layer fix, so the existing
    responsive layout of the answer-choice rows (wrapping flex rows that
    already adapt to narrow/mobile widths) is untouched.

- **88 — Fixed: sharing a quiz to the community always failed with 403
  Forbidden for anyone who wasn't a `community`-permission admin.**
  `worker-index.js`'s PUT authorization for `community/` keys required
  *either* `isCommunityAdmin()` *or* `isCommunityQuizAuthor()` to pass —
  but a brand-new share has no prior R2 object to check authorship
  against, so `isCommunityQuizAuthor()` always returned `false` for it,
  and an ordinary student is never a roster `community` admin either.
  Net effect: **no non-admin user could ever create a new community quiz
  at all** — only re-save one they already owned (once build 87 also
  fixed the `.json`-suffix bug that had broken even that). Fixed by
  allowing the write through when the target key doesn't exist in R2 yet
  (i.e. this *is* the first share) — the author/admin gate still applies
  in full to every subsequent edit of an already-shared quiz.
  - **Closed the resulting spoofing gap**: since any signed-in user can
    now create a *new* community entry, the Worker now overwrites
    whatever `authorUid` the client sent with the verified caller's real
    uid before writing (previously only claimed in a comment in
    `js/sharing.js`, never actually done in `worker-index.js`) — so no
    one can claim authorship of a quiz under someone else's uid, whether
    sharing for the first time or editing later.
  - **If you're re-testing build 87's delete fix and still saw the exact
    same "Firestore nested PATCH failed" error**: that fix lives entirely
    in `worker-index.js`/`lib/firebaseAdmin.js`, i.e. the Cloudflare
    Worker, not the static frontend — pushing the updated files to GitHub
    Pages alone doesn't update it. Re-run your Worker deploy step (e.g.
    `wrangler deploy` from the project root) and retry.

- **87 — Fixed: admins couldn't delete certain community quizzes ("Firestore
  nested PATCH failed: Invalid property path").** Deleting a community quiz
  bumps a version marker off in `appConfig/sharedQuizzesManifest.quizzes
  [quizId]` (`lib/firebaseAdmin.js`: `clearManifestVersion()` →
  `firestoreSetNestedField()`) so every reader gated on that manifest drops
  the quiz from its cache. The old implementation targeted that one nested
  field via Firestore's REST `updateMask.fieldPaths` syntax — a dotted,
  backtick-quoted string built from the quiz ID. That syntax can't represent
  every string an ID might contain; a quiz whose ID happened to reduce to a
  single `` ` `` character reliably 400'd no matter how it was quoted or
  escaped, and — because the quiz's actual content had already been deleted
  from R2 by that point in the request — the admin saw a **"Delete failed"**
  error for a quiz that was, in fact, already gone (it just never dropped
  out of the manifest, so it kept reappearing in the list).
  - **Root fix**: `firestoreSetNestedField()` no longer builds a dotted
    field-path string at all. It now reads the whole top-level map
    (`quizzes` or `subjects`), mutates the target key in plain JS, and
    writes that single top-level field back with `firestorePatchDoc()`.
    Firestore map keys accept any string with zero escaping, so this works
    regardless of what characters end up in an ID.
  - `jsToFirestoreValue()` (same file) gained proper recursive map/array
    support (previously only primitives were handled; anything else fell
    back to a stringified-JSON blob) so a whole nested map can round-trip
    through a single PATCH correctly.
  - `clearManifestVersion()` no longer lets a manifest-bookkeeping error
    fail the whole delete request — by the time it runs, the R2 content is
    already gone, so the delete has already succeeded either way. Any
    reader with a stale manifest entry still self-heals on its next fetch
    (existing 404-and-prune behavior in `js/community-quizzes.js`).
  - **Also fixed while in this code path**: `worker-index.js`'s community
    write/delete authorization checks derived `communityQuizId` straight
    from the URL key without stripping its `.json` suffix, so
    `isCommunityQuizAuthor()` was always looking up a nonexistent
    double-suffixed R2 key (`community/<id>.json.json`) and returning
    `false` — meaning a quiz's own author (not just a community admin)
    could never save or delete their own shared quiz. Both checks now
    strip `.json` before the lookup.

- **86 — Collections follow-up: collapsible sidebar, a working Move button,
  merge-by-name on import, and a real choice when deleting a folder.**
  - **Sidebar is now collapsible on desktop too**, not just as the existing
    mobile drawer. A new ◂ button in the sidebar header (`js/quiz-
    collections.js`: `cqToggleSidebarCollapsed()`, persisted via
    `localStorage`) hides the whole folder column so the quiz list can use
    the full width; a "📁 Show Folders ▸" pill brings it back. This is
    fully independent of the existing sub-720px "📁 Browse Folders" drawer
    toggle, so each breakpoint keeps its own natural collapse behavior.
  - **Fixed: the 📁 Move button (and the bulk "Move to…" button) did
    nothing.** Root cause: `renderCustomQuizModal()` fully replaces
    `customQuizBody`'s `innerHTML` on every state change. Clicking Move
    opened its dropdown and re-rendered — but the *same click* then
    bubbled to the document-level "close popover on outside click"
    listener in `js/quiz-collections.js`. Since the original button had
    just been detached from the DOM by that re-render, the listener's
    `contains()` checks against it always failed, so it immediately closed
    the popover that had just opened. The ⋮ collection-menu button already
    guarded against exactly this with `event.stopPropagation()`; the Move
    buttons in `js/firebase-storage.js` didn't. Added it to both.
  - **Deleting a folder now offers a real choice**, via a proper two-step
    modal (`cqDeleteCollection()` and friends in `js/quiz-collections.js`,
    reusing the app's existing `.qm-*` modal styling) instead of a single
    `confirm()`: **"Just remove this folder"** (the original, non-
    destructive behavior — subfolders move up, quizzes become
    Uncategorized) or **"Delete everything inside"**, which permanently
    removes the folder, every nested subfolder, and every quiz filed
    anywhere inside it. The destructive option requires a second, explicit
    confirmation screen spelling out exactly what's about to be deleted
    before anything happens.
  - **Backup import now merges collections by name on 'merge' mode**,
    instead of always creating a duplicate folder. `importCollections
    AndQuizzes()` in `js/local-store.js` resolves the incoming tree
    parent-first (so nesting is never ambiguous regardless of array
    order); an incoming folder that shares both a name and a resolved
    position in the tree with an existing one is folded into it rather
    than duplicated, so quizzes from both sides end up filed together in
    the one surviving folder. A same-named folder at a *different* point
    in the tree, or a "replace"-mode import, still gets a fresh folder as
    before. The import result panel in `js/backup-transfer-ui.js` now
    reports merged vs. newly-restored collection counts separately.

- **85 — Collections: nested folders for Custom Quizzes, with drag-and-drop.**
  You can now organize your custom quizzes into folders — and folders inside
  folders, to any depth — from a new tree sidebar in the "Your Custom
  Quizzes" modal.
  - **Data model** (`js/local-store.js`): a new `quizCollection` IndexedDB
    entity — `{ id, name, parentId, icon, color, order, createdAt }` — lives
    entirely on-device, never Firestore, exactly like the quizzes
    themselves. A quiz opts into a folder via its own `collectionId` field;
    no field (or a `collectionId` whose folder was deleted) just means
    "Uncategorized." Collections don't store their own quiz list — the quiz
    points at its folder — so moving or deleting a quiz never touches a
    collection document.
  - **New module** `js/quiz-collections.js` is the whole UI/state layer: a
    recursive tree renderer, a breadcrumb, and every action (create, inline
    rename, delete-with-promote, recolor, re-icon). It mirrors the existing
    load-cache/save-and-recache pattern `js/firebase-storage.js` already
    used for the quizzes themselves, so the two caches
    (`window._cachedCustomQuizzes` / `window._cachedQuizCollections`) never
    drift out of sync mid-session.
  - **Drag-and-drop**: drag a quiz card onto any folder in the sidebar (or
    onto "Uncategorized") to file it there; drag a folder onto another
    folder to re-nest it, or onto "All Quizzes" to move it back to the top
    level. Dropping a folder into its own subtree is rejected with a
    friendly message instead of silently corrupting the tree. Every quiz
    card also has a non-drag 📁 **Move** button (and multi-selected quizzes
    get a bulk "Move to…") for touch devices and anyone who'd rather not
    drag.
  - **Deleting a folder** never deletes a quiz: subfolders move up to become
    children of the deleted folder's own parent, and any quiz filed
    directly inside becomes Uncategorized. The confirm dialog spells out
    exactly what will happen before you commit.
  - Each folder gets a customizable icon (curated emoji set) and color,
    picked from a small popover on its ⋮ menu; the active color/icon shows
    up as a chip on every quiz card filed inside it (and in the community
    merge-quiz picker, for context).
  - **Wired into every quiz-creation path**: AI-generated quizzes, hand-
    written quizzes, and community quiz imports land in whichever folder
    you're currently browsing; splitting a saved custom quiz into parts
    files the new parts into the *source* quiz's own folder. Backups
    (`buildExportPayload()`/`applyImportPayload()`/the new
    `importCollectionsAndQuizzes()`, all in `js/local-store.js`) carry the
    full folder tree alongside the quizzes, remapping ids so the hierarchy
    — and each quiz's placement in it — survives a round trip to another
    device.
  - Fully responsive: the sidebar is a fixed column beside the quiz list on
    wide screens, and collapses to a "📁 Browse Folders" drawer above the
    list below 720px, matching the rest of the app's mobile breakpoints.

- **84 — Fixed the flowchart hint text overlapping the subject toggle list
  below it.** In build 83's new Curriculum Breakdown, the "Tap a subject to
  see every quiz taken for it in this module." hint (`.flow-hint` in
  `css/styles.css`) had a negative bottom margin (`margin: 2px 0 -2px`),
  left over from an early layout pass — it pulled the first subject card
  right up underneath the hint text instead of sitting cleanly below it.
  Replaced with proper positive spacing (`margin: 10px 0 4px`) and gave
  `.quiz-toggle-list` its own small top margin as a defensive spacer, so the
  hint and the subject cards never crowd each other regardless of subject
  name length or how many wrap onto a second line. No JS touched, no other
  layout affected — purely this one rule in `css/styles.css`.
- **83 — Statistics now break down by Year → Module → Subject, with a
  dynamic drill-down flowchart and per-subject/per-module "toggle menu" of
  the actual quizzes behind each number.** Previously, Statistics only
  tracked a flat `subject` label per quiz attempt — with no record of which
  Year or Module it was taken under. Since the same subject can legitimately
  appear in more than one Module (curriculum content is reused, not
  duplicated, across modules — see `curriculum[year][module]` in
  `js/app-core.js`), this meant two quizzes on, say, "Biochemistry 1" taken
  for two different modules were silently merged into one number, with no
  way to tell them apart.
  - Every quiz attempt now snapshots its real curriculum context the moment
    it starts (`currentQuizYear` / `currentQuizModule` / `currentQuizComponents`
    in `js/app-core.js`), and `saveQuizStats()` stores it on the history
    entry (`year`, `module`, `components`, `source`). Combined multi-subject
    quizzes keep a per-subject lecture breakdown too
    (`currentQuizComponents`), since the app already only ever lets you
    combine lectures from subjects within one Year+Module at a time
    (`selectYear()`/`selectModule()` clear the selection whenever either
    changes) — so this was safe to snapshot once per quiz. A single-quiz
    Retake now correctly inherits its original quiz's Year/Module instead
    of whatever was last browsed (`retakeSingleQuiz()`); a combined Retake
    across several different original quizzes gets its own dedicated
    "Retake Sessions" bucket instead, since there's no single Year/Module to
    attribute it to. Custom and Community quizzes explicitly clear the
    curriculum context so they can't accidentally inherit stale state either.
  - The Statistics modal replaces the old flat "Subject Performance" list
    with a new **🗂 Curriculum Breakdown** section: a dynamic flowchart
    (`buildCurriculumStatsTree()` + `_renderCurriculumFlow()`) whose top row
    is every Year you've studied (sized by quiz count, colored by
    accuracy) — click one to reveal its Modules, click a Module to reveal
    its Subjects. Every Subject is its own collapsible **toggle menu**
    (`_makeQuizToggleCard()`), named by subject and expandable to show every
    individual quiz title, date, and score taken for that subject *within
    that specific module* — directly solving the "which module was this
    subject's quiz actually from" ambiguity. A new **📦 Other Quiz Sources**
    section gives the same toggle-menu treatment to Custom Quizzes,
    Community Quizzes, Retake Sessions, and (for full backward compatibility)
    any older history entry recorded before this change, which simply has no
    year/module and lands in an "Unspecified" bucket rather than breaking.
  - The flat "🕐 Quiz History" list is untouched and still shows everything
    chronologically — it and the new toggle menus now share one
    `_makeHistoryItem()` builder (including the Retake button) instead of
    duplicating that markup.
  - Deliberately **not** a new incrementally-maintained aggregate: the whole
    Year/Module/Subject tree is computed fresh from `history` every time the
    modal renders, so it can never drift out of sync with the real data and
    needed zero changes to Backup Export/Import — `buildExportPayload()` /
    `applyImportPayload()` in `js/local-store.js` already serialize every
    field on each history entry generically, so the new `year`/`module`/
    `components`/`source` fields travel with a backup automatically, merge
    correctly by attempt ID on import, and a restored backup renders the
    exact same breakdown it would have shown on the original device.
  - New responsive CSS only (`.flow-*`, `.quiz-toggle-*`, `#statsOverlay
    .stats-modal` width bump) — the flowchart's node rows and toggle-menu
    cards use `flex-wrap` with no fixed breakpoints of their own, so they
    reflow smoothly from a narrow phone up through desktop widths; verified
    at 320px, 390px, and desktop widths, same as prior UI work. No other
    modal's width was touched (the wider cap is scoped to `#statsOverlay`
    only). No `firestore.rules` change needed — this is entirely local
    (IndexedDB) data, same as the rest of the stats system.
  - Touches `js/app-core.js` (the bulk of it), `js/split-quiz.js` and
    `js/sharing.js` (clearing curriculum context for custom/community quiz
    starts), and `css/styles.css`.
- **82 — Header logo and loading screen now match the tab favicon
  exactly, plus a new "assemble & focus" splash animation.** The header
  logo (next to the site name on the home screen and the quiz screen) and
  the loading-screen mark used to be a different, decorative line-art
  variant of the icon (rings + thin strokes) instead of the actual
  rounded-badge mark shown in the browser tab. Both now render the exact
  same shape and path data as the `<link rel="icon">` favicon in
  `index.html` — a navy rounded-square plate with the cyan magnifying-
  glass/"B" mark — driven by two new shared CSS variables,
  `--brand-badge-bg` / `--brand-badge-fg` (`css/styles.css`), so the
  favicon, header logo, and loading screen can never drift out of sync
  again; changing the brand colors is now a one-line edit.
  - The loading screen (`#introScreen` in `index.html`,
    `js/intro-animation.js`) was also redone with a new, more deliberate
    choreography instead of just drawing static ring line-art: a ring of
    small particles drifts inward and dissolves (`.intro-particles`), the
    badge plate irises open behind them with a spring overshoot
    (`.intro-plate` / `plateIris`), the magnifying-glass/"B" strokes draw
    themselves on top stroke-by-stroke (reusing the existing
    `pathLength`/`stroke-dashoffset` technique), a glow pulse and the
    wordmark settle in, and finally the screen contracts away from the
    badge's own position — handing off visually to the identical badge
    already sitting in the header. `prefers-reduced-motion` continues to
    skip straight to the static end state, now including hiding the
    particle layer entirely.
  - All of the new intro/header logo sizing uses `clamp()` (badge size,
    particle spread via `font-size`, wordmark size/width) instead of
    fixed pixel values, so the whole sequence — and the header logo
    afterward — scales fluidly with viewport width/height rather than
    relying on fixed breakpoints. Verified at 320px, 390px, and desktop
    widths.
  - Touches `css/styles.css` (brand-badge variables, `.brand-mark`, and
    the full `#introScreen` block), `index.html` (both header
    `.brand-mark` SVGs and the `#introScreen` markup), and
    `js/intro-animation.js` (updated element IDs and timing to match).
- **81 — Removed a redundant Firestore write left over in the curriculum
  publish flow.** Checked whether sharing a quiz to Community does the
  same version-check bookkeeping as an admin publishing to Curriculum —
  the Community share flow (`shareCustomQuiz()` in `js/sharing.js`) was
  already clean: it calls `putContentItem('community', ...)` once and
  stops, trusting the Worker's server-side manifest bump entirely. The
  Curriculum **publish** flow (`adminPublishQuiz()` in `js/quiz-editor.js`)
  did the same `putContentItem('curriculum', ...)` call, but then *also*
  called a leftover `_updatePublishedManifest()` — a second, client-side
  Firestore write to the exact same `appConfig/publishedManifest` doc the
  Worker had just bumped server-side a moment earlier. This was a genuine
  miss from the R2 migration cleanup, not intentional: the sibling **edit**
  flow (`adminSavePublishedEdits()`, right below it) already had this exact
  call removed, with a comment explaining it "would now just be a redundant
  second write" — publish was the one remaining spot that still made it.
  The **delete** and **move** flows were already clean too. Removed the
  call from `adminPublishQuiz()`, and deleted `_updatePublishedManifest()`
  itself from `js/data-sync.js` since nothing calls it anymore (also fixed
  a comment elsewhere in that file that referenced it by name). Net effect:
  publishing a new curriculum lecture now costs one Firestore write for the
  manifest bump instead of two, matching how Community sharing already
  worked. No UI/layout touched. No `firestore.rules` change needed.
- **80 — Verified and hardened "check once, not on every open" caching for
  Community Quizzes and Curriculum; fixed a dead-code throttle.** Audited
  whether opening the Community Quizzes window (or browsing the
  curriculum) re-checks the server version every single time — it
  didn't: both already used an in-memory cache (`_allSharedQuizzes` /
  `subjects[...].lectures`) that's only populated once per page load and
  reused with zero calls of any kind for every subsequent re-open in that
  same load, only re-checking after a real mutation (sharing/deleting a
  quiz, an admin publish/edit/reorder). That part needed no change.
  - What genuinely needed a fix: `ensureSharedQuizzesLoaded()` in
    `js/community-quizzes.js` already had a `lastVersionCheck:community`
    localStorage timestamp clearly *intended* to also throttle across a
    page **refresh** (which wipes the in-memory cache), but the actual
    check (`withinThrottle && _allSharedQuizzes.length`) could never be
    true — by the time execution reached it, `_allSharedQuizzes.length`
    was always `0` (a non-empty list already returns earlier, on the
    function's very first line). So every refresh, even one second after
    the last one, still did a full manifest read plus a per-quiz
    IndexedDB-vs-Worker comparison. Fixed by rebuilding the shared-quiz
    list straight from IndexedDB (`communityKnownIds` +
    `content:community:<id>`) with **zero** network calls whenever the
    refresh happens inside that 60-second window — falling back to a
    real check only if some previously-known quiz turns out to be missing
    from local storage (e.g. cleared browser data), so an incomplete list
    is never shown.
  - Applied the same fix to curriculum lectures, which had no such
    throttle at all before now: `loadPublishedQuestionsIntoSubjects()` in
    `js/data-sync.js` gained an identical `lastVersionCheck:curriculum`
    throttle (5 minutes, matching `content-client.js`'s already-existing
    `THROTTLE_MS.curriculum` constant) and a new
    `_rebuildPublishedFromCacheOnly()` helper that reconstructs every
    subject's lecture list from IndexedDB (`publishedTrack:<subject>` +
    `published:<subject>:<lectureId>`) with no Firestore or Worker calls,
    for the same "refreshed again very soon" case. Call sites that just
    performed an admin write (`js/quiz-editor.js`'s reorder handler, and
    the post-backfill reload in `js/firebase-init.js`) now explicitly pass
    `skipThrottle = true` so an admin's own change is never delayed by
    this — only a plain page load/refresh is throttled.
  - Net effect for the ~2000-daily-user target: a manifest check (one
    cheap Firestore doc read) now happens at most once per minute
    (community) / once per 5 minutes (curriculum) *per browser*,
    regardless of how many times that browser refreshes or re-opens
    either window in that window; and R2 reads were already, and remain,
    limited to only the specific quizzes/lectures whose version actually
    changed — nothing here loosened that per-item comparison, this only
    removed redundant manifest re-checks around it.
  - No UI or layout touched by this change — it's cache-timing logic
    only, so there's nothing new to verify for responsiveness across
    screen sizes. No `firestore.rules` change needed.
- **79 — Local (per-device) explanation cache with stale-question detection.**
  Build 78 removed the shared Firestore explanation pool but left every
  "🤖 Explain" click calling Gemini fresh every single time, even when
  reviewing the exact same quiz again a minute later on the same device.
  Explanations are now cached in this device's IndexedDB (`js/local-store.js`)
  instead — zero Firestore reads/writes (same as before), but also zero
  redundant Gemini calls for a question you've already explained on this
  device. This cache is per-device only: it's deliberately excluded from
  `buildExportPayload()`/`applyImportPayload()`, so it never travels with
  a Backup & Transfer export and never syncs anywhere.
  - Cache entries are keyed by a best-effort "slot" identity (quiz source +
    subject + lecture + question index — `_explainSlotKey()` in
    `js/ai-features.js`) rather than by the question's own content, so a
    minor edit to the question (e.g. an admin fixing a typo) doesn't just
    silently evict the cached copy. Each entry also stores a content
    fingerprint (`fingerprintQuestion()`) taken at cache time;
    `getCachedExplanation()` compares it against the question's current
    fingerprint and reports a `stale` flag rather than deciding for the
    caller.
  - When a cached explanation is stale, it's still shown instantly (no
    extra cost) with a small amber "✏️ this question has changed since
    this explanation was generated — regenerate recommended" hint above
    the existing 🔄 Regenerate button, which is otherwise unchanged — it
    already bypassed any cache and still forces a fresh Gemini call the
    same way.
  - If the slot identity itself doesn't hold steady (quiz retitled or
    reordered, or a dynamically-assembled quiz like a retake or a
    multi-custom-quiz merge), a lookup just misses next time, exactly like
    a question that was never explained before — nothing incorrect is ever
    shown, worst case is one extra Gemini call.
  - The cache is capped at 500 entries (`EXPLANATION_CACHE_MAX_ENTRIES` in
    `js/local-store.js`), oldest evicted first, so it can't grow unbounded
    over months of use. `clearExplanationCache()` is available for a future
    "clear cached explanations" control if one's ever wanted, though
    nothing in the UI calls it yet.
  - `js/ai-features.js`: `explainQuestion()` now checks the local cache
    before requiring an API key or calling Gemini; a successful fresh
    generation saves to it afterward. `css/styles.css`:
    `.ai-explain-stale-hint` (new, responsive — no fixed widths, wraps
    naturally at any screen size).
  - Nothing to delete from your GitHub repo, and no `firestore.rules`
    change needed — this build only adds local (client-side) storage.
- **78 — Removed the shared (Firestore-backed) AI explanation pool.**
  Explanations were previously saved to and looked up from a Firestore
  `explanations` collection so that once one student generated an
  explanation for a question, every other student reviewing that same
  question got it for free instead of calling Gemini again — but that
  meant every "🤖 Explain" click cost a Firestore read (and every fresh
  generation cost a write), which eats into the free-tier read/write
  quota as usage grows. Explanations are now generated fresh per user —
  Gemini is called every time, with results kept only in an in-memory,
  per-session cache (`_explainCache`) so re-opening/re-toggling the same
  panel within one results view doesn't re-call the API. The 🔄
  **Regenerate** button is unaffected — it already bypassed the pool and
  still forces a fresh Gemini call the same way.
  - `js/ai-features.js`: removed the pool snapshot/lookup/save functions
    (`_qHash`, `_loadExplainPool`, `_saveExplainToPool`,
    `_getExplainFromPool`) and the pool state
    (`_explainSessionPool`, `_explainPoolLoadPromise`), along with the
    pool-lookup at the top of `explainQuestion()` and the
    save-to-pool call after a successful generation.
  - `js/app-core.js`: `buildResults()` no longer kicks off a pool
    snapshot (`_explainPoolLoadPromise = _loadExplainPool(...)`) when the
    results screen is built.
  - `firestore.rules`: removed the `explanations/{questionHash}` match
    block, since nothing reads or writes that collection anymore.
    **Requires redeploying `firestore.rules`** (Firebase Console →
    Firestore Database → Rules → paste → Publish, or
    `firebase deploy --only firestore:rules`) for the removal to take
    effect on the live project — until then the old rules (harmless,
    since nothing calls them) stay published, but redeploying keeps the
    live rules matching the repo.
  - Nothing to delete from your GitHub repo for this change — every
    change here is an edit to a file that already exists; no files were
    added or removed. If you want to reclaim the space, the old
    `explanations` documents already sitting in Firestore from before
    this build are now orphaned and can be deleted manually (Firebase
    Console → Firestore Database → the `explanations` collection →
    delete), though leaving them costs nothing since nothing reads them.
- **77 — Removed the P2P direct-device transfer feature entirely.**
  Backup & Transfer now only offers file-based Export/Import — same as
  it always did — with the "Direct device-to-device transfer" card gone.
  - `js/p2p-transfer.js` (the WebRTC/signaling module) is deleted
    outright.
  - `js/backup-transfer-ui.js`: removed the second modal card and its
    four handler functions (`_backupStartP2PSend`, `_backupCopyP2PCode`,
    `_backupRenderP2PReceiveEntry`, `_backupRunP2PReceive`), plus the
    Firestore-specific `_backupFriendlyP2PError()` helper. Export/Import
    is untouched — same ids, same handlers.
  - `firestore.rules`: removed the `p2pSignaling` collection's rules and
    the `_isValidSdp()` helper, since nothing writes to that collection
    anymore. **Requires redeploying `firestore.rules`** (Firebase
    Console → Firestore Database → Rules → paste → Publish, or
    `firebase deploy --only firestore:rules`) for the removal to take
    effect on the live project — until then the old rules (which are
    harmless with nothing calling them) stay published, which is fine,
    but redeploying keeps the live rules matching the repo.
  - `css/styles.css`: removed the P2P transfer-code box, the device-to-
    device receive-entry styles, and the `.backup-code-input` field —
    the single remaining Export/Import card's styles are untouched.
  - If you're syncing this onto your existing GitHub repo, run
    `git rm js/p2p-transfer.js` there — that's the only file that needs
    deleting; everything else here is edits to files that already exist
    in your repo.
- **76 — Fixed intermittent "permission denied" on the *receiving* device
  only in P2P Backup & Transfer, even with build 71/72's rules correctly
  published.** `firestore.rules`' `p2pSignaling` collection evaluates a
  write as `create` if the target doc doesn't exist yet, or `update` if
  it does. Normally the receiver's answer write is an `update` (the
  sender's doc, with the offer, already exists) — but if that doc gets
  deleted first (a fast ICE failure, a timeout, or the stale-doc sweep in
  `js/p2p-transfer.js` running at an unlucky moment), Firestore sees no
  existing doc and checks the receiver's write against `create` instead,
  which required `offer`/`createdAt` fields an answer-only write doesn't
  have — rejected. `allow create` now also accepts an answer-only shape
  as a fallback, so the receiver's write can't fall between the two rule
  branches. **Requires redeploying `firestore.rules`** (same as any rules
  change) — Firebase Console → Firestore Database → Rules → paste →
  Publish, or `firebase deploy --only firestore:rules`.
- **75 — Deleted the `js/vendor/` QR libraries that were still physically
  in the repo.** Build 73 removed the QR feature from the code and said
  in its own changelog entry that `js/vendor/` had been deleted, but the
  four files (`jsQR.min.js`, `jsQR.LICENSE`, `qrcode-generator.min.js`,
  `qrcode-generator.LICENSE`) were still sitting in the repo, unused by
  anything — confirmed via a full-project search for every reference to
  `qr`, `jsQR`, `qrcode`, and `vendor` across `index.html`, `css/`,
  `js/`, and `package.json`. No code changes; the `js/vendor/` directory
  itself is now gone from this project drop too. If you're syncing this
  onto your existing GitHub repo rather than replacing the whole tree,
  run `git rm -r js/vendor` there so the dead files don't linger.
- **74 — "What to include" selection in Backup & Transfer restyled as
  chips/cards instead of plain checkboxes.** `renderBackupTransferModal()`
  in `js/backup-transfer-ui.js`: the Custom quizzes / Stats checkboxes are
  now `.backup-toggle-chip` cards that highlight when checked, and the
  quiz picker is a bordered `.backup-quiz-picker` panel with a distinct
  select-all header (with a live count badge) and a scrollable, hoverable
  list of quizzes below it. Purely visual — same element ids and the same
  `_backupToggleAllQuizzes()` / `_backupQuizItemChanged()` handlers as
  before, so nothing about how selection works actually changed.
- **73 — Removed QR sending/scanning; Backup & Transfer modal rebuilt as a
  clean, responsive two-card layout.**
  - **QR code removed entirely.** Build 70 added an optional QR code next
    to the P2P transfer code (generated on the sending device, scanned
    with the camera on the receiving device). That whole path — send-side
    generation, receive-side "📷 Scan QR" camera flow, and the two
    vendored libraries it depended on (`js/vendor/qrcode-generator.min.js`,
    `js/vendor/jsQR.min.js`, now deleted along with the rest of
    `js/vendor/`) — has been removed. The manual transfer code (shown
    with a Copy button on send, typed in on receive) was always the
    primary path and needed no changes; this only removes the QR
    shortcut around it.
  - **Modal rebuilt with real CSS classes instead of inline styles.**
    `renderBackupTransferModal()` in `js/backup-transfer-ui.js` now
    renders a short intro line followed by two clearly separated,
    titled cards — `.backup-card` for **Export / Import** and
    **Direct device-to-device transfer** — each with an icon header,
    a `.backup-field-group` for the include/quiz-picker controls, a
    `.backup-actions` button row, and a `.backup-status-area` for
    progress/result messages. All of the corresponding rules live in
    `css/styles.css` under "Backup & Transfer — modal layout". Button
    rows and the card header stack to full width below 480px instead of
    depending on scattered inline `flex-wrap` rules, so the modal stays
    usable at any screen size.
- **72 — Follow-up to 71: same "Missing or insufficient permissions"
  persisted because the rule fix was never actually live.** Firestore
  only enforces whichever `firestore.rules` is currently *published* to
  the project — editing the file in this repo (what 71 did) has no
  effect by itself until that's deployed. If you saw this error again
  after applying 71, that's almost certainly the missing step, not a new
  bug: open the Firebase Console → **Firestore Database → Rules**, paste
  in the current contents of `firestore.rules`, and click **Publish**
  (or run `firebase deploy --only firestore:rules` if you have the
  Firebase CLI configured for this project — note this repo doesn't ship
  a `firebase.json`/`.firebaserc`, so the CLI needs `firebase init` run
  once against your own project first, or the console path above is the
  simpler option). `js/backup-transfer-ui.js`'s
  `_backupFriendlyP2PError()` now spells this out directly in the
  in-app error message instead of just saying "permission denied."
- **71 — Fixed P2P Backup & Transfer (incl. "📷 Scan QR") failing for
  signed-out users with "Missing or insufficient permissions."**
  `firestore.rules`' `p2pSignaling` collection required
  `request.auth != null`, but Backup & Transfer is a local-first feature
  (`js/local-store.js` / IndexedDB) meant to work without a Firebase
  account — every signed-out user hit Firestore's raw permission error
  the instant `startSend()`/`startReceive()` (`js/p2p-transfer.js`) touched
  that collection, whether they typed a code or scanned a QR; signed-in
  users never saw it, which is why it looked account-status-specific
  rather than sign-in-specific. Fixed by opening `p2pSignaling` to
  everyone at the rules level — the random, short-lived transfer code was
  already the real protection (the rule's own prior comment said as
  much), not `request.auth`, so this closes the gap without weakening
  anything; `create`/`update` are now additionally shape-validated
  (`_isValidSdp()`) so a signed-out client still can't use the collection
  as an open write target. **Requires redeploying `firestore.rules` to
  take effect** — `firebase deploy --only firestore:rules` (or the
  equivalent in the Firebase console). `js/backup-transfer-ui.js` also
  gained `_backupFriendlyP2PError()`, so if a permission error is ever
  hit again (e.g. rules not yet redeployed), the message plainly says so
  and points at Export/Import instead of surfacing Firestore's raw
  string.
- **70 — Backup & Transfer overhaul: merge-vs-replace import choice,
  progress/result bars, custom export name, QR send/scan.**
  - **Import confirmation step (file or P2P), `_backupConfirmImportFlow()`
    in `js/backup-transfer-ui.js`.** Neither import path used to ask
    anything — a file drop or a completed P2P transfer applied
    immediately, always merging. Now both go through one shared inline
    panel first: a summary of what the backup actually contains, a choice
    of **merge with existing data** (default) or **delete existing data
    on this device, then load this backup**, and — only when a backup
    has *both* custom quizzes and stats — checkboxes to load just one or
    both. `js/local-store.js` gained the matching plumbing:
    `clearCustomQuizzes()` / `clearAttempts()`, a `mode: 'merge'|'replace'`
    option threaded through `importCustomQuizzes()` / `importAttempts()`
    (replace deletes this device's existing set first, still
    de-duplicating within the incoming batch), `inspectImportPayload()`
    to report what's in a payload without writing anything, and
    `applyImportPayload()` now takes `{ mode, includeQuizzes,
    includeStats }` instead of always applying everything present.
  - **Stylised progress / result bars** (`_backupProgressHTML()` /
    `_backupResultHTML()`) now cover every async action in this menu that
    didn't already have one — export, import, P2P send, P2P receive. An
    animated, indeterminate striped bar (there's no real byte-level
    percentage to report for any of these) while something's in flight,
    replaced by a solid green/red bar with the outcome once it settles.
  - **Optional custom export file name** — a text field next to Export;
    left blank it falls back to the existing dated default. Input is
    sanitized (strips characters unsafe in filenames across OSes) and
    always ends in `.json`.
  - **QR code for P2P send/receive**, kept fully additive to the existing
    code-box + copy-button flow — nothing about typing the code changed
    for anyone who prefers that. The sending device now also renders a QR
    code of the same transfer code; the receiving device gained a
    "📷 Scan QR" option (camera + live decode) next to its manual code
    field, replacing the old blocking `prompt()` with an inline, themed
    entry UI. Both libraries (`qrcode-generator` for generating,
    `jsQR` for scanning) are vendored locally under `js/vendor/` — not
    loaded from a CDN — and lazy-loaded only when send/receive is
    actually used, so this costs nothing otherwise and never depends on a
    third party being reachable.
- **69 — Worker: implemented the manifest bump build 68 diagnosed but
  deliberately didn't guess at.** Every successful curriculum/community
  write or delete through this Worker now also bumps (or, on delete,
  removes) that item's version marker in `appConfig/publishedManifest` /
  `appConfig/sharedQuizzesManifest` — the step build 56's design called
  for but that was never actually implemented, which is why newly
  published lectures and newly shared community quizzes stayed invisible
  even after a reload (every manifest-gated reader —
  `getCurriculumLecture()`, `getCommunityQuiz()`,
  `ensureSharedQuizzesLoaded()`'s `Object.keys(manifest)` listing — treats
  "no manifest entry" as "doesn't exist").
  - `lib/firebaseAdmin.js` gained one new export,
    `firestoreSetNestedField(env, path, fieldPath, value)` — a genuinely
    nested Firestore field patch (or, passing `value: undefined`, a
    targeted field *delete*), built correctly as a real nested `mapValue`
    structure with a dotted `updateMask.fieldPaths`. This had to be a new
    function rather than reusing `firestorePatchDoc()`, whose `fields`
    keys become literal top-level Firestore field names — a dotted key
    there wouldn't build the nested map structure Firestore's REST API
    actually requires, and could have silently clobbered every other
    already-published subject/lecture or shared quiz's manifest entry
    instead of touching only the one intended. `firestorePatchDoc()`
    itself is untouched — still used as-is for the existing flat
    `imageRefcounts/{hash}` patches.
  - `worker-index.js`: added `manifestLocationForKey()` (shared by both
    directions, so a bump and its matching clear can never disagree about
    the doc/field shape), `bumpManifestVersion()` (called right after the
    content JSON `PUT` succeeds) and `clearManifestVersion()` (called
    right after a successful `DELETE`).
- **68 — Worker: implemented DELETE (was a flat 405), fixed a second
  dead-collection auth bug, and diagnosed why published/shared content
  doesn't show up.**
  - `DELETE` requests to this Worker (curriculum unpublish, community quiz
    removal — `deleteContentItem()` in `js/content-client.js`) were routed
    but never handled; every one 405'd. Added the same authorization model
    as `PUT` (curriculum admin + scope, or community admin/author), then
    releases any images the deleted content referenced via the existing
    refcount helpers before removing the R2 object itself.
  - While wiring the community side of that, found `isCommunityQuizAuthor()`
    had the same class of bug build 67 fixed for `isAdmin()`: it checked
    Firestore's `sharedQuizzes/{docId}` collection, which was retired back
    in build 56 when content moved to R2 — no client code writes it
    anymore, so the check silently returned `false` for every real quiz
    owner. `authorUid` now lives only on the R2 content object itself (set
    by `sharing.js`), so the check reads it directly off that object
    instead.
  - **Diagnosed, not yet fixed — needs `lib/firebaseAdmin.js`:** newly
    published curriculum lectures and shared community quizzes not
    appearing (even after reload) is almost certainly the Worker never
    bumping `appConfig/publishedManifest` / `appConfig/sharedQuizzesManifest`
    after a successful write — something build 56's design already called
    for (see that entry, and the code comments already in `firestore.rules`
    and `content-client.js`) but was never actually implemented in the
    Worker. Every version-gated read in the app (`getCurriculumLecture()`,
    `getCommunityQuiz()`, and `ensureSharedQuizzesLoaded()`'s
    `Object.keys(manifest)` listing) treats "no manifest entry" as "doesn't
    exist," so with the manifest never bumped, new items are invisible by
    design, not by accident. Implementing the bump needs to see
    `lib/firebaseAdmin.js` first — specifically whether `firestorePatchDoc()`
    supports a nested/dotted field path (`subjects.<subject>.<lectureId>`)
    as a true field-level patch, or would overwrite the whole `subjects`/
    `quizzes` map. Guessing that wrong risks silently wiping every other
    already-published lecture/quiz's manifest entry — worse than the bug
    it would fix — so this is the next thing to send over before it's
    implemented.
- **67 — Worker: fixed the real cause of `curriculum writes are admin-only`
  (and the equivalent community-write 403) — `isAdmin()` was checking a
  roster shape that doesn't exist.** Build 66 made the Worker's errors
  visible instead of misreported as CORS, which pointed at
  `isAdmin(env, uid)`. Once the regenerated service-account secret ruled
  out the JSON-parsing failure, the 403 persisted — because the real bug
  was a step further in: `isAdmin()` looked up a document at
  `adminRoster/{uid}` (a per-user doc in a top-level `adminRoster`
  collection, keyed by Firebase UID). That path never exists under this
  project's actual roster model — a single document,
  `appConfig/adminRoster`, whose `admins` field is a map keyed by
  *lowercased email*, exactly as `firestore.rules` and
  `js/admin-curriculum-scope.js` already implement it. So the check
  silently returned `false` for every caller, including the real admin —
  the Worker was never able to authorize a single curriculum or community
  write, secret rotation or not.
  Replaced it with `isCurriculumAdmin()` / `isCommunityAdmin()` /
  `curriculumScopeAllowsSubject()` in `worker-index.js`, mirroring
  `firestore.rules` exactly: the same super-admin email, the same
  `appConfig/adminRoster.admins[emailLower].permissions` lookup, and the
  same scoped-curriculum semantics (a scoped admin's write is now checked
  against the target subject's Year/Module placement in
  `appConfig/curriculumExtensions`, not just "is this person *an* admin").
  The Worker now reads the caller's `email` claim off the verified Firebase
  ID token (the roster is keyed by email, not UID) alongside the existing
  `uid`. `isCommunityQuizAuthor()` was already correct and is unchanged.
  **Follow-up still flagged, not part of this fix:** `DELETE` requests are
  routed but not yet handled (still a 405) — `deleteContentItem()` in
  `js/content-client.js` (quiz deletion, curriculum unpublish) will need
  that added next.
- **66 — Worker: uncaught exceptions were masquerading as CORS errors,
  breaking publish.** `worker/src/index.js`'s `fetch()` handler had no
  top-level `try/catch`. When anything inside it threw — most likely a
  Firestore Admin REST call failing inside `isAdmin()` during a curriculum
  publish's authorization check — Cloudflare returned its own bare
  runtime-error response, which never passes through `withCors()` since
  the exception happens before any handler branch gets to return through
  it. The browser then reported this as `blocked by CORS policy` (no
  `Access-Control-Allow-Origin` header) even though build 59's CORS fix
  was completely intact — the *response it was blocking* just never had
  a chance to carry those headers in the first place. This is why the
  error looked identical to the already-fixed build-59 CORS bug despite
  nothing having changed in the CORS logic itself.
  Fixed by extracting the handler body into a standalone
  `handleRequest(request, env)` function and wrapping its call in
  `export default.fetch()` with `try/catch`; any exception now still
  returns a `withCors()`-wrapped `500` with the real error message
  (`Internal error: <message>`) instead of a bare, CORS-header-less
  crash. This doesn't fix whatever is actually throwing — it makes that
  underlying error visible in the browser console/Network tab instead of
  being misreported as CORS, so it can actually be diagnosed. **Prime
  suspect, not yet confirmed:** the Firebase service-account key used by
  the Worker's Firestore Admin calls (`lib/firebaseAdmin.js`, not
  included in this project drop) — rotating that key has been an
  outstanding item since the R2 migration session; if it's stale or was
  never re-confirmed working after being pasted into a chat, every
  server-side Firestore lookup (`isAdmin()`, `isCommunityQuizAuthor()`,
  refcount reads/writes) would throw exactly like this. **Next step:**
  redeploy this Worker change, retry a publish, and read the real error
  message now surfaced in the console/Network response body.
- **65 — Removed the retired `appConfig/sharedQuizzesVersion` scheme
  entirely (rule + dead client code).** This was the old global-version
  cache-busting doc for community quizzes, superseded back in build 56
  by the per-quiz `appConfig/sharedQuizzesManifest` system
  (`ensureSharedQuizzesLoaded()` in `js/community-quizzes.js`) and left
  in place afterward only as a transition safety net. Confirmed nothing
  reads it anymore, so removed outright rather than leaving it around:
  - `firestore.rules` — deleted the `match /appConfig/sharedQuizzesVersion`
    rule block.
  - `js/data-sync.js` — deleted `bumpSharedQuizzesVersion()` and
    `_fetchSharedServerVersion()` (both were defined but never called
    anywhere — genuinely dead code, not just unused-but-referenced),
    the `CACHE_SHARED_VER_KEY` constant and its `_readSharedCacheVer()`/
    `_writeSharedCacheVer()` accessors, and the `'shared'` blob branch
    of `_readCache()`/`_writeCache()` (also never actually written to,
    since community quizzes have used per-quiz IndexedDB keys since
    build 56). `_clearCache()` still opportunistically deletes the
    legacy `'shared'` IndexedDB key and `anu_msp_cache_shared_ver`
    localStorage key for any returning user whose browser still has
    them — pure tidy-up, not a functional dependency.
  - Updated the file-header comment in `js/data-sync.js` and a stale
    reference in `firestore.rules`'s `appConfig/{docId}` rule comment
    to match.
  - **Manual follow-up still needed:** deploy the updated rules
    (`firebase deploy --only firestore:rules`), and optionally delete
    the actual `appConfig/sharedQuizzesVersion` document in the
    Firebase Console (Firestore → `appConfig` collection) — the rule
    removal alone doesn't delete existing data, it just stops anything
    from being able to read/write it going forward.
- **64 — Community Quizzes: fixed `NaN` console error on repeat opens, and
  added cache visibility logging.** `renderCommunityQuizzes()` in
  `js/sharing.js` built each quiz card's duration input from
  `item.questionCount` directly; for any shared quiz missing that field
  (e.g. items migrated by the legacy-content-to-R2 tool without it),
  `Math.max(5, undefined)` evaluated to `NaN`, which the browser silently
  rejects when set as a `<input type="number">` value — logged as `The
  specified value "NaN" cannot be parsed, or is out of range.` on every
  render, including the second/third time the modal was opened in the
  same session (this was a rendering bug, not a caching bug — it fired on
  every render of an affected item regardless of whether the quiz list
  itself was freshly fetched or served from cache). Fixed by deriving a
  safe `qCount` per item (`item.questionCount`, falling back to
  `item.questions.length`, falling back to `0`) and using that everywhere
  the count is displayed or used for the default duration.
  Separately, added `console.log` cache-hit/miss summaries — one in
  `renderCommunityQuizzes()` (in-memory `_allSharedQuizzes` hit) and one
  in `ensureSharedQuizzesLoaded()` in `js/community-quizzes.js`
  (per-quiz IndexedDB-vs-Worker-fetch counts) — matching the existing
  `[cache] curriculum hit, skipping Firestore fetch` pattern, so caching
  behavior for community quizzes is now directly visible in the console
  instead of having to be inferred.
- **63 — Orphaned P2P signaling docs now get cleaned up (existing and
  future).** The actual quiz/stats payload of a P2P transfer never touches
  Firestore — only a small handshake doc at `p2pSignaling/{code}` does
  (the WebRTC offer/answer). Two gaps let these accumulate instead of
  being cleaned up:
  - In `js/p2p-transfer.js`, `startSend()` only deleted its own signaling
    doc on the success path — if the sender's browser was closed, the
    transfer timed out, or ICE failed, the function threw/exited before
    reaching that delete, leaving the doc behind forever (no expiry
    existed). Wrapped the whole send flow in try/finally so the doc is
    deleted on every exit path — success, failure, or thrown error — not
    just success. `startReceive()` now also deletes it as a second line
    of defense once the payload has arrived, independent of whatever
    happens to the sender afterward.
  - Added `_sweepStaleSignalingDocs()`, a best-effort query
    (`createdAt` older than 10 minutes — well past the 2-minute transfer
    timeout) that runs opportunistically at the start of every send/receive
    attempt and deletes whatever it finds. This is genuinely retroactive:
    it queries by the same `createdAt` field every doc already has
    (added in change #56, untouched here), so it cleans up docs orphaned
    before this fix existed just as well as new ones — no migration step,
    no Firebase Console work, no Cloud Function needed. `js/firebase-init.js`
    now also exposes `query`/`where` on `window` for this.
- **62 — P2P receive hung forever on "looking for sender."**
  `startReceive()` in `js/p2p-transfer.js` waited for data to arrive over
  the WebRTC channel *before* creating and sending its answer back to the
  sender — the answer-creation and signaling write only ran inside a
  `.finally()` attached to that wait. But a WebRTC connection can't be
  established, and therefore no data can ever arrive, until the answer has
  been sent — a chicken-and-egg deadlock. In practice the receiver just sat
  on "looking for sender" until the 2-minute timeout silently fired.
  Reordered so the answer is created and written to the signaling doc
  first, then the receiver waits for the data channel to open.
- **61 — Custom quizzes vanished after refresh (visible in Backup menu,
  not in Custom Quizzes).** Leftover naming mismatch from change #56's
  migration off Firestore. Every render path for custom quizzes
  (`js/quiz-editor.js`, `sharing.js`, `split-quiz.js`,
  `community-quizzes.js`, `admin-panel.js`, `ai-solve.js`) reads the list
  through `loadCustomQuizzes()` in `js/firebase-storage.js`, which returns
  `window._cachedCustomQuizzes`. But the code that loads quizzes from
  IndexedDB on sign-in (`js/firebase-init.js`) was writing them into a
  *differently named* global, `window._customQuizzes` — so
  `_cachedCustomQuizzes` was never populated on page load and every render
  saw an empty list. It only looked correct immediately after saving
  because `saveCustomQuizzesList()` sets `_cachedCustomQuizzes` directly as
  an in-memory side effect of that save — which is also why a refresh made
  it vanish again. The Backup & Transfer menu was unaffected because it
  calls `listCustomQuizzes()` from `js/local-store.js` directly, bypassing
  this broken cache. Fixed both write sites
  (`js/firebase-init.js` and the post-import refresh in
  `js/backup-transfer-ui.js`) to use `window._cachedCustomQuizzes`, the
  name every reader actually expects. (Note: `loadCustomQuizzesFromFirestore()`
  and its per-user version-cache helpers in `js/ai-features.js` are now
  confirmed fully dead code from before #56 — not touched here, flagged for
  a future cleanup pass.)
- **60 — Two Backup & Transfer bugs: invisible button text, missing P2P
  code.**
  - `.stats-open-btn` is styled for the dark gradient *modal header*
    (`color: white`), but `js/backup-transfer-ui.js` also reused it for the
    Export/Import/Send/Receive buttons in the modal *body*, which sits on
    the light theme's white card background. White text on a white card is
    invisible — only the emoji (unaffected by CSS `color`) showed. Added a
    `.stats-body .stats-open-btn` override in `css/styles.css` with its own
    light-theme palette (accent-tinted background, accent-colored text)
    scoped only to buttons inside a modal body, so the header buttons
    elsewhere are untouched.
  - `js/p2p-transfer.js`'s `startSend()` generated a short transfer code
    but never returned or surfaced it anywhere — it fired
    `onStatus('waiting-for-receiver')` with no code, even though the UI
    text told the user a code would appear. The receiving device had no
    way to know what to type. Fixed by passing the code as a 2nd argument
    to `onStatus`, and `backup-transfer-ui.js` now renders it in a large,
    monospace, dashed-border box with a one-tap Copy button
    (`.p2p-code-box`, responsive down to narrow phone widths).
- **59 — Two more post-deployment fixes: Worker CORS, missing migration
  rule.** After #58 fixed Firebase init, two smaller issues surfaced:
  - The Cloudflare Worker (`worker/src/index.js`) never sent
    `Access-Control-Allow-Origin` on its responses, so every
    `content-client.js` fetch from the GitHub Pages origin was silently
    blocked by the browser's CORS policy before reaching app code at all
    (worked fine when tested directly via curl/browser address bar, since
    CORS is a browser-enforced, not server-enforced, restriction). Added a
    shared CORS headers object applied to every response (including error
    responses) and an `OPTIONS` preflight handler.
  - `js/migration.js`'s one-time stats migration (moving old Firestore
    stats history to local storage) reads and deletes documents at
    `stats/{userId}/statsHistory/{historyId}` (the old, pre-#56
    architecture's path) — but `firestore.rules` only ever covered the
    newer `users/{userId}/statsHistory/{historyId}` path, so Firestore
    denied it by default with "Missing or insufficient permissions,"
    causing the migration to harmlessly retry forever. Added the missing
    rules for the old path (and its `images`/`fullImages`
    subcollections) — safe to remove once the migration is confirmed
    complete for all users.
- **58 — Post-deployment fix: sign-in, curriculum, and backup/transfer all
  broken after change #56 shipped.** Change #56's `firebase-init.js` never
  actually imported `firebaseConfig` from `config/firebase-config.js` — it
  referenced the bare name expecting it to already be in scope, which threw
  `firebaseConfig is not defined` on load and silently prevented Firebase
  (auth + Firestore) from initializing at all. Because sign-in, the
  curriculum browser, and stats all depend on Firebase being up, all three
  broke together, along with the Backup/Transfer modal (which depends on
  `local-store.js`, itself depending on IndexedDB helpers that only get
  attached once startup succeeds).
  - Fixed the missing import in `firebase-init.js`.
  - Separately, `data-sync.js`'s IndexedDB helpers (`_idbGet`/`_idbSet`/
    `_idbDelete`) were never exposed on `window`, and `_idbList` (used by
    `local-store.js` for prefix-based key listing) didn't exist at all —
    `data-sync.js` loads as a classic script, so its functions stayed
    private to that file. Added a single `window._idb*` exposure block at
    the end of `data-sync.js`, plus a new `window._idbList(prefix)` helper
    that filters keys by prefix and returns `{ keys: [...] }`.
  - `local-store.js`, `community-quizzes.js`, and `content-client.js` had
    each assumed a different shape for what `window._idbGet` resolves to —
    some expected a `{ value }` wrapper, others the raw value directly.
    Standardized on the raw-value shape (matching the real implementation),
    fixed the two files that had the wrapped-shape assumption, and added a
    small `_idbGetValue()` helper in `local-store.js` to keep call sites
    readable.
- **57 — Legacy content migration tool.** Change #56 moved curriculum
  and community-quiz reads entirely to R2/the Worker, with no Firestore
  fallback, but never shipped a way to actually move *existing* live
  content there — meaning deploying #56 as-is would have made every
  already-published lecture and community quiz disappear until manually
  re-published. Added `legacy-content-to-r2-migration/`, a standalone,
  read-only-against-Firestore script that copies existing curriculum
  lectures and community quizzes (plus their images, resolved from
  whichever of the three legacy image-storage shapes this project has
  used over time) into R2 using the same key scheme, manifest format,
  and content-hashing the Worker itself uses — dry-run by default,
  idempotent, verifies every write, and never deletes or modifies
  anything in Firestore. See
  [Deploying change #56 to an existing live project](#deploying-change-56-to-an-existing-live-project-one-time)
  above.
- **56 — Major architecture change: content moved to Cloudflare R2,
  personal data moved fully local, per-quiz community caching, safe
  image dedup.** Firestore's free-tier read/write/storage limits were
  the wrong fit for two very different kinds of data this app stores,
  so each is now handled the way it actually should be:
  - **Curriculum & community quiz content** (text + images) now lives
    in Cloudflare R2 instead of Firestore, served through a new
    Cloudflare Worker (`worker/`) that verifies the requester's real
    Firebase identity and enforces who's allowed to write what (admins
    only for curriculum; a quiz's own author, or an admin, for
    community quizzes) before touching storage. Firestore keeps only a
    tiny per-item version marker for each lecture/quiz — replacing
    community quizzes' old single-global-version scheme, which forced
    a full re-fetch of every community quiz whenever any one of them
    changed. Images are content-hash-addressed, so identical bytes
    never get duplicated, and a safe reference-counting step (also new)
    means an old image is only actually deleted once nothing else
    (another question reusing the same picture) still needs it.
  - **Your own custom quizzes and stats/history** now live entirely on
    your device (local storage) — never Firestore, never R2. This
    includes retake — bringing back wrong-question review, snapshotted
    locally at the moment you finish a quiz, at zero server cost.
    Since this is now personal, on-device data: back it up. Use
    Export/Import (a downloadable file — works everywhere, doubles as
    a backup) or the new direct device-to-device transfer (no file
    needed, nothing touches a server except a brief connection
    handshake) to move things to another device or protect against
    losing your browser data. The app will gently remind you if it's
    been a while.
  - Existing users are migrated automatically and safely on their next
    visit: old Firestore-stored stats/custom quizzes are copied to
    local storage first, confirmed, and only then removed from
    Firestore — never the other way around. Curriculum content already
    published is carried over to R2 the same way (copied, verified,
    then the old copy is cleaned up) — never deleted outright, only
    relocated.
  - **Backup & Transfer** is now a real, visible feature (💾 button on the
    home screen) — not just underlying capability. Export/Import a file
    (works on every device, doubles as a backup) and direct
    device-to-device transfer (more private — your data never touches a
    server, only a brief connection handshake does) are both first-class
    options, side by side, with a choice of custom quizzes / stats / both.
    A subtle, non-alarming reminder appears if it's been a while since your
    last backup. Every import (file or P2P) now asks first whether to
    merge with or replace this device's existing data, and — when a
    backup contains both custom quizzes and stats — which of the two to
    actually load (see build 70).
- **55 — Real incremental caching for Statistics: one document per
  quiz instead of one growing array.** #54's version check could only
  ever tell you "something changed" — because `history` was still one
  array field inside the `stats/{uid}` document, *any* change (even one
  new quiz) meant re-downloading every quiz ever taken. Fixed by
  splitting history the same way published quizzes already work:
  - Every finished quiz is now its own document —
    `users/{uid}/statsHistory/{historyId}` — instead of an entry in an
    array field.
  - The aggregate `stats/{uid}` document keeps only totals/subjectStats
    plus a tiny manifest, `historyManifest: { historyId: timestamp }` —
    IDs and numbers only, no question content, so it stays small
    forever regardless of how many quizzes accumulate.
  - Loading compares that manifest against a local IndexedDB-backed
    cache (mirrors the published-quiz manifest system in
    `js/data-sync.js`): entries whose timestamp matches are read
    straight from the local cache — 0 reads — and only new/changed ones
    are actually fetched. Taking one more quiz now costs exactly one
    new document read, never a re-download of the rest of history —
    and the reverse holds too, an already-cached quiz is never
    re-fetched just because a different one changed.
  - Entries removed from the manifest (e.g. after Reset All Statistics)
    are pruned from the local cache too, and Reset now cleans up each
    entry's own document (previously it only cleaned up the
    image/full-snapshot subcollections, since the entry itself lived
    inline in the array).
  - One-time migration handles existing accounts: the first load after
    this update detects a legacy inlined `history` array, splits it
    into individual documents + builds the manifest automatically
    (also compacting any lingering pre-#51 inline images while it's at
    it), then never needs to run again for that account.

  In-memory `st.history` is unchanged in shape — `renderStatsModal()`,
  `retakeSingleQuiz()`, and the multi-select retake selector needed no
  changes at all, since they just read the assembled array like before.
  Touches `js/app-core.js` (`loadStatsFromFirestore`, `persistStats`,
  `saveQuizStats`, `resetStats`), `js/firebase-storage.js` (five new
  helpers), `firestore.rules` (owner-only rule for the per-quiz
  document itself).
- **54 — Per-account stats cache/version check, plus a permanent full
  quiz snapshot archived per attempt.** Two related additions:

  1. **Local cache + version check for Statistics.** `loadStatsFromFirestore()`
     previously did a full Firestore read of the `stats/{uid}` document on
     every login, no matter how big it had grown (see #52/#53 — history is
     now unbounded). It now mirrors the same per-user cache pattern custom
     quizzes already use: a tiny `stats` field on the existing
     `users/{uid}/meta/cacheVersion` doc tells the client whether anything
     changed since last time, and if not, it loads straight from
     `anu_msp_stats_cache_<uid>` in localStorage instead of re-downloading
     the whole document. `persistStats()` writes through that local cache
     and bumps the version on every save, so the next load (this device or
     a new session) is already warm. Falls back to the full Firestore read
     automatically if the version doc is missing or stale.
  2. **Full quiz snapshot, archived independently of the live quiz.**
     `history[].wrongQuestions` (added in #51) is what Statistics/Retake
     actually use, and only covers wrong answers. `saveQuizStats()` now
     *also* archives every question in the quiz — right and wrong — to
     `users/{uid}/statsHistory/{historyId}/full/data` (images in their own
     `fullImages/{idx}` subcollection, keeping the same pattern as
     everything else here). This isn't surfaced in the UI yet — it's a
     forward-looking archival copy for a future "review the whole quiz you
     took" feature — but the key property is: **it's frozen at the moment
     the quiz was submitted.** If an admin later edits a question's wording,
     changes its correct answer, or deletes the quiz entirely, this
     snapshot (and the existing wrong-question one) are completely
     unaffected — retake and any future full-quiz review always work from
     what the user actually saw, never from a live lookup. Best-effort: if
     the archival save fails, the user's actual score/history entry (saved
     separately, moments earlier) is never affected either way.

  Touches `js/app-core.js` (`loadStatsFromFirestore`, `persistStats`,
  `saveQuizStats`, `resetStats`), `js/firebase-storage.js` (six new
  helpers), `firestore.rules` (owner-only rules for the two new
  subcollections).
- **53 — Show all quizzes in Statistics, not just the 10 most recent.**
  The "Recent Quizzes" section in the Statistics modal only ever rendered
  `st.history.slice(0, 10)` — a display-only cap, separate from the
  storage cap #52 removed. Now every entry in history renders (list
  renamed to "🕐 Quiz History" since it's no longer just the recent ones).
  The modal already scrolls (`.stats-overlay` is `overflow-y: auto`), so a
  long list stays fully usable at any screen size without further layout
  changes. The Retake selector was unaffected — it already listed every
  history entry with no slice. Touches `js/app-core.js`
  (`renderStatsModal`) only.
- **52 — Remove the 20-quiz cap on stats history.** `saveQuizStats()` no
  longer pops the oldest entry off `st.history` once it passes 20 — every
  finished quiz is now kept indefinitely, so nothing you've taken drops out
  of Statistics or the Retake list. (The compaction added in #51, which
  moves wrong-question images to a Firestore subcollection instead of
  inlining them, still keeps the stats document itself small regardless of
  how many quizzes accumulate — so this doesn't reopen the document-size
  problem #51 fixed.) Touches `js/app-core.js` (`saveQuizStats`) only.
- **51 — Fix a just-finished quiz's stats silently failing to save once
  wrong-question images pushed the stats document past Firestore's 1 MiB
  limit.** `saveQuizStats()` stored the full question object — including
  any embedded base64 image — for every wrong answer, inline inside
  `history[].wrongQuestions` in the per-user `stats` document. Firestore
  hard-caps a document at 1 MiB; once accumulated history (up to 20
  entries, each carrying its own wrong-question images) pushed that
  document over the limit, the next `setDoc()` write was rejected —
  silently, since the write was fire-and-forget with only
  `console.error()` on failure. The server-side doc stayed at whatever it
  held *before* that attempt, i.e. everything except the quiz that had
  just pushed it over. This is why only the newest quiz ever went missing,
  and why it never came back no matter how long you waited: it was never
  a timing race, the write had permanently failed.

  Fixed by storing wrong-question images the same way custom-quiz images
  already are: moved out to a Firestore subcollection
  (`users/{uid}/statsHistory/{historyId}/images/{idx}`) instead of being
  inlined, leaving only a small `firestore-history://` sentinel in the
  stats document itself (mirrors the existing
  `uploadQuizImagesToStorage`/`hydrateQuizImages` pattern for custom
  quizzes). `saveQuizStats()` also now compacts any *older* history
  entries still holding inline images the same way on every save, so a
  document that's already over the limit from before this fix can shrink
  back down instead of staying stuck. Retake ("🔄 Retake wrong questions",
  single or multi-select) now hydrates each wrong question's image back
  from the subcollection right before starting the retake quiz. A
  dropped-for-being-past-the-20-entry-cap entry, and Reset All Statistics,
  both now also clean up that entry's/entries' image subcollection docs
  instead of leaving them orphaned. Touches `js/app-core.js`
  (`saveQuizStats`, `retakeSingleQuiz`, the multi-select retake handler in
  `renderRetakeSelector`, `resetStats`), `js/firebase-storage.js` (new
  `uploadHistoryImagesToStorage`/`hydrateHistoryImages`/
  `deleteHistoryImagesFromStorage`), and `firestore.rules` (owner-only
  access rule for the new `statsHistory` image subcollection).
- **50 — Fix missing ⏹ Stop button during question extraction/generation.**
  The Custom Quiz modal's pause/resume/stop row (`#cqPauseRow`) is only
  rendered once, on modal open, when the run isn't busy yet — so at that
  point `#cqStopBtn` is drawn with its own inline `display:none` (mirroring
  `cqBusy` being `false`). When `generateQuizFromAI()` (✨ Extract
  Questions) or `generateQuizFromLecture()` (🧠 Generate Questions) then
  starts a run, they update the existing DOM in place rather than
  re-rendering the modal — and that update explicitly flipped
  `pauseRow.style.display` and `pauseBtn.style.display` back to visible,
  but only touched the Stop button's `disabled`/`textContent`, never its
  own `style.display`. The button's original inline `none` therefore stuck
  around underneath a now-visible row, making Stop appear absent for the
  entire extraction/generation — Pause worked, Stop didn't. Both functions
  now also set `stopBtn.style.display = 'inline-block'` when a run starts,
  matching how `pauseBtn` is already handled. No change was needed on the
  cleanup side: the `finally` blocks already hide the whole `pauseRow`
  container (which hides Stop along with it) once a run ends. Touches
  `js/ai-solve.js` (`generateQuizFromAI`, `generateQuizFromLecture`) only.
- **49 — Fix long Visual Split titles stretching the split card instead of
  wrapping.** The "Will create N quizzes: …" summary line under the split
  panel renders each part as a `.cq-split-chip` pill — including any
  custom title typed in for that part. That pill was set to
  `white-space: nowrap`, so a long title had nowhere to break: instead of
  wrapping onto a second line inside the chip, it just kept extending the
  chip (and the whole card) wider on one line. `.cq-split-chip` now allows
  normal wrapping (`white-space: normal`, `overflow-wrap: anywhere`,
  `max-width: 100%`), and `.cq-split-summary` aligns chips to
  `flex-start` so a wrapped two-line chip doesn't throw off the row's
  vertical alignment. Touches only `css/styles.css`. (The part-title
  `<input>` itself was never the source of this — an `<input>`'s box
  width is fixed by CSS regardless of how much text is typed into it;
  only the read-only summary chip rendered the title as plain wrapped-or-
  not text.)
- **48 — Fix Visual Split part titles disappearing when a new section is
  cut.** In "✂️ Visual Split" mode, typing a title into a part's "Optional
  title for Quiz N…" box saved the text to `cqSplitState.visualPartLabels`,
  but the box's displayed value was read back from a different, never-
  written property (`cqSplitState.visualLabels`) — so the title always
  rendered as empty the moment the visual area re-rendered, which happens
  on every ✂️ click (adding or removing a split point elsewhere in the
  list). It looked like previously-named sections lost their names each
  time a new one was cut. Titles are now read from and written to the same
  property. Also hardened the underlying key: labels were keyed by a
  part's on-screen position ("Quiz 1", "Quiz 2", …), which shifts whenever
  a cut is added or removed earlier in the list — so even a "successfully"
  saved title could end up silently attached to the wrong part after
  further edits. Labels are now keyed by the stable question index each
  part starts at, so a title stays attached to the same questions
  regardless of how later edits renumber the parts around it; removing a
  cut also now correctly drops the now-stale title of the part that merges
  away, instead of touching the (wrong) property it used to. Touches
  `js/split-quiz.js` (`openSplitPanel`, `setSplitMode`, `toggleVisualCut`,
  `_buildVisualSplitHTML`, `updateVisualPartLabel`, `_buildSplitSummaryHTML`,
  `executeSplitQuiz`; removed the now-fully-dead `updateVisualLabel`).
  Also moved the part-title input's styling out of an inline `style=`
  string into a proper `.cq-split-part-title-input` CSS class in
  `css/styles.css`, with narrow-screen rules (alongside the existing
  `.cq-split-*` responsive rules) so the title box and "📋 Quiz N" badge
  wrap cleanly instead of overflowing on small screens.
- **47 — Case/vignette context now includes right AND wrong answers, can
  nest sub-cases to any depth, and shuffle/normal mode both keep a case
  and its whole nested tree together in the right order.**
  - **Answers in context, always live.** The shared-case text sent to the
    AI (Explain / Chat / the per-question AI tools / bulk Solve) now
    includes that case question's own answer choices, each explicitly
    labeled CORRECT or WRONG. This is read directly off the live question
    object every time, so editing the case's correct answer (or any of its
    wrong choices) is reflected immediately, everywhere, with no separate
    copy to fall out of sync.
  - **Nested sub-cases, any depth.** A question that depends on a case can
    now itself become a "sub-case" for further questions nested under IT
    — and that can repeat to any depth the user sets up (a sub-case within
    a sub-case, etc). New optional fields `case_link_id` / `case_parent_id`
    express this alongside the existing `case_group` / `case_is_core` —
    old data with neither field is unaffected and needs no migration
    (a question with no `case_parent_id` is simply a direct child of the
    group's root, exactly as before). The "🔗 Case Link" editor (in the
    extraction preview, the admin editor, and the custom-quiz editor) got
    a "Depends on" picker so any member can be re-nested under any other
    non-descendant member, plus a preview stack showing every ancestor
    level (not just the one root) so it's obvious what context the AI will
    actually receive.
  - **AI context is now explicit about levels.** The context block sent to
    the model walks the whole ancestor chain, root first, each level
    clearly labeled "BACKGROUND CONTEXT ONLY — not a separate question
    you're being asked here", with an explicit "end of context" line
    before the real question — so the model can't confuse a context
    question (or its answer) with the actual question being solved,
    explained, or chatted about, no matter how many levels deep the real
    question is nested.
  - **Extraction is nesting-aware.** The Gemini extraction prompt and
    response schema now describe `case_link_id`/`case_parent_id` with a
    worked example, so the AI can represent a nested sub-case it detects
    in a source document (e.g. a follow-up lab result inside a larger
    vignette that only some questions depend on) instead of flattening
    everything into one level.
  - **Shuffle (and normal mode) keep the whole tree together, correctly
    ordered.** `_cqGroupAwareShuffle` is now tree-aware: a case block lays
    out as root, then each direct dependent immediately followed by that
    dependent's own entire nested subtree (recursively) — e.g. root 1,
    dependents 3 and 5, where 5 is itself a sub-case with dependents 6
    and 7, lays out as 1-3-5-6-7. Shuffle only ever reorders WHICH block
    comes where, never anything inside one. This layout is no longer
    shuffle-only: "normal" (non-shuffled) mode now runs through the same
    layout pass too, so a case and its nested tree render correctly
    grouped and ordered there as well, even if the underlying array
    happened to store them out of order. Touches `js/app-core.js`,
    `js/sharing.js`, and `js/split-quiz.js` (all three question-order
    entry points), plus the multi-quiz-merge and community-quiz-merge
    namespacing helpers in `js/split-quiz.js`/`js/community-quizzes.js`,
    which now also namespace `case_link_id`/`case_parent_id` alongside
    `case_group`.
  - **Fixed along the way:** deleting a question from the extraction
    preview or the admin quiz editor never ran the case-group cleanup
    pass that the custom-quiz editor's delete already ran — meaning a
    deleted core (or, now, a deleted sub-case) could leave the group
    without a core, or with dangling references, in those two editors.
    Both now run the same cleanup as the custom-quiz editor.
  - Touches `js/ai-features.js` (the core data model and the "🔗 Case
    Link" editor UI), `js/ai-question-tools.js` (shuffle/order), `js/ai-
    solve.js` (reading the new fields out of Gemini's raw response, and
    the extraction-preview delete fix), `js/gemini-uploads.js` (prompt +
    schema), `js/quiz-editor.js` (the admin-editor delete fix), `js/app-
    core.js`, `js/sharing.js`, `js/split-quiz.js`, and `js/community-
    quizzes.js`.
- **46 — Per-question "🧠 Thinking" toggles are now independent per
  question.** The Refine Question / Fill Choices / Add Choice toggles
  used to share ONE on/off value per tool across every question card —
  switching it on for one question silently switched it on for every
  other question showing that same button too. Each of those three is
  now tracked separately per question (keyed by editor + question index),
  so turning it on for one question has no effect on any other. This
  per-question state lives only in memory for the current session (not
  persisted across reloads), since a question's index can point at a
  different question next time the editor opens. The two BULK toggles
  ("Fill Choices (bulk)" / "Refine Questions (bulk)") are unaffected —
  there's genuinely only one of each on the page, so they keep their
  original shared, persisted-in-localStorage behavior. Touches only
  `js/ai-question-tools.js`.
- **45 — planned, then dropped:** a "🛠️ Full mgmt" per-Year admin
  scope was explored and partly built in an earlier internal drop, but
  was abandoned before release at the requester's direction — every
  change from here on builds on #44, not on that unreleased work.
- **44 — Fix "🧠 Thinking" toggle scrolling the page away from the
  question being edited.** Clicking any per-question "🧠 Thinking"
  checkbox (Refine Question / Fill Choices / Add Choice, and their bulk
  toolbar counterparts) could suddenly jump the whole page down, away
  from the question card the admin was working on. Cause: `.ai-thinking-
  toggle input` hides the native checkbox with `position: absolute`, but
  its wrapping `.ai-thinking-toggle` label had no `position: relative` of
  its own — so the hidden, zero-size checkbox was actually positioned
  relative to a distant ancestor further up the page instead of its own
  pill. Every toggle click focuses that checkbox, and the browser's
  built-in "scroll the focused element into view" behavior used that
  wrong, faraway position — landing the viewport below where the admin
  actually was. Fixed by adding `position: relative` to `.ai-thinking-
  toggle` in `css/styles.css`, so the hidden checkbox is now correctly
  contained within its own visible pill and focusing it causes no scroll
  at all. (`.rotation-switch` elsewhere in the same file already used
  this pattern correctly — the thinking toggle just hadn't picked it up.)
- **43 — Subject icon editing, and quiz rename for saved custom quizzes
  & the admin panel.** Subjects now get their own "🎨 Icon" and "✏️ Rename"
  buttons in Manage Curriculum, matching the split Years and Modules
  already had — previously a subject's icon and label could only be
  changed together via one combined "✏️ Edit" prompt flow (see
  `adminEditSubjectIcon()` / `adminRenameSubject()` in
  `js/curriculum-admin.js`). Saved custom quizzes (in the Custom Quizzes
  modal) gained a "🏷️ Rename" button to change a quiz's title without
  opening its full question editor (`renameCustomQuiz()` in
  `js/split-quiz.js`). Published quizzes in the admin panel's Manage
  Curriculum tab gained the same "🏷️ Rename" — the backing field
  (`lectureName`) already existed and round-tripped correctly on save,
  but nothing in the UI had ever actually exposed a way to change it
  (`adminRenamePublished()` in `js/quiz-editor.js`); it now updates
  Firestore, the in-memory `subjects[...].lectures` map (re-keyed to the
  new name), and bumps that one quiz's entry in `appConfig/publishedManifest`
  so the new name shows up for every other user too.
- **42 — Fix AI-tool status bar not clearing on Stop/finish.** The blue
  "🪄 Refining question…" (and Fill Choices / Add Choice) status bar under a
  question could stay stuck on screen forever after the run finished or was
  cancelled with ⏹ Stop, because the card was rebuilt (or left alone, on
  Stop) while the busy lock backing its cached status was still set —
  see the ordering comments in `aiRefineQuestion()` / `aiFillChoices()` /
  `aiAddChoice()` in `js/ai-question-tools.js`. Fixed by clearing the busy
  lock before rebuilding on success, and explicitly clearing the status box
  on a Stop cancellation. The bulk toolbar versions ("Refine Questions
  (All)", "AI Solve", "Fill Choices", "Re-extract Missing Images" in
  `js/ai-features.js`) had the mirror-image bug — their "✅ finished" /
  "⏹ stopped" summary was being overwritten to blank by the panel rerender
  that immediately followed it, in the same synchronous tick, so the
  summary never actually became visible. Fixed by applying that summary
  after the rerender instead of before it.
- **41 — Loading indicators for Save (extraction preview) and Split into
  Multiple Quizzes.** Both actions write to Firestore/Storage and could
  previously sit for a few seconds with no feedback and no protection
  against a double click. Save now locks the whole preview action row and
  shows a spinner while `saveCustomQuizzesList()` is in flight (with a
  proper error state if the save fails); the split panel — across all
  three contexts it's used in (extraction preview, a saved custom quiz,
  an admin-published lecture) — now locks and shows a spinner the same
  way, and its default (preview/saved) pathway gained error handling it
  didn't have before. See `saveGeneratedCustomQuiz()` in `js/ai-solve.js`
  and `executeSplitQuiz()` / `_setSplitPanelBusy()` in `js/split-quiz.js`.

## Contributing

Issues and pull requests are welcome — whether that's bug fixes, UI
polish, new AI-tool integrations, or accessibility improvements. Please
keep the file-per-feature layout above when adding new functionality
rather than growing one of the existing files indefinitely, keep the
README current, and ensure UI changes stay responsive across screen
sizes.

## Author

Created and maintained by **Mahmoud Talat**, a second-year student in the
Medical School Program (MSP) at Alexandria National University, at the
time of this project's development.

## License

Released under the [MIT License](./LICENSE) — free to use, modify, and
redistribute.
