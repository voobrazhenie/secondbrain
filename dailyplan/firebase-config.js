/* Moved to shared/firebase-config.js, which is now the one copy.
 *
 * This re-export stays because exercise/, finance/, ideas/, jobs/,
 * opportunities/ and streams/ still import the config through this path. It can
 * go once each of them reads shared/ directly.
 */
export { firebaseConfig } from "../shared/firebase-config.js";
