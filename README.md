# ANU MSP Question Bank

A free, community-driven MCQ practice platform built for ANU MSP students —
browse the official curriculum by year/module/subject/lecture, take timed
quizzes, track your stats, and build or share your own quizzes. Admins can
publish official question sets and use built-in AI tools (Google Gemini) to
extract questions from lecture slides, generate new ones, auto-answer, and
write explanations.

It's a single-page app: no backend server, no build step. Firebase
(Auth + Firestore) handles accounts, data storage, and syncing; everything
else is plain HTML/CSS/JavaScript.

> Open source and free to fork. See [Getting started](#getting-started) to
> stand up your own copy with your own Firebase project.

## Features

- **Curriculum browser** — Year → Module → Subject → Lecture, with a
  timed quiz mode, question navigator, flagging, and a results screen.
- **Persistent statistics** — per-user history stored in Firestore.
- **Custom quizzes** — write your own, or generate one from pasted MCQs
  or lecture material using Gemini.
- **Community quizzes** — browse, take, and share quizzes made by other
  students; merge questions from one quiz into another.
- **AI tools** (Gemini, bring-your-own API key) — extract questions from
  slides/PDFs, generate new questions, auto-answer, refine question
  wording, fill in missing choices, and produce step-by-step explanations
  or a per-question AI chat.
- **Admin panel** — publish quizzes into the official bank, manage the
  curriculum tree (years/modules/subjects), manage other admins and their
  permissions, and edit/split/reorder published lectures.
- **Offline-friendly caching** — curriculum and published questions are
  cached locally and versioned so returning users don't re-fetch
  everything on every visit.

## Tech stack

- Vanilla HTML / CSS / JavaScript (no framework, no bundler)
- [Firebase](https://firebase.google.com/) — Authentication (Google
  sign-in) and Firestore (database)
- [Google Gemini API](https://ai.google.dev/) — optional, powers all AI
  features; each user supplies their own API key, stored locally in
  their browser

## Project structure

```
anu-msp-question-bank/
├── index.html                    # Page shell — markup for every screen/modal
├── css/
│   └── styles.css                # All styles (design tokens, layout, components)
├── js/
│   ├── config/
│   │   ├── firebase-config.example.js   # Template — copy this file
│   │   └── firebase-config.js           # Your real keys (git-ignored)
│   ├── firebase-init.js          # Firebase SDK bootstrap, auth-state listener
│   ├── intro-animation.js        # One-off splash/intro animation
│   ├── app-core.js               # State, screen navigation, quiz engine
│   │                              #   (timer, render/navigate/mark/submit),
│   │                              #   subject selection, persistent stats
│   ├── ai-features.js            # Gemini API key manager, AI explanations,
│   │                              #   AI chat, AI-generated custom quizzes
│   ├── ai-question-tools.js      # Refine question / fill choices / add choice
│   ├── ai-solve.js               # Per-question "AI solve" source picker
│   ├── gemini-uploads.js         # Gemini file-upload helpers (images/PDFs)
│   ├── firebase-storage.js       # Firebase Storage helpers for quiz images
│   ├── split-quiz.js             # Split a long quiz into smaller ones
│   ├── sharing.js                # Share-quiz links + shared quiz image helpers
│   ├── community-quizzes.js      # Browse/merge community-submitted quizzes
│   ├── user-profile.js           # Display name + misc Firestore utilities
│   ├── data-sync.js              # Local cache, published-quiz manifest,
│   │                              #   one-time data migrations
│   ├── icon-picker.js            # Icon library + reusable icon-picker widget
│   ├── admin-panel.js            # Publish flow, manage admins, manage
│   │                              #   community submissions
│   ├── quiz-editor.js            # Inline editors for published & custom quizzes
│   └── curriculum-admin.js       # Admin curriculum tree management
├── firestore.rules               # Firestore security rules (owner-only data,
│                                  #   public reads, roster-based admin perms)
├── package.json                  # Convenience scripts for a local dev server
├── .gitignore
└── LICENSE
```

The JavaScript is split by feature area rather than converted into ES
modules — every file (except `firebase-init.js`) still shares one global
scope, exactly like the original single-file app, so no behavior changed
during the split. `firebase-init.js` is the only ES module, since it needs
`import` to load the Firebase SDK and your config.

## Getting started

### 1. Clone and configure Firebase

```bash
git clone https://github.com/YOUR_USERNAME/anu-msp-question-bank.git
cd anu-msp-question-bank
cp js/config/firebase-config.example.js js/config/firebase-config.js
```

Then:

1. Create a project at the [Firebase console](https://console.firebase.google.com).
2. **Authentication** → Sign-in method → enable **Google**.
3. **Firestore Database** → create a database (production mode), then
   paste the contents of [`firestore.rules`](./firestore.rules) into
   the Rules tab. This is the actual ruleset this app runs on — it
   enforces per-user ownership on personal data (stats, custom quizzes,
   profiles), public read access to the published question bank, and a
   roster-based (`curriculum` / `community` / `admins`) permission model
   for everything admin-only. If you fork this project, update the
   hardcoded `isSuperAdmin()` email at the top to your own account before
   deploying.
4. **Project settings → General → Your apps** → add a Web app, and copy
   the generated config object into `js/config/firebase-config.js`.

`firebase-config.js` is listed in `.gitignore`, so your keys never get
committed.

### 2. Run it locally

No build step is required — it's static files. Any local web server works,
for example:

```bash
npm run dev
# or: npx serve .
# or: python3 -m http.server 5173
```

Then open the printed local URL in your browser.

### 3. Make yourself an admin

The super-admin email is checked in **two places**, and both must match:

- `js/app-core.js` — the `SUPER_ADMIN_EMAIL` constant (client-side UI gating)
- `firestore.rules` — the `isSuperAdmin()` function (server-side enforcement)

Update both to your own Google account email before deploying. That
account will always have full admin permissions (publishing quizzes,
managing the curriculum, and managing other admins) and can grant
permissions to other accounts from the in-app **Admin Panel** afterward.
Non-super admins get their permissions from the `appConfig/adminRoster`
Firestore document, which the Admin Panel manages for you.

### 4. (Optional) Add your own Gemini API key

AI features are opt-in per user — each person adds their own key from
the app's **Manage APIs** button (Google AI Studio issues free keys at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Nothing
AI-related is required for the core quiz/browsing experience to work.

## Adding questions

Questions are stored in Firestore, not hardcoded, so the primary way to
add them is through the app itself once you're an admin:

- **Admin Panel → Publish** a custom or community quiz into a chosen
  Module/Subject/Lecture, or
- **Admin Panel → Manage Curriculum** to create the Year/Module/Subject
  structure first, then publish into it.

Every question follows this shape:

```js
{
  question: "The question text",
  image: "https://example.com/image.png", // optional
  options: { A: "...", B: "...", C: "...", D: "..." },
  answer: "A" // must match one of the option keys
}
```

## Contributing

Issues and pull requests are welcome — whether that's bug fixes, UI
polish, new AI-tool integrations, or accessibility improvements. Please
keep the file-per-feature layout above when adding new functionality
rather than growing one of the existing files indefinitely.

## Author

Created and maintained by **Mahmoud Talat**, a second-year student in the
Medical School Program (MSP) at Alexandria National University, at the
time of this project's development.

## License

Released under the [MIT License](./LICENSE) — free to use, modify, and
redistribute.
