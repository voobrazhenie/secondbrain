import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const daily = JSON.parse(await readFile(new URL("../dailyplan/daily.json", import.meta.url), "utf8"));

test("exercise synchronization is server-only and has no live listener or browser fallback", () => {
  assert.match(app, /getDocsFromServer/);
  assert.match(app, /getDocFromServer/);
  assert.doesNotMatch(app, /onSnapshot/);
  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(app, /persistentLocalCache/);
});

test("authentication gates rendering and sign-out clears exercise state immediately", () => {
  assert.match(app, /if \(!authResolved\)/);
  assert.match(app, /if \(!user\)/);
  assert.match(app, /function clearExerciseData\(\)/);
  assert.match(app, /user = null;\s+clearExerciseData\(\);\s+renderSignedOut\(\)/);
  assert.match(app, /onAuthStateChanged/);
  assert.match(app, /readSelectedWeek\("authentication resolved"\)/);
});

test("writes use nested exercise fields and re-read the selected week", () => {
  assert.match(app, /new fb\.FieldPath\("exercises", exercise\.id\)/);
  assert.match(app, /serverTimestamp\(\)/);
  assert.match(app, /readSelectedWeek\("successful exercise write"\)/);
  assert.match(app, /readSelectedWeek\("successful workout completion"\)/);
});

test("date navigation writes the selected date to the query string", () => {
  assert.match(app, /url\.searchParams\.set\("date", selectedDate\)/);
  assert.match(app, /aria-label", "Previous day"/);
  assert.match(app, /aria-label", "Next day"/);
});

test("rest days say exactly the agreed sentence", () => {
  assert.match(app, /rest\.textContent = "This is a rest day"/);
});

test("future workouts are rendered as read-only planned previews", () => {
  assert.match(app, /day\.status === "planned-workout"/);
  assert.match(app, /PLANNED PREVIEW · NO RESULTS CAN BE ENTERED FOR A FUTURE DATE/);
  assert.match(app, /const editable = day\.status === "workout" && selectedDate === today/);
});

/* The interaction the redesign is built around. A tile is a button that toggles
   on tap and opens the repetition editor on a long press; there are no typed
   number fields sitting in the routine and no per-exercise save button. */
test("a set is completed by tapping and edited by holding", () => {
  assert.match(app, /const HOLD_MS = 520;/);
  assert.match(app, /function toggleSet\(exercise, index\)/);
  assert.match(app, /pointerdown/);
  assert.match(app, /"pointerup", "pointercancel", "pointerleave"/);
  assert.match(app, /contextmenu/);
  // The press that opened the editor must not also toggle the set.
  assert.match(app, /if \(held\) \{ held = false; return; \}/);
  // ...and a fresh press must clear the flag, or the next tap is swallowed.
  assert.match(app, /cancelHold\(\);\s+held = false;/);
});

test("every set carries its own done flag, and old days without one still read", () => {
  assert.match(app, /done: item\.done/);
  assert.match(app, /Array\.isArray\(stored\?\.done\)/);
  assert.match(app, /stored\?\.completed === true/);
  // Completion is derived from the three flags, never tracked separately.
  assert.match(app, /completed: item\.done\.every\(Boolean\)/);
});

test("set tiles start at the top of the plan's range", () => {
  assert.match(app, /exercise\.repetitions\.target \?\? exercise\.repetitions\.max/);
});

test("the rest timer runs between sets and between exercises, and is never persisted", () => {
  assert.match(app, /const REST_SECONDS = 60;/);
  assert.match(app, /const TRANSITION_SECONDS = 90;/);
  assert.match(app, /SESSION COMPLETE/);
  // The timer is built per render rather than sitting in the shell: it only
  // exists on a day that is actually editable.
  assert.match(app, /plus\.textContent = "\+30S"/);
  assert.match(app, /skip\.textContent = "SKIP"/);
  // A timer that outlived a reload would be counting rest already taken.
  assert.doesNotMatch(app, /timer[^\n]*localStorage/);
});

test("signing off ticks Physical training on the DailyPlan day", () => {
  assert.match(app, /const DAILY_TICK_ID = "t-workout";/);
  assert.match(app, /async function tickDailyPlan\(uid\)/);
  assert.match(app, /"users", uid, "days", selectedDate/);
  assert.match(app, /ticks: \{ \[DAILY_TICK_ID\]: true \}/);

  const ids = daily.daily.flatMap(group => group.items.map(item => item.id));
  assert.ok(ids.includes("t-workout"),
    "t-workout is written by the exercise page but does not exist in dailyplan/daily.json");
});

test("the sign-off button is locked until every set is ticked", () => {
  assert.match(app, /button\.disabled = !tally\.complete \|\| writePending/);
  assert.match(app, /if \(!tallyOf\(routine\)\.complete\) return;/);
});

test("the page takes its palette from the shared theme rather than redefining it", () => {
  assert.match(html, /<link rel="stylesheet" href="\.\.\/theme\.css">/);
  for (const token of ["--yellow:", "--teal:", "--pink:", "--lime:", "--ink:", "--paper:"]) {
    assert.ok(!html.includes(token),
      `${token} is redefined in exercise/index.html — shared tokens belong in theme.css`);
  }
});
