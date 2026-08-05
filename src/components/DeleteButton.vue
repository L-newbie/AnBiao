<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { deleteEntry } from '../lib/github.js'

const props = defineProps({
  entryId: { type: String, required: true },
})
// `deleted` fires only after the write actually lands — the caller adds the
// tombstone, so emitting on failure would hide an entry that's still live.
const emit = defineEmits(['deleted', 'error'])

// idle -> confirm -> busy. There's no confirm dialog anywhere else in the app,
// so the second click IS the confirmation; it reverts on its own so a stray tap
// can't leave the button armed.
const state = ref('idle')
const CONFIRM_MS = 3000
let timer = null

function disarm() {
  clearTimeout(timer)
  timer = null
  state.value = 'idle'
}
onBeforeUnmount(() => clearTimeout(timer))

async function onClick() {
  if (state.value === 'busy') return
  if (state.value === 'idle') {
    state.value = 'confirm'
    timer = setTimeout(disarm, CONFIRM_MS)
    return
  }
  clearTimeout(timer)
  timer = null
  state.value = 'busy'
  try {
    await deleteEntry(props.entryId)
    emit('deleted', props.entryId)
    // No disarm() — the entry disappears from the list, unmounting us.
  } catch (e) {
    state.value = 'idle'
    emit('error', e.message)
  }
}

const label = computed(() =>
  state.value === 'confirm' ? '确认删除？点击确认' : state.value === 'busy' ? '删除中' : '删除',
)
</script>

<template>
  <button
    @click.stop="onClick"
    :disabled="state === 'busy'"
    :aria-label="label"
    :title="label"
    class="shrink-0 flex items-center justify-center transition active:scale-90 rounded-full ring-1 disabled:opacity-50"
    :class="state === 'confirm'
      ? 'px-3 h-8 bg-rose-600/15 ring-rose-600/40 text-rose-700 hover:bg-rose-600/25'
      : 'w-8 h-8 bg-rose-500/10 ring-rose-500/25 hover:bg-rose-500/20'"
  >
    <span v-if="state === 'confirm'" class="text-[11px] whitespace-nowrap leading-none">确认删除？</span>
    <span v-else-if="state === 'busy'" class="text-[11px] text-mist-muted leading-none">…</span>
    <span v-else class="text-sm leading-none opacity-75">🗑</span>
  </button>
</template>
