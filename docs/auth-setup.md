# Auth & per-user storage — setup guide

Wave 8 productization: Google sign-in + isolated per-user Firestore stores.

## What changed in the app

- **`store.js`** — new shared ES module. It holds the Firebase config (moved out
  of the five HTML files), initializes Auth, and exports drop-in `collection()` /
  `doc()` wrappers that transparently namespace every path under
  `users/{uid}/...`. Nothing else in the pages had to change: `collection(db,'tasks')`
  now resolves to `users/{uid}/tasks`.
- Every page (`index`, `add-task`, `task`, `mindmap`, `context`) imports from
  `./store.js` and gates its bootstrap on `requireAuth()`. Signed-out visitors
  see a full-screen **Continue with Google** gate; a small account chip with a
  sign-out button sits top-right once signed in.
- **Any Google account** can sign in and gets its own empty, isolated store.

## Data model

```
users/{uid}/
  tasks/{id}            — was  tasks/{id}
  contexts/{user|tag-X} — was  contexts/{...}
  meta/{tags|notificationSettings|_migration}
```

## One-time setup in the Firebase console (project `natas-kitchen`)

1. **Authentication → Sign-in method →** enable **Google**.
2. **Authentication → Settings → Authorized domains →** add the GitHub Pages
   host (e.g. `natalyatsarapaeva-tech.github.io`) and, if you test locally,
   `localhost`. `*.firebaseapp.com` is already there.

## Migration of the existing (owner) data

Your current tasks live in the **root** `tasks/` `contexts/` `meta/` collections.
`store.js` copies them into `users/{your-uid}/...` automatically, once, the first
time the owner account (`natalya.tsarapaeva@gmail.com`) signs in. It's a copy —
the root docs are left untouched — guarded by a `users/{uid}/meta/_migration`
flag so it never runs twice.

**Order matters:**

1. Deploy the app (this branch) while Firestore is still in **test mode** (open).
2. Sign in once as the owner → migration runs, tasks appear under your store.
3. **Then** deploy the strict security rules below. (They block the browser from
   reading the root, which is exactly what the migration needs — so rules go
   last.)

## Security rules

`firestore.rules` in the repo root. Deploy with the Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

or paste it into **Firestore → Rules** in the console. Each user can read/write
only their own `users/{uid}` subtree; the legacy root is denied to all browser
access.

## Cloudflare Worker — still writes to the root (follow-up)

The email/Slack intake worker was intentionally **not** changed in this
iteration. It still writes new tasks to root `tasks/` via the Admin service
account (which bypasses security rules). Until it's updated, tasks arriving from
email/Slack will **not** appear in your per-user store.

Follow-up to make it per-user:
- add a `OWNER_UID` secret (your Firebase Auth uid) to the worker;
- change the Firestore REST paths from `documents/tasks/{id}`,
  `documents/meta/tags`, `documents/pushSubscriptions/...` to
  `documents/users/{OWNER_UID}/...`;
- `wrangler deploy` from `worker/`.
