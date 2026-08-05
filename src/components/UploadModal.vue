<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { compressImage, prettyBytes } from '../lib/geo.js'
import { config } from '../lib/config.js'
import { getDeviceId, recordUpload, remainingToday } from '../lib/device.js'
import { uploadEntry } from '../lib/github.js'
import MapModal from './MapModal.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  existingTags: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'submitted', 'close'])

const file = ref(null)
const preview = ref('')
const point = ref(null)
const city = ref('')
const address = ref('')
const description = ref('')
const tags = ref([])
const tagInput = ref('')
const tagOpen = ref(false)
const tagRoot = ref(null)
const busy = ref(false)
const msg = ref('')
const err = ref('')

const mapOpen = ref(false)

const remaining = ref(remainingToday(config.maxUploadsPerDay))
const locked = computed(() => remaining.value <= 0)

function refreshRemaining() {
  remaining.value = remainingToday(config.maxUploadsPerDay)
}

// Reset everything each time the modal opens.
watch(
  () => props.open,
  (o) => {
    if (o) {
      reset()
      refreshRemaining()
    }
  },
)

// When App rebuilds counts from server data (e.g. after a cache clear),
// refresh the remaining count too.
onMounted(() => window.addEventListener('gc-counts-rebuilt', refreshRemaining))
onBeforeUnmount(() => window.removeEventListener('gc-counts-rebuilt', refreshRemaining))

function reset() {
  file.value = null
  preview.value = ''
  point.value = null
  city.value = ''
  address.value = ''
  description.value = ''
  tags.value = []
  tagInput.value = ''
  tagOpen.value = false
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

// ---- Tags ----
// Add tags from free text (Enter or comma). Existing-pick chips toggle below.
function addTagFromInput() {
  const raw = tagInput.value.trim()
  if (!raw) return
  // Allow comma-separated batch entry: "猫, 咖啡馆" -> two tags.
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
    // Backspace on empty input removes the last tag.
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

// Filtered existing-tag suggestions for the dropdown: case-insensitive includes
// on the current input. Empty input shows all existing tags.
const filteredTags = computed(() => {
  const q = tagInput.value.trim().toLowerCase()
  if (!q) return props.existingTags
  return props.existingTags.filter((t) => String(t).toLowerCase().includes(q))
})

// Whether the current input is a brand-new tag (not yet existing) — offered as
// an "add '<input>'" action in the dropdown so the affordance is explicit.
const canCreateTag = computed(() => {
  const q = tagInput.value.trim()
  return q.length > 0 && !tags.value.includes(q) && !props.existingTags.includes(q)
})

function closeTagDropdown() {
  tagOpen.value = false
}

// Click outside the tag control closes the dropdown (modal already handles
// Escape for full-close).
function onTagDocClick(e) {
  if (tagRoot.value && !tagRoot.value.contains(e.target)) closeTagDropdown()
}
onMounted(() => document.addEventListener('click', onTagDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onTagDocClick))

function onTagFocus() {
  tagOpen.value = true
}

async function submit() {
  err.value = ''
  msg.value = ''
  if (locked.value) {
    err.value = `今日上传已达上限（${config.maxUploadsPerDay} 次）`
    return
  }
  // Commit any text still sitting in the tag input — a user who typed a tag but
  // never pressed Enter clearly meant to add it, and tags are now required.
  addTagFromInput()
  if (!file.value) return (err.value = '请添加照片')
  if (!point.value) return (err.value = '请选择位置')
  if (!description.value.trim()) return (err.value = '请填写描述')
  if (!tags.value.length) return (err.value = '请至少添加一个标签')
  if (!city.value.trim()) return (err.value = '请填写城市（在位置弹窗中选点后自动填入）')

  busy.value = true
  msg.value = '正在压缩并上传…'
  try {
    const { base64 } = await compressImage(file.value, config.maxImageEdge, config.jpegQuality)
    const id = crypto.randomUUID()
    const imageExt = 'jpg'
    const finalTags = [...tags.value]
    await uploadEntry({
      id,
      deviceId: getDeviceId(),
      lat: point.value.lat,
      lng: point.value.lng,
      city: city.value.trim(),
      address: address.value.trim(),
      description: description.value.trim(),
      tags: finalTags,
      imageB64: base64,
      imageExt,
    })
    recordUpload()
    remaining.value = remainingToday(config.maxUploadsPerDay)
    msg.value = '上传成功！'
    // Optimistic entry: image points at the data branch's raw URL (NOT the
    // dist/images relative path), because data.json only rebuilds on a master
    // deploy — until then the only live copy of the image is on the data
    // branch. This keeps the picture visible after a page refresh.
    const imageUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.dataBranch}/images/${id}.${imageExt}`
    emit('submitted', {
      id,
      deviceId: getDeviceId(),
      createdAt: new Date().toISOString(),
      lat: point.value.lat,
      lng: point.value.lng,
      city: city.value.trim(),
      address: address.value.trim(),
      description: description.value.trim(),
      tags: finalTags,
      image: imageUrl,
      status: 'published',
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

        <!-- tags: pick from existing + add your own -->
        <div>
          <label class="block text-sm font-medium text-mist-muted mb-1.5">
            标签 <span class="text-rose-glow">*</span>
          </label>

          <!-- selected tags as removable chips -->
          <div v-if="tags.length" class="flex flex-wrap gap-1.5 mb-2">
            <span
              v-for="t in tags"
              :key="t"
              class="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-soft to-rose-glow text-white text-xs px-2.5 py-1"
            >
              {{ t }}
              <button
                type="button"
                @click="removeTag(t)"
                class="text-white/80 hover:text-white leading-none"
                aria-label="移除标签"
              >✕</button>
            </span>
          </div>

          <!-- free-text input doubles as the dropdown trigger; typing filters
               the existing-tag list below, Enter/comma adds (new or chosen). -->
          <div ref="tagRoot" class="relative">
            <input
              v-model="tagInput"
              @keydown="onTagKeydown"
              @focus="onTagFocus"
              type="text"
              placeholder="输入搜索已有标签，或直接输入新标签回车添加…"
              class="w-full rounded-2xl glass px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/50 outline-none focus:border-rose-glow/50"
            />

            <!-- dropdown: existing tags (filtered) + an explicit "create" action
                 for new text. Mirrors TagFilter.vue's panel styling. -->
            <Transition name="dropdown-expand">
              <div
                v-if="tagOpen"
                class="absolute z-30 mt-1.5 w-full grid"
              >
                <div
                  class="glass-strong rounded-2xl p-2 shadow-[0_8px_30px_rgba(0,0,0,0.25)] max-h-[40vh] overflow-y-auto thin-scroll min-h-0"
                >
                  <!-- existing tags grid, filtered by input -->
                  <div
                    v-if="filteredTags.length"
                    class="grid gap-1.5"
                    style="grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))"
                  >
                    <button
                      v-for="t in filteredTags"
                      :key="t"
                      type="button"
                      @click="toggleExisting(t)"
                      :class="tags.includes(t) ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white' : 'glass text-mist-muted hover:text-mist-text'"
                      class="rounded-xl px-2.5 py-1.5 text-xs transition truncate"
                      :title="t"
                    >
                      {{ t }}
                    </button>
                  </div>

                  <!-- create a brand-new tag from the current input -->
                  <button
                    v-if="canCreateTag"
                    type="button"
                    @click="addTagFromInput"
                    class="w-full rounded-xl px-3 py-2 mt-1.5 text-xs text-left glass text-accent hover:brightness-105 transition"
                  >
                    + 新建标签「{{ tagInput.trim() }}」
                  </button>

                  <!-- empty state: nothing matches AND nothing to create -->
                  <p
                    v-if="!filteredTags.length && !canCreateTag"
                    class="text-[11px] text-mist-muted/60 text-center py-2"
                  >
                    {{ existingTags.length ? '没有匹配的标签，回车可新建' : '还没有标签，输入后回车创建第一个' }}
                  </p>
                </div>
              </div>
            </Transition>
          </div>
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
