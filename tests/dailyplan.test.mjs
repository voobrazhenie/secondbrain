/* DailyPlan: whose routine it draws, and which parts of it this account gets.
 *
 * The routine used to be a file in this repository, which meant every account
 * that signed in was shown one person's medication. It belongs to the account
 * now, and an account without one opens on an empty list it can fill. */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { playwright, serve, openPage, signIn, signOut, painted, paintedAll, stored,
         swipeLeft, dragLeft, holdPress, dragTo } from "./helpers/browser.mjs";
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

/* A row is a line on a list, not a button, and Delete lives on a button behind
   it rather than at the end of a gesture. */
test("a row does not move when pressed, and swiping reveals a Delete that stays", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])],
    touch: true
  });
  await signIn(page);

  const first = await page.locator("#list .row").first().boundingBox();
  const y = first.y + first.height / 2;
  const shift = () => page.evaluate(() => getComputedStyle(document.querySelector("#list .row")).transform);

  assert.equal(await shift(), "none");
  await page.mouse.move(first.x + 200, y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  assert.equal(await shift(), "none", "held down, the row stays exactly where it is");
  await page.mouse.up();
  await page.waitForTimeout(300);

  const before = await rowCount(page);
  const revealed = () => page.evaluate(() => !!document.querySelector(".rowwrap.revealed"));

  await swipeLeft(page, "#list .row");
  assert.equal(await revealed(), true,
    "it stays open rather than springing back or deleting on its own");
  assert.equal(await painted(page, ".rowwrap.revealed .tray button"), true);
  assert.equal(await rowCount(page), before, "the swipe itself destroys nothing");

  await page.click(".rowwrap.revealed .tray button");
  await page.waitForTimeout(600);
  assert.equal(await rowCount(page), before - 1, "the button is what deletes");
  assert.equal(await revealed(), false);
  assert.deepEqual(problems, []);
});

/* Swiping is a finger's gesture. On a desktop the same drag with a mouse used
   to slide the card off its Delete, which nobody was asking for — the hover
   buttons beside the card are the desktop way in. */
test("a mouse drag across a row does not swipe it", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);

  const before = await rowCount(page);
  await dragLeft(page, "#list .row");
  assert.equal(await page.evaluate(() => !!document.querySelector(".rowwrap.revealed")), false,
    "the card stays shut");
  assert.equal(await page.evaluate(
    () => document.querySelector("#list .row").style.transform || ""), "",
    "and it never moved");
  assert.equal(await rowCount(page), before);
  assert.deepEqual(problems, []);
});

/* A long press opens the edit form. It must not also select the words under
   the finger, which is what it did on the phone: the form came up with the
   text highlighted and iOS's copy callout behind it. */
test("a card you press and hold does not select its own text", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);

  const selectable = sel => page.evaluate(
    s => getComputedStyle(document.querySelector(s)).userSelect, sel);

  assert.equal(await selectable("#list .row"), "none", "a task row");
  assert.equal(await selectable(".priority"), "none", "the priority card");
  // Inside the form it is the whole point, so nothing may take it away there.
  await page.evaluate(() => openAdd("To do"));
  assert.equal(await selectable("#mText"), "text", "the field being typed into");
  assert.deepEqual(problems, []);
});

/* The edit and remove buttons appear beside the card on a desktop, not on top
   of it — inside, they sat on the XP pill and hid the row's own score. */
test("the hover buttons sit clear of the card", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await page.setViewportSize({ width: 1100, height: 900 });
  await signIn(page);

  await page.locator(".rowwrap").first().hover();
  await page.waitForTimeout(150);
  assert.equal(await painted(page, ".rowbtns"), true, "they are there to be used");

  const clear = await page.evaluate(() => {
    const card = document.querySelector(".rowwrap").getBoundingClientRect();
    const btns = document.querySelector(".rowbtns").getBoundingClientRect();
    return { gap: Math.round(btns.left - card.right), onScreen: btns.right <= innerWidth };
  });
  assert.ok(clear.gap > 0, `the buttons overlap the card by ${-clear.gap}px`);
  assert.ok(clear.onScreen, "and they are still on the screen");
  assert.deepEqual(problems, []);
});


/* ---------- streaks ----------
 *
 * The number on a tile is worked out for the day being looked at, not for
 * today. That was the bug: stepping back a week left the count where it was,
 * which made it read as a total rather than as a streak. */

const day = (uid, date, ticks) => [`users/${uid}/days/${date}`, { ticks, xpEarned: 0, ticked: Object.keys(ticks).length }];
const tiles = page => page.evaluate(() => [...document.querySelectorAll("#streakRow .strk")]
  .map(el => ({ n: el.querySelector(".n").textContent, name: el.querySelector(".nm").textContent })));

/* The routine the old single counter needed: the weed card, by its id. */
const weedRoutine = () => {
  const r = routine();
  r.daily[1].items.push({ id: "r-smoked-weed", emoji: "\u{1F33F}", text: "Didn't smoke weed", xp: 15, invert: true });
  return r;
};

test("the weed counter becomes a streak, and it is written to the account", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA", weedRoutine()), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  assert.deepEqual((await tiles(page)).map(t => t.name), ["No weed"]);

  const written = await stored(page, "users/uidA/config/streaks");
  assert.equal(written.items.length, 1);
  assert.equal(written.items[0].itemId, "r-smoked-weed");
  assert.equal(written.items[0].kind, "avoid");
  assert.deepEqual(problems, []);
});

test("a streak counts for the day on screen, not for today", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [
      plan("uidA", weedRoutine()),
      features("uidA", ["dailyplan"]),
      // The last slip was the first of the month, so the tenth is nine days on.
      day("uidA", "2026-03-01", { "r-smoked-weed": true }),
      [`users/uidA/config/trackers`, { "r-smoked-weed": "2026-03-01" }]
    ]
  });
  await signIn(page);
  assert.equal((await tiles(page))[0].n, "9");

  // Back to the fifth: four days on from the same slip, not still nine.
  await page.click("#dayPrev");
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) { await page.click("#dayPrev"); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => plan.date), "2026-03-05");
  assert.equal((await tiles(page))[0].n, "4");

  // And on the day itself the run is back to nothing.
  for (let i = 0; i < 4; i++) { await page.click("#dayPrev"); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  assert.equal((await tiles(page))[0].n, "0");
  assert.deepEqual(problems, []);
});

test("a habit streak counts the days in a row its card was ticked", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [
      plan("uidA"),
      features("uidA", ["dailyplan"]),
      ["users/uidA/config/streaks", { items: [
        { id: "s-sleep", name: "Sleep", kind: "build", itemId: "r-sleep", target: 30, since: null, done: null }
      ] }],
      day("uidA", "2026-03-07", { "r-sleep": true }),
      day("uidA", "2026-03-08", { "r-sleep": true }),
      day("uidA", "2026-03-09", { "r-sleep": true })
    ]
  });
  await signIn(page);
  // Today is not ticked yet, so the run behind it is what shows.
  assert.equal((await tiles(page))[0].n, "3");

  // Ticking today extends it rather than starting it again.
  await page.evaluate(() => setTick("r-sleep", true));
  await page.waitForTimeout(300);
  assert.equal((await tiles(page))[0].n, "4");
  assert.deepEqual(problems, []);
});

test("adding a streak makes the daily card that feeds it", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA"), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  assert.equal(await painted(page, "#streaks"), true, "the strip is there to add the first one to");

  await page.click("#streakAdd");
  await page.fill("#sName", "Cold shower");
  await page.selectOption("#sKind", "build");
  await page.fill("#sCard", "Cold shower");
  await page.selectOption("#sGroup", "Recover");
  await page.click("#sSave");
  // Wait for the writes rather than for a number of milliseconds: the save
  // draws the tile, pushes the streak and pushes the card, and which of the
  // three lands last is not fixed.
  await page.waitForSelector("#streakRow .strk");
  await page.waitForFunction(
    () => globalThis.__MOCK_STORE.get("users/uidA/config/custom")?.added?.some(a => a.text === "Cold shower"));

  assert.deepEqual((await tiles(page)).map(t => t.name), ["Cold shower"]);
  const custom = await stored(page, "users/uidA/config/custom");
  const card = custom.added.find(a => a.text === "Cold shower");
  assert.equal(card.scope, "daily", "it comes back every day");
  assert.equal(card.group, "Recover");
  const written = await stored(page, "users/uidA/config/streaks");
  assert.equal(written.items[0].itemId, card.id);
  assert.deepEqual(problems, []);
});

test("marking a streak done takes the tile away and leaves the card behind", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [
      plan("uidA", weedRoutine()),
      features("uidA", ["dailyplan"]),
      ["users/uidA/config/streaks", { items: [
        { id: "s-weed", name: "No weed", kind: "avoid", itemId: "r-smoked-weed", target: 30, since: "2026-02-08", done: null }
      ] }]
    ]
  });
  await signIn(page);
  assert.equal((await tiles(page)).length, 1);
  const rowsBefore = await rowCount(page);

  await page.evaluate(() => openStreakEdit("s-weed"));
  await page.click("#sDone");
  await page.waitForTimeout(700);

  assert.deepEqual(await tiles(page), [], "the tile is off the row");
  assert.equal(await rowCount(page), rowsBefore, "the card it counted is still on the list");
  const written = await stored(page, "users/uidA/config/streaks");
  assert.equal(written.items[0].done, "2026-03-10");
  assert.deepEqual(problems, []);
});

test("holding a streak tile opens its dialog", { skip }, async () => {
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    touch: true,
    user: { uid: "uidA", email: "a@example.com" },
    seed: [
      plan("uidA", weedRoutine()),
      features("uidA", ["dailyplan"]),
      ["users/uidA/config/streaks", { items: [
        { id: "s-weed", name: "No weed", kind: "avoid", itemId: "r-smoked-weed", target: 30, since: "2026-02-08", done: null }
      ] }]
    ]
  });
  await signIn(page);
  assert.equal(await painted(page, "#sScrim"), false);
  await holdPress(page, "#streakRow .strk");
  assert.equal(await painted(page, "#sScrim"), true, "the dialog is on screen");
  assert.equal(await page.inputValue("#sName"), "No weed");
  assert.deepEqual(problems, []);
});


/* ---------- categories ----------
 *
 * The routine is the shape of the day, and this page writes it now: the dashed
 * slot adds a category, a long press on a header renames or removes one, and
 * REORDER is how anything is moved. A removed category must never take its
 * tasks with it. */

const blocks = page => page.evaluate(() => [...document.querySelectorAll("#list .grp")]
  .map(g => ({ title: g.dataset.group, ids: [...g.querySelectorAll(".rowwrap")].map(r => r.dataset.id) })));

const openDay = (seed = [plan("uidA"), features("uidA", ["dailyplan"])], opts = {}) =>
  openPage(browser, site.origin, "/dailyplan/?date=2026-03-10",
    { user: { uid: "uidA", email: "a@example.com" }, seed, ...opts });

test("a new category stays on the page with nothing in it", { skip }, async () => {
  const { page, problems } = await openDay();
  await signIn(page);
  await page.click("#addCat");
  await page.fill("#cName", "Morning");
  await page.click("#cSave");
  await page.waitForTimeout(700);

  assert.deepEqual((await blocks(page)).map(b => b.title), ["To do", "Meds", "Recover", "Morning"],
    "an empty category you just made is no use if it vanishes");
  assert.deepEqual((await stored(page, "users/uidA/config/plan")).daily.map(g => g.title),
    ["To do", "Meds", "Recover", "Morning"]);
  assert.deepEqual(problems, []);
});

test("renaming a category keeps its tasks and its fold", { skip }, async () => {
  const { page, problems } = await openDay();
  await signIn(page);
  await page.evaluate(() => toggleGroup("Meds"));
  await page.waitForTimeout(400);
  await page.evaluate(() => openCategoryEdit("Meds"));
  await page.fill("#cName", "Pills");
  await page.click("#cSave");
  await page.waitForTimeout(700);

  const seen = await blocks(page);
  assert.deepEqual(seen.map(b => b.title), ["To do", "Pills", "Recover"]);
  assert.deepEqual(await page.evaluate(() => [...collapsedGroups]), ["Pills"],
    "the fold follows the name");
  await page.evaluate(() => toggleGroup("Pills"));
  await page.waitForTimeout(400);
  assert.deepEqual((await blocks(page)).find(b => b.title === "Pills").ids, ["m-one", "m-two"]);
  assert.deepEqual(problems, []);
});

test("removing a category leaves its tasks at the top, with no category", { skip }, async () => {
  const { page, problems } = await openDay();
  await signIn(page);
  await page.evaluate(() => openCategoryEdit("Meds"));
  await page.click("#cDelete");
  await page.waitForTimeout(700);

  const seen = await blocks(page);
  assert.equal(seen[0].title, "", "the nameless block is first");
  assert.deepEqual(seen[0].ids, ["m-one", "m-two"], "and it holds what the category held");
  assert.equal(await paintedAll(page, "#list .grp:first-child .sec"), 0, "it has no header");
  assert.equal(seen.some(b => b.title === "Meds"), false);

  // UNDO puts the category back, tasks and all.
  await page.click("#toastUndo");
  await page.waitForTimeout(700);
  const back = await blocks(page);
  assert.deepEqual(back.map(b => b.title), ["To do", "Meds", "Recover"]);
  assert.deepEqual(back.find(b => b.title === "Meds").ids, ["m-one", "m-two"]);
  assert.deepEqual(problems, []);
});

test("REORDER puts a grip on every row and stops them ticking", { skip }, async () => {
  const { page, problems } = await openDay();
  await signIn(page);
  assert.equal(await paintedAll(page, "#list .handle"), 0, "no grips in the way of a normal day");

  await page.click("#reorderBtn");
  await page.waitForTimeout(500);
  assert.equal(await paintedAll(page, "#list .row .handle"), 3, "one per task");
  assert.equal(await paintedAll(page, "#list .sec .handle"), 3, "one per category");
  assert.equal(await paintedAll(page, "#list .sec .add"), 0, "the + is out of the way");
  assert.equal(await page.evaluate(() => document.querySelector('#list .row input').disabled), true);
  assert.equal(await page.textContent("#reorderBtn"), "DONE");

  await page.click("#reorderBtn");
  await page.waitForTimeout(500);
  assert.equal(await paintedAll(page, "#list .handle"), 0);
  assert.deepEqual(problems, []);
});

test("a task dragged into another category moves there in the routine", { skip }, async () => {
  const { page, problems } = await openDay(undefined, { touch: true });
  await signIn(page);
  await page.click("#reorderBtn");
  await page.waitForTimeout(500);

  await dragTo(page, '.rowwrap[data-id="r-sleep"] .handle', '.rowwrap[data-id="m-one"]');
  const seen = await blocks(page);
  assert.deepEqual(seen.find(b => b.title === "Meds").ids, ["r-sleep", "m-one", "m-two"],
    "dropped on the top half of a row, so it lands above it");
  assert.deepEqual(seen.find(b => b.title === "Recover").ids, []);

  const daily = (await stored(page, "users/uidA/config/plan")).daily;
  assert.deepEqual(daily.find(g => g.title === "Meds").items.map(i => i.id).sort(),
    ["m-one", "m-two", "r-sleep"], "the routine is what changed, not just today");
  assert.deepEqual(daily.find(g => g.title === "Recover").items, []);
  assert.deepEqual(problems, []);
});

test("a category dragged onto another one changes their order", { skip }, async () => {
  const { page, problems } = await openDay(undefined, { touch: true });
  await signIn(page);
  await page.click("#reorderBtn");
  await page.waitForTimeout(500);

  await dragTo(page, '.grp[data-group="Recover"] .sec .handle', '.grp[data-group="Meds"] .sec');
  assert.deepEqual((await stored(page, "users/uidA/config/plan")).daily.map(g => g.title),
    ["To do", "Recover", "Meds"]);
  assert.deepEqual(problems, []);
});

test("there is no way to sign out from the day", { skip }, async () => {
  const { page, problems } = await openDay();
  await signIn(page);
  assert.equal(await painted(page, "#sync"), false, "nothing at the bottom when it is working");
  assert.deepEqual(problems, []);
});

test("a signed-out visitor still has a way in", { skip }, async () => {
  const { page } = await openDay();
  assert.equal(await painted(page, "#sync"), true);
  assert.equal(await painted(page, "#authBtn"), true);
  assert.match(await page.textContent("#authBtn"), /sign in/i);
});

/* The rule that decides whether an empty category is on screen has two sides,
 * and getting one right must not get the other wrong. */
test("an empty category shows; one whose task is not due today does not", { skip }, async () => {
  const cycles = {
    schemaVersion: 1, startDate: "2026-01-01", principles: null, oneOffs: null,
    daily: [
      { title: "Care", emoji: "✨", items: [
        { id: "c-micro", emoji: "✨", text: "Microneedling", xp: 10, every: 14, anchor: "2026-03-01" }] },
      { title: "Empty", emoji: "\u{1F4E6}", items: [] }
    ]
  };
  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-02-20", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA", cycles),
           features("uidA", ["dailyplan"], { dailyplan: { xp: true, priority: true, streaks: true, intervals: true } })]
  });
  await signIn(page);
  assert.deepEqual((await blocks(page)).map(b => b.title), ["To do", "Empty"],
    "Care is empty today because nothing is due; Empty has nothing at all and needs its +");
  assert.deepEqual(problems, []);
});

test("a task dropped on the nameless zone loses its category and stays there", { skip }, async () => {
  const { page, problems } = await openDay(undefined, { touch: true });
  await signIn(page);
  await page.click("#reorderBtn");
  await page.waitForTimeout(500);

  await dragTo(page, '.rowwrap[data-id="r-sleep"] .handle', '.grp.nocat .drop', { at: 0.5 });
  assert.deepEqual((await blocks(page))[0], { title: "", ids: ["r-sleep"] });

  await page.click("#reorderBtn");
  await page.waitForTimeout(600);
  assert.deepEqual((await blocks(page))[0], { title: "", ids: ["r-sleep"] },
    "still there once the moving is over");
  assert.deepEqual((await stored(page, "users/uidA/config/plan")).daily.find(g => g.title === "").items
    .map(i => i.id), ["r-sleep"]);
  assert.deepEqual(problems, []);
});

/* The one-off list is not a category: it has no + and cannot be renamed or
 * removed, so with nothing left in it there is nothing to draw. Keeping it
 * on screen put an empty SETUP header on the day with no way to get rid of
 * it — the empty-category rule had reached a section it was never about. */
test("a one-off section with nothing left in it goes away", { skip }, async () => {
  const withSetup = routine();
  withSetup.oneOffs = { title: "Setup", emoji: "🎯", items: [
    { id: "s-measure", emoji: "📏", text: "Weigh + measure waist", xp: 35 }] };

  const { page, problems } = await openPage(browser, site.origin, "/dailyplan/?date=2026-03-10", {
    user: { uid: "uidA", email: "a@example.com" },
    seed: [plan("uidA", withSetup), features("uidA", ["dailyplan"])]
  });
  await signIn(page);
  assert.equal((await blocks(page)).some(b => b.title === "Setup"), true, "it is there while it has one");

  // Swiping the last one away is what emptied it.
  await page.evaluate(() => removeItem({ id: "s-measure", text: "Weigh + measure waist" }));
  await page.waitForTimeout(600);
  assert.equal((await blocks(page)).some(b => b.title === "Setup"), false,
    "and gone once it holds nothing");
  assert.deepEqual(problems, []);
});
