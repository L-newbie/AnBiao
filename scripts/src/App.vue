<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TabBar from './components/TabBar.vue'
import FabButton from './components/FabButton.vue'
import UploadModal from './components/UploadModal.vue'
import CommunityView from './views/CommunityView.vue'
import MineView from './views/MineView.vue'
import { loadEntries } from './lib/github.js'
import { usePullRefresh } from './lib/usePullRefresh.js'

const TAB_KEY = 'gc_tab'
const AUTO_REFRESH_MS = 5 * 60 * 1000 // 5 minutes

const tab = ref(localStorage.getItem(TAB_KEY) || 'community')
const modalOpen = ref(false)

const entries = ref([])
const loading = ref(true)
const loadErr = ref('')

// New-content notice: count of entries the latest silent fetch found that
// aren't yet displayed.
const newCount = ref(0)
let autoTimer = null

// Show published first, newest first; hide entries over threshold.
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
  } catch (e) {
    loadErr.value = e.message
  }
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

function onReported(updated) {
  const i = entries.value.findIndex((e) => e.id === updated.id)
  if (i >= 0) entries.value[i] = { ...entries.value[i], ...updated }
}

onMounted(async () => {
  loading.value = true
  try {
    entries.value = await loadEntries()
  } catch (e) {
    loadErr.value = e.message
  } finally {
    loading.value = false
  }
  autoTimer = setInterval(silentFetch, AUTO_REFRESH_MS)
})

onBeforeUnmount(() => {
  clearInterval(autoTimer)
})
</script>

<template>
  <div class="min-h-full app-gradient">
    <main class="max-w-5xl mx-auto px-4 pt-2 pb-28">
      <Transition name="view-fade" mode="out-in">
        <CommunityView
          v-if="tab === 'community'"
          key="community"
          :entries="visible"
          :loading="loadingForView"
          :pull="pull"
          :new-count="newCount"
          @reported="onReported"
          @refresh="onPullRefresh"
          @show-new="revealNew"
        />
        <MineView v-else key="mine" :entries="visible" />
      </Transition>
    </main>

    <FabButton v-if="tab === 'community'" @click="modalOpen = true" />

    <TabBar v-model="tab" />

    <UploadModal v-model:open="modalOpen" @submitted="onSubmitted" />
  </div>
</template>
