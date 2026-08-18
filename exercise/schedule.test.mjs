import test from "node:test";
import assert from "node:assert/strict";
import { berlinDate, buildWeekSchedule, mondayOf, shiftDate, weekRange } from "./schedule.mjs";

const completed = date => ({ [date]: { date, workoutCompleted: true, exercises: {} } });
const status = (date, today, records = {}) => buildWeekSchedule({ selectedDate: date, todayDate: today, records }).selected.status;

test("Monday completion makes Tuesday rest and Wednesday due", () => {
  const records = completed("2026-08-17");
  assert.equal(status("2026-08-18", "2026-08-18", records), "rest");
  assert.equal(status("2026-08-19", "2026-08-19", records), "workout");
});

test("a missed Monday remains due Tuesday", () => {
  assert.equal(status("2026-08-18", "2026-08-18"), "workout");
});

test("Tuesday catch-up creates Wednesday rest and Thursday workout", () => {
  const records = completed("2026-08-18");
  assert.equal(status("2026-08-19", "2026-08-19", records), "rest");
  assert.equal(status("2026-08-20", "2026-08-20", records), "workout");
});

test("missing Wednesday after Monday completion makes Thursday due", () => {
  const records = completed("2026-08-17");
  assert.equal(status("2026-08-20", "2026-08-20", records), "workout");
});

test("three completions make the rest of the week rest days", () => {
  const records = {
    ...completed("2026-08-17"),
    ...completed("2026-08-19"),
    ...completed("2026-08-21"),
    ...completed("2026-08-22")
  };
  const week = buildWeekSchedule({ selectedDate: "2026-08-23", todayDate: "2026-08-23", records });
  assert.equal(week.completedCount, 3);
  assert.equal(week.selected.status, "rest");
});

test("new Monday starts empty and prior-week unfinished work does not carry", () => {
  const records = { "2026-08-23": { date: "2026-08-23", workoutCompleted: false, exercises: { "push-ups": {} } } };
  const week = buildWeekSchedule({ selectedDate: "2026-08-24", todayDate: "2026-08-24", records });
  assert.equal(week.start, "2026-08-24");
  assert.equal(week.completedCount, 0);
  assert.equal(week.selected.status, "workout");
});

test("a Sunday completion creates Monday rest without counting in the new week", () => {
  const records = completed("2026-08-23");
  const monday = buildWeekSchedule({ selectedDate: "2026-08-24", todayDate: "2026-08-24", records });
  const tuesday = buildWeekSchedule({ selectedDate: "2026-08-25", todayDate: "2026-08-25", records });
  assert.equal(monday.completedCount, 0);
  assert.equal(monday.selected.status, "rest");
  assert.equal(tuesday.selected.status, "workout");
});

test("partial exercise data never counts as a completed session", () => {
  const records = { "2026-08-17": { date: "2026-08-17", workoutCompleted: false, exercises: { "push-ups": { sets: [12, 12, 12] } } } };
  const week = buildWeekSchedule({ selectedDate: "2026-08-18", todayDate: "2026-08-18", records });
  assert.equal(week.completedCount, 0);
  assert.equal(week.days[0].status, "incomplete");
  assert.equal(week.selected.status, "workout");
});

test("Monday weeks and date arithmetic cross month and year boundaries", () => {
  assert.deepEqual(weekRange("2027-01-01"), { start: "2026-12-28", end: "2027-01-03" });
  assert.equal(mondayOf("2026-08-23"), "2026-08-17");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});

test("Europe/Berlin calendar dates remain correct across DST transitions", () => {
  assert.equal(berlinDate(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
  assert.equal(berlinDate(new Date("2026-03-29T22:30:00Z")), "2026-03-30");
  assert.equal(berlinDate(new Date("2026-10-25T23:30:00Z")), "2026-10-26");
});

test("future previews assume each next eligible workout is completed", () => {
  const week = buildWeekSchedule({ selectedDate: "2026-08-17", todayDate: "2026-08-10", records: {} });
  assert.deepEqual(week.days.map(day => day.status), [
    "planned-workout", "planned-rest", "planned-workout", "planned-rest", "planned-workout", "planned-rest", "planned-rest"
  ]);
});
