// Lock the page's document scroll while an overlay is up.
//
// Needed because modals/sheets inside the map-first app leave the background
// scrolling behind them on mobile (wheel/touch), and the user can't reach the
// content they meant to scroll.
//
// Refcounted and self-cleaning: multiple concurrent overlays only unlock
// when ALL have closed or unmounted — UploadSheet opening MapModal is safe.
// A destroyed caller never leaves the lock stuck either.
//
// API:
//   useBodyScrollLock(() => someRefOrGetter)   // true = locked, false = free

import { onBeforeUnmount, onScopeDispose, unref, watch } from 'vue'

let lockCount = 0

function apply() {
  document.body.style.overflow = lockCount > 0 ? 'hidden' : ''
}

// Accepts a ref (or any getter). The source is polled until it settles —
// truthiness at watch time decides whether THIS call site is participating.
// IMPORTANT: passing `.value` directly would capture a snapshot, so always
// pass a getter or the ref itself.
export function useBodyScrollLock(source) {
  const get = typeof source === 'function' ? source : () => Boolean(unref(source))
  let held = false

  function acquire() {
    if (held) return
    held = true
    lockCount++
    apply()
  }
  function release() {
    if (!held) return
    held = false
    lockCount = Math.max(0, lockCount - 1)
    apply()
  }

  // `flush: 'sync'` so the lock ALWAYS lands before the overlay paints —
  // without it the user can jiggle the background for one frame.
  const stop = watch(
    get,
    (open) => {
      if (open) acquire()
      else release()
    },
    { immediate: true, flush: 'sync' },
  )

  const cleanup = () => {
    stop()
    release()
  }
  onBeforeUnmount(cleanup)
  onScopeDispose(cleanup) // covers manual effect scopes (tests)
  return () => held
}
