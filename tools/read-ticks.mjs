#!/usr/bin/env node
/* Read tick documents out of Firestore, for Claude Code.
 *
 * Credentials and the Firestore plumbing live in firebase-admin.mjs — either a
 * local service-account key or the FIREBASE_SA_* environment variables a cloud
 * session carries. See that file for setup.
 *
 * Usage:
 *   node tools/read-ticks.mjs --uid <UID>              # last 14 days
 *   node tools/read-ticks.mjs --uid <UID> --days 30
 *   node tools/read-ticks.mjs --uid <UID> --date 2026-07-30
 *   node tools/read-ticks.mjs --uid <UID> --json       # raw, for piping
 */

import { connect } from "./firebase-admin.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const uid = arg("uid");
  if (!uid) {
    console.error("Need --uid. It's printed in the page's handoff block, or in\n" +
                  "Firebase console -> Authentication -> Users.");
    process.exit(2);
  }

  let db;
  try {
    db = await connect();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  const one = arg("date");

  let days = [];
  if (typeof one === "string") {
    const doc = await db.get(`users/${uid}/days/${one}`);
    if (doc) days = [{ date: one, ...doc }];
  } else {
    days = (await db.list(`users/${uid}/days`)).map(({ id, ...rest }) => ({ date: id, ...rest }));
    const limit = Number(arg("days", 14));
    days.sort((a, b) => a.date.localeCompare(b.date));
    if (Number.isFinite(limit) && limit > 0) days = days.slice(-limit);
  }

  if (arg("json")) {
    console.log(JSON.stringify(days, null, 2));
    return;
  }

  if (!days.length) {
    console.log(`No tick documents found under users/${uid}/days.`);
    return;
  }
  for (const d of days) {
    const ticks = d.ticks || {};
    const on = Object.keys(ticks).filter(k => ticks[k]).sort();
    const offered = Array.isArray(d.items) ? d.items.length : null;
    const score = offered === null ? `${on.length} ticked` : `${on.length}/${offered}`;
    console.log(`${d.date}  ${score}`);
    if (on.length) console.log("  did:     " + on.join(", "));
    if (offered) {
      const missed = d.items.filter(i => !ticks[i]);
      if (missed.length) console.log("  skipped: " + missed.join(", "));
    }
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
