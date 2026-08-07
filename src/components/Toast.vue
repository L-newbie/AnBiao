<script setup>
import { toasts } from '../lib/toast.js'
</script>

<template>
  <div class="fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-1.5 px-4 pointer-events-none" aria-live="polite">
    <TransitionGroup name="view-fade">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="glass-strong rounded-full px-4 py-2 text-sm shadow-lg max-w-xs truncate"
        :class="t.type === 'error' ? 'text-rose-glow' : t.type === 'success' ? 'text-emerald-300' : 'text-mist-text'"
      >
        {{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>
