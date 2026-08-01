// Thin wrapper around the GitHub REST Contents API for the data branch.
// Writes go to data/<id>.json and images/<id>.<ext>.
// Reads at runtime hit the prebuilt data.json (one fetch, no rate-limit risk).

import { config } from './config.js'

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
export async function uploadEntry({ id, deviceId, lat, lng, city, address, description, imageB64, imageExt }) {
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
    image: imgPath,
    status: 'published',
  }
  await putFile(jsonPath, btoa(unescape(encodeURIComponent(JSON.stringify(entry, null, 2)))), `chore: add entry ${id}`)
  return entry
}

// Runtime read: one fetch of the prebuilt aggregate served by Pages.
export async function loadEntries() {
  const res = await fetch(config.dataUrl, { cache: 'no-store' })
  if (res.status === 404) return []
  if (!res.ok) throw new Error('无法加载数据')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}
