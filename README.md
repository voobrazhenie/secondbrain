# Second Brain

Small static pages hosted on GitHub Pages, with private cross-device state in Firebase project `claudecode-3bb06`.

Live site: **https://voobrazhenie.github.io/secondbrain/**

## Pages and configuration

- `exercise/` is the authenticated workout-session page. Its plan is `dailyplan/plan.json`; scheduling code and tests live in `exercise/schedule.mjs` and `exercise/schedule.test.mjs`.
- `dailyplan/` is the separate recurring-task checklist. Its routine — the categories, their items, and the date day one is counted from — belongs to whoever is signed in, in `users/{uid}/config/plan`. There is no routine in this repository: a new account opens with an empty list and fills it in.
- `jobs/`, `streams/`, `ideas/`, `finance/`, and `cleaning/` are unrelated features and retain their existing data models. `jobs/` splits its list into UNREAD, CURRENT and NOT RELEVANT: `unread: true` is where a research pass puts everything it finds, so nothing joins the working list until he has read it; `parked: true` on a job doc is Nikita saying no to it, and `.claude/agents/job-scout.md` treats that as permanent so a later research pass never offers the same role twice. `focus: true` is his own highlight, and shows as a pink drag handle.
- `opportunities/` is the private grants / residencies / exhibitions tracker. It is signed-in only — signed-out visitors see a sign-in prompt and no data — and stores one document per entry in `users/{uid}/opportunities/{id}`.
- `firestore.rules` applies strict schema validation to exercise documents while preserving owner-only access for other user data.
- `index.html` is the home page. It is signed-in only: the deck of section buttons is itself a
  statement of what somebody has, so nothing shows until Firebase says who is looking, and then
  only the sections switched on for them in `features/{uid}`. Card order is an account setting in
  `users/{uid}/config/home`.
- `admin/` is the admin front end — black, otherwise the same neo-brutalist system as the app.
  Version 0.1.1 has one section, **Features for users**: pick anyone who has signed in and tick
  the sections they get. A section can carry its own switches, folded away behind a thin
  **Extra settings** bar — DailyPlan has three: the points on each task and the level bar, the
  priority card, and the streaks. It only draws itself for an account listed in `admins/{uid}`;
  what actually stops anyone else is `firestore.rules`.
- `shared/` holds what every synced section needs rather than one of them: `shared/firebase-config.js` is the single copy of the public Firebase config, and `shared/firebase.js` is the sign-in plumbing — connecting, reporting who is signed in, and running sign-in and sign-out. It deliberately owns nothing visible. Each page keeps its own wording, its own status line, and its own decision about what a signed-out visitor sees, because the sections do not agree about that and moving the plumbing must not quietly make them agree. `dailyplan/` reads it; the other sections still carry their own copy and move over one at a time.
- `theme.css` at the repo root is the shared design system: colours, stroke width, shadow, the `.handle` drag grip, the `.crumbs` breadcrumb header, and `--page-width`, the one column width every section uses. Every page links it. `cleaning/` links it for the width, breadcrumb and handle but still overrides the colour tokens with its own `:root` until it is redesigned. The stylesheet also carries the house rules for glyphs — no new emoji, no directional arrows, and ▾/▴ on cards is the deliberate exception.

The exercise page deliberately has no embedded signed-out routine. Firebase authentication must resolve and a fresh server read must succeed before exercises render.

## Firebase data

DailyPlan ticks remain in `users/{uid}/days/{YYYY-MM-DD}`. Exercise results use the separate path:

```text
users/{uid}/exerciseDays/{YYYY-MM-DD}
```

See `exercise/README.md` for the exercise schema, schedule, synchronization behavior, safe plan changes, tests, and deployment procedure.

The Firebase web config in `shared/firebase-config.js` is public project identification, not an Admin credential. Service-account keys bypass rules and must never be committed. `dailyplan/firebase-config.js` re-exports it for the sections that still import the config through that path.

DailyPlan stores its routine — the categories, their items, and the start date day one is
counted from — in `users/{uid}/config/plan`, which always has a **To do** category whether or not
one is stored, because a page with nowhere to put a new task is a dead end; its ticks and optional Priority in one
`users/{uid}/days/{YYYY-MM-DD}` document per date; its added and hidden tasks in
`users/{uid}/config/custom`; and which sections are folded up plus the detail-notes toggle in
`users/{uid}/config/prefs`. Like exercise, it shows nothing until someone is signed in.

**The routine belongs to the account, not to this repository.** It used to be `dailyplan/daily.json`,
mirrored into `index.html` as a `FALLBACK` constant, which meant any account signing in was shown
Nikita's medication and his weed tracker — and that the same list sat in a public repository. Both
files are gone. An account with no routine gets an empty one written for it, dated the day it first
signs in: no categories, no items, day one today, and the add button to fill it in. Removing the
file does not remove it from this repository's history.

**Nothing about a day, a task or an account is kept in the browser.** DailyPlan used to mirror
all of the above into `localStorage`, filed by date with no account in the key, which meant the
next person to sign in on the same browser was shown the previous one's day — and, where their
own account had no document yet, uploaded it into theirs. Everything now lives in memory while
the page is open and in Firestore between visits. Firebase's own offline cache still keeps a
copy on the device, which is what makes the page work with no signal; that cache is filed under
the document path, so it can never be handed to another account, and `shared/firebase.js`
clears it on sign-out. The page also wipes the old `localStorage` keys once, on load.

Ideas, Streams and Finance still keep a browser copy and still work signed out. The same
treatment is worth giving them, but some of what is in those pages may exist only in a browser
and has to reach Firestore before the local copy is removed.

### Accounts, admins and features

Three small collections sit outside `users/{uid}/`:

```text
admins/{uid}     marker document — who may use admin/
profiles/{uid}   { email, name, lastSeen } — written by that person's own page
features/{uid}   { sections: { key: bool }, extras: { section: { key: bool } } } — admin only
features/default the settings an account gets before anybody has decided about it
```

`profiles/` is what lets the admin pages list anybody at all. Each page writes its own on
sign-in, from what Google already returned, so signing in asks for nothing it did not ask for
before. `features/` is deliberately **not** under `users/{uid}/config/`: the owner-writes-anything
rule there would let a person switch their own sections back on. An account with no `features/`
document reads through to `features/default`, which sits first in the admin dropdown and is
edited with the same checkboxes as a person. Nothing is copied on sign-in: changing the default
changes what everybody still on it gets, rather than only whoever signs in next. Where there is no
default either, an account sees no sections — an invitation is a decision, not an accident. `extras` default the other
way, to on: a missing section means "not invited yet", but a missing extra just means nobody has
been through the extra settings, and the answer to that is the page as it has always looked.
DailyPlan reads its own three and hides the points, the priority card or the streaks accordingly —
display only, so the points are still counted and the streak still recorded, and switching one back
on shows the real number rather than starting again from zero. The list of sections and their extras
is `shared/sections.js`, read by both the home page and the admin pages; a `key` there is what gets
stored, so it must not change once something has been switched on for somebody.

Admins are added by hand — `firestore.rules` refuses every write to `admins/`, including from an
admin, so the only routes in are the Firebase console and `tools/firebase-admin.mjs`.

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
node --test exercise/*.test.mjs        # or: npm test
node tools/rules-check.mjs             # evaluates firestore.rules against the live API
node tools/rules-deploy.mjs            # publishes it; --dry-run uploads without releasing
```

`tools/rules-deploy.mjs` exists because the Firebase CLI needs a browser login that a cloud
session does not have; it uses the same service-account credentials as everything else here.
`firebase deploy --only firestore:rules --project claudecode-3bb06` does the same thing locally.
Run the check first — a bad ruleset is live the moment it is released.

The frontend is deployed by the repository's existing GitHub Pages workflow: commit and push the intended static files to GitHub. There is no Firebase Hosting configuration and no Cloud Function.
