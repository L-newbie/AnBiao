<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  tags: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const root = ref(null)

const allSelected = () => props.modelValue.length === 0

// Button label: "全部标签" when nothing selected, otherwise the count.
const label = computed(() => {
  if (allSelected()) return '全部标签'
  if (props.modelValue.length === 1) return props.modelValue[0]
  return `已选 ${props.modelValue.length} 个标签`
})

function selectAll() {
  if (!allSelected()) emit('update:modelValue', [])
}

function toggle(tag) {
  if (props.modelValue.includes(tag)) {
    emit('update:modelValue', props.modelValue.filter((t) => t !== tag))
  } else {
    emit('update:modelValue', [...props.modelValue, tag])
  }
}

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="relative">
    <button
      @click="open = !open"
      class="w-full glass rounded-2xl px-4 py-2.5 flex items-center justify-between text-sm text-mist-text hover:brightness-105 transition"
    >
      <span class="flex items-center gap-2">
        <span class="text-accent">🏷</span>
        <span class="font-serif">{{ label }}</span>
      </span>
      <span class="text-mist-muted text-xs" :class="open ? 'rotate-180' : ''" style="transition: transform 0.2s">⌄</span>
    </button>

    <Transition name="view-fade">
      <div
        v-if="open"
        class="absolute z-30 mt-2 w-full glass-strong rounded-2xl p-2 shadow-[0_8px_30px_rgba(0,0,0,0.25)] max-h-[60vh] overflow-y-auto thin-scroll"
      >
        <!-- select-all -->
        <button
          @click="selectAll"
          :class="allSelected() ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'glass text-mist-muted hover:text-mist-text'"
          class="w-full rounded-xl px-3 py-2 text-sm transition mb-1"
        >
          全部
        </button>

        <!-- tag grid: auto-fills columns by available width (1 col on narrow,
             more on wider screens). minmax keeps chips readable. -->
        <div class="grid gap-1.5 mt-1" style="grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))">
          <button
            v-for="t in tags"
            :key="t"
            @click="toggle(t)"
            :class="modelValue.includes(t) ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'glass text-mist-muted hover:text-mist-text'"
            class="rounded-xl px-2.5 py-1.5 text-xs transition truncate"
            :title="t"
          >
            {{ t }}
          </button>
        </div>

        <!-- friendly hint when there are no tags to pick from yet -->
        <p v-if="tags.length === 0" class="text-[11px] text-mist-muted/60 text-center py-2">
          还没有任何标签，去留一条带标签的吧
        </p>
      </div>
    </Transition>
  </div>
</template>
