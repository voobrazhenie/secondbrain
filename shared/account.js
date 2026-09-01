/* Who is signed in, what they are allowed to see, and letting the admin pages
 * know they exist. Three small documents, all outside users/{uid}/:
 *
 *   profiles/{uid}   { email, name, lastSeen }   written by their own page
 *   features/{uid}   { sections: { key: bool } } written by an admin only
 *   admins/{uid}     marker document             written by hand, never here
 *
 * features/ is deliberately not under users/{uid}/config/, where the rule that
 * lets a person write their own data would also let them switch their own
 * sections on.
 */

import { SECTIONS, noSections, allExtras } from "./sections.js";

/* Called on every sign-in. This is the only reason the admin pages can list
 * anyone: it is written from what Google already returned, so signing in asks
 * for nothing it did not ask for before.
 *
 * Merged, not replaced, and never awaited by anything the page draws — a
 * failure here must not stop somebody using their own account. */
export async function recordProfile(fb, user) {
  const { f, db } = fb;
  try {
    await f.setDoc(f.doc(db, "profiles", user.uid), {
      email: user.email || null,
      name: user.displayName || null,
      lastSeen: f.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn("Profile not recorded:", e.code || e.message);
  }
}

/* What this person may see: `sections`, which the home page turns into buttons,
 * and `extras`, the switches inside a section — DailyPlan's points, priority
 * card and streaks. Returns null when the answer could not be read at all,
 * which is not the same as "none of them": the caller has to tell an empty
 * account apart from a failed read, because hiding everything is the right
 * answer to one and the wrong answer to the other. */
export async function loadFeatures(fb, uid) {
  const { f, db } = fb;
  const ref = f.doc(db, "features", uid);
  let snap;
  try {
    try { snap = await f.getDocFromServer(ref); }
    catch { snap = await f.getDoc(ref); }
  } catch (e) {
    console.warn("Features unavailable:", e.code || e.message);
    return null;
  }
  const data = snap.exists() ? snap.data() : {};
  const storedSections = data.sections || {};
  const storedExtras = data.extras || {};

  // Only keys this build knows about, so a section removed from the list stops
  // being honoured and one added later starts off.
  const sections = noSections();
  for (const s of SECTIONS) sections[s.key] = storedSections[s.key] === true;

  // `!== false` rather than `=== true`: an extra nobody has touched is on.
  const extras = allExtras();
  for (const s of SECTIONS) {
    if (!s.extras) continue;
    for (const e of s.extras) {
      extras[s.key][e.key] = (storedExtras[s.key] || {})[e.key] !== false;
    }
  }
  return { sections, extras };
}

/* Admins are a document, not a claim on the token, so this is a plain read.
 * It decides what the admin pages draw; firestore.rules is what actually stops
 * a non-admin reading or writing anything. */
export async function isAdmin(fb, uid) {
  const { f, db } = fb;
  try {
    const snap = await f.getDoc(f.doc(db, "admins", uid));
    return snap.exists();
  } catch {
    return false;
  }
}
