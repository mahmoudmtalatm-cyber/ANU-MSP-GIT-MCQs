/* ══════════════════════════════════════════════════════════
   ICON LIBRARY — large curated set + admin-extendable custom icons
══════════════════════════════════════════════════════════ */
const BASE_ICON_LIBRARY = [
  // Numbers — handy for years, modules, ranking, or ordering anything
  '1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','0️⃣','#️⃣',
  // Medical / anatomy
  '📘','📗','📙','📕','📖','🧬','💊','🫀','🧠','🦷','🩺','🔬','🧪','💉','🩻','🫁','🦴','👁️','🫃','🧫','🩸',
  '🦠','🧴','🩹','🧑\u200d⚕️','🩼','🦿','🦾','🫂',
  // Body systems / science
  '⚗️','🌡️','🧯','☣️','🧲','🧮','🔭','⚛️','🧑\u200d🔬',
  // Study / academic
  '📚','📓','📔','📒','📝','📋','📑','🗂️','📊','📈','📉','🔖','🏷️','📎','✏️','🖊️','🖋️','📐','📏','🧾',
  '🎓','🏫','🏛️','🗝️','🔑','💡','🧑\u200d🏫',
  // Symbols / general
  '⭐','✨','🔥','💎','🏆','🎯','🚀','⚡','🌟','✅','🔔','📌','🧭','🗺️','⏱️','⏳','🧩','🎲','🛠️','⚙️',
  // Body parts / organs extras
  '🫘','👂','👃','👄','🦶','🖐️',
  // Nature (fallback generic)
  '🌿','🍀','🌱','🌸','🌊','☀️','🌙'
];

function _getCustomIcons() {
  try { return JSON.parse(localStorage.getItem('customIconLibrary') || '[]'); }
  catch { return []; }
}
function _setCustomIcons(arr) {
  try { localStorage.setItem('customIconLibrary', JSON.stringify(arr)); } catch {}
}
function getIconLibrary() {
  const custom = _getCustomIcons();
  const seen = new Set();
  return [...custom, ...BASE_ICON_LIBRARY].filter(ic => {
    if (seen.has(ic)) return false;
    seen.add(ic);
    return true;
  });
}

/* Persist custom icons to Firestore too, so they extend for every admin/device */
async function loadCustomIconsFromServer() {
  if (!window._db) return;
  try {
    const ref  = window._doc(window._db, 'appConfig', 'iconLibrary');
    const snap = await window._getDoc(ref);
    if (snap.exists()) {
      const serverIcons = snap.data().icons || [];
      const merged = [...new Set([...serverIcons, ..._getCustomIcons()])];
      _setCustomIcons(merged);
    }
  } catch (e) { console.warn('Failed to load icon library:', e); }
}
async function _saveCustomIconToServer(icon) {
  if (!window._db) return;
  try {
    const ref  = window._doc(window._db, 'appConfig', 'iconLibrary');
    const snap = await window._getDoc(ref);
    const icons = snap.exists() ? (snap.data().icons || []) : [];
    if (!icons.includes(icon)) {
      icons.unshift(icon);
      await window._setDoc(ref, cleanForFirestore({ icons }));
    }
  } catch (e) { console.warn('Failed to save icon to library:', e); }
}

/* ══════════════════════════════════════════════════════════
   ICON PICKER WIDGET — reusable popover for any text input
   Usage: iconPickerFieldHtml('currSubjIcon', icon, 'Icon') renders
   a field block (container id `${inputId}Field` is created for you).
══════════════════════════════════════════════════════════ */
let _openIconPickerId = null;

function iconPickerFieldHtml(inputId, initialIcon, label) {
  const icon = initialIcon || '📘';
  return `
    <div class="curr-field icon-picker-field" style="max-width:110px;" id="${inputId}Field">
      <label>${label || 'Icon'}</label>
      <div class="icon-picker-trigger" id="${inputId}Trigger" onclick="toggleIconPicker('${inputId}')">
        <span id="${inputId}Preview">${icon}</span><span class="ip-caret">▾</span>
      </div>
      <input type="hidden" id="${inputId}" value="${icon}" />
      <div class="icon-picker-pop hidden" id="${inputId}Pop"></div>
    </div>`;
}

function toggleIconPicker(inputId) {
  // Close any other open picker
  if (_openIconPickerId && _openIconPickerId !== inputId) {
    const prevPop = document.getElementById(_openIconPickerId + 'Pop');
    if (prevPop) prevPop.classList.add('hidden');
  }
  const pop = document.getElementById(inputId + 'Pop');
  if (!pop) return;
  const willOpen = pop.classList.contains('hidden');
  if (willOpen) {
    pop.classList.remove('hidden');
    _openIconPickerId = inputId;
    renderIconPickerPop(inputId, '');
  } else {
    pop.classList.add('hidden');
    _openIconPickerId = null;
  }
}

/* Positions an icon-picker popover (position:fixed) against its trigger
   button, clamped fully inside the viewport — flips above the trigger if
   there isn't room below, and shrinks/shifts horizontally so a 300px
   popover never spills past the edge of a narrow card or screen. Called
   after every render of the popover's contents, since filtering the
   list changes its height. */
function positionIconPickerPop(inputId) {
  const trigger = document.getElementById(inputId + 'Trigger');
  const pop = document.getElementById(inputId + 'Pop');
  if (!trigger || !pop || pop.classList.contains('hidden')) return;
  const margin = 12;
  const rect = trigger.getBoundingClientRect();

  const popWidth = Math.min(300, window.innerWidth - margin * 2);
  pop.style.width = popWidth + 'px';

  let left = rect.left;
  if (left + popWidth > window.innerWidth - margin) {
    left = window.innerWidth - margin - popWidth;
  }
  if (left < margin) left = margin;
  pop.style.left = left + 'px';

  const maxH = Math.min(320, window.innerHeight - margin * 2);
  pop.style.maxHeight = maxH + 'px';
  const popHeight = Math.min(pop.scrollHeight, maxH);

  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  let top;
  if (spaceBelow >= popHeight || spaceBelow >= spaceAbove) {
    top = rect.bottom + 6; // open downward (default)
  } else {
    top = Math.max(margin, rect.top - 6 - popHeight); // not enough room below — open upward
  }
  pop.style.top = top + 'px';
}

// Keep an open picker glued to its trigger through resizes and scrolling
// (capture phase so it also catches scroll inside the admin panel body,
// not just the window).
window.addEventListener('resize', () => { if (_openIconPickerId) positionIconPickerPop(_openIconPickerId); });
document.addEventListener('scroll', () => { if (_openIconPickerId) positionIconPickerPop(_openIconPickerId); }, true);

function renderIconPickerPop(inputId, filter) {
  const pop = document.getElementById(inputId + 'Pop');
  if (!pop) return;
  const lib = getIconLibrary();
  const list = filter ? lib.filter(ic => ic.includes(filter)) : lib;
  pop.innerHTML = `
    <input type="text" class="icon-picker-search" placeholder="Type to filter, or paste any emoji…"
      oninput="renderIconPickerPop('${inputId}', this.value.trim())"
      onkeydown="if(event.key==='Enter'){event.preventDefault(); const v=this.value.trim(); if(v){ selectIconForField('${inputId}', v.slice(0, 4)); addCustomIcon(v.slice(0,4)); } }" />
    <div class="icon-picker-grid">
      ${list.map(ic => `<span title="${ic}" onclick="selectIconForField('${inputId}','${ic}')">${ic}</span>`).join('') || '<span style="grid-column:1/-1;font-size:.75rem;color:var(--text-muted);">No matches</span>'}
    </div>
    <div class="icon-picker-add-row">
      <input type="text" id="${inputId}CustomAdd" placeholder="Add custom emoji" maxlength="4" />
      <button onclick="const v=document.getElementById('${inputId}CustomAdd').value.trim(); if(v){ selectIconForField('${inputId}', v); addCustomIcon(v); }">➕ Add</button>
    </div>`;
  positionIconPickerPop(inputId);
}

function selectIconForField(inputId, icon) {
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(inputId + 'Preview');
  if (input)   input.value = icon;
  if (preview) preview.textContent = icon;
  const pop = document.getElementById(inputId + 'Pop');
  if (pop) pop.classList.add('hidden');
  _openIconPickerId = null;
}

function addCustomIcon(icon) {
  if (!icon) return;
  const custom = _getCustomIcons();
  if (!custom.includes(icon)) {
    custom.unshift(icon);
    _setCustomIcons(custom);
    _saveCustomIconToServer(icon);
  }
}

// Close picker popovers when clicking outside
document.addEventListener('click', (e) => {
  if (!_openIconPickerId) return;
  const field = document.getElementById(_openIconPickerId + 'Field');
  if (field && !field.contains(e.target)) {
    const pop = document.getElementById(_openIconPickerId + 'Pop');
    if (pop) pop.classList.add('hidden');
    _openIconPickerId = null;
  }
});

// Close any open per-question AI popover (AI Solve's source picker, or
// Refine's instructions popover) when clicking outside it — but not when
// clicking the ▾ caret that opens it, which has its own toggle logic.
document.addEventListener('click', (e) => {
  document.querySelectorAll('.ai-source-picker').forEach(picker => {
    if (picker.style.display === 'none') return;
    if (picker.contains(e.target)) return;
    const caretId = picker.dataset.caret;
    const caret = caretId && document.getElementById(caretId);
    if (caret && caret.contains(e.target)) return;
    picker.style.display = 'none';
  });
});

