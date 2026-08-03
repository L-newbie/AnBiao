<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  cities: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const root = ref(null)

const allSelected = () => props.modelValue.length === 0

// Button label: "全部城市" when nothing selected, otherwise the count.
const label = computed(() => {
  if (allSelected()) return '全部城市'
  if (props.modelValue.length === 1) return props.modelValue[0]
  return `已选 ${props.modelValue.length} 个城市`
})

function selectAll() {
  if (!allSelected()) emit('update:modelValue', [])
}

function toggle(city) {
  if (props.modelValue.includes(city)) {
    emit('update:modelValue', props.modelValue.filter((c) => c !== city))
  } else {
    emit('update:modelValue', [...props.modelValue, city])
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
        <span class="text-accent">🏙</span>
        <span class="font-serif">{{ label }}</span>
      </span>
      <span class="text-mist-muted text-xs" :class="open ? 'rotate-180' : ''" style="transition: transform 0.2s">⌄</span>
    </button>

    <!-- dropdown wrapper: absolute so it floats under the button; the
         grid-template-rows 0fr↔1fr transition grows/shrinks its height with
         no translateY, so the panel slides open/down instead of "shaking". -->
    <Transition name="dropdown-expand">
      <div
        v-if="open"
        class="absolute z-30 mt-2 w-full grid"
      >
        <div
          class="glass-strong rounded-2xl p-2 shadow-[0_8px_30px_rgba(0,0,0,0.25)] max-h-[60vh] overflow-y-auto thin-scroll min-h-0"
        >
          <!-- select-all -->
          <button
            @click="selectAll"
            :class="allSelected() ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'glass text-mist-muted hover:text-mist-text'"
            class="w-full rounded-xl px-3 py-2 text-sm transition mb-1"
          >
            全部
          </button>

          <!-- city grid: auto-fills columns by available width (1 col on narrow,
               more on wider screens). minmax keeps chips readable. -->
          <div class="grid gap-1.5 mt-1" style="grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))">
            <button
              v-for="c in cities"
              :key="c"
              @click="toggle(c)"
              :class="modelValue.includes(c) ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'glass text-mist-muted hover:text-mist-text'"
              class="rounded-xl px-2.5 py-1.5 text-xs transition truncate"
              :title="c"
            >
              {{ c }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
