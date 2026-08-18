const DAY_MS = 86_400_000;

function parts(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) throw new Error(`Invalid calendar date: ${iso}`);
  const [year, month, day] = iso.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  return { year, month, day, utc };
}

export function shiftDate(iso, days) {
  const { utc } = parts(iso);
  const d = new Date(utc + days * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function compareDates(a, b) {
  return Math.sign(parts(a).utc - parts(b).utc);
}

export function mondayOf(iso) {
  const { utc } = parts(iso);
  const sundayZero = new Date(utc).getUTCDay();
  return shiftDate(iso, -((sundayZero + 6) % 7));
}

export function weekRange(iso) {
  const start = mondayOf(iso);
  return { start, end: shiftDate(start, 6) };
}

export function berlinDate(at = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(at).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function recordMap(records) {
  if (records instanceof Map) return records;
  return new Map(Object.entries(records || {}));
}

function hasPartialData(record) {
  return !!record && Object.keys(record.exercises || {}).length > 0;
}

/**
 * Derive one Monday-Sunday week without stored weekly state. Actual completed
 * documents drive past/today; future days assume each next eligible workout is
 * completed so previews include the following rest day.
 */
export function buildWeekSchedule({ selectedDate, todayDate, records, sessionsPerWeek = 3, targetOffsets = [0, 2, 4] }) {
  const { start, end } = weekRange(selectedDate);
  const byDate = recordMap(records);
  const actualCompletionDates = [...byDate.entries()]
    .filter(([date, value]) => date >= start && date <= end && date <= todayDate && value?.workoutCompleted === true)
    .map(([date]) => date)
    .sort()
    .slice(0, sessionsPerWeek);
  const counted = new Set(actualCompletionDates);
  const days = [];
  let completed = 0;
  const previousSunday = shiftDate(start, -1);
  let previousCompletionOffset = byDate.get(previousSunday)?.workoutCompleted === true && previousSunday <= todayDate
    ? -1
    : null;

  for (let offset = 0; offset < 7; offset += 1) {
    const date = shiftDate(start, offset);
    const record = byDate.get(date) || null;
    const relation = compareDates(date, todayDate);
    let status;
    let planned = false;
    let sessionNumber = null;

    if (counted.has(date)) {
      completed += 1;
      previousCompletionOffset = offset;
      status = "completed";
      sessionNumber = completed;
    } else if (completed >= sessionsPerWeek) {
      status = relation > 0 ? "planned-rest" : "rest";
      planned = relation > 0;
    } else if (previousCompletionOffset !== null && offset === previousCompletionOffset + 1) {
      status = relation > 0 ? "planned-rest" : "rest";
      planned = relation > 0;
    } else {
      const nominalOffset = targetOffsets[completed] ?? 7;
      const recoveryOffset = previousCompletionOffset === null ? 0 : previousCompletionOffset + 2;
      const dueOffset = Math.max(nominalOffset, recoveryOffset);

      if (offset < dueOffset) {
        status = relation > 0 ? "planned-rest" : "rest";
        planned = relation > 0;
      } else if (relation < 0) {
        status = hasPartialData(record) ? "incomplete" : "missed";
        sessionNumber = completed + 1;
      } else if (relation === 0) {
        status = "workout";
        sessionNumber = completed + 1;
        // Future previews assume today's due workout will be completed.
        completed += 1;
        previousCompletionOffset = offset;
      } else {
        status = "planned-workout";
        planned = true;
        sessionNumber = completed + 1;
        completed += 1;
        previousCompletionOffset = offset;
      }
    }

    days.push({ date, status, planned, sessionNumber, record });
  }

  return {
    start,
    end,
    completedCount: actualCompletionDates.length,
    days,
    selected: days.find(day => day.date === selectedDate)
  };
}

export function isRestStatus(status) {
  return status === "rest" || status === "planned-rest";
}
