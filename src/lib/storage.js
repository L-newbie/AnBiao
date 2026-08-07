// Shared helpers for the localStorage-backed gc_* stores.
//
// Reads stay silent-fail (corrupt JSON → empty default is the correct UX). But
// WRITES were silently swallowed in six different libs — when quota is exceeded
// the user lost optimistic state with no signal. Now every failed write
// dispatches 'gc-storage-full'; App.vue listens once and shows a toast.

export function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v ?? fallback
  } catch {
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    try {
      window.dispatchEvent(new CustomEvent('gc-storage-full', { detail: { key } }))
    } catch {
      /* window unavailable (SSR/test) — nothing more we can do */
    }
    return false
  }
}
