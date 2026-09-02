/* ---------- reads that always answer ----------
 *
 * This is the blank page.
 *
 * `getDocFromServer` waits for the network. On a phone the app was left open
 * on and came back to, the connection is often already gone without the SDK
 * having noticed, and the promise then never settles — not an error, just
 * silence. The `try { fromServer } catch { getDoc }` every page was written
 * with catches nothing in that case: there is nothing to catch. The page keeps
 * awaiting, the gate it is waiting to open stays shut, and what is on screen
 * is the sign-in line and nothing under it.
 *
 * So a read gets DEADLINE_MS to come back from the server, and after that the
 * cache answers instead. A cached list is what the page would have drawn with
 * no signal at all, and something a few minutes old beats an empty screen —
 * pages re-read when they come back to the front, so the real answer lands as
 * soon as the connection does.
 *
 * With nothing cached either there is genuinely nothing to draw, so the wait
 * goes on until GIVE_UP_MS and then throws. That is a failure the pages
 * already have words for; a hang is not.
 */
const DEADLINE_MS = 6000;    // after this, whatever the cache has
const GIVE_UP_MS = 20000;    // after this, say so rather than wait forever
const LATE = Symbol("late");

/* One page load usually makes several of these, one after another. Waiting the
 * full deadline on each would turn a dead connection into half a minute of
 * empty screen, so the first read to run out of patience says so and the ones
 * behind it go straight to the cache. A read the server does answer — with
 * data or with an error, both are answers — lifts it again. */
let serverIsQuiet = false;

async function answerOrCache(server, fromCache, deadline, giveUp) {
  // The rejection is turned into a value: a server read that fails after the
  // deadline has passed must not surface as an unhandled rejection.
  const answered = server.then(
    snap => { serverIsQuiet = false; return { snap }; },
    error => { serverIsQuiet = false; return { error }; });

  if (serverIsQuiet) {
    try { return await fromCache(); }
    catch { /* nothing cached, so there is something to wait for after all */ }
  }

  const soon = wait(deadline);
  const first = await Promise.race([answered, soon.promise]);
  soon.cancel();
  if (first !== LATE) {
    if (!first.error) return first.snap;
    // The server refused outright. The cache may still know the answer.
    try { return await fromCache(); } catch { throw first.error; }
  }

  serverIsQuiet = true;
  try { return await fromCache(); }
  catch { /* nothing cached — there is nothing better to show than the wait */ }

  const later = wait(giveUp - deadline);
  const second = await Promise.race([answered, later.promise]);
  later.cancel();
  if (second === LATE) {
    const e = new Error("The connection stopped answering.");
    e.code = "deadline";
    throw e;
  }
  if (second.error) throw second.error;
  return second.snap;
}

function wait(ms) {
  let timer;
  return {
    promise: new Promise(resolve => { timer = setTimeout(() => resolve(LATE), ms); }),
    cancel: () => clearTimeout(timer)
  };
}

/* `f` is the firestore module — the same one the pages hold as `fb.f`, and the
 * one exercise/ holds on its own. Use these anywhere `getDocFromServer` or
 * `getDocsFromServer` was being called directly. */
export function readDoc(f, ref, { deadline = DEADLINE_MS, giveUp = GIVE_UP_MS } = {}) {
  return answerOrCache(f.getDocFromServer(ref), () => f.getDocFromCache(ref), deadline, giveUp);
}

export function readDocs(f, query, { deadline = DEADLINE_MS, giveUp = GIVE_UP_MS } = {}) {
  return answerOrCache(f.getDocsFromServer(query), () => f.getDocsFromCache(query), deadline, giveUp);
}
