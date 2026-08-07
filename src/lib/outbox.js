// Offline write queue persisted in IndexedDB.
//
// WHY IndexedDB and not localStorage: entry ops carry base64 images (~150–400
// KB each after compress, up to 3 per entry since multi-image). A few queued
// uploads would blow localStorage's ~5 MB budget shared with every other gc_*
// key. IDB is available in every browser that runs this app (SW/PWA baseline).
//
// WHY page-side and not Background Sync in the service worker: (1) the GitHub
// token only exists in page JS (build-time import.meta.env), the SW cannot
// authorize writes; (2) iOS Safari — a core target — never implemented
// Background Sync. Draining lives in src/lib/sync.js on online/visibility/
// interval triggers.

import { ref } from 'vue'

const DB_NAME = 'gc_outbox'
const STORE = 'ops'
export const MAX_TRIES = 5

// Reactive count for the SyncChip UI. Kept in sync by every mutation below.
// `failed` counted separately so the chip can switch colour.
export const outboxCount = ref(0)
export const outboxFailedCount = ref(0)

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true })
        os.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('无法打开本地队列'))
  })
  return dbPromise
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const out = run(store)
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out)
    t.onerror = () => reject(t.error || new Error('本地队列写入失败'))
    t.onabort = () => reject(t.error || new Error('本地队列写入被中止'))
  })
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function refreshCounts() {
  try {
    const db = await openDb()
    const all = await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
    outboxCount.value = all.length
    outboxFailedCount.value = all.filter((op) => op.status === 'failed').length
  } catch {
    /* counts are cosmetic — never break the app over them */
  }
}

// kind ∈ 'entry' | 'comment' | 'deleteEntry' | 'deleteComment' | 'visibility'
// payload must be JSON-serializable and complete (entry ops embed image b64).
export async function enqueue(kind, payload) {
  const op = {
    kind,
    payload,
    createdAt: new Date().toISOString(),
    tries: 0,
    lastErr: '',
    status: 'queued',
    nextRetryAt: 0,
  }
  try {
    const db = await openDb()
    op.key = await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).add(op))
  } catch {
    // IDB unavailable (old private mode) — the op only lives in the optimistic
    // UI this session. Better than crashing the submit.
    return null
  }
  await refreshCounts()
  window.dispatchEvent(new CustomEvent('gc-outbox-changed'))
  return op.key
}

export async function listOps() {
  try {
    const db = await openDb()
    const all = await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
    return (all || []).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  } catch {
    return []
  }
}

async function patchOp(key, patch) {
  const db = await openDb()
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
  const op = await reqToPromise(store.get(key))
  if (!op) return null
  Object.assign(op, patch)
  await reqToPromise(store.put(op))
  await refreshCounts()
  window.dispatchEvent(new CustomEvent('gc-outbox-changed'))
  return op
}

export function markSyncing(key) {
  return patchOp(key, { status: 'syncing', syncingSince: Date.now() })
}

export async function markDone(key) {
  try {
    const db = await openDb()
    await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key))
  } catch {
    /* done is done */
  }
  await refreshCounts()
  window.dispatchEvent(new CustomEvent('gc-outbox-changed'))
}

export function markFailed(key, err, { permanent = false } = {}) {
  return listOps().then(async (ops) => {
    const op = ops.find((o) => o.key === key)
    if (!op) return null
    const tries = (op.tries || 0) + 1
    const exhausted = permanent || tries >= MAX_TRIES
    return patchOp(key, {
      tries,
      lastErr: String(err && err.message ? err.message : err).slice(0, 200),
      status: exhausted ? 'failed' : 'queued',
      // Exponential backoff: 30s, 60s, 120s, 240s …
      nextRetryAt: exhausted ? 0 : Date.now() + Math.pow(2, tries) * 30 * 1000,
    })
  })
}

// User-initiated retry of a failed op: back to queued, due immediately.
export function retryOp(key) {
  return patchOp(key, { status: 'queued', tries: 0, lastErr: '', nextRetryAt: 0 })
}

export async function discardOp(key) {
  try {
    const db = await openDb()
    await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key))
  } catch {
    /* gone either way */
  }
  await refreshCounts()
  window.dispatchEvent(new CustomEvent('gc-outbox-changed'))
}

// On startup: an op left 'syncing' means the tab died mid-drain. Reset stale
// ones (>60s) back to queued so they're retried instead of stuck forever.
export async function resetStaleSyncing() {
  const ops = await listOps()
  const stale = ops.filter((o) => o.status === 'syncing' && Date.now() - (o.syncingSince || 0) > 60 * 1000)
  for (const o of stale) await patchOp(o.key, { status: 'queued' })
}

// util for sync.js — public so the drain can decide what's due.
export function dueOps(ops, now = Date.now()) {
  return ops.filter((o) => o.status === 'queued' && (o.nextRetryAt || 0) <= now)
}
