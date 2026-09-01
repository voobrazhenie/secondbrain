/* Two people, one browser.
 *
 * The bug these exist for: DailyPlan mirrored the day, the points and the task
 * list into localStorage, filed by date with no account anywhere in the key.
 * Signing out deliberately left it, so the next account to sign in was shown
 * the previous one's day — and, having no document of its own yet, uploaded it
 * into theirs. It was found in Firestore, not in a test. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, signOut, stored, storedPaths } from "./helpers/browser.mjs";
import { plan, features, routine } from "./helpers/fixtures.mjs";

/* Launched here rather than in a before() hook: node:test reads a test's skip
   option when the test is declared, which happens before any hook runs. */
const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const seed = [
  plan("uidA"), features("uidA", ["dailyplan"]),
  plan("uidB", routine()), features("uidB", ["dailyplan"])
];

test("a second account sees nothing of the first, and writes nothing of theirs", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" }, seed
  });

  await signIn(page);
  await page.evaluate(() => { setTick("m-one", true); setTick("m-two", true); toggleGroup("Recover"); });
  await page.waitForTimeout(1200);

  const dayPath = (await storedPaths(page)).find(p => p.startsWith("users/uidA/days/"));
  assert.ok(dayPath, "account A's ticks were written under account A");
  assert.equal(Object.keys((await stored(page, dayPath)).ticks).length, 2);

  await signOut(page);
  await page.evaluate(() => { globalThis.__MOCK_USER = { uid: "uidB", email: "b@example.com" }; });
  await signIn(page);

  assert.deepEqual(await page.evaluate(() => Object.keys(loadTicks(plan.date))), [],
    "account B's day starts empty");
  assert.deepEqual(await page.evaluate(() => [...collapsedGroups]), [],
    "account B does not inherit A's folded sections");

  const bDay = (await storedPaths(page)).find(p => p.startsWith("users/uidB/days/"));
  assert.deepEqual(Object.keys((await stored(page, bDay)).ticks || {}), [],
    "nothing of A's was uploaded into B's account");
  assert.deepEqual(problems, []);
});

test("nothing of the app is left in the browser, and old keys are cleared", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed,
    localStorage: {
      "secondbrain.dailyplan.v2.2026-09-01": JSON.stringify({ "m-one": true }),
      "secondbrain.fitness.xppeak": "1203",
      "secondbrain.fitness.collapsed": JSON.stringify(["Recover"]),
      "unrelated.key": "left alone"
    }
  });

  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ["unrelated.key"],
    "the keys the old version wrote are cleared on load; anything else is not");

  await signIn(page);
  await page.evaluate(() => setTick("m-one", true));
  await page.waitForTimeout(900);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ["unrelated.key"],
    "using the page writes nothing to the device");
  assert.deepEqual(problems, []);
});

test("signing out clears Firebase's own cache", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" }, seed
  });
  await signIn(page);
  await signOut(page);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("__mockCacheCleared")), "1");
});
