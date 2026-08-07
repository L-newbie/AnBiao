<script setup>
// Global "N 条待同步" indicator — sits just above the tab bar whenever the
// offline outbox holds queued/failed writes. Tapping jumps to the Mine tab's
// 同步队列 section where failed ops can be retried or discarded.
import { computed } from 'vue'
import { outboxCount, outboxFailedCount } from '../lib/outbox.js'

const emit = defineEmits(['open-queue'])

const failed = computed(() => outboxFailedCount.value > 0)
const label = computed(() =>
  failed.value ? `${outboxCount.value} 条待同步 · ${outboxFailedCount.value} 条失败` : `${outboxCount.value} 条待同步`,
)
</script>

<template>
  <Transition name="view-fade">
    <button
      v-if="outboxCount > 0"
      aria-live="polite"
      @click="emit('open-queue')"
      class="fixed z-[55] right-4 bottom-20 glass-strong rounded-full px-3.5 py-2 text-xs shadow-lg flex items-center gap-1.5 transition active:scale-95"
      :class="failed ? 'text-rose-glow' : 'text-amber-300'"
    >
      <span
        class="inline-block w-1.5 h-1.5 rounded-full"
        :class="failed ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'"
      ></span>
      {{ label }}
    </button>
  </Transition>
</template>
