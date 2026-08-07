// Visited places ("我去过这里") — a personal check-in log independent of
// any record uploads. Each place is { id: slug, lat, lng, city, savedAt }
// stored as JSON array under gc_visited.
//
// The map shows these as small personal pins separate from community markers,
// so the map answers both "what has anyone posted here" and "where have I
// been". MineView can surface the log too.

import { ref } from 'vue'
import { readJson, writeJson } from './storage.js'

const KEY = 'gc_visited'
const MAX_ENTRIES = 200

function load() {
  const arr = readJson(KEY, [])
  return Array.isArray(arr) ? arr.filter((v) => v && Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng))) : []
}

export const visited = ref(load())

function persist() {
  writeJson(KEY, visited.value.slice(-MAX_ENTRIES))
}

// Small deterministic id from timestamp so duplicate pins pull up at the same
// place (re-visits UPDATE the savedAt, not duplicate).
function makeId(lat, lng) {
  return `${Math.round(Number(lat) * 10000) / 10000},${Math.round(Number(lng) * 10000) / 10000}`
}

export function isVisited(lat, lng) {
  return visited.value.some((v) => makeId(v.lat, v.lng) === makeId(lat, lng))
}

export function addVisited({ lat, lng, city = '', address = '' }) {
  const id = makeId(lat, lng)
  const savedAt = new Date().toISOString()
  const existing = visited.value.find((v) => makeId(v.lat, v.lng) === id)
  if (existing) {
    existing.savedAt = savedAt
    if (city && !existing.city) existing.city = city
    if (address && !existing.address) existing.address = address
  } else {
    visited.value = [...visited.value, { id, lat: Number(lat), lng: Number(lng), city, address, savedAt }]
  }
  persist()
  return visited.value
}

export function removeVisited(lat, lng) {
  const id = makeId(lat, lng)
  const next = visited.value.filter((v) => makeId(v.lat, v.lng) !== id)
  if (next.length !== visited.value.length) {
    visited.value = next
    persist()
    return true
  }
  return false
}

export function visitedCount() {
  return visited.value.length
}
