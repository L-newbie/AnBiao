// Consistent「close / back」button across overlays, sheets, and dialogs.
//
// Designs in use around the app had drifted (w-8/w-9/w-10/w-11, some bare text,
// some glass, some solid, placement inconsistent with safe-area). This is the
// one place to lock it: a high-contrast round FAB look, always right/top, that
// works equally on light glass (map chrome) and dark layers (lightbox).
//
// Variants: light (pages / sheets), on-image (over photos), dark (over dark panels).

<script setup>
const props = defineProps({
  // 'light'  — default: glass-strong + mist-text; for feed/mine/upload sheets.
  // 'on-image' — white/15 bg + white text + backdrop ring; for photos/lightbox.
  // 'dark'   — brighter on dark surfaces (same as on-image but stronger ring).
  variant: { type: String, default: 'light' },
  ariaLabel: { type: String, default: '关闭' },
})
const emit = defineEmits(['close'])
</script>

<template>
  <button
    @click.stop="emit('close')"
    :aria-label="ariaLabel"
    :class="[
      'flex items-center justify-center rounded-full transition active:scale-90 shrink-0',
      'w-11 h-11 text-xl leading-none',
      variant === 'light' && 'glass-strong text-mist-muted hover:text-mist-text shadow-md ring-1 ring-white/60',
      variant === 'on-image' && 'bg-black/40 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-sm',
      variant === 'dark' && 'bg-white/10 text-white/95 shadow-lg ring-1 ring-white/25 backdrop-blur-sm',
    ]"
  ><span style="margin-top:-2px">✕</span></button>
</template>
