// Pre-build step: aggregate per-entry JSON files on the `data` branch into
// dist/data.json, copy images into dist/images, generate a downscaled
// thumbnail beside each one, and emit per-entry OG card pages under
// dist/entries/<id>.html. Hidden and author-deleted entries are excluded from
// the public feed but their files stay in the repo for audit.
//
// Run AFTER vite build so we operate on dist/.  (package.json runs this before
// vite build; see note in deploy workflow: we run it against a staging copy.)
//
// To keep things simple and robust, this script:
//   1. reads ./_data  (the checked-out data branch, populated by the workflow)
//   2. writes dist/data.json + copies dist/images/* + dist/entries/*.html
// It is a no-op if ./_data is absent (local dev has no data branch checked out).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const SRC = './_data' // populated by deploy.yml (sparse checkout of data branch)
const DIST = './dist'

// Statuses kept out of the public feed, applied to both entries and individual
// comments. Their data stays on the data branch for audit: 'hidden' is a
// moderation action, 'deleted' is the author removing their own entry/comment
// (see deleteEntry / deleteComment in src/lib/github.js).
const HIDDEN_STATUSES = new Set(['hidden', 'deleted'])

function loadEntries() {
  const dir = join(SRC, 'data')
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const entry = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      // Sort comments by time for stable display, and drop author-deleted ones
      // from the public feed (deleteComment in src/lib/github.js flips their
      // status in place; the objects stay in the file for audit, exactly like
      // a deleted entry's file stays on the branch). Other existing fields
      // (reports, etc.) are preserved verbatim — nothing is stripped.
      if (Array.isArray(entry.comments)) {
        entry.comments = entry.comments
          .filter((c) => c && !HIDDEN_STATUSES.has(c.status))
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      }
      out.push(entry)
    } catch (e) {
      console.warn('skip', f, e.message)
    }
  }
  return out
}

// Longest edge of the generated thumbnails, in px. The list views show images
// at 48px (我的·记录 / 收藏) up to ~180px (公开记录 cards, 2-col grid); 400
// covers all of them at 2x DPR. The detail view keeps using the full-size
// original — see thumbSrc() in src/lib/images.js.
const THUMB_EDGE = 400
const THUMB_QUALITY = 72

// sharp is a build-time-only dependency and native, so it can be missing in a
// bare local checkout. Resolve it lazily: without it we still copy originals
// and the app falls back to them (the <img> onerror handler in the list views
// covers a missing thumbnail).
async function loadSharp() {
  try {
    return (await import('sharp')).default
  } catch {
    console.warn('[aggregate] sharp not installed — skipping thumbnails, originals only.')
    return null
  }
}

// Copy every original into dist/images/ and write a downscaled <name>_thumb.jpg
// next to it. Thumbnails live ONLY in dist (a Pages artifact, gitignored) —
// they are regenerated on each build and never committed, so the data branch
// keeps holding just the originals.
async function copyImages() {
  const srcDir = join(SRC, 'images')
  if (!existsSync(srcDir)) return
  const outDir = join(DIST, 'images')
  mkdirSync(outDir, { recursive: true })
  const sharp = await loadSharp()
  let thumbs = 0
  let failed = 0
  for (const f of readdirSync(srcDir)) {
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase())) continue
    const from = join(srcDir, f)
    // The original is always copied, even if the thumbnail below fails.
    copyFileSync(from, join(outDir, f))
    if (!sharp) continue
    // Thumbnails are always .jpg regardless of the source extension, so the
    // path is predictable from the entry's image field alone.
    const thumbName = f.slice(0, -extname(f).length) + '_thumb.jpg'
    try {
      await sharp(from)
        // `inside` + withoutEnlargement: never upscale an already-small image,
        // and keep the aspect ratio (the views crop with object-cover).
        .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY })
        .toFile(join(outDir, thumbName))
      thumbs++
    } catch (e) {
      // One unreadable image must not fail the whole deploy — the app falls
      // back to the original for anything without a thumbnail.
      console.warn('[aggregate] thumbnail failed for', f, '-', e.message)
      failed++
    }
  }
  console.log(`[aggregate] thumbnails: ${thumbs} written${failed ? `, ${failed} failed` : ''}`)
}

// ---- OG share pages -------------------------------------------------------
// One tiny static HTML per public entry: crawlers (WeChat/QQ/Telegram/Twitter)
// read the Open Graph meta and build a rich card; real users are bounced into
// the SPA at the matching hash route. These pages are build artifacts, served
// by Pages, never precached (vite.config.js excludes **/entries/**).

const SITE_NAME = '比邻云 proxima'
const BASE = (process.env.VITE_BASE_URL || '/').replace(/\/+$/, '') // e.g. /proxima
const SITE_URL = (process.env.VITE_SITE_URL || '').replace(/\/+$/, '') // absolute origin if known

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Prefer the thumbnail for the card image (light); Pages serves it relatively,
// and crawlers need an absolute URL — so emit absolute only when SITE_URL is
// configured in the workflow, otherwise a root-relative fallback.
function absUrl(rel) {
  if (!rel) return ''
  const clean = rel.startsWith('/') ? rel : `${BASE}/${rel}`
  return SITE_URL ? SITE_URL + clean : clean
}

function firstImage(entry) {
  if (Array.isArray(entry.images) && entry.images.length) return entry.images[0]
  return entry.image || ''
}

function thumbOf(imagePath) {
  if (!imagePath) return ''
  const slash = imagePath.lastIndexOf('/')
  const dot = imagePath.lastIndexOf('.')
  if (dot <= slash + 1) return ''
  return imagePath.slice(0, dot) + '_thumb.jpg'
}

function writeOgPages(published) {
  const outDir = join(DIST, 'entries')
  const publicEntries = published.filter((e) => e.visibility !== 'private')
  if (!publicEntries.length) return 0
  mkdirSync(outDir, { recursive: true })
  let n = 0
  for (const e of publicEntries) {
    const desc = String(e.description || '').trim()
    const title = desc ? desc.slice(0, 40) : SITE_NAME
    const summary = desc.length > 40 ? desc.slice(0, 80) + '…' : desc || `${e.city || ''} · ${e.address || ''}`.trim()
    const ogImage = absUrl(thumbOf(firstImage(e)) || firstImage(e))
    const appUrl = `${BASE}/#/entry/${encodeURIComponent(e.id)}`
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · ${escapeHtml(SITE_NAME)}</title>
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(summary)}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)})</script>
</head>
<body>
<p>正在打开「${escapeHtml(title)}」… <a href="${escapeHtml(appUrl)}">点击进入</a></p>
</body>
</html>
`
    writeFileSync(join(outDir, `${e.id}.html`), html)
    n++
  }
  return n
}

// ---- Sharded feed (large-dataset plan) -----------------------------------
// At small scale one data.json is fine. Past SHARD_ACTIVATE entries the feed
// splits into FIXED-SIZE shards (not monthly — a burst month would defeat the
// point) plus a tiny index and a slim points file for the map.
//
// Shape:
//   data-index.json  { count, shards: [{ file, from, to, count, mtime }] }   (newest first)
//   data/data-000.json  (<= SHARD_SIZE entries, newest shard)
//   data/data-001.json  (older), ...
//   points.json      [{ id, lat, lng, createdAt }] — ~100B/entry for map use
//
// Shard files are NOT immutable: comments/deletes/visibility edits land on
// older shards too. Clients fetch with cache:'no-store' (workbox globIgnores
// cover **/data/**), so content-hash naming is unnecessary.
const SHARD_SIZE = 1000
const SHARD_ACTIVATE = 500

function writeShardedFeed(published, sorted) {
  // Newest first — `sorted` is the shared ordering main() already computed
  // (same array that feeds points.json), so no duplicated sort here.
  const shardDir = join(DIST, 'data')
  const mtime = new Date().toISOString()
  const shards = []
  for (let i = 0; i < sorted.length; i += SHARD_SIZE) {
    const slice = sorted.slice(i, i + SHARD_SIZE)
    const file = `data/data-${String(i / SHARD_SIZE).padStart(3, '0')}.json`
    if (!existsSync(shardDir)) mkdirSync(shardDir, { recursive: true })
    writeFileSync(join(DIST, file), JSON.stringify(slice))
    shards.push({
      file,
      from: slice[slice.length - 1]?.createdAt || null,
      to: slice[0]?.createdAt || null,
      count: slice.length,
      mtime,
    })
  }
  writeFileSync(
    join(DIST, 'data-index.json'),
    JSON.stringify({ count: sorted.length, shards }, null, 2),
  )
  return shards.length
}

// Per-point contract for dist/points.json: enough for the map to render its
// city bubbles, markers, and preview cards entirely from this file WITHOUT
// pulling the heavier shard entries. `t` uses the thumb so zoomed-in photo
// pins stay cheap (~400px); DetailView fetches the full shard on demand.
function mapPointStub(e) {
  const first = firstImage(e)
  return {
    id: e.id,
    lat: e.lat,
    lng: e.lng,
    city: e.city || '',
    tags: Array.isArray(e.tags) ? e.tags : [],
    t: thumbOf(first) || first,
    d: String(e.description || '').slice(0, 48),
    m: e.mood || '',
    w: e.weather || '',
    f: Array.isArray(e.images) ? e.images.length : first ? 1 : 0,
    v: e.visibility === 'private' ? 'private' : 'public',
    createdAt: e.createdAt,
  }
}

async function main() {
  if (!existsSync(SRC)) {
    console.log('[aggregate] no _data dir found — writing empty data.json (local dev).')
    if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })
    writeFileSync(join(DIST, 'data.json'), '[]')
    return
  }
  const all = loadEntries()
  // Multi-image: publish needs at least ONE image; e.image is kept == images[0]
  // by uploadEntry, but data written by older/simpler clients may only have one
  // of the two shapes.
  const published = all.filter(
    (e) => e && !HIDDEN_STATUSES.has(e.status) && e.lat && e.lng && firstImage(e),
  )
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })
  writeFileSync(join(DIST, 'data.json'), JSON.stringify(published))
  // Map-first payload ALWAYS: the Explore canvas renders bubbles/markers/cards
  // without waiting for the shard feed, at every data size.
  const sorted = [...published].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  )
  writeFileSync(join(DIST, 'points.json'), JSON.stringify(sorted.map(mapPointStub)))
  if (published.length > SHARD_ACTIVATE) {
    const n = writeShardedFeed(published, sorted)
    console.log(`[aggregate] sharded: ${n} shard(s) under dist/data/ + data-index.json`)
  } else {
    // Below the threshold keep the simple single-file form. A trivial index
    // still documents the format for clients that prefer loadFeed().
    writeFileSync(
      join(DIST, 'data-index.json'),
      JSON.stringify({ count: published.length, shards: [{ file: 'data.json', from: null, to: null, count: published.length, mtime: new Date().toISOString() }] }, null, 2),
    )
  }
  await copyImages()
  const og = writeOgPages(published)
  if (og) console.log(`[aggregate] OG pages: ${og} written to dist/entries/`)
  console.log(`[aggregate] wrote ${published.length} entries to dist/data.json`)
}

main()
