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
|Auth               |None yet (single user, Firebase in test mode)|

**Firebase project:** `natas-kitchen`
**Firebase config** is in each HTML file — same config block in all 4 files.
**OpenAI API key** stored in `localStorage('openai_api_key')` — user enters it in add-task.html.

-----

## Firebase Firestore collections

```
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
  subtasks: [{
    title: "string",
    note: "string",
    dueDate: "YYYY-MM-DD|null",
    status: "new|in-progress|blocked|done",
    assigned: "string",
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

## Tag taxonomy (fixed structure)

**Work tags:** `dev`, `strategy`, `analytics`, `clients`, `leads`, `ux`
**Personal tags:** `kids`, `health`, `urgent`, `ideas`, `money`, `home`, `travel`, `rest`, `swedish`

Parent branches `work` and `personal` are not editable.
Tag labels and the list itself is planned to be user-editable (Wave 5).

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

Chat AI can execute: `create_task`, `update_task`, `delete_task`, `add_subtask`, `update_subtask`
All via JSON blocks in GPT response, parsed and executed against Firebase.
Action results shown as clickable green chips → "→ Open" links to task page.

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

## Navigation & state

- Active filter tab saved to `localStorage('savedFilter')` when opening a task
- Restored on return from task.html
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

- Firebase Auth (Google login)
- Security rules per user
- Backend API (Cloudflare Workers as API layer)
- Multi-user support

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
- **All user-facing text in English** — system prompts instruct GPT to always respond in English
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
