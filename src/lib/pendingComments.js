// Persistence for "pending" comments — the comment analogue of pending.js.
//
// Comments are written straight to the entry's JSON on the data branch via
// addComment (real write), but data.json only rebuilds on a master deploy, so
// a comment is invisible site-wide until then. That's the "deploy = review"
// gate. What's missing without this file is the optimistic half: the commenter
// themselves should see their own pending comment immediately AND after a page
// refresh, flagged "同步中", mirroring how uploads use _local.
//
// We store the full comment objects (each tagged with its entryId) under
// gc_pending_comments. Once a fetch finds a comment's id already in the live
// aggregate (entry.comments), it's promoted and dropped from pending — same
// lifecycle as pending entries.
//
// Flat array of { entryId, ...comment } — mirrors pending.js's shape and keeps
// prune simple (one pass over live entries' comment ids).

const KEY = 'gc_pending_comments'

export function loadPendingComments() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function savePendingComments(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.isArray(list) ? list : []))
  } catch {
    /* storage full / blocked — best effort, pending is non-critical */
  }
}

// Append one pending comment, deduping by comment id.
export function addPendingComment(entryId, comment) {
  if (!comment || !comment.id) return
  const cur = loadPendingComments()
  if (!cur.some((c) => c.id === comment.id)) {
    cur.push({ entryId, ...comment })
    savePendingComments(cur)
  }
}

// Drop a single pending comment by id — used to roll back an optimistic
// comment whose submit failed (the write never landed, so it must not linger).
export function removePendingComment(id) {
  if (!id) return
  const kept = loadPendingComments().filter((c) => c.id !== id)
  savePendingComments(kept)
  return kept
}

// The pending comments belonging to one entry — used by DetailView to restore
// the optimistic list on mount (after a refresh).
export function pendingCommentsFor(entryId) {
  return loadPendingComments().filter((c) => c.entryId === entryId)
}

// Drop pending comments whose ids now appear in any live entry's comments —
// they've been aggregated into data.json and are no longer pending. Returns the
// kept list (and persists it).
export function prunePendingComments(liveEntries) {
  const live = new Set()
  for (const e of Array.isArray(liveEntries) ? liveEntries : []) {
    if (e && Array.isArray(e.comments)) {
      for (const c of e.comments) if (c && c.id) live.add(c.id)
    }
  }
  const kept = loadPendingComments().filter((c) => !live.has(c.id))
  savePendingComments(kept)
  return kept
}
