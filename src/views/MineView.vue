<script setup>
import { computed } from 'vue'
import Avatar from '../components/Avatar.vue'
import { config } from '../lib/config.js'
import { getDeviceId, getPoeticName, maskedDeviceCode, uploadsToday, remainingToday } from '../lib/device.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
})
const emit = defineEmits(['open'])

const id = getDeviceId()
const poeticName = getPoeticName(id)
const code = maskedDeviceCode(id)

const mine = computed(() => props.entries.filter((e) => e.deviceId === id))
const remaining = remainingToday(config.maxUploadsPerDay)
const used = uploadsToday()

// Pending (_local) entries carry an absolute data-branch raw URL (their image
// isn't in dist/images until a deploy); aggregated entries carry a relative
// path. Use absolute URLs verbatim, prefix relative ones with BASE_URL —
// matches EntryCard/DetailView.
function imgSrc(e) {
  const img = e.image
  if (!img) return ''
  return /^(https?:)?\/\//.test(img) ? img : import.meta.env.BASE_URL + img
}
</script>

<template>
  <div class="space-y-5 pt-6">
    <!-- identity card -->
    <section class="glass rounded-3xl p-6 flex flex-col items-center text-center gap-3">
      <Avatar :device-id="id" :size="84" />
      <h2 class="font-serif text-2xl text-mist-text">{{ poeticName }}</h2>
      <p class="font-mono text-xs text-mist-muted/70 tracking-widest">{{ code }}</p>
    </section>

    <!-- stats -->
    <section class="grid grid-cols-3 gap-3">
      <div class="glass rounded-2xl p-4 text-center">
        <p class="font-serif text-2xl text-mist-text">{{ mine.length }}</p>
        <p class="text-xs text-mist-muted mt-1">我的记录</p>
      </div>
      <div class="glass rounded-2xl p-4 text-center">
        <p class="font-serif text-2xl text-mist-text">{{ used }}</p>
        <p class="text-xs text-mist-muted mt-1">今日已传</p>
      </div>
      <div class="glass rounded-2xl p-4 text-center">
        <p class="font-serif text-2xl text-rose-glow">{{ remaining }}</p>
        <p class="text-xs text-mist-muted mt-1">今日剩余</p>
      </div>
    </section>

    <!-- my entries -->
    <section v-if="mine.length" class="space-y-2">
      <h3 class="font-serif text-lg text-mist-text">我的记录</h3>
      <div class="space-y-2">
        <button
          v-for="e in mine"
          :key="e.id"
          @click="emit('open', e)"
          class="glass w-full rounded-2xl p-3 flex items-center gap-3 text-left hover:brightness-110"
        >
          <img :src="imgSrc(e)" class="h-12 w-12 rounded-xl object-cover bg-mist-800/40 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-mist-text line-clamp-1">{{ e.city || e.address || '（无地址）' }}</p>
            <p class="text-xs text-mist-muted line-clamp-1">{{ e.description }}</p>
          </div>
          <span class="text-mist-muted/60 text-sm shrink-0">›</span>
        </button>
      </div>
    </section>
  </div>
</template>
