// Map-first Explore canvas: the root view of the app once the redesign lands.
//
// Single AMap instance for the app's lifetime (mounted in App.vue's layout).
// All other screens (#/feed, #/mine, #/entry/:id) are overlays on top of this
// map; hash routing + App.vue own what's visible, we just host the canvas and
// the marker/preview choreography.
//
// Three zoom tiers:
//   zoom ≤ CITY_TILL:    city photo bubbles (groupBy city → centroid + count)
//   CITY_TILL < zoom < PIN_FROM:  small dot markers (viewport-culled ≤300)
//   zoom ≥ PIN_FROM:     44px photo pins for everything in view
// Tiers are data-driven from the same markersById diff cache — rebuilds only
// happen on tier crossings or map/entry deltas, never on scroll.

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadAMap } from '../lib/amap.js'
import { entriesWithCoords } from '../lib/geo.js'
import { listSrc } from '../lib/images.js'
import { pushToast } from '../lib/toast.js'
import { visited } from '../lib/visited.js'

const CITY_TILL = 9
const PIN_FROM = 14
const VIEWPORT_CAP = 300

const props = defineProps({
  // `entries` is ALREADY filtered upstream (App.vue's filteredForFeed), so
  // marker/bubble layers and the preview strip all see the same slice as the
  // feed grid. `allEntries` is the unfiltered corpus used ONLY for computing
  // city-bubble centroids + counts — if you filtered it down, deselecting
  // the last city would make the bubble vanish and you'd lose the way back.
  entries: { type: Array, default: () => [] },
  allEntries: { type: Array, default: () => [] },
  selectedCities: { type: Array, default: () => [] },
  selectedTags: { type: Array, default: () => [] },
  searchCenter: { type: Object, default: null },
})
const emit = defineEmits(['open-entry', 'preview-entry'])

const mapEl = ref(null)
const loading = ref(true)
const mapErr = ref('')
const zoom = ref(5)
const centeredOn = ref(null)

let map = null
let AMap = null
let markersById = new Map() // entry.id -> AMap.Marker
let bubbleMarkers = new Map() // city -> AMap.Marker
let searchMarker = null
let visitedMarkers = new Map() // visited.id -> AMap.Marker (personal pins)

// `entries` arrives already filtered (city+tag) by App.vue — we just keep the
// ones with coordinates. Internal filtering here used to duplicate the work
// and make feed-vs-map drift possible; now the map is a pure projection of
// the same slice the feed shows.
const visible = computed(() => entriesWithCoords(props.entries))

// City bubbles: for zoom ≤ CITY_TILL we never render individual markers, only
// one bubble per city with the count + first entry's thumb as face. Computed
// from the FULL corpus (allEntries) — if we bubbled `entries` (filtered),
// selecting one city would erase every other city's bubble and the map would
// feel empty even though the data is still there.
const cityBubbles = computed(() => {
  const map = new Map() // city -> {count, sumLat, sumLng, thumbId}
  for (const e of entriesWithCoords(props.allEntries)) {
    const key = e.city || '未命名'
    const cur = map.get(key) || { count: 0, sumLat: 0, sumLng: 0, thumbEntry: null }
    cur.count++
    cur.sumLat += Number(e.lat)
    cur.sumLng += Number(e.lng)
    if (!cur.thumbEntry) cur.thumbEntry = e // first is enough; canvas only needs one face
    map.set(key, cur)
  }
  return [...map.entries()].map(([city, s]) => ({
    city,
    count: s.count,
    lat: s.sumLat / s.count,
    lng: s.sumLng / s.count,
    thumbEntry: s.thumbEntry,
  }))
})

const inCityTier = computed(() => zoom.value <= CITY_TILL)
const inPinTier = computed(() => zoom.value >= PIN_FROM)
const tier = computed(() => (inCityTier.value ? 'city' : inPinTier.value ? 'pin' : 'dot'))

function makeDotContent() {
  const el = document.createElement('div')
  el.className = 'gc-marker'
  return el
}

function makePinContent(entry) {
  const el = document.createElement('div')
  el.className = 'gc-pin'
  const img = document.createElement('img')
  img.src = listSrc(entry)
  img.alt = ''
  img.loading = 'lazy'
  el.appendChild(img)
  return el
}

function makeBubbleContent(city, count, thumbEntry) {
  const el = document.createElement('div')
  el.className = 'gc-bubble'
  const img = document.createElement('img')
  img.src = listSrc(thumbEntry)
  img.alt = city
  img.loading = 'lazy'
  el.appendChild(img)
  const badge = document.createElement('span')
  badge.className = 'gc-bubble-badge'
  badge.textContent = count > 99 ? '99+' : String(count)
  el.appendChild(badge)
  const name = document.createElement('span')
  name.className = 'gc-bubble-name'
  name.textContent = city
  el.appendChild(name)
  return el
}

function markerForEntry(entry) {
  let marker = markersById.get(entry.id)
  if (marker) return marker
  marker = new AMap.Marker({
    position: [Number(entry.lng), Number(entry.lat)],
    content: tier.value === 'pin' ? makePinContent(entry) : makeDotContent(),
    offset: new AMap.Pixel(tier.value === 'pin' ? -22 : -11, tier.value === 'pin' ? -22 : -11),
    anchor: 'center',
    zIndex: tier.value === 'pin' ? 20 : 10,
  })
  marker.on('click', () => onMarkerClick(entry))
  markersById.set(entry.id, marker)
  return marker
}

function onMarkerClick(entry) {
  // Marker tap → center the map on it, pop preview; the sheet shows the same
  // entry list ranking. In pin tier the click is the final tap before detail.
  map.setCenter([Number(entry.lng), Number(entry.lat)], false, 180)
  emit('preview-entry', entry)
}

function bubbleForCity(b) {
  let marker = bubbleMarkers.get(b.city)
  if (marker) {
    marker.setPosition([b.lng, b.lat])
    marker.setContent(makeBubbleContent(b.city, b.count, b.thumbEntry))
    return marker
  }
  marker = new AMap.Marker({
    position: [b.lng, b.lat],
    content: makeBubbleContent(b.city, b.count, b.thumbEntry),
    offset: new AMap.Pixel(-28, -28),
    anchor: 'center',
    zIndex: 30,
  })
  marker.on('click', () => {
    zoom.value = 12
    map.setZoomAndCenter(12, [b.lng, b.lat], false, 260)
  })
  bubbleMarkers.set(b.city, marker)
  return marker
}

// Sync the wanted-tier markers with what's actually on the map.
function syncMap() {
  if (!map || !AMap) return
  if (inCityTier.value) {
    // City tier: bubbles shown, everything else removed.
    syncBubbles()
    syncEntriesMarkers(false)
    return
  }
  syncBubbles(false)
  syncEntriesMarkers(true)
}

function syncBubbles(show = true) {
  if (!show) {
    for (const marker of bubbleMarkers.values()) marker.setMap(null)
    return
  }
  const wantedKeys = new Set(cityBubbles.value.map((b) => b.city))
  for (const [city, marker] of bubbleMarkers) {
    if (!wantedKeys.has(city)) {
      marker.setMap(null)
      bubbleMarkers.delete(city)
    }
  }
  for (const b of cityBubbles.value) {
    bubbleForCity(b).setMap(map)
  }
}

function syncEntriesMarkers(show = true) {
  if (!show) {
    for (const marker of markersById.values()) marker.setMap(null)
    return
  }
  const wantedIds = new Set(visible.value.map((e) => e.id))
  // Remove markers for out-of-filter entries
  for (const [id, marker] of markersById) {
    if (!wantedIds.has(id)) {
      marker.setMap(null)
      markersById.delete(id)
    }
  }
  // Upgrade content on tier flip (re-stamp every marker in viewport)
  const zoomChangedToPins = inPinTier.value
  for (const entry of visible.value.slice(0, VIEWPORT_CAP)) {
    const marker = markerForEntry(entry)
    // Re-set content if we changed tier
    if (zoomChangedToPins) {
      marker.setContent(makePinContent(entry))
      marker.setOffset(new AMap.Pixel(-22, -22))
      marker.setzIndex(20)
    } else {
      marker.setContent(makeDotContent())
      marker.setOffset(new AMap.Pixel(-11, -11))
      marker.setzIndex(10)
    }
    marker.setMap(map)
  }
}

function onZoomEnd() {
  const z = map.getZoom()
  if (z !== zoom.value) {
    zoom.value = z
    syncMap()
  }
}

function onMoveEnd() {
  // In pin/dot tier, re-cull on pan. In city tier, nothing to cull.
  if (inCityTier.value) return
  syncMap()
}

// React to the "I've been here" check-ins changing: they carry their own
// marker layer (separate from the community markers).
watch(visited, syncVisitedPins, { deep: true })

// ---- Personal visited pins (我 去过这里) -----------------------------------
// One small accent-ish pin per visited place. They show at every zoom tier
// (unlike the community pins which tier-swap dots→photos) so the user's own
// travels are always visible.
function makeVisitedContent() {
  const el = document.createElement('div')
  el.className = 'gc-visited'
  el.title = '我去过这里'
  return el
}

function syncVisitedPins() {
  if (!map || !AMap) {
    for (const marker of visitedMarkers.values()) marker.setMap(null)
    visitedMarkers.clear()
    return
  }
  const wanted = new Map(visited.value.map((v) => [v.id, v]))
  // Remove stale pins
  for (const [id, marker] of visitedMarkers) {
    if (!wanted.has(id)) {
      marker.setMap(null)
      visitedMarkers.delete(id)
    }
  }
  // Add/update needed pins
  for (const [id, v] of wanted) {
    let marker = visitedMarkers.get(id)
    if (!marker) {
      marker = new AMap.Marker({
        position: [Number(v.lng), Number(v.lat)],
        content: makeVisitedContent(),
        offset: new AMap.Pixel(-8, -8),
        anchor: 'center',
        zIndex: 40,
      })
      marker.on('click', () => {
        pushToast(`你在这儿的 ${v.city || '这个地方'} 留下过脚印`, { type: 'success' })
      })
      visitedMarkers.set(id, marker)
    } else {
      marker.setPosition([Number(v.lng), Number(v.lat)])
    }
    marker.setMap(map)
  }
}

// ---- Geolocation (startup locate + manual locate button) -----------------
// `locate()` is the single geolocation path shared by the auto-locate-at-boot
// and the top-right 📍 button. We deliberately do NOT enable 高德's follow-mode:
// continuous tracking pings GPS every few seconds, and this app is for
// LOOKING at other people's records most of the time, not navigating.
async function locate() {
  if (!AMap) throw new Error('地图未就绪')
  return new Promise((resolve, reject) => {
    const geolocation = new AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: 8000,
      showButton: false,
      showMarker: false,
      showCircle: false,
    })
    geolocation.getCurrentPosition((status, result) => {
      if (status === 'complete' && result && result.position) {
        resolve({ lng: result.position.lng, lat: result.position.lat })
      } else {
        reject(new Error((result && result.message) || '定位失败'))
      }
    })
  })
}

async function initMap() {
  loading.value = true
  mapErr.value = ''
  try {
    AMap = await loadAMap()
  } catch (e) {
    mapErr.value =
      e && e.message === 'AMAP_KEY_NOT_CONFIGURED'
        ? '' // no key = fall back to static list layout below
        : '地图加载失败'
    loading.value = false
    return
  }
  try {
    map = new AMap.Map(mapEl.value, { zoom: zoom.value, center: [105, 35], resizeEnable: true })
    map.on('zoomend', onZoomEnd)
    map.on('moveend', onMoveEnd)
  } catch (e) {
    mapErr.value = `地图初始化失败${e && e.message ? ': ' + e.message : ''}`
    loading.value = false
    return
  }
  syncMap()
  syncVisitedPins()
  // Debug: surface the state at boot to help diagnose "map blank" reports.
  console.debug('[proxima] map ready, visible entries =', visible.value.length, 'markers =', markersById.size)

  // Startup centering:
  //  1. default = user's current location (silently, if permission was
  //     previously granted — first visit still stays at the country view and
  //     waits for a manual tap on the locate button).
  //  2. fallback = fit all visible entries (if permission denied or GPS fails).
  // We only auto-locate ONCE at boot; we do NOT continuously track because
  // 高德 follow-mode would ping the GPS every few seconds and drain battery
  // even while the user is just looking at someone else's posts.
  if (visible.value.length) map.setFitView(null, false, [80, 80, 80, 80], 14)
  loading.value = false
  tryAutoLocate()
}

let didStartupLocate = false
let meMarker = null
async function tryAutoLocate() {
  if (didStartupLocate) return
  didStartupLocate = true
  // AMap Geolocation defaults to HIGH accuracy, which is precise but slow; we
  // don't need that for a "show me a rough neighbourhood" boot. 8000ms timeout
  // matches the manual locate button downstream.
  try {
    const pos = await locate()
    meMarker = new AMap.Marker({
      position: [pos.lng, pos.lat],
      content: '<div class="gc-marker-me"></div>',
      offset: new AMap.Pixel(-10, -10),
      anchor: 'center',
      zIndex: 70,
    })
    meMarker.setMap(map)
    // Recenter without zooming all the way in — the user can still see the
    // neighbourhood bubbles they started with, just now centred on them.
    map.setZoomAndCenter(Math.max(zoom.value, 11), [pos.lng, pos.lat], false, 400)
  } catch {
    /* silent: stays on last-good view. Manual 📍 button is always available. */
  }
}

// Manual locate-button (map UI, separate from the removed hub's 附近 menu).
// Kept for the "I'm here RIGHT NOW" case; same locate path as auto-startup.
async function onLocateTap() {
  try {
    const pos = await locate()
    if (meMarker) {
      meMarker.setPosition([pos.lng, pos.lat])
    } else {
      meMarker = new AMap.Marker({
        position: [pos.lng, pos.lat],
        content: '<div class="gc-marker-me"></div>',
        offset: new AMap.Pixel(-10, -10),
        anchor: 'center',
        zIndex: 70,
      })
      meMarker.setMap(map)
    }
    map.setZoomAndCenter(15, [pos.lng, pos.lat], false, 300)
  } catch (e) {
    pushToast('定位失败，无法获取当前位置', { type: 'error' })
  }
}

// Search-bar "go to" support: when searchCenter pin is set, pan there and
// drop a temporary marker. External code sets searchCenter; we clear it after
// a moment so a copy-paste of the same link doesn't re-fire.
watch(
  () => props.searchCenter,
  (pos) => {
    if (!pos || !map || !AMap) return
    map.setZoomAndCenter(Math.max(zoom.value, 12), [pos.lng, pos.lat], false, 260)
    if (searchMarker) searchMarker.setMap(null)
    searchMarker = new AMap.Marker({
      position: [pos.lng, pos.lat],
      content: '<div class="gc-marker-glow"></div>',
      offset: new AMap.Pixel(-11, -11),
      anchor: 'center',
      zIndex: 60,
    })
    searchMarker.setMap(map)
    setTimeout(() => {
      if (searchMarker) {
        searchMarker.setMap(null)
        searchMarker = null
      }
    }, 3000)
  },
)

// First meaningful dataset: zoom the map to fit all markers once. (When the
// app boots we have no entries yet — the initial setFitView call in initMap
// sees an empty list. This watcher fires the first time real data arrives.)
let didInitialFit = false
watch(visible, (list) => {
  if (!didInitialFit && list.length) {
    didInitialFit = true
    if (map) map.setFitView(null, false, [80, 80, 80, 80], 14)
  }
})

// When upstream entries merge (silentFetch, optimistic _local, outbox sync),
// refresh markers. In city tier, bubbles re-render; in marker tiers, new ids
// get drunk with a drop animation on first arrival.
watch(
  () => props.entries,
  () => {
    const newIdsBefore = new Set(markersById.keys())
    syncMap()
    if (!inCityTier.value) {
      let fired = 0
      for (const [id, marker] of markersById) {
        if (!newIdsBefore.has(id) && fired < 12) {
          marker.setAnimation('AMAP_ANIMATION_DROP')
          fired++
        }
      }
    }
  },
)

onMounted(initMap)
onBeforeUnmount(() => {
  if (map) {
    map.destroy()
    map = null
  }
  markersById.clear()
  bubbleMarkers.clear()
})
</script>

<template>
  <div class="explore-canvas absolute inset-0">
    <div ref="mapEl" class="absolute inset-0"></div>
<div v-if="loading" class="absolute inset-0 flex items-center justify-center text-sm text-mist-muted">地图加载中…</div>
    <div v-else-if="mapErr" class="absolute inset-0 flex items-center justify-center text-sm text-mist-muted px-6 text-center">{{ mapErr }}</div>

    <!-- No-AMap development preview (VITE_AMAP_KEY not set): show a list of
         recent public records so the app is still usable for styling work.
         The production bundle always has a key, so this branch is dev-only. -->
    <div v-else-if="!map && !mapErr" class="absolute inset-0 overflow-y-auto bg-slate-50 p-4 space-y-3">
      <p class="text-xs text-mist-muted bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
        开发环境未配置 VITE_AMAP_KEY，当前显示静态列表。生产部署会自动加载高德地图。
      </p>
      <div v-for="e in visible.slice(0, 30)" :key="e.id" class="glass rounded-2xl p-3 flex gap-3">
        <img :src="listSrc(e)" class="w-14 h-14 rounded-xl object-cover shrink-0" alt="" />
        <div class="min-w-0 text-sm">
          <p class="font-serif text-mist-text line-clamp-1">{{ e.city || '未命名' }}</p>
          <p class="text-xs text-mist-muted line-clamp-2 mt-0.5">{{ e.description }}</p>
        </div>
        <button @click="emit('preview-entry', e)" class="ml-auto text-xs text-accent shrink-0 self-center">查看</button>
      </div>
    </div>

    <!-- Locate-me FAB: top-right, vertically centered against the search bar. -->
    <button
      v-if="!loading && !mapErr"
      @click="onLocateTap"
      aria-label="定位到我的位置"
      class="absolute top-20 right-4 z-20 w-11 h-11 rounded-full glass-strong shadow-lg flex items-center justify-center text-mist-muted hover:text-accent transition active:scale-90"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
        <circle cx="12" cy="12" r="8" stroke-dasharray="1.5 2"/>
      </svg>
    </button>
  </div>
</template>

<style>
/* Three-tier marker aesthetics. Global because AMap clones content nodes. */

/* dot (mid-zoom): a small soft gradient disc, no image. */
.gc-marker {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #0ea5b7, #2563eb);
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 4px rgba(15, 42, 58, 0.3);
}

/* photo pin (close-up): 44px round thumb with soft ring. */
.gc-pin {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  overflow: hidden;
  border: 2.5px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 6px rgba(15, 42, 58, 0.35);
  background: #dfeaf3;
  transition: transform 0.15s ease;
}
.gc-pin img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gc-pin:hover {
  transform: scale(1.12);
  z-index: 50 !important;
}

/* city bubble (far zoom): 56px round photo + count badge + name pill. */
.gc-bubble {
  position: relative;
  width: 56px;
  height: 56px;
}
.gc-bubble img {
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  object-fit: cover;
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 8px rgba(15, 42, 58, 0.35);
  display: block;
}
.gc-bubble-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  padding: 0 6px;
  border-radius: 9999px;
  background: linear-gradient(90deg, #0ea5b7, #2563eb);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  font-family: ui-sans-serif, system-ui;
}
.gc-bubble-name {
  position: absolute;
  bottom: -20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  color: #1e3a52;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(15, 42, 58, 0.15);
}

/* Locate-me marker: a dot with a soft halo, permanently visible at the
   user's location once known, slightly larger than regular entry dots so it
   doesn't disappear in the crowd. */
.gc-marker-me {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #0ea5b7, #2563eb);
  border: 3px solid rgba(255, 255, 255, 0.95);
  box-shadow:
    0 0 0 6px rgba(14, 165, 183, 0.18),
    0 2px 8px rgba(15, 42, 58, 0.4);
}

/* Personal "I've been here" pins: punchy coral dot, small but unmistakable.
   Intentionally distinct from community pins (cyan/blue) so the user sees
   their own travels at a glance. */
.gc-visited {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: linear-gradient(135deg, #f43f5e, #f97316);
  border: 2.5px solid rgba(255, 255, 255, 0.95);
  box-shadow:
    0 0 0 4px rgba(244, 63, 94, 0.18),
    0 1px 4px rgba(15, 42, 58, 0.35);
  transition: transform 0.15s ease;
}
.gc-visited:hover {
  transform: scale(1.2);
}

/* Search target pulse. */
.gc-marker-glow {
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(14, 165, 183, 0.9) 30%, rgba(14, 165, 183, 0) 70%);
  animation: glow-pulse 1.2s ease-out infinite;
}
@keyframes glow-pulse {
  from {
    transform: scale(0.8);
    opacity: 1;
  }
  to {
    transform: scale(2);
    opacity: 0;
  }
}
</style>
