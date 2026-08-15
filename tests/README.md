# Local tests

`run-tests.js` is a plain Node.js test script (no dependencies, no
install step) covering the logic added/changed in project drop #128:

- `cqRunContentFilterPasses()` — the multi-pass / "Micro Filter" / stop
  safety loop (`js/gemini-uploads.js`).
- `cqAiSolveQuestions()`'s configurable batch size (`chunkSize` param).
- `_caseGroupOnQuestionDeleted()` — the case-context-preserving
  promotion logic that fires when a question holding a shared case/
  vignette gets removed (Content Filter or a manual delete), including
  multilevel (nested sub-case) scenarios.

## Running

```
cd tests
node run-tests.js
```

No browser, build step, or network access needed — the app's two
source files are loaded as-is into a sandboxed Node `vm` context with
minimal stand-ins for the DOM/localStorage/other-file helpers they
reference, and the one real network call (`callGeminiWithRetry`) is
replaced with a small in-memory fake per test so the actual
looping/batching/promotion logic runs for real, deterministically,
without ever hitting the Gemini API.

Exits non-zero (and prints failure details) if anything fails, so it's
CI-friendly if this project ever gets one.
