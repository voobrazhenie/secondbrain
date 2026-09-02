/* Stand-in for firebase-firestore.js: an in-memory store with the handful of
 * calls these pages actually make.
 *
 * Backed by sessionStorage so it survives the reload that signing out does, and
 * exposed as globalThis.__MOCK_STORE so a test can assert on exactly which
 * documents were written and under which paths — which is the whole point, the
 * bug that started this being one account's data written under another's. */
const load = () => { try { return new Map(JSON.parse(sessionStorage.getItem("__mockdb") || "[]")); } catch { return new Map(); } };
const store = load();
const persist = () => { try { sessionStorage.setItem("__mockdb", JSON.stringify([...store])); } catch {} };
const watchers = new Map();

const docsUnder = col => [...store.keys()]
  .filter(p => p.startsWith(col.path + "/") && !p.slice(col.path.length + 1).includes("/"))
  .map(p => ({ id: p.split("/").pop(), data: () => store.get(p) }));

const key = ref => (ref.isCol || ref.col) ? (ref.col || ref).path : ref.path;
const snapOf = ref => {
  const d = store.get(key(ref));
  return { id: ref.id, exists: () => d !== undefined, data: () => d, metadata: { hasPendingWrites: false } };
};
/* A collection listener gets every document under it, the same shape getDocs
 * returns. Opportunities and Jobs read a collection rather than one document,
 * and without this their onSnapshot handed back a document snapshot: snap.docs
 * was undefined, the page threw before it painted, and neither section could
 * be opened in a test at all. */
const colSnapOf = ref => {
  const docs = docsUnder({ path: key(ref) });
  return { docs, empty: docs.length === 0, forEach: fn => docs.forEach(fn),
           metadata: { hasPendingWrites: false } };
};
const isCollection = ref => !!(ref.isCol || ref.col);

/* A write under a collection wakes that collection's listeners as well as the
 * document's own. */
const notify = path => {
  (watchers.get(path) || []).forEach(cb => cb(snapOf({ path, id: path.split("/").pop() })));
  const parent = path.slice(0, path.lastIndexOf("/"));
  (watchers.get(parent) || []).forEach(cb => cb(colSnapOf({ path: parent })));
};

/* serverTimestamp() and deleteField() arrive as sentinels; resolve them the way
 * the real server would before the value lands in the store. */
const resolve = v => (v && v.__st) ? new Date().toISOString() : v;
const applyDoc = (path, data, merge) => {
  const out = merge ? { ...(store.get(path) || {}) } : {};
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__del) delete out[k]; else out[k] = resolve(v);
  }
  store.set(path, out);
  persist();
  notify(path);
};

export const initializeFirestore = (app, opts) => ({ app, opts });
export const getFirestore = app => ({ app });
export const persistentLocalCache = o => o;
export const persistentMultipleTabManager = () => ({});

export const collection = (parent, ...segs) => {
  const path = [parent && parent.path, ...segs].filter(Boolean).join("/");
  return { path, isCol: true };
};
export const doc = (parent, ...segs) => {
  const path = [parent && parent.path, ...segs].filter(Boolean).join("/");
  return { path, id: path.split("/").pop() };
};

export const getDoc = async ref => snapOf(ref);
export const getDocFromCache = getDoc;

/* The server reads can be told to stall, which is the failure the pages are
 * built against: not an error, no answer at all. A phone coming back from
 * sleep gets this from the real SDK, and the page then sits on its gate with
 * an empty screen — see shared/read.js. */
const stalled = () => { try { return sessionStorage.getItem("__mockstall") === "1"; } catch { return false; } };
const never = new Promise(() => {});

export const getDocFromServer = ref => stalled() ? never : getDoc(ref);

export const getDocs = async q => {
  const docs = docsUnder(q.isCol ? q : q.col);
  return { docs, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
};
export const getDocsFromCache = getDocs;
export const getDocsFromServer = q => stalled() ? never : getDocs(q);

export const setDoc = async (ref, data, opts) => applyDoc(key(ref), data, !!(opts && opts.merge));
export const updateDoc = async (ref, data) => applyDoc(key(ref), data, true);

export const onSnapshot = (ref, cb) => {
  const p = key(ref);
  const col = isCollection(ref);
  if (!watchers.has(p)) watchers.set(p, []);
  watchers.get(p).push(cb);
  Promise.resolve().then(() => cb(col ? colSnapOf(ref) : snapOf(ref)));
  return () => watchers.set(p, (watchers.get(p) || []).filter(x => x !== cb));
};

export const serverTimestamp = () => ({ __st: true });
export const deleteField = () => ({ __del: true });
export const query = (col, ...constraints) => ({ col, constraints });
export const where = (...a) => ({ a });
export const orderBy = (...a) => ({ a });
export const limit = n => ({ n });
export const documentId = () => "__id";
export class FieldPath { constructor(...p) { this.p = p; } }

export const writeBatch = () => {
  const ops = [];
  return {
    set: (ref, data, opts) => ops.push(() => applyDoc(key(ref), data, !!(opts && opts.merge))),
    update: (ref, data) => ops.push(() => applyDoc(key(ref), data, true)),
    delete: ref => ops.push(() => { store.delete(key(ref)); persist(); notify(key(ref)); }),
    commit: async () => ops.forEach(fn => fn())
  };
};

/* Signing out terminates the connection and clears the offline cache. Recorded
 * rather than simulated, so a test can assert that it happened. */
export const terminate = async () => { globalThis.__MOCK_TERMINATED = true; };
export const clearIndexedDbPersistence = async () => {
  try { sessionStorage.setItem("__mockCacheCleared", "1"); } catch {}
};

globalThis.__MOCK_STORE = store;
