// Sharded feed loader — supersedes github.js's loadEntries once the aggregate
// has more than ~500 published entries (scripts/aggregate.js).
//
// Strategy: fetch data-index.json (tiny) to learn the shard list, pull shard 0
// immediately (the newest ~1000 entries — everything the feed, filters, and
// first paint need), and fetch older shards LAZILY via loadAllShards() only
// when a full scan is genuinely required (Mine tab counts, daily-quota
// rebuilds, favorites/comments lookup).
//
// Below the threshold aggregate still writes a trivial index pointing at the
// legacy data.json, so this module works uniformly for both layouts. If the
// index 404s (very old deploy) we fall back to plain loadEntries().

function dataUrl(rel) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  return base.replace(/\/+$/, '/') + rel
}

async function fetchJson(rel) {
  let res
  try {
    res = await fetch(dataUrl(rel), { cache: 'no-store' })
  } catch (e) {
    if (e instanceof TypeError) return { offline: true, data: null, status: 0 }
    throw e
  }
  if (res.status === 404) return { offline: false, data: null, status: 404 }
  if (!res.ok) throw new Error(`加载数据失败 ${res.status}`)
  try {
    return { offline: false, data: await res.json(), status: res.status }
  } catch {
    throw new Error('数据格式异常，请刷新重试')
  }
}

// Load the newest slice of the feed plus the shard manifest.
// Returns { entries, index, loadedShards } where loadedShards is the list of
// shard files actually fetched (used by callers that decide whether a full
// rescan is needed). entries is newest-first, matching the old loadEntries
// ordering contract for the feed's sort.
export async function loadFeed() {
  const { data: index, status, offline } = await fetchJson('data-index.json')
  if (offline) {
    const fresh = await legacyLoad()
    return { entries: fresh, index: null, loadedShards: ['data.json'] }
  }
  if (status === 404 || !index || !Array.isArray(index.shards)) {
    const fresh = await legacyLoad()
    return { entries: fresh, index: null, loadedShards: ['data.json'] }
  }
  const first = index.shards[0]
  if (!first) return { entries: [], index, loadedShards: [] }
  const { data } = await fetchJson(first.file)
  const entries = Array.isArray(data) ? data : []
  return { entries, index, loadedShards: [first.file] }
}

// Pull every remaining shard and merge the full set. Callers that only ever
// need the newest N entries should stay on loadFeed; this is for whole-corpus
// scans (quota rebuilds, Mine favorites/comments, all-tags all-cities).
export async function loadAllShards({ index, loadedShards = [], entries = [] } = {}) {
  if (!index || !Array.isArray(index.shards) || index.shards.length <= 1) {
    return entries
  }
  const have = new Set(loadedShards)
  const parts = [entries]
  for (const shard of index.shards) {
    if (have.has(shard.file)) continue
    const { data } = await fetchJson(shard.file)
    if (Array.isArray(data)) parts.push(data)
  }
  // Shards are each newest-first and the manifest is ordered newest->oldest,
  // so a flat concat preserves feed order.
  return parts.flat()
}

// Legacy single-file read (trivial index or very old deploy).
async function legacyLoad() {
  const { data } = await fetchJson('data.json')
  return Array.isArray(data) ? data : []
}

// Map stubs — the Explore canvas renders bubbles, markers, and preview cards
// from these alone (aggregate's per-point shape under dist/points.json). The
// stub only carries the FIELDS a point/preview needs; hydrateEntry() rebuilds
// them into the richer shape UI components expect, so components never branch
// on which source the entry came from.
export async function loadPoints() {
  const { data } = await fetchJson('points.json')
  return Array.isArray(data) ? data : []
}

// Photos on the map are always thumb images; the shape points.json emits is
// already what `entryImages()` understands. `address` is empty because the
// stub drops it (privacy-by-omission: the preview only needs coordinates +
// city + description).
export function hydratePointstub(p) {
  if (!p || !p.id) return null
  const image = p.t || ''
  return {
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    city: p.city || '',
    address: '',
    description: p.d || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    image,
    images: image ? [image] : [],
    mood: p.m || '',
    weather: p.w || '',
    photoCount: p.f || 0,
    visibility: p.v === 'private' ? 'private' : 'public',
    createdAt: p.createdAt,
    status: 'published',
    deviceId: '', // stub deliberately omits it; DetailView loads the real entry
    _pointsStub: true, // flag: don't trust deviceId/comments from this record
  }
}

// Load the full (canonical) entry for one id: walk shard files until found.
// Used by DetailView when navigated to from map markers. Falls back to null
// on 404s or after all shards (deleted/never-existed). Newest-first order
// keeps the most common "recent point" case to 1–2 fetches.
export async function loadEntryById(id, index) {
  if (!id) return null
  const shards = index && Array.isArray(index.shards) ? index.shards : [{ file: 'data.json' }]
  for (const shard of shards) {
    const { data, status } = await fetchJson(shard.file)
    if (status === 404 || !Array.isArray(data)) continue
    const found = data.find((e) => e.id === id)
    if (found) return found
  }
  return null
}
