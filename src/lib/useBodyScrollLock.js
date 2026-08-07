// Lock body scroll while a modal/overlay is open.
//
// The page background kept scrolling under modals on mobile (wheel/touch), so
// every overlay calls this with its open state. Refcounted and self-cleaning:
// two concurrent overlays (UploadSheet → MapModal) only unlock when BOTH have
// closed or unmounted, and a destroyed caller never leaves the lock stuck.

import { onBeforeUnmount, onScopeDispose, unref, watch } from 'vue'

let openCount = 0

function apply() {
  document.body.style.overflow = openCount > 0 ? 'hidden' : ''
}

// Accepts a ref or getter. Watch by identity: each call owns one count that
// it holds from "source became true" until "source becomes false / unmount".
export function useBodyScrollLock(source) {
  const get = typeof source === 'function' ? source : () => Boolean(unref(source))
  let held = false

  function acquire() {
    if (held) return
    held = true
    openCount++
    apply()
  }
  function release() {
    if (!held) return
    held = false
    openCount = Math.max(0, openCount - 1)
    apply()
  }

  watch(
    get,
    (open) => {
      if (open) acquire()
      else release()
    },
    { immediate: true },
  )

  const cleanup = () => release()
  onBeforeUnmount(cleanup)
  onScopeDispose(cleanup) // covers testing/manual scopes without a component
  return () => held
}
