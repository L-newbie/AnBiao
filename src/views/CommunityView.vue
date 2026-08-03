<script setup>
import { computed } from 'vue'
import CityFilter from '../components/CityFilter.vue'
import TagFilter from '../components/TagFilter.vue'
import EntryCard from '../components/EntryCard.vue'
import { citiesFromEntries, filterByCity, useCityFilter } from '../lib/useCityFilter.js'
import { tagsFromEntries, filterByTags } from '../lib/useTagFilter.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  pull: { type: Number, default: 0 },
  selectedTags: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'refresh', 'update:selectedTags'])

const cities = computed(() => citiesFromEntries(props.entries))
const tagOptions = computed(() => tagsFromEntries(props.entries))

const { selected } = useCityFilter(computed(() => cities.value))

// City and tag filters are independent (an entry must pass both). City stays
// self-contained (selected owned here via useCityFilter); tag selection is
// controlled from App.vue so the detail view can set it.
const filtered = computed(() =>
  filterByTags(filterByCity(props.entries, selected.value), props.selectedTags),
)

// Pull indicator state: rotating spinner while refreshing, downward chevron
// while arming (pull < threshold), chevron flipped when ready to release.
const threshold = 64
const armState = computed(() => {
  if (props.loading) return 'spin'
  if (props.pull <= 0) return 'idle'
  return props.pull >= threshold ? 'ready' : 'arm'
})
const pullText = computed(() => {
  if (props.loading) return '刷新中…'
  if (props.pull <= 0) return ''
  return props.pull >= threshold ? '松开刷新' : '下拉刷新'
})
</script>

<template>
  <div class="space-y-5">
    <!-- pull-to-refresh indicator (sticks to top while pulling) -->
    <div
      class="flex flex-col items-center justify-center overflow-hidden transition-[height] duration-150 ease-out"
      :style="{ height: (pull > 0 || loading ? Math.max(pull, loading ? 40 : 0) : 0) + 'px' }"
    >
      <span
        :class="armState === 'spin' ? 'spin' : ''"
        class="text-xl text-accent transition-transform duration-200"
        :style="{
          transform: armState === 'ready' ? 'rotate(180deg)' : 'rotate(0deg)',
          opacity: pull > 0 || loading ? 1 : 0,
        }"
      >↻</span>
      <span v-if="pullText" class="text-[11px] text-mist-muted mt-0.5">{{ pullText }}</span>
    </div>

    <!-- page header -->
    <header class="pb-1 text-center">
      <h1
        class="font-serif text-5xl sm:text-6xl font-semibold tracking-wide leading-tight
               bg-gradient-to-r from-accent via-accent-3 to-accent-2
               bg-clip-text text-transparent title-vibrant"
      >
        暗标
      </h1>
      <div class="mt-4 h-px w-24 mx-auto bg-gradient-to-r from-transparent via-accent-2/40 to-transparent"></div>
    </header>

    <!-- city + tag filters, side by side. grid-cols-2 keeps them on one row
         (city left, tag right); bump to grid-cols-3 / flex-wrap when more
         filter chips are added later. -->
    <div class="grid grid-cols-2 gap-3">
      <!-- city filter -->
      <CityFilter :cities="cities" v-model="selected" />

      <!-- tag filter (controlled by App so the detail view can drive it) -->
      <TagFilter
        :tags="tagOptions"
        :modelValue="selectedTags"
        @update:modelValue="emit('update:selectedTags', $event)"
      />
    </div>

    <!-- count -->
    <div class="flex items-center justify-between">
      <h2 class="font-serif text-lg text-mist-text">公开记录 · {{ filtered.length }}</h2>
    </div>

    <!-- grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <EntryCard
        v-for="e in filtered"
        :key="e.id"
        :entry="e"
        @open="(entry) => emit('open', entry)"
      />
    </div>

    <p
      v-if="!loading && filtered.length === 0 && entries.length > 0"
      class="text-sm text-mist-muted text-center py-8"
    >
      当前筛选条件下暂无记录，换个条件看看？
    </p>
  </div>
</template>
