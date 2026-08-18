import { berlinDate, buildWeekSchedule, isRestStatus, shiftDate, weekRange } from "./schedule.mjs";
import { firebaseConfig } from "../dailyplan/firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.16.0/";
const PLAN_VERSION = 2;
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

function initialDate() {
  const value = new URLSearchParams(location.search).get("date");
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : berlinDate();
}

function prettyDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function updateDateHeader() {
  const today = berlinDate();
  $("selectedLabel").textContent = selectedDate === today ? "Today" : prettyDate(selectedDate).split(",")[0];
  $("selectedDate").textContent = prettyDate(selectedDate);
  $("todayBtn").hidden = selectedDate === today;
}

function setSelectedDate(date) {
  selectedDate = date;
  const url = new URL(location.href);
  url.searchParams.set("date", selectedDate);
  history.replaceState(null, "", url);
  updateDateHeader();
  if (authResolved && user) readSelectedWeek("date change");
  else render();
}

function clearExerciseData() {
  weekRecords = new Map();
  inFlight = null;
  writePending = false;
}

function showPanel(title, message, { error = false, action = null } = {}) {
  content.replaceChildren();
  const panel = document.createElement("div");
  panel.className = `panel${error ? " error" : ""}`;
  panel.innerHTML = `<div class="auth-row"><div class="auth-copy"><strong></strong><span></span></div></div>`;
  panel.querySelector("strong").textContent = title;
  panel.querySelector("span").textContent = message;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    panel.querySelector(".auth-row").append(button);
  }
  content.append(panel);
}

function renderSignedOut() {
  clearExerciseData();
  $("authBtn").hidden = false;
  $("authBtn").textContent = "Sign in";
  showPanel("Sign in to view workouts", "Exercise results are stored in Firebase and are never loaded from this browser while signed out.", {
    action: { label: "Sign in with Google", run: signIn }
  });
}

function targetLabel(exercise) {
  const reps = exercise.repetitions;
  const amount = reps.target ? `${reps.target} reps` : `${reps.min}–${reps.max} reps`;
  return `${exercise.sets} sets · ${amount}${exercise.perSide ? " per leg" : ""}`;
}

function makeWeekStrip(schedule) {
  const strip = document.createElement("div");
  strip.className = "week";
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  schedule.days.forEach((day, index) => {
    const cell = document.createElement("div");
    const classes = ["week-day"];
    if (day.date === selectedDate) classes.push("selected");
    if (day.status === "completed") classes.push("done");
    if (day.status === "missed" || day.status === "incomplete") classes.push("missed");
    if (day.planned) classes.push("planned");
    cell.className = classes.join(" ");
    cell.innerHTML = `${labels[index]}<b>${Number(day.date.slice(-2))}</b>`;
    strip.append(cell);
  });
  return strip;
}

function stateCopy(day, schedule) {
  switch (day.status) {
    case "completed": return ["Workout completed", `Recorded workout session ${day.sessionNumber} of 3. Review only.`];
    case "workout": return ["Workout due", `Workout session ${day.sessionNumber} of 3 is eligible today.`];
    case "planned-workout": return ["Planned workout", `Projected workout session ${day.sessionNumber} of 3. This preview is read-only.`];
    case "incomplete": return ["Missed / incomplete", "Some results were recorded, but workoutCompleted is false. Review only."];
    case "missed": return ["Missed / incomplete", "No completed workout was recorded for this eligible day."];
    default: return ["Rest day", `${schedule.completedCount} of 3 workout sessions completed in this week.`];
  }
}

function renderExercise(exercise, day) {
  const recorded = day.record?.exercises?.[exercise.id] || null;
  const editable = day.status === "workout" && selectedDate === berlinDate() && !writePending;
  const preview = day.status === "planned-workout";
  const card = document.createElement("article");
  card.className = "exercise";
  const head = document.createElement("div");
  head.className = "exercise-head";
  head.innerHTML = `<div class="exercise-title"><h3></h3><p></p></div><span class="badge">3 sets</span>`;
  head.querySelector("h3").textContent = exercise.name;
  head.querySelector("p").textContent = [targetLabel(exercise), exercise.note].filter(Boolean).join(" · ");
  card.append(head);

  const sets = document.createElement("div");
  sets.className = "sets";
  for (let index = 0; index < exercise.sets; index += 1) {
    const wrap = document.createElement("div");
    wrap.className = "set";
    const value = recorded?.sets?.[index];
    const suggested = exercise.repetitions.target ?? exercise.repetitions.min;
    const label = document.createElement("label");
    label.textContent = `Set ${index + 1}`;
    wrap.append(label);
    if (editable) {
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";
      input.min = "1";
      input.max = "999";
      input.step = "1";
      input.value = Number.isInteger(value) ? String(value) : "";
      input.placeholder = String(suggested);
      input.dataset.setIndex = String(index);
      input.setAttribute("aria-label", `${exercise.name}, set ${index + 1} repetitions`);
      wrap.append(input);
    } else {
      const display = document.createElement("div");
      display.className = "set-value";
      display.textContent = Number.isInteger(value) ? String(value) : preview ? String(suggested) : "—";
      wrap.append(display);
    }
    sets.append(wrap);
  }
  card.append(sets);

  if (editable) {
    const actions = document.createElement("div");
    actions.className = "exercise-actions";
    const checked = recorded?.completed === true;
    actions.innerHTML = `<label><input type="checkbox" ${checked ? "checked" : ""}> Exercise complete</label><button type="button">Save exercise</button>`;
    actions.querySelector("button").addEventListener("click", () => saveExercise(exercise, card));
    card.append(actions);
    const status = document.createElement("div");
    status.className = "save-status";
    status.setAttribute("aria-live", "polite");
    card.append(status);
  }
  return card;
}

function renderAuthenticated() {
  const today = berlinDate();
  const schedule = buildWeekSchedule({ selectedDate, todayDate: today, records: weekRecords });
  const day = schedule.selected;
  content.replaceChildren(makeWeekStrip(schedule));

  const state = document.createElement("section");
  state.className = "state";
  const [title, message] = stateCopy(day, schedule);
  state.innerHTML = "<h2></h2><p></p>";
  state.querySelector("h2").textContent = title;
  state.querySelector("p").textContent = message;
  content.append(state);

  if (isRestStatus(day.status)) {
    const rest = document.createElement("div");
    rest.className = "rest-day";
    rest.textContent = "This is a rest day";
    content.append(rest);
    return;
  }

  if (day.status === "missed" && !day.record) return;
  if (day.status === "planned-workout") {
    const banner = document.createElement("div");
    banner.className = "planned-banner";
    banner.textContent = "Planned preview · no results can be entered for a future date";
    content.append(banner);
  }
  const routine = document.createElement("div");
  routine.className = "routine";
  plan.routine.forEach(exercise => routine.append(renderExercise(exercise, day)));
  content.append(routine);

  if (day.status === "workout" && selectedDate === today) {
    const done = document.createElement("div");
    done.className = "done-wrap";
    done.innerHTML = "<button type=\"button\">DONE · Complete workout session</button><p>Save all seven exercises as complete first. Completion creates tomorrow's required rest day.</p>";
    done.querySelector("button").disabled = writePending;
    done.querySelector("button").addEventListener("click", completeWorkout);
    content.append(done);
  }
}

function render() {
  updateDateHeader();
  if (!authResolved) {
    $("authBtn").hidden = true;
    showPanel("Checking sign-in", "Exercises stay hidden until Firebase authentication resolves.");
    return;
  }
  if (!user) {
    renderSignedOut();
    return;
  }
  $("authBtn").hidden = false;
  $("authBtn").textContent = "Sign out";
  renderAuthenticated();
}

async function readSelectedWeek(reason) {
  if (!user || !db || !fb) return;
  const uid = user.uid;
  const range = weekRange(selectedDate);
  const key = `${uid}:${range.start}:${range.end}`;
  if (inFlight?.key === key) return inFlight.promise;
  showPanel("Loading workout week", `Reading ${range.start} through ${range.end} from the server…`);

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
      renderAuthenticated();
    } catch (error) {
      if (!user || user.uid !== uid) return;
      weekRecords = new Map();
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

async function saveExercise(exercise, card) {
  if (!user || writePending || selectedDate !== berlinDate()) return;
  const inputs = [...card.querySelectorAll("input[type=number]")];
  const sets = inputs.map(input => Number(input.value));
  const status = card.querySelector(".save-status");
  if (sets.length !== exercise.sets || sets.some(value => !Number.isInteger(value) || value < 1 || value > 999)) {
    status.textContent = "Enter a whole-number repetition count for all three sets.";
    return;
  }
  const completed = card.querySelector("input[type=checkbox]").checked;
  const uid = user.uid;
  const ref = fb.doc(db, "users", uid, "exerciseDays", selectedDate);
  const existing = weekRecords.get(selectedDate);
  writePending = true;
  let saved = false;
  status.textContent = "Saving…";
  try {
    if (existing) {
      await fb.updateDoc(ref,
        new fb.FieldPath("exercises", exercise.id), { sets, completed },
        "updatedAt", fb.serverTimestamp());
    } else {
      await fb.setDoc(ref, {
        date: selectedDate,
        planVersion: PLAN_VERSION,
        exercises: { [exercise.id]: { sets, completed } },
        workoutCompleted: false,
        updatedAt: fb.serverTimestamp()
      });
    }
    await readSelectedWeek("successful exercise write");
    saved = true;
  } catch (error) {
    status.textContent = "Save failed. Check the connection and try again.";
    console.error("Exercise write failed", error);
  } finally {
    writePending = false;
    if (saved && user) renderAuthenticated();
  }
}

async function completeWorkout() {
  if (!user || writePending || selectedDate !== berlinDate()) return;
  const record = weekRecords.get(selectedDate);
  const allComplete = plan.routine.every(exercise => {
    const value = record?.exercises?.[exercise.id];
    return value?.completed === true && Array.isArray(value.sets) && value.sets.length === exercise.sets;
  });
  if (!allComplete) {
    alert("Save all seven exercises as complete before completing this workout session.");
    return;
  }
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
      if (value.schemaVersion !== PLAN_VERSION || value.timezone !== "Europe/Berlin" || value.routine?.length !== 7) throw new Error("Unsupported exercise plan");
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

$("previousBtn").addEventListener("click", () => setSelectedDate(shiftDate(selectedDate, -1)));
$("todayBtn").addEventListener("click", () => setSelectedDate(berlinDate()));
$("nextBtn").addEventListener("click", () => setSelectedDate(shiftDate(selectedDate, 1)));
$("authBtn").addEventListener("click", () => user ? signOutNow() : signIn());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authResolved && user) readSelectedWeek("page visible");
});
window.addEventListener("pageshow", () => {
  if (initialPageShow) { initialPageShow = false; return; }
  if (authResolved && user) readSelectedWeek("page re-entry");
});

boot();
