<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ExploreView from './views/ExploreView.vue'
import MineView from './views/MineView.vue'
import DetailView from './views/DetailView.vue'
import CommunityView from './views/CommunityView.vue'
import UploadSheet from './components/UploadSheet.vue'
import UploadHub from './components/UploadHub.vue'
import MapSearchBar from './components/MapSearchBar.vue'
import SyncChip from './components/SyncChip.vue'
import Toast from './components/Toast.vue'
import CloseButton from './components/CloseButton.vue'
import { loadFeed, loadAllShards } from './lib/feed.js'
import { config } from './lib/config.js'
import { usePullRefresh } from './lib/usePullRefresh.js'
import { getDeviceId, rebuildUploadsToday, rebuildCommentsToday, recordUpload, recordComment, uploadsToday, commentsToday } from './lib/device.js'
import { needRefresh, offlineReady, applyUpdate, dismissOffline } from './lib/usePwaUpdate.js'
import { useTagFilter, tagsFromEntries } from './lib/useTagFilter.js'
import { useCityFilter, citiesFromEntries } from './lib/useCityFilter.js'
import { loadPending, addPending, prunePending, removePending, savePending } from './lib/pending.js'
import { prunePendingComments, loadPendingComments, removePendingComment } from './lib/pendingComments.js'
import { isDeleted, addDeleted, pruneDeleted } from './lib/deletedEntries.js'
import { deletedComments, isCommentDeleted, addDeletedComment, pruneDeletedComments } from './lib/deletedComments.js'
import { visibilityOf, visibilityOverrides, pruneVisibilityOverrides, PUBLIC } from './lib/entryVisibility.js'
import { initRoute, route, push as pushRoute, replace as replaceRoute, detailPushedByApp } from './lib/route.js'
import { useBodyScrollLock } from './lib/useBodyScrollLock.js'

const AUTO_REFRESH_MS = 15 * 1000 // 15 seconds

// ---- ViewState derived from hash route -----------------------------------
// There is no "tab" state anymore: the map is the root canvas, and the hash
// route decides which overlay (if any) is on top. #/feed and #/mine are
// overlays, #/entry/<id> is the detail, #/map is plain canvas.
const modalOpen = ref(false)
// Filter-panel visibility, shared by the map chrome (MapSearchBar) and the
// feed overlay's filter row — one state, both sides expand/collapse together.
const filterOpen = ref(false)

const isMap = computed(() => route.name === 'map' && !detail.value)
const isFeed = computed(() => route.name === 'feed')
const isMine = computed(() => route.name === 'mine')

// PWA update toast
const offlineTimer = ref(null)
watch(offlineReady, (ready) => {
  if (ready) {
    offlineTimer.value = setTimeout(() => dismissOffline(), 2500)
  } else if (offlineTimer.value) {
    clearTimeout(offlineTimer.value)
    offlineTimer.value = null
  }
})

// ---- Detail state (route-driven) -----------------------------------------
const detail = ref(null)
// Tracks the route that owned the map/feed/mine BEFORE opening a detail, so
// closeDetail returns the user to exactly what they came from (feed → back
// to feed list, map → back to markers). Kept separate from route changes so
// we never confuse "deep-linked" entries with in-app navigation.
let detailSource = 'map'
function openDetail(entry) {
  detailSource = route.name === 'entry' ? detailSource : route.name
  detail.value = entry
  if (route.name !== 'entry' || route.param !== entry.id) pushRoute('entry', entry.id)
}
function closeDetail() {
  if (!detail.value) return
  detail.value = null
  const backTo = detailSource
  detailSource = 'map' // reset for next open
  if (route.name === 'entry') {
    if (detailPushedByApp()) history.back()
    else replaceRoute(backTo === 'map' ? 'map' : backTo)
  }
}

useBodyScrollLock(detail)

// Deep-link resolution
const routeReady = ref(false)
const entryForRoute = computed(() =>
  route.name === 'entry' ? entries.value.find((e) => e.id === route.param) || null : null,
)
const routeEntryMissing = computed(
  () => route.name === 'entry' && routeReady.value && !entryForRoute.value && !detail.value,
)

watch(
  () => [route.name, route.param],
  ([name]) => {
    if (name === 'entry') {
      if (entryForRoute.value && entryForRoute.value !== detail.value) detail.value = entryForRoute.value
    } else {
      if (detail.value) detail.value = null
      modalOpen.value = false
      // NOTE: do NOT reset filterOpen here. MapSearchBar's filter button
      // toggles filterOpen and (on feed/mine views) also triggers a route
      // change — wiping it here means the filter row always stays closed.
      // The panel collapses naturally when the user navigates BACK to the map.
    }
  },
)

// ---- Entries state + sharded feed ----------------------------------------
const entries = ref([])
const loading = ref(true)
const loadErr = ref('')

const feedIndex = ref(null)
const loadedShardSet = ref(new Set())

const hasMore = computed(() => {
  const idx = feedIndex.value
  if (!idx || !Array.isArray(idx.shards) || idx.shards.length <= 1) return false
  const have = loadedShardSet.value || new Set(['data.json'])
  return idx.shards.some((s) => !have.has(s.file))
})

const loadingMore = ref(false)
async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  const idx = feedIndex.value
  if (!idx) return
  const have = new Set(loadedShardSet.value || [])
  const next = idx.shards.find((s) => !have.has(s.file))
  if (!next) return
  loadingMore.value = true
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
    const res = await fetch(base + next.file, { cache: 'no-store' })
    const shardEntries = res.ok ? await res.json() : []
    loadedShardSet.value = new Set([...have, next.file])
    entries.value = mergeKeepingLoaded(
      entries.value,
      Array.isArray(shardEntries) ? shardEntries : [],
      idx,
      Array.from(loadedShardSet.value),
    )
  } catch {
    /* network blip */
  } finally {
    loadingMore.value = false
  }
}

const commentsVersion = ref(0)
let autoTimer = null

const visibleAll = computed(() =>
  entries.value
    .filter((e) => e.status !== 'hidden' || e._local)
    .filter((e) => !isDeleted(e.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
)

const visibleCommunity = computed(() => {
  void visibilityOverrides.value
  return visibleAll.value.filter((e) => visibilityOf(e) === PUBLIC)
})

// ---- Filter state (shared by map chrome + feed overlays) ------------------
// Lives BELOW visibleCommunity: useTagFilter/useCityFilter attach eager
// watchers on their tag/city sources, so they must not be created before the
// computed they read from.
const { selected: selectedTags, set: setSelectedTags } = useTagFilter(computed(() => tagsFromEntries(visibleCommunity.value)))
const { selected: selectedCities, set: setSelectedCities } = useCityFilter(computed(() => citiesFromEntries(visibleCommunity.value)))

// The feed and the map see the exact same slice. Applying the filters HERE
// (once) instead of inside each view keeps them permanently in lock-step:
// picking a tag in the map chips updates the feed instantly, and vice versa.
const filteredForFeed = computed(() =>
  visibleCommunity.value.filter((e) => {
    if (selectedCities.value.length && !selectedCities.value.includes(e.city)) return false
    if (selectedTags.value.length && !(e.tags || []).some((t) => selectedTags.value.includes(t))) return false
    return true
  }),
)

function onClearFilters() {
  selectedCities.value = []
  selectedTags.value = []
}

const myComments = computed(() => {
  void commentsVersion.value
  void deletedComments.value
  const id = getDeviceId()
  const out = []
  for (const e of visibleAll.value) {
    if (!Array.isArray(e.comments)) continue
    for (const c of e.comments) {
      if (c && c.deviceId === id) out.push({ ...c, entryId: e.id, _local: false })
    }
  }
  for (const c of loadPendingComments()) {
    if (c && c.deviceId === id) out.push({ ...c, _local: true })
  }
  return out
    .filter((c) => !isCommentDeleted(c.id))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
})

function onFilterByTag(tag) {
  selectedTags.value = [tag]
  replaceRoute('map')
  detail.value = null
  hubFilterOpen.value = false
}

async function refresh() {
  loadErr.value = ''
  try {
    const { entries: fresh, index, loadedShards } = await loadFeed()
    entries.value = mergeKeepingLoaded(entries.value, fresh, index, loadedShards)
    rebuildCountsFromServer()
  } catch (e) {
    loadErr.value = e.message
  }
}

function rebuildCountsFromServer() {
  const id = getDeviceId()
  const full = dedupeEntries(entries.value)
  if (feedIndex.value && Array.isArray(feedIndex.value.shards) && feedIndex.value.shards.length > 1) {
    loadAllShards({ index: feedIndex.value, loadedShards: Array.from(loadedShardSet.value || []), entries: full })
      .then((all) => rebuildFromCorpus(all, id))
      .catch(() => rebuildFromCorpus(full, id))
    return
  }
  rebuildFromCorpus(full, id)
}

function dedupeEntries(list) {
  const seen = new Set()
  return list.filter((e) => e && (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

function rebuildFromCorpus(corpus, id) {
  const uploads = rebuildUploadsToday(corpus, id)
  const comments = rebuildCommentsToday(corpus, id)
  while (uploadsToday() < uploads) recordUpload()
  while (commentsToday() < comments) recordComment()
  window.dispatchEvent(new CustomEvent('gc-counts-rebuilt'))
}

let silentInFlight = false
async function silentFetch() {
  if (document.hidden || silentInFlight || pullRefresh.refreshing.value) return
  silentInFlight = true
  try {
    const { entries: fresh, index, loadedShards } = await loadFeed()
    entries.value = mergeKeepingLoaded(entries.value, fresh, index, loadedShards)
    rebuildCountsFromServer()
  } catch {
    /* keep last good state; stay quiet */
  } finally {
    silentInFlight = false
  }
}

function mergeKeepingLoaded(current, fresh, index, loadedShards) {
  const freshIds = new Set(fresh.map((e) => e.id))
  const loadedFiles = new Set(Array.isArray(loadedShards) ? loadedShards : ['data.json'])
  loadedShardSet.value = loadedFiles
  feedIndex.value = index || null

  const loadedIds = new Set(freshIds)
  if (index && Array.isArray(index.shards)) {
    for (const shard of index.shards) {
      if (!loadedFiles.has(shard.file)) continue
      for (const e of fresh) loadedIds.add(e.id)
    }
  }

  prunePending([...freshIds])
  prunePendingComments(fresh)
  pruneDeleted([...loadedIds])
  pruneDeletedComments(fresh)
  pruneVisibilityOverrides(fresh)
  const locals = current.filter((e) => e._local && !freshIds.has(e.id) && !isDeleted(e.id))
  const freshIdSet = new Set(fresh.map((e) => e.id))
  const carriedOver = current.filter((e) => !e._local && !freshIdSet.has(e.id) && !isDeleted(e.id))
  return [...locals, ...fresh, ...carriedOver]
}

const pullRefresh = usePullRefresh(refresh)
const loadingForView = computed(() => loading.value || pullRefresh.refreshing.value)
const pull = pullRefresh.pull

function onPullRefresh() {
  pullRefresh.fire()
}

function onSubmitted(entry) {
  entries.value = [entry, ...entries.value]
  addPending(entry)
}

function onSubmitFailed(id) {
  entries.value = entries.value.filter((e) => !(e._local && e.id === id))
  removePending(id)
}

const storageFull = ref(false)
function onStorageFull() {
  storageFull.value = true
}

function onOutboxSynced(e) {
  const { kind, payload } = e.detail || {}
  if (kind !== 'entry' || !payload || !payload.id) return
  const rawUrls = (payload.images || []).map((_, i) =>
    payload.images.length === 1
      ? `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.dataBranch}/images/${payload.id}.${payload.images[0].ext || 'jpg'}`
      : `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.dataBranch}/images/${payload.id}-${i}.${payload.images[i].ext || 'jpg'}`,
  )
  entries.value = entries.value.map((en) =>
    en._local && en.id === payload.id
      ? { ...en, image: rawUrls[0] || en.image, images: rawUrls.length ? rawUrls : en.images }
      : en,
  )
  const pending = loadPending().map((en) =>
    en.id === payload.id
      ? { ...en, image: rawUrls[0] || en.image, images: rawUrls.length ? rawUrls : en.images }
      : en,
  )
  savePending(pending)
}

function onOutboxDiscarded(e) {
  const { kind, payload } = e.detail || {}
  if (kind === 'entry' && payload?.id) {
    entries.value = entries.value.filter((en) => !(en._local && en.id === payload.id))
    removePending(payload.id)
  } else if (kind === 'comment' && payload?.comment?.id) {
    removePendingComment(payload.comment.id)
    commentsVersion.value++
  }
}

import { imageSrc } from './lib/images.js'
// Preview card: a mini strip floating above the hub when a marker is tapped
// on the map. Tapping the mini strip opens the full DetailView. Dismisses on
// hub interactions / nearby toggle / any overlay open.
const previewEntry = ref(null)
function onPreviewEntry(entry) {
  previewEntry.value = entry
}
function previewSrc(entry) {
  return imageSrc(entry)
}
function onOpenPreview() {
  if (!previewEntry.value) return
  openDetail(previewEntry.value)
  previewEntry.value = null
}
watch([detail, () => route.name], () => {
  previewEntry.value = null
})

const mineViewRef = ref(null)
function onOpenQueue() {
  replaceRoute('mine')
  setTimeout(() => {
    mineViewRef.value?.queueEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, 60)
}

function onCommentsChanged() {
  commentsVersion.value++
}

function onDeleted(id) {
  addDeleted(id)
  removePending(id)
  const orphans = loadPendingComments().filter((c) => c && c.entryId === id)
  if (orphans.length) {
    for (const c of orphans) removePendingComment(c.id)
    window.dispatchEvent(new CustomEvent('gc-comments-changed'))
  }
}

function onCommentDeleted(id) {
  addDeletedComment(id)
  removePendingComment(id)
  commentsVersion.value++
}

// ---- Hub actions -----------------------------------------------------------
const searchCenter = ref(null)

function onHubUpload() {
  uploadPrefill.value = null
  modalOpen.value = true
}

// Cross-view hook (DetailView's 我也在这打卡过): pre-fill + open in one tick.
const uploadPrefill = ref(null)
function onOpenUpload(e) {
  uploadPrefill.value = e.detail || null
  modalOpen.value = true
}
function onHubFeed() {
  replaceRoute('feed')
}
function onHubMine() {
  replaceRoute('mine')
}
function onHubRefresh() {
  refresh()
}
function onSearchGo(pos) {
  searchCenter.value = pos
}
onMounted(async () => {
  initRoute()
  loading.value = true
  try {
    const pending = loadPending()
    const { entries: server, index, loadedShards } = await loadFeed()
    const serverIds = new Set(server.map((e) => e.id))
    const stillPending = pending.filter((e) => !serverIds.has(e.id))
    if (stillPending.length !== pending.length) prunePending([...serverIds])
    entries.value = mergeKeepingLoaded(stillPending, server, index, loadedShards)
    rebuildCountsFromServer()
  } catch (e) {
    loadErr.value = e.message
  } finally {
    loading.value = false
    routeReady.value = true
    if (route.name === 'entry' && entryForRoute.value) detail.value = entryForRoute.value
  }
  autoTimer = setInterval(silentFetch, AUTO_REFRESH_MS)
  window.addEventListener('gc-comments-changed', onCommentsChanged)
  window.addEventListener('gc-storage-full', onStorageFull)
  window.addEventListener('gc-outbox-synced', onOutboxSynced)
  window.addEventListener('gc-outbox-discarded', onOutboxDiscarded)
  window.addEventListener('gc-open-upload', onOpenUpload)
})

onBeforeUnmount(() => {
  clearInterval(autoTimer)
  if (offlineTimer.value) clearTimeout(offlineTimer.value)
  window.removeEventListener('gc-comments-changed', onCommentsChanged)
  window.removeEventListener('gc-storage-full', onStorageFull)
  window.removeEventListener('gc-outbox-synced', onOutboxSynced)
  window.removeEventListener('gc-outbox-discarded', onOutboxDiscarded)
  window.removeEventListener('gc-open-upload', onOpenUpload)
})
</script>

<template>
  <div class="min-h-full app-gradient relative">
    <!-- Map canvas: the root canvas, always mounted once -->
    <ExploreView
      key="explore"
      :entries="filteredForFeed"
      :all-entries="visibleCommunity"
      :selectedCities="selectedCities"
      :selectedTags="selectedTags"
      :searchCenter="searchCenter"
      @open-entry="openDetail"
      @preview-entry="onPreviewEntry"
    />

    <!-- Top chrome: search + mine entry (hidden while detail/mine open) -->
    <MapSearchBar
      v-show="!detail && !isMine"
      :entries="visibleCommunity"
      v-model:selectedCities="selectedCities"
      v-model:selectedTags="selectedTags"
      v-model:filterOpen="filterOpen"
      @search-go="onSearchGo"
    />

    <!-- Hub: right-edge "+" -->
    <UploadHub
      v-show="isMap"
      @upload="onHubUpload"
      @refresh="onHubRefresh"
      @feed="onHubFeed"
      @mine="onHubMine"
    />

    <!-- Overlays ---------------------------------------------------------->

    <!-- Feed overlay. Back is a floating pill at bottom-left (thumb zone,
         no chrome strip), so the feed grid runs edge-to-edge. -->
    <Transition name="view-fade">
      <div v-if="isFeed" key="feed" class="fixed inset-0 z-40 bg-slate-50 overflow-y-auto" style="padding-top: max(env(safe-area-inset-top), 0px); overscroll-behavior: contain">
        <div class="max-w-5xl mx-auto px-4 pt-3 pb-24">
          <CommunityView
            :entries="filteredForFeed"
            :all-entries="visibleCommunity"
            :loading="loadingForView"
            :pull="pull"
            :selectedCities="selectedCities"
            :selectedTags="selectedTags"
            :hasMore="hasMore"
            @open="openDetail"
            @refresh="onPullRefresh"
            @load-more="loadMore"
            @clear-filters="onClearFilters"
            @update:selectedCities="selectedCities = $event"
            @update:selectedTags="selectedTags = $event"
          />
        </div>
        <button
          @click="replaceRoute('map')"
          aria-label="返回地图"
          class="fixed bottom-6 left-4 z-50 rounded-full pl-2.5 pr-4 py-2.5 shadow-lg shadow-accent/30 flex items-center gap-1.5 text-sm font-medium text-white transition active:scale-95 bg-gradient-to-r from-accent to-accent-2 ring-1 ring-white/40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M15 18l-6-6 6-6"/></svg>
          地图
        </button>
      </div>
    </Transition>

    <!-- Mine overlay: no in-page title — the identity card inside MineView
         already carries the user's name prominently. Back is the same
         floating pill as Feed. -->
    <Transition name="view-fade">
      <div v-if="isMine" key="mine" class="fixed inset-0 z-40 bg-slate-50 overflow-y-auto" style="padding-top: max(env(safe-area-inset-top), 0px); overscroll-behavior: contain">
        <div class="max-w-5xl mx-auto px-4 pt-3 pb-24">
          <MineView
            ref="mineViewRef"
            :entries="visibleAll"
            :myComments="myComments"
            @open="openDetail"
            @deleted="onDeleted"
            @comment-deleted="onCommentDeleted"
          />
        </div>
        <button
          @click="replaceRoute('map')"
          aria-label="返回地图"
          class="fixed bottom-6 left-4 z-50 rounded-full pl-2.5 pr-4 py-2.5 shadow-lg shadow-accent/30 flex items-center gap-1.5 text-sm font-medium text-white transition active:scale-95 bg-gradient-to-r from-accent to-accent-2 ring-1 ring-white/40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M15 18l-6-6 6-6"/></svg>
          地图
        </button>
      </div>
    </Transition>

    <!-- Detail overlay -->
    <Transition name="view-fade">
      <div v-if="detail" key="detail" class="fixed inset-0 z-40 app-gradient overflow-y-auto" style="overscroll-behavior: contain">
        <div class="max-w-3xl mx-auto px-4 pb-24">
          <DetailView :entry="detail" @close="closeDetail" @filter-by-tag="onFilterByTag" />
        </div>
      </div>
    </Transition>

    <!-- Deep-link not found -->
    <Transition name="view-fade">
      <div v-if="routeEntryMissing" key="missing" class="fixed inset-0 z-40 app-gradient flex items-center justify-center">
        <div class="text-center max-w-sm px-6">
          <p class="font-serif text-xl text-mist-text mb-2">条目不存在或尚未同步</p>
          <p class="text-sm text-mist-muted mb-6">可能已被作者删除、转为私密，或正在等待同步。</p>
          <button
            @click="replaceRoute('map')"
            class="rounded-xl bg-gradient-to-r from-rose-soft to-rose-glow px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:brightness-110"
          >回到地图</button>
        </div>
      </div>
    </Transition>

    <!-- Chrome always on top -->
    <SyncChip v-show="isMap" @open-queue="onOpenQueue" />

    <!-- Bottom preview strip: the tapped marker's card before the user commits
         to the full detail. Tap = open detail; close ✕ dismisses. -->
    <Transition name="view-fade">
      <div
        v-if="previewEntry && isMap"
        class="fixed inset-x-0 bottom-24 z-30 flex justify-center px-4 pointer-events-none"
      >
        <div class="glass-strong rounded-2xl p-3 flex items-start gap-3 shadow-xl max-w-sm w-full ring-1 ring-white/60 pointer-events-auto">
          <button @click="onOpenPreview" class="flex items-center gap-3 min-w-0 flex-1 text-left active:scale-[0.99] transition">
            <img
              :src="previewSrc(previewEntry)"
              :alt="previewEntry.city || '记录'"
              class="w-16 h-16 rounded-xl object-cover bg-mist-800/40 shrink-0"
            />
            <div class="min-w-0 flex-1">
              <p class="font-serif text-sm text-mist-text line-clamp-1">
                {{ previewEntry.city || '未命名' }}
                <span v-if="previewEntry.mood" class="text-mist-muted/70"> · {{ previewEntry.mood }}</span>
              </p>
              <p class="text-xs text-mist-muted line-clamp-2 mt-0.5">{{ previewEntry.description }}</p>
            </div>
          </button>
          <CloseButton aria-label="关闭预览" variant="light" class="!w-9 !h-9 !text-base" @close="previewEntry = null" />
        </div>
      </div>
    </Transition>

    <Toast />

    <!-- Upload sheet -->
    <UploadSheet
      v-model:open="modalOpen"
      :existingTags="tagsFromEntries(visibleCommunity)"
      :initialLocation="uploadPrefill"
      :initialTags="uploadPrefill?.tags || []"
      @submitted="onSubmitted"
      @submit-failed="onSubmitFailed"
    />

    <!-- localStorage quota banner -->
    <Transition name="view-fade">
      <div v-if="storageFull" class="fixed inset-x-0 top-2 flex justify-center px-4 z-[60] pointer-events-none">
        <div class="glass-strong rounded-2xl px-4 py-2 text-xs text-mist-muted shadow-lg flex items-center gap-2 pointer-events-auto">
          本地存储已满，同步状态可能在刷新后丢失
          <button class="text-accent font-medium" @click="storageFull = false">知道了</button>
        </div>
      </div>
    </Transition>

    <!-- PWA update toast -->
    <Transition name="view-fade">
      <div v-if="needRefresh || offlineReady" class="fixed inset-x-0 bottom-20 flex justify-center px-4 z-50 pointer-events-none">
        <button
          v-if="needRefresh"
          @click="applyUpdate"
          class="glass-strong rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-accent shadow-lg pointer-events-auto hover:brightness-105"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-accent animate-pulse"></span>
          内容已更新 · 刷新查看
        </button>
        <div v-else class="glass-strong rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-mist-text shadow-lg">
          <span class="inline-block w-2 h-2 rounded-full bg-accent"></span>
          已可离线使用
        </div>
      </div>
    </Transition>
  </div>
</template>
