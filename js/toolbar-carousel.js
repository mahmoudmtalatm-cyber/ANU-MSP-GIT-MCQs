/* ══════════════════════════════════════════════════════════════════════
   QUICK-ACCESS TOOLBAR — INFINITE "WHEEL" SCROLLING
   ──────────────────────────────────────────────────────────────────────
   On any screen wide enough to lay out every tile (Statistics, Retake
   Wrong, Custom Quizzes, Community, Backup, API Keys) side by side, the
   toolbar is left exactly as authored in index.html/styles.css — flat,
   centered, no scrolling.

   The moment the tiles genuinely don't fit, this module turns the row
   into an endless wheel instead of a plain scrollbar-style overflow:
     • the real tiles are padded out with one hidden copy of the set
       before them and one after, so there's always more row on either
       side to scroll into — tiles stay fully visible and fully opaque
       right up to the edge, and there's no scroll-snap either, so the
       row is free to stop at any position rather than being pulled to
       fixed "resting" points
     • a short, centered indicator pill under the toolbar tracks how far
       through the current lap the rider is as two segments rather than
       one: once the visible window scrolls past the end of a lap, the
       overflow is drawn as a second segment already waiting at the
       opposite edge, so the band appears to flow off one side and in
       from the other in lockstep with the scroll gesture — the same
       "reappears from the other side" illusion the tiles themselves get
       from their clones, but continuous rather than a discrete jump
     • once the rider scrolls a full lap past either padding copy, the
       scroll position is silently rewound by exactly one lap — since the
       pattern repeats identically, the jump is invisible and the wheel
       just keeps turning
     • the moment tiles fit again (rotate the phone, resize the window),
       the clones are removed and the toolbar reverts to the flat layout

   The order of the tiles themselves is never touched — this only changes
   how the row behaves once it can no longer show everything at once.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  const wrap = document.getElementById('toolbarWrap') || toolbar.parentElement;

  // The authoritative set of tiles, exactly as written in the HTML.
  // Clones are generated from this list on demand and never replace it.
  const originalTiles = Array.from(toolbar.children);
  if (originalTiles.length < 2) return; // nothing to loop with one tile

  const DESKTOP_BREAKPOINT = '(min-width: 720px)';

  let looping = false;
  let setWidth = 0;      // px width of exactly one lap (all tiles + gaps)
  let pendingFrame = null;

  function toolbarGap() {
    const cs = getComputedStyle(toolbar);
    return parseFloat(cs.columnGap || cs.gap) || 10;
  }

  // Width the tiles need to sit side by side, independent of whatever is
  // currently in the DOM (clones or not) — always measured from the
  // original tiles, so this is a stable, single source of truth.
  function naturalContentWidth() {
    const gap = toolbarGap();
    let width = 0;
    originalTiles.forEach((tile, i) => {
      width += tile.getBoundingClientRect().width;
      if (i > 0) width += gap;
    });
    return width;
  }

  // Space actually available for tiles inside the toolbar's own padding.
  function availableWidth() {
    const cs = getComputedStyle(toolbar);
    const paddingX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    return toolbar.clientWidth - paddingX;
  }

  /* ────────────────────────────────────────────────────────────────────
     SCROLL-POSITION INDICATOR
     A slim, two-segment pill under the toolbar that mirrors how far
     through one lap the rider has scrolled. Entirely optional visually —
     if the markup isn't present (e.g. an older cached page shell)
     everything above still works fine, this module just quietly does
     nothing.
     ──────────────────────────────────────────────────────────────────── */
  const Indicator = (function () {
    const thumb = document.getElementById('toolbarIndicatorThumb');
    const wrapThumb = document.getElementById('toolbarIndicatorThumbWrap');
    if (!thumb) return { show() {}, hide() {}, update() {} };

    function show() { wrap.classList.add('toolbar-wrap--scrollable'); }
    function hide() { wrap.classList.remove('toolbar-wrap--scrollable'); }

    // How much of the natural viewport-share width the thumb actually
    // renders at. 1 would make the thumb represent the true proportion
    // of one lap currently visible (a wide block); scaling it down turns
    // the same, still scroll-accurate thumb into a short moving line
    // instead — only the thumb shrinks, the track it travels along is
    // untouched. Bounded between MIN/MAX so it stays legible on both a
    // narrow phone track and a wide tablet one.
    const THUMB_LENGTH_SCALE = 0.4;
    const THUMB_MIN_PCT = 10;
    const THUMB_MAX_PCT = 32;

    function update() {
      if (!looping || setWidth <= 0) return;
      const viewportSharePct = Math.max(0, Math.min(100, (availableWidth() / setWidth) * 100));
      const widthPct = Math.max(THUMB_MIN_PCT, Math.min(THUMB_MAX_PCT, viewportSharePct * THUMB_LENGTH_SCALE));
      // Where the visible window's leading edge sits within the current
      // lap, as a 0..100 position along the track. Wraps from ~100 back
      // to ~0 once per lap, same as the underlying scroll position does —
      // that wrap is handled below by splitting the band across the two
      // segments, not by suppressing it.
      const startPct = (((toolbar.scrollLeft - setWidth) % setWidth) + setWidth) % setWidth / setWidth * 100;

      // The band normally fits as a single segment. Once it would run
      // past the right edge of the track, the overflow is drawn as a
      // second segment starting fresh from the left edge instead — so
      // the same band appears to flow off one side and in from the other
      // in lockstep with the actual scroll position, rather than a
      // single thumb having to jump between the two edges.
      const overflow = Math.max(0, startPct + widthPct - 100);
      thumb.style.left = startPct + '%';
      thumb.style.width = (widthPct - overflow) + '%';
      if (wrapThumb) {
        wrapThumb.style.left = '0%';
        wrapThumb.style.width = overflow + '%';
      }
    }

    return { show, hide, update };
  })();

  function buildLoop() {
    if (looping) return;
    looping = true;

    setWidth = naturalContentWidth() + toolbarGap();

    const before = document.createDocumentFragment();
    const after = document.createDocumentFragment();
    originalTiles.forEach((tile) => {
      const lead = tile.cloneNode(true);
      lead.setAttribute('aria-hidden', 'true');
      lead.tabIndex = -1;
      before.appendChild(lead);

      const trail = tile.cloneNode(true);
      trail.setAttribute('aria-hidden', 'true');
      trail.tabIndex = -1;
      after.appendChild(trail);
    });

    toolbar.insertBefore(before, toolbar.firstChild);
    toolbar.appendChild(after);
    toolbar.classList.add('toolbar--loop');

    // Land on the real (middle) lap.
    toolbar.scrollLeft = setWidth;
    toolbar.addEventListener('scroll', onScroll, { passive: true });

    Indicator.show();
    Indicator.update();
  }

  function onScroll() {
    Indicator.update();
    if (!looping || pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (toolbar.scrollLeft > 0 && toolbar.scrollLeft < setWidth * 2) return;

      // Resolve the *exact* number of laps crossed (not just one) so a
      // fast fling still lands in a single clean, instant jump no matter
      // how hard or fast the rider scrolls.
      if (toolbar.scrollLeft <= 0) {
        const laps = Math.floor((setWidth - toolbar.scrollLeft) / setWidth) + 1;
        toolbar.scrollLeft += setWidth * laps;
      } else {
        const laps = Math.floor((toolbar.scrollLeft - setWidth * 2) / setWidth) + 1;
        toolbar.scrollLeft -= setWidth * laps;
      }
      Indicator.update();
    });
  }

  function teardownLoop() {
    if (!looping) return;
    looping = false;
    toolbar.removeEventListener('scroll', onScroll);
    if (pendingFrame) { cancelAnimationFrame(pendingFrame); pendingFrame = null; }
    toolbar.classList.remove('toolbar--loop');
    toolbar.innerHTML = '';
    originalTiles.forEach((tile) => toolbar.appendChild(tile));
    toolbar.scrollLeft = 0;
    Indicator.hide();
  }

  function sync() {
    // The desktop layout (see @media (min-width:720px) in styles.css)
    // centers and wraps the tiles instead of scrolling them at all — the
    // wheel is only ever appropriate below that breakpoint, and only once
    // the tiles actually fail to fit within it.
    if (window.matchMedia(DESKTOP_BREAKPOINT).matches) {
      teardownLoop();
      return;
    }
    const fits = naturalContentWidth() <= availableWidth() + 1; // rounding guard
    if (fits) {
      teardownLoop();
    } else if (looping) {
      // Already looping across a resize (e.g. a rotating tablet that
      // still doesn't fit) — re-measure the lap width, re-land on the
      // start of the middle lap for the new size, and refresh the
      // indicator's proportions, rather than tearing the whole loop down
      // and rebuilding it.
      setWidth = naturalContentWidth() + toolbarGap();
      toolbar.scrollLeft = setWidth;
      Indicator.update();
    } else {
      buildLoop();
    }
  }

  let resizeTimer = null;
  function scheduleSync() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sync, 120);
  }

  window.addEventListener('resize', scheduleSync);
  window.addEventListener('orientationchange', scheduleSync);

  // Tile width depends on the rendered label text, so re-check once
  // webfonts (and the rest of the page) have actually finished loading.
  if (document.readyState === 'complete') {
    sync();
  } else {
    window.addEventListener('load', sync);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(sync).catch(function () {});
  }
})();