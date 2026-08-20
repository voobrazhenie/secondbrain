/* The routine is duplicated across three files that must agree: the plan
   itself, the size app.js validates it against, and the id allowlist in
   firestore.rules. Nothing used to check that. An eighth exercise passed every
   test and then failed twice at runtime — the page threw "Unsupported exercise
   plan", and Firestore rejected the write for naming an unknown id.

   These tests read the real files rather than fixtures, so the next routine
   edit fails here instead of in the browser. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const plan = JSON.parse(readFileSync(join(ROOT, "dailyplan", "plan.json"), "utf8"));
const appSource = readFileSync(join(HERE, "app.js"), "utf8");
const rulesSource = readFileSync(join(ROOT, "firestore.rules"), "utf8");

const numberFrom = (source, name) => {
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(match, `${name} not found in app.js`);
  return Number(match[1]);
};

/* The ids the rules will accept: the single hasOnly([...]) list. */
const allowedIds = (() => {
  // Anchored on data.exercises specifically — the file has two other
  // hasOnly() lists (the document's own keys, and {sets, completed}).
  const block = rulesSource.match(/data\.exercises\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "exercise id allowlist not found in firestore.rules");
  return block[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
})();

test("every exercise in the plan is one firestore.rules will accept", () => {
  for (const exercise of plan.routine) {
    assert.ok(allowedIds.includes(exercise.id),
      `${exercise.id} is in plan.json but not in firestore.rules — the write would be rejected`);
  }
});

test("every allowed id is also validated individually, not just permitted", () => {
  for (const id of allowedIds) {
    assert.ok(rulesSource.includes(`validExercise(data.exercises, '${id}')`),
      `${id} is allowed by firestore.rules but its shape is never checked`);
  }
});

test("retired exercises stay allowed so old records can still be signed off", () => {
  // Signing off merges into the existing document and rules validate the
  // merged result, so an id that has left the routine must not leave the rules.
  for (const id of ["push-ups", "glute-bridges"]) {
    assert.ok(allowedIds.includes(id),
      `${id} was dropped from firestore.rules — days recorded under it can no longer be completed`);
  }
});

test("the plan is the size app.js expects", () => {
  assert.equal(plan.routine.length, numberFrom(appSource, "ROUTINE_SIZE"));
});

test("plan, app and rules agree on the version", () => {
  const planVersion = numberFrom(appSource, "PLAN_VERSION");
  assert.equal(plan.schemaVersion, planVersion);
  assert.ok(rulesSource.includes(`data.planVersion == ${planVersion}`),
    `firestore.rules pins a different planVersion than app.js's ${planVersion}`);
});

test("exercise ids are unique", () => {
  const ids = plan.routine.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every exercise has a usable name, set count and rep target", () => {
  for (const exercise of plan.routine) {
    assert.match(exercise.id, /^[a-z][a-z0-9-]*$/, `${exercise.id} is not a plain lowercase id`);
    assert.ok(exercise.name && typeof exercise.name === "string", `${exercise.id} has no name`);
    // firestore.rules hard-codes three sets per exercise.
    assert.equal(exercise.sets, 3, `${exercise.id} would be rejected: rules require exactly 3 sets`);

    const reps = exercise.repetitions;
    assert.ok(reps && typeof reps === "object", `${exercise.id} has no repetitions`);
    const fixed = "target" in reps;
    const ranged = "min" in reps || "max" in reps;
    assert.ok(fixed !== ranged, `${exercise.id} must have either a target or a min/max, not both or neither`);
    if (fixed) {
      assert.ok(Number.isInteger(reps.target) && reps.target > 0, `${exercise.id} has a bad target`);
    } else {
      assert.ok(Number.isInteger(reps.min) && Number.isInteger(reps.max), `${exercise.id} has a non-integer range`);
      assert.ok(reps.min > 0 && reps.min < reps.max, `${exercise.id} has an empty or inverted range`);
    }
  }
});

test("the timezone app.js insists on is the one the plan declares", () => {
  assert.equal(plan.timezone, "Europe/Berlin");
  assert.ok(appSource.includes('value.timezone !== "Europe/Berlin"'));
});
