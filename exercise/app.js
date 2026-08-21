import { berlinDate, buildWeekSchedule, isRestStatus, shiftDate, weekRange } from "./schedule.mjs";
import { firebaseConfig } from "../dailyplan/firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.16.0/";
const PLAN_VERSION = 2;
/* The routine is a fixed list, so a plan of the wrong size means plan.json and
   firestore.rules have drifted apart. Kept as a named constant because three
   files have to move together — see exercise/plan.test.mjs. */
const ROUTINE_SIZE = 8;

/* The DailyPlan item this page ticks on sign-off. DailyPlan owns the id; it
   lives in dailyplan/daily.json and must not be renamed on one side only. */
const DAILY_TICK_ID = "t-workout";

/* Rest between sets, and the longer break when an exercise is finished. Device
   local and deliberately not persisted: a timer that survives a reload would
   be counting rest you already took. */
const REST_SECONDS = 60;
const TRANSITION_SECONDS = 90;
const HOLD_MS = 520;

const $ = id => document.getElementById(id);
const content = $("content");

let plan = null;
let authResolved = false;
let user = null;
let auth = null;
let db = null;
let fb = null;
let weekRecords = new Map();
let selectedDate = initialDate();
let inFlight = null;
let writePending = false;
let initialPageShow = true;

/* Which set is open for editing, as {id, index}, and whether the pointer that
   is currently down has already been claimed by a long press — without the
   second flag the click that follows a hold would toggle the set as well. */
let editing = null;
let holdTimer = null;
let held = false;

let timer = { mode: "ready", label: "READY", seconds: 0, sub: "Tap a set when you finish it.", interval: null };

function initialDate() {
  const value = new URLSearchParams(location.search).get("date");
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : berlinDate();
}

function prettyDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function setSelectedDate(date) {
  selectedDate = date;
  editing = null;
  const url = new URL(location.href);
  url.searchParams.set("date", selectedDate);
  history.replaceState(null, "", url);
  if (authResolved && user) readSelectedWeek("date change");
  else render();
}

function clearExerciseData() {
  weekRecords = new Map();
  inFlight = null;
  writePending = false;
  editing = null;
  stopTimer();
}

function setChip(state, text) {
  $("chip").className = `syncchip ${state}`;
  $("chipText").textContent = text;
}

function setSync(state, message, button) {
  $("sync").className = `sync${state ? ` ${state}` : ""}`;
  $("syncMsg").textContent = message;
  const btn = $("authBtn");
  btn.hidden = !button;
  if (button) {
    btn.textContent = button.label;
    btn.onclick = button.run;
  }
}

function panel(title, message, { error = false, action = null } = {}) {
  const node = document.createElement("div");
  node.className = `panel${error ? " err" : ""}`;
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = message;
  node.append(strong, span);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    node.append(button);
  }
  return node;
}

function showPanel(title, message, options) {
  content.replaceChildren(panel(title, message, options));
}

/* ---------- reading the routine out of a stored day ---------- */

/* The repetitions a tile starts on before anything is recorded: the top of the
   plan's range. Tapping a tile means "I did the target"; correcting downward is
   a hold away. Seeding the bottom instead would make every good set an edit. */
function seedReps(exercise) {
  return exercise.repetitions.target ?? exercise.repetitions.max;
}

function targetText(exercise) {
  const reps = exercise.repetitions;
  const amount = reps.target ? `${reps.target}` : `${reps.min}–${reps.max}`;
  return `${exercise.sets} × ${amount}${exercise.perSide ? " EACH SIDE" : ""}`;
}

/* Days written before per-set tracking existed have `sets` and `completed` but
   no `done`. A completed exercise from one of those reads as all three ticked;
   anything else reads as none, never as a half-finished set nobody recorded. */
function readExercise(record, exercise) {
  const stored = record?.exercises?.[exercise.id] || null;
  const reps = [];
  const done = [];
  for (let index = 0; index < exercise.sets; index += 1) {
    const value = stored?.sets?.[index];
    reps.push(Number.isInteger(value) && value > 0 ? value : seedReps(exercise));
    done.push(Array.isArray(stored?.done)
      ? stored.done[index] === true
      : stored?.completed === true);
  }
  return { reps, done, completed: done.every(Boolean) };
}

function readRoutine(record) {
  return plan.routine.map(exercise => ({ exercise, ...readExercise(record, exercise) }));
}

function tallyOf(routine) {
  const total = routine.reduce((sum, item) => sum + item.done.length, 0);
  const done = routine.reduce((sum, item) => sum + item.done.filter(Boolean).length, 0);
  return { done, total, complete: done === total };
}

/* ---------- the rest timer ---------- */

function stopTimer() {
  if (timer.interval) clearInterval(timer.interval);
  timer.interval = null;
}

function paintTimer() {
  const node = document.querySelector(".timer");
  if (!node) return;
  node.className = `timer ${timer.mode}`;
  node.querySelector(".k").textContent = timer.label;
  node.querySelector(".clock").textContent = timer.label === "SESSION COMPLETE"
    ? "✓"
    : `${String(Math.floor(timer.seconds / 60)).padStart(2, "0")}:${String(timer.seconds % 60).padStart(2, "0")}`;
  node.querySelector(".sub").textContent = timer.sub;
}

/* Ticks the clock in place rather than re-rendering the page every second — a
   full rebuild once a second would fight the sticky strip and drop taps. */
function runTimer() {
  stopTimer();
  timer.interval = setInterval(() => {
    if (timer.seconds <= 0) return;
    timer.seconds -= 1;
    if (timer.seconds === 0) {
      stopTimer();
      Object.assign(timer, { mode: "ready", label: "READY", sub: "Continue when you are ready" });
    }
    paintTimer();
  }, 1000);
  paintTimer();
}

function startRest({ mode, label, seconds, sub }) {
  Object.assign(timer, { mode, label, seconds, sub });
  runTimer();
}

/* What the timer should say after a set was just ticked off. */
function afterSet(routine, index) {
  const item = routine[index];
  const tally = tallyOf(routine);
  if (tally.complete) {
    stopTimer();
    Object.assign(timer, {
      mode: "ready", label: "SESSION COMPLETE", seconds: 0,
      sub: "No extra timer — finish when you are ready"
    });
    paintTimer();
    return;
  }
  const remaining = item.done.filter(value => !value).length;
  if (remaining === 0) {
    const next = routine.slice(index + 1).concat(routine.slice(0, index))
      .find(candidate => candidate.done.some(value => !value));
    startRest({
      mode: "transition", label: "NEXT EXERCISE", seconds: TRANSITION_SECONDS,
      sub: `${item.exercise.name} complete — next: ${next ? next.exercise.name : ""}`
    });
    return;
  }
  startRest({
    mode: "timer", label: "REST", seconds: REST_SECONDS,
    sub: `${item.exercise.name} · ${remaining} ${remaining === 1 ? "set remaining" : "sets remaining"}`
  });
}

/* ---------- rendering ---------- */

function makeWeekCard(schedule) {
  const card = document.createElement("section");
  card.className = "weekcard";

  const head = document.createElement("div");
  head.className = "weekhead";
  const score = document.createElement("span");
  score.className = "weekscore blk";
  score.textContent = String(schedule.completedCount);
  const copy = document.createElement("span");
  copy.className = "weekcopy blk";
  copy.textContent = "OF 3 WORKOUTS";
  const small = document.createElement("small");
  small.textContent = "THIS WEEK";
  copy.append(small);
  const range = document.createElement("span");
  range.className = "weekrange blk";
  const month = iso => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`)).toUpperCase();
  const startMonth = month(schedule.start);
  const endMonth = month(schedule.end);
  const startDay = Number(schedule.start.slice(-2));
  const endDay = Number(schedule.end.slice(-2));
  range.textContent = startMonth === endMonth
    ? `${startMonth} ${startDay}–${endDay}`
    : `${startMonth} ${startDay}–${endMonth} ${endDay}`;
  head.append(score, copy, range);
  card.append(head);

  const days = document.createElement("div");
  days.className = "weekdays";
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const today = berlinDate();
  schedule.days.forEach((day, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    const classes = ["weekday"];
    if (day.status === "completed") classes.push("done");
    else if (day.status === "missed" || day.status === "incomplete") classes.push("missed");
    else if (isRestStatus(day.status)) classes.push("rest");
    if (day.planned) classes.push("future");
    if (day.date === today) classes.push("today");
    cell.className = classes.join(" ");
    const label = document.createElement("span");
    label.textContent = labels[index];
    const number = document.createElement("b");
    number.textContent = String(Number(day.date.slice(-2)));
    cell.append(label, number);
    cell.setAttribute("aria-label", prettyDate(day.date));
    if (day.date === selectedDate) cell.setAttribute("aria-current", "date");
    cell.addEventListener("click", () => setSelectedDate(day.date));
    days.append(cell);
  });
  card.append(days);

  const legend = document.createElement("div");
  legend.className = "weeklegend";
  [["trained", "TRAINED"], ["miss", "MISSED"], ["rested", "REST"]].forEach(([kind, text]) => {
    const key = document.createElement("span");
    key.className = "key";
    const swatch = document.createElement("i");
    swatch.className = kind;
    key.append(swatch, document.createTextNode(text));
    legend.append(key);
  });
  card.append(legend);
  return card;
}

function makeDayNav() {
  const nav = document.createElement("div");
  nav.className = "daynav";
  const today = berlinDate();

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "‹";
  previous.setAttribute("aria-label", "Previous day");
  previous.addEventListener("click", () => setSelectedDate(shiftDate(selectedDate, -1)));

  const label = document.createElement("span");
  label.className = "lbl blk";
  label.textContent = selectedDate === today ? "TODAY" : prettyDate(selectedDate).split(",")[0].toUpperCase();
  const small = document.createElement("small");
  small.textContent = prettyDate(selectedDate);
  label.append(small);
  if (selectedDate !== today) {
    label.style.cursor = "pointer";
    label.addEventListener("click", () => setSelectedDate(today));
  }

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next day");
  next.addEventListener("click", () => setSelectedDate(shiftDate(selectedDate, 1)));

  nav.append(previous, label, next);
  return nav;
}

function makeSectionHeader(tally) {
  const section = document.createElement("div");
  section.className = "sec";
  const title = document.createElement("span");
  title.className = "t blk";
  title.textContent = "FULL BODY";
  const rule = document.createElement("span");
  rule.className = "r";
  const count = document.createElement("span");
  count.className = "n blk";
  count.textContent = `${tally.done}/${tally.total}`;
  section.append(title, rule, count);
  return section;
}

function makeTimer() {
  const wrap = document.createElement("div");
  wrap.className = "timerwrap";
  const node = document.createElement("div");
  node.className = `timer ${timer.mode}`;
  node.setAttribute("aria-live", "polite");

  const main = document.createElement("div");
  main.className = "timer-main";
  const copy = document.createElement("div");
  copy.className = "timer-copy";
  const kicker = document.createElement("div");
  kicker.className = "k blk";
  const clock = document.createElement("div");
  clock.className = "clock";
  copy.append(kicker, clock);

  const acts = document.createElement("div");
  acts.className = "acts";
  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+30S";
  plus.addEventListener("click", () => {
    timer.seconds += 30;
    if (timer.mode === "ready") timer.mode = "timer";
    runTimer();
  });
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "SKIP";
  skip.addEventListener("click", () => {
    stopTimer();
    Object.assign(timer, { mode: "ready", label: "READY", seconds: 0, sub: "Continue when you are ready" });
    paintTimer();
  });
  acts.append(plus, skip);
  main.append(copy, acts);

  const sub = document.createElement("div");
  sub.className = "sub";
  node.append(main, sub);
  wrap.append(node);
  return wrap;
}

function makeSetTile(item, index, editable) {
  const { exercise, reps, done } = item;
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "settile";
  tile.setAttribute("aria-pressed", done[index] ? "true" : "false");
  tile.setAttribute("aria-label", `${exercise.name}, set ${index + 1}, ${reps[index]} repetitions`);
  tile.disabled = !editable;

  const top = document.createElement("span");
  top.className = "toprow";
  const label = document.createElement("span");
  label.className = "setlabel";
  label.textContent = `SET ${index + 1}`;
  const state = document.createElement("span");
  state.className = "state";
  state.textContent = done[index] ? "DONE" : "";
  top.append(label, state);

  const bottom = document.createElement("span");
  bottom.className = "botrow";
  const value = document.createElement("span");
  value.className = "repvalue";
  value.textContent = String(reps[index]);
  const unit = document.createElement("span");
  unit.className = "unit";
  unit.textContent = exercise.perSide ? "EACH SIDE" : "REPS";
  bottom.append(value, unit);

  tile.append(top, bottom);

  if (editable) {
    tile.addEventListener("click", () => {
      if (held) { held = false; return; }
      toggleSet(exercise, index);
    });
    tile.addEventListener("pointerdown", () => {
      cancelHold();
      held = false;
      holdTimer = setTimeout(() => {
        held = true;
        editing = { id: exercise.id, index };
        renderAuthenticated();
      }, HOLD_MS);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(event =>
      tile.addEventListener(event, cancelHold));
    tile.addEventListener("contextmenu", event => event.preventDefault());
  }
  return tile;
}

function makeEditBar(item) {
  const { exercise, reps } = item;
  const bar = document.createElement("div");
  bar.className = "editbar";

  const label = document.createElement("label");
  label.textContent = `SET ${editing.index + 1} · REPETITIONS`;
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "numeric";
  input.min = "1";
  input.max = "999";
  input.step = "1";
  input.value = String(reps[editing.index]);
  label.append(input);

  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "APPLY";

  const commit = () => {
    const entered = Number(input.value);
    const next = Number.isInteger(entered) && entered > 0 ? Math.min(entered, 999) : reps[editing.index];
    const index = editing.index;
    editing = null;
    saveSetReps(exercise, index, next);
  };
  apply.addEventListener("click", commit);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
  });

  bar.append(label, apply);
  return bar;
}

function makeExerciseCard(item, editable) {
  const { exercise, done } = item;
  const doneCount = done.filter(Boolean).length;
  const card = document.createElement("article");
  const classes = ["exercise"];
  if (exercise.priority) classes.push("priority");
  if (doneCount === done.length) classes.push("done");
  card.className = classes.join(" ");

  const head = document.createElement("div");
  head.className = "exhead";
  const name = document.createElement("span");
  name.className = "exname";
  name.textContent = exercise.name;
  const count = document.createElement("span");
  count.className = "excount";
  count.textContent = `${doneCount}/${done.length}`;
  head.append(name, count);
  card.append(head);

  const target = document.createElement("div");
  target.className = "extarget";
  target.textContent = `TARGET · ${targetText(exercise)}`;
  card.append(target);

  if (exercise.note) {
    const note = document.createElement("div");
    note.className = "exnote";
    note.textContent = exercise.note;
    card.append(note);
  }

  const results = document.createElement("div");
  results.className = "results";
  for (let index = 0; index < exercise.sets; index += 1) {
    results.append(makeSetTile(item, index, editable));
  }
  card.append(results);

  if (editable && editing?.id === exercise.id) card.append(makeEditBar(item));
  return card;
}

function makeSignoff(tally) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "signoff";
  button.setAttribute("aria-pressed", "false");
  button.disabled = !tally.complete || writePending;

  const box = document.createElement("span");
  box.className = "box";
  box.textContent = "END";

  const copy = document.createElement("span");
  copy.className = "copy";
  const title = document.createElement("b");
  title.className = "blk";
  title.textContent = "DONE";
  const note = document.createElement("span");
  note.textContent = tally.complete
    ? "Finish the session and mark Physical training done on the daily page."
    : `${tally.total - tally.done} of ${tally.total} sets still to go.`;
  copy.append(title, note);

  button.append(box, copy);
  button.addEventListener("click", completeWorkout);
  return button;
}

function renderSignedOut() {
  clearExerciseData();
  setChip("off", "SIGNED OUT");
  setSync("", "Signed out — nothing is loaded from this browser.", { label: "Sign in", run: signIn });
  $("footer").hidden = true;
  showPanel("Sign in to view workouts", "Exercise results are stored in Firebase and are never loaded from this browser while signed out.", {
    action: { label: "Sign in with Google", run: signIn }
  });
}

function renderAuthenticated() {
  const today = berlinDate();
  const schedule = buildWeekSchedule({ selectedDate, todayDate: today, records: weekRecords });
  const day = schedule.selected;
  const editable = day.status === "workout" && selectedDate === today && !writePending;
  const routine = readRoutine(day.record);
  const tally = tallyOf(routine);

  const nodes = [makeWeekCard(schedule), makeDayNav()];

  if (isRestStatus(day.status)) {
    const rest = document.createElement("div");
    rest.className = "restday";
    rest.textContent = "This is a rest day";
    const small = document.createElement("small");
    small.textContent = `${schedule.completedCount} OF 3 WORKOUTS COMPLETED THIS WEEK`;
    rest.append(small);
    nodes.push(rest);
    content.replaceChildren(...nodes);
    $("footer").hidden = true;
    return;
  }

  if (day.status === "missed" && !day.record) {
    nodes.push(panel("Missed", "No completed workout was recorded for this eligible day."));
    content.replaceChildren(...nodes);
    $("footer").hidden = true;
    return;
  }

  if (day.status === "planned-workout") {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.textContent = "PLANNED PREVIEW · NO RESULTS CAN BE ENTERED FOR A FUTURE DATE";
    nodes.push(banner);
  } else if (day.status === "completed") {
    nodes.push(panel("Workout completed", `Recorded workout session ${day.sessionNumber} of 3. Review only.`));
  } else if (day.status === "incomplete") {
    nodes.push(panel("Missed / incomplete", "Some results were recorded, but the session was never signed off. Review only."));
  }

  nodes.push(makeSectionHeader(tally));
  if (editable) nodes.push(makeTimer());

  const main = document.createElement("main");
  routine.forEach(item => main.append(makeExerciseCard(item, editable)));
  nodes.push(main);

  if (editable) nodes.push(makeSignoff(tally));

  content.replaceChildren(...nodes);
  $("footer").hidden = !editable;
  if (editable) paintTimer();
}

function render() {
  if (!authResolved) {
    setChip("off", "CHECKING");
    setSync("", "Checking sign-in…");
    $("footer").hidden = true;
    showPanel("Checking sign-in", "Exercises stay hidden until Firebase authentication resolves.");
    return;
  }
  if (!user) {
    renderSignedOut();
    return;
  }
  setChip("", "SYNCED");
  setSync("on", "Synced as your account", { label: "Sign out", run: signOutNow });
  renderAuthenticated();
}

/* ---------- reads ---------- */

async function readSelectedWeek(reason) {
  if (!user || !db || !fb) return;
  const uid = user.uid;
  const range = weekRange(selectedDate);
  const key = `${uid}:${range.start}:${range.end}`;
  if (inFlight?.key === key) return inFlight.promise;
  if (weekRecords.size === 0) {
    showPanel("Loading workout week", `Reading ${range.start} through ${range.end} from the server…`);
  }

  const promise = (async () => {
    try {
      const collection = fb.collection(db, "users", uid, "exerciseDays");
      const request = fb.query(collection,
        fb.where(fb.documentId(), ">=", range.start),
        fb.where(fb.documentId(), "<=", range.end),
        fb.orderBy(fb.documentId(), "asc"));
      const previousSunday = shiftDate(range.start, -1);
      const [snapshot, previousSnapshot] = await Promise.all([
        fb.getDocsFromServer(request),
        fb.getDocFromServer(fb.doc(db, "users", uid, "exerciseDays", previousSunday))
      ]);
      if (!user || user.uid !== uid) return;
      const fresh = new Map();
      snapshot.forEach(doc => fresh.set(doc.id, doc.data()));
      if (previousSnapshot.exists()) fresh.set(previousSnapshot.id, previousSnapshot.data());
      weekRecords = fresh;
      render();
    } catch (error) {
      if (!user || user.uid !== uid) return;
      weekRecords = new Map();
      setChip("err", "OFFLINE");
      setSync("err", "Could not reach Firebase.", { label: "Sign out", run: signOutNow });
      showPanel("Connection error", "Current workout data could not be read from Firebase. Cached browser data is not shown.", {
        error: true,
        action: { label: "Retry", run: () => readSelectedWeek("retry") }
      });
      console.error(`Exercise server read failed (${reason})`, error);
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  })();
  inFlight = { key, promise };
  return promise;
}

/* ---------- writes ---------- */

/* Every set write sends the whole exercise entry — three repetitions, three
   done flags, and the derived completion — as one nested field, so a tap can
   never leave `sets` and `done` disagreeing about how many sets exist. */
function exercisePayload(item) {
  return { sets: item.reps, done: item.done, completed: item.done.every(Boolean) };
}

function cancelHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
}

/* Applies a change to today's record locally, paints it, then writes. The paint
   comes first on purpose: a set tile that waits for a round trip before it
   darkens feels broken mid-workout. A rejected write puts the old value back. */
async function commitExercise(exercise, mutate) {
  if (!user || writePending || selectedDate !== berlinDate()) return;
  const previous = weekRecords.get(selectedDate);
  const item = { exercise, ...readExercise(previous, exercise) };
  mutate(item);

  const record = {
    date: selectedDate,
    planVersion: PLAN_VERSION,
    workoutCompleted: previous?.workoutCompleted === true,
    ...previous,
    exercises: { ...(previous?.exercises || {}), [exercise.id]: exercisePayload(item) }
  };
  weekRecords.set(selectedDate, record);
  renderAuthenticated();

  const ref = fb.doc(db, "users", user.uid, "exerciseDays", selectedDate);
  try {
    if (previous) {
      await fb.updateDoc(ref,
        new fb.FieldPath("exercises", exercise.id), exercisePayload(item),
        "updatedAt", fb.serverTimestamp());
    } else {
      await fb.setDoc(ref, {
        date: selectedDate,
        planVersion: PLAN_VERSION,
        exercises: { [exercise.id]: exercisePayload(item) },
        workoutCompleted: false,
        updatedAt: fb.serverTimestamp()
      });
    }
    await readSelectedWeek("successful exercise write");
  } catch (error) {
    if (previous) weekRecords.set(selectedDate, previous);
    else weekRecords.delete(selectedDate);
    renderAuthenticated();
    setChip("err", "NOT SAVED");
    setSync("err", "That set did not save. Check the connection.", { label: "Retry", run: () => readSelectedWeek("retry") });
    console.error("Exercise write failed", error);
  }
}

function toggleSet(exercise, index) {
  editing = null;
  commitExercise(exercise, item => { item.done[index] = !item.done[index]; });
  // The timer reacts to the routine as it now stands, after the local mutation.
  const routine = readRoutine(weekRecords.get(selectedDate));
  const position = routine.findIndex(entry => entry.exercise.id === exercise.id);
  if (routine[position]?.done[index]) afterSet(routine, position);
}

function saveSetReps(exercise, index, reps) {
  commitExercise(exercise, item => { item.reps[index] = reps; });
}

async function completeWorkout() {
  if (!user || writePending || selectedDate !== berlinDate()) return;
  const record = weekRecords.get(selectedDate);
  const routine = readRoutine(record);
  if (!tallyOf(routine).complete) return;

  const schedule = buildWeekSchedule({ selectedDate, todayDate: berlinDate(), records: weekRecords });
  if (schedule.selected.status !== "workout" || schedule.completedCount >= 3) return;

  const uid = user.uid;
  writePending = true;
  renderAuthenticated();
  try {
    await fb.setDoc(fb.doc(db, "users", uid, "exerciseDays", selectedDate), {
      date: selectedDate,
      planVersion: PLAN_VERSION,
      workoutCompleted: true,
      updatedAt: fb.serverTimestamp()
    }, { merge: true });
    await tickDailyPlan(uid);
    await readSelectedWeek("successful workout completion");
  } catch (error) {
    showPanel("Save failed", "The workout was not marked complete. Check the connection and retry.", {
      error: true,
      action: { label: "Retry", run: completeWorkout }
    });
    console.error("Workout completion failed", error);
  } finally {
    writePending = false;
  }
}

/* Ticks Physical training on the DailyPlan day. Only the tick is written: this
   page has no copy of daily.json and so cannot compute the day's XP, which
   DailyPlan recomputes from its own ticks the next time it renders. A failure
   here must not fail the workout — the session is already signed off. */
async function tickDailyPlan(uid) {
  const ref = fb.doc(db, "users", uid, "days", selectedDate);
  try {
    await fb.setDoc(ref, {
      date: selectedDate,
      ticks: { [DAILY_TICK_ID]: true },
      updatedAt: fb.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error("Daily plan tick failed", error);
  }
}

/* ---------- auth ---------- */

async function signIn() {
  if (!auth) return;
  try {
    await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
  } catch (error) {
    if (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment") {
      await fb.signInWithRedirect(auth, new fb.GoogleAuthProvider());
      return;
    }
    showPanel("Sign-in failed", "Google sign-in did not complete. Please try again.", { error: true, action: { label: "Retry", run: signIn } });
  }
}

async function signOutNow() {
  if (!auth) return;
  user = null;
  clearExerciseData();
  renderSignedOut();
  try { await fb.signOut(auth); } catch (error) { console.error("Sign-out failed", error); }
}

async function boot() {
  render();
  try {
    const planRequest = fetch(`../dailyplan/plan.json?v=${PLAN_VERSION}`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(`Plan request failed: ${response.status}`);
      const value = await response.json();
      if (value.schemaVersion !== PLAN_VERSION || value.timezone !== "Europe/Berlin" || value.routine?.length !== ROUTINE_SIZE) throw new Error("Unsupported exercise plan");
      return value;
    });
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]);
    plan = await planRequest;
    const app = initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db = firestoreModule.getFirestore(app);
    fb = { ...authModule, ...firestoreModule };
    await authModule.getRedirectResult(auth).catch(() => null);
    authModule.onAuthStateChanged(auth, async nextUser => {
      clearExerciseData();
      user = nextUser;
      authResolved = true;
      if (!user) renderSignedOut();
      else await readSelectedWeek("authentication resolved");
    });
  } catch (error) {
    authResolved = true;
    user = null;
    clearExerciseData();
    showPanel("Exercise unavailable", "Firebase or the exercise plan could not be loaded. Reload to retry.", { error: true, action: { label: "Reload", run: () => location.reload() } });
    console.error("Exercise boot failed", error);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authResolved && user) readSelectedWeek("page visible");
});
window.addEventListener("pageshow", () => {
  if (initialPageShow) { initialPageShow = false; return; }
  if (authResolved && user) readSelectedWeek("page re-entry");
});

boot();
