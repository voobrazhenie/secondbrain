/* The opportunities module talks to the same Firebase project as dailyplan/.
 *
 * Re-exported rather than duplicated so there is exactly one place to update
 * when the config is regenerated:
 *   firebase apps:sdkconfig WEB --project claudecode-3bb06
 *
 * As with jobs/firebase-config.js, this is PUBLIC BY DESIGN. The apiKey is an
 * identifier, not a credential. firestore.rules is what keeps this data private —
 * every document under users/{uid}/ is readable only by that signed-in uid, so an
 * anonymous visitor to the public Pages site gets nothing but the sign-in prompt.
 */
export { firebaseConfig } from "../dailyplan/firebase-config.js";
