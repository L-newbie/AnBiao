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

const TAB_KEY = 'gc_tab'
const AUTO_REFRESH_MS = 5 * 60 * 1000 // 5 minutes

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

const entries = ref([])
const loading = ref(true)
const loadErr = ref('')

// New-content notice: count of entries the latest silent fetch found that
// aren't yet displayed.
const newCount = ref(0)
let autoTimer = null

// Show newest first. (The report/hidden flow was removed, so every published
// entry is visible.)
const visible = computed(() =>
  entries.value
    .filter((e) => e.status !== 'hidden' || e._local)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
)

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
    newCount.value = 0
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

// Silent fetch for the 5-min auto-refresh: compares id sets and only sets
// newCount when there are genuinely new entries. Never flips the loading
// flag or clobbers state mid-scroll.
async function silentFetch() {
  try {
    const fresh = await loadEntries()
    const known = new Set(entries.value.map((e) => e.id))
    const freshIds = fresh.map((e) => e.id)
    const added = freshIds.filter((id) => !known.has(id))
    if (added.length > 0) {
      // Stash the fresh batch; reveal on user tap.
      pendingFresh.value = fresh
      newCount.value = added.length
    }
  } catch {
    /* keep last good state; stay quiet */
  }
}

// Held until the user taps the "new content" notice.
const pendingFresh = ref([])

function revealNew() {
  if (!pendingFresh.value.length) {
    newCount.value = 0
    return
  }
  entries.value = mergeKeepingLocal(entries.value, pendingFresh.value)
  pendingFresh.value = []
  newCount.value = 0
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Merge a fresh batch into current, preserving optimistic (_local) entries
// that haven't shipped to the data branch yet.
function mergeKeepingLocal(current, fresh) {
  const freshIds = new Set(fresh.map((e) => e.id))
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
}

onMounted(async () => {
  loading.value = true
  try {
    entries.value = await loadEntries()
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
        />
        <CommunityView
          v-else-if="tab === 'community'"
          key="community"
          :entries="visible"
          :loading="loadingForView"
          :pull="pull"
          :new-count="newCount"
          @open="openDetail"
          @refresh="onPullRefresh"
          @show-new="revealNew"
        />
        <MineView v-else key="mine" :entries="visible" @open="openDetail" />
      </Transition>
    </main>

    <FabButton v-if="tab === 'community' && !detail" @click="modalOpen = true" />

    <TabBar v-if="!detail" v-model="tab" />

    <UploadModal v-model:open="modalOpen" @submitted="onSubmitted" />

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
