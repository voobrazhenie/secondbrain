/* Ideas, Streams and Finance.
 *
 * All three used to work signed out, keeping their list in localStorage and
 * uploading it into whichever account signed in next if that account had no
 * document yet — the same shape as the bug that put one person's day under
 * another's on DailyPlan. They are signed-in only now, with nothing on the
 * device, and these are the tests that say so. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, signOut, painted, stored } from "./helpers/browser.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const PAGES = [
  {
    name: "Ideas", url: "/ideas/", list: "#ideaList", legacy: "secondbrain.ideas.v1",
    doc: uid => `users/${uid}/config/ideas`,
    content: { ideas: [
      { id: "i1", title: "First", description: "", collapsed: false },
      { id: "i2", title: "Second", description: "", collapsed: false }
    ] },
    count: 2
  },
  {
    name: "Streams", url: "/streams/", list: "#groups", legacy: "secondbrain.streams.v1",
    doc: uid => `users/${uid}/config/streams`,
    content: { streams: [
      { id: "s1", title: "Money", group: "focus" },
      { id: "s2", title: "Health", group: "focus" }
    ] },
    // Streams renders its groups, not one node per stream, so the shape of the
    // assertion is "the page drew something from the account".
    count: null
  },
  {
    name: "Finance", url: "/finance/", list: "#assetsList", legacy: "secondbrain.finance.v1",
    doc: uid => `users/${uid}/config/finance`,
    content: { accounts: { a1: { id: "a1", name: "Bank", kind: "asset", currency: "EUR", amount: 1000 } }, rates: {} },
    count: 1
  }
];

for (const page of PAGES) {
  test(`${page.name}: signed out, nothing of the account is on screen`, { skip }, async () => {
    const { page: p, problems } = await openPage(browser, site.origin, page.url, {
      user: { uid: "uidA", email: "a@example.com" },
      seed: [[page.doc("uidA"), page.content]]
    });
    assert.equal(await painted(p, page.list), false);
    assert.match(await p.evaluate(() => document.getElementById("syncMsg").textContent), /^Sign in/);
    assert.deepEqual(problems, []);
  });

  test(`${page.name}: the list comes from the account, and the old browser copy is cleared`, { skip }, async () => {
    const { page: p, problems } = await openPage(browser, site.origin, page.url, {
      user: { uid: "uidA", email: "a@example.com" },
      seed: [[page.doc("uidA"), page.content]],
      localStorage: { [page.legacy]: JSON.stringify({ stale: true }), "unrelated.key": "kept" }
    });
    assert.deepEqual(await p.evaluate(() => Object.keys(localStorage)), ["unrelated.key"]);

    await signIn(p);
    assert.equal(await painted(p, page.list), true);
    if (page.count !== null) {
      assert.equal(await p.evaluate(sel => document.querySelector(sel).children.length, page.list), page.count);
    }
    assert.deepEqual(await p.evaluate(() => Object.keys(localStorage)), ["unrelated.key"],
      "using the page writes nothing to the device");
    assert.deepEqual(problems, []);
  });

  test(`${page.name}: a second account on the same browser inherits nothing`, { skip }, async () => {
    const { page: p, problems } = await openPage(browser, site.origin, page.url, {
      user: { uid: "uidA", email: "a@example.com" },
      seed: [[page.doc("uidA"), page.content]]
    });
    await signIn(p);
    await signOut(p);
    await p.evaluate(() => { globalThis.__MOCK_USER = { uid: "uidB", email: "b@example.com" }; });
    await signIn(p);

    assert.equal(await stored(p, page.doc("uidB")), undefined,
      "nothing of account A's was written into account B's");
    assert.deepEqual(problems, []);
  });
}
