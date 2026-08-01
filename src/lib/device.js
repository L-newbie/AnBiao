// Device identity + per-day upload counting, all client-side in localStorage.
// This is a SOFT limit (clearable / bypassable), but the device id is derived
// from a stable fingerprint so clearing localStorage does NOT reset it (the
// same browser/device recomputes the same id). That lets the daily counters
// be rebuilt from data.json after a cache wipe.

const DEVICE_KEY = 'gc_device_id'
const COUNT_KEY = (d) => `gc_uploads_${d}`

function today() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (local-ish; good enough)
}

// FNV-1a hash for fingerprinting. Stable across runs for the same input.
function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

// Build a device fingerprint from stable browser attributes + a canvas
// rendering hash. Same browser/device → same fingerprint → same device id,
// even after clearing localStorage. It is NOT cryptographic and can be
// spoofed, but it makes casual cache-clearing stop resetting the limits.
function fingerprint() {
  const nav = navigator || {}
  const scr = screen || {}
  const parts = [
    nav.userAgent || '',
    nav.language || '',
    (nav.languages || []).join(','),
    String(nav.platform || ''),
    String(nav.hardwareConcurrency || ''),
    String((nav.deviceMemory || '')),
    String(scr.width) + 'x' + String(scr.height),
    String(scr.colorDepth),
    String(scr.pixelDepth),
    new Date().getTimezoneOffset(),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  ]
  let fp = parts.join('|')
  // Canvas fingerprint: rendering the same glyphs differs subtly across
  // devices/OSes, adding entropy that survives cache clears.
  try {
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 60
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = '14px "Arial"'
      ctx.fillStyle = '#f60'
      ctx.fillRect(0, 0, 240, 60)
      ctx.fillStyle = '#069'
      ctx.fillText('暗标·暮色拾光 记夕问茶 abc123', 2, 2)
      fp += '|' + c.toDataURL()
    }
  } catch {
    /* canvas blocked — base fingerprint still works */
  }
  return fnv1a(fp)
}

export function getDeviceId() {
  // Prefer a cached id; if absent (cleared cache / new install), recompute from
  // the fingerprint so the SAME device gets the SAME id back.
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = 'fp-' + fingerprint()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

// Poetic virtual name derived deterministically from the device id, e.g. "暮色拾光".
const POETIC_A = ['暮色', '晨雾', '晚星', '薄雾', '孤月', '残阳', '疏影', '微光']
const POETIC_B = ['拾光', '听雨', '观云', '寻风', '望月', '踏雪', '问茶', '记夕']

function hashStr(s) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

export function getPoeticName(deviceId = getDeviceId()) {
  const h = hashStr(deviceId)
  return POETIC_A[h % POETIC_A.length] + POETIC_B[(h >>> 8) % POETIC_B.length]
}

// Deterministic avatar: a cyan→sea-blue gradient + a serif glyph (last char
// of the poetic name). Pure CSS/SVG, no external deps.
export function getAvatar(deviceId = getDeviceId()) {
  const h = hashStr(deviceId)
  const hues = [180, 190, 200, 210, 220] // cyan→sea-blue range
  const h1 = hues[h % hues.length]
  const h2 = hues[(h >>> 8) % hues.length]
  return {
    gradient: `linear-gradient(135deg, hsl(${h1} 65% 42%), hsl(${h2} 70% 50%))`,
    glyph: getPoeticName(deviceId).slice(-1),
  }
}

// Device code masked to the first 8 hex chars (dashes stripped) + ellipsis.
export function maskedDeviceCode(deviceId = getDeviceId()) {
  return deviceId.replace(/-/g, '').slice(0, 8) + '…'
}

export function uploadsToday() {
  return parseInt(localStorage.getItem(COUNT_KEY(today())) || '0', 10)
}

export function remainingToday(max) {
  return Math.max(0, max - uploadsToday())
}

export function recordUpload() {
  const key = COUNT_KEY(today())
  const n = parseInt(localStorage.getItem(key) || '0', 10)
  localStorage.setItem(key, String(n + 1))
}

// Per-device per-day comment counting (soft limit, like uploads).
const COMMENT_KEY = (d) => `gc_comments_${d}`

export function commentsToday() {
  return parseInt(localStorage.getItem(COMMENT_KEY(today())) || '0', 10)
}

export function remainingCommentsToday(max) {
  return Math.max(0, max - commentsToday())
}

export function recordComment() {
  const key = COMMENT_KEY(today())
  const n = parseInt(localStorage.getItem(key) || '0', 10)
  localStorage.setItem(key, String(n + 1))
}

// ---- Rebuild counts from server data after a cache wipe ----
//
// Clearing localStorage zeroes the soft counters AND would regenerate a new
// random id — except the id is now fingerprint-derived, so the same device
// gets the same id back. With a stable id we can scan the aggregated entries
// (which carry deviceId + createdAt on every record and comment) and rebuild
// today's usage. We take the MAX of the local count and the rebuilt count so
// optimistic (not-yet-aggregated) actions are never lost and server-side
// truth wins when higher.
//
// `createdAt` is ISO (UTC); we compare against the UTC date slice, matching
// the `today()` helper used by the localStorage counters.

function isToday(iso) {
  if (!iso) return false
  return String(iso).slice(0, 10) === today()
}

// Rebuild today's upload count for this device from aggregated entries.
export function rebuildUploadsToday(entries, deviceId = getDeviceId()) {
  const server = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && e.deviceId === deviceId && isToday(e.createdAt),
  ).length
  return Math.max(uploadsToday(), server)
}

// Rebuild today's comment count for this device across all entries' comments.
export function rebuildCommentsToday(entries, deviceId = getDeviceId()) {
  let server = 0
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !Array.isArray(e.comments)) continue
    server += e.comments.filter((c) => c.deviceId === deviceId && isToday(c.createdAt)).length
  }
  return Math.max(commentsToday(), server)
}
