  (function () {
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var screenEl = document.getElementById('introScreen');
    var svgEl = document.getElementById('introSigilSvg');
    var wordEl = document.getElementById('introWordmark');

    function finish() {
      if (screenEl && screenEl.parentNode) screenEl.parentNode.removeChild(screenEl);
    }

    if (reduceMotion) {
      // Respect reduced-motion: skip the choreography, remove almost immediately.
      setTimeout(function () {
        if (screenEl) { screenEl.classList.add('intro-hide'); setTimeout(finish, 320); }
      }, 250);
      return;
    }

    setTimeout(function () { if (svgEl) svgEl.classList.add('sigil-glow'); }, 900);
    setTimeout(function () { if (wordEl) wordEl.classList.add('show'); }, 1350);
    setTimeout(function () {
      if (screenEl) {
        screenEl.classList.add('intro-hide');
        setTimeout(finish, 750);
      }
    }, 2000);
  })();
