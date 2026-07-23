# AI Working Context

This file is the shared memory for AI assistants (and humans) working on
this project across **different accounts**. Its whole purpose is to stop
context from being lost between sessions and between team members who
aren't sharing a single account or conversation — so any account, at any
time, can pick this file up and continue as if it were the same
continuous session.

**If you are an AI assistant starting work on this project, in order:**
1. Read this entire file, top to bottom, before doing anything else.
2. Check the **Status** block immediately below — it's the fastest way
   to know if work is already in progress.
3. Skim `README.md` → *Project structure* for the current file map
   (that table is the one place it's maintained — don't duplicate it
   here, just keep it in sync per rule 0.2 below).
4. Read section 6 (Open threads) before starting anything new.

## Status (keep this current — overwrite in place, don't append)

```
Last updated:      2026-07-23
Last session:      complete
Current focus:     none — idle, no work in progress
Blocking issues:   none
```

`Current focus` should say what's actively being worked on right now (so
a second account opening this file mid-session immediately knows not to
start something conflicting), or "none — idle" between sessions.
`Blocking issues` is for anything that stops *all* work until resolved
(e.g. a broken build, a credential problem) — not ordinary open tasks,
which belong in section 6.

---

## 0. Standing rules (always apply, every session)

These are permanent project rules. Follow them on every change, without
being asked again:

1. **Professional, well-structured code only.** No throwaway hacks,
   no dumping new logic into an unrelated file. Follow the existing
   file-per-feature layout described in `README.md` → *Project
   structure*. If a change is big enough to need a new file, add it
   there and update that section of the README.
2. **Keep `README.md` current.** Any change that affects setup, features,
   file structure, or how someone would run/contribute to the project
   must be reflected in the README in the same session it happens in —
   not left for later.
3. **Everything must be responsive.** Any new or modified UI has to
   adapt cleanly to changes in screen size/proportion (phone, tablet,
   desktop) — not just look right at one width. Use the existing
   patterns in `css/styles.css` (flex-wrap, relative units, the existing
   `@media` breakpoints) rather than inventing a parallel system.
4. **Prefer minimal, targeted diffs.** Change what the task requires;
   don't rewrite working files wholesale.
5. **Any file change gets logged — the request, and the change.**
   The moment you change *any* file in this project (code, config,
   README, this file itself — anything), section 6 must get a matching
   entry before you stop, containing at minimum: what was requested
   (in your own words, one line is enough) and exactly what changed,
   file by file. This is required even if the session isn't over yet —
   don't defer it to a single end-of-session write-up if you've already
   made changes earlier in the session; update/extend the entry as you
   go rather than reconstructing everything from memory at the end.
   Sessions that made *no* file changes still get a closing summary per
   the broader rule in section 5 (below), but a file change specifically
   is what makes this non-negotiable. See section 5 for the exact entry
   format.
6. **Code and git history are ground truth — this file is not.** This
   file is a cache of what previous sessions believed, not a guarantee
   of current reality. Before relying on a claim in section 1 or 2 to
   make a decision, verify it against the actual files if the claim is
   load-bearing for what you're about to do. If you find this file is
   wrong, fix the wrong part immediately (don't just work around it
   silently) and say so in your session's log entry.
7. **Mark unverified claims as assumptions, not facts.** If you're
   noting something you believe but haven't actually checked this
   session (e.g. repeating what a previous entry said, or inferring
   from naming conventions rather than reading the code), prefix it
   with `ASSUMPTION:` wherever it's written in this file. Don't let
   guesses accumulate as if they were confirmed facts across sessions —
   that's how shared memory quietly rots.
8. **Keep this file bounded.** See the archiving rule at the end of
   section 6 — this file is meant to stay skimmable, not become an
   ever-growing transcript.

---

## 1. Project snapshot

*(Kept current — this section describes the project as it is now, not
a history. Overwrite it as things change; don't append to it.)*

- **What it is:** ANU MSP Question Bank — a free, community-driven MCQ
  practice platform for medical students. See `README.md` for the full
  feature list.
- **Stack:** vanilla HTML/CSS/JS, no build step, no framework. Firebase
  (Auth + Firestore) for backend. Gemini API (bring-your-own key) for
  AI features.
- **Structure:** one `index.html` shell, one `css/styles.css`, and one
  JS file per feature area under `js/` (see README's *Project
  structure* table — keep it in sync with the real file list).
- **Known constraints worth remembering:**
  - Firebase Storage needs a paid plan, so quiz images go through a
    Firestore subcollection instead.
  - Gemini requests are rate-limited by a single shared pacing clock
    (`GEMINI_MIN_REQUEST_SPACING_MS` in `gemini-uploads.js`).
  - The active Gemini model is one constant (`GEMINI_PRIMARY_MODEL` in
    `gemini-uploads.js`) with an automatic fallback model if it's
    retired — see README for the full mechanism.

## 2. Project snapshot detail

*(This is section 1's companion — section 1 stays a short overview;
put anything longer that needs updating here so section 1 doesn't
bloat. Empty for now — add subsections here as the project grows,
e.g. "Known bugs," "Deferred ideas," each kept current rather than
appended-to.)*

## 3. Decision log

*(Append-only — permanent record of non-obvious project decisions and
*why*, so the same debate doesn't happen again in a later session with
no memory of the first time. This is different from section 6: that's
a timeline of what happened; this is the reasoning that should survive
even after old session-log entries get archived away. Add new entries
at the bottom, in date order.)*

```
[2026-07-23] Shared AI_CONTEXT.md instead of per-account notes
Why: the team works from separate Claude accounts/conversations with no
shared chat history. Rather than each account keeping its own private
notes (which drift and conflict), one file in the repo is the single
source of truth for standing rules and project state, versioned with
everything else.
Alternative considered: a pinned conversation summary per account —
rejected because it can't be kept in sync across accounts automatically
and isn't visible in the repo/PR history.
```

## 4. Glossary

*(Domain and project-specific terms an AI assistant can't infer from
the code alone. Keep short — one line per term. Add to this whenever a
session has to figure out a term the hard way, so the next one doesn't
have to.)*

- **MSP** — Medical School Program (ANU); the student audience this
  app is built for.
- **Curriculum tree** — the admin-managed Year → Module → Subject →
  Lecture hierarchy that official published questions are organized
  under (see `curriculum-admin.js`).
- **Community quiz** — a custom quiz a regular (non-admin) user has
  chosen to share, visible/mergeable by other users (`community-quizzes.js`),
  as distinct from an official *published* quiz an admin has put into
  the curriculum tree.
- **Roster** — the `appConfig/adminRoster` Firestore document that
  grants non-super-admin accounts specific permissions
  (`curriculum` / `community` / `admins`); see README → *Make yourself
  an admin*.
- **Super admin** — the one hardcoded account (by email, in both
  `app-core.js` and `firestore.rules`) with permanent full admin
  rights, independent of the roster.

## 5. Session handoff protocol — read this if you are an AI

Multiple team members use separate Claude accounts/conversations, so
there's no shared chat history — this file *is* the shared history.

**Changed a file? Log it — the request and the change, not just a vibe.**
Any time you edit, create, or delete a file in this project, write an
entry to section 6 that names (a) what was requested and (b) exactly
what changed, file by file — don't rely on this general end-of-session
rule alone to cover it retroactively, and don't wait if you make several
separate changes across a session; keep the entry current as you go.

**Every session ends with a log entry — not just checkpoints.**
The "MANDATORY" checkpoint protocol further down exists for the specific
case of running out of room mid-task. But the underlying requirement is
broader than that: *any* session — including one that finishes its task
completely with no time pressure at all, and even one that made no file
changes at all — ends by adding an entry to section 6 summarizing what
was done, using the same format as the checkpoint entry below (just with
`STATUS: complete` when nothing is left open). Don't skip this because
the task felt small or because nothing went wrong; a one-line "asked X,
did Y, nothing remaining" entry is exactly as valuable as a longer one,
and a missing entry is what breaks continuity for the next session. If
you change the Status block back to "none — idle," a matching log entry
should exist explaining what just finished.

**During your session:**
- Before making changes, check the Status block and section 6 (Open
  threads) for anything left in progress by a previous session, and
  finish or continue it before starting something new, unless the user
  asks otherwise.
- If the Status block's `Current focus` already names something and
  you're a *different* account/session about to start unrelated work,
  say so to your user and confirm before proceeding — two sessions
  editing the same area at once, unaware of each other, is exactly the
  failure mode this file exists to prevent.
- If you pull the repo and find uncommitted or unexpected local changes
  that this file's Status/section 6 don't account for, treat that as a
  sign another session is (or was) active concurrently — read the diff
  before doing anything, don't overwrite it.
- As you work — not just at the end — briefly note non-obvious
  decisions, dead ends, or things you tried that didn't work, directly
  in the relevant checkpoint entry as you go. Don't wait until the
  very end to reconstruct what happened from memory. Decisions that
  should survive long-term (not just for the next session) belong in
  section 3 instead.

**MANDATORY — when your session is about to run out of room, you must
checkpoint before you stop. This is not optional and does not require
the user to ask for it.**

There is no automatic technical signal for "quota about to end" —
neither Claude nor this file can detect that on its own. So this
protocol has to fire on either of two things, and both matter:

1. **Self-monitoring (the AI's job, every session):** treat any of
   these as a trigger to stop new work and checkpoint immediately:
   - The conversation has gotten very long (many tool calls, many
     large file edits, long back-and-forth).
   - You've been asked to do something large and you can tell,
     partway through, that you won't reasonably finish it in the
     space left.
   - Anthropic has surfaced a reminder about the conversation's
     length.
   - Any moment you'd otherwise think "I should wrap up soon" —
     don't wait for a cleaner stopping point; checkpoint *then*.
2. **Manual override (the human's job):** if a teammate notices the
   session is dragging on or about to hit a limit, they can force this
   immediately by saying **"checkpoint now"** (or similar). On seeing
   that phrase, stop whatever you're doing right away and run the
   protocol below before responding to anything else.

**When triggered, in this order:**
1. Stop starting anything new.
2. Save/commit whatever code changes already exist, even partial ones
   — a half-finished-but-saved change with clear notes is far more
   useful to the next session than an unsaved one left only in chat.
3. Write a checkpoint entry (format below) at the top of section 6.
   Be specific — the next session should never have to guess or
   re-read the whole conversation to reconstruct state:
   - What was asked
   - What you actually changed (file names, functions)
   - What's still missing/broken/untested
   - The exact next step
4. Update the Status block at the top of this file to match: set
   `Current focus` to what's actually still open (or "none — idle" if
   truly finished), and `Blocking issues` if anything now blocks other
   work.
5. Tell the user directly, in plain language, that you're near the
   limit and have saved a checkpoint — don't just do this silently in
   the file.

**Log/checkpoint entry format** — used both for a normal end-of-session
summary and for a mid-task checkpoint; add a new entry at the **top**
of section 6's log (newest first), like this:

```
### [YYYY-MM-DD HH:MM] <short title> — STATUS: complete | in progress | blocked
Requested: <one line — what the user asked for>
Done: <what was actually changed, file by file>
Remaining: <what's left, or "nothing — done">
Next step: <the exact next action, if remaining work exists>
```

## 6. Open threads & session log

*(Newest entry first. Don't delete old entries — this is the running
history the next session reconstructs from — but see the archiving
rule at the end of this section once it gets long.)*

```
### [2026-07-23] Sharpen the file-change logging rule — STATUS: complete
Requested: make it explicit that any AI changing a file must log both
the original request and exactly what changed, in this context file —
not leave it implicit inside the general end-of-session rule.
Done: edited AI_CONTEXT.md only.
- Rewrote section 0 rule 5 to lead with "any file change gets logged —
  the request, and the change" as its own explicit trigger, distinct
  from (and stricter than) the general end-of-session summary rule;
  clarified it should be updated as changes happen during a session,
  not reconstructed only at the very end.
- Added a matching, clearly-labeled paragraph near the top of section 5
  ("Changed a file? Log it...") right before the general "every session
  ends with a log entry" paragraph, so the two requirements read as
  connected but distinct: file changes always get logged (non-
  negotiable, tied to the act of editing), while a closing summary is
  required even for sessions that touched no files at all.
Remaining: nothing outstanding.
Next step: n/a — future sessions should follow this rule for any file
they touch, including this one.
```

### [2026-07-23] Reconcile Gemini temperatures + always-log rule — STATUS: complete
Requested: (1) compare Gemini `temperature` values between this copy of
the project and a separately-uploaded later export, and bring this
copy's values in line with that later export; (2) change the handoff
protocol so a session-summary log entry is written at the end of every
session, not only when a session is checkpointing because it's running
out of room.
Done:
- Compared all `temperature:` call sites in `ai-solve.js`,
  `ai-features.js`, `ai-question-tools.js`, and `gemini-uploads.js`
  against the later export. 4 of 9 differed; updated this copy to
  match the later export in all 4 spots:
  - `ai-solve.js` lecture-text question generation: `0` → `0.7`
  - `ai-solve.js` PDF/image question generation: `0` → `0.7`
  - `ai-features.js` explain-answer call: `0.4` → `0.3`
  - `ai-features.js` follow-up chat call: `0.6` → `0.4`
  Updated the inline comments at each spot to match the new values and
  reasoning; left the two transcription/extraction `temperature: 0`
  sites untouched since they already matched.
- Generalized rule 5 (section 0) and the section 5 intro so writing a
  summary to section 6 is required at the end of *every* session
  (task fully done, partly done, or just paused) — not only under the
  "running low on room" checkpoint trigger, which is now framed as one
  specific case of this broader rule rather than the only reason to
  log. Relabeled the checkpoint entry format as the shared "log/
  checkpoint entry format" since it's now used for both.
Remaining: nothing outstanding from this task. Worth noting for
whoever compares further exports later: the two transcription/
extraction sites (`temperature: 0`) already agreed across both copies,
so only the four generation/explanation-style calls needed changes.
Next step: n/a.
```

### [2026-07-23] Hardened AI_CONTEXT.md for multi-account reliability — STATUS: complete
Requested: develop the shared-context idea further so multiple accounts
reliably keep perfect shared state and behave as one continuous session.
Done: restructured AI_CONTEXT.md (only file changed) — added a
scannable Status block (Last updated/Last session/Current focus/
Blocking issues) at the top for fast state checks; added standing
rules on code-as-ground-truth and marking unverified claims with
`ASSUMPTION:`; added a Decision log (section 3, append-only "why," for
choices that should outlive individual session-log entries); added a
Glossary (section 4, MSP/curriculum tree/community quiz/roster/super
admin) so terminology stays consistent across accounts; added explicit
concurrent-session conflict guidance to the handoff protocol (check
Current focus before starting unrelated work; treat unexpected local
diffs as a sign of concurrent activity); added an archiving rule so
the session log moves entries older than ~15 to a new
AI_CONTEXT_ARCHIVE.md instead of growing forever; renumbered sections
accordingly (0 rules, 1 snapshot, 2 snapshot detail, 3 decisions,
4 glossary, 5 handoff protocol, 6 open threads/log) and fixed all
internal cross-references.
Remaining: nothing for this task. AI_CONTEXT_ARCHIVE.md doesn't exist
yet — it's created on demand per the archiving rule once section 6
passes ~15 entries.
Next step: n/a — future sessions should keep using the Status block
and this log as before.
```

### [2026-07-23] Initial setup of shared AI context file — STATUS: complete
Requested: a shared context file so multiple team members on different
Claude accounts don't lose project context, plus standing rules for
professional code and responsive design.
Done: created AI_CONTEXT.md (this file); added the "Working with AI
across accounts" section to README.md.
Remaining: nothing — this is the baseline. No app code was changed.
Next step: n/a — future sessions should add their own entries above
this one.
```

**Archiving rule — keep this section from growing forever:**
once this log holds more than ~15 entries, the *oldest* entries (the
bottom of the list, above) should be cut and moved, verbatim and in
order, into `AI_CONTEXT_ARCHIVE.md` (create it if it doesn't exist yet,
newest-at-top there too, matching this file's convention). Leave the
most recent ~10 entries here. Don't summarize or shorten entries when
archiving them — just relocate them so history isn't lost, only moved
out of the way. Note the move itself as a one-line log entry here
("Archived N entries older than [date] to AI_CONTEXT_ARCHIVE.md") so
it's clear why the trail appears to jump.
