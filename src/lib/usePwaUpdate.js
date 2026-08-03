// PWA service-worker registration + iOS-safe foreground update re-check.
//
// `registerType: 'autoUpdate'` (set in vite.config.js) makes the new SW
// skipWaiting + clients.claim, but iOS home-screen apps cache the HTML shell
// independently and don't always re-fetch sw.js on launch. So on top of the
// auto-update we force a re-check every time the PWA returns to the
// foreground (visibilitychange) or is restored from the back/forward cache
// (pageshow with persisted=true). This defeats both GitHub Pages' short
// Cache-Control on sw.js and the iOS 24h SW-update cap.
import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const needRefresh = ref(false)
const offlineReady = ref(false)
let updateSW = null

export function setupPwa() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  updateSW = registerSW({
    onNeedRefresh() {
      needRefresh.value = true
    },
    onOfflineReady() {
      offlineReady.value = true
    },
  })

  // Re-check for an update whenever the app returns to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && updateSW) updateSW(true)
  })
  // Some iOS versions surface reactivation via pageshow (bfcache) instead.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && updateSW) updateSW(true)
  })
}

// Apply the pending update: triggers the registered SW's reload flow.
export function applyUpdate() {
  needRefresh.value = false
  updateSW?.(true)
}

export function dismissOffline() {
  offlineReady.value = false
}

export { needRefresh, offlineReady }
