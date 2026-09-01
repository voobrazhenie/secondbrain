# Second Brain

Small static pages hosted on GitHub Pages, with private cross-device state in Firebase project `claudecode-3bb06`.

Live site: **https://voobrazhenie.github.io/secondbrain/**

## Pages and configuration

- `exercise/` is the authenticated workout-session page. Its plan is `dailyplan/plan.json`; scheduling code and tests live in `exercise/schedule.mjs` and `exercise/schedule.test.mjs`.
- `dailyplan/` is the separate recurring-task checklist. Its non-exercise configuration is `dailyplan/daily.json`.
- `jobs/`, `streams/`, `ideas/`, `finance/`, and `cleaning/` are unrelated features and retain their existing data models. `jobs/` splits its list into UNREAD, CURRENT and NOT RELEVANT: `unread: true` is where a research pass puts everything it finds, so nothing joins the working list until he has read it; `parked: true` on a job doc is Nikita saying no to it, and `.claude/agents/job-scout.md` treats that as permanent so a later research pass never offers the same role twice. `focus: true` is his own highlight, and shows as a pink drag handle.
- `opportunities/` is the private grants / residencies / exhibitions tracker. It is signed-in only — signed-out visitors see a sign-in prompt and no data — and stores one document per entry in `users/{uid}/opportunities/{id}`.
- `firestore.rules` applies strict schema validation to exercise documents while preserving owner-only access for other user data.
- `shared/` holds what every synced section needs rather than one of them: `shared/firebase-config.js` is the single copy of the public Firebase config, and `shared/firebase.js` is the sign-in plumbing — connecting, reporting who is signed in, and running sign-in and sign-out. It deliberately owns nothing visible. Each page keeps its own wording, its own status line, and its own decision about what a signed-out visitor sees, because the sections do not agree about that and moving the plumbing must not quietly make them agree. `dailyplan/` reads it; the other sections still carry their own copy and move over one at a time.
- `theme.css` at the repo root is the shared design system: colours, stroke width, shadow, the `.handle` drag grip, the `.crumbs` breadcrumb header, and `--page-width`, the one column width every section uses. Every page links it. `cleaning/` links it for the width, breadcrumb and handle but still overrides the colour tokens with its own `:root` until it is redesigned. The stylesheet also carries the house rules for glyphs — no new emoji, no directional arrows, and ▾/▴ on cards is the deliberate exception.

DailyPlan keeps an embedded copy of `daily.json` for `file://` use. After changing `daily.json`, run:

```bash
node tools/embed-daily-config.mjs
```

The exercise page deliberately has no embedded signed-out routine. Firebase authentication must resolve and a fresh server read must succeed before exercises render.

## Firebase data

DailyPlan ticks remain in `users/{uid}/days/{YYYY-MM-DD}`. Exercise results use the separate path:

```text
users/{uid}/exerciseDays/{YYYY-MM-DD}
```

See `exercise/README.md` for the exercise schema, schedule, synchronization behavior, safe plan changes, tests, and deployment procedure.

The Firebase web config in `shared/firebase-config.js` is public project identification, not an Admin credential. Service-account keys bypass rules and must never be committed. `dailyplan/firebase-config.js` re-exports it for the sections that still import the config through that path.

DailyPlan still stores its independent ticks and optional Priority in one
`users/{uid}/days/{YYYY-MM-DD}` document per date. Signed out, DailyPlan remains local-first;
exercise is different and shows no routine or saved results until authentication and a fresh
server read succeed.

## Firebase setup and security

The one manual prerequisite is the browser-based Firebase CLI login:

```bash
npx -y firebase-tools@latest login
```

`firestore.rules` is the source of truth for deployed access. Exercise days have strict schema
validation; all user collections remain owner-only and unauthenticated access is denied. Deploy
rules from this repository rather than editing them in the console.

The Admin helper in `tools/firebase-admin.mjs` is the preferred way for local maintenance and
reads. Its service-account credentials bypass every rule, are gitignored, and must never be
printed or committed. Private body measurements and photos also stay outside this public repo.

## Validation and deployment

```bash
node --test exercise/*.test.mjs
firebase deploy --only firestore:rules --project claudecode-3bb06
```

The frontend is deployed by the repository's existing GitHub Pages workflow: commit and push the intended static files to GitHub. There is no Firebase Hosting configuration and no Cloud Function.
