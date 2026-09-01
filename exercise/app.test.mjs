import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

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
  assert.match(app, /readSelectedWeek\("successful exercise write", \{ force: true \}\)/);
  assert.match(app, /readSelectedWeek\("successful workout completion", \{ force: true \}\)/);
});

/* The read that follows a write must not be answered by a read that started
   before it: that one predates the tick and paints the set back off. */
test("the refresh after a write never joins a refresh already running", () => {
  assert.match(app, /async function readSelectedWeek\(reason, \{ force = false \} = \{\}\)/);
  assert.match(app, /if \(!force\) return inFlight\.promise;/);
  assert.match(app, /await inFlight\.promise\.catch\(\(\) => \{\}\);/);
});

/* Two taps in the same second on a day with no document yet both used to be
   told the document already existed, because the local record is written
   optimistically before the first save lands. */
test("saves run in order and choose create or update from the server's answer", () => {
  assert.match(app, /writeChain = writeChain/);
  assert.match(app, /if \(serverDays\.has\(date\)\)/);
  assert.match(app, /serverDays = new Set\(fresh\.keys\(\)\)/);
  // ...and never from the record the page just wrote to itself.
  assert.doesNotMatch(app, /if \(previous\) \{\s*await fb\.updateDoc/);
});

/* A rejected write used to read as a connection fault whatever the cause, and
   RETRY re-read the week instead of re-sending the set — which left it unsaved
   and turned the warning green on the way back. */
test("a rejected set says why and RETRY sends it again", () => {
  assert.match(app, /error\?\.code === "permission-denied"/);
  assert.match(app, /function retryWrite\(\)/);
  assert.match(app, /queueWrite\(exercise, item, previous\)/);
  assert.match(app, /label: "Retry", run: retryWrite/);
  // The strip cannot go back to SYNCED while a set is still unsaved.
  assert.match(app, /if \(unsavedWrite\) \{/);
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
});

/* This used to also assert that "t-workout" existed in dailyplan/daily.json.
   The routine is no longer a file in this repository — it belongs to each
   account, in users/{uid}/config/plan — so there is nothing here to check it
   against. Writing the tick for an account whose routine has no such item is
   harmless: the day document carries it and nothing renders it. */

/* The routine is still being shaped, so a session that stopped early is still
   a session. Nothing about the tally may gate the sign-off. */
test("a workout can be signed off before every set is ticked", () => {
  assert.match(app, /button\.disabled = writePending;/);
  assert.doesNotMatch(app, /!tally\.complete/);
  assert.doesNotMatch(app, /if \(!tallyOf\(routine\)\.complete\) return;/);
  // Signing off having tapped nothing creates the document, and rules require
  // `exercises` on it — but an empty map must never be merged over real sets.
  assert.match(app, /\.\.\.\(serverDays\.has\(date\) \? \{\} : \{ exercises: \{\} \}\)/);
});

test("the page takes its palette from the shared theme rather than redefining it", () => {
  assert.match(html, /<link rel="stylesheet" href="\.\.\/theme\.css">/);
  for (const token of ["--yellow:", "--teal:", "--pink:", "--lime:", "--ink:", "--paper:"]) {
    assert.ok(!html.includes(token),
      `${token} is redefined in exercise/index.html — shared tokens belong in theme.css`);
  }
});
