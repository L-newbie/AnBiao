// Per-device favorites — a private, local-only bookmark list.
//
// Deliberately NOT written to the data branch: a favorite says something about
// the reader, not the entry, so it never leaves the device. No token, no write
// quota, no deploy gate — toggling is instant and invisible to everyone else.
//
// We store { id, addedAt } records (not entry snapshots) under gc_favorites and
// resolve them against the live feed at render time, so a favorited entry whose
// text/image changes later shows its current version. Ids that don't resolve are
// hidden from the list but KEPT in storage — an entry missing from one fetch
// (network blip, mid-deploy aggregate) must not silently drop the bookmark.

import { ref } from 'vue'
import { readJson, writeJson } from './storage.js'

const KEY = 'gc_favorites'

function load() {
  const arr = readJson(KEY, [])
  return Array.isArray(arr) ? arr.filter((f) => f && f.id) : []
}

// Module-level reactive store: every importer shares one instance, so toggling
// from a feed card re-renders the detail view and the Mine tab counts with no
// event bus. Mirrors the module-ref pattern in usePwaUpdate.js.
export const favorites = ref(load())

function persist() {
  // Non-critical (favorites are reconstructible), but a failed write now
  // still surfaces via the gc-storage-full toast instead of vanishing.
  writeJson(KEY, favorites.value)
}

export function isFavorite(id) {
  return favorites.value.some((f) => f.id === id)
}

// Toggle and return the new state (true = now favorited).
export function toggleFavorite(id) {
  if (!id) return false
  const on = !isFavorite(id)
  // Newest-first: re-favoriting moves an entry back to the top of the list.
  favorites.value = on
    ? [{ id, addedAt: new Date().toISOString() }, ...favorites.value.filter((f) => f.id !== id)]
    : favorites.value.filter((f) => f.id !== id)
  persist()
  return on
}

// Favorited entries resolved against the live feed, newest-favorited first
// (favorites is kept in that order, so a plain map preserves it).
export function favoriteEntries(entries) {
  const byId = new Map((Array.isArray(entries) ? entries : []).map((e) => [e.id, e]))
  return favorites.value.map((f) => byId.get(f.id)).filter(Boolean)
}
