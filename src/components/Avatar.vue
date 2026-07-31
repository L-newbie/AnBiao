<script setup>
import { getAvatar } from '../lib/device.js'

const props = defineProps({
  deviceId: { type: String, required: true },
  size: { type: Number, default: 72 },
})

const av = getAvatar(props.deviceId)
</script>

<template>
  <div
    class="flex items-center justify-center font-serif text-white shadow-lg shadow-black/20 select-none"
    :style="{ width: size + 'px', height: size + 'px', background: av.gradient, fontSize: size * 0.42 + 'px' }"
  >
    {{ av.glyph }}
  </div>
</template>
