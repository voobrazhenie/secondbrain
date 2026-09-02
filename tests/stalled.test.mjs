/* The blank page.
 *
 * A phone left on a page and come back to has a connection the SDK has not
 * noticed is gone. `getDocFromServer` then never settles — not an error, no
 * answer at all — and the `try { server } catch { cache }` every page was
 * written with catches nothing, because there is nothing to catch. The page
 * kept awaiting, the gate it was waiting to open stayed shut, and what was on
 * screen was the sign-in line and nothing under it. That is the screenshot
 * this file exists because of.
 *
 * The mock's server reads stall on demand (`stall: true`), which is that exact
 * failure: the cache still answers, the server never does. Every page has to
 * get past it and draw what the cache holds. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn } from "./helpers/browser.mjs";
import { plan, features, routine } from "./helpers/fixtures.mjs";

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

const user = { uid: "uidA", email: "a@example.com" };

/* A read waits six seconds before the cache answers, and only the first one
   does: after that the connection is known to be quiet and the rest go
   straight there. So a page has one wait in it, not one per document. */
const SETTLE = 9000;

const PAGES = [
  {
    name: "Home", url: "/",
    seed: [features("uidA", ["dailyplan", "streams"])],
    drawn: () => document.querySelectorAll("#deck .card:not([hidden])").length
  },
  {
    name: "DailyPlan", url: "/dailyplan/",
    seed: [plan("uidA", routine()), features("uidA", ["dailyplan"])],
    drawn: () => document.querySelectorAll("#list .row").length
  },
  {
    name: "Streams", url: "/streams/",
    seed: [features("uidA", ["streams"]),
           ["users/uidA/config/streams", { streams: [{ id: "s1", title: "Money", group: "focus" }] }]],
    drawn: () => document.querySelectorAll(".stream").length
  },
  {
    name: "Ideas", url: "/ideas/",
    seed: [features("uidA", ["ideas"]),
           ["users/uidA/config/ideas", { ideas: [{ id: "i1", title: "First", description: "" }] }]],
    drawn: () => document.querySelectorAll("#ideaList .idea").length
  },
  {
    name: "Finance", url: "/finance/",
    seed: [features("uidA", ["finance"]),
           ["users/uidA/config/finance", {
             accounts: { a1: { id: "a1", name: "Bank", kind: "asset", currency: "EUR", amount: 1000 } },
             rates: {}
           }]],
    drawn: () => document.querySelectorAll("#assetsList .row").length
  }
];

for (const page of PAGES) {
  test(`${page.name} opens when the server stops answering`, { skip }, async () => {
    const { page: p, problems } = await openPage(browser, site.origin, page.url, {
      user, seed: page.seed, stall: true
    });
    await signIn(p, { settle: SETTLE });

    const gate = await p.evaluate(() => {
      const wrap = document.getElementById("wrap");
      return wrap ? wrap.dataset.auth : "no gate";
    });
    assert.equal(gate, "in",
      "the gate opens on what the cache holds rather than sitting on `checking`");
    assert.ok(await p.evaluate(page.drawn) > 0, "and the account's own list is on it");
    assert.deepEqual(problems, []);
  });
}
