/* Publishes firestore.rules to the live project.
 *
 * The Firebase CLI does the same thing with a browser login this environment
 * doesn't have, so this talks to the Rules API directly with the same
 * service-account credentials everything else here uses. Two steps: upload the
 * file as a ruleset, then point the cloud.firestore release at it.
 *
 *   node tools/rules-deploy.mjs             # deploy firestore.rules
 *   node tools/rules-deploy.mjs --dry-run   # upload and report, release untouched
 *
 * Run tools/rules-check.mjs first. A bad ruleset here is live immediately.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCredentials, accessToken } from "./firebase-admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const dryRun = process.argv.includes("--dry-run");

const sa = await loadCredentials();
const token = await accessToken(sa, SCOPE);
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = `https://firebaserules.googleapis.com/v1`;

const source = await readFile(join(ROOT, "firestore.rules"), "utf8");

const created = await (await fetch(`${api}/projects/${sa.project_id}/rulesets`, {
  method: "POST",
  headers,
  body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content: source }] } })
})).json();

if (created.error) {
  console.error("Upload failed:", JSON.stringify(created.error, null, 2));
  process.exit(1);
}
console.log("ruleset:", created.name);

if (dryRun) {
  console.log("--dry-run: the live release still points at the previous ruleset.");
  process.exit(0);
}

const releaseName = `projects/${sa.project_id}/releases/cloud.firestore`;
const released = await (await fetch(`${api}/${releaseName}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ release: { name: releaseName, rulesetName: created.name } })
})).json();

if (released.error) {
  console.error("Release failed:", JSON.stringify(released.error, null, 2));
  process.exit(1);
}
console.log("released:", released.rulesetName);
console.log("live.");
