<script setup>
defineEmits(['click'])
</script>

<template>
  <button
    @click="$emit('click')"
    aria-label="新建记录"
    class="fab-pulse fixed right-4 bottom-24 z-50 w-16 h-16 rounded-full glass-strong flex items-center justify-center text-3xl text-rose-glow hover:brightness-110 hover:text-white"
  >
    ＋
  </button>
</template>
