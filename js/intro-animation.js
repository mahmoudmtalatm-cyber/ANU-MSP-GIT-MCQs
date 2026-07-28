  // Fake, purely-aesthetic splash sequence — not tied to any real asset
  // loading. Timeline (see css/styles.css "INTRO LOADING SEQUENCE" for the
  // per-element animations this just triggers/gates):
  //   0ms     particles start drifting inward (auto-runs via CSS)
  //   ~420ms  badge plate irises open (auto-runs via CSS, .intro-plate)
  //   ~500ms  magnifying-glass/"B" strokes draw on top (auto-runs via CSS)
  //   1550ms  glow pulse on the assembled badge
  //   1900ms  wordmark settles in below it
  //   2450ms  screen contracts away from the badge, revealing the app —
  //           which shows the identical badge already waiting in the header.
  (function () {
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var screenEl = document.getElementById('introScreen');
    var svgEl = document.getElementById('introBadgeSvg');
    var wordEl = document.getElementById('introWordmark');

    function finish() {
      if (screenEl && screenEl.parentNode) screenEl.parentNode.removeChild(screenEl);
    }

    if (reduceMotion) {
      // Respect reduced-motion: skip the choreography, show the static
      // badge briefly (CSS already renders it in its final state with no
      // animation), then remove almost immediately.
      setTimeout(function () {
        if (screenEl) { screenEl.classList.add('intro-hide'); setTimeout(finish, 320); }
      }, 250);
      return;
    }

    setTimeout(function () { if (svgEl) svgEl.classList.add('sigil-glow'); }, 1550);
    setTimeout(function () { if (wordEl) wordEl.classList.add('show'); }, 1900);
    setTimeout(function () {
      if (screenEl) {
        screenEl.classList.add('intro-hide');
        setTimeout(finish, 750);
      }
    }, 2450);
  })();
