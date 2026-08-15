'use strict';
/* Local test harness for the changes in project drop #128:
 *   1. cqRunContentFilterPasses()  (js/gemini-uploads.js) — multi-pass /
 *      Micro Filter / batch-size / stop-safety logic.
 *   2. cqAiSolveQuestions()'s new chunkSize param              (js/gemini-uploads.js)
 *   3. _caseGroupOnQuestionDeleted() and friends               (js/ai-features.js)
 *      — the case-context-preserving promotion logic.
 *
 * The real app is a browser script (no module system, relies on globals
 * defined across many <script> tags) and its AI calls hit the live Gemini
 * API. Neither is available here, so this harness:
 *   - loads the two source files verbatim into a Node `vm` context,
 *   - stubs every external global they reference (DOM bits, the other
 *     files' helper functions) with minimal, faithful equivalents,
 *   - and, for the network-calling paths, replaces callGeminiWithRetry
 *     with a controllable fake so the batching/looping logic itself is
 *     exercised without ever making a real request.
 *
 * Run with:  node run-tests.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// This file lives at <project root>/tests/run-tests.js, so the app's js/
// directory is one level up.
const SRC = path.join(__dirname, '..', 'js');

// ── tiny assert-based test runner ──────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, err: e });
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, err: e });
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'not deep-equal'}: expected ${b}, got ${a}`);
}

// ── minimal stub globals shared by both loaded files ───────────────────
// A tiny in-memory localStorage, pre-seeded with one fake API key. Real
// ai-features.js code (getGeminiKey -> getActiveApiKey -> loadApiKeys)
// reads its key through localStorage, so seeding it here lets the REAL
// key-lookup implementation run unmodified, rather than needing to stub
// getGeminiKey itself (which would just get shadowed anyway, since
// ai-features.js declares its own top-level `function getGeminiKey`).
function makeLocalStorage(seed) {
  const store = Object.assign({}, seed);
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
}
function makeSandbox() {
  const sandbox = {
    console,
    localStorage: makeLocalStorage({
      'anu_msp_gemini_api_keys_v2': JSON.stringify([{ id: 'k1', label: 'API 1', key: 'fake-key', color: '#000' }]),
      'anu_msp_gemini_active_key_id_v2': 'k1',
    }),
    // DOM/browser bits neither file's TOP-LEVEL code touches, but a
    // handful of functions reference defensively (statusEl params etc.)
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, innerHTML: '', appendChild() {}, addEventListener() {} }),
    },
    window: {},
    // ── stand-ins for helpers defined in OTHER real files ──
    // getOptionEntries — real implementation from js/app-core.js (pure,
    // copied verbatim rather than loading the whole file and its own
    // dependencies).
    getOptionEntries(q) {
      if (Array.isArray(q.optionsOrder) && q.optionsOrder.length) {
        return q.optionsOrder.map(({ key, value }) => [key, value]);
      }
      return Object.entries(q.options || {});
    },
    // createSilentStatusStub — real implementation from js/dom-utils.js.
    createSilentStatusStub() {
      return { innerHTML: '', insertAdjacentHTML() {}, querySelector() { return null; } };
    },
    _cqProgressStatusHTML(message) { return `<div>${message}</div>`; },
    geminiEndpoint() { return 'https://example.invalid/mock'; },
    async buildGeminiFilePart() { return { text: '(stubbed source file part)' }; },
    cqCheckPause: async () => null,
    cqPauseRequested: false,
    // callGeminiWithRetry is overridden per-test below (it's the one
    // real network call cqAiSolveQuestions makes).
    callGeminiWithRetry: null,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadInto(context, ...files) {
  files.forEach(f => {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    vm.runInContext(code, context, { filename: f });
  });
}

// ═════════════════════════════════════════════════════════════════════
// SUITE A — cqRunContentFilterPasses (multi-pass / Micro Filter / stop)
// ═════════════════════════════════════════════════════════════════════
function suiteA() {
  console.log('\n== Suite A: cqRunContentFilterPasses (multi-pass wrapper) ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-features.js', 'gemini-uploads.js');

  function freshQuestions(n) {
    return Array.from({ length: n }, (_, i) => ({ id: 'q' + i, question: `Question ${i}`, options: { A: 'x', B: 'y' }, answer: 'A' }));
  }

  // Install a controllable mock for the single-pass function, recording
  // every call, so the wrapper's looping/stopping/cancellation logic can
  // be tested without any real AI call underneath it.
  function installMockPass(ctx, { removalsPerPass, onCall } = {}) {
    let callIdx = 0;
    ctx.cqRunContentFilterPass = async function (passArray, sourceFiles, cancelToken, statusEl, batchSize, passNum, totalPasses) {
      const thisCall = { passArray, sourceFiles, cancelToken, batchSize, passNum, totalPasses, callIdx };
      if (onCall) onCall(thisCall);
      const toRemove = Array.isArray(removalsPerPass) ? (removalsPerPass[callIdx] || 0) : (removalsPerPass || 0);
      callIdx++;
      // Simulate removing `toRemove` questions from the END of the array,
      // exactly like the real function splices survivors down in place.
      for (let i = 0; i < toRemove && passArray.length; i++) passArray.pop();
      return { removed: toRemove, remaining: passArray.length };
    };
    return () => callIdx; // returns a getter for how many times it was called
  }

  return (async () => {
    await testAsync('default options run exactly one pass', async () => {
      const questions = freshQuestions(5);
      const calls = [];
      installMockPass(ctx, { removalsPerPass: [1], onCall: c => calls.push(c) });
      const result = await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, {});
      assertEqual(calls.length, 1, 'should call the single-pass function exactly once');
      assertEqual(result.passesRun, 1, 'passesRun should be 1');
      assertEqual(result.removed, 1, 'removed should reflect the one pass');
      assertEqual(questions.length, 4, 'caller\'s array should be mutated in place to the new length');
    });

    await testAsync('a pass that removes nothing ends the run early, even with more passes requested', async () => {
      const questions = freshQuestions(6);
      const calls = [];
      // pass 1 removes 2, pass 2 removes 0 -> should stop after pass 2,
      // never reaching pass 3 even though passes:5 was requested.
      installMockPass(ctx, { removalsPerPass: [2, 0, 3, 3, 3], onCall: c => calls.push(c) });
      const result = await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, { passes: 5 });
      assertEqual(calls.length, 2, 'should stop right after the pass that removed nothing');
      assertEqual(result.passesRun, 2, 'passesRun should be 2');
      assertEqual(result.removed, 2, 'total removed should only count the passes that actually ran');
      assertEqual(questions.length, 4, '6 - 2 removed = 4 remaining');
    });

    await testAsync('passes:N runs at most N passes when every pass keeps removing something', async () => {
      const questions = freshQuestions(10);
      const calls = [];
      installMockPass(ctx, { removalsPerPass: [1, 1, 1, 1, 1], onCall: c => calls.push(c) });
      const result = await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, { passes: 3 });
      assertEqual(calls.length, 3, 'should stop at the requested cap even though every pass still removed something');
      assertEqual(result.passesRun, 3);
      assertEqual(questions.length, 7, '10 - 3x1 removed = 7 remaining');
    });

    await testAsync('micro:true ignores passes and keeps going until a pass removes nothing', async () => {
      const questions = freshQuestions(20);
      const calls = [];
      installMockPass(ctx, { removalsPerPass: [3, 2, 1, 0], onCall: c => calls.push(c) });
      const result = await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, { micro: true, passes: 1 });
      assertEqual(calls.length, 4, 'micro should keep going past passes:1 until a pass removes nothing');
      assertEqual(result.passesRun, 4);
      assertEqual(result.removed, 6, '3+2+1+0');
      assertEqual(questions.length, 14, '20 - 6 removed = 14 remaining');
    });

    await testAsync('batchSize is forwarded to every pass call', async () => {
      const questions = freshQuestions(5);
      const calls = [];
      installMockPass(ctx, { removalsPerPass: [1, 0], onCall: c => calls.push(c) });
      await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, { batchSize: 7, passes: 3 });
      assert(calls.every(c => c.batchSize === 7), 'every pass call should receive batchSize:7');
    });

    await testAsync('pass numbering: totalPasses is null under micro, set under fixed passes', async () => {
      const questions = freshQuestions(5);
      const calls = [];
      installMockPass(ctx, { removalsPerPass: [0], onCall: c => calls.push(c) });
      await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, { micro: true });
      assertEqual(calls[0].passNum, 1);
      assertEqual(calls[0].totalPasses, null, 'micro mode should not report a fixed total');

      const questions2 = freshQuestions(5);
      const calls2 = [];
      installMockPass(ctx, { removalsPerPass: [0], onCall: c => calls2.push(c) });
      await ctx.cqRunContentFilterPasses(questions2, [{}], { cancelled: false }, null, { passes: 4 });
      assertEqual(calls2[0].totalPasses, 4, 'fixed-passes mode should report the requested total');
    });

    await testAsync('cancelling BEFORE the loop starts runs zero passes and leaves the array untouched', async () => {
      const questions = freshQuestions(5);
      const calls = [];
      installMockPass(ctx, { removalsPerPass: [9], onCall: c => calls.push(c) });
      const token = { cancelled: true };
      const result = await ctx.cqRunContentFilterPasses(questions, [{}], token, null, { passes: 5 });
      assertEqual(calls.length, 0, 'should never call the single-pass function');
      assertEqual(result.stoppedByUser, true);
      assertEqual(result.passesRun, 0);
      assertEqual(questions.length, 5, 'array must be untouched');
    });

    await testAsync('cancelling MID-PASS discards that pass entirely — array reflects only fully-completed passes', async () => {
      const questions = freshQuestions(10);
      const token = { cancelled: false };
      let callN = 0;
      // Custom mock (not the generic helper) so we can flip `cancelled`
      // partway through pass 2, simulating the user clicking Stop while a
      // pass is in flight.
      ctx.cqRunContentFilterPass = async function (passArray) {
        callN++;
        if (callN === 1) {
          // Pass 1 completes cleanly, removing 2.
          passArray.pop(); passArray.pop();
          return { removed: 2, remaining: passArray.length };
        }
        // Pass 2: user stops mid-way — the pass still mutates its own
        // (private, uncommitted) copy before the cancellation is noticed,
        // exactly like a real pass cut short mid-batch.
        passArray.pop(); passArray.pop(); passArray.pop();
        token.cancelled = true;
        return { removed: 3, remaining: passArray.length };
      };
      const result = await ctx.cqRunContentFilterPasses(questions, [{}], token, null, { passes: 5 });
      assertEqual(callN, 2, 'pass 2 should have been attempted');
      assertEqual(result.stoppedByUser, true);
      assertEqual(result.passesRun, 1, 'only pass 1 counts as having actually completed');
      assertEqual(result.removed, 2, 'only pass 1\'s removals should be counted');
      assertEqual(questions.length, 8, '10 - 2 (pass 1 only) = 8 — pass 2\'s partial removals must be discarded');
    });

    await testAsync('each pass receives a fresh, isolated copy — never the committed array directly', async () => {
      const questions = freshQuestions(5);
      const seenArrays = [];
      installMockPass(ctx, { removalsPerPass: [1, 1, 0], onCall: c => seenArrays.push(c.passArray) });
      await ctx.cqRunContentFilterPasses(questions, [{}], { cancelled: false }, null, { passes: 5 });
      assert(seenArrays[0] !== seenArrays[1] && seenArrays[1] !== seenArrays[2], 'every pass must get a distinct array object');
      assert(seenArrays.every(a => a !== questions), 'no pass should ever be handed the caller\'s live array directly');
    });
  })();
}

// ═════════════════════════════════════════════════════════════════════
// SUITE B — cqAiSolveQuestions chunkSize / batching
// ═════════════════════════════════════════════════════════════════════
function suiteB() {
  console.log('\n== Suite B: cqAiSolveQuestions batching (chunkSize) ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-features.js', 'gemini-uploads.js');

  function makeQuestions(n) {
    return Array.from({ length: n }, (_, i) => ({ question: `Q${i}`, options: { A: 'x', B: 'y' }, answer: 'A' }));
  }

  return (async () => {
    await testAsync('default chunkSize (20) batches correctly', async () => {
      const questions = makeQuestions(45); // -> ceil(45/20) = 3 batches: 20,20,5
      const targetIdxs = questions.map((_, i) => i);
      const batchSizesSeen = [];
      ctx.callGeminiWithRetry = async (url, body) => {
        const qCount = (body.contents[0].parts || []).filter(p => p.text && /^Question \d+ \[index:/.test(p.text)).length;
        batchSizesSeen.push(qCount);
        const answers = body.contents[0].parts
          .filter(p => p.text && /^Question \d+ \[index:/.test(p.text))
          .map(p => {
            const m = p.text.match(/\[index:(\d+)\]/);
            return { index: Number(m[1]), answer: 'A', found_in_source: true };
          });
        return { candidates: [{ content: { parts: [{ text: JSON.stringify(answers) }] } }] };
      };
      await ctx.cqAiSolveQuestions(questions, targetIdxs, '', [], null, { cancelled: false });
      assertDeepEqual(batchSizesSeen, [20, 20, 5], 'default CHUNK_SIZE should be 20');
      assert(questions.every(q => q.ai_answered), 'every question should have been marked answered');
    });

    await testAsync('custom chunkSize changes the batching (Content Filter\'s batch-size config)', async () => {
      const questions = makeQuestions(22);
      const targetIdxs = questions.map((_, i) => i);
      const batchSizesSeen = [];
      ctx.callGeminiWithRetry = async (url, body) => {
        const qCount = (body.contents[0].parts || []).filter(p => p.text && /^Question \d+ \[index:/.test(p.text)).length;
        batchSizesSeen.push(qCount);
        const answers = body.contents[0].parts
          .filter(p => p.text && /^Question \d+ \[index:/.test(p.text))
          .map(p => {
            const m = p.text.match(/\[index:(\d+)\]/);
            return { index: Number(m[1]), answer: 'A', found_in_source: true };
          });
        return { candidates: [{ content: { parts: [{ text: JSON.stringify(answers) }] } }] };
      };
      await ctx.cqAiSolveQuestions(questions, targetIdxs, '', [], null, { cancelled: false }, null, 5);
      assertDeepEqual(batchSizesSeen, [5, 5, 5, 5, 2], 'chunkSize:5 should produce 5-question batches (last one partial)');
    });

    await testAsync('other callers that omit chunkSize keep the old default of 20 (no regression)', async () => {
      const questions = makeQuestions(21);
      const targetIdxs = questions.map((_, i) => i);
      let calls = 0;
      ctx.callGeminiWithRetry = async (url, body) => {
        calls++;
        return { candidates: [{ content: { parts: [{ text: '[]' }] } }] };
      };
      // Mirrors a real call site like cqAiAnswerMissingKeys — no trailing
      // chunkSize argument at all.
      await ctx.cqAiSolveQuestions(questions, targetIdxs, '', [], null, { cancelled: false }, null);
      assertEqual(calls, 2, '21 questions / default 20 = 2 batches, unchanged from before this feature existed');
    });

    await testAsync('"(batch N of M)" is written to statusEl on every batch, including a single-batch run (project drop #131)', async () => {
      // A fake statusEl that only records what real DOM code would show —
      // this is the exact regression build #131 fixes: the counter used
      // to be hidden whenever a run fit in one batch, which is most runs
      // (default batch size 20, most quizzes under that).
      function makeFakeStatusEl() {
        const el = { written: [] };
        Object.defineProperty(el, 'innerHTML', {
          set(v) { el.written.push(v); },
          get() { return el.written[el.written.length - 1] || ''; }
        });
        el.insertAdjacentHTML = (pos, html) => { el.written.push(html); };
        el.querySelector = () => null;
        return el;
      }

      ctx.callGeminiWithRetry = async (url, body) => {
        const answers = body.contents[0].parts
          .filter(p => p.text && /^Question \d+ \[index:/.test(p.text))
          .map(p => {
            const m = p.text.match(/\[index:(\d+)\]/);
            return { index: Number(m[1]), answer: 'A', found_in_source: true };
          });
        return { candidates: [{ content: { parts: [{ text: JSON.stringify(answers) }] } }] };
      };

      // Single-batch run (5 questions, well under the default 20).
      const smallEl = makeFakeStatusEl();
      const smallQuestions = makeQuestions(5);
      await ctx.cqAiSolveQuestions(smallQuestions, smallQuestions.map((_, i) => i), '', [], smallEl, { cancelled: false });
      assert(smallEl.written.some(w => /\(batch 1 of 1\)/.test(w)),
        'a single-batch run should still show "(batch 1 of 1)", not hide the counter');

      // Multi-batch run (45 questions -> 3 batches of 20/20/5).
      const bigEl = makeFakeStatusEl();
      const bigQuestions = makeQuestions(45);
      await ctx.cqAiSolveQuestions(bigQuestions, bigQuestions.map((_, i) => i), '', [], bigEl, { cancelled: false });
      ['(batch 1 of 3)', '(batch 2 of 3)', '(batch 3 of 3)'].forEach(marker => {
        assert(bigEl.written.some(w => w.includes(marker)), `multi-batch run should show "${marker}"`);
      });
    });
  })();
}

// ═════════════════════════════════════════════════════════════════════
// SUITE C — case-context-preserving deletion
// ═════════════════════════════════════════════════════════════════════
function suiteC() {
  console.log('\n== Suite C: _caseGroupOnQuestionDeleted (context-preserving promotion) ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-features.js');

  function q(id, text, extra) {
    return Object.assign({ id, question: text, options: { A: 'x', B: 'y' }, answer: 'A' }, extra || {});
  }

  test('deleting the root core promotes its first direct child, merging case text onto it', () => {
    // root (core) -> [dep1, dep2]  (both direct children, no nesting)
    const root = q('root', 'Shared vignette: a 45yo man presents with chest pain.', { case_group: 'g1', case_is_core: true });
    const dep1 = q('dep1', 'What is the most likely diagnosis?', { case_group: 'g1' });
    const dep2 = q('dep2', 'What is the next best test?', { case_group: 'g1' });
    const questions = [root, dep1, dep2];

    const idx = questions.indexOf(root);
    const [deleted] = questions.splice(idx, 1);
    ctx._caseGroupOnQuestionDeleted(questions, deleted);

    assertEqual(questions.length, 2);
    assert(dep1.case_is_core === true, 'dep1 (first linked question) should become the new core');
    assertEqual(dep1.case_parent_id, null, 'the new root must have no parent of its own');
    assert(dep1.question.includes('Shared vignette'), 'the removed core\'s case text should be merged onto the promoted question');
    assert(dep1.question.includes('most likely diagnosis'), 'the promoted question\'s own original text must be preserved, not overwritten');
    assert(dep2.case_is_core !== true, 'dep2 should remain a plain dependent');
    const dep2Parent = ctx._cqFindCaseParent(questions, dep2);
    assert(dep2Parent === dep1, 'dep2 should still resolve to the (new) root as its parent');
  });

  test('promoted question\'s own image is kept; the removed core\'s image only fills in if promoted has none', () => {
    const root = q('root', 'Case with a scan.', { case_group: 'g1', case_is_core: true, image: 'data:image/png;base64,ROOTIMG' });
    const dep1 = q('dep1', 'Diagnosis?', { case_group: 'g1' }); // no image of its own
    const dep2 = q('dep2', 'Next step?', { case_group: 'g1', image: 'data:image/png;base64,OWNIMG' });
    const questions = [root, dep1, dep2];
    questions.splice(0, 1);
    ctx._caseGroupOnQuestionDeleted(questions, root);
    assertEqual(dep1.image, 'data:image/png;base64,ROOTIMG', 'promoted question with no image of its own should inherit the removed core\'s image');
  });

  test('deleting a MID-LEVEL sub-case re-attaches its children to the promoted node, preserving the level above', () => {
    // root -> subcase (dep of root) -> [grandkid1, grandkid2] (nested under subcase)
    const root = q('root', 'Top-level case.', { case_group: 'g1', case_is_core: true });
    const subcase = q('sub', 'Lab results panel for this patient.', { case_group: 'g1' });
    ctx._caseGroupEnsureLinkId(subcase);
    const grandkid1 = q('gk1', 'Interpret result A.', { case_group: 'g1', case_parent_id: subcase.case_link_id });
    const grandkid2 = q('gk2', 'Interpret result B.', { case_group: 'g1', case_parent_id: subcase.case_link_id });
    const questions = [root, subcase, grandkid1, grandkid2];

    const idx = questions.indexOf(subcase);
    const [deleted] = questions.splice(idx, 1);
    ctx._caseGroupOnQuestionDeleted(questions, deleted);

    assertEqual(questions.length, 3);
    assert(grandkid1.case_is_core !== true, 'grandkid1 should NOT become the group root — the root is still `root`');
    // grandkid1 (first linked question under the deleted sub-case) should
    // now BE the sub-case: it inherits the deleted node's position
    // (child of root) and carries the merged lab-panel text.
    assertEqual(grandkid1.case_parent_id, null, 'promoted node inherits the deleted sub-case\'s own parent pointer (direct child of root)');
    assert(grandkid1.question.includes('Lab results panel'), 'the deleted sub-case\'s context text should be merged onto grandkid1');
    // grandkid2 (the OTHER child of the deleted sub-case) must now point
    // at grandkid1 instead of the no-longer-existing sub-case.
    const gk2Parent = ctx._cqFindCaseParent(questions, grandkid2);
    assert(gk2Parent === grandkid1, 'grandkid2 should be re-homed onto the promoted node (grandkid1), not left dangling or bumped to root');
    // root must be untouched.
    assert(root.case_is_core === true, 'the root above the deleted sub-case must be untouched');
  });

  test('three-level chain: deleting the middle node keeps the whole chain walkable from the new grandchild view', () => {
    const root = q('root', 'Level 1 case.', { case_group: 'g1', case_is_core: true });
    const mid = q('mid', 'Level 2 sub-case.', { case_group: 'g1' });
    ctx._caseGroupEnsureLinkId(mid);
    mid.case_parent_id = null; // direct child of root
    const leaf = q('leaf', 'Level 3 question.', { case_group: 'g1', case_parent_id: mid.case_link_id });
    const questions = [root, mid, leaf];

    questions.splice(questions.indexOf(mid), 1);
    ctx._caseGroupOnQuestionDeleted(questions, mid);

    assertEqual(questions.length, 2);
    // leaf (mid's only child) is promoted to take mid's place directly
    // under root, and absorbs mid's case text.
    assertEqual(leaf.case_parent_id, null);
    assert(leaf.question.includes('Level 2 sub-case'));
    const chain = ctx._cqCaseAncestorChain(questions, leaf);
    // leaf is now itself a direct child of root, so its own ancestor
    // chain (computed for anyone nested under IT) would start at root —
    // sanity-check leaf resolves to root as its parent.
    assert(ctx._cqFindCaseParent(questions, leaf) === root, 'leaf should now resolve directly to root as its parent');
  });

  test('deleting a leaf (no children) does not touch the rest of the group', () => {
    const root = q('root', 'Case.', { case_group: 'g1', case_is_core: true });
    const dep1 = q('dep1', 'Q1', { case_group: 'g1' });
    const dep2 = q('dep2', 'Q2', { case_group: 'g1' });
    const questions = [root, dep1, dep2];
    questions.splice(questions.indexOf(dep2), 1);
    ctx._caseGroupOnQuestionDeleted(questions, dep2);
    assertEqual(questions.length, 2);
    assert(root.case_is_core === true, 'root should remain core');
    assertEqual(root.question, 'Case.', 'root\'s text should be untouched by an unrelated leaf deletion');
    assertEqual(dep1.question, 'Q1', 'sibling should be untouched');
  });

  test('deleting a question outside any case group is a no-op', () => {
    const solo = q('solo', 'Standalone question.');
    const questions = [solo];
    questions.splice(0, 1);
    // Should not throw.
    ctx._caseGroupOnQuestionDeleted(questions, solo);
    assertEqual(questions.length, 0);
  });

  test('merge never duplicates identical/already-merged text on repeated normalization', () => {
    const root = q('root', 'Shared case text.', { case_group: 'g1', case_is_core: true });
    const dep1 = q('dep1', 'Own question.', { case_group: 'g1' });
    const questions = [root, dep1];
    questions.splice(0, 1);
    ctx._caseGroupOnQuestionDeleted(questions, root);
    const merged = dep1.question;
    assertEqual(merged, 'Shared case text.\n\nOwn question.');
    // Re-running normalization on the SAME (already-merged) group should
    // not change or duplicate the text further.
    ctx._cqNormalizeCaseParents(questions, questions.filter(o => o.case_group === 'g1'));
    assertEqual(dep1.question, merged, 'text should be stable across repeated normalization passes');
  });
}

// ═════════════════════════════════════════════════════════════════════
// SUITE D — end-to-end: cqRunContentFilterPass wired into real case-group
// promotion (no mocking of the case-group logic, only the AI call)
// ═════════════════════════════════════════════════════════════════════
function suiteD() {
  console.log('\n== Suite D: cqRunContentFilterPass end-to-end with real case-group promotion ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-features.js', 'gemini-uploads.js');
  // buildGeminiFilePart is defined for real inside gemini-uploads.js
  // (it reads/validates actual File objects), which shadows the sandbox
  // stub the moment that file loads — same as callGeminiWithRetry, it
  // has to be re-stubbed AFTER loading, not before.
  ctx.buildGeminiFilePart = async () => ({ text: '(stubbed source file part)' });

  return (async () => {
    await testAsync('filtering out the case-holding core preserves context on its first surviving dependent', async () => {
      const root = { question: 'A 30yo woman presents with a rash after starting a new drug.', options: { A: 'x', B: 'y' }, answer: 'A', case_group: 'g1', case_is_core: true };
      const dep1 = { question: 'What is the most likely diagnosis?', options: { A: 'SJS', B: 'Eczema' }, answer: 'A', case_group: 'g1' };
      const dep2 = { question: 'What is the next step in management?', options: { A: 'Stop drug', B: 'Continue' }, answer: 'A', case_group: 'g1' };
      const questions = [root, dep1, dep2];

      // Fake Gemini: fails (ai_guessed) only the root/core question
      // (index 0) — simulating Content Filter correctly flagging that
      // the vignette's own "answer" isn't literally sourced, while both
      // real questions ARE found in source.
      ctx.callGeminiWithRetry = async (url, body) => {
        const parts = body.contents[0].parts.filter(p => p.text && /^Question \d+ \[index:/.test(p.text));
        const answers = parts.map(p => {
          const m = p.text.match(/\[index:(\d+)\]/);
          const idx = Number(m[1]);
          return { index: idx, answer: 'A', found_in_source: idx !== 0 };
        });
        return { candidates: [{ content: { parts: [{ text: JSON.stringify(answers) }] } }] };
      };

      const result = await ctx.cqRunContentFilterPass(questions, [{ name: 'source.pdf' }], { cancelled: false }, null, 20, 1, 1);

      assertEqual(result.removed, 1, 'only the core question should have been removed');
      assertEqual(questions.length, 2, 'both real questions should survive');
      assert(!questions.includes(root), 'the core object itself should be gone');
      assert(dep1.case_is_core === true, 'dep1 should have been promoted to core');
      assert(dep1.question.includes('rash after starting a new drug'), 'the case narrative must survive on the promoted question');
      assert(dep1.question.includes('most likely diagnosis'), 'dep1\'s own original question must still be there too');
      const dep2Parent = ctx._cqFindCaseParent(questions, dep2);
      assert(dep2Parent === dep1, 'dep2 should still correctly resolve to the new (promoted) core');
    });
  })();
}

// ═════════════════════════════════════════════════════════════════════
// SUITE E — the other three batch-using tools' configurable batch size:
// cqAiAnswerMissingKeys (AI Answering / missing-key submode) and
// extractImagesForQuestions / cqBulkReextractMissingImages (image batch)
// ═════════════════════════════════════════════════════════════════════
function suiteE() {
  console.log('\n== Suite E: cqAiAnswerMissingKeys / image batching (chunkSize forwarding) ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-features.js', 'gemini-uploads.js');
  ctx.buildGeminiFilePart = async () => ({ text: '(stubbed source file part)' });

  return (async () => {
    await testAsync('cqAiAnswerMissingKeys forwards a custom chunkSize to cqAiSolveQuestions', async () => {
      const questions = Array.from({ length: 12 }, (_, i) => ({
        question: `Q${i}`, options: { A: 'x', B: 'y' }, answer: 'A', no_answer_key: true,
      }));
      const batchSizesSeen = [];
      ctx.callGeminiWithRetry = async (url, body) => {
        const qCount = (body.contents[0].parts || []).filter(p => p.text && /^Question \d+ \[index:/.test(p.text)).length;
        batchSizesSeen.push(qCount);
        const answers = body.contents[0].parts
          .filter(p => p.text && /^Question \d+ \[index:/.test(p.text))
          .map(p => ({ index: Number(p.text.match(/\[index:(\d+)\]/)[1]), answer: 'A', found_in_source: true }));
        return { candidates: [{ content: { parts: [{ text: JSON.stringify(answers) }] } }] };
      };
      await ctx.cqAiAnswerMissingKeys(questions, '', [], null, { cancelled: false }, 4);
      assertDeepEqual(batchSizesSeen, [4, 4, 4], 'chunkSize:4 across 12 no-key questions should produce three 4-question batches');
    });

    await testAsync('cqAiAnswerMissingKeys with no chunkSize keeps the old default of 20', async () => {
      const questions = Array.from({ length: 5 }, (_, i) => ({
        question: `Q${i}`, options: { A: 'x', B: 'y' }, answer: 'A', no_answer_key: true,
      }));
      let calls = 0;
      ctx.callGeminiWithRetry = async () => { calls++; return { candidates: [{ content: { parts: [{ text: '[]' }] } }] }; };
      await ctx.cqAiAnswerMissingKeys(questions, '', [], null, { cancelled: false });
      assertEqual(calls, 1, '5 no-key questions under the default batch size of 20 should be a single request');
    });

    await testAsync('extractImagesForQuestions batches bounding-box lookups by the given batchSize', async () => {
      const questions = Array.from({ length: 7 }, (_, i) => ({ has_image: true, question: `Q${i}` }));
      const batchesSeen = [];
      ctx.getBoundingBoxes = async (batch) => { batchesSeen.push(batch.length); return []; };
      const file = { name: 'src.pdf', type: 'application/pdf' };
      await ctx.extractImagesForQuestions(questions, file, 'fake-key', undefined, undefined, { cancelled: false }, null, 3);
      assertDeepEqual(batchesSeen, [3, 3, 1], 'batchSize:3 across 7 image questions should produce batches of 3,3,1');
    });

    await testAsync('extractImagesForQuestions with no batchSize keeps the old default of GEMINI_BOUNDING_BOX_BATCH_SIZE (15)', async () => {
      const questions = Array.from({ length: 20 }, (_, i) => ({ has_image: true, question: `Q${i}` }));
      const batchesSeen = [];
      ctx.getBoundingBoxes = async (batch) => { batchesSeen.push(batch.length); return []; };
      const file = { name: 'src.pdf', type: 'application/pdf' };
      await ctx.extractImagesForQuestions(questions, file, 'fake-key', undefined, undefined, { cancelled: false }, null);
      assertDeepEqual(batchesSeen, [15, 5], 'default batch size should still be 15, unchanged from before this feature existed');
    });

    await testAsync('cqBulkReextractMissingImages forwards its batchSize through to extractImagesForQuestions', async () => {
      const file = { name: 'src.pdf', type: 'application/pdf' };
      const questions = Array.from({ length: 4 }, (_, i) => ({
        has_image: true, image: null, _sourceFile: file, question: `Q${i}`,
      }));
      let seenBatchSize = null;
      ctx.extractImagesForQuestions = async (qs, f, apiKey, filePart, custom, cancelToken, pauseCheck, batchSize) => {
        seenBatchSize = batchSize;
      };
      await ctx.cqBulkReextractMissingImages(questions, null, { cancelled: false }, 8);
      assertEqual(seenBatchSize, 8, 'the bulk tool\'s batchSize argument should reach extractImagesForQuestions unchanged');
    });
  })();
}

// ═════════════════════════════════════════════════════════════════════
// SUITE F — collapsible panel state (Content Filter source + config
// merged into one "Content Filter settings" menu, collapsed by default,
// and no bulk-tool options panel collapses out from under the user when
// unrelated HTML around it gets rebuilt — e.g. adding/removing a
// reference-source file, or Micro Filter's onchange rerender).
// ═════════════════════════════════════════════════════════════════════
function suiteF() {
  console.log('\n== Suite F: collapsible panel state persists across re-renders ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-features.js', 'gemini-uploads.js');

  test('_detailsIsOpen defaults to the caller-supplied value until _detailsToggle is called', () => {
    assertEqual(ctx._detailsIsOpen('freshScopeKey', false), false, 'unset scope key with default=false');
    assertEqual(ctx._detailsIsOpen('freshScopeKey', true), true, 'unset scope key with default=true');
    ctx._detailsToggle('freshScopeKey', true);
    assertEqual(ctx._detailsIsOpen('freshScopeKey', false), true, 'state set by _detailsToggle overrides the default');
    ctx._detailsToggle('freshScopeKey', false);
    assertEqual(ctx._detailsIsOpen('freshScopeKey', true), false, 'state set by _detailsToggle overrides the default, either direction');
  });

  // _editorBulkFilterSourceFiles/_editorBulkBusy are declared `const` inside
  // ai-features.js, so (unlike its `function`-declared helpers) they never
  // become properties of the vm context and can't be poked at directly from
  // here — same as every other suite in this file works around that by
  // driving state only through the real functions. `_renderBulkContentFilterToolHTML`
  // takes `busy` as a plain argument, so that one's a non-issue; the source
  // file list is populated via the real `_editorBulkSourceAcceptFile()`, and
  // each test below uses one of the three pre-seeded editor keys
  // ('cq'/'admin'/'customQuiz') so they don't share mutable state.
  test('Content Filter source + config are merged into one "Content Filter settings" panel', () => {
    const html = ctx._renderBulkContentFilterToolHTML('cq', false, null);
    const settingsCount = (html.match(/Content Filter settings<\/summary>/g) || []).length;
    assertEqual(settingsCount, 1, 'exactly one merged "Content Filter settings" menu is rendered');
    assert(!/Content Filter source<\/summary>/.test(html) && !/Content Filter config<\/summary>/.test(html),
      'the old separate "Content Filter source"/"Content Filter config" menus no longer exist');
    assert(html.includes('cqBulkFilterSourceDropzone'), 'the reference-source dropzone lives inside the merged panel');
    assert(html.includes('cqFilterPassesInput'), 'the passes/batch-size config lives inside the same merged panel');
  });

  test('the merged Content Filter settings panel is collapsed by default', () => {
    const html = ctx._renderBulkContentFilterToolHTML('admin', false, null);
    const detailsTag = html.slice(html.lastIndexOf('<details', html.indexOf('Content Filter settings</summary>')), html.indexOf('Content Filter settings</summary>'));
    // (^|\s)open(\s|>) rather than a bare \bopen\b — the latter also
    // matches "this.open" inside the ontoggle="..." attribute value,
    // which is unrelated to whether the <details> itself starts open.
    assert(!/(^|\s)open(\s|>)/.test(detailsTag), `should have no standalone "open" attribute on first render — got: ${detailsTag.trim()}`);
  });

  test('adding a reference-source file (a full rerender) does not collapse a panel the user had open', () => {
    // Simulate the user having expanded the panel — this is exactly what
    // the `ontoggle` handler wired onto the real <details> does.
    ctx._detailsToggle('customQuiz_filterOpts', true);
    // Simulate adding a source file through the real handler
    // (_editorBulkSourceFileSelect calls this same function before
    // triggering the full-panel rerender that used to collapse things).
    ctx._editorBulkSourceAcceptFile('customQuiz', 'Filter', { name: 'page1.png', type: 'image/png', size: 100 });
    const html = ctx._renderBulkContentFilterToolHTML('customQuiz', false, null);
    const detailsTag = html.slice(html.lastIndexOf('<details', html.indexOf('Content Filter settings</summary>')), html.indexOf('Content Filter settings</summary>'));
    assert(/(^|\s)open(\s|>)/.test(detailsTag), `panel should stay open after the rerender — got: ${detailsTag.trim()}`);
  });

  test('every bulk-tool options <details> (Solve/Filter/Refine/Reextract) reads its state from _detailsIsOpen, not a hardcoded value', () => {
    const aiFeaturesSrc = fs.readFileSync(path.join(SRC, 'ai-features.js'), 'utf8');
    const firebaseStorageSrc = fs.readFileSync(path.join(SRC, 'firebase-storage.js'), 'utf8');
    [aiFeaturesSrc, firebaseStorageSrc].forEach((src, i) => {
      const re = /<details class="cq-bulk-ai-opts"[^>]*>/g;
      let m; let count = 0;
      while ((m = re.exec(src))) {
        count++;
        assert(/_detailsIsOpen\(/.test(m[0]), `<details> tag should call _detailsIsOpen() in file ${i} — got: ${m[0]}`);
        assert(/ontoggle="_detailsToggle\(/.test(m[0]), `<details> tag should wire ontoggle to _detailsToggle() in file ${i} — got: ${m[0]}`);
      }
      assert(count > 0, `at least one cq-bulk-ai-opts <details> should exist in file ${i}`);
    });
  });
}

// ═════════════════════════════════════════════════════════════════════
// SUITE G — _renderAiSolveStatusBadge (shared AI Guess/AI-answered/No Key
// pill) — project drop #131. Previously this markup only existed inline
// inside the post-extraction preview's render loop (js/ai-solve.js), so
// the Admin and Custom-Quiz editors (js/quiz-editor.js) never showed it
// at all. Now all three call the same shared helper (js/ai-question-
// tools.js) — this suite checks the helper itself renders correctly for
// every question state, and that both quiz-editor.js render functions
// actually call it.
// ═════════════════════════════════════════════════════════════════════
function suiteG() {
  console.log('\n== Suite G: _renderAiSolveStatusBadge (shared across all editors) ==');
  const sandbox = makeSandbox();
  const ctx = vm.createContext(sandbox);
  loadInto(ctx, 'ai-question-tools.js');

  test('ai_guessed renders the amber "AI Guess" pill', () => {
    const html = ctx._renderAiSolveStatusBadge({ ai_guessed: true, ai_answered: true });
    assert(html.includes('AI Guess'), 'should show "AI Guess"');
    assert(!html.includes('AI-answered'), 'ai_guessed should take priority over ai_answered');
  });

  test('ai_answered (without ai_guessed) renders the violet "AI-answered" pill', () => {
    const html = ctx._renderAiSolveStatusBadge({ ai_answered: true });
    assert(html.includes('AI-answered'), 'should show "AI-answered"');
  });

  test('no_answer_key (with neither AI flag) renders the "No Key" pill', () => {
    const html = ctx._renderAiSolveStatusBadge({ no_answer_key: true });
    assert(html.includes('No Key'), 'should show "No Key"');
  });

  test('a plain manually-answered question renders nothing', () => {
    assertEqual(ctx._renderAiSolveStatusBadge({ answer: 'A' }), '', 'no badge for an ordinary question');
    assertEqual(ctx._renderAiSolveStatusBadge(null), '', 'no badge for a missing question');
  });

  test('the post-extraction preview, Admin editor, and Custom-Quiz editor all call the shared helper', () => {
    const files = ['ai-solve.js', 'quiz-editor.js'];
    let totalCalls = 0;
    files.forEach(f => {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      const matches = src.match(/_renderAiSolveStatusBadge\(q\)/g) || [];
      totalCalls += matches.length;
    });
    // One call site in ai-solve.js (cq preview), two in quiz-editor.js
    // (Admin + Custom-Quiz) — three total across the app.
    assertEqual(totalCalls, 3, 'expected exactly 3 call sites (cq preview, Admin editor, Custom-Quiz editor)');
  });
}

// ═════════════════════════════════════════════════════════════════════
(async () => {
  await suiteA();
  await suiteB();
  suiteC();
  await suiteD();
  await suiteE();
  suiteF();
  suiteG();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailure details:');
    failures.forEach(f => console.log(`- ${f.name}\n  ${f.err.stack}`));
    process.exit(1);
  }
  process.exit(0);
})();
