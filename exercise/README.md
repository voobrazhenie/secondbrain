# Exercise system

## Routine and plan

`dailyplan/plan.json` is exercise-only schema version 2. It declares Europe/Berlin, a Monday-start week, three target workout sessions, target days Monday/Wednesday/Friday, one required rest day after completion, and no carryover.

Every workout session uses the same eight exercises and stable IDs:

1. `decline-push-ups` — 3 × 8–12, feet on a chair.
2. `pike-push-ups` — 3 × 8–12.
3. `chair-dips` — 3 × 10–15 using a stable household chair.
4. `diamond-push-ups` — 3 × 8–12.
5. `prone-rows` — 3 × 15–18.
6. `single-leg-glute-bridges` — 3 × 10–15 per leg.
7. `single-leg-romanian-deadlifts` — 3 × 12 per leg.
8. `leg-raises` — 3 × 10–15.

Retired: `push-ups` (replaced by the decline version once 15+ reps were routine) and `glute-bridges` (replaced by the single-leg version for load). **Both keep their entries in `firestore.rules`.** Signing off a workout merges into the existing document and rules validate the merged result, so a day recorded under an older routine has to stay valid. IDs are only ever added to that allowlist, never removed.

There is no automatic weekly progression. Change targets or the routine deliberately in `plan.json`, keep IDs stable for unchanged exercises, increment the schema/plan version for an incompatible schema, update rule validation, and rerun the tests. `plan.test.mjs` checks that `plan.json`, `ROUTINE_SIZE` in `app.js` and the `firestore.rules` allowlist still agree — before this existed, a new exercise passed every test and then failed twice in the browser.

Rep targets move up when every set reaches the top of the range. Past roughly 15 reps, prefer a harder variation over a bigger number: bodyweight sets that long stop being an efficient muscle stimulus.

## Catch-up scheduling

The schedule is derived by `schedule.mjs`; there is no stored weekly state or updater.

- The first workout becomes due Monday and remains due on each later day until completed or Sunday ends.
- After an actual `workoutCompleted: true`, the next calendar day is rest.
- The next workout becomes due on the later of its nominal Monday/Wednesday/Friday target or two calendar days after the previous completion.
- Partial exercise results do not create a rest day or count toward the three-session limit.
- After three completions, all remaining days that week are rest.
- A new Monday starts from zero naturally; unfinished work never carries over.
- Future previews simulate completion on each next eligible day and are visibly planned/read-only. Historical views use only actual completion documents available through that date.

Date-only strings are manipulated as abstract Gregorian dates, never parsed as local/UTC instants. “Today” is produced with `Intl.DateTimeFormat` in `Europe/Berlin`; tests cover DST and week/year boundaries.

## Firestore schema

One document is stored per authenticated user and calendar date:

```text
users/{uid}/exerciseDays/{YYYY-MM-DD}
```

```js
{
  date: "2026-08-18",
  planVersion: 2,
  exercises: {
    "push-ups": { sets: [12, 12, 12], done: [true, true, true], completed: true }
  },
  workoutCompleted: false,
  updatedAt: serverTimestamp()
}
```

The document ID and `date` match. Exercise keys are stable plan IDs. Repetitions are integers for the three performed sets. Only `workoutCompleted: true` counts toward the week. There are no session rotation IDs, weekly summary documents, browser timestamps, workout-completion timestamps, or per-exercise timestamps.

`done` records which of the three sets have actually been ticked off, so closing the page mid-workout does not lose the sets already finished. It is **optional and additive**: days written before per-set tracking carry `sets` and `completed` and no `done`, and both shapes validate under the same plan version. The page reads a missing `done` as all three sets for a completed exercise and none otherwise — never as a half-finished set nobody recorded. `completed` stays in the document as the derived answer (`done.every(Boolean)`) because the schedule and the sign-off gate both read it.

Exercise saves update a nested `exercises/{id}` field with `FieldPath`, so another exercise is not overwritten. Completion is a document-level merge. Every successful write is followed by a fresh server read of the selected Monday–Sunday week.

## Recording a session

The routine is a list of tiles, not a form. Each set is one tile showing the repetitions it will
be recorded at:

- **Tap** a tile to mark that set done. It fills in, the exercise's counter moves (`2/3`), and the
  write goes up immediately — there is no save button and nothing is batched until the end.
- **Hold** a tile (520 ms) to open the repetition editor for that set, then `APPLY` or Enter. The
  press that opens the editor never also toggles the set.
- A tile starts at **the top of the plan's range** — 12 for an 8–12 exercise, 18 for 15–18. Tapping
  means "I hit the target"; a worse set is one hold away. Seeding the bottom of the range instead
  would make every good set an edit.

Writes are optimistic: the tile paints first and the write follows, because a tile that waits for a
round trip before it darkens feels broken mid-set. A rejected write puts the old value back and
says so in the sync row.

The **rest timer** sits above the routine and starts itself when a set is ticked: 60 seconds
between sets, 90 seconds when an exercise is finished, `+30S` and `SKIP` to steer it, `READY` at
zero, and `SESSION COMPLETE` once all 24 sets are in. It is device-local and deliberately **not**
persisted — a timer that survived a reload would be counting rest already taken. This replaces the
earlier rule that the page has no inter-set timers; the redesign decided the timer earns its place.

`DONE` is available at any point in the session, including with nothing ticked; it shows how many
sets are in so far. It used to stay locked until all 24 were ticked, which is wrong while the
routine is still being shaped — a session that stopped early is still a session, and it records what
it recorded. Signing off writes `workoutCompleted: true` and ticks `t-workout`
(**Physical training**) on the DailyPlan day. A partly-ticked session counts as one of the three
weekly sessions and still earns the following rest day. There is no undo: un-completing a session
would move the rest day and the weekly count under an already-derived schedule.

Signing off with no document for the day yet also writes `exercises: {}`, because the rules require
the field. That empty map is only ever sent on a create — merging it into a day that already holds
sets would be a different write.

## Reads, authentication, and navigation

The exercise page uses server-only reads; it has no live listener and no localStorage fallback. It queries the selected week's document-ID range plus one direct read of the preceding Sunday so a Sunday completion can enforce Monday recovery without counting in the new week. Reads occur after auth resolves, on initial/normal refresh, date navigation, page re-entry, visibility return, retry, and successful writes. Concurrent reads for the same selected week reuse the in-flight request.

While auth resolves, exercises stay hidden. Signed-out users see a sign-in prompt and no routine or saved sets. Sign-out immediately clears in-memory exercise records. A later sign-in performs a fresh server read before rendering results. Connection failures clear current results and show a retry state instead of stale cache data.

Previous day, Today, and Next day controls update `?date=YYYY-MM-DD`, as does tapping a day in the week strip. Completed and partial past workout sessions are read-only reviews with no timestamps. Future workout sessions are read-only planned previews. Rest days display `This is a rest day` and no exercise list.

## Security and testing

`firestore.rules` requires ownership, the date/document-ID match, plan version 2, expected top-level/exercise fields, boolean completion flags, three valid repetition integers, and `updatedAt == request.time`. The stricter exercise match is excluded from the general owner-only rule for unrelated collections.

**Only the exercise entries a write actually changes are validated**, and this is not an optimisation. Rules are capped at 1000 evaluated expressions per request. The earlier version checked all ten allowed entries every time, so the cost grew with the size of the stored day: at six exercises a single tapped set was refused, which is why sets 16–24 could never be saved and no full session was ever signed off. The rules take `request.resource.data.exercises.diff(before).affectedKeys()` and gate each entry check on it, keeping the work proportional to the tap rather than to the day's history. If a future change reintroduces whole-map validation, the page breaks again halfway through a workout.

Run:

```bash
node --test exercise/*.test.mjs
node tools/rules-check.mjs                 # dry-run the rules in this repo
node tools/rules-check.mjs --live          # dry-run the ruleset serving traffic
firebase deploy --only firestore:rules --project claudecode-3bb06
```

The automated tests cover catch-up/rest examples, the three-session cap, new-week/no-carryover behavior, partial data, Europe/Berlin DST/week boundaries, auth/source constraints, targeted writes, navigation copy, and future read-only previews.

`tools/rules-check.mjs` is the one that evaluates rules rather than reading their source. It sends a full eight-exercise day — plus both retired ids, a pre-`done` entry, a sign-off with nothing recorded — through the Firebase Rules simulator, along with the denials that must keep holding. Nothing is written or deployed. It needs the service-account credentials and network access, so it is not part of `npm test`; run it by hand before every rules deployment, then again with `--live` afterwards. The file-level tests cannot catch an expression-budget failure: every one of them passed while the page was broken.

## Legacy removal and deployment

The new application never reads the previous `users/{uid}/exercise/{date}` rotation schema and has no compatibility layer. Exercise-only fields and old exercise tick IDs were removed surgically from shared `days` and `config/custom` documents while preserving those documents and unrelated data. Four isolated legacy documents dated 2026-08-11, 2026-08-13, 2026-08-17, and 2026-08-18 remain at the old path pending separate deletion approval; they cannot affect the new `exerciseDays` system.

Firestore rules deploy through Firebase. The static frontend deploys through the existing GitHub Pages repository workflow; do not add Firebase Hosting or Cloud Functions.
