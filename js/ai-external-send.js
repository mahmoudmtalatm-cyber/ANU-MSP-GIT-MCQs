/* ══════════════════════════════════════════════════════════
   ASK AI — send a results-screen question to an external AI chat
   site of the student's choice (ChatGPT, Claude, Gemini,
   Perplexity, DeepSeek, Grok, or "copy for anything else"),
   so they can keep talking about it there, in their own account.
   No API key of ours is used or required for any of this — it
   opens the real site and either pre-fills the composer (where
   the site supports that) or copies the prompt to the clipboard
   for the student to paste in.

   The prompt text mirrors exactly what the app already sends to
   Gemini for this question: buildExternalAiPrompt() below reuses
   the same building blocks as buildExplainPrompt() and
   buildChatSystemInstruction() in js/ai-features.js — question,
   options, correct answer, the student's own answer, any shared
   case/vignette context ("linked" sub-questions), a note about an
   attached image, the AI explanation already generated for this
   question (if any), and the full on-screen AI chat transcript
   (if any) — so switching assistants never loses context.

   Default AI: whichever provider the student last sent to is
   remembered (localStorage) and becomes a one-click "Ask <Name>"
   split button, so they don't reselect on every question — the
   small caret half reopens the picker to send this one elsewhere
   (see _extAiGetDefaultProvider()/_extAiRenderButtonInto()).

   Picker behavior: tapping a specific assistant (anything but "Copy for
   another AI") only *selects* it — it remembers that assistant as the
   default right away (so it becomes the one-click "Ask <Name>" split
   button described above) and closes the picker, but it does **not**
   open or copy anything yet. Instead, a toast gives instructions for
   what tapping "Ask <Name>" will actually do — worded differently
   depending on whether that assistant supports pre-filling and whether
   this question has an image, since an image can never travel with a
   pre-fill (only text fits in a URL) and always falls back to the
   clipboard either way (_extAiSelectProviderInMenu()/
   _extAiSelectionInstructionText()). The actual send only happens once
   the student taps that "Ask <Name>" button — see
   sendQuestionToExternalAi(), which deliberately shows no toast of its
   own once a real site opens in a new tab, since the student's
   attention (and view, on a phone) has already moved there by then; the
   instructions given at selection time are the only feedback for that
   path. "Copy for another AI" is the one exception throughout: since it
   never becomes a one-click default (it isn't one specific assistant to
   remember) and never opens a site (it only writes to the clipboard),
   tapping it copies the prompt immediately, shows its own toast (the
   student is still looking at this page), and leaves the picker open —
   exactly as before.
   Wording throughout avoids keyboard-shortcut phrasing like
   "Ctrl/Cmd+V", since this app is used on phones too — it just says
   "paste".

   Images: a question with an image gets it copied to the
   clipboard automatically as part of sending, not as a separate
   manual step — alongside the prompt in one combined clipboard
   write for non-prefill AIs (_extAiCopyTextAndImage()), or on its
   own right after opening a prefill AI. "Copy question image" in the
   menu re-copies it on its own at any time, without closing the picker.

   Depends on (all loaded earlier, see index.html):
     - currentQuestions, userAnswers, getOptionEntries()  (app-core.js)
     - escapeHtml(), _cqCaseContextBlock(), _cqFindCaseGroupImage(),
       _explainRawText, _chatHistory                       (ai-features.js)
   See changelog #110/#111/#112/#113/#114/#115/#116/#117.
══════════════════════════════════════════════════════════ */

/* URL-prefill only works for sites that actually support it (verified
   against each provider's current behavior — see README changelog #110).
   Everything else falls back to "copy the prompt, then open the site". A
   prompt this long would exceed what's safe to cram into a URL anyway, so
   even prefill-capable providers fall back past this length. */
const EXTERNAL_AI_MAX_PREFILL_LEN = 6000;

const EXTERNAL_AI_PROVIDERS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    subtitle: 'Opens chatgpt.com, pre-filled',
    color: '#10A37F',
    initial: 'C',
    prefill: (text) => `https://chatgpt.com/?model=auto&q=${encodeURIComponent(text)}`,
    fallbackUrl: 'https://chatgpt.com/',
  },
  {
    id: 'claude',
    name: 'Claude',
    subtitle: 'Copies prompt, opens claude.ai',
    color: '#C15F3C',
    initial: 'A',
    prefill: null,
    fallbackUrl: 'https://claude.ai/new',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    subtitle: 'Copies prompt, opens gemini.google.com',
    color: '#3468DB',
    initial: 'G',
    prefill: null,
    fallbackUrl: 'https://gemini.google.com/app',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    subtitle: 'Opens perplexity.ai, pre-filled',
    color: '#1F8C7D',
    initial: 'P',
    prefill: (text) => `https://www.perplexity.ai/search?q=${encodeURIComponent(text)}`,
    fallbackUrl: 'https://www.perplexity.ai/',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    subtitle: 'Copies prompt, opens chat.deepseek.com',
    color: '#4D6BFE',
    initial: 'D',
    prefill: null,
    fallbackUrl: 'https://chat.deepseek.com/',
  },
  {
    id: 'grok',
    name: 'Grok',
    subtitle: 'Copies prompt, opens grok.com',
    color: '#2B2B33',
    initial: 'X',
    prefill: null,
    fallbackUrl: 'https://grok.com/',
  },
  {
    id: 'other',
    name: 'Copy for another AI',
    subtitle: 'Copies the prompt to your clipboard',
    color: null, // renders with the dashed neutral badge instead
    initial: '⧉',
    prefill: null,
    fallbackUrl: null,
  },
];

/* Currently-open menu's question index, or null. Only one open at a time. */
let _extAiOpenMenuIndex = null;

/* ── Default AI — remember whichever specific assistant the student last
   selected, so "Ask AI" becomes a single click to the same place next
   time instead of reselecting from the dropdown on every question. Set
   the moment a real provider is *selected* in the picker — not once
   something is actually sent — so picking one is remembered right away
   (see _extAiSelectProviderInMenu()). "Copy for another AI" never sets
   it, since it isn't one specific assistant to remember. Reopening the
   picker (via the small caret next to the quick button) and selecting a
   different one changes it at any time — there's no separate "forget"
   action, since that reselect already covers it. Persisted in
   localStorage so it survives reloads. See README changelog for this
   feature. ── */
const ASK_AI_DEFAULT_KEY = 'askAiDefaultProviderId';

function _extAiGetDefaultProvider() {
  let id = null;
  try { id = localStorage.getItem(ASK_AI_DEFAULT_KEY); } catch (e) { /* storage unavailable */ }
  if (!id) return null;
  return EXTERNAL_AI_PROVIDERS.find(p => p.id === id && p.id !== 'other') || null;
}

function _extAiSetDefaultProvider(id) {
  try { localStorage.setItem(ASK_AI_DEFAULT_KEY, id); } catch (e) { /* storage unavailable */ }
  _extAiRefreshAllButtons();
}

/* The default applies app-wide, and every visible result card has its own
   "Ask AI" control, so a change made from one question's menu is reflected
   on all of them immediately rather than only after the next re-render. */
function _extAiRefreshAllButtons() {
  document.querySelectorAll('.ai-send-wrap').forEach(wrap => {
    const idx = parseInt(wrap.id.replace('askAiWrap_', ''), 10);
    if (!isNaN(idx)) _extAiRenderButtonInto(wrap, idx);
  });
}

/* Per-provider dropdown subtitle, adjusted for whether this question has an
   image. */
function _extAiSubtitleFor(p, hasImage) {
  if (!hasImage) return p.subtitle;
  if (p.prefill) return `${p.subtitle} — image copied too`;
  if (p.id === 'other') return `${p.subtitle} (image copied too)`;
  return p.subtitle.replace('Copies prompt', 'Copies prompt & image');
}

/* ── Build the exact block of context this question would send to an AI —
   shared with buildExplainPrompt()/buildChatSystemInstruction() in
   ai-features.js so nothing drifts out of sync between "Explain", "Chat",
   and "Ask AI". Returns { text, hasImage }. ── */
function buildExternalAiPrompt(i) {
  const q = currentQuestions[i];
  const userAnswer = (typeof userAnswers !== 'undefined' && userAnswers[i]) || '';
  const optLines = getOptionEntries(q).map(([k, v]) => ` ${k}. ${v}`).join('\n');
  const userLine = userAnswer
    ? `I answered: ${userAnswer}. ${q.options[userAnswer] || ''}`
    : "I didn't answer this question.";

  const caseBlock = typeof _cqCaseContextBlock === 'function' ? _cqCaseContextBlock(currentQuestions, q) : '';
  const hasImage = !!(q.image || (typeof _cqFindCaseGroupImage === 'function' && _cqFindCaseGroupImage(currentQuestions, q)));

  let text = `I'm reviewing a medical MCQ practice question and would like your help understanding it. Here's the question:\n\n`;
  if (caseBlock) text += caseBlock;
  text += `QUESTION:\n${q.question}\n\nOPTIONS:\n${optLines}\n\nCORRECT ANSWER: ${q.answer}. ${q.options[q.answer] || ''}\n${userLine}`;

  if (hasImage) {
    text += `\n\n(This question has an image/diagram attached in the app. I've copied it to my clipboard separately — I'll paste it in here too.)`;
  }

  // Same already-generated explanation the on-screen "Explain" panel used —
  // so the new assistant can build on it instead of starting from scratch.
  const rawExplain = typeof _explainRawText !== 'undefined' ? _explainRawText[i] : null;
  if (rawExplain) {
    text += `\n\nAn AI explanation was already generated for this question:\n${rawExplain}`;
  }

  // Same transcript shown in the on-screen "Chat" panel, condensed to
  // plain text — attachments are named rather than embedded (the browser
  // can't hand another site's composer a file automatically).
  const history = typeof _chatHistory !== 'undefined' ? (_chatHistory[i] || []) : [];
  if (history.length) {
    text += `\n\nHere's the conversation I've had about it so far:\n`;
    history.forEach(msg => {
      const who = msg.role === 'user' ? 'Me' : 'AI';
      const spoken = (msg.parts || []).filter(p => p.text).map(p => p.text).join(' ');
      const attached = (msg.parts || []).filter(p => p._name).map(p => `[attached: ${p._name}]`).join(' ');
      const line = [spoken, attached].filter(Boolean).join(' ');
      if (line) text += `${who}: ${line}\n`;
    });
  }

  text += `\n\nCan you help me understand this question? I may have follow-up questions about it.`;
  return { text, hasImage };
}

function _extAiGetImageDataUrl(i) {
  const q = currentQuestions[i];
  if (!q) return null;
  return q.image || (typeof _cqFindCaseGroupImage === 'function' ? _cqFindCaseGroupImage(currentQuestions, q) : null);
}

/* ── Clipboard helpers (best-effort, with a manual-select fallback for
   browsers/contexts where the async Clipboard API is unavailable) ── */
async function _extAiCopyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

async function _extAiCopyImage(dataUrl) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    const blob = await _extAiImageToPngBlob(dataUrl);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch (e) {
    return false;
  }
}

/* Every image this app stores gets compressed through a canvas as JPEG
   (see compressImageDataUrl() in js/gemini-uploads.js), but the Clipboard
   API's image write only reliably accepts PNG — writing a ClipboardItem
   with any other MIME type (JPEG included) throws on every major
   browser, not just some, which is why "copy image" failed everywhere
   rather than in just one browser. Re-encoding through a canvas here
   guarantees a PNG blob regardless of the source image's original
   format, so the actual clipboard write always hits a type the browser
   will accept. */
function _extAiImageToPngBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG conversion failed')), 'image/png');
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

/* Writes the prompt text and the question image to the clipboard as one
   combined clipboard item (two representations of the same item, rather
   than two separate copy actions). A composer that accepts rich paste picks
   whichever representation(s) it supports, so a single Ctrl/Cmd+V can hand
   a non-prefill AI both the text and the image at once. Falls back to
   text-only (caller retries with _extAiCopyText) if the browser can't do a
   combined write. */
async function _extAiCopyTextAndImage(text, dataUrl) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    const imageBlob = await _extAiImageToPngBlob(dataUrl);
    const textBlob = new Blob([text], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({ [textBlob.type]: textBlob, [imageBlob.type]: imageBlob }),
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

/* ── Small floating confirmation toast, theme-matched and auto-dismissing ── */
let _extAiToastTimer = null;
function _extAiToast(message) {
  let el = document.getElementById('extAiToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'extAiToast';
    el.className = 'ext-ai-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(_extAiToastTimer);
  _extAiToastTimer = setTimeout(() => el.classList.remove('visible'), 3600);
}

/* ── Build the "Ask AI" button + dropdown wrapper for question i.
   Appended into the results card's .r-content next to Explain/Chat/API
   Key (see js/app-core.js), matching their sizing/spacing conventions. ── */
function renderAskAiButtonGroup(i) {
  const wrap = document.createElement('span');
  wrap.className = 'ai-send-wrap';
  wrap.id = `askAiWrap_${i}`;
  _extAiRenderButtonInto(wrap, i);
  return wrap;
}

const PAPER_PLANE_ICON = '<svg class="sicon" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const CARET_ICON = '<svg class="sicon ai-send-caret" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';

/* Fills an already-mounted .ai-send-wrap with the right control for the
   current default: a single "Ask AI" button (opens the picker) when no
   default is set yet, or a two-part split button — "Ask <Name>" that sends
   straight to the remembered assistant, plus a small caret that reopens the
   picker to change it — once one is. Called on first render and again
   whenever the default changes (_extAiSetDefaultProvider/_extAiRefreshAllButtons)
   so every card on screen stays in sync. */
function _extAiRenderButtonInto(wrap, i) {
  const wasOpen = _extAiOpenMenuIndex === i;
  if (wasOpen) closeAskAiMenu(i);

  const def = _extAiGetDefaultProvider();
  wrap.innerHTML = '';

  if (!def) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-send-btn';
    btn.id = `askAiBtn_${i}`;
    btn.innerHTML = `${PAPER_PLANE_ICON} Ask AI ${CARET_ICON}`;
    btn.onclick = (e) => { e.stopPropagation(); toggleAskAiMenu(i); };
    wrap.appendChild(btn);
  } else {
    const split = document.createElement('span');
    split.className = 'ai-send-split';
    split.id = `askAiBtn_${i}`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'ai-send-btn ai-send-btn-main';
    main.title = `Ask ${def.name} — this question's context, one click`;
    main.innerHTML = `${PAPER_PLANE_ICON} Ask ${escapeHtml(def.name)}`;
    main.onclick = (e) => { e.stopPropagation(); sendQuestionToExternalAi(i, def.id); };

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'ai-send-btn ai-send-btn-caret';
    caret.title = 'Choose a different AI';
    caret.innerHTML = CARET_ICON;
    caret.onclick = (e) => { e.stopPropagation(); toggleAskAiMenu(i); };

    split.appendChild(main);
    split.appendChild(caret);
    wrap.appendChild(split);
  }

  if (wasOpen) toggleAskAiMenu(i);
}

/* Plain instructions for what happens once the student actually taps
   "Ask <Name>" afterward — shown as a toast right after they select
   that assistant in the picker. Four variants cover every combination
   of whether the assistant supports pre-filling and whether this
   question has an image (pre-filling only ever carries the text, since
   that only works over a URL — an image always falls back to the
   clipboard regardless of the assistant). Deliberately avoids
   keyboard-shortcut wording ("Ctrl/Cmd+V") since a lot of students use
   this on a phone; "paste" alone works the same way on touch (press and
   hold) as it does with a keyboard shortcut. */
function _extAiSelectionInstructionText(provider, hasImage) {
  const askLabel = `Ask ${provider.name}`;
  if (provider.prefill) {
    return hasImage
      ? `Tap "${askLabel}" — ${provider.name} opens with the question already typed in. The image is copied to your clipboard too, so paste it in before you send.`
      : `Tap "${askLabel}" — ${provider.name} opens with the question already typed in and ready to send.`;
  }
  return hasImage
    ? `Tap "${askLabel}" — the question and image are copied together. Once ${provider.name} opens, paste them in and send.`
    : `Tap "${askLabel}" — the question is copied to your clipboard. Once ${provider.name} opens, paste it in and send.`;
}

function toggleAskAiMenu(i) {
  if (_extAiOpenMenuIndex === i) { closeAskAiMenu(i); return; }
  if (_extAiOpenMenuIndex !== null) closeAskAiMenu(_extAiOpenMenuIndex);

  const wrap = document.getElementById(`askAiWrap_${i}`);
  if (!wrap) return;
  _extAiOpenMenuIndex = i;
  wrap.classList.add('open');

  const hasImage = !!_extAiGetImageDataUrl(i);
  const def = _extAiGetDefaultProvider();

  const menu = document.createElement('div');
  menu.className = 'ai-send-menu';
  menu.id = `askAiMenu_${i}`;
  menu.innerHTML = `
    <div class="ai-send-menu-label">Continue with…</div>
    ${EXTERNAL_AI_PROVIDERS.map(p => `
      <button type="button" class="ai-send-menu-item${p.id === (def && def.id) ? ' is-default' : ''}" data-provider="${p.id}" onclick="_extAiSelectProviderInMenu(${i}, '${p.id}')">
        <span class="ai-send-badge${p.color ? '' : ' ai-send-badge-outline'}"${p.color ? ` style="background:${p.color}"` : ''}>${escapeHtml(p.initial)}</span>
        <span class="ai-send-item-text">
          <span class="ai-send-item-name">${escapeHtml(p.name)}${p.id === (def && def.id) ? ' <span class="ai-send-default-badge">✓ Default</span>' : ''}</span>
          <span class="ai-send-item-sub">${escapeHtml(_extAiSubtitleFor(p, hasImage))}</span>
        </span>
      </button>`).join('')}
    ${hasImage ? `
    <div class="ai-send-menu-sep"></div>
    <button type="button" class="ai-send-menu-item ai-send-menu-image" onclick="copyQuestionImageForAi(${i})">
      <span class="ai-send-badge ai-send-badge-outline">📎</span>
      <span class="ai-send-item-text">
        <span class="ai-send-item-name">Copy question image</span>
        <span class="ai-send-item-sub">On its own, any time — doesn't close this picker</span>
      </span>
    </button>` : ''}
  `;

  // Appended to <body>, not to `wrap` — .r-card clips overflow (rounded
  // corners + color strip) and .results-body is its own scroll container,
  // so a menu nested inside either was being silently clipped to the
  // card's box instead of floating above it. Living at the body level
  // sidesteps both ancestors; positionAskAiMenu() below places it under
  // the button with inline top/left (skipped on narrow screens, where CSS
  // pins it as a bottom sheet instead). See changelog #111.
  document.body.appendChild(menu);
  positionAskAiMenu(i);

  window.addEventListener('scroll', _extAiRepositionHandler, true);
  window.addEventListener('resize', _extAiRepositionHandler);
  // Deferred so the click that opened the menu doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', _extAiOutsideClickHandler), 0);
}

/* Places the open menu directly under its button, flipping above the
   button if there isn't room below, and clamping horizontally so it
   never runs off either edge of the viewport. No-op below 480px, where
   CSS pins the menu as a fixed bottom sheet instead (see
   `@media (max-width: 480px) .ai-send-menu` in styles.css). */
function positionAskAiMenu(i) {
  const btn = document.getElementById(`askAiBtn_${i}`);
  const menu = document.getElementById(`askAiMenu_${i}`);
  if (!btn || !menu) return;
  if (window.innerWidth <= 480) { menu.style.top = ''; menu.style.left = ''; return; }

  const GAP = 6, EDGE = 16;
  const r = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = r.left;
  left = Math.min(left, vw - menuW - EDGE);
  left = Math.max(left, EDGE);

  const spaceBelow = vh - r.bottom - GAP;
  const openAbove = spaceBelow < menuH && r.top > spaceBelow;
  const top = openAbove ? Math.max(EDGE, r.top - GAP - menuH) : r.bottom + GAP;

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function _extAiRepositionHandler() {
  if (_extAiOpenMenuIndex !== null) positionAskAiMenu(_extAiOpenMenuIndex);
}

/* Tapping a provider row in the picker. For a specific assistant (not
   "Copy for another AI"), this only *selects* it: the picker closes,
   the assistant is remembered as the default (turning the button into
   the one-click "Ask <Name>" split control — see
   _extAiSetDefaultProvider()/_extAiRenderButtonInto()), and a toast
   gives instructions for what tapping that new button will actually do
   (_extAiSelectionInstructionText()) — this is the only feedback the
   student gets about the outcome, since sendQuestionToExternalAi() no
   longer toasts once a site opens (see the comment there). Nothing is
   copied or opened yet at this point. "Copy for another AI" is the
   exception: it never becomes a one-click default, so selecting it is
   the only way to use it — it copies the prompt right away and leaves
   the picker open, same as it always has. */
function _extAiSelectProviderInMenu(i, providerId) {
  if (_extAiOpenMenuIndex !== i) return;
  const provider = EXTERNAL_AI_PROVIDERS.find(p => p.id === providerId);
  if (!provider) return;

  if (provider.id === 'other') {
    sendQuestionToExternalAi(i, providerId);
    return;
  }

  const hasImage = !!_extAiGetImageDataUrl(i);
  closeAskAiMenu(i);
  _extAiSetDefaultProvider(provider.id);
  _extAiToast(_extAiSelectionInstructionText(provider, hasImage));
}

function closeAskAiMenu(i) {
  const wrap = document.getElementById(`askAiWrap_${i}`);
  if (wrap) wrap.classList.remove('open');
  const menu = document.getElementById(`askAiMenu_${i}`);
  if (menu) menu.remove();
  _extAiOpenMenuIndex = null;
  document.removeEventListener('click', _extAiOutsideClickHandler);
  window.removeEventListener('scroll', _extAiRepositionHandler, true);
  window.removeEventListener('resize', _extAiRepositionHandler);
}

function _extAiOutsideClickHandler(e) {
  if (_extAiOpenMenuIndex === null) return;
  const wrap = document.getElementById(`askAiWrap_${_extAiOpenMenuIndex}`);
  const menu = document.getElementById(`askAiMenu_${_extAiOpenMenuIndex}`);
  const inside = (wrap && wrap.contains(e.target)) || (menu && menu.contains(e.target));
  if (!inside) closeAskAiMenu(_extAiOpenMenuIndex);
}

/* ── Core action: copy the prompt and open the chosen AI. Called by the
   one-click "Ask <Name>" split button (the normal path, once an
   assistant is already the remembered default), and also directly when
   "Copy for another AI" is picked in the menu, since that option has no
   one-click button of its own to defer to.

   No toast here once a real site actually opens in a new tab — by the
   time that tab has loaded, the student's attention (and often the
   whole browser view, especially on a phone) has already moved there,
   so a toast left behind on this page mostly goes unseen. The
   instructions for what to expect are given up front instead, the
   moment the assistant was selected (see
   _extAiSelectProviderInMenu()/_extAiSelectionInstructionText()). A
   toast still fires here for "Copy for another AI", which never
   navigates anywhere, and for any provider if opening the site itself
   didn't happen (no fallback URL) — both cases where the student is
   still looking at this page and needs to know what to do next. ── */
async function sendQuestionToExternalAi(i, providerId) {
  const provider = EXTERNAL_AI_PROVIDERS.find(p => p.id === providerId);
  if (!provider) { closeAskAiMenu(i); return; }

  // "Copy for another AI" only writes to the clipboard — it never
  // navigates anywhere — so the picker stays open afterward in case the
  // student wants to copy the image next or send to a specific assistant
  // instead. Every other provider opens a real site in a new tab, which
  // reads as the interaction being finished, so the picker closes.
  if (provider.id !== 'other') closeAskAiMenu(i);

  // Belt-and-suspenders: a specific assistant is already remembered the
  // moment it's selected in the picker (_extAiSelectProviderInMenu()),
  // so this is normally a no-op re-set — but the one-click "Ask <n>"
  // split button calls straight into this function without going
  // through the picker at all, so it's kept here too. "Copy for another
  // AI" is a generic fallback, not one assistant to remember, so it's
  // excluded.
  if (provider.id !== 'other') _extAiSetDefaultProvider(provider.id);

  const { text, hasImage } = buildExternalAiPrompt(i);
  const dataUrl = hasImage ? _extAiGetImageDataUrl(i) : null;
  const canPrefill = !!provider.prefill && text.length <= EXTERNAL_AI_MAX_PREFILL_LEN;

  // Prefill providers carry the text via the URL itself, so only the image
  // (if any) needs the clipboard. Everyone else needs the prompt copied —
  // and if there's an image too, it's copied together with the prompt as
  // one combined clipboard item (see _extAiCopyTextAndImage()) so a single
  // paste can hand the composer both, rather than the student needing a
  // separate manual step for the image.
  let copiedText = false, combinedCopy = false;
  if (canPrefill) {
    if (hasImage) await _extAiCopyImage(dataUrl);
  } else if (hasImage) {
    combinedCopy = await _extAiCopyTextAndImage(text, dataUrl);
    copiedText = combinedCopy || await _extAiCopyText(text);
  } else {
    copiedText = await _extAiCopyText(text);
  }

  let opened = false;
  if (canPrefill) {
    window.open(provider.prefill(text), '_blank', 'noopener');
    opened = true;
  } else if (provider.fallbackUrl) {
    window.open(provider.fallbackUrl, '_blank', 'noopener');
    opened = true;
  }

  // "Copy for another AI" is the only provider without a fallbackUrl, so
  // it's the only one that ever reaches this still with opened === false
  // — every other provider always opens a real site (see the comment
  // above sendQuestionToExternalAi() for why that means no toast).
  if (!opened) {
    let msg;
    if (!hasImage) {
      msg = copiedText ? 'Prompt copied — paste it into any AI chat.' : "Couldn't copy automatically — select and copy the prompt manually.";
    } else if (combinedCopy) {
      msg = 'Prompt and image copied together — paste them into any AI chat.';
    } else if (copiedText) {
      msg = 'Prompt copied — paste it into any AI chat. Use "Copy question image" for the image separately.';
    } else {
      msg = "Couldn't copy automatically — select and copy the prompt manually.";
    }
    _extAiToast(msg);
  }
}

/* Copies the question's image on its own — a manual option next to the
   provider list for re-copying at any point, or for pairing with a
   prefill AI (ChatGPT, Perplexity) by hand. Deliberately doesn't close
   the picker: the student might want to copy the image and then still
   pick/send a provider, or copy it again after a failed paste. */
async function copyQuestionImageForAi(i) {
  const dataUrl = _extAiGetImageDataUrl(i);
  if (!dataUrl) return;
  const ok = await _extAiCopyImage(dataUrl);
  _extAiToast(ok
    ? 'Image copied — paste it into the AI chat.'
    : "Couldn't copy the image in this browser — press and hold (or right-click) the image in the app and choose Copy Image instead.");
}
