<script setup>
import { computed } from 'vue'
import { favorites, isFavorite, toggleFavorite } from '../lib/favorites.js'

const props = defineProps({
  entryId: { type: String, required: true },
  // 'card' floats over the feed thumbnail; 'detail' sits inline in the header.
  variant: { type: String, default: 'card' },
})

// Read through the shared reactive store so every instance of this button
// (feed card + open detail view) flips together.
const on = computed(() => {
  void favorites.value
  return isFavorite(props.entryId)
})

function onClick() {
  toggleFavorite(props.entryId)
}
</script>

<template>
  <button
    @click.stop="onClick"
    :aria-pressed="on"
    :title="on ? '取消收藏' : '收藏'"
    :class="[
      'shrink-0 flex items-center justify-center transition active:scale-90',
      variant === 'card'
        ? 'absolute top-2 right-2 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/45'
        : 'w-10 h-10 rounded-full glass hover:brightness-110',
    ]"
  >
    <span
      class="leading-none transition-transform"
      :class="[
        variant === 'card' ? 'text-base' : 'text-lg',
        on ? 'text-amber-300 scale-110' : 'text-white/80',
        variant === 'detail' && !on ? 'text-mist-muted' : '',
      ]"
    >{{ on ? '★' : '☆' }}</span>
  </button>
</template>
