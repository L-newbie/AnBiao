<script setup>
import { computed, ref } from 'vue'
import { forwardGeocode } from '../lib/amap.js'
import { pushToast } from '../lib/toast.js'
import { citiesFromEntries } from '../lib/useCityFilter.js'
import { tagsFromEntries } from '../lib/useTagFilter.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  selectedCities: { type: Array, default: () => [] },
  selectedTags: { type: Array, default: () => [] },
  // Filter-panel visibility is owner-controlled (shared with the feed page:
  // both panes expand/collapse together).
  filterOpen: { type: Boolean, default: false },
})
const emit = defineEmits([
  'update:selectedCities',
  'update:selectedTags',
  'update:filterOpen',
  'search-go', // {lng, lat}
])

const searchInput = ref('')
const searching = ref(false)

const cities = computed(() => citiesFromEntries(props.entries))
const tags = computed(() => tagsFromEntries(props.entries))

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

async function goSearch() {
  const q = searchInput.value.trim()
  if (!q) return
  searching.value = true
  try {
    const results = await forwardGeocode(q)
    if (results.length) {
      emit('search-go', { lng: results[0].lng, lat: results[0].lat })
      searchInput.value = ''
    } else {
      pushToast('没有找到这个地点', { type: 'error' })
    }
  } catch (e) {
    pushToast(e.message || '搜索失败', { type: 'error' })
  } finally {
    searching.value = false
  }
}

function onSearchKey(e) {
  if (e.key === 'Enter') goSearch()
  if (e.key === 'Escape') {
    searchInput.value = ''
    e.target.blur()
  }
}
</script>

<template>
  <div class="absolute top-0 inset-x-0 z-30 pt-3 pb-2 px-4 pointer-events-none" style="padding-top: max(env(safe-area-inset-top), 12px)">
    <div class="max-w-5xl mx-auto flex items-center gap-2 pointer-events-auto">
      <!-- Search pill -->
      <div class="flex-1 glass-strong rounded-full px-4 py-2.5 shadow flex items-center gap-2.5 min-w-0">
        <span class="text-mist-muted shrink-0 text-sm">🔍</span>
        <input
          v-model="searchInput"
          @keydown="onSearchKey"
          :disabled="searching"
          type="text"
          placeholder="搜地点、城市或地址…"
          class="flex-1 bg-transparent outline-none text-sm text-mist-text placeholder-mist-muted/50 min-w-0 disabled:opacity-60"
        />
        <button
          v-if="searchInput.trim()"
          @click="goSearch"
          :disabled="searching"
          class="shrink-0 text-xs text-accent font-medium disabled:opacity-50"
        >{{ searching ? '…' : '去' }}</button>
        <button
          @click="emit('update:filterOpen', !filterOpen)"
          :aria-expanded="filterOpen"
          aria-label="展开筛选"
          class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition active:scale-90"
          :class="selectedCities.length || selectedTags.length ? 'text-accent' : 'text-mist-muted/60'"
        >
          <svg viewBox="0 0 24 24" fill="none" class="w-4 h-4" stroke="currentColor" stroke-width="2.5">
            <path d="M3 4.5h18M6 12h12M9.5 19.5h5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Filter chips: collapsible row beneath the bar. No Transition wrapper —
         grid-template-rows 0fr↔1fr needs to be on the mounted element for
         height to interpolate, and stacking Transition + v-if was silently
         breaking it. -->
    <div
      class="max-w-5xl mx-auto mt-2 grid transition-all duration-200 ease-out pointer-events-auto"
      :class="filterOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'"
    >
      <div class="min-h-0 overflow-hidden">
        <div v-if="filterOpen" class="glass-strong rounded-2xl p-2.5 space-y-2 max-h-52 overflow-y-auto thin-scroll shadow">
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
          <div v-if="tags.length">
            <p class="text-[10px] text-mist-muted/70 mb-1 px-0.5">标签</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="t in tags"
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
  </div>
</template>
