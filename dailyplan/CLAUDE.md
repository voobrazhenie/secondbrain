# dailyplan/ — mechanism notes

Directory-scoped: loads when work touches this folder. Universal engineering rules (no-merge,
`FieldPath`, never full-`render()` from a tick handler) live in `.claude/agents/*.md` instead —
this file is only what's specific to *this* page's mechanism and data shape.

## Recurrence — `every`/`anchor`/`skipWhen`

An item repeats on a cycle instead of daily via `onCycle(it, date)` (`:937`):

```
baseline = lastTicked(it.id, date) ?? shiftDate(anchor, -it.every)
due = date >= shiftDate(baseline, it.every)
```

Due-ness is measured from when the item was **actually last ticked** (`lastTicked()`, `:927`),
not from the calendar — miss a day and it stays due, carrying forward, until it's done. The
next cycle then counts `every` days from that real completion, not from the original anchor.
This is the general mechanism for anything that doesn't happen every day (microneedling every
14 days, watering flowers every 3) — extend it with a new `every`/`anchor` pair in `daily.json`,
don't hardcode a one-off case in `deriveDay()`.

## Exercise separation

This page owns only DailyPlan tasks in `users/{uid}/days/{date}`. It does not display workout
rows, select workout sessions, or read/write `exerciseDays`. Workout completion is intentionally
separate from DailyPlan ticks and XP.

## XP and levels

Every item's `xp` value was always saved (`xpEarned` per day), just never spent until the level
widget. Two problems shaped the implementation, both still true for any future change here:

- **Bounded history + signed-out gaps.** `loadHistory()` caps at `HISTORY_DAYS = 90` days, and
  is empty entirely when signed out. A level built by summing raw history would stall after 90
  days and then run backwards. The actual design: one recomputed total per month
  (`monthTotal()`, `:1176`, mirrored to `users/{uid}/xp/{YYYY-MM}` and locally), lifetime = sum
  of those small monthly numbers. Each month is recomputed wholesale on every tick, not
  incremented — a wrong total self-heals on the next tick instead of drifting.
- **XP can go negative** (e.g. "Smoked weed" is −20), so a live total can shrink. Level and the
  progress bar used to be read off `peakXp` — a high-water mark (`bumpPeak()`, mirrored to
  `users/{uid}/xp/peak`) — so they could never go backwards. That made the bar sit still for
  days after a negative tick, and freeze outright whenever the stored peak sat above what
  localStorage could see, which defeated the point of having a bar at all. Both now read
  `lifetimeXp()` live, so every tick moves the bar and a negative item moves it back.
  `peakXp` is still computed and synced (cheap, and it makes the decision reversible) but
  nothing renders from it — don't reintroduce it as the render source without solving the
  freeze first.
- Level cost curve: `costForLevel(n)` (`:1163`) = `400 + 150(n−1) + 10(n−1)²` — a formula, not a
  table, so it never runs out of levels. Change the constants here if the pacing needs
  retuning; don't reintroduce a hardcoded array.

## The day counter

`noWeedDays()` counts days since the last `r-smoked-weed` tick, inclusive of today.

The date it counts from **is** stored — `LS_TRACKER + WEED_ID` locally, mirrored to
`users/{uid}/config/trackers` and live-subscribed in `sync.attachTrackers()`. This
reverses an earlier version of this note, which said not to: a scan-only answer only
sees Firestore's `HISTORY_DAYS`-bounded history plus whatever this device's own
localStorage happens to hold, so on a fresh device, or a real streak longer than that
window, it quietly gives a wrong answer instead of an honest unknown — found by
actually hitting the cross-device case, not a hypothetical. A stored date has no window
to fall outside of. `updateTracker()` is what keeps it from drifting instead: ticking
only ever moves the date forward — a backdated entry older than what's already stored
must not erase real clean days — and unticking only matters when the day being undone
is the one currently stored, since no other day's untick can change what the most
recent smoke was.

That untick path went through two real bugs during review, both worth knowing before
touching this again:

- **Unticking must not just re-run `lastTicked()` and trust an empty result.** A first
  version did exactly that, and it deletes real data: `lastTicked()` is the same
  bounded scan the stored date exists to replace, so on an ordinary mis-tap-then-correct
  it can easily find nothing within its own window and overwrite a correct, months-old
  stored date with nothing. The fix is a one-step undo buffer (`LS_TRACKER + id +
  ".prev"`, `loadTrackerPrev()`/`saveTrackerPrev()`/`clearTrackerPrev()`) written
  alongside every forward move, so the common case — undo my last tick — restores the
  exact prior value with no scanning at all. The scan is now used only when that buffer
  doesn't apply (the current value came from seeding, or a reload happened in between),
  and even then an empty result is left alone rather than written — "not visible from
  this scan" is not the same claim as "definitely nothing," and only the first one is
  true.
- **Seeding must not guess from local absence alone — but coordinating against the live
  listener instead of just checking the server directly turned out to be the wrong fix.**
  The backfill (making sure a streak that's never broken again still gets a durable value,
  instead of staying on the scan forever) runs once per sign-in. A local guess racing a
  real remote value already in flight was a real risk, so the first fix made seeding wait
  for two flags — `loadHistory()` finishing and `attachTrackers()`'s first live snapshot
  arriving — before writing anything. That shipped, and in real use the doc simply never
  got seeded: confirmed directly against Firestore days after sign-in, on an account that
  was genuinely signed in the whole time. Isolated simulation of the flag ordering itself
  didn't reproduce a failure either, which pointed at the *coordination* being the fragile
  part rather than any one flag's logic — something about lining up two independent async
  signals wasn't holding up in the real client, whatever the exact mechanism. The fix,
  `sync.seedTrackerIfEmpty()`: one direct `await getDoc()` against the tracker doc,
  checked once, right after history loads. No second signal to line up against, so
  there's nothing left to race — the read itself is the confirmation.

The scan (`lastTicked()`) is still there as a fallback for the gap before a value is
known at all — not as the steady-state answer, and not trusted to overwrite one.

Two deliberate choices, unchanged:

- **A day with no record counts as a no-weed day.** The alternative punishes forgetting
  to open the app rather than smoking. The cost is that a week away reads as 7.
- **It reads `todayISO()`, not `plan.date`** — same as `computeStreak()`. It's a fact
  about now, not about whichever day the nav is showing.

The markup is `.counter` — square, unit, name — and nothing in it is weed-specific.
More trackers (screen time, habits to build) are meant to stack as sibling rows; only
this one exists so far. The square is filled while the count runs and empty at zero,
which is the same shape as an unticked box — no red, no message. A bad day gets the
colour drained out, not a telling-off, and that is the point rather than a detail.

The top-bar pill is a *different* count (days anything was ticked) and is labelled
SHOWING UP for that reason — two unlabelled day counts side by side read as the same
number.

`dailyConfig.principles` is still in `daily.json` but nothing renders it. It remains part of the
embedded fallback so removing it is a separate content decision.

## Local writes must never be dropped or overwritten

Every write path stays usable signed out. `queueTick()` and `pushCustom()` record the intent
regardless of auth state — `pushCustom()` sets `customPending` — and `onAuth()` flushes both
**before** `attach()` and `loadCustomRemote()` read the server back. Getting this wrong is not
a sync nicety: ticks and removals made before `onAuthStateChanged` fires (or in the standalone
PWA, which is a separate storage and auth context) were silently discarded, then erased by the
older server copy on the next sign-in. That is what made ticked one-offs and removed tasks
reappear.

`loadCustomRemote()` **merges, never replaces**: `hidden` and `doneOnce` are unions, so
anything dismissed on any device stays dismissed; `added` is unioned by id with this device
winning; the merged result is pushed straight back so both sides converge. `attach()`'s first
read carries the same `queue.size && queueDate === date` guard the live listener has, so a
tick still on its way up can't be undone by the copy just read back.

## One-offs — `custom.doneOnce`

A completed one-off is recorded explicitly as `custom.doneOnce[id] = date` (set in `setTick()`
via `isOneOff()`, cleared on untick so same-day undo still works) and rides in the synced
`custom` document. `deriveDay()` checks it first and falls back to `everTicked()`. The fallback
is what keeps one-offs finished before this existed hidden, but it is only a fallback — it
scans day records, which depend on this browser's localStorage or the 90-day Firestore window,
so it cannot be the durable answer on its own.

## `daily.json` / `FALLBACK`

`daily.json` is mirrored inline into `index.html` as the `FALLBACK` constant for `file://` use.
After every edit run `node tools/embed-daily-config.mjs`. Exercise `plan.json` is separate and is
never embedded into DailyPlan.
