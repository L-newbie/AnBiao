// Community city filter: aggregate cities present in the feed, persist a
// multi-select, and filter entries. Default (no selection) shows ALL entries
// including legacy ones that lack a `city`; selecting specific cities shows
// only those — legacy no-city entries are hidden then (they belong to none).

import { ref, watch } from 'vue'

const STORAGE_KEY = 'gc_city_filter'

// Unique, zh-sorted cities aggregated from entries that carry a `city`.
export function citiesFromEntries(entries) {
  const set = new Set()
  for (const e of entries) {
    if (e && e.city) set.add(e.city)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

function loadSelected() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Persisted multi-select state. Selection is kept intersected with the live
// city set so stale cities (no longer present in data) are dropped.
export function useCityFilter(citiesRef) {
  const selected = ref(loadSelected())

  watch(
    citiesRef,
    (cities) => {
      const live = new Set(cities)
      selected.value = selected.value.filter((c) => live.has(c))
    },
    { immediate: true },
  )

  watch(selected, (arr) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  })

  function toggle(city) {
    const i = selected.value.indexOf(city)
    if (i >= 0) selected.value = selected.value.filter((c) => c !== city)
    else selected.value = [...selected.value, city]
  }

  function clear() {
    selected.value = []
  }

  return { selected, toggle, clear }
}

// Filtering logic shared by the community view.
export function filterByCity(entries, selected) {
  if (!selected || selected.length === 0) return entries
  return entries.filter((e) => e.city && selected.includes(e.city))
}
