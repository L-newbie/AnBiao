// Minimal toast service — the app previously had NO transient feedback
// mechanism (all errors were inline text under forms, easy to miss), and both
// the share button (链接已复制) and location failures (定位失败) need one.
//
// One reactive array, one component (src/components/Toast.vue). pushToast is
// safe to call from anywhere — components, libs, event handlers.

import { reactive } from 'vue'

export const toasts = reactive([])

let seq = 0

export function pushToast(message, { type = 'info', duration = 1800 } = {}) {
  const id = ++seq
  toasts.push({ id, message: String(message), type })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i !== -1) toasts.splice(i, 1)
  }, duration)
  return id
}
