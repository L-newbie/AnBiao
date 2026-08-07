<script setup>
// Share one entry as a link. Points at the build-time OG card page
// (entries/<id>.html) so link unfurlers (WeChat/QQ/Telegram) render a rich
// card; that page redirects real users into the SPA hash route.
//
// Strategy: navigator.share (mobile, gives the native sheet with the URL) →
// clipboard.copy fallback → prompt-to-copy last resort. Private entries are
// deliberately NOT shareable: the OG page for them isn't even generated, and
// the link would dead-end for everyone but the author.
import { computed } from 'vue'
import { pushToast } from '../lib/toast.js'
import { visibilityOf, visibilityOverrides, PRIVATE } from '../lib/entryVisibility.js'

const props = defineProps({
  entry: { type: Object, required: true },
})

const isPrivate = computed(() => {
  void visibilityOverrides.value
  return visibilityOf(props.entry) === PRIVATE
})

// For pending (_local) entries the OG page won't exist until the next
// aggregation deploy. The hash route DOES work immediately (the entry is in
// the author's own feed), so sharing a pending entry shares the in-app URL —
// useful for "look what I just posted" between the author's own devices.
const shareUrl = computed(() => {
  const base = import.meta.env.BASE_URL || '/'
  const origin = location.origin
  if (props.entry._local) return `${origin}${base}#/entry/${encodeURIComponent(props.entry.id)}`
  return `${origin}${base}entries/${encodeURIComponent(props.entry.id)}.html`
})
const shareText = computed(() => {
  const desc = String(props.entry.description || '').trim()
  return desc ? desc.slice(0, 60) : '比邻云 · 一条记录'
})

async function share() {
  if (isPrivate.value) return
  const payload = { title: '比邻云', text: shareText.value, url: shareUrl.value }
  if (navigator.share) {
    try {
      await navigator.share(payload)
      return
    } catch (e) {
      // AbortError = user dismissed the sheet; not an error path.
      if (e && e.name === 'AbortError') return
    }
  }
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    pushToast('链接已复制', { type: 'success' })
  } catch {
    // Clipboard API unavailable (insecure context / old webview) — last resort.
    window.prompt('复制链接：', shareUrl.value)
  }
}
</script>

<template>
  <button
    @click="share"
    :disabled="isPrivate"
    :aria-label="isPrivate ? '私密记录不可分享' : '分享'"
    :title="isPrivate ? '私密记录不可分享' : '分享这条记录'"
    class="shrink-0 w-8 h-8 flex items-center justify-center rounded-full ring-1 bg-accent/10 ring-accent/30 hover:bg-accent/20 transition active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
  >
    <span class="text-sm leading-none opacity-80">↗</span>
  </button>
</template>
