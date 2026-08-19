/* ══════════════════════════════════════════════════════════
   DOM UTILS — self-healing live element references
   ──────────────────────────────────────────────────────────
   WHY THIS FILE EXISTS

   Several flows in this app run long, multi-step async work (extracting
   quiz questions, generating a quiz from a lecture, per-question and
   bulk AI tools in the quiz editors) while repeatedly writing progress
   into a handful of DOM nodes — a status box, a pause/resume/stop row,
   a generate button. Those nodes used to be looked up ONCE via
   document.getElementById() at the start of the flow, then written to
   many times across many `await`s.

   That breaks the moment the container hosting those nodes gets
   re-rendered WHILE the flow is still running in the background — e.g.
   opening the API Key Manager mid-run and switching keys (see
   useApiKey() in ai-features.js), which immediately re-renders the
   custom quiz modal even though it's still open behind the manager.
   Re-rendering replaces the live DOM nodes with fresh ones that happen
   to share the same ids — but the running flow's captured references
   still point at the OLD, now-detached nodes. Every subsequent
   progress/pause/resume update then silently writes to invisible DOM,
   while the new nodes the user actually sees stay frozen in whatever
   default state they were just rendered with (hidden pause row,
   disabled button, blank status) — until a full page reload.

   THE FIX

   liveRef() returns a Proxy that re-resolves document.getElementById(id)
   on every property access instead of caching it once, so a flow always
   ends up writing to whichever node currently has that id — even if the
   surrounding container was rebuilt several times while it was running.

   liveStatusRef() adds a small status-HTML cache on top, so a render
   function can restore a status box's last known content immediately
   after a mid-flight rebuild instead of showing it blank until the next
   update happens to land.
══════════════════════════════════════════════════════════ */

/* A self-healing stand-in for a single DOM element. Safe to hold onto
   and use across any number of `await`s. Reads return undefined and
   writes are silently dropped if the element isn't currently in the DOM,
   so callers don't need any more null-guarding than they'd already do
   for a plain element. Nested access (`.style.display = …`) is handled
   too. */
function liveRef(id) {
  const getEl = () => document.getElementById(id);
  const styleProxy = new Proxy({}, {
    get(_, prop) {
      const el = getEl();
      return el ? el.style[prop] : undefined;
    },
    set(_, prop, value) {
      const el = getEl();
      if (el) el.style[prop] = value;
      return true;
    }
  });
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'style') return styleProxy;
      const el = getEl();
      if (!el) return undefined;
      const val = el[prop];
      return typeof val === 'function' ? val.bind(el) : val;
    },
    set(_, prop, value) {
      const el = getEl();
      if (el) el[prop] = value;
      return true;
    },
    has(_, prop) {
      const el = getEl();
      return !!el && prop in el;
    }
  });
}

/* ── Status-box content cache ──
   Keyed by the status box's DOM id (already unique across the app), this
   remembers the last HTML written into it so a render function can
   restore it right away after a mid-flight rebuild — see
   getCachedStatusHTML() calls in firebase-storage.js, ai-question-tools.js
   and ai-features.js. Stale entries are harmless: every read is gated by
   the caller's own "is this actually still running?" flag, so a leftover
   cache entry from a finished run is simply never shown. */
const _statusHtmlCache = {};
function getCachedStatusHTML(key) { return _statusHtmlCache[key] || ''; }
function setCachedStatusHTML(key, html) { _statusHtmlCache[key] = html; }
function clearCachedStatusHTML(key) { delete _statusHtmlCache[key]; }

/* Same self-healing behavior as liveRef(), plus: every `.innerHTML =`
   write (and every `.insertAdjacentHTML()` append) is mirrored into the
   cache above under `cacheKey`. This means whatever a render function
   reads back with getCachedStatusHTML(cacheKey) always matches exactly
   what's currently on screen, with no extra bookkeeping needed at each
   individual call site that sets status text. */
function liveStatusRef(id, cacheKey) {
  const base = liveRef(id);
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'insertAdjacentHTML') {
        return (position, html) => {
          setCachedStatusHTML(cacheKey, getCachedStatusHTML(cacheKey) + html);
          return target.insertAdjacentHTML(position, html);
        };
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (prop === 'innerHTML') setCachedStatusHTML(cacheKey, value);
      target[prop] = value;
      return true;
    }
  });
}

/* ── Silent status target ──
   A handful of internal helpers — cqAiSolveQuestions() and everything it
   can call into mid-run (per-batch error reporting, the manual/automatic
   pause banners in cqCheckPause() / _cqEnterPause() /
   cqFallbackPauseForRateLimit(), all in js/ai-question-tools.js and
   js/gemini-uploads.js) — take a `statusEl` and both WRITE to it
   (`.innerHTML =`, `.insertAdjacentHTML()`) and READ from it
   (`.querySelector()`, to find/replace/remove their own banners).

   Some callers borrow cqAiSolveQuestions() for its side effects only and
   have no live `statusEl` on hand to show its progress/pause chatter on
   — e.g. cqRunContentFilterPass() (js/gemini-uploads.js) falls back to
   this when called without one. Normally, though, cqRunContentFilterPass
   is handed the caller's real statusEl and re-words that same chatter
   into its own batch progress bar (see _cqContentFilterProgressLabel)
   rather than discarding it. Either way, whatever target is in play
   needs to safely absorb every one of the calls above.

   A bare `{ innerHTML: '' }` object literal used to stand in for this,
   which covered plain `.innerHTML = …` writes but had no
   `insertAdjacentHTML` or `querySelector` — so the moment a silent run
   actually hit a per-batch error, a rate-limit pause, or a manual pause
   mid-filter, the shared helpers above would call one of those missing
   methods on it and throw "statusEl.insertAdjacentHTML is not a
   function", aborting the whole extraction. createSilentStatusStub()
   replaces that literal with a stub that implements everything those
   call sites actually use, so a silent run absorbs all of it instead of
   crashing. */
function createSilentStatusStub() {
  return {
    innerHTML: '',
    insertAdjacentHTML() { /* swallowed on purpose — this run stays silent */ },
    querySelector() { return null; } // "no banner found" — callers null-guard this already
  };
}

/* ══════════════════════════════════════════════════════════
   COMMUNITY FILTER BAR — shared markup builder
   ──────────────────────────────────────────────────────────
   The "search + Year/Module/Subject/Sort" bar that lets people browse
   the shared community quiz pool is rendered in five different places:
   the main Community Quizzes screen (sharing.js), the Merge Quizzes In
   picker's Community tab (community-quizzes.js), the Export to PDF
   picker's Community tab (pdf-export.js), and the admin panel's two
   community-browsing views (admin-panel.js). Each of those owns its own
   filter state and onchange handlers (the state variable names and
   re-render function differ per screen), but the bar itself — its
   layout, its icons, its theming — should always look and behave
   identically. Previously each screen carved out its own copy of this
   markup by hand, which is how they drifted: some had sort icons that
   silently failed to render at all (native <option> elements can only
   ever show plain text — any <svg>/HTML written inside one is invisible
   to the browser, not just hidden), others had none.
   _buildCommFilterBarHTML() is the single source of truth for this bar
   now. Callers pass their own ids, current values, and ready-made
   onchange/oninput attribute strings; this function owns the actual
   HTML structure and the SVG icon set so every screen gets real,
   theme-matched icons for free and any future visual tweak only needs
   to happen once. */

const _COMM_FILTER_ICONS = {
  // Calendar — same glyph already used for the "shared on" date elsewhere
  // in the community list, so Year filtering reads consistently.
  year: '<svg class="hicon" style="width:14px;height:14px;" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  // Stacked layers — a module is a group of lectures within a year.
  module: '<svg class="hicon" style="width:14px;height:14px;" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  // Tag — subjects act as a topical category on each shared quiz.
  subject: '<svg class="hicon" style="width:14px;height:14px;" viewBox="0 0 24 24"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  // Up/down arrows — ordering/sort direction.
  sort: '<svg class="hicon" style="width:14px;height:14px;" viewBox="0 0 24 24"><path d="M3 16l4 4 4-4"/><path d="M7 20V4"/><path d="M21 8l-4-4-4 4"/><path d="M17 4v16"/></svg>',
  search: '<svg class="hicon" style="width:14px;height:14px;" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
};

/**
 * Builds the full community search+filter bar as an HTML string.
 * @param {Object} cfg
 * @param {string} cfg.idPrefix - unique prefix for this screen's element ids (e.g. 'comm', 'mergeComm', 'adminComm', 'pdxComm')
 * @param {string} cfg.searchVal - current search box value (raw, will be escaped)
 * @param {string} cfg.searchOninput - JS expression string for the search input's oninput
 * @param {string} cfg.clearOnclick - JS expression string for the clear (✕) button's onclick
 * @param {string} cfg.yearVal @param {string} cfg.yearOnchange @param {string[]} cfg.allYears
 * @param {string} cfg.moduleVal @param {string} cfg.moduleOnchange @param {boolean} cfg.moduleDisabled @param {string[]} cfg.allModules
 * @param {string} cfg.subjectVal @param {string} cfg.subjectOnchange @param {boolean} cfg.subjectDisabled @param {string[]} cfg.allSubjects
 * @param {string} cfg.sortVal @param {string} cfg.sortOnchange
 * @param {number} cfg.resultCount
 * @returns {string}
 */
function _buildCommFilterBarHTML(cfg) {
  const p = cfg.idPrefix;
  const searchVal = escapeHtml(cfg.searchVal || '');
  const clearStyle = cfg.searchVal ? 'display:block' : 'display:none';
  const ic = _COMM_FILTER_ICONS;

  const subjectOptions = (cfg.allSubjects || []).map(k => {
    const lbl = (subjects[k] && (subjects[k].label || k)) || k;
    const ico = (subjects[k] && subjects[k].icon) || '';
    return `<option value="${escapeHtml(k)}" ${cfg.subjectVal === k ? 'selected' : ''}>${ico} ${escapeHtml(lbl)}</option>`;
  }).join('');

  return `
    <div class="comm-filter-bar">
      <div class="comm-search-wrap">
        <span class="comm-search-icon">${ic.search}</span>
        <input class="comm-search-input" id="${p}SearchInput" type="text"
               placeholder="Search by title, author, category or tag…"
               value="${searchVal}"
               oninput="${cfg.searchOninput}" />
        <button class="comm-search-clear" id="${p}ClearBtn" style="${clearStyle}"
                onclick="${cfg.clearOnclick}">✕</button>
      </div>
      <div class="comm-filter-row">
        <div class="comm-filter-select-wrap">
          <span class="comm-filter-icon">${ic.year}</span>
          <select class="comm-filter-select" id="${p}YearFilter" onchange="${cfg.yearOnchange}">
            <option value="">All Years</option>
            ${(cfg.allYears || []).map(y => `<option value="${escapeHtml(y)}" ${cfg.yearVal === y ? 'selected' : ''}>${escapeHtml(y)}</option>`).join('')}
          </select>
        </div>
        <div class="comm-filter-select-wrap">
          <span class="comm-filter-icon">${ic.module}</span>
          <select class="comm-filter-select" id="${p}ModuleFilter" onchange="${cfg.moduleOnchange}" ${cfg.moduleDisabled ? 'disabled' : ''}>
            <option value="">All Modules</option>
            ${(cfg.allModules || []).map(m => `<option value="${escapeHtml(m)}" ${cfg.moduleVal === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <div class="comm-filter-select-wrap">
          <span class="comm-filter-icon">${ic.subject}</span>
          <select class="comm-filter-select" id="${p}SubjectFilter" onchange="${cfg.subjectOnchange}" ${cfg.subjectDisabled ? 'disabled' : ''}>
            <option value="">All Subjects</option>
            ${subjectOptions}
          </select>
        </div>
        <div class="comm-filter-select-wrap">
          <span class="comm-filter-icon">${ic.sort}</span>
          <select class="comm-filter-select" id="${p}SortSelect" onchange="${cfg.sortOnchange}">
            <option value="newest" ${cfg.sortVal === 'newest' ? 'selected' : ''}>Newest</option>
            <option value="oldest" ${cfg.sortVal === 'oldest' ? 'selected' : ''}>Oldest</option>
            <option value="az" ${cfg.sortVal === 'az' ? 'selected' : ''}>A → Z</option>
            <option value="questions" ${cfg.sortVal === 'questions' ? 'selected' : ''}>Most Questions</option>
          </select>
        </div>
      </div>
      <div class="comm-results-count" id="${p}ResultsCount">${_commResultsCountLabel(cfg.resultCount)}</div>
    </div>`;
}

/** "N quizzes shown" / "1 quiz shown" — the one place this string is worded. */
function _commResultsCountLabel(count) {
  return `${count} quiz${count !== 1 ? 'zes' : ''} shown`;
}

/**
 * Re-renders one of the community-quiz browsing screens built on
 * _buildCommFilterBarHTML without ever touching the filter bar's own
 * DOM nodes — most importantly the search `<input>` itself.
 *
 * Every one of those screens used to rebuild its filter bar (search box
 * included) from an HTML string on *every keystroke*, because the whole
 * bar and results list were one `el.innerHTML = …` write. Destroying and
 * recreating a focused `<input>` on every keystroke doesn't just lose
 * the caret (each screen was separately patching that back with a
 * save-position/refocus hack) — on a touch device it also blinks the
 * on-screen keyboard shut and open again, which reads as the whole
 * window flickering. Splitting "the chrome" (tabs + filter bar) from
 * "the results" (the list + its count) and only ever touching the
 * latter while the person is typing removes the problem at the root:
 * the input node now simply never goes away.
 *
 * @param {Object} opts
 * @param {string} opts.idPrefix - same idPrefix passed to _buildCommFilterBarHTML
 * @param {string} opts.listContainerId - id of the element the result items get written into
 * @param {number} opts.resultCount - current filtered count, for the "N quizzes shown" line
 * @param {string} opts.listHtml - the results markup (or an empty-state block) for listContainerId
 */
function _commRenderResults(opts) {
  const listEl = document.getElementById(opts.listContainerId);
  if (listEl) listEl.innerHTML = opts.listHtml;
  const countEl = document.getElementById(opts.idPrefix + 'ResultsCount');
  if (countEl) countEl.textContent = _commResultsCountLabel(opts.resultCount);
}

/* ══════════════════════════════════════════════════════════
   SHARED SOURCE-TAB ICONS — the three "where is this quiz from"
   tabs (Curriculum / Community / My Custom Quizzes) appear in several
   independent pickers: the PDF export modal (pdf-export.js), the merge
   picker (community-quizzes.js), and the admin publish panel
   (admin-panel.js). Each used to hardcode its own copy of the same
   <svg> markup + label, which meant a design tweak had to be made in
   three places and could silently drift out of sync. Defining it once
   here — a file every one of those scripts loads after (see index.html
   script order) — keeps them identical by construction.

   `icon` is trusted, hardcoded <svg> markup (no user input), safe to
   use with .innerHTML. It must NEVER be assigned to .textContent —
   that prints the raw "<svg ...>" tag as literal text instead of
   rendering the icon (that was exactly the PDF-export tab bar bug).
   `label` is kept separate from `icon` (rather than baked into one
   combined string) so each caller can phrase its own button text —
   e.g. "Community" vs "Community Quizzes" — without string-hacking
   a shared value. A convenience `full` getter is provided for the
   common "icon + default label" case. */
const SOURCE_TAB_ICONS = {
  curriculum: {
    icon: '<svg class="sicon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    label: 'Curriculum',
  },
  community: {
    icon: '<svg class="sicon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
    label: 'Community',
  },
  custom: {
    icon: '<svg class="sicon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>',
    label: 'My Custom Quizzes',
  },
};
for (const key of Object.keys(SOURCE_TAB_ICONS)) {
  const entry = SOURCE_TAB_ICONS[key];
  Object.defineProperty(entry, 'full', { get() { return `${entry.icon} ${entry.label}`; } });
}
/* ══════════════════════════════════════════════════════════
   SHARED CONTENT LOADER — one themed loading-state markup for
   any container that renders while async data (Firestore, the
   Cloudflare Worker/R2 content API, etc.) is still in flight.
   ──────────────────────────────────────────────────────────
   Introduced in #132 to replace five near-identical hand-rolled
   spinner blocks that had drifted out of sync across files —
   js/community-quizzes.js, js/admin-panel.js (two spots, one of
   which wasn't even animated), js/pdf-export.js, and
   js/sharing.js each built their own "Loading community
   quizzes…" markup with a different icon and slightly different
   wrapper styling. Centralizing it here means every one of those
   screens renders pixel-identical, on-theme loading state, and
   any future tweak (copy, animation, sizing) only needs to
   happen once.

   Pairs with the CSS `.content-loader` component (css/styles.css,
   next to #fsLoadingToast — the two share one two-ring spinner
   language, just sized/colored for a pill vs. an in-page block).
   Not for the global "background data" toast itself — that stays
   on fsLoadingShow()/fsLoadingHide() (js/app-core.js), since it
   floats independently of whatever screen is on top. Use this
   instead any time a screen/modal needs to show a loading state
   INSIDE its own content area while it awaits a promise before it
   has anything real to render yet.

   message: required — bold primary line, e.g. "Loading community
     quizzes…". sub: optional smaller line underneath for extra
     context (e.g. "This can take a few seconds on a slow
     connection"). Both are inserted as-is — callers pass trusted,
     hardcoded copy, never raw user input. */
function contentLoaderHTML(message, sub) {
  return `<div class="content-loader">
    <div class="content-loader-ring"><span></span><span></span></div>
    <div class="content-loader-msg">${message || 'Loading…'}</div>
    ${sub ? `<div class="content-loader-sub">${sub}</div>` : ''}
  </div>`;
}
