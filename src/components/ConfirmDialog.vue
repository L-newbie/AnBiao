<script setup>
// Shared "are you sure?" dialog. Deliberately stateless: the caller owns the
// async work and drives `busy`, so the dialog stays usable for anything that
// needs a confirmation (deleting an entry or a comment, flipping visibility).
//
// z-[1400] sits above every other layer — UploadModal 1100, MapModal 1200,
// DetailView's lightbox 1300 — because a confirm can be raised from inside the
// detail view while any of those are on screen.
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  // Optional second line explaining the consequence.
  body: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  cancelLabel: { type: String, default: '取消' },
  // Destructive actions get a genuinely red confirm button, matching the rose
  // palette DeleteButton already uses. Note the theme's `rose-glow`/`rose-soft`
  // tokens are aliases onto the teal/blue accents (see style.css), so those
  // would NOT read as dangerous — this uses Tailwind's built-in rose scale.
  destructive: { type: Boolean, default: false },
  // While the caller's write is in flight: both buttons lock and the confirm
  // label is replaced, so a double-tap can't fire the action twice.
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'confirm'])

// Escape / backdrop / cancel all funnel through here so the busy guard is in
// one place — dismissing mid-write would strand the caller's in-flight request
// with no way to report its error.
function close() {
  if (props.busy) return
  emit('update:open', false)
}

// Escape is handled on the document rather than a focusable wrapper: the dialog
// can be opened from a row deep inside a scrolling list, and relying on the
// backdrop holding DOM focus proved fragile (a click on the row keeps focus on
// the trigger button).
function onKey(e) {
  if (e.key === 'Escape') close()
}
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
// A row unmounting while its dialog is open (the delete case: the entry
// disappears from the list) would otherwise leave the listener attached.
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[1400] flex items-center justify-center p-4">
      <!-- backdrop -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm fade-in" @click="close"></div>

      <!-- dialog -->
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        class="relative w-full max-w-xs glass-strong rounded-3xl p-5 space-y-4 modal-pop shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
      >
        <div class="space-y-1.5 text-center">
          <h3 id="confirm-dialog-title" class="font-serif text-lg text-mist-text">{{ title }}</h3>
          <p v-if="body" class="text-xs text-mist-muted leading-relaxed">{{ body }}</p>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            @click="close"
            :disabled="busy"
            class="rounded-2xl glass px-4 py-2.5 text-sm text-mist-muted hover:text-mist-text hover:brightness-110 disabled:opacity-50"
          >
            {{ cancelLabel }}
          </button>
          <button
            @click="emit('confirm')"
            :disabled="busy"
            class="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-50"
            :class="destructive
              ? 'bg-rose-600 hover:bg-rose-700'
              : 'bg-gradient-to-r from-accent to-accent-2'"
          >
            {{ busy ? '处理中…' : confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
