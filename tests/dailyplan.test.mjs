/* DailyPlan: whose routine it draws, and which parts of it this account gets.
 *
 * The routine used to be a file in this repository, which meant every account
 * that signed in was shown one person's medication. It belongs to the account
 * now, and an account without one opens on an empty list it can fill. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, signOut, painted, paintedAll, stored } from "./helpers/browser.mjs";
import { plan, features, routine } from "./helpers/fixtures.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

/* The rendered category names, read off the header's own label rather than the
   whole strip, which also carries the chevron, the tally and the add button. */
const groups = page => page.evaluate(() => [...document.querySelectorAll("#list .sec .t")]
  .map(el => el.textContent.trim()));
const rowCount = page => page.evaluate(() => document.querySelectorAll("#list .row").length);

test("the routine comes from the account", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#list .row").length), 3);
  assert.equal(await page.evaluate(() => dailyConfig.startDate), "2026-01-01");
  assert.deepEqual(await groups(page), ["TO DO", "MEDS", "RECOVER"]);
  assert.deepEqual(problems, []);
});

test("an account with no routine opens on an empty To do list, not on somebody else's", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidNEW", email: "new@example.com" },
    seed: [features("uidNEW", ["dailyplan"])]
  });
  await signIn(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#list .row").length), 0);
  assert.deepEqual(await groups(page), ["TO DO"],
    "one category, To do, with the add button in it");

  const written = await stored(page, "users/uidNEW/config/plan");
  assert.deepEqual(written.daily.map(g => g.title), ["To do"]);
  assert.equal(written.startDate.length, 10, "day one is the day they first signed in");
  assert.deepEqual(problems, []);
});

test("every routine has a To do category, even one stored without it", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  assert.deepEqual(await page.evaluate(() => dailyConfig.daily.map(g => g.title)),
    ["To do", "Meds", "Recover"]);
});

test("the extra settings hide the points, the priority card and the streaks", { skip }, async () => {
  const on = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(on.page);
  assert.equal(await paintedAll(on.page, "#list .pill") > 0, true);
  assert.equal(await painted(on.page, "#level"), true);
  assert.equal(await painted(on.page, "#priorityWrap"), true);
  assert.equal(await painted(on.page, "#streaks"), true);
  assert.equal(await painted(on.page, "#streak"), true);

  const off = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"),
      features("uidA", ["dailyplan"], { dailyplan: { xp: false, priority: false, streaks: false } })]
  });
  await signIn(off.page);
  assert.equal(await rowCount(off.page), 3, "the tasks themselves are untouched");
  assert.equal(await paintedAll(off.page, "#list .pill"), 0);
  assert.equal(await painted(off.page, "#level"), false);
  assert.equal(await painted(off.page, "#priorityWrap"), false);
  assert.equal(await painted(off.page, "#streaks"), false);
  assert.equal(await painted(off.page, "#streak"), false, "the chip in the top bar goes too");
});


test("folded sections come back from the account, not from the device", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  await page.evaluate(() => toggleGroup("Recover"));
  await page.waitForTimeout(1000);
  assert.deepEqual((await stored(page, "users/uidA/config/prefs")).collapsed, ["Recover"]);

  await signOut(page);
  assert.deepEqual(await page.evaluate(() => [...collapsedGroups]), []);
  await signIn(page);
  assert.deepEqual(await page.evaluate(() => [...collapsedGroups]), ["Recover"]);
});
