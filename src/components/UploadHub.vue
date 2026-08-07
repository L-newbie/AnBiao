// The "+" operations hub: one 56px floating action button on the map's
// right edge that radially fans out into the small set of global actions.
//
// Actions (icon-first, label on the left):
//   上传    — opens the upload sheet (UploadSheet)
//   筛选    — toggles the filter chips row in the search bar
//   附近    — toggle explore's nearby-circle mode
//   刷新    — silently refetch the feed/point set
//
// Tap-outside/Escape close; keeps itself out of Tab navigation until open.

<script setup>
import { onBeforeUnmount, ref } from 'vue'

const emit = defineEmits(['upload', 'nearby', 'refresh', 'feed', 'mine'])

const open = ref(false)

// Note: 筛选 lives in the search bar's chevron (and inside the feed page
// itself) — it used to sit here as a sixth item, but with five actions the
// menu reads cleaner and筛选 stays closer to where it applies.
// Note: 附近/locate-me lives on the map itself (top-right 📍 button) — it
// needs the map's direct control, and a menu entry was a second trip for the
// same thing. The hub menu is down to cornerstones: 我的/信息流/上传/刷新.
const items = [
  { key: 'mine', label: '我的', icon: '👤' },
  { key: 'feed', label: '信息流模式', icon: '📃' },
  { key: 'upload', label: '上传', icon: '✏️' },
  { key: 'refresh', label: '刷新', icon: '↻' },
]

function toggle() {
  open.value = !open.value
}

function onPick(key) {
  open.value = false
  emit(key)
}

function onBackdrop() {
  open.value = false
}

function onKey(e) {
  if (e.key === 'Escape') open.value = false
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKey)
}
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="absolute right-4 bottom-6 z-40 flex flex-col items-end gap-2.5" style="bottom: calc(env(safe-area-inset-bottom) + 16px)">
    <!-- radial fan -->
    <TransitionGroup name="hub-item">
      <div
        v-for="(item, i) in items"
        v-show="open"
        :key="item.key"
        class="flex items-center gap-2.5"
        :style="{ transitionDelay: (items.length - i) * 20 + 'ms' }"
      >
        <span class="text-xs text-mist-text glass-strong rounded-full px-2.5 py-1 shadow">{{ item.label }}</span>
        <button
          @click="onPick(item.key)"
          :aria-label="item.label"
          class="w-11 h-11 rounded-full glass-strong shadow-lg flex items-center justify-center text-base transition active:scale-90 hover:brightness-110"
        >{{ item.icon }}</button>
      </div>
    </TransitionGroup>

    <!-- FAB: violet gradient (acc-3) so it stands apart from both the cyan
         primary actions and the map's blue base. Bigger than standard so the
         fingertip lands reliably on one-handed use. -->
    <button
      @click="toggle"
      :aria-expanded="open"
      aria-label="操作菜单"
      class="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white text-3xl font-light shadow-[0_10px_32px_rgba(124,58,237,0.45)] flex items-center justify-center transition active:scale-90 fab-pulse-violet"
    >
      <span :class="open ? 'rotate-45' : ''" class="inline-block transition-transform duration-200">＋</span>
    </button>

    <!-- backdrop -->
    <Teleport to="body">
      <div v-if="open" @click="onBackdrop" class="fixed inset-0 z-[35] bg-transparent"></div>
    </Teleport>
  </div>
</template>

<style>
.hub-item-enter-active,
.hub-item-leave-active {
  transition:
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.18s ease;
}
.hub-item-enter-from {
  transform: translateY(14px) scale(0.6);
  opacity: 0;
}
.hub-item-leave-to {
  transform: translateY(8px) scale(0.8);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .hub-item-enter-active,
  .hub-item-leave-active {
    transition: opacity 0.15s ease;
  }
  .hub-item-enter-from,
  .hub-item-leave-to {
    transform: none;
  }
}
</style>
