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
   for everything admin-only. If you fork this project, update the
   hardcoded `isSuperAdmin()` email at the top to your own account before
   deploying.
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
rather than growing one of the existing files indefinitely.

## Author

Created and maintained by **Mahmoud Talat**, a second-year student in the
Medical School Program (MSP) at Alexandria National University, at the
time of this project's development.

## License

Released under the [MIT License](./LICENSE) — free to use, modify, and
redistribute.
