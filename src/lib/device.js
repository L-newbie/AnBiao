// Device identity + per-day upload counting, all client-side in localStorage.
// This is a SOFT limit (clearable / bypassable), but the device id is derived
// from a stable fingerprint so clearing localStorage does NOT reset it (the
// same browser/device recomputes the same id). That lets the daily counters
// be rebuilt from data.json after a cache wipe.

const DEVICE_KEY = 'gc_device_id'
const COUNT_KEY = (d) => `gc_uploads_${d}`

// LOCAL calendar day as YYYY-MM-DD. (Was new Date().toISOString().slice(0,10),
// which is UTC: users east of UTC saw "today" roll over at the wrong hour and
// west-of-UTC users could double-dip quotas around midnight. Local is the only
// sensible interpretation of "today" for a per-person daily quota.)
function today() {
  const d = new Date()
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

// createdAt values are ISO UTC (server-written). Convert to the viewer's local
// calendar day before comparing against today(), or quota rebuilds disagree
// with the counters near midnight.
function localDay(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
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
      // FROZEN STRING — do not rename to match the brand. This text is INPUT to
      // the canvas fingerprint, so changing a single character changes every
      // existing device's id, which resets their 化名, avatar and daily quotas.
      // It survived the 暗标 → 比邻云 rename for exactly this reason.
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

// Nickname system — "半糖叛逆系" long names. Deterministically derived from
// the device id, so the same browser always gets the same name even after a
// cache clear (the canvas fingerprint survives — see fingerprint() above).
//
// Each full name has TWO parts combined here:
//   1. a two-slot phrase from the vocab below (40 × 40 = 1600 combos)
//   2. a short id suffix derived from the device id's own hex, so display can
//      disambiguate collisions on demand (see displayName below)
//
// The longer phrase format is deliberate: 4–6 Chinese characters reads like a
// username a human would actually pick, unlike the old 暮色拾光/孤月问茶
// two-character names that read like a placeholder. They're playful but
// inoffensive, and (importantly for a map community) they don't encode any
// real identity signal — no places, no genders, no ages.

const NAME_A = [
  '偷吃宵夜的', '减肥失败的', '守夜冠军', '逃课多次的', '被猫奴役的',
  '赶不上末班车的', '带薪上厕所的', '喝假酒上头的', '靠奶茶续命的', '熬夜改稿的',
  '半路迷路的', '自言自语的', '买三杯奶茶的', '躺平又怕输的', '攒塑料袋的',
  '下雨天不带伞的', '总想早退的', '地铁挤成纸片的', '给树拍照的', '电梯里唱歌的',
  '凌晨改方案的', '囤葱囤蒜的', '网购成瘾的', '周末不出门的', '脚踩西瓜皮的',
  '热衷摆烂的', '爱管闲事的', '三分钟热度的', '靠外卖过活的', '爱凑热闹的',
  '半夜刷菜谱的', '囤剧不看的', '早起失败的', '长期失联的', '爱吹牛的',
  '记性差的', '踩点到位的', '爱捡瓶子的', '睡过头的', '偷看热闹的',
]

const NAME_B = [
  '自律教练', '情绪摆烂师', '泡面研究员', '带薪如厕员', '末班哲学家',
  '奶茶质检员', '搬砖探险家', '晚霞收藏家', '影子调音师', '摸鱼运动员',
  '辣条销冠', '咖啡续命师', '合租界的诗人', '晚风临时工', '摸鱼界元老',
  '冰箱挖掘者', '棉被山大王', '废话制造机', '散装诗人', '半夜冥想家',
  '阳台园艺师', '负能量回收站', '快乐债主', '碳水狂热粉', '电梯音乐总监',
  '理 发店考察员', '下雨天测报员', '熬夜发声明者', '过期零食猎手', '广场舞预备生',
  '情绪煎饼侠', '乌龙观察员', '日落质检员', '朋友圈潜水员', '打工魂本魂',
  '流浪猫首席助理', '迟到界的劳模', '薅羊毛运动员', '半糖去冰师', '楼道流浪歌手',
]

function hashStr(s) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

export function getPoeticName(deviceId = getDeviceId()) {
  const h = hashStr(deviceId)
  return NAME_A[h % NAME_A.length] + NAME_B[(h >>> 8) % NAME_B.length]
}

// Short hex suffix for disambiguation: shown in full-name contexts (comment
// threads, the Mine identity card) where two devices could collide on the
// same phrase. List views (comment rows, card bylines) use displayName()
// which adds it ALWAYS in reduced form so a new user instantly sees it's part
// of the name, not a separate badge. Uses the id's last 3 hex chars (not the
// masked first 8) because the hash already scatters first chars evenly.
export function getShortCode(deviceId = getDeviceId()) {
  return deviceId.replace(/-/g, '').slice(-3) || '000'
}

export function getFullName(deviceId = getDeviceId()) {
  return getPoeticName(deviceId) + '#' + getShortCode(deviceId)
}

// Default display: the phrase plus a smaller short code. Readable as a single
// handle ("偷看热闹的摸鱼运动员#a3f") and safely disambiguates the ~1600
// collision space.
export function displayName(deviceId = getDeviceId()) {
  return getFullName(deviceId)
}

// Legacy name used by getAvatar's glyph (kept stable so existing identity
// colors don't shift on devices that already have data). Old 暮色拾光-style
// names are NOT shown anywhere by default — getPoeticName is the only source
// for text. The glyph is the last char of the phrase, which is more playful.

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
// `createdAt` is ISO (UTC); rebuilt counts convert to the LOCAL calendar day
// via localDay() to match the local-day counters written by recordUpload().

function isToday(iso) {
  if (!iso) return false
  return localDay(iso) === today()
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
