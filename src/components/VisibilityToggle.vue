<script setup>
import { computed, ref } from 'vue'
import { setEntryVisibility, QueuedOfflineError } from '../lib/github.js'
import {
  PRIVATE,
  PUBLIC,
  setVisibilityOverride,
  visibilityOf,
  visibilityOverrides,
} from '../lib/entryVisibility.js'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({
  // The whole entry, not just its id: visibilityOf() resolves the entry's own
  // field as the fallback when no local override exists.
  entry: { type: Object, required: true },
})
// Fires only after the write to the data branch lands, mirroring DeleteButton.
const emit = defineEmits(['toggled', 'error'])

const confirmOpen = ref(false)
const busy = ref(false)

const current = computed(() => {
  // Touch the store so flipping visibility re-renders this button — visibilityOf
  // reads it, but Vue only tracks what's dereferenced during the computed.
  void visibilityOverrides.value
  return visibilityOf(props.entry)
})
const isPublic = computed(() => current.value === PUBLIC)
const target = computed(() => (isPublic.value ? PRIVATE : PUBLIC))
const targetLabel = computed(() => (isPublic.value ? '设为私密' : '设为公开'))

async function onConfirm() {
  if (busy.value) return
  busy.value = true
  // Snapshot the target BEFORE writing: `target` is derived from the override
  // store, so setVisibilityOverride below flips it back the moment it lands.
  // Reading it again after that point would report the old visibility.
  const next = target.value
  try {
    await setEntryVisibility(props.entry.id, next)
    // Only after the write succeeds: an override set on a failed write would
    // show a state the data branch doesn't actually have.
    setVisibilityOverride(props.entry.id, next)
    emit('toggled', props.entry.id, next)
    confirmOpen.value = false
  } catch (e) {
    if (e instanceof QueuedOfflineError) {
      // Queued: the local override already makes it LOOK toggled everywhere;
      // the branch write lands on sync. Same "only show what the branch will
      // end up with" rule holds — the override mirrors the queued payload.
      setVisibilityOverride(props.entry.id, next)
      emit('toggled', props.entry.id, next)
      confirmOpen.value = false
      busy.value = false
      return
    }
    confirmOpen.value = false
    emit('error', e.message)
  } finally {
    // Unlike DeleteButton the row stays mounted, so this is safe.
    busy.value = false
  }
}
</script>

<template>
  <button
    @click.stop="confirmOpen = true"
    :aria-label="targetLabel"
    :aria-pressed="isPublic"
    :title="isPublic ? '当前公开 · 点击设为私密' : '当前私密 · 点击设为公开'"
    class="shrink-0 w-8 h-8 flex items-center justify-center transition active:scale-90 rounded-full ring-1"
    :class="isPublic
      ? 'bg-accent/10 ring-accent/30 hover:bg-accent/20'
      : 'bg-mist-600/40 ring-mist-muted/30 hover:bg-mist-600/60'"
  >
    <span class="text-sm leading-none opacity-80">{{ isPublic ? '🌐' : '🔒' }}</span>
  </button>

  <ConfirmDialog
    v-model:open="confirmOpen"
    :title="`${targetLabel}？`"
    :body="isPublic
      ? '设为私密后，这条记录不再出现在公开记录中，只有你能在「我的·记录」里看到。'
      : '设为公开后，这条记录将出现在公开记录中，所有人都能看到。'"
    :confirm-label="targetLabel"
    :busy="busy"
    @confirm="onConfirm"
  />
</template>
