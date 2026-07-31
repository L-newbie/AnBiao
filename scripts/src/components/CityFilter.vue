<script setup>
const props = defineProps({
  cities: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const allSelected = () => props.modelValue.length === 0

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
</script>

<template>
  <div class="thin-scroll overflow-x-auto -mx-4 px-4 pb-1">
    <div class="flex gap-2 w-max">
      <button
        @click="selectAll"
        :class="allSelected() ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white shadow-[0_0_12px_rgba(14,165,183,0.5)]' : 'glass text-mist-muted hover:text-mist-text'"
        class="shrink-0 rounded-full px-4 py-1.5 text-sm transition"
      >
        全部
      </button>
      <button
        v-for="c in cities"
        :key="c"
        @click="toggle(c)"
        :class="modelValue.includes(c) ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white shadow-[0_0_12px_rgba(14,165,183,0.5)]' : 'glass text-mist-muted hover:text-mist-text'"
        class="shrink-0 rounded-full px-4 py-1.5 text-sm transition"
      >
        {{ c }}
      </button>
    </div>
  </div>
</template>
