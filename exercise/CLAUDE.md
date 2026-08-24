# exercise/ — mechanism notes

Directory-scoped: loads when work touches this folder. This page uses no local exercise cache and
owns its own data; the one link to DailyPlan is the sign-off tick described below.

## Owns `users/{uid}/exerciseDays/{YYYY-MM-DD}`

One document per authenticated user and Berlin calendar date:
`{ date, planVersion, exercises, workoutCompleted, updatedAt }`. The document ID must equal
`date`; exercise map keys are the stable IDs from `dailyplan/plan.json`. Repetition arrays and
exercise completion flags use targeted nested updates so one exercise cannot erase another.

Each exercise entry is `{ sets, done, completed }`. `done` is three booleans — which sets are
actually ticked — and is **optional**: days recorded before it existed have only `sets` and
`completed`, and must keep validating. Treat a missing `done` as all-three-if-completed, never as
zero. `completed` is derived (`done.every(Boolean)`) but stays stored, because the schedule and the
sign-off gate read it. Every set write sends the whole entry so `sets` and `done` cannot disagree
about how many sets exist.

`updatedAt` is always a server timestamp and there are no per-exercise or workout-completion
timestamps.

DailyPlan never reads or writes this collection. There is no compatibility layer for the old
exercise schema.

The link runs one way only: signing off a workout also ticks `t-workout` (**Physical training**) in
`users/{uid}/days/{date}`, which DailyPlan owns. Only the tick is written — this page has no copy of
`daily.json` and cannot compute the day's XP, which DailyPlan recomputes from its own ticks on its
next render, so the stored `xpEarned` lags until then. A failed tick must never fail the workout:
the session is already signed off by that point. The id is duplicated as `DAILY_TICK_ID` in `app.js`
and as an item in `dailyplan/daily.json`; `app.test.mjs` fails if one is renamed without the other.

## Auth and server reads

Do not render the routine until Firebase auth resolves. Signed-out state clears all exercise data
from memory and shows only the sign-in prompt. Exercise data never falls back to localStorage or
Firestore's cache.

Use `getDocsFromServer`/`getDocFromServer` for the selected Monday–Sunday range after auth, date
navigation, page entry/return, visibility restoration, refresh, and every successful write.
Reuse an in-flight request for the same range and show a retryable error when the server cannot be
reached. Do not add a live listener.

## Scheduling and editing

`schedule.mjs` is the pure source of schedule truth. It uses Europe/Berlin dates, target days
Monday/Wednesday/Friday, at most three completed workout sessions per week, one rest day after an
actual completion, catch-up on the next eligible day, and no unfinished-work carryover. Future
previews assume each upcoming eligible workout is completed and remain read-only.

Only the current eligible workout is editable. Past completed days are review-only; future days
are planned previews. Rest days show exactly `This is a rest day`. `workoutCompleted` is the one
explicit sign-off and only true values count toward the weekly total, and it cannot be undone.

Sets are tapped, not typed: tap a tile to complete it, hold it for 520 ms to edit its repetitions.
A tile seeds at the top of the plan's range. There **is** a rest timer — 60 s between sets, 90 s
between exercises — which is device-local and never persisted; the earlier rule forbidding it was
retired by the redesign. `DONE` is **never gated on the tally**: a session can be signed off at any
point, including with nothing ticked, and still counts as one of the three weekly sessions. The
earlier rule locking it to all 24 sets is retired — the routine is still being shaped, and a
session that stopped early is still a session. Signing off on a day with no document yet must also
send `exercises: {}`, which rules require; never merge that empty map into a day that has sets.

Saves are serialised and pick create vs update from what the server is known to hold, not from the
local record — the local record is written optimistically before the save lands. The refresh after
a write must not join a refresh already in flight, which may predate the tick. A rejected write
says which kind of rejection it was, and `RETRY` re-sends that set rather than re-reading the week.

## Plan and rules

`dailyplan/plan.json` contains only schema version 2, the weekly policy, and eight stable
exercise definitions. Do not add programs, unique workout-session IDs, automatic progression,
weekly updater state, or duplicated schedules.

The routine size is duplicated in `ROUTINE_SIZE` in `app.js` and the id allowlist in
`firestore.rules`. `plan.test.mjs` fails if the three drift apart — without it a new exercise
passes every test and then breaks the page and the write.

**Exercise IDs are only ever added to `firestore.rules`, never removed.** Signing off a workout
merges into the existing document and rules validate the merged result, so a day recorded under an
older routine must stay valid. `push-ups` and `glute-bridges` are retired from the routine but
remain allowed for exactly that reason.

`firestore.rules` validates the owner, document date, plan version, top-level keys, exercise map
shape, repetition lists, booleans, and request-time timestamp. Keep partial nested updates valid
while rejecting unknown fields. See `exercise/README.md` for the full schema and deployment steps.

**Validate only the entries a write changed.** Rules are capped at 1000 evaluated expressions per
request, and checking all ten allowed entries every time costs more the more the day holds: at six
exercises a single tapped set was refused, so sets 16–24 could never be saved and no session was
ever signed off. `validExercise` takes the `diff(before).affectedKeys()` set and returns true
immediately for an entry the write did not touch. Any rewrite that goes back to validating the
whole map breaks the page halfway through a workout, and `plan.test.mjs` fails if the shape is lost.

`plan.test.mjs` reads the rules as text and cannot catch that — every test passed while the page was
broken. `tools/rules-check.mjs` evaluates them through the Firebase Rules simulator against a full
eight-exercise day. Run it before and after every rules deployment; it needs credentials and network
so it stays out of `npm test`.

Rules do not deploy themselves. Editing this file is not enough — the `exerciseDays` validation sat
undeployed from 18 to 20 August while the live rules still allowed any document shape. After
changing rules, deploy and then verify against the live project as a signed-in client; Admin
credentials bypass rules and prove nothing.
