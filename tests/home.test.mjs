/* The home page is the list of sections somebody has, so it is gated like the
 * rest of the app and shows only what admin/ switched on for them.
 *
 * These assert what is painted, not what is marked hidden. The two came apart
 * once: `hidden` was set on every switched-off card and the stylesheet kept
 * drawing them, because a page rule that sets a display beats the browser's own
 * rule for the attribute. A test reading the property passed throughout. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, signOut, painted, stored } from "./helpers/browser.mjs";
import { person, admin, features, sections } from "./helpers/fixtures.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const cards = page => page.evaluate(() => [...document.querySelectorAll("#deck .card")]
  .filter(c => getComputedStyle(c).display !== "none").map(c => c.dataset.key));

test("signed out, the deck is not on screen", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidA", email: "a@example.com" }
  });
  assert.deepEqual(await cards(page), []);
  assert.equal(await painted(page, "#adminLink"), false);
  assert.deepEqual(problems, []);
});

test("only the sections switched on for that account are painted", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidB", email: "b@example.com" },
    seed: [features("uidB", ["dailyplan", "finance"])]
  });
  await signIn(page);
  assert.deepEqual(await cards(page), ["dailyplan", "finance"]);
  assert.equal(await painted(page, "#empty"), false);
  assert.deepEqual(problems, []);
});

test("an account nobody has decided about gets features/default", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidNEW", email: "new@example.com" },
    seed: [["features/default", { sections: sections(["dailyplan"]) }]]
  });
  await signIn(page);
  assert.deepEqual(await cards(page), ["dailyplan"],
    "read through to the default rather than copied at sign-in");
  assert.equal(await stored(page, "features/uidNEW"), undefined,
    "and nothing is written for them, so changing the default still reaches them");
});

test("with no settings and no default, an account is told so rather than shown everything", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidNEW", email: "new@example.com" }
  });
  await signIn(page);
  assert.deepEqual(await cards(page), []);
  assert.equal(await painted(page, "#empty"), true);
});

test("signing in records a profile card, so admin/ knows the account exists", { skip }, async () => {
  const { page } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidC", email: "c@example.com", displayName: "Cee" }
  });
  await signIn(page);
  const card = await stored(page, "profiles/uidC");
  assert.equal(card.email, "c@example.com");
  assert.equal(card.name, "Cee");
});

test("the way in to admin/ shows only for an admin", { skip }, async () => {
  const ordinary = await openPage(browser, site.origin, "/", {
    user: { uid: "uidB", email: "b@example.com" },
    seed: [features("uidB", ["dailyplan"])]
  });
  await signIn(ordinary.page);
  assert.equal(await painted(ordinary.page, "#adminLink"), false);

  const boss = await openPage(browser, site.origin, "/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [admin("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(boss.page);
  assert.equal(await painted(boss.page, "#adminLink"), true);
});

/* Signed in, the row said "Signed in as …" over the sections and nothing else.
   It goes once they are drawn, and the way out goes to the footer. */
test("signed in, the sync row is gone and the way out is in the footer", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidB", email: "b@example.com" },
    seed: [features("uidB", ["dailyplan"])]
  });

  assert.equal(await painted(page, "#sync"), true, "signed out it is the way in");
  assert.equal(await painted(page, "#signOutBtn"), false, "and there is nothing to sign out of");

  await signIn(page);
  assert.equal(await painted(page, "#sync"), false, "signed in it has nothing left to say");
  assert.equal(await painted(page, "#signOutBtn"), true, "the footer carries the way out");

  await signOut(page);
  assert.deepEqual(await cards(page), [], "and it signs out");
  assert.equal(await painted(page, "#sync"), true, "leaving the way back in");
  assert.deepEqual(problems, []);
});

/* The group is for everybody, signed in or not, and it has to leave the
   installed app rather than navigate it — there is no back button in there. */
test("the Telegram group is on the page in both states, and opens away from the app", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/", {
    user: { uid: "uidB", email: "b@example.com" },
    seed: [features("uidB", ["dailyplan"])]
  });

  const link = () => page.evaluate(() => {
    const a = document.getElementById("groupLink");
    return { painted: getComputedStyle(a).display !== "none", href: a.href, target: a.target, rel: a.rel };
  });

  const out = await link();
  assert.equal(out.painted, true);
  assert.equal(out.href, "https://t.me/+k7uKdPUtf51hZTAy");
  assert.equal(out.target, "_blank");
  assert.match(out.rel, /noopener/);

  await signIn(page);
  assert.equal((await link()).painted, true, "still there with the sections up");
  assert.deepEqual(problems, []);
});
