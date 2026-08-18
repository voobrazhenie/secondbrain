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
  assert.match(app, /readSelectedWeek\("successful exercise write"\)/);
  assert.match(app, /readSelectedWeek\("successful workout completion"\)/);
});

test("date navigation and exact rest-day copy are present", () => {
  assert.match(html, />Previous day</);
  assert.match(html, />Today</);
  assert.match(html, />Next day</);
  assert.match(app, /rest\.textContent = "This is a rest day"/);
  assert.match(app, /url\.searchParams\.set\("date", selectedDate\)/);
});

test("future workouts are rendered as read-only planned previews", () => {
  assert.match(app, /day\.status === "planned-workout"/);
  assert.match(app, /Planned preview · no results can be entered for a future date/);
  assert.match(app, /const editable = day\.status === "workout" && selectedDate === berlinDate\(\)/);
});
