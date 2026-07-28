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
- **Persistent statistics** — per-user history stored in Firestore.
- **Custom quizzes** — write your own, or generate one from pasted MCQs
  or lecture material using Gemini.
- **Community quizzes** — browse, take, and share quizzes made by other
  students; merge questions from one quiz into another.
- **AI tools** (Gemini, bring-your-own API key) — extract questions from
  slides/PDFs, generate new questions, auto-answer, refine question
  wording, fill in missing choices, and produce step-by-step explanations
  or a per-question AI chat.
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
│   ├── sharing.js                # Share-quiz links + shared quiz image helpers
│   ├── community-quizzes.js      # Browse/merge community-submitted quizzes
│   ├── user-profile.js           # Display name + misc Firestore utilities
│   ├── data-sync.js              # Local cache, published-quiz manifest,
│   │                              #   one-time data migrations
│   ├── content-client.js         # Read-only fetch helpers for published
│   │                              #   curriculum content served from R2
│   ├── migration.js              # One-time move of legacy Firestore-stored
│   │                              #   stats/custom quizzes to local storage
│   ├── local-store.js            # Custom quizzes + stats/history — all
│   │                              #   local (IndexedDB), never Firestore;
│   │                              #   export/import payload + merge-vs-
│   │                              #   replace import logic lives here
│   ├── p2p-transfer.js           # Direct device-to-device transfer (WebRTC
│   │                              #   data channel, Firestore only for the
│   │                              #   brief connection handshake)
│   ├── backup-transfer-ui.js     # Backup & Transfer modal: file export/
│   │                              #   import (with a merge/replace choice
│   │                              #   and a custom file name) and the P2P
│   │                              #   send/receive UI (manual transfer code)
│   ├── icon-picker.js            # Icon library + reusable icon-picker widget
│   ├── admin-panel.js            # Publish flow, manage admins, manage
│   │                              #   community submissions
│   ├── admin-curriculum-scope.js # Scoped curriculum-permission model:
│   │                              #   grant a curriculum admin the whole
│   │                              #   curriculum or specific Year/Module/
│   │                              #   Subject(s); the Add-Admin scope picker
│   ├── quiz-editor.js            # Inline editors for published & custom quizzes
│   └── curriculum-admin.js       # Admin curriculum tree management
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
change (see the filename of whichever zip you're reading this from).

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
