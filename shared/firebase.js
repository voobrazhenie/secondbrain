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
 * answer, and again on every sign-in and sign-out. Returns the unsubscribe. */
export function watchAuth(fb, onUser) {
  return fb.a.onAuthStateChanged(fb.auth, onUser);
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

/* Throws on failure. The page catches it, because what a half-finished sign-out
 * should say depends on what that page was showing. */
export async function signOut(fb) {
  await fb.a.signOut(fb.auth);
}
