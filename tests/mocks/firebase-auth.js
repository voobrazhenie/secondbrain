/* Stand-in for firebase-auth.js.
 *
 * Google sign-in cannot happen in a test, so signing in means "become whoever
 * __MOCK_USER says", and the listener fires exactly as the real SDK's does.
 * A test sets globalThis.__MOCK_USER before clicking the sign-in button, and
 * can change it between sign-ins to put two people through one browser. */
let current = null;
const listeners = new Set();
const emit = () => listeners.forEach(cb => cb(current));

export const getAuth = app => ({ app, get currentUser() { return current; } });
export class GoogleAuthProvider {}

export const onAuthStateChanged = (auth, cb) => {
  listeners.add(cb);
  Promise.resolve().then(() => cb(current));   // async, like the real one
  return () => listeners.delete(cb);
};

export const getRedirectResult = async () => null;

export const signInWithPopup = async () => {
  if (globalThis.__MOCK_POPUP_BLOCKED) { const e = new Error("blocked"); e.code = "auth/popup-blocked"; throw e; }
  if (globalThis.__MOCK_SIGNIN_ERROR) { const e = new Error("no"); e.code = globalThis.__MOCK_SIGNIN_ERROR; throw e; }
  current = globalThis.__MOCK_USER || { uid: "test-uid", email: "tester@example.com" };
  emit();
  return { user: current };
};

export const signInWithRedirect = async () => { globalThis.__MOCK_REDIRECTED = true; };
export const signOut = async () => { current = null; emit(); };
