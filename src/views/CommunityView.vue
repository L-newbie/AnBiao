<script setup>
import { computed } from 'vue'
import CityFilter from '../components/CityFilter.vue'
import EntryCard from '../components/EntryCard.vue'
import { citiesFromEntries, filterByCity, useCityFilter } from '../lib/useCityFilter.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  pull: { type: Number, default: 0 },
  newCount: { type: Number, default: 0 },
})
const emit = defineEmits(['open', 'refresh', 'show-new'])

const cities = computed(() => citiesFromEntries(props.entries))

const { selected } = useCityFilter(computed(() => cities.value))

const filtered = computed(() => filterByCity(props.entries, selected.value))

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

    <!-- new content notice -->
    <Transition name="view-fade">
      <button
        v-if="newCount > 0"
        @click="emit('show-new')"
        class="w-full glass-strong rounded-2xl px-4 py-2.5 flex items-center justify-between text-sm text-accent hover:brightness-105"
      >
        <span class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full bg-accent animate-pulse"></span>
          有 {{ newCount }} 条新暮色 · 点击查看
        </span>
        <span class="text-mist-muted">›</span>
      </button>
    </Transition>

    <!-- page header -->
    <header class="pb-1">
      <h1 class="font-serif text-4xl sm:text-5xl text-mist-text tracking-wide font-semibold leading-tight">
        暗标
      </h1>
      <p class="font-serif text-base text-accent mt-1 tracking-wide">握住你的腰子</p>
      <div class="mt-4 h-px w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent"></div>
    </header>

    <!-- city filter -->
    <CityFilter :cities="cities" v-model="selected" />

    <!-- count -->
    <div class="flex items-center justify-between">
      <h2 class="font-serif text-lg text-mist-text">公开记录 · {{ filtered.length }}</h2>
      <span class="text-xs text-mist-muted/70">每 5 分钟自动更新</span>
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
      当前城市暂无记录，换一个城市看看？
    </p>
  </div>
</template>
