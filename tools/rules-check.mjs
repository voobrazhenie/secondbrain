/* Runs firestore.rules through the Firebase Rules simulator.
 *
 * This is a dry run: the API evaluates a ruleset against a made-up request and
 * returns SUCCESS or FAILURE. Nothing is written and nothing is deployed.
 *
 * It exists because the unit tests cannot catch the failure that prompted it.
 * Rules are capped at 1000 evaluated expressions per request, and the previous
 * ruleset validated all ten allowed exercises on every write, so the cost grew
 * with the size of the stored day. At six exercises a single tapped set was
 * rejected. Every file-level test still passed. Only evaluating the rules finds
 * that, so the heavy cases below use a full day rather than a small fixture.
 *
 *   node tools/rules-check.mjs                 # the rules in this repo
 *   node tools/rules-check.mjs --live          # the ruleset serving traffic
 *   node tools/rules-check.mjs path/to.rules   # some other file
 *
 * Needs the service-account credentials and network access, so it is not part
 * of `npm test`. Exits non-zero if any case does not match its expectation.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCredentials, accessToken } from "./firebase-admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const UID = "Ecg4WsCTG0QDwvcCkzx3144Avps2";
const DATE = "2026-08-24";
const NOW = "2026-08-24T12:00:00Z";
const pathFor = uid => `/databases/(default)/documents/users/${uid}/exerciseDays/${DATE}`;

/* The eight-exercise routine, plus the two retired ids: the largest document
 * the rules ever have to accept. */
const ROUTINE = [
  "decline-push-ups", "pike-push-ups", "chair-dips", "diamond-push-ups",
  "prone-rows", "single-leg-glute-bridges", "single-leg-romanian-deadlifts", "leg-raises"
];
const RETIRED = ["push-ups", "glute-bridges"];

const entry = (reps, done) => ({ sets: [reps, reps, reps], done, completed: done.every(Boolean) });
const finished = ids => Object.fromEntries(ids.map(id => [id, entry(12, [true, true, true])]));

const day = (exercises, extra = {}) => ({
  date: DATE, planVersion: 2, workoutCompleted: false, updatedAt: NOW, exercises, ...extra
});

const full = finished(ROUTINE);
const everyId = finished([...ROUTINE, ...RETIRED]);
const stored = exercises => ({ ...day(exercises), updatedAt: "2026-08-24T10:20:27Z" });

/* Old days carry `sets` and `completed` and no `done`, and must stay writable. */
const legacy = { ...full, "prone-rows": { sets: [15, 15, 15], completed: true } };

const cases = [
  ["ALLOW", "tick a set on a day holding all eight exercises", "update", UID, stored(full),
    day({ ...full, "leg-raises": entry(15, [true, true, false]) })],
  ["ALLOW", "tick a set with every allowed id present", "update", UID, stored(everyId),
    day({ ...everyId, "leg-raises": entry(15, [true, true, false]) })],
  ["ALLOW", "tick a set on a day that still has a pre-`done` entry", "update", UID, stored(legacy),
    day({ ...legacy, "leg-raises": entry(15, [true, false, false]) })],
  ["ALLOW", "sign off a full day", "update", UID, stored(full),
    day(full, { workoutCompleted: true })],
  ["ALLOW", "sign off part-way through", "update", UID, stored(full),
    day({ ...full, "leg-raises": entry(15, [true, false, false]) }, { workoutCompleted: true })],
  ["ALLOW", "sign off with nothing recorded at all", "create", UID, null,
    day({}, { workoutCompleted: true })],
  ["ALLOW", "the first tap of the day creates the document", "create", UID, null,
    day({ "decline-push-ups": entry(12, [true, false, false]) })],

  ["DENY", "a malformed done list", "update", UID, stored(full),
    day({ ...full, "leg-raises": { sets: [15, 15, 15], done: [true, "yes", false], completed: false } })],
  ["DENY", "an unknown exercise id", "update", UID, stored(full),
    day({ ...full, "burpees": entry(10, [true, false, false]) })],
  ["DENY", "zero repetitions", "update", UID, stored(full),
    day({ ...full, "leg-raises": entry(0, [true, false, false]) })],
  ["DENY", "an extra field inside an entry", "update", UID, stored(full),
    day({ ...full, "leg-raises": { sets: [15, 15, 15], done: [true, false, false], completed: false, rpe: 8 } })],
  ["DENY", "an extra field on the document", "update", UID, stored(full),
    { ...day(full), streak: 3 }],
  ["DENY", "another account's day", "update", "someone-else", stored(full),
    day({ ...full, "leg-raises": entry(15, [true, true, false]) })],
  ["DENY", "the wrong plan version", "update", UID, stored(full),
    { ...day(full), planVersion: 3 }],
  ["DENY", "a client-chosen updatedAt", "update", UID, stored(full),
    { ...day({ ...full, "leg-raises": entry(15, [true, true, false]) }), updatedAt: "2026-08-24T11:00:00Z" }]
];

async function liveSource(token, projectId) {
  const headers = { Authorization: `Bearer ${token}` };
  const releases = await (await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`, { headers })).json();
  const release = (releases.releases || []).find(r => r.name.endsWith("cloud.firestore"));
  if (!release) throw new Error("No cloud.firestore release on this project.");
  const ruleset = await (await fetch(
    `https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers })).json();
  return { content: ruleset.source.files[0].content, label: `live ruleset ${release.rulesetName.split("/").pop()}` };
}

const argument = process.argv[2];
const sa = await loadCredentials();
const token = await accessToken(sa, SCOPE);

const { content, label } = argument === "--live"
  ? await liveSource(token, sa.project_id)
  : { content: await readFile(argument || join(ROOT, "firestore.rules"), "utf8"),
      label: argument || "firestore.rules" };

const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}:test`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    source: { files: [{ name: "firestore.rules", content }] },
    testSuite: {
      testCases: cases.map(([expectation, , method, uid, existing, data]) => ({
        expectation,
        request: {
          auth: { uid: UID, token: { email: "voobrazhenie@gmail.com" } },
          method,
          path: pathFor(uid),
          time: NOW,
          resource: { data }
        },
        ...(existing ? { resource: { data: existing } } : {}),
        pathEncoding: "URL_ENCODED",
        expressionReportLevel: "VISITED"
      }))
    }
  })
});

const body = await response.json();
if (!response.ok) {
  console.error(`Rules simulator refused the request: ${response.status}`);
  console.error(JSON.stringify(body).slice(0, 1000));
  process.exit(2);
}
if (body.issues?.length) {
  console.error(`${label} does not compile:`);
  for (const issue of body.issues) console.error(`  ${issue.sourcePosition?.line}: ${issue.description}`);
  process.exit(2);
}

console.log(`${label}\n`);
let failed = 0;
(body.testResults || []).forEach((result, index) => {
  const [expectation, description] = cases[index];
  const ok = result.state === "SUCCESS";
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${expectation.padEnd(5)} ${description}`);
  if (!ok && result.debugMessages?.length) {
    console.log(`         ${result.debugMessages.join(" | ").slice(0, 300)}`);
  }
});
console.log(`\n${cases.length - failed}/${cases.length} cases as expected.`);
process.exit(failed ? 1 : 0);
