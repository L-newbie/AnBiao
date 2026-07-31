<script setup>
import { computed, ref, watch } from 'vue'
import { compressImage, prettyBytes } from '../lib/geo.js'
import { config } from '../lib/config.js'
import { getDeviceId, recordUpload, remainingToday } from '../lib/device.js'
import { uploadEntry } from '../lib/github.js'
import MapModal from './MapModal.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'submitted', 'close'])

const file = ref(null)
const preview = ref('')
const point = ref(null)
const city = ref('')
const address = ref('')
const description = ref('')
const busy = ref(false)
const msg = ref('')
const err = ref('')

const mapOpen = ref(false)

const remaining = ref(remainingToday(config.maxUploadsPerDay))
const locked = computed(() => remaining.value <= 0)

// Reset everything each time the modal opens.
watch(
  () => props.open,
  (o) => {
    if (o) reset()
  },
)

function reset() {
  file.value = null
  preview.value = ''
  point.value = null
  city.value = ''
  address.value = ''
  description.value = ''
  busy.value = false
  msg.value = ''
  err.value = ''
  mapOpen.value = false
}

function close() {
  emit('update:open', false)
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape' && !mapOpen.value) close()
}

const fileInput = ref(null)
function pickImage() {
  fileInput.value?.click()
}

function onFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  file.value = f
  preview.value = URL.createObjectURL(f)
}

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

async function submit() {
  err.value = ''
  msg.value = ''
  if (locked.value) {
    err.value = `今日上传已达上限（${config.maxUploadsPerDay} 次）`
    return
  }
  if (!file.value) return (err.value = '请添加照片')
  if (!point.value) return (err.value = '请选择位置')
  if (!description.value.trim()) return (err.value = '请填写描述')
  if (!city.value.trim()) return (err.value = '请填写城市（在位置弹窗中选点后自动填入）')

  busy.value = true
  msg.value = '正在压缩并上传…'
  try {
    const { base64 } = await compressImage(file.value, config.maxImageEdge, config.jpegQuality)
    const id = crypto.randomUUID()
    await uploadEntry({
      id,
      deviceId: getDeviceId(),
      lat: point.value.lat,
      lng: point.value.lng,
      city: city.value.trim(),
      address: address.value.trim(),
      description: description.value.trim(),
      imageB64: base64,
      imageExt: 'jpg',
    })
    recordUpload()
    remaining.value = remainingToday(config.maxUploadsPerDay)
    msg.value = '上传成功！约 1~2 分钟后会在社区公开显示。'
    emit('submitted', {
      id,
      deviceId: getDeviceId(),
      createdAt: new Date().toISOString(),
      lat: point.value.lat,
      lng: point.value.lng,
      city: city.value.trim(),
      address: address.value.trim(),
      description: description.value.trim(),
      image: `images/${id}.jpg`,
      status: 'published',
      reports: [],
      _local: true,
    })
    setTimeout(close, 900)
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}

const sizeHint = computed(() => (file.value ? prettyBytes(file.value.size) : ''))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      @keydown="onKey"
      tabindex="0"
    >
      <!-- backdrop -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm fade-in" @click="close"></div>

      <!-- sheet -->
      <section
        class="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto thin-scroll glass-strong rounded-t-3xl sm:rounded-3xl p-5 space-y-4 modal-pop"
      >
        <div class="flex items-center justify-between">
          <h2 class="font-serif text-xl text-mist-text">给我记好的呀！</h2>
          <button
            @click="close"
            class="rounded-full w-8 h-8 flex items-center justify-center glass text-mist-muted hover:text-mist-text"
          >
            ✕
          </button>
        </div>

        <!-- description on top -->
        <div>
          <label class="block text-sm font-medium text-mist-muted mb-1.5">写点什么</label>
          <textarea
            v-model="description"
            rows="3"
            placeholder="这里发生了什么 / 有什么值得记录的…"
            class="w-full rounded-2xl glass px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/50 outline-none focus:border-rose-glow/50 resize-none"
          ></textarea>
        </div>

        <!-- two action buttons: photo + location -->
        <div class="grid grid-cols-2 gap-3">
          <!-- photo button -->
          <button
            @click="pickImage"
            :class="file ? 'border-rose-glow/40' : 'border-white/15'"
            class="glass rounded-2xl p-3 flex flex-col items-center justify-center gap-1.5 border hover:brightness-110"
          >
            <img v-if="preview" :src="preview" class="h-16 w-16 object-cover rounded-xl" />
            <span v-else class="text-2xl text-rose-glow">📷</span>
            <span class="text-xs" :class="file ? 'text-mist-text' : 'text-mist-muted'">
              {{ file ? '已选照片' : '添加照片' }}
            </span>
            <span v-if="file" class="text-[10px] text-mist-muted/70">{{ sizeHint }}</span>
          </button>
          <input ref="fileInput" type="file" accept="image/*" @change="onFile" class="hidden" />

          <!-- location button -->
          <button
            @click="openMap"
            :class="point ? 'border-rose-glow/40' : 'border-white/15'"
            class="glass rounded-2xl p-3 flex flex-col items-center justify-center gap-1.5 border hover:brightness-110"
          >
            <span class="text-2xl text-rose-glow">📍</span>
            <span class="text-xs" :class="point ? 'text-mist-text' : 'text-mist-muted'">
              {{ point ? '位置已选' : '选择位置' }}
            </span>
            <span v-if="locText" class="text-[10px] text-mist-muted/70 line-clamp-1 text-center px-1">{{ locText }}</span>
            <span v-else class="text-[10px] text-mist-muted/50">点击打开地图</span>
          </button>
        </div>

        <p v-if="err" class="text-sm text-rose-glow">{{ err }}</p>
        <p v-if="msg" class="text-sm text-emerald-300">{{ msg }}</p>

        <button
          :disabled="busy || locked"
          @click="submit"
          class="w-full rounded-2xl bg-gradient-to-r from-rose-soft to-rose-glow px-4 py-3 font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-50"
        >
          {{ locked ? '今日已达上限' : busy ? '上传中…' : '提交' }}
        </button>

        <p class="text-center text-xs text-mist-muted/70">
          今日剩余 <b class="text-mist-text">{{ remaining }}</b> / {{ config.maxUploadsPerDay }}
        </p>
      </section>

      <!-- independent location map modal -->
      <MapModal v-model:open="mapOpen" :initial="point ? { ...point, city, address } : null" @confirm="onMapConfirm" />
    </div>
  </Teleport>
</template>
