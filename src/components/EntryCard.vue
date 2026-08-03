<script setup>
import { computed } from 'vue'
import { getPoeticName } from '../lib/device.js'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['open'])

// Pending entries carry an absolute data-branch raw URL (their image isn't in
// dist/images until a deploy); aggregated entries carry a relative path. Use
// absolute URLs verbatim, prefix relative ones with BASE_URL.
const imgSrc = computed(() => {
  const img = props.entry.image
  if (!img) return ''
  return /^(https?:)?\/\//.test(img) ? img : import.meta.env.BASE_URL + img
})
const locText = computed(() => {
  const parts = []
  if (props.entry.city) parts.push(props.entry.city)
  if (props.entry.address && props.entry.address !== props.entry.city)
    parts.push(props.entry.address)
  return parts.join(' · ') || '（无地址）'
})
const authorName = computed(() => getPoeticName(props.entry.deviceId || ''))
const timeText = computed(() => {
  if (!props.entry.createdAt) return ''
  try {
    const d = new Date(props.entry.createdAt)
    // Relative-ish short form: MM-DD HH:mm
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${mi}`
  } catch {
    return props.entry.createdAt
  }
})
</script>

<template>
  <article
    class="glass rounded-2xl overflow-hidden flex flex-col transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)] cursor-pointer"
    @click="emit('open', entry)"
  >
    <div class="relative">
      <img :src="imgSrc" loading="lazy" class="h-40 w-full object-cover bg-mist-800/40" />
      <span
        v-if="entry._local"
        class="absolute top-2 left-2 rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5"
      >
        等待通过
      </span>
    </div>
    <div class="p-3 space-y-1.5 flex-1">
      <p class="font-serif text-sm text-mist-text line-clamp-1">{{ locText }}</p>
      <p class="text-xs text-mist-muted line-clamp-1 leading-relaxed">{{ entry.description }}</p>
    </div>
    <div class="px-3 pb-3 space-y-2">
      <!-- author + time -->
      <div class="flex items-center justify-between gap-2 text-[11px] text-mist-muted/70">
        <span class="truncate font-serif">{{ authorName }}</span>
        <span class="shrink-0 font-mono">{{ timeText }}</span>
      </div>
    </div>
  </article>
</template>
