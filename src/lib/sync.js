// Outbox drainer: replays queued writes against GitHub when the network is
// back. See src/lib/outbox.js for the storage design and src/lib/github.js for
// the queue-first mutations that feed this.
//
// Trigger points (main.js): window 'online', visibilitychange → visible, and a
// slow interval as a last resort. All three call drainOutbox(); the in-flight
// guard makes re-entrancy harmless.
//
// Multi-tab safety: the payload ops live in one shared IndexedDB, so two tabs
// could drain the same op. Entry/comment uploads are idempotent by fixed UUID
// (execUploadEntry skipIfExists), and deletes/visibility are idempotent by
// semantics (updateEntryJson's transform sets the same end state). A
// localStorage leader lock is kept anyway as belt-and-suspenders against
// doubled quota counters and doubled UI events.

import { execUploadEntry, execAddComment, execDeleteEntry, execDeleteComment, execSetEntryVisibility, getFileMeta } from './github.js'
import { listOps, dueOps, markSyncing, markDone, markFailed } from './outbox.js'

const LOCK_KEY = 'gc_outbox_lock'
const LOCK_STALE_MS = 60 * 1000

let draining = false

function acquireLock() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null')
    if (raw && Date.now() - raw.ts < LOCK_STALE_MS) return false
    localStorage.setItem(LOCK_KEY, JSON.stringify({ ts: Date.now() }))
    return true
  } catch {
    return true // localStorage blocked → lock is advisory anyway
  }
}

function releaseLock() {
  try {
    localStorage.removeItem(LOCK_KEY)
  } catch {
    /* advisory */
  }
}

// Dispatch one op to its executor. Resolves on success; throws to signal
// retry/fail. Exported for SyncChip's manual retry.
export async function runOp(op) {
  const { kind, payload } = op
  switch (kind) {
    case 'entry':
      return execUploadEntry(payload)
    case 'comment': {
      // The entry may itself still be queued (offline comment on an offline
      // entry): complain loudly and let it be retried after the entry lands.
      const meta = await getFileMeta(`data/${payload.entryId}.json`)
      if (!meta) throw Object.assign(new Error('目标记录尚未同步'), { retryLater: true })
      return execAddComment(payload.entryId, payload.comment)
    }
    case 'deleteEntry':
      return execDeleteEntry(payload.entryId)
    case 'deleteComment':
      return execDeleteComment(payload.entryId, payload.commentId)
    case 'visibility':
      return execSetEntryVisibility(payload.entryId, payload.visibility)
    default:
      throw Object.assign(new Error(`未知同步类型 ${kind}`), { permanent: true })
  }
}

// FIFO by createdAt, one at a time. Stops early on network loss; individual
// failures back off exponentially inside outbox.markFailed.
export async function drainOutbox() {
  if (draining) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  if (!acquireLock()) return
  draining = true
  try {
    let ops = await listOps()
    for (const op of dueOps(ops)) {
      if (!navigator.onLine) break
      await markSyncing(op.key)
      try {
        const result = await runOp(op)
        await markDone(op.key)
        // Tell the app (App.vue) which op landed so it can reconcile state —
        // e.g. swap a queued entry's blob image URLs for raw data-branch URLs.
        window.dispatchEvent(
          new CustomEvent('gc-outbox-synced', { detail: { kind: op.kind, payload: op.payload, result } }),
        )
      } catch (e) {
        if (e instanceof TypeError || e.message === 'NETWORK_ERROR') {
          // Network dropped again mid-batch: reset to queued (markSyncing set
          // it, we owe it a status) and stop — no point failing every op.
          await markFailed(op.key, e, {})
          break
        }
        const permanent = Boolean(e.permanent) || /找不到该记录/.test(e.message || '')
        await markFailed(op.key, e, { permanent })
      }
    }
  } finally {
    draining = false
    releaseLock()
  }
}
