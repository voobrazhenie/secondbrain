# exercise/ — mechanism notes

Directory-scoped: loads when work touches this folder. Universal engineering rules (no-merge,
never full-`render()` from a tick handler) live in `.claude/agents/*.md` instead — this file is
only what's specific to *this* page's mechanism and data shape.

## Owns `users/{uid}/exercise/{date}`

One doc per date, `{ date, sessionId, sets, updatedAt }`, written whole with `setDoc` and no
merge — a changed rep scheme can shrink a `sets` array, and a merge would resurrect the old,
now-invalid indexes. `dailyplan/` reads this doc but never writes it.

The rest timer's own state is **not** in here and is not synced. It lives in `localStorage` under
`LS_REST` and nowhere else — a clock counting down on the phone has no business appearing on the
desktop.

## One-way sync into `dailyplan`'s Physical training row

`sets[DONE_ID]` (`DONE_ID = "x-done"`, `:362`) is the single reserved key `dailyplan/` reads
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

`hold` (`:839`) lives in memory only, unlike the rest timer (which persists its deadline to
`localStorage` on purpose, since wandering off mid-rest is normal). A hold is not something you
walk away from, so there's nothing to resume after a reload.

It *does* need to survive a re-render, though: a Firestore pull rebuilds the whole `#list`
subtree, which would otherwise orphan the card a hold is counting inside. `restoreHold()`
(`:913`) puts the running state back onto the freshly built card after every `render()` call —
the clock itself (`hold.endAt`) never stopped, only the DOM it was pointing at changed. Any new
code path that calls `render()` needs to still call `restoreHold()` afterward, or a hold that
was running when the pull landed will look stopped while still counting down.

## Rest timer — three states, one bar

The sticky bar is `REST` (ink), `NEXT UP` (teal) or `SESSION DONE` (lime) depending on where the
tick that started it left you. `afterSetCompleted(id)` (`:701`) is the only thing that decides,
and both ways of finishing a set route through it — a tapped `.set` button and a hold running out
in `holdTick()`. Anything new that completes a set should call it rather than `restStart()`
directly, or that path will silently lose the transition and finale cases.

`LS_REST` now stores `{ endAt, kind, itemId, nextItemId }`. `kind` is `"recovery"` or
`"transition"`; the ids are what the subtitle names, resolved through `itemsById` rather than held
as strings, so a rung change renames the exercise in a bar that is already counting. A value
written before this existed has `endAt` only, and reads as a recovery rest with no subtitle —
which is exactly what it was, so no migration is needed. **`restAdd()` has to spread the stored
state**, not rebuild it: `+30s` writing `{endAt}` alone is what would quietly turn a transition
back into a plain rest.

### The finale is derived, never stored

`finaleActive()` (`:1046`) is `isWorkoutComplete() && !isDone()` — both computed from `sets`,
which is already persisted and already synced. There is deliberately no flag and no localStorage
entry for "session finished", so a reload, a refocus, or a pull that completes the session from
another device all reach the same answer with nothing to keep up to date.

The cost is that it has to be *re-derived* everywhere `sets` changes. `restTick()` (`:1067`)
checks it before it looks at the stored rest — once the last set is in there is nothing left to
rest for, whatever the clock says — and it is called from three places for this reason:

- the end of `render()`, beside `restoreHold()` and for the same reason (covers boot, `sync.pull()`
  and `sync.pullRotation()`),
- `toggleSet()`'s *un*-tick branch, which can make a finished session unfinished,
- the end of `toggleDone()`, since signing off is what dismisses the banner.

A future code path that mutates `sets` without going through `render()` needs a fourth call, or
the banner goes stale.

**The finale never ticks the sign-off.** `FINISH →` scrolls to `#signoff` and flashes it; the tap
stays the user's. `sets[DONE_ID]` is the one thing on this page that crosses into `dailyplan/`'s
XP and streak, and "every box is ticked" is not the same claim as "I'm calling this session done"
— see the sign-off note above.

## Rest lengths are content, not code

`rest` (between sets) and `restNext` (before the next exercise), in seconds, readable off an item,
a session, or a whole programme in `plan.json` — most specific wins, via `restSecondsFor()`
(`:522`). Nothing authored falls back to 60s/90s, plus 20s on a `hero` item. The 60 is chosen so
an untuned exercise behaves exactly as everything did before this existed.

Note the ordering consequence: a programme-level `rest` is explicit content and so **outranks** the
hero bonus, which is only a default. If a hero movement needs a longer rest under a programme that
sets one, give the item its own `rest`.

No new axis was added for "difficulty" or "goal" — `hero` already marks the session's priority
movement, and the programme level is already where `home` and `gym` differ. Out-of-range or
non-numeric values are ignored rather than trusted, so a typo can't wedge the clock.

## Monthly monitor — two-source "trained" logic

A day reads as trained from either source, unioned, not exclusively:

- **This page's own doc**, `sets[DONE_ID]` truthy — authoritative for any date since this page
  existed, independent of whether `dailyplan/` was ever opened that day.
- **`dailyplan`'s older `sessionDone` meta** — the fallback for dates *before* this page
  existed, when training was only ever recorded as per-exercise checkboxes on the daily list.

`localMonthTrained()` (`:734`) scans local storage for both; `remoteMonthTrained()` (`:758`)
runs the equivalent bounded Firestore range query (by document id, signed in only) and is
cached per month to avoid re-querying a month already seen this session. `loadMonth()` (`:815`)
renders local first for an instant paint, then re-renders once the remote query resolves.
