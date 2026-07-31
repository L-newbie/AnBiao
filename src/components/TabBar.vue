<script setup>
const props = defineProps({
  modelValue: { type: String, default: 'community' },
})
const emit = defineEmits(['update:modelValue'])

const tabs = [
  { key: 'community', label: '社区', glyph: '◐' },
  { key: 'mine', label: '我的', glyph: '◑' },
]

function pick(key) {
  emit('update:modelValue', key)
}
</script>

<template>
  <nav
    class="fixed bottom-0 inset-x-0 z-40 glass-strong border-t border-white/10"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <div class="max-w-5xl mx-auto flex">
      <button
        v-for="t in tabs"
        :key="t.key"
        @click="pick(t.key)"
        :class="modelValue === t.key ? 'text-rose-glow' : 'text-mist-muted hover:text-mist-text/90'"
        class="flex-1 flex flex-col items-center gap-0.5 py-3"
      >
        <span class="text-lg leading-none">{{ t.glyph }}</span>
        <span class="text-xs font-medium">{{ t.label }}</span>
        <span
          v-if="modelValue === t.key"
          class="h-1 w-1 rounded-full bg-rose-glow shadow-[0_0_8px_rgba(14,165,183,0.8)]"
        ></span>
      </button>
    </div>
  </nav>
</template>
