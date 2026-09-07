/* Interval tasks — the ones that come back every few days.
 *
 * Microneedling every fortnight, the flowers every three days. The cycle counts
 * from when the task was actually done, so missing a day pushes the next one
 * out rather than keeping to a calendar nobody is following.
 *
 * These exist because the old version worked the answer out by scanning up to
 * ninety days of tick records, and that scan ran against whatever the page
 * happened to be holding. The history load is started after the first day is
 * drawn and never awaited, so the first paint saw nothing and showed every
 * interval task as due — then took it away again when the history landed. The
 * last test here is that one: no day records at all, and the answer still
 * right. It fails on the old code. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn } from "./helpers/browser.mjs";
import { features } from "./helpers/fixtures.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const user = { uid: "uidA", email: "a@example.com" };

/* A routine with one task that comes round every seven days, first due Sep 1. */
const plan = (uid = "uidA") => [`users/${uid}/config/plan`, {
  schemaVersion: 1,
  startDate: "2026-09-01",
  daily: [{ title: "Care", emoji: "✨", items: [
    { id: "c-needling", emoji: "✨", text: "Microneedling", xp: 10,
      every: 7, anchor: "2026-09-01" }
  ] }]
}];

const donеOn = dates => [`users/uidA/config/custom`,
  { added: [], hidden: {}, doneOnce: {}, edits: {}, intervals: { "c-needling": dates } }];

/* One day's worth of tick record, so a run can say "this was ticked then"
   without the page having to have been there. */
const day = (date, ticked) => [`users/uidA/days/${date}`,
  { ticks: ticked ? { "c-needling": true } : {}, xpEarned: ticked ? 10 : 0, ticked: ticked ? 1 : 0 }];

const seed = extra => [plan(), features("uidA", ["dailyplan"], { dailyplan: { intervals: true } }),
                       ...(extra || [])];

/* What the day in view is actually showing, by task text. */
const shown = page => page.evaluate(() =>
  [...document.querySelectorAll("#list .row .txt")].map(el => el.firstChild.textContent.trim()));

const badge = page => page.evaluate(() => {
  const el = document.querySelector("#list .row .carry");
  return el ? el.textContent.trim() : null;
});

async function openOn(date, extra) {
  const { page, problems } = await openPage(browser, site.origin, `/dailyplan/?date=${date}`, {
    user, seed: seed(extra)
  });
  await signIn(page);
  return { page, problems };
}

test("done on the day it was due, it comes back one interval later", { skip }, async () => {
  for (const [date, expected] of [
    ["2026-09-02", false], ["2026-09-05", false], ["2026-09-07", false], ["2026-09-08", true]
  ]) {
    const { page, problems } = await openOn(date, [donеOn(["2026-09-01"]), day("2026-09-01", true)]);
    assert.equal((await shown(page)).includes("Microneedling"), expected,
      `${date}: expected it ${expected ? "on" : "off"} the list`);
    assert.deepEqual(problems, []);
    await page.close();
  }
});

test("missed, it carries forward badged like a task that is still waiting", { skip }, async () => {
  const { page, problems } = await openOn("2026-09-02", [day("2026-09-01", false)]);
  assert.ok((await shown(page)).includes("Microneedling"), "still there the day after it was due");
  assert.equal(await badge(page), "DAY 2");
  await page.close();

  const later = await openOn("2026-09-05", [day("2026-09-01", false)]);
  assert.ok((await shown(later.page)).includes("Microneedling"), "and it keeps waiting");
  assert.equal(await badge(later.page), "DAY 5");
  assert.deepEqual(problems, []);
  await later.page.close();
});

test("the next one counts from the day it was really done, not from when it was due", { skip }, async () => {
  // Due Sep 1, missed, done Sep 2. So the next one is Sep 9, not Sep 8.
  const done = [donеOn(["2026-09-02"]), day("2026-09-01", false), day("2026-09-02", true)];

  const eight = await openOn("2026-09-08", done);
  assert.equal((await shown(eight.page)).includes("Microneedling"), false, "not seven days from due");
  await eight.page.close();

  const nine = await openOn("2026-09-09", done);
  assert.ok((await shown(nine.page)).includes("Microneedling"), "seven days from done");
  assert.deepEqual(nine.problems, []);
  await nine.page.close();
});

test("ticking one leaves it on screen for the rest of the day", { skip }, async () => {
  const { page, problems } = await openOn("2026-09-01");
  assert.ok((await shown(page)).includes("Microneedling"));

  await page.evaluate(() => setTick("c-needling", true));
  await page.waitForTimeout(900);
  assert.ok((await shown(page)).includes("Microneedling"),
    "it does not vanish from under the finger that ticked it");
  assert.equal(await page.evaluate(() => document.querySelector("#list .row").classList.contains("done")), true);

  const written = await page.evaluate(() => globalThis.__MOCK_STORE.get("users/uidA/config/custom"));
  assert.deepEqual(written.intervals["c-needling"], ["2026-09-01"], "the day it was done is recorded");
  assert.deepEqual(problems, []);
  await page.close();
});

test("unticking gives back the completion before it", { skip }, async () => {
  // Done Aug 25 and again Sep 1. Undo Sep 1 and Aug 25 governs again.
  const { page, problems } = await openOn("2026-09-01",
    [donеOn(["2026-08-25", "2026-09-01"]), day("2026-09-01", true)]);

  await page.evaluate(() => setTick("c-needling", false));
  await page.waitForTimeout(900);
  const written = await page.evaluate(() => globalThis.__MOCK_STORE.get("users/uidA/config/custom"));
  assert.deepEqual(written.intervals["c-needling"], ["2026-08-25"],
    "the undone day is taken off, the one before it is not");
  assert.deepEqual(problems, []);
  await page.close();
});

/* The bug. The page draws the day before the ninety-day history has loaded, so
   the old code answered "when was this last done?" with silence and showed
   every interval task as due. Nothing is derived from day records now, so the
   answer holds with none of them present at all. */
test("with no day records loaded, it is still not due", { skip }, async () => {
  const { page, problems } = await openOn("2026-09-02", [donеOn(["2026-09-01"])]);
  assert.equal((await shown(page)).includes("Microneedling"), false,
    "done yesterday, so not due today — whatever else has loaded");
  assert.deepEqual(problems, []);
  await page.close();
});

test("the option to make one is there only for an account given the feature", { skip }, async () => {
  const optionShown = page => page.evaluate(() => {
    const opt = document.getElementById("mEveryOpt");
    return !!opt && getComputedStyle(opt).display !== "none" && !opt.hidden;
  });

  const on = await openOn("2026-09-01");
  await on.page.evaluate(() => openAdd("Care"));
  assert.equal(await optionShown(on.page), true);
  await on.page.close();

  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-09-01", {
    user, seed: [plan(), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  await page.evaluate(() => openAdd("Care"));
  assert.equal(await optionShown(page), false, "off for everybody who has not been given it");
  assert.deepEqual(problems, []);
  await page.close();
});

/* Interval tasks kept no record of their own before this, so the first load
   has to lift what the day records hold — otherwise every cycle restarts from
   today and something done last week comes due again tomorrow. */
test("a cycle already running is picked up from the day records, once", { skip }, async () => {
  const { page, problems } = await openOn("2026-09-03", [day("2026-09-01", true)]);
  await page.waitForTimeout(600);

  const written = await page.evaluate(() => globalThis.__MOCK_STORE.get("users/uidA/config/custom"));
  assert.deepEqual(written.intervals["c-needling"], ["2026-09-01"],
    "the day it was last done becomes its own record");
  assert.equal((await shown(page)).includes("Microneedling"), false,
    "so the cycle carries on rather than starting again");
  assert.deepEqual(problems, []);
  await page.close();
});
