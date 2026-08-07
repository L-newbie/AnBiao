// Feed = the map's photo-grid mirror, NOT an independent filter surface.
//
// It only displays what the current map filters (city / tag / nearby) select:
// App.vue owns the selectedCities/selectedTags state and applies it to the
// full visibleCommunity before handing entries down. This guarantees the map
// canvas and this grid always show exactly the same slice of the world.
//
// This also means: no CityFilter/TagFilter components here — the chips that
// drive the list live in the map's chrome, where they make sense. The feed's
// only "filter UI" is a soft hint line showing what slice is on.

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EntryCard from '../components/EntryCard.vue'
import SkeletonCard from '../components/SkeletonCard.vue'
import { citiesFromEntries } from '../lib/useCityFilter.js'
import { tagsFromEntries } from '../lib/useTagFilter.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  // The full unfiltered corpus — used only for building the OPTIONS lists
  // (city/tag suggestions). Filtering itself happens upstream in App.vue.
  allEntries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  pull: { type: Number, default: 0 },
  selectedCities: { type: Array, default: () => [] },
  selectedTags: { type: Array, default: () => [] },
  hasMore: { type: Boolean, default: false },
  // Filter-panel visibility: shared with the map chrome (both panes expand and
  // collapse together so switching between map and feed doesn't lose context).
  filterOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'refresh', 'load-more', 'clear-filters', 'update:selectedCities', 'update:selectedTags', 'update:filterOpen'])

// Filter UI: same quick chips as the map chrome (same selected* collections,
// so toggling here updates the map too — they share the one source of truth
// in App.vue).
const cities = computed(() => citiesFromEntries(props.allEntries))
const tagOptions = computed(() => tagsFromEntries(props.allEntries))

function toggleCity(c) {
  const cur = new Set(props.selectedCities)
  if (cur.has(c)) cur.delete(c)
  else cur.add(c)
  emit('update:selectedCities', [...cur])
}
function toggleTag(t) {
  const cur = new Set(props.selectedTags)
  if (cur.has(t)) cur.delete(t)
  else cur.add(t)
  emit('update:selectedTags', [...cur])
}
function clearAll() {
  emit('update:selectedCities', [])
  emit('update:selectedTags', [])
}

// A one-line summary of the filter slice we're showing. When there's a
// filter applied but it selects NOTHING, we also push a toast once per
// change — without it the user has no way to know "filter is on but no
// data matches" vs "filter just didn't trigger".
import { pushToast } from '../lib/toast.js'

const filterSummary = computed(() => {
  const parts = []
  if (props.selectedCities.length) parts.push(...props.selectedCities)
  if (props.selectedTags.length) parts.push(...props.selectedTags.map((t) => '#' + t))
  return parts.join(' · ')
})

watch(
  () => [props.selectedCities, props.selectedTags, props.entries.length],
  ([cities, tags, count]) => {
    if ((cities.length || tags.length) && count === 0) {
      pushToast(`筛选下没有记录，试试更宽的条件`, { type: 'info' })
    }
  },
)

// Infinite scroll sentinel: triggers when the sentinel crosses into view.
const sentinel = ref(null)
let observer = null
onMounted(() => {
  observer = new IntersectionObserver(
    (list) => {
      if (list.some((r) => r.isIntersecting) && props.hasMore && !props.loading) {
        emit('load-more')
      }
    },
    { rootMargin: '320px 0px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())

// Pull indicator.
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
  <div class="space-y-4">
    <!-- pull-to-refresh indicator -->
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

    <!-- Compact head: live count + filter toggle. The chips row uses the same
         selection as the map, so toggling here updates the map too. -->
    <div class="flex items-center justify-between gap-2 pt-1">
      <p class="text-sm text-mist-muted flex-1 min-w-0">
        <b class="font-serif text-base text-mist-text">{{ entries.length }}</b> 条
        <span v-if="filterSummary" class="text-xs text-mist-muted/70"> · {{ filterSummary }}</span>
      </p>
      <button
        @click="emit('update:filterOpen', !filterOpen)"
        :aria-expanded="filterOpen"
        aria-label="筛选"
        class="shrink-0 w-8 h-8 rounded-full glass-strong flex items-center justify-center text-mist-muted hover:text-mist-text transition active:scale-90"
        :class="filterOpen || filterSummary ? 'text-accent' : ''"
      >
        <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4" stroke="currentColor" stroke-width="2.5">
          <path d="M3 4.5h18M6 12h12M9.5 19.5h5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- collapsible chips: same appearance as the map's chrome panel -->
    <div
      class="grid transition-all duration-200 ease-out overflow-hidden"
      :class="filterOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
    >
      <div class="min-h-0">
        <div class="glass-strong rounded-2xl p-2.5 space-y-2 max-h-52 overflow-y-auto thin-scroll shadow">
          <div v-if="cities.length">
            <p class="text-[10px] text-mist-muted/70 mb-1 px-0.5">城市</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="c in cities"
                :key="c"
                @click="toggleCity(c)"
                class="rounded-full px-3 py-1 text-xs transition"
                :class="selectedCities.includes(c)
                  ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white shadow-sm'
                  : 'glass text-mist-muted hover:text-mist-text'"
              >{{ c }}</button>
            </div>
          </div>
          <div v-if="tagOptions.length">
            <p class="text-[10px] text-mist-muted/70 mb-1 px-0.5">标签</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="t in tagOptions"
                :key="t"
                @click="toggleTag(t)"
                class="rounded-full px-3 py-1 text-xs transition"
                :class="selectedTags.includes(t)
                  ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white shadow-sm'
                  : 'glass text-mist-muted hover:text-mist-text'"
              >#{{ t }}</button>
            </div>
          </div>
          <button
            v-if="selectedCities.length || selectedTags.length"
            @click="clearAll"
            class="w-full text-xs text-accent text-center py-1 hover:brightness-110"
          >清除全部筛选</button>
        </div>
      </div>
    </div>

    <!-- grid -->
    <div v-if="loading && !entries.length" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <SkeletonCard v-for="i in 6" :key="i" />
    </div>
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <EntryCard
        v-for="(e, i) in entries"
        :key="e.id"
        :entry="e"
        :style="{ animationDelay: Math.min(i * 30, 180) + 'ms' }"
        class="card-rise"
        @open="(entry) => emit('open', entry)"
      />
    </div>

    <!-- lazy-load trigger -->
    <div v-if="hasMore" ref="sentinel" class="py-3 flex justify-center">
      <button
        @click="emit('load-more')"
        class="rounded-full glass px-5 py-2 text-xs text-mist-muted hover:text-mist-text transition"
      >加载更多 ↓</button>
    </div>

    <p
      v-if="!loading && entries.length === 0"
      class="text-sm text-mist-muted text-center py-8"
    >
      {{ filterSummary ? '这个筛选下暂时没有记录' : '还没有公开记录' }}
    </p>
  </div>
</template>
