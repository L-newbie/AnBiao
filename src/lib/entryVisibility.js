// Local overrides for an entry's public/private visibility — the same idea as
// the tombstones in deletedEntries.js, but carrying a value instead of a flag.
//
// Toggling visibility flips the `visibility` field in the entry's JSON on the
// data branch (see setEntryVisibility in github.js). data.json only rebuilds on
// the half-hourly aggregation, so for up to 30 minutes every fetch keeps
// handing back the OLD value. These overrides win over the fetched entry in the
// meantime, so the toggle feels immediate and survives a reload.
//
// Stored as a plain JSON object of id -> 'public' | 'private' under
// gc_visibility.
//
// Module-level ref (same pattern as favorites.js / deletedEntries.js) because
// App's `visibleCommunity` computed resolves through visibilityOf(): the store
// has to be reactive or the feed wouldn't update until the next fetch.

import { ref } from 'vue'
import { readJson, writeJson } from './storage.js'

const KEY = 'gc_visibility'

export const PUBLIC = 'public'
export const PRIVATE = 'private'

function isValid(v) {
  return v === PUBLIC || v === PRIVATE
}

function load() {
  const obj = readJson(KEY, {})
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  // Drop anything that isn't a known value — a corrupt entry here would
  // otherwise resolve to a visibility nothing in the app understands.
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => isValid(v)))
}

export const visibilityOverrides = ref(load())

function persist() {
  writeJson(KEY, visibilityOverrides.value)
}

// The one place that decides how visible an entry is: a pending local override
// wins, then the entry's own field, then public.
//
// Defaulting to public matters for backwards compatibility — every entry
// uploaded before this feature existed has no `visibility` field at all, and
// those were all public.
export function visibilityOf(entry) {
  if (!entry || !entry.id) return PUBLIC
  const override = visibilityOverrides.value[entry.id]
  if (isValid(override)) return override
  return isValid(entry.visibility) ? entry.visibility : PUBLIC
}

export function isPrivate(entry) {
  return visibilityOf(entry) === PRIVATE
}

// Whether to show the "同步中" badge on an entry.
//
// Two things are deliberately folded into one rule here:
//   - Only PENDING entries (_local, not yet in the aggregate) are still syncing.
//   - A PRIVATE entry never advertises it. It isn't going anywhere public, so
//     the badge would be both meaningless and corrosive to the point of the
//     feature — a private record should just be there, immediately, with no
//     hint that anything is being processed elsewhere.
//
// Note the badge means "waiting for the half-hourly rebuild of data.json", NOT
// "waiting for a moderator" — there is no review process in this app. The old
// 等待通过 copy implied one that doesn't exist.
export function isSyncing(entry) {
  return Boolean(entry && entry._local) && visibilityOf(entry) === PUBLIC
}

export function setVisibilityOverride(id, value) {
  if (!id || !isValid(value)) return
  // Replace the object rather than mutating a key: ref only tracks
  // reassignment of .value, so an in-place write wouldn't re-render.
  visibilityOverrides.value = { ...visibilityOverrides.value, [id]: value }
  persist()
}

// Drop overrides the live aggregate has caught up with.
//
// This is deliberately NOT shaped like pruneDeleted(liveIds): an override is
// only redundant once the aggregate reports the SAME value, so we need each
// live entry's visibility, not just its id.
//
// Two cases must both be handled, and getting either wrong is silently broken:
//   - id present with a different value -> aggregation hasn't run yet, KEEP
//   - id absent entirely -> a pending (_local) entry, which never appears in
//     the aggregate. Dropping those would lose the override immediately, so
//     KEEP as well.
// Only an exact match is dropped.
//
// The empty-aggregate guard is the same one pruneDeleted has, for the same
// reason: loadEntries returns [] on a 404, and pruning against nothing would
// look like "no matches" and keep everything anyway — but bailing early makes
// that explicit rather than incidental.
export function pruneVisibilityOverrides(liveEntries) {
  const live = Array.isArray(liveEntries) ? liveEntries : []
  if (!live.length) return visibilityOverrides.value
  const liveMap = new Map(
    live.filter((e) => e && e.id).map((e) => [e.id, isValid(e.visibility) ? e.visibility : PUBLIC]),
  )
  const kept = {}
  for (const [id, value] of Object.entries(visibilityOverrides.value)) {
    if (liveMap.has(id) && liveMap.get(id) === value) continue
    kept[id] = value
  }
  if (Object.keys(kept).length !== Object.keys(visibilityOverrides.value).length) {
    visibilityOverrides.value = kept
    persist()
  }
  return visibilityOverrides.value
}
