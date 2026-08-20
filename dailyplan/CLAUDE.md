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

**Firestore is the only source.** One field — `users/{uid}/config/trackers`,
`r-smoked-weed`, an ISO date — read once per sign-in by `sync.loadWeed()` and kept
current by `sync.attachTrackers()`. `weedDate` holds it in memory and nothing else
does: no localStorage copy, no fallback scan, no plan start date.

This replaces a version that read localStorage first and fell back to `lastTicked()`'s
`HISTORY_DAYS`-bounded scan. Every browser then computed its own answer from whatever
it happened to hold, which is exactly how the same account showed different numbers on
a phone and a laptop. There is no local answer left to disagree with the server.

`weedDate` has three states and they are not interchangeable: `undefined` (not answered
yet), `null` (answered — nothing on record), and a date. The first two both draw as a
dash; only the second is settled, which is what lets `refreshAll()` retry a lookup that
never finished without re-querying an account that genuinely has no history.

### Recovery, not seeding

A missing or malformed field is not proof that nothing was ever ticked — the field was
added long after the ticks were, and it was absent in production with a real tick
sitting in `days`. `sync.recoverWeed()` answers it properly: the single most recent day
whose `ticks["r-smoked-weed"]` is set, `limit(1)`, read from the server, and the answer
is written back so the repair happens once rather than on every load. An empty result
settles as `null` and nothing is invented.

The query orders by the tick field *and* the document id, both descending. Ordering by
a field the filter has already pinned to `true` looks redundant; it is what keeps the
query on Firestore's automatic single-field index, so **no composite index has to
exist**. Verified against the live database, not assumed. Passing `before` narrows it to
days strictly earlier than that date — what an untick of the recorded day needs.

This is what retired `seedTrackerIfEmpty()` and the `.prev` undo buffer. Both existed to
protect against `lastTicked()`'s bounded scan returning a wrong empty answer and wiping
a real, older date. A `limit(1)` server query over the whole collection has no window to
fall outside, so an empty result from it *is* proof of nothing, and the machinery that
worked around the scan's dishonesty has nothing left to guard.

### Ticking and unticking

`updateTracker()` decides and writes nothing; `flush()` sends the day tick and the
tracker field in **one `writeBatch`**. They must land together — the tick saved without
the date reads as a clean run straight through a day you smoked, and the reverse is
worse. Ticking only ever moves the date forward, so a backdated entry can't erase real
clean days. Unticking only matters when the day being undone is the recorded one, and
then the replacement comes from `recoverWeed(before)` resolved *before* the batch opens,
because a batch can only be assembled from answers already in hand.

That lookup is a round trip with the queue already emptied, which would otherwise switch
off the day listener's "don't adopt a snapshot that predates my own edit" guard for its
whole duration. `sync.flushDate` covers exactly that window; `writesPending(date)` is the
one predicate both listeners ask.

`attachTrackers()` skips snapshots with `hasPendingWrites` rather than consulting a flag
of its own. The flag it replaces could be left standing after its write had already
landed, locking out a perfectly good remote value.

Two deliberate choices, unchanged:

- **A day with no record counts as a no-weed day.** The alternative punishes forgetting
  to open the app rather than smoking. The cost is that a week away reads as 7.
- **It reads `todayISO()`, not `plan.date`** — same as `computeStreak()`. It's a fact
  about now, not about whichever day the nav is showing.

The markup is `.counter` — square, unit, name — and nothing in it is weed-specific.
More trackers (screen time, habits to build) are meant to stack as sibling rows; only
this one exists so far. `config/trackers` is a bag of one field per tracker and is the
one place a merged write is right, since each write only ever names its own key. The
square is filled while the count runs and empty at zero, which is the same shape as an
unticked box — no red, no message. A bad day gets the colour drained out, not a
telling-off, and that is the point rather than a detail.

The top-bar pill is a *different* count (days anything was ticked) and is labelled
SHOWING UP for that reason — two unlabelled day counts side by side read as the same
number.

`dailyConfig.principles` is still in `daily.json` but nothing renders it. It remains part of the
embedded fallback so removing it is a separate content decision.

## The auth gate

`#wrap[data-auth]` decides what is on the page: `checking` ships in the markup, `out`
and `err` show only the top bar, the sync row and the footer, and `in` is the only state
that reveals anything personal. CSS does the hiding; `teardown()` also empties the list
and the in-memory state, because the brief is that cached data must not be *rendered*,
not merely covered.

The attribute is in the HTML rather than set by script for two reasons: there is no
first frame for a cached page to leak through, and a script error fails closed.

`loadDailyConfig()` no longer calls `rebuild()` — that moved into `onAuth()`'s signed-in
branch, and it is what actually stops the pre-auth paint. Everything after it reads
`plan.date`, so `onAuth` is `async` and awaits the rebuild before attaching anything.

The cost is real and was accepted deliberately: **this page no longer works signed out,
offline on a cold cache, or from `file://`.** If the three `gstatic.com` module imports
fail there is nothing to show, so both `init()` failure paths offer a Reload rather than
leaving a dead page. `FALLBACK` still matters for a slow `daily.json`, not for offline
use. A service worker precaching the SDK is the fix if that ever bites.

`localStorage` is deliberately **not** cleared on sign-out. Collapsed sections, notes and
direction drafts are this browser's settings; ticks, XP months and the custom document
are what make the streak and level survive a reload, and `lifetimeXp()` reads only the
local months, so wiping them would zero the level. The legacy
`secondbrain.fitness.tracker.*` keys stop influencing the counter because nothing reads
them any more, not because they were deleted. One consequence to know: localStorage is
not keyed by uid, so a *second* Google account in the same browser would see the first
one's cached ticks until the server reads land. Theoretical for a one-person app.

## Local writes must never be dropped or overwritten

`queueTick()` and `pushCustom()` record the intent regardless of auth state —
`pushCustom()` sets `customPending` — and `onAuth()` flushes both **before**
`attach()` and `loadCustomRemote()` read the server back. Getting this wrong is not a
sync nicety: ticks and removals made before `onAuthStateChanged` fired were silently
discarded, then erased by the older server copy on the next sign-in. That is what made
ticked one-offs and removed tasks reappear.

The auth gate narrows the window this protects — there is no list to tick until an
account is known — but it does not close it: a token refresh re-enters `onAuth()` with
writes still outstanding. Recording the intent costs nothing, so it stays.

`loadCustomRemote()` **merges, never replaces**: `hidden` and `doneOnce` are unions, so
anything dismissed on any device stays dismissed; `added` is unioned by id with this device
winning; the merged result is pushed straight back so both sides converge. `attach()`'s first
read carries the same `writesPending(date)` guard the live listener has, so a tick still
on its way up can't be undone by the copy just read back.

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
