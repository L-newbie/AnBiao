// Thin wrapper around the GitHub REST Contents API for the data branch.
// Writes go to data/<id>.json and images/<id>.<ext>.
// Reads at runtime hit the prebuilt data.json (one fetch, no rate-limit risk).

import { config } from './config.js'
import { utf8ToB64, b64ToUtf8 } from './encoding.js'

const API = 'https://api.github.com'

function headers(json = true) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (config.token) h.Authorization = `Bearer ${config.token}`
  if (json) h['Content-Type'] = 'application/json'
  return h
}

function repoPath(p) {
  return `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(p)}?ref=${config.dataBranch}`
}

// Create or update a file. GitHub needs base64 content and, for updates, the
// current file SHA. New files have no SHA yet.
async function putFile(path, contentB64, message, sha) {
  const body = { message, content: contentB64, branch: config.dataBranch }
  if (sha) body.sha = sha
  const res = await fetch(API + repoPath(path), {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`GitHub 写入失败 ${res.status}: ${t}`)
  }
  return res.json()
}

// Upload one image + its metadata JSON as two new files. UUID paths => no race.
export async function uploadEntry({ id, deviceId, lat, lng, city, address, description, tags, imageB64, imageExt, visibility = 'public' }) {
  const imgPath = `images/${id}.${imageExt}`
  const jsonPath = `data/${id}.json`
  await putFile(imgPath, imageB64, `chore: add image ${id}`)
  const entry = {
    id,
    deviceId,
    createdAt: new Date().toISOString(),
    lat,
    lng,
    city,
    address,
    description,
    tags: Array.isArray(tags) ? tags : [],
    image: imgPath,
    status: 'published',
    // 'private' entries are still aggregated into the public data.json — the
    // app filters them out of the community feed and shows them only to their
    // author. See src/lib/entryVisibility.js for why.
    visibility: visibility === 'private' ? 'private' : 'public',
  }
  await putFile(jsonPath, utf8ToB64(JSON.stringify(entry, null, 2)), `chore: add entry ${id}`)
  return entry
}

// Fetch a single file's content + SHA from the data branch (used for the
// read-modify-write comment flow).
async function getFileMeta(path) {
  const res = await fetch(API + repoPath(path), { headers: headers(false) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub 读取失败 ${res.status}`)
  return res.json()
}

// Append a comment to an entry's JSON. Uses a read-modify-write with the
// file SHA: GitHub rejects concurrent updates to the same file with 409, so
// on conflict we re-read the latest SHA and retry. `reports` and any other
// existing fields are preserved verbatim — nothing is stripped.
export async function addComment(entryId, comment) {
  const path = `data/${entryId}.json`
  const MAX_TRIES = 3
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const meta = await getFileMeta(path)
    if (!meta) throw new Error('找不到该记录')
    const entry = JSON.parse(b64ToUtf8(meta.content))
    entry.comments = [...(entry.comments || []), comment]
    const b64 = utf8ToB64(JSON.stringify(entry, null, 2))
    const res = await fetch(API + repoPath(path), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ message: `chore: comment ${entryId}`, content: b64, branch: config.dataBranch, sha: meta.sha }),
    })
    if (res.ok) return res.json()
    if (res.status === 409 && attempt < MAX_TRIES) {
      // Someone else updated the file since we read it; retry with fresh SHA.
      continue
    }
    const t = await res.text()
    throw new Error(`留言失败 ${res.status}: ${t}`)
  }
  throw new Error('留言失败：多次冲突，请稍后重试')
}

// Soft-delete an entry: mark its JSON on the data branch instead of removing
// the file, so the record stays auditable. The next aggregation drops it from
// the public data.json (see scripts/aggregate.js). Same read-modify-write +
// SHA + 409 retry shape as addComment; every other field (comments, reports,
// image, …) is preserved verbatim.
//
// Note pending ("同步中") entries already have their file on the data branch —
// uploadEntry writes it before returning — so this works for them too.
export async function deleteEntry(entryId) {
  const path = `data/${entryId}.json`
  const MAX_TRIES = 3
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const meta = await getFileMeta(path)
    if (!meta) throw new Error('找不到该记录')
    const entry = JSON.parse(b64ToUtf8(meta.content))
    entry.status = 'deleted'
    entry.deletedAt = new Date().toISOString()
    const b64 = utf8ToB64(JSON.stringify(entry, null, 2))
    const res = await fetch(API + repoPath(path), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ message: `chore: delete entry ${entryId}`, content: b64, branch: config.dataBranch, sha: meta.sha }),
    })
    if (res.ok) return res.json()
    if (res.status === 409 && attempt < MAX_TRIES) {
      // Someone else updated the file since we read it (e.g. a comment landed);
      // retry with a fresh SHA so we don't clobber it.
      continue
    }
    const t = await res.text()
    throw new Error(`删除失败 ${res.status}: ${t}`)
  }
  throw new Error('删除失败：多次冲突，请稍后重试')
}

// Flip an entry between public and private. Same read-modify-write + SHA + 409
// retry shape as deleteEntry, and for the same reason — a comment landing on
// the entry between our read and write must not be clobbered. Every other
// field is preserved verbatim; only `visibility` changes.
//
// Unlike deleteEntry, this does NOT keep the entry out of the aggregate:
// scripts/aggregate.js still emits private entries into data.json so their
// author can see them in 我的·记录 after a cache clear or on another device.
// The app is what hides them from the public feed.
export async function setEntryVisibility(entryId, visibility) {
  const next = visibility === 'private' ? 'private' : 'public'
  const path = `data/${entryId}.json`
  const MAX_TRIES = 3
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const meta = await getFileMeta(path)
    if (!meta) throw new Error('找不到该记录')
    const entry = JSON.parse(b64ToUtf8(meta.content))
    entry.visibility = next
    const b64 = utf8ToB64(JSON.stringify(entry, null, 2))
    const res = await fetch(API + repoPath(path), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ message: `chore: set visibility ${entryId} ${next}`, content: b64, branch: config.dataBranch, sha: meta.sha }),
    })
    if (res.ok) return res.json()
    if (res.status === 409 && attempt < MAX_TRIES) {
      // Someone else updated the file since we read it; retry with a fresh SHA.
      continue
    }
    const t = await res.text()
    throw new Error(`修改可见性失败 ${res.status}: ${t}`)
  }
  throw new Error('修改可见性失败：多次冲突，请稍后重试')
}

// Soft-delete ONE comment on an entry: flip that comment's status to 'deleted'
// in place inside the entry JSON. Same read-modify-write + SHA + 409 retry
// shape as addComment/deleteEntry, and for the same reason — a concurrent
// comment on the entry must not be clobbered. The comment object itself stays
// in the array so the record remains auditable; scripts/aggregate.js is what
// keeps it out of the public feed.
//
// A comment that isn't in the array resolves as { alreadyGone: true } instead
// of throwing: the end state the caller wants (not on the branch) already
// holds, and it still needs to clear its local copy. That covers an optimistic
// comment whose write never landed because the tab closed mid-flight.
export async function deleteComment(entryId, commentId) {
  const path = `data/${entryId}.json`
  const MAX_TRIES = 3
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const meta = await getFileMeta(path)
    if (!meta) throw new Error('找不到该记录')
    const entry = JSON.parse(b64ToUtf8(meta.content))
    const list = Array.isArray(entry.comments) ? entry.comments : []
    const target = list.find((c) => c && c.id === commentId)
    if (!target) return { alreadyGone: true }
    target.status = 'deleted'
    target.deletedAt = new Date().toISOString()
    const b64 = utf8ToB64(JSON.stringify(entry, null, 2))
    const res = await fetch(API + repoPath(path), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ message: `chore: delete comment ${commentId}`, content: b64, branch: config.dataBranch, sha: meta.sha }),
    })
    if (res.ok) return res.json()
    if (res.status === 409 && attempt < MAX_TRIES) {
      // Someone else appended a comment since we read it; retry with a fresh
      // SHA so their write survives ours.
      continue
    }
    const t = await res.text()
    throw new Error(`删除留言失败 ${res.status}: ${t}`)
  }
  throw new Error('删除留言失败：多次冲突，请稍后重试')
}

// Runtime read: one fetch of the prebuilt aggregate served by Pages.
export async function loadEntries() {
  const res = await fetch(config.dataUrl, { cache: 'no-store' })
  if (res.status === 404) return []
  if (!res.ok) throw new Error('无法加载数据')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}
