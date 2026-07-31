<script setup>
import { computed, ref } from 'vue'
import { config } from '../lib/config.js'
import { hasReported, markReported, getDeviceId } from '../lib/device.js'
import { reportEntry } from '../lib/github.js'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['reported'])

const busy = ref(false)
const err = ref('')
const alreadyReported = computed(() => hasReported(props.entry.id))

async function report() {
  err.value = ''
  if (alreadyReported.value) return
  busy.value = true
  try {
    const updated = await reportEntry(props.entry.id, {
      deviceId: getDeviceId(),
      at: new Date().toISOString(),
    })
    markReported(props.entry.id)
    emit('reported', updated)
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}

const imgSrc = computed(() => import.meta.env.BASE_URL + props.entry.image)
const reportCount = computed(() => (props.entry.reports || []).length)
const nearLimit = computed(() => reportCount.value >= config.reportThreshold - 1)
const locText = computed(() => {
  const parts = []
  if (props.entry.city) parts.push(props.entry.city)
  if (props.entry.address && props.entry.address !== props.entry.city)
    parts.push(props.entry.address)
  return parts.join(' · ') || '（无地址）'
})
</script>

<template>
  <article class="glass rounded-2xl overflow-hidden flex flex-col transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
    <div class="relative">
      <img :src="imgSrc" loading="lazy" class="h-40 w-full object-cover bg-mist-800/40" />
      <span
        v-if="entry._local"
        class="absolute top-2 left-2 rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5"
      >
        待公开
      </span>
    </div>
    <div class="p-3 space-y-1.5 flex-1">
      <p class="font-serif text-sm text-mist-text line-clamp-1">{{ locText }}</p>
      <p class="text-xs text-mist-muted line-clamp-3 leading-relaxed">{{ entry.description }}</p>
    </div>
    <div class="px-3 pb-3">
      <button
        v-if="entry._local"
        disabled
        class="w-full rounded-xl glass px-3 py-1.5 text-[11px] text-amber-300/80"
      >
        本条刚上传，等待部署后正式公开
      </button>
      <button
        v-else-if="alreadyReported"
        disabled
        class="w-full rounded-xl glass px-3 py-1.5 text-[11px] text-mist-muted/60"
      >
        已举报（{{ reportCount }}）
      </button>
      <button
        v-else
        @click="report"
        :disabled="busy"
        :class="nearLimit ? 'text-rose-glow' : 'text-mist-muted/70'"
        class="w-full rounded-xl glass px-3 py-1.5 text-[11px] transition hover:text-rose-glow disabled:opacity-50"
      >
        {{ busy ? '举报中…' : nearLimit ? `举报（${reportCount}/${config.reportThreshold}，接近隐藏）` : `举报（${reportCount}/${config.reportThreshold}）` }}
      </button>
      <p v-if="err" class="mt-1 text-[11px] text-rose-glow">{{ err }}</p>
    </div>
  </article>
</template>
