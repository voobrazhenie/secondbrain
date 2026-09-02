/* Every section opens with the same top bar, in the same place.
 *
 * The pages drifted: five different top paddings (14px on dailyplan, 5vh on
 * most, 9vh at home), two different header classes, two different gaps under
 * it. Opening one section after another felt like opening different apps, and
 * nothing caught it, because every page looked right on its own.
 *
 * So this measures — it opens each page in a browser and reads where the bar
 * actually lands. Reading the stylesheet cannot do it: the numbers only differ
 * once `calc()`, `vh` and the safe-area insets have been worked out. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { playwright, serve, openPage } from "./helpers/browser.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Every page in the repo, found rather than listed, so a new section is covered
   the day it arrives instead of the day somebody remembers this file. Mirrors
   head.test.mjs, which walks the same tree for the same reason. */
async function pages() {
  const skipDirs = new Set(["node_modules", "tests", "tools", "docs", ".git", ".claude", "shared"]);
  const found = [];
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "index.html") found.push("/");
    if (!entry.isDirectory() || skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;
    const inner = await readdir(join(ROOT, entry.name)).catch(() => []);
    if (inner.includes("index.html")) found.push(`/${entry.name}/`);
  }
  return found.sort();
}

const browser = await playwright();
const site = browser ? await serve() : null;
const skip = browser ? false : "no browser (run: npx playwright install chromium)";
after(async () => { await browser?.close(); await site?.close(); });

/* Where the bar sits and how big it is, in real pixels on a phone-sized
   viewport — which is what a person actually sees. */
async function bar(url) {
  const { page } = await openPage(browser, site.origin, url);
  const box = await page.evaluate(() => {
    const el = document.querySelector("header.topbar");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      height: Math.round(r.height),
      gap: Math.round(parseFloat(getComputedStyle(el).marginBottom))
    };
  });
  await page.close();
  return box;
}

test("every page opens with the top bar in the same place", { skip }, async () => {
  const found = await pages();
  assert.ok(found.length >= 8, `expected to find the sections, found ${found.length}`);

  const measured = {};
  for (const url of found) {
    const box = await bar(url);
    assert.ok(box, `${url} has no <header class="topbar"> — every page opens with one`);
    measured[url] = box;
  }

  /* dailyplan is the reference: it is the one that reads right on a phone, so
     it is what theme.css's --page-top and .topbar were set from. */
  const want = measured["/dailyplan/"];
  assert.ok(want, "dailyplan is the reference page and has to be in the set");
  for (const [url, box] of Object.entries(measured)) {
    assert.deepEqual(box, want,
      `${url} puts the top bar at ${JSON.stringify(box)}; dailyplan puts it at ` +
      `${JSON.stringify(want)}. The spacing is one rule — --page-top and .topbar ` +
      `in theme.css — so a page should not be setting its own.`);
  }
});

/* The bar is shared markup, so the pieces of it are worth pinning too: the
   class is what theme.css styles, and the breadcrumb is how you get home. */
test("every page's top bar is the shared one", async () => {
  for (const url of await pages()) {
    const file = join(ROOT, url === "/" ? "index.html" : `${url.slice(1)}index.html`);
    const html = await readFile(file, "utf8");

    assert.match(html, /<header class="topbar/,
      `${url} should open with <header class="topbar">, not its own header`);
    assert.doesNotMatch(html, /class="crumbs"/,
      `${url} still uses the old .crumbs class; the bar is .topbar now`);
    assert.doesNotMatch(html, /^\s*\.topbar\{/m,
      `${url} redefines .topbar; the bar is one rule, in theme.css`);

    const here = html.match(/<span class="crumb here">([^<]+)<\/span>/);
    assert.ok(here, `${url} has no filled crumb saying which page you are on`);
    if (url !== "/") {
      assert.match(html, /<a class="crumb" href="\.\.\/">SECOND BRAIN<\/a>/,
        `${url} has no SECOND BRAIN crumb linking home`);
    }
  }
});
