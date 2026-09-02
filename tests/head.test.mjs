/* Every page has to declare itself an app.
 *
 * This is a stylesheet-shaped rule that cannot live in a stylesheet: what makes
 * a section open inside the installed app rather than dropping into Safari's
 * browser bar is a handful of tags in the head, and CSS cannot add those.
 * Exercise and Admin shipped without them and opened with the close and share
 * controls sitting over the page. A test is the only thing that keeps the next
 * page from doing the same. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Every index.html in the repo, one directory deep, minus the places that are
   not pages. Found rather than listed, so a new section is covered the day it
   arrives instead of the day somebody remembers this file. */
async function pages() {
  const skip = new Set(["node_modules", "tests", "tools", "docs", ".git", ".claude", "shared"]);
  const found = [];
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "index.html") found.push(entry.name);
    if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith(".")) continue;
    const inner = await readdir(join(ROOT, entry.name)).catch(() => []);
    if (inner.includes("index.html")) found.push(`${entry.name}/index.html`);
  }
  return found.sort();
}

const REQUIRED = [
  [/<link[^>]+rel="manifest"/, "a manifest, so it can be installed"],
  [/<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/, "apple-mobile-web-app-capable, so iOS opens it standalone"],
  [/<meta[^>]+name="mobile-web-app-capable"[^>]+content="yes"/, "mobile-web-app-capable, the same for everything else"],
  [/<meta[^>]+name="apple-mobile-web-app-status-bar-style"/, "a status bar style"],
  [/<meta[^>]+name="theme-color"/, "a theme colour"],
  [/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/, "viewport-fit=cover, for the notch"]
];

test("every page opens as part of the installed app", async () => {
  const found = await pages();
  assert.ok(found.length >= 8, `expected to find the sections, found ${found.length}`);

  for (const page of found) {
    const html = await readFile(join(ROOT, page), "utf8");
    for (const [pattern, why] of REQUIRED) {
      assert.match(html, pattern, `${page} is missing ${why}`);
    }
  }
});
