/* Firebase web config — the one copy. Every page reaches it from here.
 *
 * This file is PUBLIC BY DESIGN and safe to commit. The apiKey is an identifier
 * saying which project to talk to — not a credential. What actually protects the
 * data is firestore.rules, which only lets a signed-in person touch documents
 * under their own uid.
 *
 * The thing that must NEVER be committed is a service-account key (the Admin SDK
 * credential). That one bypasses all rules. .gitignore blocks it.
 *
 * Regenerate with:  firebase apps:sdkconfig WEB --project claudecode-3bb06
 */
export const firebaseConfig = {
  apiKey: "AIzaSyA63gqdsNDdECCFA5DPFiI7R6LFBpGz5kI",
  authDomain: "claudecode-3bb06.firebaseapp.com",
  projectId: "claudecode-3bb06",
  storageBucket: "claudecode-3bb06.firebasestorage.app",
  messagingSenderId: "236696400386",
  appId: "1:236696400386:web:877ac234125bc4d442ad1b"
};
