<script setup>
import { computed, ref } from 'vue'
import { deleteEntry, deleteComment } from '../lib/github.js'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({
  entryId: { type: String, required: true },
  // When set, this button deletes that ONE comment on the entry rather than
  // the entry itself. The confirm flow is identical either way, so both modes
  // share this component instead of forking a near-copy.
  commentId: { type: String, default: '' },
  // 'entry' is the row button in 我的·记录; 'comment' is the smaller, quieter
  // one that sits in a comment card's header line.
  variant: { type: String, default: 'entry' },
})
// `deleted` fires only after the write actually lands — the caller adds the
// tombstone, so emitting on failure would hide something that's still live.
// The payload is the id of whatever was deleted (entry or comment).
const emit = defineEmits(['deleted', 'error'])

// Confirmation is a modal (ConfirmDialog) rather than the arm-then-tap-again
// button this used to be: a second tap on the same spot was easy to trigger by
// accident and gave no room to say what was about to be deleted.
const confirmOpen = ref(false)
const busy = ref(false)

const isComment = computed(() => Boolean(props.commentId))
const noun = computed(() => (isComment.value ? '留言' : '记录'))

async function onConfirm() {
  if (busy.value) return
  busy.value = true
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
    // Deliberately no busy/confirmOpen reset here: the row vanishes from the
    // list, unmounting us. Writing to the refs after that logs a Vue warning.
  } catch (e) {
    busy.value = false
    confirmOpen.value = false
    emit('error', e.message)
  }
}
</script>

<template>
  <button
    @click.stop="confirmOpen = true"
    :aria-label="`删除${noun}`"
    :title="`删除${noun}`"
    class="shrink-0 flex items-center justify-center transition active:scale-90 rounded-full ring-1 bg-rose-500/10 ring-rose-500/25 hover:bg-rose-500/20"
    :class="variant === 'comment' ? 'w-6 h-6' : 'w-8 h-8'"
  >
    <span
      class="leading-none opacity-75"
      :class="variant === 'comment' ? 'text-[11px]' : 'text-sm'"
    >🗑</span>
  </button>

  <ConfirmDialog
    v-model:open="confirmOpen"
    :title="`删除${noun}？`"
    :body="isComment ? '删除后这条留言将不再显示，且无法恢复。' : '删除后这条记录将不再显示，且无法恢复。'"
    confirm-label="删除"
    destructive
    :busy="busy"
    @confirm="onConfirm"
  />
</template>
