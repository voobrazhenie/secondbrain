/* admin/ — who may open it, who it lists, and what it writes.
 *
 * What is drawn here is a courtesy; firestore.rules is what stops a non-admin,
 * and tools/rules-check.mjs covers that side. These cover the panel itself. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, painted, stored } from "./helpers/browser.mjs";
import { person, admin, features } from "./helpers/fixtures.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const seed = [
  admin("uidA"),
  person("uidA", "a@example.com", "Ay"),
  person("uidB", "b@example.com"),
  features("uidA", ["dailyplan", "finance"]),
  features("uidB", ["dailyplan"], { dailyplan: { xp: false, priority: true, streaks: true } })
];

const boxes = page => page.evaluate(() => [...document.querySelectorAll("#rows input")]
  .map(i => `${i.dataset.section ? i.dataset.section + "." : ""}${i.dataset.key}:${i.checked}`));

test("a non-admin is told, and gets no panel", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/admin/", {
    user: { uid: "uidB", email: "b@example.com" }, seed
  });
  await signIn(page);
  assert.match(await page.evaluate(() => document.getElementById("syncMsg").textContent), /isn't an admin/);
  assert.equal(await painted(page, "#features"), false);
  assert.deepEqual(problems, []);
});

test("an admin gets everyone who has signed in, with the default first", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/admin/", {
    user: { uid: "uidA", email: "a@example.com", displayName: "Ay" }, seed
  });
  await signIn(page);
  const options = await page.evaluate(() => [...document.querySelectorAll("#userSelect option")]
    .map(o => `${o.textContent}=${o.value}`));
  assert.equal(options[0], "Default for new users=default");
  // Signing in refreshes your own card, which is why Ay's name is on it here.
  assert.deepEqual(options.slice(1), ["a@example.com — Ay=uidA", "b@example.com=uidB"]);
  assert.equal(await page.evaluate(() => document.getElementById("userSelect").value), "default",
    "the default is what opens, being the answer for everybody nobody has been through");
  assert.deepEqual(problems, []);
});

test("picking a person shows their settings, and ticking one writes only theirs", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/admin/", {
    user: { uid: "uidA", email: "a@example.com", displayName: "Ay" }, seed
  });
  await signIn(page);
  await page.selectOption("#userSelect", "uidB");
  await page.waitForTimeout(1000);

  const before = await boxes(page);
  assert.ok(before.includes("dailyplan:true"));
  assert.ok(before.includes("finance:false"));
  assert.ok(before.includes("dailyplan.xp:false"), "an extra switched off comes back off");

  await page.click('#rows input[data-key="finance"]');
  await page.waitForTimeout(1200);

  const written = await stored(page, "features/uidB");
  assert.equal(written.sections.finance, true);
  assert.equal(written.sections.dailyplan, true);
  assert.equal(written.extras.dailyplan.xp, false, "the extras ride along untouched");
  assert.deepEqual((await stored(page, "features/uidA")).sections.finance, true,
    "the other account is not touched");
  assert.deepEqual(problems, []);
});

test("the extra settings start folded and write under the section they belong to", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/admin/", {
    user: { uid: "uidA", email: "a@example.com", displayName: "Ay" }, seed
  });
  await signIn(page);
  await page.selectOption("#userSelect", "uidB");
  await page.waitForTimeout(1000);

  assert.equal(await painted(page, ".extras"), false, "folded away until asked for");
  await page.click(".extras-bar");
  await page.waitForTimeout(200);
  assert.equal(await painted(page, ".extras"), true);

  await page.click('.extras input[data-key="streaks"]');
  await page.waitForTimeout(1200);
  const written = await stored(page, "features/uidB");
  assert.deepEqual(written.extras.dailyplan, { xp: false, priority: true, streaks: false });
});

test("the default is edited like a person, and saved as the default", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/admin/", {
    user: { uid: "uidA", email: "a@example.com", displayName: "Ay" }, seed
  });
  await signIn(page);
  await page.click('#rows input[data-key="ideas"]');
  await page.waitForTimeout(1200);
  assert.match(await page.evaluate(() => document.getElementById("note").textContent), /as the default/);
  assert.equal((await stored(page, "features/default")).sections.ideas, true);
});
