# Exercise system

## Routine and plan

`dailyplan/plan.json` is exercise-only schema version 2. It declares Europe/Berlin, a Monday-start week, three target workout sessions, target days Monday/Wednesday/Friday, one required rest day after completion, and no carryover.

Every workout session uses the same seven exercises and stable IDs:

1. `push-ups` — 3 × 12 initially; add repetitions manually.
2. `pike-push-ups` — 3 × 6–10.
3. `chair-dips` — 3 × 8–12 using a stable household chair.
4. `diamond-push-ups` — 3 × 6–10.
5. `prone-rows` — 3 × 12–15.
6. `glute-bridges` — 3 × 12–20.
7. `single-leg-romanian-deadlifts` — 3 × 10 per leg.

There is no automatic weekly progression. Change targets or the routine deliberately in `plan.json`, keep IDs stable for unchanged exercises, increment the schema/plan version for an incompatible schema, update rule validation, and rerun the scheduling and source tests.

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
    "push-ups": { sets: [12, 12, 12], completed: true }
  },
  workoutCompleted: false,
  updatedAt: serverTimestamp()
}
```

The document ID and `date` match. Exercise keys are stable plan IDs. Repetitions are integers for the three performed sets. Only `workoutCompleted: true` counts toward the week. There are no session rotation IDs, weekly summary documents, browser timestamps, workout-completion timestamps, or per-exercise timestamps.

Exercise saves update a nested `exercises/{id}` field with `FieldPath`, so another exercise is not overwritten. Completion is a document-level merge. Every successful write is followed by a fresh server read of the selected Monday–Sunday week.

## Reads, authentication, and navigation

The exercise page uses server-only reads; it has no live listener and no localStorage fallback. It queries the selected week's document-ID range plus one direct read of the preceding Sunday so a Sunday completion can enforce Monday recovery without counting in the new week. Reads occur after auth resolves, on initial/normal refresh, date navigation, page re-entry, visibility return, retry, and successful writes. Concurrent reads for the same selected week reuse the in-flight request.

While auth resolves, exercises stay hidden. Signed-out users see a sign-in prompt and no routine or saved sets. Sign-out immediately clears in-memory exercise records. A later sign-in performs a fresh server read before rendering results. Connection failures clear current results and show a retry state instead of stale cache data.

Previous day, Today, and Next day controls update `?date=YYYY-MM-DD`. Completed and partial past workout sessions are read-only reviews with no timestamps. Future workout sessions are read-only planned previews. Rest days display `This is a rest day` and no exercise list.

## Security and testing

`firestore.rules` requires ownership, the date/document-ID match, plan version 2, expected top-level/exercise fields, boolean completion flags, three valid repetition integers, and `updatedAt == request.time`. The stricter exercise match is excluded from the general owner-only rule for unrelated collections.

Run:

```bash
node --test exercise/*.test.mjs
firebase deploy --only firestore:rules --project claudecode-3bb06
```

The automated tests cover catch-up/rest examples, the three-session cap, new-week/no-carryover behavior, partial data, Europe/Berlin DST/week boundaries, auth/source constraints, targeted writes, navigation copy, and future read-only previews. Validate rules with the Firebase rules validator before deployment.

## Legacy removal and deployment

The new application never reads the previous `users/{uid}/exercise/{date}` rotation schema and has no compatibility layer. Exercise-only fields and old exercise tick IDs were removed surgically from shared `days` and `config/custom` documents while preserving those documents and unrelated data. Four isolated legacy documents dated 2026-08-11, 2026-08-13, 2026-08-17, and 2026-08-18 remain at the old path pending separate deletion approval; they cannot affect the new `exerciseDays` system.

Firestore rules deploy through Firebase. The static frontend deploys through the existing GitHub Pages repository workflow; do not add Firebase Hosting or Cloud Functions.
