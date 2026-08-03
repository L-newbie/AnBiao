<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TabBar from './components/TabBar.vue'
import FabButton from './components/FabButton.vue'
import UploadModal from './components/UploadModal.vue'
import CommunityView from './views/CommunityView.vue'
import MineView from './views/MineView.vue'
import DetailView from './views/DetailView.vue'
import { loadEntries } from './lib/github.js'
import { usePullRefresh } from './lib/usePullRefresh.js'
import { getDeviceId, rebuildUploadsToday, rebuildCommentsToday, recordUpload, recordComment, uploadsToday, commentsToday } from './lib/device.js'
import { needRefresh, offlineReady, applyUpdate, dismissOffline } from './lib/usePwaUpdate.js'
import { useTagFilter, tagsFromEntries } from './lib/useTagFilter.js'
import { loadPending, addPending, prunePending } from './lib/pending.js'

const TAB_KEY = 'gc_tab'
const AUTO_REFRESH_MS = 15 * 1000 // 15 seconds

const tab = ref(localStorage.getItem(TAB_KEY) || 'community')
const modalOpen = ref(false)

// PWA update toast: "已可离线使用" auto-dismisses after a short beat.
const offlineTimer = ref(null)
watch(offlineReady, (ready) => {
  if (ready) {
    offlineTimer.value = setTimeout(() => dismissOffline(), 2500)
  } else if (offlineTimer.value) {
    clearTimeout(offlineTimer.value)
    offlineTimer.value = null
  }
})

// Currently-open detail entry (null = no detail view). Opening a detail
// switches the main area to DetailView; closing returns to the active tab.
const detail = ref(null)
function openDetail(entry) {
  detail.value = entry
}
function closeDetail() {
  detail.value = null
}

// Tag filter lives here (not inside CommunityView) because the detail view can
// trigger a "click a tag -> jump back to the feed filtered by it" flow — that
// needs an external setter. City filter has no such cross-view write, so it
// stays self-contained inside CommunityView. This is the one intentional
// asymmetry between the two filters.
const entries = ref([])
const loading = ref(true)
const loadErr = ref('')

let autoTimer = null

// Show newest first. (The report/hidden flow was removed, so every published
// entry is visible.)
const visible = computed(() =>
  entries.value
    .filter((e) => e.status !== 'hidden' || e._local)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
)

// Tag options derived from the visible feed (hidden entries' tags don't
// populate the filter/upload chips). selectedTags is owned here so the detail
// view can set it; useTagFilter gives persistence + stale-tag pruning for free.
const allTags = computed(() => tagsFromEntries(visible.value))
const { selected: selectedTags } = useTagFilter(allTags)

// Click a tag chip on the detail view: filter the feed by that single tag and
// return to the community tab. The tag came from an entry's tags (and lives in
// allTags), so the composable's intersection watch won't drop it.
function onFilterByTag(tag) {
  selectedTags.value = [tag]
  tab.value = 'community'
  detail.value = null
}

watch(tab, (t) => {
  localStorage.setItem(TAB_KEY, t)
  // Switching tabs closes any open modal.
  modalOpen.value = false
})

// Full refresh: drives the loading state + pull-refresh indicator.
async function refresh() {
  loadErr.value = ''
  try {
    const fresh = await loadEntries()
    entries.value = mergeKeepingLocal(entries.value, fresh)
    rebuildCountsFromServer()
  } catch (e) {
    loadErr.value = e.message
  }
}

// Rebuild the soft daily counters from server truth. After a cache clear the
// localStorage counters reset to 0 but the device id is fingerprint-derived
// (stable), so we can scan the aggregated entries and recover today's usage.
// We write the recovered counts back to localStorage and notify the upload
// modal / detail view to refresh their displayed remaining counts.
function rebuildCountsFromServer() {
  const id = getDeviceId()
  const uploads = rebuildUploadsToday(entries.value, id)
  const comments = rebuildCommentsToday(entries.value, id)
  // Bring localStorage up to the rebuilt value (only adds, never subtracts).
  while (uploadsToday() < uploads) recordUpload()
  while (commentsToday() < comments) recordComment()
  window.dispatchEvent(new CustomEvent('gc-counts-rebuilt'))
}

// Silent fetch for the 15s auto-refresh: merges new entries straight into
// the list so the view refreshes itself without a tap. Never flips the
// loading flag or clobbers state mid-scroll.
async function silentFetch() {
  try {
    const fresh = await loadEntries()
    entries.value = mergeKeepingLocal(entries.value, fresh)
    rebuildCountsFromServer()
  } catch {
    /* keep last good state; stay quiet */
  }
}

// Merge a fresh batch into current, preserving optimistic (_local) entries
// that haven't shipped to the data branch yet. Any local entry whose id now
// appears in the fresh aggregate has been promoted to the public feed — it
// gets replaced by the server copy AND dropped from localStorage pending.
function mergeKeepingLocal(current, fresh) {
  const freshIds = new Set(fresh.map((e) => e.id))
  prunePending([...freshIds])
  const locals = current.filter((e) => e._local && !freshIds.has(e.id))
  return [...locals, ...fresh]
}

// Pull-to-refresh drives the loading flag + indicator.
const pullRefresh = usePullRefresh(refresh)

// Bridge: CommunityView reads loading from us + drives the pull indicator.
const loadingForView = computed(() => loading.value || pullRefresh.refreshing.value)
const pull = pullRefresh.pull

function onPullRefresh() {
  pullRefresh.fire()
}

function onSubmitted(entry) {
  // optimistic local display until next deploy
  entries.value = [entry, ...entries.value]
  // Persist so a refresh doesn't lose it: data.json only rebuilds on a master
  // deploy, and the in-memory _local entry would otherwise vanish on reload.
  addPending(entry)
}

onMounted(async () => {
  loading.value = true
  try {
    // Restore entries submitted since the last deploy (not yet in data.json).
    // They keep _local so cards show the "等待通过" badge until they're aggregated.
    const pending = loadPending()
    const server = await loadEntries()
    const serverIds = new Set(server.map((e) => e.id))
    // Any pending entry already in the live aggregate has been promoted — drop it.
    const stillPending = pending.filter((e) => !serverIds.has(e.id))
    if (stillPending.length !== pending.length) prunePending([...serverIds])
    entries.value = mergeKeepingLocal(stillPending, server)
    rebuildCountsFromServer()
  } catch (e) {
    loadErr.value = e.message
  } finally {
    loading.value = false
  }
  autoTimer = setInterval(silentFetch, AUTO_REFRESH_MS)
})

onBeforeUnmount(() => {
  clearInterval(autoTimer)
  if (offlineTimer.value) clearTimeout(offlineTimer.value)
})
</script>

<template>
  <div class="min-h-full app-gradient">
    <main class="max-w-5xl mx-auto px-4 pt-2 pb-28">
      <Transition name="view-fade" mode="out-in">
        <DetailView
          v-if="detail"
          key="detail"
          :entry="detail"
          @close="closeDetail"
          @filter-by-tag="onFilterByTag"
        />
        <CommunityView
          v-else-if="tab === 'community'"
          key="community"
          :entries="visible"
          :loading="loadingForView"
          :pull="pull"
          v-model:selectedTags="selectedTags"
          @open="openDetail"
          @refresh="onPullRefresh"
        />
        <MineView v-else key="mine" :entries="visible" @open="openDetail" />
      </Transition>
    </main>

    <FabButton v-if="tab === 'community' && !detail" @click="modalOpen = true" />

    <TabBar v-if="!detail" v-model="tab" />

    <UploadModal v-model:open="modalOpen" :existingTags="allTags" @submitted="onSubmitted" />

    <!-- PWA update / offline-ready toast -->
    <Transition name="view-fade">
      <div
        v-if="needRefresh || offlineReady"
        class="fixed inset-x-0 bottom-20 flex justify-center px-4 z-50 pointer-events-none"
      >
        <button
          v-if="needRefresh"
          @click="applyUpdate"
          class="glass-strong rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-accent shadow-lg pointer-events-auto hover:brightness-105"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-accent animate-pulse"></span>
          内容已更新 · 刷新查看
        </button>
        <div
          v-else
          class="glass-strong rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-mist-text shadow-lg"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-accent"></span>
          已可离线使用
        </div>
      </div>
    </Transition>
  </div>
</template>
