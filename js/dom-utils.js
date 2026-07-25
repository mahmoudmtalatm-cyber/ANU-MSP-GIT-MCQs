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
   opening the 🔑 API Key Manager mid-run and switching keys (see
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
