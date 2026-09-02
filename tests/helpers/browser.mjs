/* Drives the real pages in a real browser, with Firebase replaced.
 *
 * These pages are static files with no build step, so the only honest way to
 * test them is to serve them and open them. Everything they do that a test
 * cannot — Google sign-in, a live Firestore — is intercepted: the three SDK
 * imports are answered from tests/mocks/ instead of gstatic.com.
 *
 * Why this exists: every bug this session was invisible to source-reading
 * tests. One account's data appeared under another's because sign-out left a
 * copy on the device. Section buttons stayed on screen after being switched
 * off, because `hidden` was set correctly and the stylesheet painted them
 * anyway — a test asserting the property passed while the page was wrong. So
 * these assert what is written, under which path, and what is actually painted.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MOCKS = join(HERE, "..", "mocks");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

/* Chromium is preinstalled in some environments and absent in others. A missing
 * browser skips these tests rather than failing them — the unit tests still run
 * everywhere, and `npx playwright install chromium` turns these on. */
export async function playwright() {
  try {
    const { chromium } = await import("playwright");
    const launch = { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined };
    try { return await chromium.launch(launch); }
    catch { return await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
  } catch {
    return null;
  }
}

export async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const file = join(ROOT, normalize(path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}

/* A page with the SDK swapped out, optionally starting from a given set of
 * documents and a given signed-in account. `seed` is [[path, data], …]. */
export async function openPage(browser, origin, url, { user = null, seed = [], localStorage: ls = {}, touch = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 430, height: 950 }, hasTouch: touch });

  await page.route("https://www.gstatic.com/firebasejs/**", async route => {
    const name = route.request().url().split("/").pop();
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: await readFile(join(MOCKS, name), "utf8")
    });
  });

  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  page.on("console", m => {
    // The optional per-day override file is expected to be absent.
    if (m.type() === "error" && !m.text().includes("404")) problems.push("console: " + m.text());
  });

  await page.addInitScript(([seeded, account, keys]) => {
    try {
      if (!sessionStorage.getItem("__mockdb")) sessionStorage.setItem("__mockdb", seeded);
      for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
    } catch {}
    if (account) globalThis.__MOCK_USER = account;
  }, [JSON.stringify(seed), user, ls]);

  await page.goto(origin + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  return { page, problems };
}

/* Sign in and wait for the page to settle. Pages fetch several documents before
 * they paint, so this waits for the gate rather than a fixed delay where it can. */
export async function signIn(page, { settle = 1800 } = {}) {
  await page.click("#authBtn");
  await page.waitForTimeout(settle);
}

/* Signing out reloads the page, so the click has to be awaited alongside it. */
export async function signOut(page, { settle = 1400 } = {}) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click("#authBtn")
  ]);
  await page.waitForTimeout(settle);
}

/* What a person can actually see, which is not the same as what the `hidden`
 * property says — see the note at the top of this file. */
export const painted = (page, selector) => page.evaluate(
  sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== "none"; },
  selector);

export const paintedAll = (page, selector) => page.evaluate(
  sel => [...document.querySelectorAll(sel)].filter(el => getComputedStyle(el).display !== "none").length,
  selector);

/* Swipe a card left with a finger.
 *
 * It has to be a finger: swiping is a touch gesture now, and a mouse drag
 * across a card deliberately does nothing — on a desktop the hover buttons do
 * that job. Playwright's touchscreen can tap but not drag, so this goes through
 * CDP, which is real input rather than events dispatched from inside the page.
 * The page has to have been opened with `touch: true`. */
export async function swipeLeft(page, selector, distance = 140) {
  const box = await page.locator(selector).first().boundingBox();
  const y = Math.round(box.y + box.height / 2);
  const from = Math.round(box.x + box.width - 30);
  const cdp = await page.context().newCDPSession(page);
  const at = (type, x) => cdp.send("Input.dispatchTouchEvent", {
    type, touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y }]
  });
  await at("touchStart", from);
  for (let i = 1; i <= 8; i++) await at("touchMove", from - (distance / 8) * i);
  await at("touchEnd", from - distance);
  await cdp.detach();
  await page.waitForTimeout(400);
}

/* The same drag with a mouse, which should leave the card where it is. */
export async function dragLeft(page, selector, distance = 140) {
  const box = await page.locator(selector).first().boundingBox();
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 30;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(from - (distance / 8) * i, y); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

export const stored = (page, path) => page.evaluate(p => globalThis.__MOCK_STORE.get(p), path);
export const storedPaths = page => page.evaluate(() => [...globalThis.__MOCK_STORE.keys()].sort());
