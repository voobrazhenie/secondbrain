/* Exercise talks to the same Firebase project as dailyplan/, streams/ and jobs/.
 *
 * Re-exported rather than duplicated so there is exactly one place to update
 * when the config is regenerated:
 *   firebase apps:sdkconfig WEB --project claudecode-3bb06
 *
 * PUBLIC BY DESIGN, same as the other copies of this file. The apiKey is an
 * identifier, not a credential. firestore.rules is what keeps this data
 * private — every document under users/{uid}/ is readable only by that
 * signed-in uid.
 */
export { firebaseConfig } from "../dailyplan/firebase-config.js";
