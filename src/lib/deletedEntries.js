// Tombstones for entries the author deleted — the mirror image of pending.js.
//
// Deleting doesn't remove the file on the data branch; it flips the entry's
// status to 'deleted' (see deleteEntry in github.js). But data.json only
// rebuilds on the hourly aggregation, so the entry keeps coming back in every
// fetch for up to an hour after the user deleted it. These tombstones suppress
// it locally in the meantime, so "删除" feels immediate and survives a reload.
//
// Stored as a plain JSON array of id strings under gc_deleted.
//
// This is a module-level ref (same pattern as favorites.js) rather than a
// plain localStorage read: App's `visible` computed calls isDeleted(), so the
// store has to be reactive or the feed wouldn't update until the next fetch.

import { ref } from 'vue'
import { readJson, writeJson } from './storage.js'

const KEY = 'gc_deleted'

function load() {
  const arr = readJson(KEY, [])
  return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string') : []
}

export const deleted = ref(load())

function persist() {
  writeJson(KEY, deleted.value)
}

export function isDeleted(id) {
  return deleted.value.includes(id)
}

export function addDeleted(id) {
  if (!id || isDeleted(id)) return
  deleted.value = [...deleted.value, id]
  persist()
}

// Drop tombstones whose entries are no longer in the live aggregate — once
// aggregation has filtered the entry out of data.json, the tombstone has done
// its job and nothing is left to suppress.
//
// The empty-liveIds guard matters: loadEntries returns [] on a 404, and
// pruning against an empty set would clear EVERY tombstone, resurrecting the
// deleted entries on the next successful fetch. prunePending has the same
// keep-everything behaviour on an empty aggregate.
export function pruneDeleted(liveIds) {
  const live = Array.isArray(liveIds) ? liveIds : []
  if (!live.length) return deleted.value
  const liveSet = new Set(live)
  const kept = deleted.value.filter((id) => liveSet.has(id))
  if (kept.length !== deleted.value.length) {
    deleted.value = kept
    persist()
  }
  return deleted.value
}
