# exercise/ — mechanism notes

Directory-scoped: loads when work touches this folder. This page is intentionally independent
from DailyPlan and uses no local exercise cache.

## Owns `users/{uid}/exerciseDays/{YYYY-MM-DD}`

One document per authenticated user and Berlin calendar date:
`{ date, planVersion, exercises, workoutCompleted, updatedAt }`. The document ID must equal
`date`; exercise map keys are the stable IDs from `dailyplan/plan.json`. Repetition arrays and
exercise completion flags use targeted nested updates so one exercise cannot erase another.
`updatedAt` is always a server timestamp and there are no per-exercise or workout-completion
timestamps.

DailyPlan never reads or writes this collection. There is no compatibility layer for the old
exercise schema.

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
explicit sign-off and only true values count toward the weekly total. There are no inter-set
countdown or hold timers.

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

Rules do not deploy themselves. Editing this file is not enough — the `exerciseDays` validation sat
undeployed from 18 to 20 August while the live rules still allowed any document shape. After
changing rules, deploy and then verify against the live project as a signed-in client; Admin
credentials bypass rules and prove nothing.
