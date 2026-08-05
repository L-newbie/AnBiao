<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { deleteEntry, deleteComment } from '../lib/github.js'

const props = defineProps({
  entryId: { type: String, required: true },
  // When set, this button deletes that ONE comment on the entry rather than
  // the entry itself. The confirm state machine is identical either way, so
  // both modes share this component instead of forking a near-copy.
  commentId: { type: String, default: '' },
  // 'entry' is the row button in 我的·记录; 'comment' is the smaller, quieter
  // one that sits in a comment card's header line.
  variant: { type: String, default: 'entry' },
})
// `deleted` fires only after the write actually lands — the caller adds the
// tombstone, so emitting on failure would hide something that's still live.
// The payload is the id of whatever was deleted (entry or comment).
const emit = defineEmits(['deleted', 'error'])

// idle -> confirm -> busy. There's no confirm dialog anywhere else in the app,
// so the second click IS the confirmation; it reverts on its own so a stray tap
// can't leave the button armed.
const state = ref('idle')
const CONFIRM_MS = 3000
let timer = null

const isComment = computed(() => Boolean(props.commentId))

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
    if (isComment.value) {
      // Resolves (rather than throwing) when the comment isn't on the branch —
      // the end state is what we wanted, and the caller still needs to clear
      // its local copy, so that counts as success.
      await deleteComment(props.entryId, props.commentId)
      emit('deleted', props.commentId)
    } else {
      await deleteEntry(props.entryId)
      emit('deleted', props.entryId)
    }
    // No disarm() — the row disappears from the list, unmounting us.
  } catch (e) {
    state.value = 'idle'
    emit('error', e.message)
  }
}

const noun = computed(() => (isComment.value ? '留言' : ''))
const label = computed(() =>
  state.value === 'confirm'
    ? `确认删除${noun.value}？点击确认`
    : state.value === 'busy'
      ? '删除中'
      : `删除${noun.value}`,
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
      ? (variant === 'comment'
          ? 'px-2 h-6 bg-rose-600/15 ring-rose-600/40 text-rose-700 hover:bg-rose-600/25'
          : 'px-3 h-8 bg-rose-600/15 ring-rose-600/40 text-rose-700 hover:bg-rose-600/25')
      : (variant === 'comment'
          ? 'w-6 h-6 bg-rose-500/10 ring-rose-500/25 hover:bg-rose-500/20'
          : 'w-8 h-8 bg-rose-500/10 ring-rose-500/25 hover:bg-rose-500/20')"
  >
    <span
      v-if="state === 'confirm'"
      class="whitespace-nowrap leading-none"
      :class="variant === 'comment' ? 'text-[10px]' : 'text-[11px]'"
    >确认删除？</span>
    <span
      v-else-if="state === 'busy'"
      class="text-mist-muted leading-none"
      :class="variant === 'comment' ? 'text-[10px]' : 'text-[11px]'"
    >…</span>
    <span
      v-else
      class="leading-none opacity-75"
      :class="variant === 'comment' ? 'text-[11px]' : 'text-sm'"
    >🗑</span>
  </button>
</template>
