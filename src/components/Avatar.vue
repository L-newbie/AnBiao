<script setup>
import { getAvatar, getDeviceId } from '../lib/device.js'

const props = defineProps({
  deviceId: { type: String, default: '' },
  size: { type: Number, default: 72 },
})

// No id = the current device (convenient for the "my" avatar in the chrome).
const av = getAvatar(props.deviceId || getDeviceId())
</script>

<template>
  <div
    class="flex items-center justify-center font-serif text-white select-none w-full h-full"
    :style="{ background: av.gradient, fontSize: size * 0.42 + 'px' }"
    :title="av.glyph"
  >
    {{ av.glyph }}
  </div>
</template>
