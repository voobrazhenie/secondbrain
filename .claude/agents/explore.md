---
name: explore
description: Read-only codebase search for Second Brain structure and behavior.
tools: Read, Grep, Glob, Bash
---

Search the repository before reporting; this map is only orientation:

Second Brain is several single-page apps sharing a design language but using page-specific sync
models. Map of the repo so you don't have to rediscover it every time:

- `index.html` (repo root) — home page, progress bar, links to every section below.
- `dailyplan/index.html` — the separate recurring-task list. Its JS uses `dailyConfig`,
  recurrence, one-offs, XP, trackers, Daily Direction, and localStorage-first Firestore sync.
  `dailyplan/daily.json` is mirrored into its `FALLBACK`.
- `dailyplan/plan.json` — the exercise-only schema version 2 configuration: weekly policy and
  the seven stable exercises. `dailyplan/daily.json` owns non-exercise checklist content.
- `exercise/index.html` and `exercise/app.js` — authenticated set/repetition tracking, date
  navigation, catch-up/rest scheduling, and server-only Firestore reads. See `exercise/CLAUDE.md`.
- `streams/index.html` — the "what's actually moving" tracker (push/maintain/parked streams).
- `ideas/index.html` — startup ideas list.
- `jobs/index.html` — job-search tracker with a collection listener.
- `fitness/index.html` — dead redirect stub ("Moved → DailyPlan"). Not a live section.
- `firestore.rules` — strict owner-only validation for exercise days plus owner-only access for
  unrelated collections below `users/{uid}`.
- `*/firebase-config.js` — public Firebase project config per section (not a secret).
- `docs/SECOND-BRAIN-BEHAVIOUR-SYSTEM.md` — standing reference on the app's behavioural intent.
- `reviews/*.md` — fitness-coach's own dated review notes, not app code.
- `tools/` — `read-ticks.mjs` (service-account fallback), `make-icons.mjs`.
- `README.md` and `exercise/README.md` — current configuration, data-model, testing, and
  deployment documentation.

Data model, one collection per concern under `users/{uid}/`:
- `days/{YYYY-MM-DD}` → DailyPlan ticks, item/XP totals, calendar metadata, and optional Daily Direction.
- `exerciseDays/{YYYY-MM-DD}` → `{ date, planVersion, exercises, workoutCompleted, updatedAt }`.
- `xp/{YYYY-MM}` → `{ month, total, updatedAt }`, plus a fixed `xp/peak` → `{ peakXp, updatedAt }`.
- `config/custom`, `config/streams`, `config/ideas` → one whole-document blob each.
- `jobs/{id}` → one doc per job entry, live-listened as a collection.

When asked to find something, search first, don't guess from this map alone — it may be stale. Confirm with a live grep/read before reporting a location as fact.
- `exercise/index.html` and `exercise/app.js` implement the authenticated workout UI and Firestore synchronization.
- `exercise/schedule.mjs` is the pure Europe/Berlin, Monday–Sunday scheduling module; `exercise/*.test.mjs` holds focused tests.
- `dailyplan/plan.json` is the exercise-only schema version 2 configuration.
- `dailyplan/daily.json` contains non-exercise DailyPlan configuration; it is embedded into `dailyplan/index.html` for file/offline fallback.
- `dailyplan/index.html` is the separate recurring-task checklist.
- `index.html` is the home page and reads only the current exercise week from the server when authenticated.
- `firestore.rules` validates `users/{uid}/exerciseDays/{YYYY-MM-DD}` and preserves owner-only access for unrelated user collections.

Exercise documents contain `date`, `planVersion`, `exercises`, `workoutCompleted`, and document-level `updatedAt`. DailyPlan documents remain under `users/{uid}/days/{date}`.
