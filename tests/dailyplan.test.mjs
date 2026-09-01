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

/* Three kinds of added task, and the one that matters most is the default: a
   list that carries everything forward stops being a list of today. */
test("a task added for today is gone tomorrow; a routine and a carried one are not", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);

  const addTo = async (group, text, how) => {
    await page.evaluate(g => openAdd(g), group);
    if (how !== undefined) await page.selectOption("#mScope", how);
    await page.fill("#mText", text);
    await page.click("#mSave");
    await page.waitForTimeout(500);
  };
  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll("#list .row .t, #list .row .txt, #list .row")].map(e => e.textContent.trim()));
  const showing = async text => (await rows()).some(t => t.includes(text));

  await page.evaluate(() => openAdd("To do"));
  assert.equal(await page.evaluate(() => document.getElementById("mScope").value), "today",
    "Just today is what the form opens on");
  await page.click("#mCancel");

  await addTo("To do", "Buy milk");                 // default: just today
  await addTo("To do", "Stretch", "daily");
  await addTo("To do", "Call the bank", "carry");
  assert.equal(await showing("Buy milk"), true);
  assert.equal(await showing("Stretch"), true);
  assert.equal(await showing("Call the bank"), true);

  await page.click("#dayNext");
  await page.waitForTimeout(900);
  assert.equal(await showing("Buy milk"), false, "gone tomorrow, ticked or not");
  assert.equal(await showing("Stretch"), true, "a routine task is on every day");
  assert.equal(await showing("Call the bank"), true, "a carried task stays until it is done");
  assert.deepEqual(problems, []);
});

test("the add form says Add task, and drops the XP field when points are off", { skip }, async () => {
  const withPoints = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(withPoints.page);
  await withPoints.page.evaluate(() => openAdd("To do"));
  assert.equal(await withPoints.page.evaluate(() => document.getElementById("mTitle").textContent), "ADD TASK",
    "not ADD TO TO DO — the group is whichever plus was tapped");
  assert.equal(await painted(withPoints.page, "#mXpWrap"), true);

  const without = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"),
      features("uidA", ["dailyplan"], { dailyplan: { xp: false, priority: true, streaks: true } })]
  });
  await signIn(without.page);
  await without.page.evaluate(() => openAdd("To do"));
  assert.equal(await painted(without.page, "#mXpWrap"), false);
  assert.equal(await painted(without.page, "#mEmoji"), true, "the icon field stays");
  assert.deepEqual(without.problems, []);
});
