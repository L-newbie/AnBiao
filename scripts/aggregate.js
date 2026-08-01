// Pre-build step: aggregate per-entry JSON files on the `data` branch into a
// single dist/data.json, and copy images into dist/images. Hidden entries are
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

function loadEntries() {
  const dir = join(SRC, 'data')
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const entry = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      // Sort comments by time for stable display. Existing fields (reports,
      // comments, etc.) are preserved verbatim — nothing is stripped.
      if (Array.isArray(entry.comments)) {
        entry.comments.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      }
      out.push(entry)
    } catch (e) {
      console.warn('skip', f, e.message)
    }
  }
  return out
}

function copyImages() {
  const srcDir = join(SRC, 'images')
  if (!existsSync(srcDir)) return
  mkdirSync(join(DIST, 'images'), { recursive: true })
  for (const f of readdirSync(srcDir)) {
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase())) {
      copyFileSync(join(srcDir, f), join(DIST, 'images', f))
    }
  }
}

function main() {
  if (!existsSync(SRC)) {
    console.log('[aggregate] no _data dir found — writing empty data.json (local dev).')
    if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })
    writeFileSync(join(DIST, 'data.json'), '[]')
    return
  }
  const all = loadEntries()
  const published = all.filter((e) => e && e.status !== 'hidden' && e.lat && e.lng && e.image)
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true })
  writeFileSync(join(DIST, 'data.json'), JSON.stringify(published))
  copyImages()
  console.log(`[aggregate] wrote ${published.length} entries to dist/data.json`)
}

main()
