<script setup>
// Star icon as inline SVG rather than the ☆/★ text glyphs.
//
// Those codepoints (U+2606 / U+2605) get claimed by the system EMOJI font on
// many devices, and color-emoji fonts paint their own fixed colors — CSS
// `color` is ignored. On this light theme the emoji ☆ rendered as a white
// outline on white glass, i.e. invisible. An SVG path inherits currentColor,
// so text-* classes actually work and it looks identical on every platform.
defineProps({
  // Filled (favorited) vs outline (not favorited).
  filled: { type: Boolean, default: false },
})
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    :stroke-width="filled ? 1 : 2"
    stroke-linejoin="round"
  >
    <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.57 1.11 6.46L12 17.4l-5.8 3.06 1.1-6.46-4.69-4.57 6.49-.95L12 2.6z" />
  </svg>
</template>
