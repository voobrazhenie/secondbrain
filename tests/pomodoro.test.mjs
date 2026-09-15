/* Pomodoro: thirty minutes at the desk, five on your feet.
 *
 * The rule the page exists to hold is that nothing starts itself. A round ends,
 * it says so, and the next one waits — a timer that rolls straight on takes the
 * decision to get up away from you, which is the whole point of it. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, painted, stored } from "./helpers/browser.mjs";
import { features } from "./helpers/fixtures.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const open = (seed = [features("uidA", ["pomodoro"])]) =>
  openPage(browser, site.origin, "/pomodoro/", { user: { uid: "uidA", email: "a@example.com" }, seed });

const clock = page => page.evaluate(() => ({
  label: document.getElementById("clockLabel").textContent,
  time: document.getElementById("clockTime").textContent,
  colour: document.getElementById("clock").className,
  stopShowing: !document.getElementById("stopBtn").hidden
}));

/* Ends the round now instead of waiting half an hour for it. */
const runOut = async page => {
  await page.evaluate(() => { endsAt = Date.now() + 200; });
  await page.waitForTimeout(1500);
};

test("nothing of the timer is on screen until an account is known", { skip }, async () => {
  const { page, problems } = await open();
  assert.equal(await painted(page, ".clock"), false);
  assert.equal(await painted(page, ".starts"), false);
  assert.equal(await painted(page, "#authBtn"), true, "a way in is the one thing that shows");

  await signIn(page);
  assert.equal(await painted(page, ".clock"), true);
  assert.equal(await painted(page, "#sync"), false, "nothing at the bottom once it is working");
  assert.deepEqual(problems, []);
});

test("thirty minutes starts, counts down, and can be stopped", { skip }, async () => {
  const { page, problems } = await open();
  await signIn(page);
  assert.deepEqual(await clock(page), {
    label: "READY", time: "30:00", colour: "clock", stopShowing: false });

  await page.click("#startFocus");
  await page.waitForTimeout(1200);
  const going = await clock(page);
  assert.equal(going.label, "FOCUS");
  assert.equal(going.colour, "clock focus");
  assert.equal(going.stopShowing, true);
  assert.match(going.time, /^29:5\d$/, "counting down from thirty");

  await page.click("#stopBtn");
  await page.waitForTimeout(400);
  assert.deepEqual(await clock(page), {
    label: "READY", time: "30:00", colour: "clock", stopShowing: false });
  assert.deepEqual(problems, []);
});

test("a round that runs out stops there and does not start the other one", { skip }, async () => {
  const { page, problems } = await open();
  await signIn(page);
  await page.click("#startFocus");
  await page.waitForTimeout(400);
  await runOut(page);

  const done = await clock(page);
  assert.equal(done.label, "TIME");
  assert.equal(done.time, "0:00");
  assert.equal(done.colour, "clock rang", "it shouts, rather than quietly resetting");
  assert.equal(done.stopShowing, false, "there is nothing left running to stop");
  assert.match(await page.textContent("#clockSay"), /get up and move/i);

  // Half a minute on, it is still waiting for you rather than counting again.
  await page.waitForTimeout(1500);
  assert.equal((await clock(page)).label, "TIME");

  await page.click("#startMove");
  await page.waitForTimeout(1400);   // the first second still reads 5:00, by design
  const moving = await clock(page);
  assert.equal(moving.label, "MOVING");
  assert.equal(moving.colour, "clock move");
  assert.match(moving.time, /^4:5\d$/);
  assert.deepEqual(problems, []);
});

test("the running round belongs to the account, so a reload picks it up", { skip }, async () => {
  const { page, problems } = await open();
  await signIn(page);
  await page.click("#startMove");
  await page.waitForTimeout(1400);

  const saved = await stored(page, "users/uidA/config/pomodoro");
  assert.equal(saved.round, "move");
  assert.ok(saved.endsAt > Date.now(), "the end time is stored, not a number counting down");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await signIn(page);
  const back = await clock(page);
  assert.equal(back.label, "MOVING");
  assert.equal(back.stopShowing, true);
  assert.match(back.time, /^4:5\d$/, "and it kept running while the page was gone");
  assert.deepEqual(problems, []);
});

test("a round that ran out while the page was away comes back as the end, not as a reset", { skip }, async () => {
  const { page, problems } = await open([
    features("uidA", ["pomodoro"]),
    // Stored while a focus round was running; it ended before the page opened.
    ["users/uidA/config/pomodoro", { round: "focus", endsAt: Date.now() - 60000, rang: "" }]
  ]);
  await signIn(page);
  const seen = await clock(page);
  assert.equal(seen.label, "TIME");
  assert.equal(seen.colour, "clock rang");
  assert.deepEqual(problems, []);
});
