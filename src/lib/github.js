// Thin wrapper around the GitHub REST Contents API for the data branch.
// Writes go to data/<id>.json and images/<id>-<i>.<ext>.
// Reads at runtime hit the prebuilt data.json (one fetch, no rate-limit risk).
//
// The five mutations (uploadEntry / addComment / deleteEntry / setEntryVisibility /
// deleteComment) are QUEUE-FIRST wrappers around the exec* implementations below:
// when the device is offline — or the network fetch itself failed (TypeError) —
// the operation is persisted to the IndexedDB outbox (src/lib/outbox.js) and a
// QueuedOfflineError sentinel is thrown so callers keep their optimistic UI and
// show 同步中 instead of an error. src/lib/sync.js drains the outbox later.

import { config } from './config.js'
import { utf8ToB64, b64ToUtf8 } from './encoding.js'
import { enqueue } from './outbox.js'

const API = 'https://api.github.com'

// Thrown when a mutation couldn't reach GitHub and has been queued for later
// sync. Callers must catch this separately from real errors.
export class QueuedOfflineError extends Error {
  constructor(message = '已离线，稍后将自动同步') {
    super(message)
    this.name = 'QueuedOfflineError'
  }
}

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

async function safeJson(res, fallbackMsg) {
  try {
    return await res.json()
  } catch {
    throw new Error(fallbackMsg)
  }
}

// Create or update a file. GitHub needs base64 content and, for updates, the
// current file SHA. New files have no SHA yet. `skipIfExists` is used by the
// outbox re-drain: a retried upload must not clobber a file its first attempt
// already wrote (it would 422 without a sha anyway).
async function putFile(path, contentB64, message, sha, { skipIfExists = false } = {}) {
  const body = { message, content: contentB64, branch: config.dataBranch }
  let effectiveSha = sha
  if (skipIfExists && !effectiveSha) {
    const existing = await getFileMeta(path)
    if (existing) return { skipped: true }
  }
  if (effectiveSha) body.sha = effectiveSha
  let res
  try {
    res = await fetch(API + repoPath(path), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    })
  } catch (e) {
    if (e instanceof TypeError) throw new Error('NETWORK_ERROR')
    throw e
  }
  if (!res.ok) {
    let t = ''
    try {
      t = await res.text()
    } catch {
      /* body unreadable — keep the status code as the message */
    }
    throw new Error(`GitHub 写入失败 ${res.status}${t ? ': ' + t.slice(0, 160) : ''}`)
  }
  return safeJson(res, '网络异常，请重试')
}

// Upload one entry: N images + one metadata JSON. Multi-image keeps `image`
// set to the first path for old clients/aggregate; `images` is canonical.
// UUID paths => no race between fresh uploads. Retried outbox drains pass
// skipIfExists so a partial first attempt completes instead of 422ing.
export async function execUploadEntry({ id, deviceId, lat, lng, city, address, description, tags, images, imageB64, imageExt, visibility = 'public', mood = '', weather = '' }) {
  // Back-compat: single-image callers pass { imageB64, imageExt }.
  const imgs =
    Array.isArray(images) && images.length
      ? images.map((it, i) => ({ b64: it.b64 ?? it.imageB64, ext: it.ext ?? it.imageExt ?? 'jpg', idx: i }))
      : [{ b64: imageB64, ext: imageExt, idx: 0 }]
  if (!imgs[0].b64) throw new Error('缺少图片')
  const paths = imgs.map((it) => (imgs.length === 1 ? `images/${id}.${it.ext}` : `images/${id}-${it.idx}.${it.ext}`))
  for (let i = 0; i < imgs.length; i++) {
    await putFile(paths[i], imgs[i].b64, `chore: add image ${id} [${i}]`, undefined, { skipIfExists: true })
  }
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
    image: paths[0],
    images: paths,
    status: 'published',
    // 'private' entries are still aggregated into the public data.json — the
    // app filters them out of the community feed and shows them only to their
    // author. See src/lib/entryVisibility.js for why.
    visibility: visibility === 'private' ? 'private' : 'public',
  }
  // Optional lightweight context tags: single-word keys, rendered as emojis in
  // the UI. Empty means "didn't pick one" (the sheet's pickers are optional).
  if (mood) entry.mood = mood
  if (weather) entry.weather = weather
  await putFile(`data/${id}.json`, utf8ToB64(JSON.stringify(entry, null, 2)), `chore: add entry ${id}`, undefined, { skipIfExists: true })
  return entry
}

// Fetch a single file's content + SHA from the data branch (used for the
// read-modify-write comment flow AND by the outbox for idempotent re-drains).
export async function getFileMeta(path) {
  let res
  try {
    res = await fetch(API + repoPath(path), { headers: headers(false) })
  } catch (e) {
    if (e instanceof TypeError) throw new Error('NETWORK_ERROR')
    throw e
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub 读取失败 ${res.status}`)
  return safeJson(res, '网络异常，请重试')
}

// Shared read-modify-write runner for the entry-JSON mutations: read fresh,
// transform, PUT with sha, retry once more with a fresh sha on 409. Every
// non-touched field (comments, reports, …) is preserved verbatim because
// `transform` mutates a full copy.
async function updateEntryJson(entryId, actionLabel, transform) {
  const path = `data/${entryId}.json`
  const MAX_TRIES = 3
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const meta = await getFileMeta(path)
    if (!meta) throw new Error('找不到该记录')
    let entry
    try {
      entry = JSON.parse(b64ToUtf8(meta.content))
    } catch {
      throw new Error('记录数据损坏，无法更新')
    }
    const outcome = transform(entry)
    if (outcome === 'skip') return { alreadyGone: true }
    const b64 = utf8ToB64(JSON.stringify(entry, null, 2))
    let res
    try {
      res = await fetch(API + repoPath(path), {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ message: `chore: ${actionLabel} ${entryId}`, content: b64, branch: config.dataBranch, sha: meta.sha }),
      })
    } catch (e) {
      if (e instanceof TypeError) throw new Error('NETWORK_ERROR')
      throw e
    }
    if (res.ok) return safeJson(res, '网络异常，请重试')
    if (res.status === 409 && attempt < MAX_TRIES) {
      // Someone else updated the file since we read it; retry with fresh SHA.
      continue
    }
    let t = ''
    try {
      t = await res.text()
    } catch {
      /* keep status-only message */
    }
    const msg = `${actionLabel}失败 ${res.status}${t ? ': ' + t.slice(0, 160) : ''}`
    // 401/403 (bad token), 404 (entry gone), 422 (validation) will never succeed
    // on retry — mark them permanent so the outbox stops retrying.
    const err = new Error(msg)
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 422) err.permanent = true
    throw err
  }
  throw new Error(`${actionLabel}失败：多次冲突，请稍后重试`)
}

// Append a comment to an entry's JSON.
export function execAddComment(entryId, comment) {
  return updateEntryJson(entryId, '留言', (entry) => {
    entry.comments = [...(entry.comments || []), comment]
  })
}

// Soft-delete: mark the JSON instead of removing the file, so the record stays
// auditable. The next aggregation drops it from the public data.json.
// Works for pending ("同步中") entries too — uploadEntry wrote their file first.
export function execDeleteEntry(entryId) {
  return updateEntryJson(entryId, '删除记录', (entry) => {
    entry.status = 'deleted'
    entry.deletedAt = new Date().toISOString()
  })
}

// Flip an entry between public and private. Unlike deleteEntry this does NOT
// keep the entry out of the aggregate: private entries stay in data.json so the
// author still sees them after a cache clear / on another device; the app hides
// them from the public feed (src/lib/entryVisibility.js).
export function execSetEntryVisibility(entryId, visibility) {
  const next = visibility === 'private' ? 'private' : 'public'
  return updateEntryJson(entryId, `设置可见性 ${next}`, (entry) => {
    entry.visibility = next
  })
}

// Soft-delete ONE comment in place. A comment that isn't in the array resolves
// { alreadyGone: true } instead of throwing: the end state the caller wants
// already holds, and it still needs to clear its optimistic local copy.
export function execDeleteComment(entryId, commentId) {
  return updateEntryJson(entryId, `删除留言 ${commentId}`, (entry) => {
    const list = Array.isArray(entry.comments) ? entry.comments : []
    const target = list.find((c) => c && c.id === commentId)
    if (!target) return 'skip'
    target.status = 'deleted'
    target.deletedAt = new Date().toISOString()
  })
}

// ---- Queue-first public mutations ----
// Each wraps its exec*: offline (navigator.onLine false) or a network-layer
// failure enqueues the exact payload and throws the QueuedOfflineError
// sentinel. Anything else (4xx, conflicts exhausted, bad data) rethrows as-is.

function isNetworkError(e) {
  return e instanceof TypeError || (e && e.message === 'NETWORK_ERROR')
}

async function queueFirst(kind, payload, executor) {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('NETWORK_ERROR')
    return await executor()
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue(kind, payload)
      throw new QueuedOfflineError()
    }
    throw e
  }
}

export function uploadEntry(payload) {
  // Keep the payload self-contained for the outbox: everything execUploadEntry
  // needs must be on this object (including base64 images).
  const { id, deviceId, lat, lng, city, address, description, tags, images, imageB64, imageExt, visibility, mood, weather } = payload
  const clean = {
    id,
    deviceId,
    lat,
    lng,
    city,
    address,
    description,
    tags: Array.isArray(tags) ? tags : [],
    visibility: visibility === 'private' ? 'private' : 'public',
  }
  if (mood) clean.mood = mood
  if (weather) clean.weather = weather
  if (Array.isArray(images) && images.length) {
    clean.images = images.map((it) => ({ b64: it.b64 ?? it.imageB64, ext: it.ext ?? it.imageExt ?? 'jpg' }))
  } else {
    clean.imageB64 = imageB64
    clean.imageExt = imageExt
  }
  return queueFirst('entry', clean, () => execUploadEntry(clean))
}

export function addComment(entryId, comment) {
  return queueFirst('comment', { entryId, comment }, () => execAddComment(entryId, comment))
}

export function deleteEntry(entryId) {
  return queueFirst('deleteEntry', { entryId }, () => execDeleteEntry(entryId))
}

export function setEntryVisibility(entryId, visibility) {
  return queueFirst('visibility', { entryId, visibility }, () => execSetEntryVisibility(entryId, visibility))
}

export function deleteComment(entryId, commentId) {
  return queueFirst('deleteComment', { entryId, commentId }, () => execDeleteComment(entryId, commentId))
}

// Runtime reads go through src/lib/feed.js (data-index/shards/points); the
// aggregate loader path (data.json direct fetch) is no longer used by the app.
