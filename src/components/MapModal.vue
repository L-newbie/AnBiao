<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { hasAMap, loadAMap, reverseGeocode, forwardGeocode, FALLBACK_CITIES } from '../lib/amap.js'
import { useBodyScrollLock } from '../lib/useBodyScrollLock.js'
import CloseButton from './CloseButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  initial: { type: Object, default: null }, // { lng, lat, city, address } | null
})
useBodyScrollLock(() => props.open)
const emit = defineEmits(['update:open', 'confirm', 'close'])

const useAMap = hasAMap()

const mapEl = ref(null)
const loading = ref(true)
const locating = ref(false)
const err = ref('')

const point = ref(null)
const city = ref('')
const address = ref('')
const searchText = ref('')

let map = null
let AMap = null
let marker = null
let geolocation = null
let inited = false

// (Re)initialise whenever the modal opens.
watch(
  () => props.open,
  async (o) => {
    if (!o) return
    // Seed from a previously chosen location if any.
    point.value = props.initial ? { lng: props.initial.lng, lat: props.initial.lat } : null
    city.value = props.initial?.city || ''
    address.value = props.initial?.address || ''
    searchText.value = ''
    err.value = ''
    if (useAMap) {
      await initMap()
      // Auto-locate to the current position on first open unless a point is given.
      if (!point.value) locateMe()
    } else {
      loading.value = false
      if (!point.value) fallbackLocate()
    }
  },
  { immediate: true },
)

async function initMap() {
  if (!hasAMap()) return
  loading.value = true
  err.value = ''
  try {
    AMap = await loadAMap()
    if (map) {
      map.destroy()
      map = null
      marker = null
    }
    const center = point.value
      ? [point.value.lng, point.value.lat]
      : [116.397428, 39.90923]
    map = new AMap.Map(mapEl.value, { zoom: 14, center, resizeEnable: true })
    map.on('click', onMapClick)
    if (point.value) placeMarker(point.value)
    inited = true
  } catch (e) {
    err.value = e.message
  } finally {
    loading.value = false
  }
}

function onMapClick(e) {
  const p = { lng: e.lnglat.getLng(), lat: e.lnglat.getLat() }
  placeMarker(p)
  pickPoint(p)
}

function placeMarker(p) {
  if (!AMap) return
  if (marker) {
    marker.setPosition([p.lng, p.lat])
    return
  }
  marker = new AMap.Marker({ position: [p.lng, p.lat], draggable: true, anchor: 'bottom-center' })
  marker.on('dragend', (e) => {
    pickPoint({ lng: e.lnglat.getLng(), lat: e.lnglat.getLat() })
  })
  marker.setMap(map)
}

function pickPoint(p) {
  point.value = p
  reverseGeocode(p)
    .then((info) => {
      if (info.city) city.value = info.city
      if (info.address) address.value = info.address
      err.value = ''
    })
    .catch(() => {
      // keep the point; user can type city/address manually
    })
}

function locateMe() {
  if (locating.value) return
  locating.value = true
  err.value = ''
  console.debug('[proxima] MapModal.locateMe() — useAMap =', useAMap)
  if (useAMap && AMap) {
    if (!geolocation) {
      geolocation = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 8000, zoomToAccuracy: true })
    }
    geolocation.getCurrentPosition((status, result) => {
      locating.value = false
      if (status !== 'complete' || !result || result.position == null) {
        console.warn('[proxima] MapModal locate failed:', result)
        err.value = '定位失败，请在地图上点选位置'
        return
      }
      console.debug('[proxima] MapModal locate OK —', result.position)
      const p = { lng: result.position.getLng(), lat: result.position.getLat() }
      map?.setCenter([p.lng, p.lat])
      placeMarker(p)
      pickPoint(p)
    })
  } else {
    fallbackLocate()
  }
}

function fallbackLocate() {
  if (!navigator.geolocation) {
    locating.value = false
    err.value = '当前环境不支持定位，请手动选择城市与地址'
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      const p = { lng: pos.coords.longitude, lat: pos.coords.latitude }
      point.value = p
      err.value = ''
    },
    () => {
      locating.value = false
      err.value = '定位失败，请手动选择城市与地址'
    },
    { enableHighAccuracy: true, timeout: 8000 },
  )
}

async function search() {
  if (!searchText.value.trim()) return
  err.value = ''
  try {
    const hits = await forwardGeocode(searchText.value)
    if (!hits.length) {
      err.value = '未找到该地址，请换个关键词'
      return
    }
    const top = hits[0]
    point.value = { lng: top.lng, lat: top.lat }
    if (!address.value) address.value = top.address
    if (map) {
      map.setCenter([top.lng, top.lat])
      placeMarker(top)
    }
    // refine city/address via reverse geocode
    reverseGeocode(top)
      .then((info) => {
        if (info.city) city.value = info.city
        if (info.address) address.value = info.address
      })
      .catch(() => {})
  } catch {
    err.value = '地址搜索失败，请直接在地图上选点'
  }
}

function confirm() {
  if (!point.value) {
    err.value = '请先在地图上选点或定位'
    return
  }
  emit('confirm', {
    lng: point.value.lng,
    lat: point.value.lat,
    city: city.value.trim(),
    address: address.value.trim(),
  })
  close()
}

function close() {
  emit('update:open', false)
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape') close()
}

onBeforeUnmount(() => {
  if (map) {
    map.destroy()
    map = null
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4"
      @keydown="onKey"
      tabindex="0"
    >
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm fade-in" @click="close"></div>

      <section
        class="relative w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto overflow-x-hidden thin-scroll glass-strong rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 space-y-3 modal-pop"
      >
        <div class="flex items-center justify-between">
          <h2 class="font-serif text-xl text-mist-text">选择位置</h2>
          <CloseButton @close="close" />
        </div>

        <!-- AMap happy path -->
        <template v-if="useAMap">
          <!-- search -->
          <div class="flex gap-2">
            <input
              v-model="searchText"
              @keydown.enter="search"
              class="flex-1 rounded-2xl glass px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/50 outline-none focus:border-rose-glow/50"
            />
            <button
              @click="search"
              class="rounded-2xl glass px-4 py-2.5 text-sm text-rose-glow hover:text-white"
            >
              搜索
            </button>
          </div>

          <div class="relative w-full min-w-0">
            <div ref="mapEl" class="w-full h-72 rounded-2xl overflow-hidden glass"></div>
            <div
              v-if="loading"
              class="absolute inset-0 flex items-center justify-center rounded-2xl bg-sky-900/15 backdrop-blur-[1px]"
            >
              <span class="text-sm text-mist-muted">地图加载中…</span>
            </div>
            <button
              @click="locateMe"
              :disabled="locating"
              class="absolute right-2 top-2 glass-strong rounded-full px-3 py-1.5 text-xs text-mist-text hover:text-rose-glow disabled:opacity-50"
            >
              {{ locating ? '定位中…' : '📍 当前位置' }}
            </button>
          </div>
        </template>

        <!-- no-key fallback -->
        <template v-else>
          <div
            class="h-40 rounded-2xl glass border-dashed border border-white/15 flex flex-col items-center justify-center text-center px-4"
          >
            <p class="text-sm text-mist-muted">未配置高德地图 Key</p>
            <p class="text-xs text-mist-muted/70 mt-1">本地预览模式 · 坐标为 WGS-84，与正式环境略有偏差</p>
            <button
              @click="locateMe"
              :disabled="locating"
              class="mt-3 rounded-full glass px-4 py-1.5 text-sm text-rose-glow hover:text-white disabled:opacity-50"
            >
              {{ locating ? '定位中…' : '📍 使用当前位置' }}
            </button>
          </div>
        </template>

        <!-- city + address (both paths) -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div class="sm:col-span-1">
            <label class="block text-xs text-mist-muted mb-1">城市</label>
            <select
              v-if="!useAMap"
              v-model="city"
              class="w-full rounded-2xl glass px-3 py-2.5 text-sm text-mist-text outline-none"
            >
              <option value="" class="bg-white">选择城市</option>
              <option v-for="c in FALLBACK_CITIES" :key="c" :value="c" class="bg-white">{{ c }}</option>
            </select>
            <input
              v-else
              v-model="city"
              placeholder="自动填入"
              class="w-full rounded-2xl glass px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/50 outline-none focus:border-rose-glow/50"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-mist-muted mb-1">地址</label>
            <input
              v-model="address"
              placeholder="自动填入，可修改"
              class="w-full rounded-2xl glass px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/50 outline-none focus:border-rose-glow/50"
            />
          </div>
        </div>

        <p v-if="point" class="text-xs text-mist-muted/80">
          已选点 {{ point.lng.toFixed(4) }}, {{ point.lat.toFixed(4) }}
        </p>
        <p v-if="err" class="text-sm text-rose-glow">{{ err }}</p>

        <button
          @click="confirm"
          class="w-full rounded-2xl bg-gradient-to-r from-rose-soft to-rose-glow px-4 py-3 font-semibold text-white shadow-lg hover:brightness-110"
        >
          确定位置
        </button>
      </section>
    </div>
  </Teleport>
</template>
