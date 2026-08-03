// Community tag filter: aggregate tags present in the feed, persist a
// multi-select, and filter entries. Default (no selection) shows ALL entries
// including legacy ones that lack `tags`; selecting specific tags shows entries
// that contain ANY of them (OR). Tagless/legacy entries are hidden only while a
// filter is active — they belong to none.

import { ref, watch } from 'vue'

const STORAGE_KEY = 'gc_tag_filter'

// Unique, zh-sorted tags aggregated from entries that carry a `tags` array.
// Defensive against missing/empty/non-array tags so legacy entries never break.
export function tagsFromEntries(entries) {
  const set = new Set()
  for (const e of entries) {
    if (e && Array.isArray(e.tags)) {
      for (const t of e.tags) {
        const s = String(t).trim()
        if (s) set.add(s)
      }
    }
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
// tag set so stale tags (no longer present in data) are dropped.
export function useTagFilter(tagsRef) {
  const selected = ref(loadSelected())

  watch(
    tagsRef,
    (tags) => {
      const live = new Set(tags)
      selected.value = selected.value.filter((t) => live.has(t))
    },
    { immediate: true },
  )

  watch(selected, (arr) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  })

  function toggle(tag) {
    const i = selected.value.indexOf(tag)
    if (i >= 0) selected.value = selected.value.filter((t) => t !== tag)
    else selected.value = [...selected.value, tag]
  }

  function clear() {
    selected.value = []
  }

  return { selected, toggle, clear }
}

// Filtering logic shared by the community view. OR across the selected tags;
// empty selection shows everything (including tagless/legacy entries).
export function filterByTags(entries, selected) {
  if (!selected || selected.length === 0) return entries
  return entries.filter(
    (e) => Array.isArray(e.tags) && e.tags.some((t) => selected.includes(t)),
  )
}
