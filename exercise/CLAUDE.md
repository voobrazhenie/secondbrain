# exercise/ — mechanism notes

Directory-scoped: loads when work touches this folder. Universal engineering rules (no-merge,
never full-`render()` from a tick handler) live in `.claude/agents/*.md` instead — this file is
only what's specific to *this* page's mechanism and data shape.

## Owns `users/{uid}/exercise/{date}`

One doc per date, `{ date, sessionId, sets, updatedAt }`, written whole with `setDoc` and no
merge — a changed rep scheme can shrink a `sets` array, and a merge would resurrect the old,
now-invalid indexes. `dailyplan/` reads this doc but never writes it.

## One-way sync into `dailyplan`'s Physical training row

`sets[DONE_ID]` (`DONE_ID = "x-done"`, `:315`) is the single reserved key `dailyplan/` reads
back out of this same document to mirror its locked Physical training row. The "Done" toggle
deliberately doesn't check whether every set above it is ticked — a session you call finished
is finished, half-done or not. If this page's document shape changes, that reserved key is the
one contract to keep stable, or `dailyplan/`'s mirror breaks silently (see
`dailyplan/CLAUDE.md`).

## Session rotation

Same formula as `dailyplan/` — `completedSessions(exceptDate) % prog.sessions.length` — read
from `dailyplan/plan.json`. Duplicated independently because this page can't import from
`dailyplan/index.html`; if the rotation formula ever changes, it has to change in both files.

## Hold timer — module-scoped, not persisted

`hold` (`:713`) lives in memory only, unlike the rest timer (which persists its deadline to
`localStorage` on purpose, since wandering off mid-rest is normal). A hold is not something you
walk away from, so there's nothing to resume after a reload.

It *does* need to survive a re-render, though: a Firestore pull rebuilds the whole `#list`
subtree, which would otherwise orphan the card a hold is counting inside. `restoreHold()`
(`:787`) puts the running state back onto the freshly built card after every `render()` call —
the clock itself (`hold.endAt`) never stopped, only the DOM it was pointing at changed. Any new
code path that calls `render()` needs to still call `restoreHold()` afterward, or a hold that
was running when the pull landed will look stopped while still counting down.

## Monthly monitor — two-source "trained" logic

A day reads as trained from either source, unioned, not exclusively:

- **This page's own doc**, `sets[DONE_ID]` truthy — authoritative for any date since this page
  existed, independent of whether `dailyplan/` was ever opened that day.
- **`dailyplan`'s older `sessionDone` meta** — the fallback for dates *before* this page
  existed, when training was only ever recorded as per-exercise checkboxes on the daily list.

`localMonthTrained()` (`:608`) scans local storage for both; `remoteMonthTrained()` (`:632`)
runs the equivalent bounded Firestore range query (by document id, signed in only) and is
cached per month to avoid re-querying a month already seen this session. `loadMonth()` (`:689`)
renders local first for an instant paint, then re-renders once the remote query resolves.
