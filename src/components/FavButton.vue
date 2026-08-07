<script setup>
import { computed } from 'vue'
import { favorites, isFavorite, toggleFavorite } from '../lib/favorites.js'
import StarIcon from './StarIcon.vue'

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
    :aria-label="on ? '取消收藏' : '收藏'"
    :title="on ? '取消收藏' : '收藏'"
    :class="[
      'shrink-0 flex items-center justify-center transition active:scale-90',
      // 'card' floats over the photo, so a dark scrim gives it contrast.
      // 'detail' sits inside a glass card — plain glass on glass would be
      // white-on-white, so it gets a tinted fill + ring instead.
      variant === 'card'
        ? 'absolute top-2 right-2 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm hover:bg-black/45'
        : on
          ? 'w-10 h-10 rounded-full bg-amber-400/25 ring-1 ring-amber-500/55 hover:bg-amber-400/35'
          : 'w-10 h-10 rounded-full bg-accent/15 ring-1 ring-accent/45 hover:bg-accent/25',
    ]"
  >
    <StarIcon
      :filled="on"
      class="transition-transform"
      :class="[
        variant === 'card' ? 'w-4 h-4' : 'w-5 h-5',
        variant === 'card'
          ? on
            ? 'text-amber-300 scale-110'
            : 'text-white/90'
          : on
            ? 'text-amber-500 scale-110'
            : 'text-accent',
      ]"
    />
  </button>
</template>
