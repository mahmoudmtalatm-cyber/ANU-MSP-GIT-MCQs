# Local tests

`run-tests.js` is a plain Node.js test script (no dependencies, no
install step) covering the AI-tools logic added/changed across recent
project drops:

- `cqRunContentFilterPasses()` — the multi-pass / "Micro Filter" / stop
  safety loop (`js/gemini-uploads.js`). (Suite A)
- `cqAiSolveQuestions()`'s configurable batch size (`chunkSize` param),
  and that its "(batch N of M)" progress text is always written to
  `statusEl` — including on a single-batch run, not just once a run
  splits into more than one request. (Suite B)
- `_caseGroupOnQuestionDeleted()` — the case-context-preserving
  promotion logic that fires when a question holding a shared case/
  vignette gets removed (Content Filter or a manual delete), including
  multilevel (nested sub-case) scenarios. (Suites C/D)
- The other batch-using tools' configurable batch size — pre-extraction
  "AI Answering" and image re-extraction. (Suite E)
- The collapsible `<details>` options panels (AI Solve/Content
  Filter/Refine/Reextract settings) surviving a mid-run rerender
  instead of silently re-collapsing. (Suite F)
- `_renderAiSolveStatusBadge()` — the shared "AI Guess"/"AI-answered"/
  "No Key" pill, and that the post-extraction preview, Admin editor,
  and Custom-Quiz editor all render it consistently. (Suite G)
- `contentLoaderHTML()` — the shared, theme-branded loading-state
  markup (`js/dom-utils.js`) used by any screen whose content is still
  being fetched, and that the five former hand-rolled spinner blocks it
  replaced (`community-quizzes.js`, `admin-panel.js` ×2, `pdf-export.js`,
  `sharing.js`) are all gone in favor of it. (Suite H)

## Running

```
cd tests
node run-tests.js
```

No browser, build step, or network access needed — the app's source
files are loaded as-is into a sandboxed Node `vm` context with minimal
stand-ins for the DOM/localStorage/other-file helpers they reference,
and the one real network call (`callGeminiWithRetry`) is replaced with
a small in-memory fake per test so the actual
looping/batching/promotion logic runs for real, deterministically,
without ever hitting the Gemini API.

Exits non-zero (and prints failure details) if anything fails, so it's
CI-friendly if this project ever gets one.
