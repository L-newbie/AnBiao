// Device identity + per-day upload counting, all client-side in localStorage.
// This is a SOFT limit (clearable / bypassable). Reports are the hard backstop.

const DEVICE_KEY = 'gc_device_id'
const COUNT_KEY = (d) => `gc_uploads_${d}`
const REPORTED_KEY = 'gc_reported'

function today() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (local-ish; good enough)
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
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

// Per-device report tracking so the same device can't spam-report one entry.
const reportedSet = () => JSON.parse(localStorage.getItem(REPORTED_KEY) || '[]')

export function hasReported(id) {
  return reportedSet().includes(id)
}

export function markReported(id) {
  const set = reportedSet()
  set.push(id)
  localStorage.setItem(REPORTED_KEY, JSON.stringify(set))
}
