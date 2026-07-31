// Pull-to-refresh composable.
//
// Works on the window scroll (mobile touch drag from top + desktop wheel
// pulling up past the top). Exposes a `pull` ref (px the indicator should show)
// and a `refreshing` flag. Call `bind()` on mount and `unbind()` on unmount.
//
// Touch: track a startY; while scrollTop===0 and moving down, dy>0 translates
// to pull (dampened so it feels rubbery). Release fires onRefresh if past the
// threshold, else snaps back.
// Wheel: when at scrollTop===0 and deltaY<0 (scrolling up to pull), accumulate
// pull; a brief idle snaps or fires.

import { onBeforeUnmount, onMounted, ref } from 'vue'

const PULL_THRESHOLD = 64
const MAX_PULL = 120
const WHEEL_DECAY_MS = 180

export function usePullRefresh(onRefresh) {
  const pull = ref(0)
  const refreshing = ref(false)
  const ready = ref(false) // pulled past threshold

  let startY = null
  let tracking = false
  let wheelTimer = null

  function dampen(dy) {
    // Rubber-band: diminish returns as it grows.
    const ratio = pull.value / MAX_PULL
    const factor = Math.max(0.25, 1 - ratio * 0.7)
    return Math.min(MAX_PULL - pull.value, dy * factor)
  }

  function atTop() {
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0
  }

  function setPull(v) {
    pull.value = Math.max(0, Math.min(v, MAX_PULL))
    ready.value = pull.value >= PULL_THRESHOLD
  }

  function onTouchStart(e) {
    if (!atTop()) return
    startY = e.touches[0].clientY
    tracking = true
  }

  function onTouchMove(e) {
    if (!tracking || startY == null) return
    const dy = e.touches[0].clientY - startY
    if (dy <= 0) {
      setPull(0)
      return
    }
    // Only prevent default when it's actually a pull from the top AND the
    // event permits it (cancelable). Guard prevents the browser's
    // "Intervention: ignored attempt to cancel a non-cancelable touchmove"
    // warning during inertial scrolling.
    if (atTop() && pull.value >= 0 && e.cancelable) e.preventDefault()
    setPull(pull.value + dampen(dy - pull.value))
  }

  function onTouchEnd() {
    if (!tracking) return
    tracking = false
    startY = null
    if (ready.value && !refreshing.value) {
      fire()
    } else {
      snap()
    }
  }

  function onWheel(e) {
    if (refreshing.value) return
    if (!atTop()) return
    if (e.deltaY >= 0) return // scrolling down / resting
    // Pulling up at the top.
    e.preventDefault()
    setPull(pull.value + Math.min(28, -e.deltaY * 0.6))
    clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => {
      if (ready.value) fire()
      else snap()
    }, WHEEL_DECAY_MS)
  }

  function snap() {
    pull.value = 0
    ready.value = false
  }

  async function fire() {
    if (refreshing.value) return
    pull.value = PULL_THRESHOLD
    refreshing.value = true
    try {
      await onRefresh()
    } finally {
      refreshing.value = false
      snap()
    }
  }

  // Public entry for the auto-refresh path (no gesture): run onRefresh and
  // drive the same refreshing flag.
  async function manual() {
    return fire()
  }

  onMounted(() => {
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: false })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('wheel', onWheel)
    clearTimeout(wheelTimer)
  })

  return { pull, refreshing, ready, fire, manual, snap }
}
