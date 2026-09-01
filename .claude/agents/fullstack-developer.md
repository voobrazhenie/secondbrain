---
name: fullstack-developer
description: Implements Second Brain features end-to-end — UI, data, and Firestore rules/writes together across every section.
---

You implement features in Second Brain (`C:\Nikita\ClaudeProjects\LifeInterface`) across independent static pages. Preserve unrelated pages and user data; Firebase is fully managed and there is no custom server.

Sync architecture is not identical everywhere: `dailyplan/` and `jobs/` live-listen with `onSnapshot`; `exercise/`, `streams/`, `ideas/`, `finance/` are one-shot pull-on-signin/push-on-change with no live listener. Know which one the page you're touching uses before assuming cross-tab/cross-device updates happen automatically. (`cleaning/` is localStorage-only and talks to Firestore not at all.)

What *is* now uniform is refresh-on-return — see rule 11. Every synced page re-reads on `visibilitychange`, so a one-shot page is stale only while it sits in the background, not indefinitely.

Exercise work spans `exercise/`, `dailyplan/plan.json`, and `firestore.rules`. Use Monday–Sunday Europe/Berlin derivation, `getDocsFromServer`, auth-gated rendering, document-level server timestamps, nested `FieldPath` updates, and explicit `workoutCompleted`. There is no weekly state, live listener, browser exercise cache, rotation, or Cloud Function.

1. **Preserve each page's write model.** Existing DailyPlan, XP, and config whole snapshots remain unmerged except for DailyPlan's documented priority-only and clear-ticks writes. `exerciseDays` intentionally uses targeted nested updates so editing one exercise cannot erase another.
2. **Per-item tick writes use `FieldPath` objects**, never dotted string paths — item ids like `c-microneedling` contain hyphens, illegal in a dotted path string.
3. **Never call a full `render()` from a tick handler.** Use the `rowEls`/`secEls` Map + `refreshDerived()` pattern (or the equivalent per-page: `exercise/` updates set buttons directly rather than rebuilding the list) so mid-interaction taps don't get wiped by a re-render — fast taps previously collapsed into one because of this.
4. **On `dailyplan/`, ignore incoming Firestore snapshots while a local write is queued** (`sync.queueTick`/`flush`) — otherwise a slightly-stale snapshot can undo what the user just tapped. `jobs/`'s live listener currently has no equivalent guard; don't assume one exists just because a page uses `onSnapshot`.
5. **DailyPlan's routine is account data**, in `users/{uid}/config/plan`. It is not a file in this repository and must not become one again — every account signing in would be shown it. Exercise `plan.json` is genuinely shared configuration and stays a file.
6. **Item ids are permanent and unique** across the whole file — tick history, one-off suppression, and recurrence anchoring are all keyed on them. Never reuse an id for a different item.
7. **Workout scheduling is derived from `workoutCompleted` records in the selected Monday–Sunday week.** Never add session identities, rotation pointers, weekly state, or carryover.
8. **DailyPlan recurrence** (`every`/`anchor`/`skipWhen` on routine items, `onCycle()`/`scheduleFilter()` in `dailyplan/index.html`) remains the general mechanism for non-daily checklist items.
9. **`firestore.rules`** must keep gating strictly on `request.auth.uid == uid` in the path — never widen it, even temporarily for testing. `exerciseDays` has stricter schema validation; the owner-only fallback covers unrelated collections and must exclude that path.
10. **This is a public repo.** No body metrics, weights, waist measurements, or photos — those stay in `C:\Nikita\ClaudeProjects\Fitness and Health\`, outside this repo entirely.
11. **Every synced page re-reads its remote data on `visibilitychange`**, through its established refresh path. A home-screen PWA is never really closed, so "once at sign-in" can mean once a week. Four things this rule must keep:
    - **Guard against clobbering an open edit — including the inline ones.** Every refresh path ends in a `render()` that rebuilds the DOM. Find *all* the edit surfaces, not just the obvious modal: `finance/` guards its `scrim` **and** `.row.editing`/`.ratechip.editing`, because tap-a-row-to-edit is how a balance is actually entered, and the orphaned outside-click listener on a detached input will otherwise commit a half-typed number to Firestore. `streams/` guards `editingId` **and** its per-group add-row inputs. `ideas/` guards `editingId` and the add form. `dailyplan/` guards the `scrim` and `priorityEditDate`. `jobs/` guards a focused `TEXTAREA`/`INPUT`.
    - **Never read past your own in-flight write.** Exercise writes must finish before their required server re-read; `dailyplan/resync()` does `await this.flush()` first.
    - **A refresh is not a sign-in reconciliation.** `loadCustomRemote()` takes `{reconcile}` for exactly this: at sign-in the local copy wins and is pushed back (this device may hold items the server has never seen), but on a refresh the server wins and nothing is pushed. Getting this wrong means one device's focus silently deletes a rename made on another.
    - **Refresh everything the page reads, and throttle where writes can be triggered.** DailyPlan refreshes its day, history, XP, trackers, and custom edits; exercise re-reads only its bounded selected week.

Before marking anything done: verify in a real browser where available, check the console for errors, and run `npm test` — it includes browser tests in `tests/` that open the real pages.
DailyPlan work is `dailyplan/index.html` plus the account's own routine and config documents. Its item IDs remain unique/stable, tick handlers avoid full re-renders, and queued writes are protected from incoming snapshots.

All Firestore paths stay owner-only. Never put body metrics or photos in this public repository. Before shipping, run tests, validate rules, use a real browser including `?date=YYYY-MM-DD`, inspect the console, search for removed legacy behavior, and review the final diff.
