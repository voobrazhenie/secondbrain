/* The sign-in plumbing every synced page needs, in one place.
 *
 * This module deliberately owns nothing a page can see. It connects to
 * Firebase, reports who is signed in, and runs sign-in and sign-out. Every
 * message on screen, every gate, and every decision about what a signed-out
 * visitor gets stays with the page — the sections do not agree about that
 * today, and moving the plumbing must not quietly make them agree.
 *
 * Loaded with a dynamic import so the pages can stay classic scripts:
 *
 *   const fbLib = await import("../shared/firebase.js");
 *   const fb = await fbLib.connect();          // throws — see below
 *   fbLib.watchAuth(fb, user => onAuth(user));
 *
 * `fb` is the handle bundle the pages already pass around:
 *   { auth, db, a, f } — a is the auth module, f the firestore module.
 */

import { recordProfile } from "./account.js";

const SDK = "https://www.gstatic.com/firebasejs/12.16.0/";

/* Connect, or throw. Two failures are worth telling apart, because the pages
 * word them differently: `no-config` means the config file never loaded (a
 * file:// origin, or a missing file), and anything else means Firebase itself
 * could not be reached. Check `e.code === "no-config"` at the call site.
 *
 * The offline cache is switched on here for everyone. It is what lets a page
 * answer from the last known state instead of a spinner, and every section
 * that syncs already asked for it. */
export async function connect() {
  let config = null;
  try { ({ firebaseConfig: config } = await import("./firebase-config.js")); }
  catch { /* file:// origin, or the file is missing */ }
  if (!config || !config.projectId) {
    const e = new Error("Firebase config is missing or incomplete.");
    e.code = "no-config";
    throw e;
  }
  const [{ initializeApp }, a, f] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-firestore.js")
  ]);
  const app = initializeApp(config);
  const db = f.initializeFirestore(app, {
    localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() })
  });
  const fb = { auth: a.getAuth(app), db, a, f };
  // A sign-in that went the redirect route lands back here. Nothing reads the
  // result — onAuthStateChanged is what the pages listen to — but the call has
  // to be made for the redirect to complete.
  a.getRedirectResult(fb.auth).catch(() => {});
  return fb;
}

/* Calls back with the signed-in user, or null. Fires once on load with the
 * answer, and again on every sign-in and sign-out. Returns the unsubscribe.
 *
 * Recording the profile card happens here rather than in each page. There is no
 * directory of accounts a browser can read, so profiles/{uid} is the only way
 * the admin pages know anybody exists — and a page that forgets to write one
 * makes a person invisible to them. Putting it on the one path every signed-in
 * page already goes through is what stops that being a per-page mistake.
 *
 * Not awaited, and never allowed to throw: nothing anyone sees depends on it. */
export function watchAuth(fb, onUser) {
  return fb.a.onAuthStateChanged(fb.auth, user => {
    if (user) recordProfile(fb, user);
    onUser(user);
  });
}

/* Google sign-in. Returns null once the popup has succeeded or the redirect is
 * under way, or a sentence to show the person if it failed.
 *
 * `notify` is called with progress text while the popup or redirect opens, so
 * the page can put it wherever its own status line lives. Failure comes back as
 * a return value rather than a throw: every call site does the same thing with
 * it, and a throw would make each of them write the same try/catch again. */
export async function signIn(fb, notify = () => {}) {
  const { a, auth } = fb;
  try {
    notify("Opening Google sign-in…");
    await a.signInWithPopup(auth, new a.GoogleAuthProvider());
    return null;
  } catch (e) {
    const code = e && e.code || "";
    // A blocked popup is not a failure yet — the redirect is the other way in,
    // and it is the one that works on iOS standalone.
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try {
        notify("Redirecting to Google…");
        await a.signInWithRedirect(auth, new a.GoogleAuthProvider());
        return null;
      } catch (e2) { e = e2; }
    }
    return signInMessage(e);
  }
}

/* The three sign-in failures worth naming, and a fallback that carries the code
 * so an unexpected one is still reportable. */
export function signInMessage(e) {
  const code = e && e.code || "";
  if (code === "auth/unauthorized-domain") return "This domain isn't authorised in Firebase Auth settings yet.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Sign-in was cancelled.";
  return `Sign-in failed (${e.code || e.message}).`;
}

/* Sign out and leave nothing of the account on the device.
 *
 * Signing out on its own does not clear Firebase's offline cache. That cache is
 * filed under the document path, so it can never be shown to another account —
 * but it is still one person's data sitting in a browser other people may use,
 * and the rule for this app is that a signed-out device holds nothing.
 *
 * Clearing it needs the connection closed first, and nothing may touch `fb`
 * afterwards, so the page is reloaded into its signed-out state rather than
 * carrying on with a terminated database.
 *
 * Two things this gives up, both on purpose. A write the SDK had accepted but
 * not yet sent — possible only offline, and only in the moment between a tap and
 * signing out — goes with the cache instead of being retried later. And the
 * clear is best-effort: another tab holding the same database makes it
 * impossible, and by then the sign-out itself has already happened, which is the
 * part that matters.
 *
 * Throws only if the sign-out itself failed. The page catches that, because what
 * a half-finished sign-out should say depends on what that page was showing. */
export async function signOut(fb) {
  await fb.a.signOut(fb.auth);
  try {
    await fb.f.terminate(fb.db);
    await fb.f.clearIndexedDbPersistence(fb.db);
  } catch { /* another tab has the database open, or the browser refused */ }
  location.reload();
}
