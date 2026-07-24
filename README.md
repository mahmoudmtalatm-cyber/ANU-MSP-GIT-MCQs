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
    panel and each editor's "Whole Quiz" AI tools panel). These are **five
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
    `community-quizzes.js` — have nothing to re-extract against). It shares
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
    a real ⏹ Stop button — unlike the read-only bounding-box lookup this
    reuses for the initial bulk pass, this one call site was given actual
    cancellation support (an `AbortController` wired into `getBoundingBoxes`
    via an optional `cancelToken`, mirroring the pattern `callGeminiWithRetry`
    already used elsewhere), so Stop immediately aborts the in-flight
    request rather than just hiding the busy state while it keeps running
    unseen. It also counts toward the app's unsaved-progress guard
    (`_hasUnsavedProgress` in `app-core.js`, via the shared `_aiToolsBusy`
    lock it already uses) — closing or navigating away from the tab while a
    re-extract is in flight prompts the browser's native "leave site?"
    confirmation, same as every other in-flight AI action.
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
│   ├── split-quiz.js             # Split a long quiz into smaller ones
│   ├── sharing.js                # Share-quiz links + shared quiz image helpers
│   ├── community-quizzes.js      # Browse/merge community-submitted quizzes
│   ├── user-profile.js           # Display name + misc Firestore utilities
│   ├── data-sync.js              # Local cache, published-quiz manifest,
│   │                              #   one-time data migrations
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

- **Rate-limit detection** — a key is marked rate-limited after **3
  consecutive HTTP 429 responses**. A single 429, or a 429 followed by a
  success, doesn't count — only an unbroken streak of three.
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
