<script setup>
import { computed } from 'vue'
import { getPoeticName, getAvatar } from '../lib/device.js'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const imgSrc = computed(() => (props.entry.image ? import.meta.env.BASE_URL + props.entry.image : ''))

const authorName = computed(() => getPoeticName(props.entry.deviceId || ''))
const avatar = computed(() => getAvatar(props.entry.deviceId || ''))

const locText = computed(() => {
  const parts = []
  if (props.entry.city) parts.push(props.entry.city)
  if (props.entry.address && props.entry.address !== props.entry.city)
    parts.push(props.entry.address)
  return parts.join(' · ') || '（无地址）'
})

const timeText = computed(() => {
  if (!props.entry.createdAt) return ''
  try {
    return new Date(props.entry.createdAt).toLocaleString()
  } catch {
    return props.entry.createdAt
  }
})

// Navigation deeplinks/URLs for various map apps. Clicking opens the native app
// on mobile (via the scheme) or falls back to a web map on desktop.
const lat = computed(() => Number(props.entry.lat))
const lng = computed(() => Number(props.entry.lng))
const coord = computed(() => `${lat.value},${lng.value}`)

const navs = computed(() => [
  {
    name: '高德地图',
    href: `https://uri.amap.com/navigation?to=${lng.value},${lat.value},${encodeURIComponent(props.entry.address || locText.value)}&mode=car&coordinate=wgs84&callnative=1`,
  },
  {
    name: '百度地图',
    href: `https://api.map.baidu.com/direction?destination=latlng:${lat.value},${lng.value}|name:${encodeURIComponent(props.entry.address || locText.value)}&coord_type=wgs84&output=html&src=AnBiao`,
  },
  {
    name: 'Apple 地图',
    href: `https://maps.apple.com/?ll=${lat.value},${lng.value}&q=${encodeURIComponent(props.entry.address || locText.value)}`,
  },
  {
    name: 'Google Maps',
    href: `https://www.google.com/maps/dir/?api=1&destination=${lat.value},${lng.value}`,
  },
])

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="space-y-5" @keydown="onKey" tabindex="0">
    <!-- back -->
    <button
      @click="emit('close')"
      class="flex items-center gap-1.5 text-sm text-mist-muted hover:text-mist-text transition"
    >
      <span class="text-lg">‹</span> 返回
    </button>

    <!-- hero image -->
    <div v-if="imgSrc" class="rounded-3xl overflow-hidden">
      <img :src="imgSrc" class="w-full h-56 sm:h-72 object-cover bg-mist-800/40" />
    </div>

    <!-- location -->
    <header class="space-y-1">
      <h1 class="font-serif text-2xl text-mist-text leading-snug">{{ locText }}</h1>
      <p class="text-xs text-mist-muted/70 font-mono">
        {{ lat.toFixed(5) }}, {{ lng.toFixed(5) }}
      </p>
    </header>

    <!-- author + time -->
    <div class="glass rounded-2xl p-3 flex items-center gap-3">
      <div
        class="w-10 h-10 rounded-full flex items-center justify-center font-serif text-sm text-white shrink-0"
        :style="{ background: avatar.gradient }"
      >
        {{ avatar.glyph }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-serif text-sm text-mist-text">{{ authorName }}</p>
        <p class="text-xs text-mist-muted">{{ timeText }}</p>
      </div>
      <span
        v-if="entry._local"
        class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
      >等待通过</span>
    </div>

    <!-- full description -->
    <section>
      <h2 class="font-serif text-base text-mist-text mb-2">记录</h2>
      <p class="text-sm text-mist-muted leading-relaxed whitespace-pre-wrap">{{ entry.description }}</p>
    </section>

    <!-- navigation -->
    <section>
      <h2 class="font-serif text-base text-mist-text mb-2">导航到这里</h2>
      <div class="grid grid-cols-2 gap-3">
        <a
          v-for="n in navs"
          :key="n.name"
          :href="n.href"
          target="_blank"
          rel="noopener noreferrer"
          class="glass rounded-2xl px-3 py-3 text-center text-sm text-mist-text hover:brightness-110 hover:text-accent transition"
        >
          {{ n.name }}
        </a>
      </div>
      <p class="mt-2 text-xs text-mist-muted/60 text-center">点击在地图 app 中打开导航（手机会唤起对应 app）</p>
    </section>
  </div>
</template>
