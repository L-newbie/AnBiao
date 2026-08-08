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
import { getDeviceId } from '../lib/device.js'
import { entriesWithCoords } from '../lib/geo.js'
import { listSrc } from '../lib/images.js'
import { pushToast } from '../lib/toast.js'
import { visited } from '../lib/visited.js'

const myDeviceId = getDeviceId()
const isMine = (e) => e && e.deviceId === myDeviceId

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
const zoom = ref(4) // 4 = 全国 (show all of China in tilted 3D at boot)
const showHomeBtn = computed(() => zoom.value > CITY_TILL)

// ---- Right panel state -------------------------------------------------
// panelMode: 'cities' (全国视图,城市列表) or 'entries' (城市视图,记录列表)
// 面板根据 zoom 自动切换,不需要手动点,但 enterCity/exitCityPanel 提供
// 显式入口(点列表项 / 点"← 城市"按钮)。
const panelMode = ref('cities')
const panelCity = ref('') // 城市视图下面板标题(当前城市名)
const activeCity = ref('') // 记录哪个 bubble 被点过(用于列表高亮)
const activeEntryId = ref(null) // 当前聚焦的 entry (用于 flyTo 高亮)
const panelCollapsed = ref(false) // 用户手动折叠整个面板,看地图不被挡
let activeGlowMarker = null // flyTo 时打的高亮 marker

const entryCount = computed(() => visible.value.length)
const cityEntries = computed(() => {
  if (panelMode.value !== 'entries' || !panelCity.value) return []
  return visible.value
    .filter((e) => (e.city || '未命名') === panelCity.value)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
})

function backToCountry() {
  console.debug('[proxima] backToCountry — zoom', zoom.value, '→', 4)
  exitCityPanel() // 面板先回城市列表(即使 map 未就绪也要做)
  panelCollapsed.value = false // 顺手展开,让用户看到城市列表
  if (!map) return
  zoom.value = 4
  map.setZoomAndCenter(4, [105, 35], false, 450)
  syncMap()
}

// ---- 城市/记录 panel 操作 -----------------------------------------------
function enterCity(b) {
  activeCity.value = b.city
  panelCity.value = b.city
  panelMode.value = 'entries'
  console.debug('[proxima] panel: city list → entries of', b.city)
  zoom.value = 12
  map.setZoomAndCenter(12, [b.lng, b.lat], false, 380)
}
function exitCityPanel() {
  activeCity.value = ''
  panelCity.value = ''
  panelMode.value = 'cities'
  activeEntryId.value = null
  if (activeGlowMarker) {
    activeGlowMarker.setMap(null)
    activeGlowMarker = null
  }
}
function focusEntry(e) {
  if (!map) return
  activeEntryId.value = e.id
  map.setCenter([Number(e.lng), Number(e.lat)], false, 260)
  // 高亮 pulse marker:落在 entry 上,呼吸 1.5s
  if (activeGlowMarker) activeGlowMarker.setMap(null)
  if (AMap) {
    activeGlowMarker = new AMap.Marker({
      position: [Number(e.lng), Number(e.lat)],
      content: '<div class="gc-focus-halo"></div>',
      anchor: 'center',
      zIndex: 90,
      bubble: true,
    })
    activeGlowMarker.setMap(map)
  }
  console.debug('[proxima] panel focus entry:', e.city, e.id)
}
function timeAgo(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const min = Math.floor((Date.now() - date) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return date.toLocaleDateString('zh-CN')
}
// ---- AMap runtime handles (non-reactive, set up in initMap) --------------
let map = null
let AMap = null
let markersById = new Map()   // entry.id -> AMap.Marker (community + own)
let bubbleMarkers = new Map() // city   -> AMap.Marker (全国 stickpin)
let searchMarker = null                           // 单点搜索临时 marker
let visitedMarkers = new Map() // visited.id -> AMap.Marker (个人打卡)

// `entries` is already filtered upstream (App.vue); the map is a pure projection.
const visible = computed(() => entriesWithCoords(props.entries))

// City bubbles: for zoom ≤ CITY_TILL we never render individual markers, only
// one bubble per city with the count + first entry's thumb as face. Computed
// from the FULL corpus (allEntries) — if we bubbled `entries` (filtered),
// selecting one city would erase every other city's bubble and the map would
// feel empty even though the data is still there.
const cityBubbles = computed(() => {
  const source = entriesWithCoords(props.allEntries)
  return Array.from(
    source.reduce((groups, e) => {
      const key = e.city || '未命名'
      const cur = groups.get(key) || { count: 0, lat: 0, lng: 0, thumbEntry: e }
      cur.count++
      cur.lat += Number(e.lat)
      cur.lng += Number(e.lng)
      groups.set(key, cur)
      return groups
    }, new Map()).entries(),
  ).map(([city, s]) => ({
    city,
    count: s.count,
    lat: s.lat / s.count,
    lng: s.lng / s.count,
    thumbEntry: s.thumbEntry,
  }))
})

const inCityTier = computed(() => zoom.value <= CITY_TILL)
const inPinTier = computed(() => zoom.value >= PIN_FROM)
const tier = computed(() => (inCityTier.value ? 'city' : inPinTier.value ? 'pin' : 'dot'))

// 图钉式标记:细杆 + 顶端圆点,杆底 = 经纬度落点(anchor: bottom-center)。
// 三种模式:
//   - dot: 纯色圆点 (城市内 entry,zoom > 9 且 < 14)
//   - photo: 照片圆点 (城市内 entry,zoom ≥ 14)
//   - city:  照片圆点 + 城市徽章 + 城市名 (全国 bubble,zoom ≤ 9)
// 自己 = 金色,别人/公共 = 品红。
// 全国层级不塞照片,圆点 = 数字 + 光晕(简洁干净),杆下挂城市名。
function makeStickpinContent(entry, withPhoto, cityLabel = '', cityCount = 0) {
  const el = document.createElement('div')
  el.className =
    'gc-stickpin' +
    (cityLabel ? ' gc-stickpin-city' : withPhoto ? ' gc-stickpin-photo' : '') +
    (isMine(entry) && !cityLabel ? ' gc-mine' : '')
  const dot = document.createElement('i')
  dot.className = 'gc-stickpin-dot'
  if (cityLabel) {
    // 圆点内容 = 记录数 (大字)
    const num = document.createElement('span')
    num.className = 'gc-stickpin-num'
    num.textContent = cityCount > 99 ? '99+' : String(cityCount)
    dot.appendChild(num)
  } else if (withPhoto) {
    const img = document.createElement('img')
    img.src = listSrc(entry)
    img.alt = ''
    img.loading = 'lazy'
    dot.appendChild(img)
  }
  el.appendChild(dot)
  const rod = document.createElement('i')
  rod.className = 'gc-stickpin-rod'
  el.appendChild(rod)
  if (cityLabel) {
    const name = document.createElement('span')
    name.className = 'gc-stickpin-name'
    name.textContent = cityLabel
    el.appendChild(name)
  }
  return el
}

function markerForEntry(entry) {
  let marker = markersById.get(entry.id)
  if (marker) return marker
  // 'bottom-center' 锚点:细杆底端 = 经纬度落点,指针感强、不会偏移。
  // 自己的点位 zIndex 抬高,永不被陌生人的点位盖住。
  const mine = isMine(entry)
  marker = new AMap.Marker({
    position: [Number(entry.lng), Number(entry.lat)],
    content: makeStickpinContent(entry, tier.value === 'pin'),
    anchor: 'bottom-center',
    zIndex: tier.value === 'pin' ? (mine ? 50 : 20) : (mine ? 40 : 10),
  })
  marker.on('click', () => onMarkerClick(entry))
  markersById.set(entry.id, marker)
  return marker
}

function onMarkerClick(entry) {
  // Marker tap → 中心对齐 + 高亮 halo + 打开预览卡片。预览卡片在地图下沿悬浮,
  // 用户点了预览卡片才进入 DetailView —— 不再直接跳详情。
  console.debug('[proxima] marker clicked —', entry.city || entry.description || entry.id)
  focusEntry(entry)
  emit('preview-entry', entry)
}

function bubbleForCity(b) {
  let marker = bubbleMarkers.get(b.city)
  if (marker) {
    marker.setPosition([b.lng, b.lat])
    marker.setContent(makeStickpinContent(b.thumbEntry, true, b.city, b.count))
    return marker
  }
  marker = new AMap.Marker({
    position: [b.lng, b.lat],
    content: makeStickpinContent(b.thumbEntry, true, b.city, b.count),
    anchor: 'bottom-center',
    zIndex: 30,
  })
  marker.on('click', () => {
    console.debug('[proxima] bubble clicked —', b.city)
    enterCity(b)
  })
  bubbleMarkers.set(b.city, marker)
  return marker
}

// Sync the wanted-tier markers with what's actually on the map.
function syncMap() {
  if (!map || !AMap) {
    console.debug('[proxima] syncMap: no map yet, skipping (init in progress?)')
    return
  }
  if (inCityTier.value) {
    syncBubbles()
    syncEntriesMarkers(false)
  } else {
    syncBubbles(false)
    syncEntriesMarkers(true)
  }
  console.debug(
    '[proxima] syncMap: tier =',
    tier.value,
    '· visible =',
    visible.value.length,
    '· markersOnMap =',
    markersById.size,
    '· bubblesOnMap =',
    bubbleMarkers.size,
  )
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
    // Re-set content if we changed tier. Own pins keep their elevated
    // z-index across tier flips, not just at first creation.
    const mine = isMine(entry)
    // tier 切换时重建 content(纯色圆点 ↔ 照片圆点),z-index 保持分层。
    marker.setContent(makeStickpinContent(entry, zoomChangedToPins))
    marker.setzIndex(zoomChangedToPins ? (mine ? 50 : 20) : (mine ? 40 : 10))
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
  console.debug('[proxima] locate() starting…')
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
        console.debug('[proxima] Geolocation SUCCESS —', result.position)
        resolve({ lng: result.position.lng, lat: result.position.lat })
      } else {
        // rich failure message (result.message) + raw `result` dump so the
        // commodity line tells us exactly what AMap said, not just "定位失败".
        console.warn('[proxima] Geolocation failed:', result)
        reject(new Error((result && result.message) || '定位失败'))
      }
    })
  })
}

async function initMap() {
  loading.value = true
  mapErr.value = ''
  console.debug('[proxima] initMap() ─基准─ entries=', props.entries.length, 'allEntries=', props.allEntries.length)

  // Step 1: load AMap global
  try {
    AMap = await loadAMap()
    console.debug('[proxima] initMap: loadAMap() resolved OK')
  } catch (e) {
    console.error('[proxima] initMap: loadAMap() FAILED —', e && e.message, e)
    mapErr.value =
      e && e.message === 'AMAP_KEY_NOT_CONFIGURED'
        ? '' // no key = fall back to static list layout below (expected dev case)
        : `高德地图加载失败：${(e && e.message) || '网络异常'}`
    if (mapErr.value) pushToast(mapErr.value, { type: 'error' })
    loading.value = false
    return
  }

  // Step 2: create map instance — 3D tilted "fresh" style.
  //
  // fresh style: light canvas, soft blue-grey blocks — matches the app's
  // 晨雾蓝 palette while still reading as a modern 3D map. pitch=52 gives
  // a clear tilted-bird-view; the doubling of pitch/zoom makes city bubble
  // layer feel like a real "looking down" perspective, not a flat tile.
  try {
    map = new AMap.Map(mapEl.value, {
      zoom: zoom.value,
      center: [105, 35],
      resizeEnable: true,
      viewMode: '3D',
      pitch: 52,
      rotation: 0,
      // fresh = light/airy style. Darker styles exist (darkblue, macaron)
      // but the app is a "morning mist" theme, so fresh matches.
      mapStyle: 'amap://styles/fresh',
      features: ['bg', 'road', 'building', 'water', 'land', 'point'],
      showBuildingBlock: true,
      showLabel: true,
    })
    map.on('zoomend', onZoomEnd)
    map.on('moveend', onMoveEnd)
    console.debug('[proxima] initMap: AMap.Map created OK, container =', mapEl.value)
  } catch (e) {
    console.error('[proxima] initMap: AMap.Map构造失败 —', e && e.message, e)
    mapErr.value = `地图初始化失败：${(e && e.message) || '未知错误'}`
    loading.value = false
    return
  }

  // Step 3: render markers / fitting
  try {
    syncMap()
    syncVisitedPins()
    console.debug(
      '[proxima] map ready — visible entries =',
      visible.value.length,
      'markersById =',
      markersById.size,
      'bubbles =',
      bubbleMarkers.size,
      'zoom tier =',
      tier.value,
    )
    if (visible.value.length) {
      map.setFitView(null, false, [80, 80, 80, 80], 14)
      console.debug('[proxima] map.setFitView(fitting', visible.value.length, 'entries)')
    } else {
      console.debug('[proxima] no visible entries yet — skipping setFitView, waiting for data watcher')
    }
  } catch (e) {
    console.error('[proxima] initMap: syncMap/setFitView failed —', e && e.message, e)
  }

  loading.value = false
  tryAutoLocate()
}

let didStartupLocate = false
let meMarker = null
async function tryAutoLocate() {
  if (didStartupLocate) {
    console.debug('[proxima] tryAutoLocate: already ran once, skip')
    return
  }
  didStartupLocate = true
  console.debug('[proxima] tryAutoLocate: firing startup locate…')
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
    console.debug('[proxima] tryAutoLocate SUCCESS — centred on', pos)
  } catch (e) {
    console.warn(
      '[proxima] tryAutoLocate failed (expected on some devices):',
      e && e.message,
      '— click the 📍 button to force retry',
    )
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
    console.debug('[proxima] searchCenter received:', pos)
    // 1. 同步 zoom ref(否则 tier computed 还是 city);showHomeBtn 是 computed,自动派生
    zoom.value = Math.max(zoom.value, 12)
    // 2. 清掉当前激活的城市面板 — 搜索是用户主动航向新位置
    exitCityPanel()
    // 3. syncMap:此时 zoom > 9,bubbles 会被清,stickpin 显示
    syncMap()

    map.setZoomAndCenter(zoom.value, [pos.lng, pos.lat], false, 320)
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
  <!-- fixed not absolute: AMap 2.0 reads the container's COMPUTED height at
       construction time. Tailwind's inset-0 (top/right/bottom/left: 0) works
       for positioning but AMap's wrapper sometimes ends up 0-tall because the
       inset chain isn't resolved to a pixel value yet. Inline width/height
       100% side-steps the whole chain. -->
  <div class="explore-canvas fixed inset-0">
    <div ref="mapEl" style="position:absolute; top:0; right:0; bottom:0; left:0; width:100%; height:100%;"></div>
<div v-if="loading" class="absolute inset-0 flex items-center justify-center text-sm text-mist-muted">地图加载中…</div>
    <div v-else-if="mapErr" class="absolute inset-0 flex items-center justify-center text-sm text-mist-muted px-6 text-center">{{ mapErr }}</div>

    <!-- 右上工具组:定位 + 返回全国。图标设计成极简线性风格,统一尺寸。 -->
    <div class="absolute top-20 right-4 z-20 flex flex-col gap-2">
      <button
        v-if="!loading && !mapErr"
        @click="onLocateTap"
        aria-label="定位到我的位置"
        class="gc-fab"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="2.5"/>
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>
          <circle cx="12" cy="12" r="7" stroke-dasharray="2 2.5"/>
        </svg>
      </button>

      <!-- 返回全国:仅当离开全国视角时显示 -->
      <Transition name="home-fab">
        <button
          v-if="!loading && !mapErr && showHomeBtn"
          @click="backToCountry"
          aria-label="返回全国视图"
          class="gc-fab gc-fab-accent"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 11l8-7 8 7"/>
            <path d="M6 10v9h4v-5h4v5h4v-9"/>
          </svg>
        </button>
      </Transition>
    </div>

    <!-- 左侧上方数据面板:全国视图 = 城市列表;城市视图 = 该城市的记录。
         可折叠;宽度 ~240px,不抢戏。 -->
    <Transition name="panel">
      <aside
        v-if="!loading && !mapErr"
        class="gc-panel glass-strong"
        :class="{ 'gc-panel-collapsed': panelCollapsed }"
        role="complementary"
        aria-label="数据列表"
      >
        <header class="gc-panel-head" @click="panelCollapsed = !panelCollapsed">
          <div class="min-w-0 flex-1">
            <h2 class="gc-panel-title">{{ panelMode === 'cities' ? '探索城市' : panelCity }}</h2>
            <p class="gc-panel-sub" v-if="!panelCollapsed">
              {{ panelMode === 'cities'
                ? `${cityBubbles.length} 个城市 · ${entryCount} 条记录`
                : `${cityEntries.length} 条记录在这里` }}
            </p>
          </div>
          <!-- 返回按钮:非"默认全国视角"就显示 —— 包括搜索 flyTo(此时
               zoom>9 但 panelMode 还是 cities)。点完回到全国。 -->
          <button
            v-if="showHomeBtn"
            @click.stop="backToCountry"
            class="gc-panel-back"
            aria-label="返回城市列表"
          >← 城市</button>
          <button
            class="gc-panel-toggle"
            :aria-label="panelCollapsed ? '展开面板' : '折叠面板'"
            :aria-expanded="!panelCollapsed"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: panelCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </header>

        <ul v-show="!panelCollapsed" class="gc-panel-list thin-scroll">
          <!-- 城市列表(全国视图) -->
          <template v-if="panelMode === 'cities'">
            <li v-if="!cityBubbles.length" class="gc-panel-empty">还没有数据,先发布一条记录</li>
            <li
              v-for="b in cityBubbles"
              :key="b.city"
              @click="enterCity(b)"
              class="gc-panel-item"
              :class="{ 'gc-panel-item-active': activeCity === b.city }"
            >
              <img :src="listSrc(b.thumbEntry)" class="gc-panel-thumb" alt="" loading="lazy" />
              <div class="min-w-0 flex-1">
                <p class="gc-panel-city">{{ b.city }}</p>
                <p class="gc-panel-meta">{{ b.count }} 条记录</p>
              </div>
              <span class="gc-panel-arrow">›</span>
            </li>
          </template>

          <!-- 记录列表(城市视图) -->
          <template v-else>
            <li v-if="!cityEntries.length" class="gc-panel-empty">这个城市还没有记录</li>
            <li
              v-for="e in cityEntries"
              :key="e.id"
              @click="focusEntry(e)"
              @dblclick="emit('open-entry', e)"
              class="gc-panel-item"
              :class="{ 'gc-panel-item-active': activeEntryId === e.id, 'gc-panel-item-mine': isMine(e) }"
            >
              <img :src="listSrc(e)" class="gc-panel-thumb" alt="" loading="lazy" />
              <div class="min-w-0 flex-1">
                <p class="gc-panel-city">{{ e.title || e.description?.slice(0, 24) || '未命名' }}</p>
                <p class="gc-panel-meta">{{ e.district || e.city }} · {{ timeAgo(e.createdAt) }}</p>
              </div>
              <span v-if="isMine(e)" class="gc-panel-mine-dot" title="我的记录"></span>
            </li>
          </template>
        </ul>
      </aside>
    </Transition>
  </div>
</template>

<style>
/* Three-tier marker aesthetics. Global because AMap clones content nodes. */

/* ============================================================
   Stickpin markers — 细杆 + 顶端圆点。杆底端 (anchor: bottom-center)
   是经纬度落点;圆点悬浮在杆顶,pin tier 内嵌照片。
   配色: 别人 = 青色 (cyan), 自己 = 金色 (amber)。
   ============================================================ */

.gc-stickpin {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  pointer-events: auto;
  animation: gc-sway 3.2s ease-in-out infinite;
  transform-origin: bottom center;
  filter: drop-shadow(0 4px 12px rgba(15, 42, 58, 0.45));
}

.gc-stickpin-rod {
  display: block;
  width: 4px;
  height: 30px;
  background: linear-gradient(
    to bottom,
    rgba(236, 72, 153, 1) 0%,
    rgba(236, 72, 153, 0.7) 60%,
    rgba(236, 72, 153, 0.25) 100%
  );
  border-radius: 2px;
  margin-top: -2px;
  transform-origin: bottom center;
  box-shadow: 0 0 8px rgba(236, 72, 153, 0.6);
}

.gc-stickpin-dot {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  background: radial-gradient(circle at 30% 30%, #f472b6, #ec4899 65%, #be185d);
  border: 3.5px solid #fff;
  box-shadow:
    0 0 0 5px rgba(244, 114, 182, 0.3),
    0 0 20px rgba(236, 72, 153, 0.5),
    0 4px 14px rgba(15, 42, 58, 0.5);
  animation: gc-core-pulse 1.8s ease-in-out infinite;
}

.gc-stickpin-dot::before {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 9999px;
  border: 2px solid rgba(236, 72, 153, 0.6);
  pointer-events: none;
  animation: gc-ring-wave 1.8s ease-out infinite;
}

.gc-stickpin-dot img {
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  object-fit: cover;
  display: block;
}

/* 落点 halo */
.gc-stickpin-dot::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -38px;
  width: 40px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(236, 72, 153, 0.75) 0%, rgba(236, 72, 153, 0) 70%);
  animation: gc-ground-pulse 1.4s ease-out infinite;
  pointer-events: none;
}

/* pin tier: 圆点 56px + 嵌照片,杆更长 */
.gc-stickpin.gc-stickpin-photo .gc-stickpin-dot {
  width: 56px;
  height: 56px;
  border-width: 4px;
  background: #fff1f2;
  overflow: hidden;
  box-shadow:
    0 0 0 5px rgba(244, 114, 182, 0.3),
    0 0 24px rgba(236, 72, 153, 0.55),
    0 6px 18px rgba(15, 42, 58, 0.55);
}
.gc-stickpin.gc-stickpin-photo .gc-stickpin-rod {
  height: 46px;
  width: 4.5px;
}
.gc-stickpin.gc-stickpin-photo .gc-stickpin-dot::after {
  bottom: -64px;
  width: 48px;
  height: 14px;
}
.gc-stickpin.gc-stickpin-photo .gc-stickpin-dot::before {
  inset: -10px;
}

/* 公共点动画:核心一圈 + 环两道波 + 落点一圈 —— 持续脉冲 */
@keyframes gc-core-pulse {
  0%, 100% { box-shadow:
    0 0 0 5px rgba(244, 114, 182, 0.3),
    0 0 20px rgba(236, 72, 153, 0.5),
    0 4px 14px rgba(15, 42, 58, 0.5); }
  50% { box-shadow:
    0 0 0 8px rgba(244, 114, 182, 0.45),
    0 0 28px rgba(236, 72, 153, 0.7),
    0 4px 14px rgba(15, 42, 58, 0.5); }
}

@keyframes gc-ring-wave {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}

@keyframes gc-sway {
  0%, 100% { transform: rotate(-1.2deg); }
  50% { transform: rotate(1.2deg); }
}

@keyframes gc-ground-pulse {
  0% { transform: translateX(-50%) scale(0.6); opacity: 1; }
  100% { transform: translateX(-50%) scale(1.8); opacity: 0; }
}

/* hover 强化 */
.gc-stickpin:hover { animation-play-state: paused; }
.gc-stickpin:hover .gc-stickpin-dot {
  animation-play-state: paused;
  transform: scale(1.2);
}
.gc-stickpin-dot { transition: transform 0.18s ease; }

/* ---- OWN pins: 金色 + 同样强化动画 ---- */
.gc-stickpin.gc-mine .gc-stickpin-rod {
  background: linear-gradient(
    to bottom,
    rgba(245, 158, 11, 1) 0%,
    rgba(245, 158, 11, 0.7) 60%,
    rgba(245, 158, 11, 0.3) 100%
  );
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.6);
}
.gc-stickpin.gc-mine .gc-stickpin-dot {
  background: radial-gradient(circle at 30% 30%, #fde047, #f59e0b 60%, #b45309);
  border-color: #fff7ed;
  animation: gc-core-pulse-mine 1.5s ease-in-out infinite;
}
.gc-stickpin.gc-mine .gc-stickpin-dot::before {
  border-color: rgba(245, 158, 11, 0.6);
  animation-duration: 1.5s;
}
.gc-stickpin.gc-mine .gc-stickpin-dot::after {
  background: radial-gradient(ellipse at center, rgba(245, 158, 11, 0.8) 0%, rgba(245, 158, 11, 0) 70%);
  animation-duration: 1.1s;
}

@keyframes gc-core-pulse-mine {
  0%, 100% { box-shadow:
    0 0 0 5px rgba(245, 158, 11, 0.35),
    0 0 20px rgba(245, 158, 11, 0.55),
    0 4px 14px rgba(180, 83, 9, 0.55); }
  50% { box-shadow:
    0 0 0 9px rgba(245, 158, 11, 0.5),
    0 0 30px rgba(245, 158, 11, 0.75),
    0 4px 14px rgba(180, 83, 9, 0.55); }
}

/* ---- 全国层级:小圆点,数字为内容;杆更细,城市名留在杆下 ---- */
.gc-stickpin.gc-stickpin-city .gc-stickpin-dot {
  width: 30px;
  height: 30px;
  border-width: 2.5px;
  background: radial-gradient(circle at 30% 30%, #f472b6, #ec4899 65%, #be185d);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 不要 overflow: hidden,光晕需要透出去 */
}
.gc-stickpin.gc-stickpin-city .gc-stickpin-rod {
  height: 22px;
  width: 2.5px;
}
.gc-stickpin.gc-stickpin-city .gc-stickpin-dot::after {
  bottom: -32px;
  width: 26px;
  height: 8px;
}
.gc-stickpin-num {
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  font-family: ui-sans-serif, system-ui;
  line-height: 1;
  text-shadow: 0 1px 3px rgba(190, 24, 93, 0.4);
  letter-spacing: -0.01em;
  pointer-events: none;
}
.gc-stickpin-name {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: -22px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(6px);
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  color: #be185d;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(190, 24, 93, 0.2);
  border: 1px solid rgba(236, 72, 153, 0.3);
  z-index: 3;
  pointer-events: none;
}
@keyframes gc-badge-pop {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.18); }
}

/* shared pulse animation (used by ::before pseudo-elements) */
/* ============================================================
   右上 FAB 工具组:小巧线性图标按钮,32×32,不喧宾夺主。
   定位 / 返回 都共用 .gc-fab;.gc-fab-accent 在需要强调时加青色。
   ============================================================ */
.gc-fab {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 2px 10px rgba(15, 42, 58, 0.18);
  color: #5c7a93;
  transition: all 0.18s ease;
  cursor: pointer;
  pointer-events: auto;
}
.gc-fab svg {
  width: 18px;
  height: 18px;
  display: block;
}
.gc-fab:hover {
  color: #0891b2;
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(8, 145, 178, 0.25);
}
.gc-fab:active {
  transform: scale(0.92);
}
/* gc-fab-accent = 实心亮青渐变,"返回全国"等强调按钮 —— 一眼能看到 */
.gc-fab-accent {
  color: #fff;
  background: linear-gradient(135deg, #22d3ee 0%, #0891b2 100%);
  border-color: rgba(255, 255, 255, 0.4);
  box-shadow:
    0 4px 16px rgba(8, 145, 178, 0.45),
    0 0 0 3px rgba(34, 211, 238, 0.25);
}
.gc-fab-accent:hover {
  color: #fff;
  transform: translateY(-1px) scale(1.05);
  box-shadow:
    0 6px 20px rgba(8, 145, 178, 0.55),
    0 0 0 4px rgba(34, 211, 238, 0.35);
  background: linear-gradient(135deg, #3ee2f5 0%, #0aa5c4 100%);
}

/* 返回全国 FAB 的滑入滑出 */
.home-fab-enter-active,
.home-fab-leave-active {
  transition:
    transform 0.28s cubic-bezier(0.34, 1.2, 0.64, 1),
    opacity 0.2s ease;
}
.home-fab-enter-from,
.home-fab-leave-to {
  transform: translateX(48px) scale(0.7);
  opacity: 0;
}

/* ============================================================
   左侧上方数据面板 — 桌面固定左上,移动端折叠为顶部胶囊。
   ============================================================ */
.gc-panel {
  position: absolute;
  top: 80px;
  left: 16px;
  width: 240px;
  max-height: min(60vh, 480px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  z-index: 15;
  pointer-events: auto;
  box-shadow: 0 4px 18px rgba(15, 42, 58, 0.12);
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.gc-panel-collapsed {
  max-height: 56px; /* 只露 header */
}

.gc-panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(15, 42, 58, 0.06);
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}
.gc-panel-collapsed .gc-panel-head {
  border-bottom: none;
}
.gc-panel-title {
  font-family: ui-serif, Georgia, serif;
  font-size: 14px;
  font-weight: 700;
  color: #1e3a52;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gc-panel-sub {
  font-size: 11px;
  color: #5c7a93;
  margin-top: 1px;
}
.gc-panel-back {
  font-size: 12px;
  color: #0891b2;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 9999px;
  transition: all 0.15s ease;
  flex-shrink: 0;
  cursor: pointer;
  pointer-events: auto;
}
.gc-panel-back:hover { background: rgba(8, 145, 178, 0.1); }

.gc-panel-toggle {
  width: 26px;
  height: 26px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #5c7a93;
  flex-shrink: 0;
  transition: all 0.15s ease;
  cursor: pointer;
  pointer-events: auto;
}
.gc-panel-toggle:hover {
  background: rgba(8, 145, 178, 0.1);
  color: #0891b2;
}
.gc-panel-toggle svg { width: 14px; height: 14px; display: block; }

.gc-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 0;
}
.gc-panel-empty {
  padding: 24px 14px;
  text-align: center;
  font-size: 12px;
  color: #5c7a93;
}
.gc-panel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
}
.gc-panel-item:hover {
  background: rgba(34, 211, 238, 0.1);
}
.gc-panel-item-active {
  background: linear-gradient(90deg, rgba(34, 211, 238, 0.15), rgba(8, 145, 178, 0.06));
  box-shadow: inset 2px 0 0 #22d3ee;
}
.gc-panel-item-mine .gc-panel-city::after {
  content: '我的';
  margin-left: 4px;
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 9999px;
  background: rgba(245, 158, 11, 0.2);
  color: #b45309;
  font-weight: 500;
}
.gc-panel-thumb {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: #dfeaf3;
}
.gc-panel-city {
  font-size: 12px;
  font-weight: 600;
  color: #1e3a52;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 3px;
}
.gc-panel-meta {
  font-size: 11px;
  color: #5c7a93;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gc-panel-arrow {
  color: #5c7a93;
  font-size: 16px;
  flex-shrink: 0;
}
.gc-panel-mine-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: #f59e0b;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.3);
}

/* 移动端:面板贴左上角,最大高度更小 */
@media (max-width: 768px) {
  .gc-panel {
    top: 72px;
    left: 10px;
    width: 200px;
    max-height: 32vh;
  }
  .gc-panel-collapsed { max-height: 48px; }
}

/* 面板过渡 */
.panel-enter-active,
.panel-leave-active {
  transition:
    transform 0.32s cubic-bezier(0.34, 1.2, 0.64, 1),
    opacity 0.22s ease;
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(-260px);
  opacity: 0;
}

/* focusEntry 时打的高亮 halo */
.gc-focus-halo {
  width: 60px;
  height: 60px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(34, 211, 238, 0.5) 0%, rgba(34, 211, 238, 0) 65%);
  animation: gc-focus-pulse 1.4s ease-out infinite;
  pointer-events: none;
}
@keyframes gc-focus-pulse {
  0% { transform: scale(0.6); opacity: 1; }
  100% { transform: scale(2); opacity: 0; }
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
