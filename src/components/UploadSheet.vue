// UploadSheet — bottom-sheet upload form (the redesigned upload UI).
//
//   - bottom sheet capped at 86dvh so the map stays visible behind it while
//     composing; the backdrop is a soft scrim, not a wall
//   - photos-first ordering: what the record LOOKS like comes before the
//     metadata you're asked to fill
//   - mood / weather pickers sit between description and tags as OPTIONAL
//     lightweight context
//   - location selection reuses MapModal (drag-marker + no-key fallback)
//

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { compressImage, prettyBytes } from '../lib/geo.js'
import { config } from '../lib/config.js'
import { getDeviceId, recordUpload, remainingToday } from '../lib/device.js'
import { uploadEntry, QueuedOfflineError } from '../lib/github.js'
import { rawImageUrl } from '../lib/images.js'
import MapModal from './MapModal.vue'
import CloseButton from './CloseButton.vue'
import { TAG_PRESETS } from '../lib/tagPresets.js'
import { useBodyScrollLock } from '../lib/useBodyScrollLock.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  // Optional extra tag suggestions (e.g. what's already been used); shown
  // AFTER the curated TAG_PRESETS so fresh users get real starting points.
  existingTags: { type: Array, default: () => [] },
  // Optional pre-fills from the host (e.g. long-press map pin, nearby-tag hint).
  initialLocation: { type: Object, default: null },
  initialTags: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'submitted', 'submit-failed', 'close'])

const MAX_PHOTOS = 3
const MAX_TOTAL_BYTES = 9 * 1024 * 1024

// ---- Emotional context (optional, 2-dimension picker) -------------------
const MOODS = [
  { key: 'happy', label: '开心', emoji: '😊' },
  { key: 'calm', label: '平静', emoji: '😌' },
  { key: 'excited', label: '兴奋', emoji: '🤩' },
  { key: 'tired', label: '疲惫', emoji: '😴' },
  { key: 'melancholy', label: '感伤', emoji: '😢' },
  { key: 'angry', label: '烦躁', emoji: '😤' },
  { key: 'grateful', label: '感恩', emoji: '🙏' },
]
const WEATHERS = [
  { key: 'sunny', label: '晴', emoji: '☀️' },
  { key: 'cloudy', label: '多云', emoji: '☁️' },
  { key: 'overcast', label: '阴', emoji: '🌥️' },
  { key: 'rain', label: '雨', emoji: '🌧️' },
  { key: 'storm', label: '雷雨', emoji: '⛈️' },
  { key: 'snow', label: '雪', emoji: '❄️' },
  { key: 'fog', label: '雾', emoji: '🌫️' },
]

const mood = ref('')
const weather = ref('')

// ---- Photos ---------------------------------------------------------------
const photos = ref([])

function clearPhotos() {
  for (const p of photos.value) URL.revokeObjectURL(p.url)
  photos.value = []
}

const fileInput = ref(null)

function pickImage() {
  if (photos.value.length >= MAX_PHOTOS) return
  fileInput.value?.click()
}

function onFile(e) {
  const chosen = Array.from(e.target.files || [])
  e.target.value = ''
  if (!chosen.length) return
  const room = MAX_PHOTOS - photos.value.length
  const picked = chosen.slice(0, room)
  if (chosen.length > room) err.value = `最多 ${MAX_PHOTOS} 张照片`
  const nextTotal = photos.value.reduce((s, p) => s + p.file.size, 0) + picked.reduce((s, f) => s + f.size, 0)
  if (nextTotal > MAX_TOTAL_BYTES) {
    err.value = `照片总大小超过 ${prettyBytes(MAX_TOTAL_BYTES)}，请换小一些的图`
    return
  }
  for (const f of picked) photos.value = [...photos.value, { file: f, url: URL.createObjectURL(f) }]
}

function removePhoto(i) {
  const p = photos.value[i]
  if (p) URL.revokeObjectURL(p.url)
  photos.value = photos.value.filter((_, j) => j !== i)
}

function movePhoto(i, dir) {
  const j = i + dir
  if (j < 0 || j >= photos.value.length) return
  const arr = [...photos.value]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  photos.value = arr
}

// ---- Location ---------------------------------------------------------------
const point = ref(null) // {lng, lat}
const city = ref('')
const address = ref('')
const mapOpen = ref(false)

function openMap() {
  mapOpen.value = true
}
function onMapConfirm(loc) {
  point.value = { lng: loc.lng, lat: loc.lat }
  city.value = loc.city || city.value
  address.value = loc.address || address.value
  msg.value = ''
}

const locText = computed(() => {
  const parts = []
  if (city.value) parts.push(city.value)
  if (address.value && address.value !== city.value) parts.push(address.value)
  return parts.join(' · ')
})

// ---- Text content -----------------------------------------------------------
const description = ref('')
const tags = ref([])
const tagInput = ref('')
const tagOpen = ref(false)
const tagRoot = ref(null)
const isPublic = ref(true)

const busy = ref(false)
const msg = ref('')
const err = ref('')

function addTagFromInput() {
  const raw = tagInput.value.trim()
  if (!raw) return
  const parts = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  for (const p of parts) {
    if (!tags.value.includes(p)) tags.value = [...tags.value, p]
  }
  tagInput.value = ''
}

function onTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
    e.preventDefault()
    addTagFromInput()
  } else if (e.key === 'Backspace' && !tagInput.value && tags.value.length) {
    tags.value = tags.value.slice(0, -1)
  }
}

function toggleExisting(tag) {
  if (tags.value.includes(tag)) tags.value = tags.value.filter((t) => t !== tag)
  else tags.value = [...tags.value, tag]
}

function removeTag(tag) {
  tags.value = tags.value.filter((t) => t !== tag)
}

// All tags we could offer = curated presets first (deduped), then any
// community-existing tags not already in the preset list (after the curated
// block). Search narrows BOTH lists with one query.
const allOfferTags = computed(() => {
  const seen = new Set(TAG_PRESETS)
  const extra = props.existingTags.filter((t) => !seen.has(t))
  return [...TAG_PRESETS, ...extra]
})

const filteredTags = computed(() => {
  const q = tagInput.value.trim().toLowerCase()
  if (!q) return allOfferTags.value
  return allOfferTags.value.filter((t) => String(t).toLowerCase().includes(q))
})

// Offer "+ 新建 '<input>'" row whenever the query is non-empty and not an
// exact match against any offer (preset or existing).
const canCreateTag = computed(() => {
  const q = tagInput.value.trim()
  return q.length > 0 && !tags.value.includes(q) && !allOfferTags.value.includes(q)
})

function closeTagDropdown() {
  tagOpen.value = false
}

function onTagDocClick(e) {
  if (tagRoot.value && !tagRoot.value.contains(e.target)) closeTagDropdown()
}

function onTagFocus() {
  tagOpen.value = true
}

// ---- Quota + lifecycle --------------------------------------------------
const remaining = ref(remainingToday(config.maxUploadsPerDay))
const locked = computed(() => remaining.value <= 0)

function refreshRemaining() {
  remaining.value = remainingToday(config.maxUploadsPerDay)
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      // Accept host-provided pre-fills once per open
      if (props.initialLocation) {
        point.value = { lng: props.initialLocation.lng, lat: props.initialLocation.lat }
        if (props.initialLocation.city) city.value = props.initialLocation.city
        if (props.initialLocation.address) address.value = props.initialLocation.address
      }
      if (props.initialTags.length) {
        tags.value = [...new Set([...props.initialTags])]
      }
      refreshRemaining()
    } else {
      reset()
    }
  },
)

onMounted(() => {
  window.addEventListener('gc-counts-rebuilt', refreshRemaining)
  document.addEventListener('click', onTagDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('gc-counts-rebuilt', refreshRemaining)
  document.removeEventListener('click', onTagDocClick)
  clearPhotos()
})

useBodyScrollLock(() => props.open)

function reset() {
  clearPhotos()
  point.value = null
  city.value = ''
  address.value = ''
  description.value = ''
  mood.value = ''
  weather.value = ''
  tags.value = []
  tagInput.value = ''
  tagOpen.value = false
  isPublic.value = true
  busy.value = false
  msg.value = ''
  err.value = ''
  mapOpen.value = false
}

function close() {
  clearPhotos()
  emit('update:open', false)
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape' && !mapOpen.value) close()
}

// ---- Submit -------------------------------------------------------------
const sizeHint = computed(() =>
  photos.value.length ? prettyBytes(photos.value.reduce((s, p) => s + p.file.size, 0)) : '',
)

async function submit() {
  err.value = ''
  msg.value = ''
  if (locked.value) {
    err.value = `今日上传已达上限（${config.maxUploadsPerDay} 次）`
    return
  }
  addTagFromInput()
  if (!photos.value.length) return (err.value = '请添加照片')
  if (!point.value) return (err.value = '请选择位置')
  if (!description.value.trim()) return (err.value = '请填写描述')
  if (!tags.value.length) return (err.value = '请至少添加一个标签')
  if (!city.value.trim()) return (err.value = '请填写城市')

  busy.value = true
  const compressed = []
  let entryId = null
  let pendingBlobUrls = []
  try {
    for (let i = 0; i < photos.value.length; i++) {
      msg.value = photos.value.length > 1 ? `正在压缩 ${i + 1}/${photos.value.length}…` : '正在压缩…'
      compressed.push(await compressImage(photos.value[i].file, config.maxImageEdge, config.jpegQuality))
    }
    msg.value = '正在上传…'
    const id = crypto.randomUUID()
    entryId = id
    const finalTags = [...tags.value]
    const visibility = isPublic.value ? 'public' : 'private'
    const n = compressed.length
    const imagePaths = compressed.map((_, i) => (n === 1 ? `images/${id}.jpg` : `images/${id}-${i}.jpg`))
    const makeUrls = () =>
      compressed.map((c, i) => ({
        raw: rawImageUrl(imagePaths[i]),
        blobUrl: URL.createObjectURL(c.blob),
      }))
    const urls = makeUrls()
    pendingBlobUrls = urls.map((u) => u.blobUrl)
    const baseEntry = {
      id,
      deviceId: getDeviceId(),
      createdAt: new Date().toISOString(),
      lat: point.value.lat,
      lng: point.value.lng,
      city: city.value.trim(),
      address: address.value.trim(),
      description: description.value.trim(),
      tags: finalTags,
      mood: mood.value || '',
      weather: weather.value || '',
      image: urls[0].raw,
      images: urls.map((u) => u.raw),
      status: 'published',
      visibility,
      _local: true,
    }
    try {
      await uploadEntry({
        id,
        deviceId: getDeviceId(),
        lat: point.value.lat,
        lng: point.value.lng,
        city: city.value.trim(),
        address: address.value.trim(),
        description: description.value.trim(),
        tags: finalTags,
        mood: mood.value || '',
        weather: weather.value || '',
        images: compressed.map((c) => ({ b64: c.base64, ext: 'jpg' })),
        visibility,
      })
    } catch (e) {
      if (e instanceof QueuedOfflineError) {
        baseEntry.image = urls[0].blobUrl
        baseEntry.images = urls.map((u) => u.blobUrl)
        recordUpload()
        remaining.value = remainingToday(config.maxUploadsPerDay)
        msg.value = '已离线保存，联网后自动同步'
        emit('submitted', { ...baseEntry, _queued: true })
        setTimeout(close, 900)
        return
      }
      throw e
    }
    for (const u of urls) URL.revokeObjectURL(u.blobUrl)
    recordUpload()
    remaining.value = remainingToday(config.maxUploadsPerDay)
    msg.value = visibility === 'private' ? '已保存，仅自己可见' : '发布成功！'
    emit('submitted', baseEntry)
    setTimeout(close, 900)
  } catch (e) {
    for (const u of pendingBlobUrls) URL.revokeObjectURL(u)
    pendingBlobUrls = []
    err.value = e.message
    emit('submit-failed', entryId)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-x-0 bottom-0 z-[1100] flex flex-col justify-end"
      @keydown="onKey"
      tabindex="0"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <!-- soft backdrop: map stays visible/peekable behind us -->
      <div class="absolute inset-0 bg-black/30 backdrop-blur-[2px] fade-in" @click="close"></div>

      <!-- sheet -->
      <section
        class="relative w-full max-h-[86dvh] rounded-t-3xl glass-strong shadow-2xl overflow-hidden modal-pop"
        style="background: rgba(255,255,255,0.88); backdrop-filter: blur(24px)"
      >
        <!-- grab handle -->
        <div class="pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing" @click="close">
          <div class="w-10 h-1 rounded-full bg-mist-muted/30"></div>
        </div>
        <div class="overflow-y-auto thin-scroll max-h-[calc(86dvh-24px)] px-5 pb-6 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-serif text-lg text-mist-text">记一条</h2>
            <CloseButton @close="close" />
          </div>

          <!-- photos-first -->
          <div>
            <label class="block text-sm font-medium text-mist-muted mb-2">照片 <span class="text-rose-glow">*</span></label>
            <div class="flex flex-wrap gap-2.5">
              <div v-for="(p, i) in photos" :key="p.url" class="relative">
                <img :src="p.url" class="w-20 h-20 rounded-xl object-cover" />
                <button
                  type="button"
                  class="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-black/65 text-white text-xs leading-none flex items-center justify-center"
                  aria-label="移除"
                  @click="removePhoto(i)"
                >✕</button>
                <div v-if="photos.length > 1" class="absolute inset-x-0 bottom-0 flex justify-between px-0.5">
                  <button type="button" @click="movePhoto(i, -1)" :disabled="i===0" class="w-4 h-4 rounded-full bg-black/50 text-white text-[9px] disabled:opacity-30">◀</button>
                  <button type="button" @click="movePhoto(i, 1)" :disabled="i===photos.length-1" class="w-4 h-4 rounded-full bg-black/50 text-white text-[9px] disabled:opacity-30">▶</button>
                </div>
              </div>
              <button
                v-if="photos.length < MAX_PHOTOS"
                type="button"
                @click="pickImage"
                class="w-20 h-20 rounded-xl glass border-dashed border border-mist-muted/30 flex flex-col items-center justify-center gap-1 hover:brightness-110"
                aria-label="添加照片"
              >
                <span class="text-lg text-rose-glow">📷</span>
                <span class="text-[10px] text-mist-muted">{{ photos.length ? `${photos.length}/${MAX_PHOTOS}` : '添加' }}</span>
              </button>
            </div>
            <p v-if="sizeHint" class="mt-1.5 text-[11px] text-mist-muted/60">共 {{ sizeHint }}</p>
            <input ref="fileInput" type="file" accept="image/*" multiple @change="onFile" class="hidden" />
          </div>

          <!-- description -->
          <div>
            <label class="block text-sm font-medium text-mist-muted mb-1.5">这一刻想说什么？</label>
            <textarea
              v-model="description"
              rows="3"
              class="w-full rounded-2xl bg-white/50 px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/40 outline-none focus:ring-2 focus:ring-accent/30 resize-none border border-white/60"
            ></textarea>
          </div>

          <!-- mood + weather (optional) -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-mist-muted/80 mb-1.5">心情（可选）</label>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="m in MOODS"
                  :key="m.key"
                  type="button"
                  @click="mood = mood === m.key ? '' : m.key"
                  :class="mood === m.key ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'bg-white/60 text-mist-muted hover:brightness-110'"
                  class="rounded-lg px-2 py-1 text-xs transition flex items-center gap-0.5"
                  :title="m.label"
                >
                  <span class="text-sm leading-none">{{ m.emoji }}</span>
                  <span class="text-[10px]">{{ m.label }}</span>
                </button>
              </div>
            </div>
            <div>
              <label class="block text-xs text-mist-muted/80 mb-1.5">天气（可选）</label>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="w in WEATHERS"
                  :key="w.key"
                  type="button"
                  @click="weather = weather === w.key ? '' : w.key"
                  :class="weather === w.key ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'bg-white/60 text-mist-muted hover:brightness-110'"
                  class="rounded-lg px-2 py-1 text-xs transition flex items-center gap-0.5"
                  :title="w.label"
                >
                  <span class="text-sm leading-none">{{ w.emoji }}</span>
                  <span class="text-[10px]">{{ w.label }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- tags -->
          <div>
            <label class="block text-sm font-medium text-mist-muted mb-1.5">
              标签 <span class="text-rose-glow">*</span>
            </label>
            <div v-if="tags.length" class="flex flex-wrap gap-1.5 mb-2">
              <span
                v-for="t in tags"
                :key="t"
                class="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-soft to-rose-glow text-white text-xs px-2.5 py-1"
              >
                {{ t }}
                <button type="button" @click="removeTag(t)" class="text-white/80 hover:text-white leading-none" aria-label="移除标签">✕</button>
              </span>
            </div>
            <div ref="tagRoot" class="relative">
              <input
                v-model="tagInput"
                @keydown="onTagKeydown"
                @focus="onTagFocus"
                type="text"
                class="w-full rounded-2xl bg-white/50 px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/40 outline-none focus:ring-2 focus:ring-accent/30 border border-white/60"
              />
              <Transition name="dropdown-expand">
                <div v-if="tagOpen" class="absolute z-30 mt-1.5 w-full grid">
                  <div class="glass-strong rounded-2xl p-2 shadow-lg max-h-[35vh] overflow-y-auto thin-scroll min-h-0">
                    <div v-if="filteredTags.length" class="grid gap-1.5" style="grid-template-columns: repeat(auto-fill, minmax(88px, 1fr))">
                      <button
                        v-for="t in filteredTags"
                        :key="t"
                        type="button"
                        @click="toggleExisting(t)"
                        :class="tags.includes(t) ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'bg-white/60 text-mist-muted'"
                        class="rounded-xl px-2.5 py-1.5 text-xs truncate"
                        :title="t"
                      >{{ t }}</button>
                    </div>
                    <button
                      v-if="canCreateTag"
                      type="button"
                      @click="addTagFromInput"
                      class="w-full rounded-xl px-3 py-2 mt-1.5 text-xs text-left bg-white/60 text-accent"
                    >+ 新建「{{ tagInput.trim() }}」</button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- location -->
          <div>
            <label class="block text-sm font-medium text-mist-muted mb-1.5">位置 <span class="text-rose-glow">*</span></label>
            <button
              @click="openMap"
              type="button"
              :class="point ? 'ring-accent/50' : ''"
              class="w-full rounded-2xl bg-white/50 px-3 py-3 flex items-center gap-2.5 text-left border border-white/60 ring-1 hover:brightness-105"
            >
              <span class="text-lg">📍</span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm" :class="point ? 'text-mist-text' : 'text-mist-muted/70'">
                  {{ point ? '位置已选' : '点击选择位置' }}
                </span>
                <span v-if="locText" class="block text-[11px] text-mist-muted/70 truncate mt-0.5">{{ locText }}</span>
              </span>
              <span class="text-xs text-mist-muted/50">{{ point ? '修改' : '' }}</span>
            </button>
          </div>

          <!-- visibility -->
          <label class="flex items-center gap-3 cursor-pointer bg-white/50 rounded-2xl px-3 py-2.5 border border-white/60">
            <input v-model="isPublic" type="checkbox" class="w-4 h-4 accent-[color:var(--color-accent)] cursor-pointer" />
            <span class="flex-1 min-w-0">
              <span class="block text-sm text-mist-text">公开这条记录</span>
              <span class="block text-[11px] text-mist-muted/70">{{ isPublic ? '出现在公开地图中' : '仅自己可见' }}</span>
            </span>
            <span class="text-base leading-none opacity-80">{{ isPublic ? '🌐' : '🔒' }}</span>
          </label>

          <p v-if="err" role="alert" class="text-sm text-rose-glow">{{ err }}</p>
          <p v-if="msg" class="text-sm text-emerald-300">{{ msg }}</p>

          <button
            :disabled="busy || locked"
            @click="submit"
            class="w-full rounded-2xl bg-gradient-to-r from-rose-soft to-rose-glow px-4 py-3.5 font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-50"
          >
            {{ locked ? '今日已达上限' : busy ? '上传中…' : '发布' }}
          </button>

          <p class="text-center text-xs text-mist-muted/60">
            今日剩余 <b class="text-mist-text">{{ remaining }}</b> / {{ config.maxUploadsPerDay }} ·
            <span v-if="mood || weather" class="text-mist-muted/70">
              {{ [MOODS.find(m=>m.key===mood)?.label, WEATHERS.find(w=>w.key===weather)?.label].filter(Boolean).join(' · ') }}
            </span>
          </p>
        </div>
      </section>

      <MapModal
        v-model:open="mapOpen"
        :initial="point ? { ...point, city, address } : null"
        @confirm="onMapConfirm"
      />
    </div>
  </Teleport>
</template>
