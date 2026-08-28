# Second Brain — working notes

## How to talk to me

Nikita is not a technical reader. Keep replies **short and plain**.

- Aim for **500 characters or less** when wrapping up a piece of work.
- Go past **1,000 characters only** if he asks for a report, or if there is a
  genuine reason the extra length earns its place.
- Say what changed and anything he actually has to decide. Skip the rest:
  file paths, function names, test counts, commit hashes, and play-by-play of
  how the work went. He can ask if he wants detail.
- Flag real trade-offs and things left undone — briefly, in his words, not in
  implementation terms.

## Reading and writing his data

His data lives in Firestore under `users/{uid}/`, in these collections:
`config`, `days`, `exerciseDays`, `jobs`, `jobsMeta`, `xp`. Project
`claudecode-3bb06`, uid `Ecg4WsCTG0QDwvcCkzx3144Avps2`.

Use `tools/firebase-admin.mjs`:

```js
import { connect } from "./tools/firebase-admin.mjs";
const db = await connect();
await db.get("users/UID/jobsMeta/overview");   // one doc, or null
await db.list("users/UID/jobs");               // whole collection
await db.patch("users/UID/jobs/some-id", {});  // merge; other fields untouched
await db.remove("users/UID/jobs/some-id");     // delete a document
```

It authenticates itself: cloud sessions read the `FIREBASE_SA_EMAIL` and
`FIREBASE_SA_KEY` environment variables, local runs fall back to
`tools/service-account.json`. Nothing to configure per session.

`patch` merges rather than replaces, which is what keeps a refresh from wiping
fields the page owns — a job's `status` and `notes` are his, tracked by hand.

These are Admin credentials and bypass `firestore.rules` entirely, so the rules
give no protection against a mistake here. Read before overwriting, and never
print the key or commit it.

## Network in cloud sessions

Cloud sessions (claude.ai/code) do reach the open web, but not by every route,
so check before concluding a site is unreachable:

- **`curl` works** for most job boards and ATS APIs. Greenhouse, Lever, Ashby
  and SmartRecruiters all answer their public board endpoints, which is the
  reliable way to confirm a posting is still open.
- **`WebFetch` is blocked** for those same domains by the egress proxy, and
  says so explicitly. `WebSearch` works, and is how to find candidates.
- **Some sites refuse this network in particular.** Epic and GitHub answer
  `curl` with 403; Workable and Personio answer with a Cloudflare 429 for the
  shared address. Those need another route — Epic's postings are readable
  through the Greenhouse API — or an honest "not re-checked" note on the card.

So `job-scout` can run here, as long as the handful of employers that stay
unverifiable are marked as such rather than assumed live.
