// Persistence for "pending" entries: uploads that have shipped to the data
// branch but are NOT yet in the prebuilt data.json (which only rebuilds on a
// master deploy). Without this, a page refresh loses the in-memory `_local`
// optimistic entry — it's gone from both the server aggregate and memory.
//
// We keep the full entry objects here so the feed can restore them on load
// (still flagged `_local`, showing the "等待通过" badge). Once a fetch finds
// the entry's id in the live aggregate, it's promoted out of pending.
//
// Stored as a plain JSON array under gc_pending.

const KEY = 'gc_pending'

export function loadPending() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function savePending(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.isArray(entries) ? entries : []))
  } catch {
    /* storage full / blocked — best effort, pending is non-critical */
  }
}

// Append one pending entry, deduping by id.
export function addPending(entry) {
  const cur = loadPending()
  if (!cur.some((e) => e.id === entry.id)) cur.push(entry)
  savePending(cur)
}

// Drop one pending entry by id — used when the author deletes an entry that
// hasn't been aggregated yet. Without this, App's onMounted would restore it
// from storage on the next load.
export function removePending(id) {
  if (!id) return loadPending()
  const kept = loadPending().filter((e) => e.id !== id)
  savePending(kept)
  return kept
}

// Drop pending entries whose ids now appear in the live aggregate — they've
// been promoted to the public feed and are no longer "pending".
export function prunePending(liveIds) {
  const live = new Set(liveIds)
  const kept = loadPending().filter((e) => !live.has(e.id))
  savePending(kept)
  return kept
}
