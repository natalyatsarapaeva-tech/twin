# CLAUDE.md — Project Context

> This file is read automatically by Claude Code on every session start.
> It contains the full context of this project so no explanation is needed.

-----

## What this project is

A personal AI-powered task manager built as static HTML files hosted on **GitHub Pages**.
No backend server. Data stored in **Firebase Firestore**. AI via **OpenAI GPT-4o**.

**Live app:** hosted on GitHub Pages (same repo)
**Owner:** personal tool, single user currently, with plans to productize (Wave 8+)

-----

## File structure

```
repo root/
├── index.html          — main page: task list, filters, AI chat drawer, monthly suggestions
├── task.html           — task detail: subtasks, notes, status, AI panel, deep research draft
├── add-task.html       — new task form: tags, repeat/recurring, AI bulk import
├── mindmap.html        — mind map view: tags → tasks → subtasks, split-screen detail
├── context.html        — wide context page: user profile + per-tag AI context/summaries
├── voice.js            — shared voice input utility (Web Speech API, EN/RU toggle)
├── store.js            — shared Firebase init + Google auth gate + per-user Firestore namespacing
├── firestore.rules     — per-user security rules (deploy separately)
├── docs/auth-setup.md  — auth & migration setup guide
├── CLAUDE.md           — this file
└── worker/
    ├── task-intake-worker.js   — Cloudflare Worker: email + Slack → GPT → Firebase
    ├── wrangler.toml           — Cloudflare Worker config
    └── README.md               — deployment instructions
```

-----

## Tech stack

|Layer              |Technology                                   |
|-------------------|---------------------------------------------|
|Hosting            |GitHub Pages (static, free)                  |
|Database           |Firebase Firestore (natas-kitchen project)   |
|AI                 |OpenAI GPT-4o via `/v1/chat/completions`     |
|Deep research      |Multi-step GPT agent (3 sequential calls)    |
|Voice input        |Web Speech API (browser-native, no API key)  |
|Inbound email/Slack|Cloudflare Worker → Postmark webhook         |
|Auth               |Firebase Auth (Google sign-in), per-user stores under `users/{uid}/` |

**Firebase project:** `natas-kitchen`
**Firebase config** lives once in `store.js` (was duplicated across the HTML files).
Every page imports `db` + Firestore helpers + `requireAuth`/`migrateIfOwner` from `./store.js`.
**Auth:** Google sign-in via Firebase Auth. Each page gates its bootstrap on
`requireAuth()` — signed-out users get a full-screen login gate; a sign-out chip
shows top-right once in. Any Google account gets its own isolated store, all
under the app namespace `apps/twin/` so Twin's data stays isolated from any
sibling app sharing the `natas-kitchen` Firebase project.
**OpenAI API key** stored in `localStorage('openai_api_key')` — user enters it in add-task.html.

-----

## Firebase Firestore collections

All app data is namespaced under a top-level **app namespace** `apps/twin/`
(isolating Twin from other apps in the shared `natas-kitchen` project) and then
per user. The paths below are relative to `apps/twin/users/{uid}/` —
`store.js`'s wrapped `collection()`/`doc()` prepend that whole prefix
automatically, so call sites still read `collection(db,'tasks')`. The namespace
is one constant (`APP_ROOT` in `store.js`).
(The Cloudflare Worker still writes the legacy **root** `tasks/` for now — see
`docs/auth-setup.md`.)

```
apps/twin/users/{uid}/
tasks/          — task documents
contexts/
  user          — {profile, chatSummary, updatedAt}
  tag-dev       — {profile, taskSummary, chatSummary, summaryUpdatedAt}
  tag-clients   — same structure
  tag-kids      — same structure
  ... (one doc per tag)
```

### Task document schema

```js
{
  id: "task-timestamp-random",
  title: "string",
  description: "string",
  notes: "string",           // free-form notes, drafts appended here
  status: "new|in-progress|blocked|done",
  priority: "high|med|low|none",
  deadline: "YYYY-MM-DD|null",    // hard external deadline, shows red when past
  nextAction: "YYYY-MM-DD|null", // when to work on it next; auto-derived from earliest pending subtask due date
  doneAt: "ISO timestamp|null",   // set when status → done
  tags: ["dev", "clients"],       // array of tag IDs
  primaryTag: "dev|null",         // used for mind map (no duplicates)
  subtaskMode: "parallel|sequential", // GTD: how subtasks unlock (default parallel)
  subtasks: [{
    title: "string",
    note: "string",
    dueDate: "YYYY-MM-DD|null",
    status: "new|in-progress|blocked|done",
    assigned: "string",
    waitingOn: "string|null",     // @Waiting For: who/what we wait on (only when blocked)
    createdAt: "ISO timestamp"
  }],
  recurring: {                    // null if not recurring
    frequency: "daily|weekly|monthly|yearly",
    interval: 1,                  // every N periods
    nextDue: "YYYY-MM-DD",
    endDate: null
  },
  createdAt: "ISO timestamp",
  source: "email|slack|test|null" // set by Cloudflare Worker
}
```

-----

## Tag taxonomy (per user, starts empty)

There is **no built-in tag list**. A new account starts with `{work: [], personal: []}`
and gets its tags from the onboarding assistant (welcome.html PHASE 3), which proposes a
set tailored to what the user told it and creates them via `create_tag`. No page ever
seeds a default taxonomy — `loadTags()` reads `meta/tags` and stays empty when the doc is
absent; `meta/tags` is written only by explicit tag creation/editing.

Parent branches `work` and `personal` are the two fixed groups every tag belongs to.
On index.html a group whose array is empty is **hidden entirely** (no bare "Work" /
"Personal" label). Tag ids stay latin-lowercase slugs; labels follow the user's language.

The original single-user taxonomy (`dev`, `strategy`, `analytics`, `clients`, `leads`,
`ux` / `kids`, `health`, `urgent`, `ideas`, `money`, `home`, `travel`, `rest`, `swedish`)
now lives only in the owner's `meta/tags` document, not in code.

-----

## AI architecture

### Context layers (sent with every AI request)

```
[A] User wide context (always)
    — user profile text (from context.html)
    — chat summary (auto-generated, last ~800 words)

[B] Tag context (if topic detected)
    — tag profile text
    — tag chatSummary
    — tag taskSummary (auto-generated after each task save)

[C] Selective task dump for detected tag
    — high/med priority tasks: full dump (id, title, status, due, notes, all subtasks)
    — low priority + done: compact format (id, title, status, due only)
    — done tasks: only if doneAt within last 30 days

[D] Background (always)
    — top-10 high priority tasks from other tags (compact format)
```

### Classifier (silent, step 1)

- Separate GPT call (temperature=0, max_tokens=250)
- Identifies topic, relevant tags, relevant task IDs
- Result used to build context — never shown in UI
- Fallback if no topic: top-15 high priority active tasks

### Auto chat summary

- Triggered on chat close if ≥4 user messages
- GPT writes 3-5 line summary with date
- Appended to `contexts/user.chatSummary` and `contexts/tag-{X}.chatSummary`
- Stored last ~800 words (older content trimmed)

### Tag task summary (Variant B)

- Triggered after every task save/update
- Background GPT call (fire-and-forget, user doesn't wait)
- Stored in `contexts/tag-{X}.taskSummary`
- Used in [B] context layer

### AI actions (CRUD from chat)

Chat AI can execute: `create_task`, `update_task`, `delete_task`, `add_subtask`, `update_subtask`,
`create_tag`, `update_context`
All via JSON blocks in GPT response, parsed and executed against Firebase.
Action results shown as clickable green chips → "→ Open" links to task page.

- **`create_tag`** — appends a tag to `meta/tags` (id sanitized, group work|personal, no dupes),
  then rebuilds `TAG_META` + filter tabs. Proposed by the assistant, executed only after the
  user approves (prompt rule).
- **`update_context`** — appends (never overwrites) a dated `[added by assistant · date]` note
  to the `profile` of `contexts/user` or `contexts/tag-{id}`. The assistant proactively asks to
  save durable facts ("context radar"); writes only after approval.
- Parser tolerates whitespace/newlines/code-fences around action JSON (`/\{\s*"action"/`); the
  model is told to never claim success in prose (the ✅ chip is the source of truth).

### Deep research draft (task.html)

3-step agent:

1. GPT identifies research categories (legal, purchases, travel_options, etc.)
1. Separate GPT call per category (up to 5 parallel research threads)
1. GPT compiles structured brief → saved to task.notes with date stamp

-----

## Voice input (voice.js)

Shared utility — included via `<script src="voice.js">` in all HTML files.

- `attachVoiceBtn(inputElement)` — adds 🎤 button next to any input/textarea
- `createLangToggle(containerElement)` — adds EN/RU toggle button
- Language stored in `localStorage('voiceLang')`
- Uses `SpeechRecognition` / `webkitSpeechRecognition`
- Works in Chrome/Edge/Safari, gracefully disabled in Firefox

-----

## Recurring tasks (rolling model)

- Each series is ONE live document carrying `recurring: {frequency, interval, nextDue}`
- Invariant: `deadline === recurring.nextDue` (both point at the current/next occurrence)
- Completing (✓ on card, status→done on task page, or mind map ✓): writes an archived
  done COPY (new id, `recurring: null`, `doneAt` set) and rolls the same document
  forward — `deadline`/`nextDue` advance to the first strictly-future occurrence
  (`nextOccurrence()` catches up over missed periods), status→new, subtasks reset
- Delete on a recurring task asks: "just this occurrence" (roll forward, no archive)
  vs "all occurrences" (delete the document — series stops; archived copies stay)
- `checkRecurringTasks()` on index load only migrates legacy data (old
  template/instance model): revives done-archived templates as rolling tasks and
  aligns stale `deadline` with `nextDue`
- Recurring badge shown on card: `♻ weekly`
- Repeat field available in: add-task.html form, task.html edit modal

-----

## Sequential tasks / next-action model (GTD)

Full spec: `docs/sequential-tasks-spec.md`. Visual memo: `docs/gtd-memo.html`.
Principle: the tracker surfaces the **next available action**, not the project title.

- **`subtaskMode`** (`parallel` default | `sequential`) — how subtasks unlock:
  - `parallel` → all non-done/non-blocked subtasks are available
  - `sequential` → only the first non-done subtask; a `blocked` one stops the chain
- **First available action** is computed, never stored: `firstAvailableSubtask()`
  (index.html) / `firstAvailableIdx()` (task.html). index cards show its text
  (`→ subtask`) instead of just the `nextAction` date; sequential tasks get a `▸ Seq` badge.
- **@Waiting For** — a subtask with `status: "blocked"` + optional `waitingOn`. Not
  counted as available; surfaced via the `⏳ Waiting` filter on index and a
  `⏳ Waiting: {who}` line on card + subtask. The "Waiting on" field in the subtask
  modal shows only when status = Blocked.
- **Paired filters (not sorting)** — index slices both ways: `🎯 Available` (tasks
  with a doable next action right now) and `⏳ Waiting` (blocked on someone). List
  order is left unchanged.
- **Successor / эстафета** — creates a new task inheriting tags / primaryTag when a
  task is finished, for the GTD "what's the next action?" ritual. Two entry points:
  task.html `setStatus('done')` (non-recurring) opens the modal automatically; index
  cards have a dedicated `✓→` quick button (`quickDoneAndNext`) that marks Done **and**
  opens the successor prompt, while the plain `✓` (`quickMarkDone`) just marks Done.
  Recurring tasks roll forward instead (no successor).
- Toggle lives in task.html Subtasks header and the add-task.html form (`f-subtask-mode`);
  `subtaskMode` persists via `save()` (setDoc).
- Backward compatible: tasks without `subtaskMode` behave as `parallel`; `waitingOn` optional.

-----

## Navigation & state

- **Index filters are two independent axes** that combine (never replace each other):
  `currentView` — the top row (`all`, `no-date`, `this-week`, `available`, `waiting`,
  `done-today`, `done`, plus `overdue`/`today` from the header stat chips) slices by
  time/status; `currentTag` — the Work/Personal rows (a tag id, or `work`/`personal` for
  a whole group, or `null`) slices by topic. So "This week" × "Kids" is a valid selection.
  Clicking the active tag again clears the tag axis. Each row only ever repaints its own
  buttons (`syncViewTabs()` / `syncTagTabs()` derive highlight state from the two vars).
- Both axes saved to `localStorage('savedFilter')` as JSON `{view, tag}` when opening a
  task (`rememberFilter()`), restored on return. A legacy plain-string value is still
  understood and routed to whichever axis it belongs to.
- `localStorage('currentTaskId')` — which task is open in task.html
- `localStorage('newTaskPresetTag')` — pre-selected tag when coming from filtered view
- `localStorage('monthlyGenerated')` — YYYY-MM, prevents duplicate monthly suggestions
- `localStorage('openai_api_key')` — OpenAI key
- `localStorage('voiceLang')` — 'en' or 'ru'

-----

## Cloudflare Worker (worker/)

**Endpoints:**

- `POST /email` — Postmark inbound webhook
- `POST /slack` — Slack slash command `/task`
- `POST /test` — manual testing

**Environment variables (Cloudflare secrets, never in code):**

- `OPENAI_API_KEY`
- `FIREBASE_PROJECT_ID` = `natas-kitchen`
- `FIREBASE_CLIENT_EMAIL` = service account email
- `FIREBASE_PRIVATE_KEY` = full PEM private key
- `ALLOWED_SENDERS` = comma-separated allowed email addresses
- `POSTMARK_WEBHOOK_TOKEN` = optional verification token
- `SLACK_SIGNING_SECRET` = optional but recommended — enables Slack request signature verification
- `SLACK_CHANNEL_ID` = optional — restricts Slack Events API intake to one channel
- `TEST_TOKEN` = optional — required as `{"token": "..."}` in `/test` body when set

**Deploy:** `wrangler deploy` from `worker/` directory.

-----

## Completed iterations

### Iteration 1 — Foundation

- index.html (task list, filters, search, AI chat drawer)
- task.html (task detail, subtasks, status, AI panel)
- add-task.html (form, AI bulk import)
- mindmap.html (interactive mind map, split-screen)

### Iteration 2 — AI engine v1

- Two-step classifier → context builder
- CRUD from chat (create/update/delete tasks and subtasks)
- Context-aware prompts per tag

### Iteration 3a — Wide context

- context.html page (user profile, per-tag context)
- [A][B][C][D] prompt layers
- Auto chat summary on close
- Tag task summary (fire-and-forget after save)
- doneAt timestamp on done
- Editable subtask proposals (checkbox per suggestion)

### Iteration 3b — Features

- CX button (instead of brain emoji) for context page
- Tab restore on navigation back from task
- Monthly suggestions (✨ This month button)
- Recurring tasks (check on load, badge on card, repeat in forms)
- Primary tag (★ selector, mind map uses primaryTag only)
- Deep research draft (3-step GPT agent)
- Done task archived style (dark header, muted surfaces)
- Edit button fix (lang toggle moved to back row)

### Wave 4 — Bug fixes

- Recurring: proper model (template + instance), nextDue advance
- Quick buttons (⚡ Today, ✓ Done) moved to right side of card
- Multi-image upload in AI chat (thumbnail strip, per-image annotation)
- Recurring field in task.html edit modal
- Clickable action links in AI chat results
- Recurring badge (♻) on cards

### Wave 5 (in progress)

- Cloudflare Worker for email/Slack inbound ✅
- deadline + nextAction fields (planned)
- Google Calendar integration (planned)
- Push notifications / PWA (planned)

-----

## Planned waves

### Wave 5 (next)

- `deadline` field (hard external deadline, shows red when overdue)
- `nextAction` field (when to work on it next, auto-derived from subtask due dates)
- Filters use `nextAction` for "today"/"this week", `deadline` for "overdue" ✅
- Google Calendar integration (create events from tasks)
- PWA manifest + service worker for push notifications and home screen icon
- Tag list editing (tags.html or section in context.html)

### Wave 6 — Prompting improvements

- User rewrites deep research prompts
- Monthly suggestions improved with closed task history as seeds

### Wave 7 — Gamification

- Points/crystals for completing tasks (Duolingo-style)
- Streak counter, weekly summary

### Wave 8 — Productization

- Firebase Auth (Google login) ✅ — `store.js`, login gate on every page
- Security rules per user ✅ — `firestore.rules` (deploy separately, see `docs/auth-setup.md`)
- Per-user data isolation ✅ — all data under `apps/twin/users/{uid}/` (app namespace + per-user); one-time owner migration
- Multi-user support ✅ — any Google account gets its own store
- Worker → per-user writes (follow-up; still writes root `tasks/`)
- Backend API (Cloudflare Workers as API layer)

### Wave 9 — Week planner

- week.html: drag tasks onto Mon-Fri timeline
- Google Calendar sync

-----

## Code conventions

- **No build tools** — pure HTML/CSS/JS, no bundler, no framework
- **ES modules** — `<script type="module">` in all HTML files
- **Firebase SDK** — loaded from CDN: `https://www.gstatic.com/firebasejs/12.12.0/`
- **Fonts** — Google Fonts: Spectral (headings) + DM Sans (body)
- **Color palette** — cool pastel blues/lavenders (CSS vars in `:root`)
- **No inline styles** where avoidable — use CSS classes
- **Always syntax-check** JS after changes: `node --check file.js`
- **voice.js** must be included via `<script src="voice.js">` (not module) — it sets `window.*` globals
- **Firebase writes** use `setDoc` (not `updateDoc`) for full document replacement to avoid stale fields
- **Static UI chrome is in English**; the AI assistants (index chat, welcome onboarding,
  task-page panel, add-task bulk/image import) now **mirror the user's language** — they
  reply and create task/subtask/tag/context content in whatever language the user wrote in.
  Tag **ids** stay latin-lowercase slugs regardless (create_tag falls back to a random
  latin id if the label is non-latin); tag **labels** follow the user's language.
- **Tag summaries** are fire-and-forget — never block UI on them

-----

## Important gotchas

1. **Dynamic `import()` inside ES modules causes hangs** — always use static imports at top of script
1. **Literal newlines in template literals break JS** — use `\\n` not actual newlines in strings
1. **`voice.js` is not a module** — uses IIFE pattern, sets globals on `window`
1. **Firebase `setDoc` vs `updateDoc`** — we use `setDoc` for full replacement; `updateDoc` only for specific field patches
1. **Tag task summary** updates after save — if OpenAI key not set, it silently skips (no error shown)
1. **Monthly suggestions** check `localStorage('monthlyGenerated')` — clear it to regenerate in same month
1. **Recurring tasks**: rolling model — the live series doc keeps `recurring` (with `deadline === nextDue`); archived done copies have `recurring: null`
1. **Mind map** uses `primaryTag` only — tasks without `primaryTag` fall back to `tags[0]`
