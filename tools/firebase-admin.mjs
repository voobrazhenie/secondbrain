/* Shared Firestore admin access for Claude Code sessions.
 *
 * Credentials come from one of two places, checked in this order:
 *
 *   1. FIREBASE_SA_EMAIL + FIREBASE_SA_KEY environment variables. This is how
 *      cloud sessions (claude.ai/code) get access — they start from a fresh
 *      clone with no files of their own, so a key on disk isn't an option.
 *   2. tools/service-account.json on disk, or FIREBASE_SA_PATH pointing
 *      elsewhere. This is the local setup.
 *
 * Either way the credential is Admin: it bypasses every rule in
 * firestore.rules. It stays out of git and out of anything public.
 *
 * No npm dependencies — node's crypto and fetch only.
 */

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASTORE = "https://www.googleapis.com/auth/datastore";

/* The env-var form has no project_id field, so derive it from the account
 * address: firebase-adminsdk-xxxxx@<project>.iam.gserviceaccount.com */
const projectFromEmail = email => email.split("@")[1]?.split(".")[0] ?? null;

export async function loadCredentials() {
  const email = process.env.FIREBASE_SA_EMAIL;
  const rawKey = process.env.FIREBASE_SA_KEY;

  if (email && rawKey) {
    /* Env values arrive as a single line: surrounding quotes may survive the
     * .env parser, and newlines are literal backslash-n. Both must go. */
    const privateKey = rawKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
    return {
      client_email: email,
      private_key: privateKey,
      project_id: process.env.FIREBASE_PROJECT_ID || projectFromEmail(email),
      source: "environment"
    };
  }

  const path = process.env.FIREBASE_SA_PATH || join(HERE, "service-account.json");
  try {
    return { ...JSON.parse(await readFile(path, "utf8")), source: path };
  } catch {
    throw new Error(
      "No Firebase credentials. Set FIREBASE_SA_EMAIL and FIREBASE_SA_KEY, or\n" +
      `place a service-account key at ${path}\n` +
      "(Firebase console -> Project settings -> Service accounts -> Generate new private key)."
    );
  }
}

const b64url = buf =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function accessToken(sa, scope = DATASTORE) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${body.error_description || JSON.stringify(body)}`);
  return body.access_token;
}

/* Firestore returns values wrapped by type; unwrap to plain JS. */
export function decode(v) {
  if (v == null) return null;
  if ("booleanValue"   in v) return v.booleanValue;
  if ("stringValue"    in v) return v.stringValue;
  if ("integerValue"   in v) return Number(v.integerValue);
  if ("doubleValue"    in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue"      in v) return null;
  if ("mapValue"       in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue"     in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
export const decodeFields = f =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

/* The inverse, for writes. */
export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}
export const encodeFields = o =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encode(v)]));

/* A bound client, so callers don't thread token and projectId through everything. */
export async function connect() {
  const sa = await loadCredentials();
  const token = await accessToken(sa);
  const projectId = sa.project_id;
  if (!projectId) throw new Error("Could not determine the Firebase project id.");
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const auth = { Authorization: `Bearer ${token}` };

  async function request(url, init = {}) {
    const res = await fetch(url, { ...init, headers: { ...auth, ...init.headers } });
    if (res.status === 404) return null;
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status}: ${body.error?.message || JSON.stringify(body)}`);
    return body;
  }

  return {
    projectId,
    source: sa.source,

    /* One document, as plain JS. Null when it doesn't exist. */
    async get(path) {
      const doc = await request(`${base}/${path}`);
      return doc && decodeFields(doc.fields || {});
    },

    /* Every document in a collection, keyed by document id. */
    async list(path, pageSize = 300) {
      const body = await request(`${base}/${path}?pageSize=${pageSize}`);
      return (body?.documents || []).map(d => ({
        id: d.name.split("/").pop(),
        ...decodeFields(d.fields || {})
      }));
    },

    /* The child collection names under a document — what modules exist. */
    async collections(path = "") {
      const body = await request(`${base}${path ? "/" + path : ""}:listCollectionIds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      return body?.collectionIds || [];
    },

    /* Merge fields into a document, leaving every other field untouched.
     * This is the updateDoc equivalent: the update mask names only the keys
     * passed in, so fields the page owns (a job's status, its notes) survive
     * a refresh instead of being clobbered. Creates the doc if absent. */
    async patch(path, fields) {
      const mask = Object.keys(fields)
        .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
        .join("&");
      return request(`${base}/${path}?${mask}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: encodeFields(fields) })
      });
    },

    async remove(path) {
      return request(`${base}/${path}`, { method: "DELETE" });
    }
  };
}
