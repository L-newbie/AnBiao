<script setup>
import { computed, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import { config } from '../lib/config.js'
import { getDeviceId, getPoeticName, maskedDeviceCode, uploadsToday, remainingToday } from '../lib/device.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
})

const id = getDeviceId()
const poeticName = getPoeticName(id)
const code = maskedDeviceCode(id)

const mine = computed(() => props.entries.filter((e) => e.deviceId === id))
const remaining = remainingToday(config.maxUploadsPerDay)
const used = uploadsToday()

// Currently-open entry detail (null = closed).
const active = ref(null)

function imgSrc(e) {
  return e.image ? import.meta.env.BASE_URL + e.image : ''
}

function openDetail(e) {
  active.value = e
}
function closeDetail() {
  active.value = null
}
function onKey(e) {
  if (e.key === 'Escape') closeDetail()
}

const locText = (e) => {
  const parts = []
  if (e.city) parts.push(e.city)
  if (e.address && e.address !== e.city) parts.push(e.address)
  return parts.join(' · ') || '（无地址）'
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
      <h3 class="font-serif text-lg text-mist-text">我留下的暮色</h3>
      <div class="space-y-2">
        <button
          v-for="e in mine"
          :key="e.id"
          @click="openDetail(e)"
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

    <!-- detail modal -->
    <Teleport to="body">
      <div
        v-if="active"
        class="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4"
        @keydown="onKey"
        tabindex="0"
      >
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm fade-in" @click="closeDetail"></div>
        <section class="relative w-full sm:max-w-lg glass-strong rounded-t-3xl sm:rounded-3xl overflow-hidden modal-pop">
          <img v-if="active.image" :src="imgSrc(active)" class="w-full h-56 sm:h-72 object-cover bg-mist-800/40" />
          <div class="p-5 space-y-3">
            <div class="flex items-start justify-between gap-3">
              <h2 class="font-serif text-xl text-mist-text leading-snug">{{ locText(active) }}</h2>
              <button
                @click="closeDetail"
                class="rounded-full w-8 h-8 flex items-center justify-center glass text-mist-muted hover:text-mist-text shrink-0"
              >
                ✕
              </button>
            </div>
            <p class="text-sm text-mist-muted leading-relaxed whitespace-pre-wrap">{{ active.description }}</p>
            <p class="text-xs text-mist-muted/70">
              {{ new Date(active.createdAt).toLocaleString() }}
              · {{ active.lat.toFixed(4) }}, {{ active.lng.toFixed(4) }}
            </p>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
