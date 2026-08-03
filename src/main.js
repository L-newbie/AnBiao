import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { setupPwa } from './lib/usePwaUpdate.js'

createApp(App).mount('#app')

// Register the PWA service worker + iOS-safe foreground update re-check.
setupPwa()

// ---- Mobile zoom lockdown ----
// viewport `user-scalable=no` + touch-action: manipulation cover most cases,
// but iOS Safari still allows pinch-zoom via gesture events and ignores the
// meta on some versions. Block the residual paths: multi-touch move/gesture
// events and the classic double-tap-to-zoom. Inputs/textareas are exempt so
// typing and selection stay usable. Keep handlers passive where harmless, but
// pinch-zoom must call preventDefault() so those listeners are non-passive.
function disableZoom() {
  // Pinch (>=2 fingers moving) and the iOS-specific gesture events.
  document.addEventListener(
    'gesturestart',
    (e) => e.preventDefault(),
    { passive: false },
  )
  document.addEventListener(
    'gesturechange',
    (e) => e.preventDefault(),
    { passive: false },
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault()
    },
    { passive: false },
  )
  // Double-tap zoom: swallow the second tap within ~300ms of the first when it
  // lands on a non-interactive element.
  let lastTap = 0
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp
      if (now - lastTap <= 300) {
        const t = e.target
        const interactive =
          t && (t.closest('input, textarea, select, button, a, [role="button"]'))
        if (!interactive) e.preventDefault()
      }
      lastTap = now
    },
    { passive: false },
  )
  // Guard against programmatic viewport scaling via Ctrl/+ wheel on desktop-ish
  // touchscreens; harmless elsewhere.
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
        e.preventDefault()
      }
    },
    { passive: false },
  )
}

disableZoom()
