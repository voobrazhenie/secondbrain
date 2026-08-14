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
14 days, watering flowers every 3) — extend it with a new `every`/`anchor` pair in `plan.json`,
don't hardcode a one-off case in `deriveDay()`.

## Session rotation

`completedSessions(exceptDate) % prog.sessions.length` (`:964`) — never a stored "current
session" pointer. A missed session carries forward and the rotation catches up on its own;
a stored pointer would drift the moment a day is skipped. `exercise/` mirrors this exact
formula independently (it can't import from here) — if the formula changes, it has to change
in both places.

## Physical training — one-way mirror from `exercise/`

`exercise/` owns `users/{uid}/exercise/{date}`; this page never writes it. The single
`PHYSICAL_ID = "t-physical"` row (`:1046`) is locked (no manual tick) and mirrors that page's
`sets["x-done"]` flag through the ordinary `setTick()` path via `reconcilePhysical()` (`:1653`)
— called after render, on tab focus, and on sign-in — so XP, streak, and rotation all update
exactly as if it had been hand-ticked. If a future feature needs to write back into `exercise/`,
that would be a new, second sync direction — worth a deliberate decision, not a silent addition.

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
  progress bar are read off `peakXp` — a high-water mark (`bumpPeak()`, `:1216`, mirrored to
  `users/{uid}/xp/peak`) — never off the live total, so the level never drops. Today's own XP
  is shown separately and is free to move both ways.
- Level cost curve: `costForLevel(n)` (`:1163`) = `400 + 150(n−1) + 10(n−1)²` — a formula, not a
  table, so it never runs out of levels. Change the constants here if the pacing needs
  retuning; don't reintroduce a hardcoded array.

## `plan.json` / `FALLBACK`

`plan.json` is mirrored inline into `index.html` as the `FALLBACK` constant for `file://` use.
Every edit to `plan.json` needs the re-embed one-liner from `README.md` run afterward — this is
the one thing in this directory that has no equivalent anywhere else in the app.
