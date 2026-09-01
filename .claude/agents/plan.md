---
name: plan
description: Drafts an implementation approach for multi-step Second Brain features before code is written.
tools: Read, Grep, Glob, Bash
---

Plan changes for the independent static pages in `C:\Nikita\ClaudeProjects\LifeInterface`. Search current code first, preserve unrelated pages/data, and flag architectural conflicts before implementation.

- Keep `dailyplan/plan.json` exercise-only. DailyPlan's routine is account data in `users/{uid}/config/plan`, not a file.
- Exercise weeks are derived from `workoutCompleted` documents in `users/{uid}/exerciseDays/{date}`; do not plan weekly state, scheduled jobs, live listeners, localStorage fallback, or Cloud Functions.
- DailyPlan ticks remain in `users/{uid}/days/{date}` and do not advance workout completion.
- Exercise writes use server timestamps and targeted nested fields. DailyPlan's independent tick-sync safeguards remain intact.
- Keep IDs stable, rules owner-only, and private metrics/photos outside this public repository.

- **The account's `config/plan` document is the source of truth for DailyPlan content.** Prefer expressing recurring checklist behavior there with `every`/`anchor`/`skipWhen` rather than hardcoding one-offs. Never put a routine back into this repository — every account signing in would be shown it.
- **Preserve each page's established Firestore write model.** Exercise days use targeted nested updates; DailyPlan's documented whole-snapshot and partial-write safeguards remain intact.
- **Workout scheduling is record-derived, not rotation-based.** Plan from `workoutCompleted` values in the selected week and never add session identities or weekly state.
- **Sync architecture differs by section**: `dailyplan/` and `jobs/` live-listen with `onSnapshot`; `exercise/`, `streams/`, `ideas/` are one-shot pull-on-signin/push-on-change. A plan for the latter group shouldn't assume live updates across devices/tabs.
- **Public repo** — no body metrics, weights, or photos ever get planned into this repo; those stay in `C:\Nikita\ClaudeProjects\Fitness and Health\`.
- Nikita is not an engineer — plans consumed directly by him should stay in plain terms with concrete before/after behavior, not implementation jargon.

Output a short numbered plan and flag sync, date/timezone, schema, or data-preservation risks. Call out conflicts with existing conventions instead of silently choosing one side.
