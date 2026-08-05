// Pre-build step: aggregate per-entry JSON files on the `data` branch into a
// single dist/data.json, copy images into dist/images, and generate a
// downscaled thumbnail beside each one. Hidden and author-deleted entries are
// excluded from the public feed but their files stay in the repo for audit.
//
// Run AFTER vite build so we operate on dist/.  (package.json runs this before
// vite build; see note in deploy workflow: we run it against a staging copy.)
//
// To keep things simple and robust, this script:
//   1. reads ./_data  (the checked-out data branch, populated by the workflow)
//   2. writes dist/data.json + copies dist/images/*
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

async function main() {
  if (!existsSync(SRC)) {
    console.log('[aggregate] no _data dir found — writing empty data.json (local dev).')
    if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })
    writeFileSync(join(DIST, 'data.json'), '[]')
    return
  }
  const all = loadEntries()
  const published = all.filter(
    (e) => e && !HIDDEN_STATUSES.has(e.status) && e.lat && e.lng && e.image,
  )
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })
  writeFileSync(join(DIST, 'data.json'), JSON.stringify(published))
  await copyImages()
  console.log(`[aggregate] wrote ${published.length} entries to dist/data.json`)
}

main()
