// Tombstones for comments the author deleted — the comment analogue of
// deletedEntries.js.
//
// deleteComment flips the comment's status to 'deleted' inside the entry JSON
// on the data branch, but data.json only rebuilds on the hourly aggregation,
// so the comment keeps arriving in every fetch for up to an hour. These
// tombstones suppress it locally in the meantime, so "删除" feels immediate and
// survives a reload.
//
// Stored as a plain JSON array of comment id strings under gc_deleted_comments.
//
// Module-level ref (same pattern as deletedEntries.js / favorites.js) rather
// than a plain localStorage read: DetailView's comment list and App's
// myComments both call isCommentDeleted(), so the store has to be reactive or
// neither would update until the next fetch.

import { ref } from 'vue'
import { readJson, writeJson } from './storage.js'

const KEY = 'gc_deleted_comments'

function load() {
  const arr = readJson(KEY, [])
  return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string') : []
}

export const deletedComments = ref(load())

function persist() {
  writeJson(KEY, deletedComments.value)
}

export function isCommentDeleted(id) {
  return deletedComments.value.includes(id)
}

export function addDeletedComment(id) {
  if (!id || isCommentDeleted(id)) return
  deletedComments.value = [...deletedComments.value, id]
  persist()
}

// Drop tombstones whose comments are no longer in the live aggregate — once
// aggregation has filtered the comment out of data.json, the tombstone has done
// its job and nothing is left to suppress.
//
// Takes the live ENTRIES (not comment ids) because that's what callers have;
// we flatten to comment ids here. The empty-guard matches pruneDeleted: a 404
// from loadEntries yields [], and pruning against an empty set would clear
// EVERY tombstone, resurrecting the deleted comments on the next fetch.
export function pruneDeletedComments(liveEntries) {
  const entries = Array.isArray(liveEntries) ? liveEntries : []
  if (!entries.length) return deletedComments.value
  const liveSet = new Set()
  for (const e of entries) {
    if (e && Array.isArray(e.comments)) {
      for (const c of e.comments) if (c && c.id) liveSet.add(c.id)
    }
  }
  const kept = deletedComments.value.filter((id) => liveSet.has(id))
  if (kept.length !== deletedComments.value.length) {
    deletedComments.value = kept
    persist()
  }
  return deletedComments.value
}
