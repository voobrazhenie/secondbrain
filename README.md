# Second Brain

Small static pages for things worth keeping honest. Hosted on GitHub Pages, with Firebase for cross-device state — no server to run, nothing to pay for at this scale.

Live: **https://voobrazhenie.github.io/secondbrain/**

## How DailyPlan works

`dailyplan/index.html` — **DailyPlan** — is a single self-contained page that **derives today's list itself** — it is never waiting to be told what day it is, and cannot go stale.

- **`dailyplan/plan.json`** — the whole program: a 4-session rotation, the groups that repeat every day, one-off setup tasks, and the weekly schedule. Holds both a `home` (bodyweight) and a `gym` variant; `activeProgram` picks one.
- **Firestore** — where ticks and the optional Daily Direction live once you sign in, so the phone and the PC agree. Signed out, the page still works and keeps them in `localStorage` only.
- **`dailyplan/overrides/<YYYY-MM-DD>.json`** — optional, rare. Shallow-merged over the derived day when a particular day needs something the rules can't express.

### How a day is derived

1. **Training or rest?** From `schedule` by weekday.
2. **Which session?** By **rotation, not calendar**: `completedSessions % 4`. This is the important part — missing a Thursday must not skip that session forever. Because the count comes from history rather than a stored pointer, a missed session carries forward on its own and the rotation can't drift out of sync.
3. **Groups** = the session (omitted on rest days) + everything in `daily` + any `oneOffs` not yet ticked on a *previous* day.

A session counts as done when at least half its items are ticked. That is written to the day document as `sessionDone`, and mirrored into `localStorage` so the rotation still advances when signed out.

Exercises carry a `ladder` of variations and a `rung` index — progression at home is by variation and tempo rather than weight. Rungs advance during the weekly review, not automatically, because reps aren't logged.

Append `?date=YYYY-MM-DD` to the URL to make the page believe it is that day. Useful for stepping through the rotation without waiting a fortnight.

### Switching to the gym

Set `activeProgram` to `"gym"` in `dailyplan/plan.json`. The gym sessions are already written and parked; nothing else changes.

## Data model

```
users/{uid}/days/{YYYY-MM-DD}  ->  {
  ticks: { itemId: true, … },
  direction: { status, promptId, promptText, text, nextAction, updatedAt },
  session metadata,
  updatedAt
}
```

One document per day. Item `id`s in `plan.json` must be **unique and stable** — tick state is keyed on them, so reusing an id from a previous day carries that tick across.

Tick changes use targeted field updates so unticked keys are deleted rather than resurrected by a deep merge. Whole-map operations such as clearing a day use merge-safe writes so the date's optional Daily Direction is preserved.

Signed out, Daily Direction uses one key per date: `secondbrain.daily.direction.<YYYY-MM-DD>`.

## Security

`dailyplan/firebase-config.js` is **public by design** and committed. The `apiKey` is an identifier for which project to talk to, not a credential. What actually protects the data is `firestore.rules`, which allows reads and writes only where `request.auth.uid` matches the `{uid}` in the path. Everything else is denied, including all unauthenticated access.

The credential that *is* secret is the **service-account key** used by `tools/read-ticks.mjs`. It bypasses every rule. It lives at `tools/service-account.json`, is gitignored, and must never be pasted anywhere public.

Progress photos and body measurements stay out of this repo entirely — they live in `C:\Nikita\ClaudeProjects\Fitness and Health\`, and `.gitignore` blocks the usual filenames as a backstop.

## First-time Firebase setup

Almost all of this is CLI work, so it does not need doing by hand in the console. The one step that cannot be automated is logging in, because it needs a browser and your consent:

```bash
npx -y firebase-tools@latest login
```

After that, in this directory:

```bash
firebase projects:create                      # or reuse an existing project id
firebase deploy --only firestore:rules        # publishes firestore.rules
firebase deploy --only auth                   # Google sign-in + authorised domains
firebase apps:create web "Second Brain"
firebase apps:sdkconfig web                   # prints the config object
```

The config object from that last command goes into `dailyplan/firebase-config.js`, replacing `export const firebaseConfig = null`. Until it does, the page runs local-only and says so in its sync row.

`voobrazhenie.github.io` must be an authorised domain or sign-in fails with `auth/unauthorized-domain` — that comes from the `auth` deploy, and it is the most common thing to miss when doing this by hand.

Firestore rules live only in `firestore.rules`. Editing them in the console instead puts the live rules out of step with this file, and the next deploy overwrites the console edit without warning.

## Reading ticks

With the Firebase MCP server connected — `claude mcp add firebase -- npx -y firebase-tools@latest mcp` — Claude Code reads Firestore through the CLI's own logged-in credentials, and **no service-account key is needed at all**.

`tools/read-ticks.mjs` is the fallback for when MCP isn't available. It does need a service-account key, which bypasses every security rule, so prefer the MCP route:

```bash
node tools/read-ticks.mjs --uid <UID> --days 14
```

The uid appears in the page's copy-for-Claude-Code block once you're signed in, or under **Authentication → Users** in the console.

## Editing the program

Edit `dailyplan/plan.json`. Item `id`s must be **unique and stable** across the whole file — tick state is keyed on them, so reusing an id carries its tick history with it, and one-off suppression looks them up by id.

`plan.json` is also inlined in `index.html` as `FALLBACK`, so the page still renders when opened from a `file://` path where `fetch` is blocked. **Both copies need updating**; re-embed with:

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('dailyplan/plan.json','utf8'));let h=fs.readFileSync('dailyplan/index.html','utf8');h=h.replace(/const FALLBACK = \{.*?\};\n/s,'const FALLBACK = '+JSON.stringify(p)+';\n');fs.writeFileSync('dailyplan/index.html',h)"
```
