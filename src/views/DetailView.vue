<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getPoeticName, getAvatar, getDeviceId, remainingCommentsToday, recordComment } from '../lib/device.js'
import { addComment, QueuedOfflineError } from '../lib/github.js'
import { config } from '../lib/config.js'
import { addPendingComment, pendingCommentsFor, removePendingComment } from '../lib/pendingComments.js'
import { deletedComments, isCommentDeleted, addDeletedComment } from '../lib/deletedComments.js'
import { visibilityOf, visibilityOverrides, isSyncing, PRIVATE } from '../lib/entryVisibility.js'
import { imageSrc, entryImages } from '../lib/images.js'
import FavButton from '../components/FavButton.vue'
import DeleteButton from '../components/DeleteButton.vue'
import ShareButton from '../components/ShareButton.vue'
import CloseButton from '../components/CloseButton.vue'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['close', 'filter-by-tag'])

// Multi-photo hero: an entry carries up to N originals (entry.images, first
// == entry.image for old data). The carousel is a plain horizontal
// scroll-snap container — native, robust, and (critically) compatible with
// the app's global multi-touch lockdown: main.js only preventDefaults
// multi-touch, single-finger pan keeps scroll-snap working.
const photos = computed(() => entryImages(props.entry).map((_, i) => imageSrc(props.entry, i)))
const activeIdx = ref(0)
const heroScroll = ref(null)
function onHeroScroll() {
  const el = heroScroll.value
  if (!el || !photos.value.length) return
  const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
  activeIdx.value = Math.max(0, Math.min(photos.value.length - 1, i))
}
// The lightbox opens on the carousel's current photo.
const lightboxSrc = computed(() => photos.value[lightboxIdx.value] || '')

const authorName = computed(() => getPoeticName(props.entry.deviceId || ''))
const avatar = computed(() => getAvatar(props.entry.deviceId || ''))

// Visibility indicator. A private entry is only reachable from 我的·记录, but
// showing the state on both makes it unambiguous which one you're looking at —
// the author sees 公开 / 仅自己可见 on their own entries either way.
const isPrivateEntry = computed(() => {
  // Touch the override store so a toggle elsewhere re-renders this chip.
  void visibilityOverrides.value
  return visibilityOf(props.entry) === PRIVATE
})
const isMyEntry = computed(() => props.entry.deviceId === getDeviceId())
// Private entries never show the sync badge — see isSyncing.
const syncing = computed(() => {
  void visibilityOverrides.value
  return isSyncing(props.entry)
})

const locText = computed(() => {
  const parts = []
  if (props.entry.city) parts.push(props.entry.city)
  if (props.entry.address && props.entry.address !== props.entry.city)
    parts.push(props.entry.address)
  return parts.join(' · ') || '（无地址）'
})

const timeText = computed(() => {
  if (!props.entry.createdAt) return ''
  try {
    return new Date(props.entry.createdAt).toLocaleString()
  } catch {
    return props.entry.createdAt
  }
})

// Navigation deeplinks/URLs for various map apps. Clicking opens the native app
// on mobile (via the scheme) or falls back to a web map on desktop.
const lat = computed(() => Number(props.entry.lat))
const lng = computed(() => Number(props.entry.lng))

const navs = computed(() => [
  {
    name: '高德地图',
    href: `https://uri.amap.com/navigation?to=${lng.value},${lat.value},${encodeURIComponent(props.entry.address || locText.value)}&mode=car&coordinate=wgs84&callnative=1`,
  },
  {
    name: '百度地图',
    href: `https://api.map.baidu.com/direction?destination=latlng:${lat.value},${lng.value}|name:${encodeURIComponent(props.entry.address || locText.value)}&coord_type=wgs84&output=html&src=proxima`,
  },
  {
    name: 'Apple 地图',
    href: `https://maps.apple.com/?ll=${lat.value},${lng.value}&q=${encodeURIComponent(props.entry.address || locText.value)}`,
  },
  {
    name: 'Google Maps',
    href: `https://www.google.com/maps/dir/?api=1&destination=${lat.value},${lng.value}`,
  },
])

function onKey(e) {
  if (e.key === 'Escape') {
    if (lightbox.value) closeLightbox()
    else emit('close')
    return
  }
  if (lightbox.value && e.key === 'ArrowLeft') stepLightbox(-1)
  if (lightbox.value && e.key === 'ArrowRight') stepLightbox(1)
}

// Full-screen image zoom (opens on the carousel's active photo).
const lightbox = ref(false)
const lightboxIdx = ref(0)
function openLightbox(idx = activeIdx.value) {
  if (!photos.value.length) return
  lightboxIdx.value = idx
  lightbox.value = true
}
function closeLightbox() {
  lightbox.value = false
}
function stepLightbox(dir) {
  const n = photos.value.length
  if (!n) return
  lightboxIdx.value = (lightboxIdx.value + dir + n) % n
}

// ---- Comments ----
// Optimistic local comments appended on submit; merged with persisted ones.
// Seeded from pendingCommentsFor so a page refresh / re-open restores the
// commenter's own pending comments (flagged "同步中"), mirroring how uploads
// survive a refresh via pending.js. Others' comments only appear once they're
// aggregated into entry.comments (after a deploy).
const localComments = ref(pendingCommentsFor(props.entry.id))
const persistedComments = computed(() => props.entry.comments || [])
const comments = computed(() => {
  // Touch the tombstone store so a delete re-renders this list immediately —
  // isCommentDeleted reads it, but only inside a filter callback.
  void deletedComments.value
  // persisted already sorted by aggregate.js; local are newest, on top.
  // Drop a local comment once its id shows up in the persisted set — that
  // means it's been aggregated (promoted) and the server copy replaces it,
  // so we never render both the _local and the live version.
  const persistedIds = new Set(persistedComments.value.map((c) => c.id))
  const live = localComments.value.filter((c) => !persistedIds.has(c.id))
  // Tombstones suppress the author's just-deleted comments until the hourly
  // aggregation drops them from data.json for good.
  return [...live, ...persistedComments.value].filter((c) => !isCommentDeleted(c.id))
})

const myId = getDeviceId()
// Only the author of a comment may delete it. Comparing deviceId (not the
// display name) — poetic names collide across devices by design.
function isMine(c) {
  return Boolean(c) && c.deviceId === myId
}

// Last comment-delete failure, shown under the list. Cleared on the next try.
const delErr = ref('')
function onCommentDeleted(id) {
  delErr.value = ''
  // Tombstone first so the row vanishes even though the entry's aggregated
  // copy still carries it.
  addDeletedComment(id)
  // If it was still pending (never aggregated), drop it from that store too —
  // otherwise re-opening this view would seed it back into localComments.
  removePendingComment(id)
  localComments.value = localComments.value.filter((c) => c.id !== id)
  // Let MineView's 留言 list re-read the pending store.
  window.dispatchEvent(new CustomEvent('gc-comments-changed'))
}
function onCommentDeleteError(msg) {
  delErr.value = msg
}

// ---- "我也在这打卡过" ------------------------------------------------------
// Shown only on OTHER people's entries (hidden on my own — that link would
// always be true). Tap → open the upload sheet with this entry's location
// and tags pre-filled. The pre-fill fills the form the same as a cold start;
// the only difference is the point/city/tags inputs arrive non-empty.
//
// Association rule: we only LINK to this record's location + tags. We do NOT
// create a normalized "related" join table (no server-side foreign key on a
// git-backend) — the Mine tab already groups "my records at this place"
// naturally by (deviceId, city) in its list, which is exactly what the user
// described. If a future iteration needs a hard link, the visitedIds set in
// localStorage is the natural place to store it.
const canCheckinHere = computed(() => {
  // Only on my own records the button is meaningless.
  return Boolean(props.entry) && props.entry.deviceId !== getDeviceId()
})

function checkinHere() {
  window.dispatchEvent(
    new CustomEvent('gc-open-upload', {
      detail: {
        lng: props.entry.lng,
        lat: props.entry.lat,
        city: props.entry.city,
        address: props.entry.address,
        tags: props.entry.tags || [],
      },
    }),
  )
}

const MOOD_MAP = {
  happy: { emoji: '😊', label: '开心' },
  calm: { emoji: '😌', label: '平静' },
  excited: { emoji: '🤩', label: '兴奋' },
  tired: { emoji: '😴', label: '疲惫' },
  melancholy: { emoji: '😢', label: '感伤' },
  angry: { emoji: '😤', label: '烦躁' },
  grateful: { emoji: '🙏', label: '感恩' },
}
const WEATHER_MAP = {
  sunny: { emoji: '☀️', label: '晴' },
  cloudy: { emoji: '☁️', label: '多云' },
  overcast: { emoji: '🌥️', label: '阴' },
  rain: { emoji: '🌧️', label: '雨' },
  storm: { emoji: '⛈️', label: '雷雨' },
  snow: { emoji: '❄️', label: '雪' },
  fog: { emoji: '🌫️', label: '雾' },
}
function moodEmoji(key) {
  return MOOD_MAP[key]?.emoji || key
}
function moodLabel(key) {
  return MOOD_MAP[key]?.label || key
}
function weatherEmoji(key) {
  return WEATHER_MAP[key]?.emoji || key
}
function weatherLabel(key) {
  return WEATHER_MAP[key]?.label || key
}

const myName = computed(() => getPoeticName(getDeviceId()))
const remaining = ref(remainingCommentsToday(config.maxCommentsPerDay))
function refreshRemaining() {
  remaining.value = remainingCommentsToday(config.maxCommentsPerDay)
}
onMounted(() => window.addEventListener('gc-counts-rebuilt', refreshRemaining))
onBeforeUnmount(() => window.removeEventListener('gc-counts-rebuilt', refreshRemaining))
const text = ref('')
const busy = ref(false)
const err = ref('')
const over = computed(() => text.value.length > config.maxCommentLength)

function commentTime(c) {
  if (!c.createdAt) return ''
  try {
    const d = new Date(c.createdAt)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${mi}`
  } catch {
    return c.createdAt
  }
}

async function submitComment() {
  err.value = ''
  const trimmed = text.value.trim()
  if (!trimmed) return (err.value = '请输入留言')
  if (trimmed.length > config.maxCommentLength) return (err.value = `留言不能超过 ${config.maxCommentLength} 字`)
  if (props.entry._local) return (err.value = '本条还在同步中，稍后可留言')
  if (remaining.value <= 0) return (err.value = `今日留言已达上限（${config.maxCommentsPerDay} 条）`)

  busy.value = true
  const comment = {
    id: crypto.randomUUID(),
    entryId: props.entry.id,
    deviceId: getDeviceId(),
    author: myName.value,
    text: trimmed,
    createdAt: new Date().toISOString(),
    _local: true,
  }
  // optimistic
  localComments.value = [comment, ...localComments.value]
  // Persist so a refresh / re-open keeps showing it (mirrors pending entries).
  addPendingComment(props.entry.id, comment)
  // Notify App so MineView's "我的留言" re-reads the pending store.
  window.dispatchEvent(new CustomEvent('gc-comments-changed'))
  text.value = ''
  try {
    await addComment(props.entry.id, {
      id: comment.id,
      entryId: comment.entryId,
      deviceId: comment.deviceId,
      author: comment.author,
      text: comment.text,
      createdAt: comment.createdAt,
    })
    recordComment()
    remaining.value = remainingCommentsToday(config.maxCommentsPerDay)
  } catch (e) {
    if (e instanceof QueuedOfflineError) {
      // Offline: the op is persisted in the outbox; the optimistic comment
      // STAYS (badge 同步中 covers "waiting for network" too) and the quota is
      // counted now — rebuilds from server will reconcile on sync.
      recordComment()
      remaining.value = remainingCommentsToday(config.maxCommentsPerDay)
      busy.value = false
      return
    }
    // roll back optimistic comment on failure
    localComments.value = localComments.value.filter((c) => c.id !== comment.id)
    removePendingComment(comment.id)
    window.dispatchEvent(new CustomEvent('gc-comments-changed'))
    text.value = trimmed
    err.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-5 pt-2" style="padding-top: max(env(safe-area-inset-top), 8px)" @keydown="onKey" tabindex="0">
    <!-- back floating pill: accent gradient so it reads clearly over photos.
         (Same pill as Feed/Mine overlays.) -->
    <button
      @click="emit('close')"
      aria-label="返回"
      class="fixed bottom-6 left-4 z-50 rounded-full pl-2.5 pr-4 py-2.5 shadow-lg shadow-accent/30 flex items-center gap-1.5 text-sm font-medium text-white transition active:scale-95 bg-gradient-to-r from-accent to-accent-2 ring-1 ring-white/40"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M15 18l-6-6 6-6"/></svg>
      地图
    </button>

    <!-- hero photo carousel (single photo for legacy entries) -->
    <div v-if="photos.length" class="relative rounded-3xl overflow-hidden hero-settle">
      <div
        ref="heroScroll"
        class="flex overflow-x-auto snap-x snap-mandatory thin-scroll rounded-3xl"
        @scroll.passive="onHeroScroll"
      >
        <div
          v-for="(src, i) in photos"
          :key="src"
          class="w-full shrink-0 snap-center cursor-zoom-in"
          @click="openLightbox(i)"
        >
          <img :src="src" class="w-full h-56 sm:h-72 object-cover bg-mist-800/40" />
        </div>
      </div>
      <!-- dot indicators (multi-photo only) -->
      <div
        v-if="photos.length > 1"
        class="absolute bottom-2 inset-x-0 flex justify-center gap-1.5 pointer-events-none"
      >
        <span
          v-for="(_, i) in photos"
          :key="i"
          class="w-1.5 h-1.5 rounded-full transition"
          :class="i === activeIdx ? 'bg-white' : 'bg-white/40'"
        ></span>
      </div>
    </div>

    <!-- location -->
    <header class="space-y-1">
      <h1 class="font-serif text-2xl text-mist-text leading-snug">{{ locText }}</h1>
      <p class="text-xs text-mist-muted/70 font-mono">
        {{ lat.toFixed(5) }}, {{ lng.toFixed(5) }}
      </p>
    </header>

    <!-- lightweight context (mood/weather), shown when present -->
    <div v-if="entry.mood || entry.weather" class="flex items-center gap-2 text-sm">
      <span v-if="entry.mood" class="inline-flex items-center gap-1.5 glass rounded-full px-3 py-1.5 text-mist-text">
        <span>{{ moodEmoji(entry.mood) }}</span>
        <span class="text-xs">{{ moodLabel(entry.mood) }}</span>
      </span>
      <span v-if="entry.weather" class="inline-flex items-center gap-1.5 glass rounded-full px-3 py-1.5 text-mist-text">
        <span>{{ weatherEmoji(entry.weather) }}</span>
        <span class="text-xs">{{ weatherLabel(entry.weather) }}</span>
      </span>
    </div>

    <!-- author + time -->
    <div class="glass rounded-2xl p-3 flex items-center gap-3">
      <div
        class="w-10 h-10 rounded-full flex items-center justify-center font-serif text-sm text-white shrink-0"
        :style="{ background: avatar.gradient }"
      >
        {{ avatar.glyph }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-serif text-sm text-mist-text">{{ authorName }}</p>
        <p class="text-xs text-mist-muted">{{ timeText }}</p>
      </div>
      <span
        v-if="syncing"
        class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
      >同步中</span>
      <!-- visibility: always flagged when private; the 公开 counterpart is only
           shown to the author, for whom it's an actionable state. -->
      <span
        v-if="isPrivateEntry"
        class="rounded-full bg-mist-600/60 text-mist-text text-[10px] px-2 py-0.5 shrink-0 whitespace-nowrap"
      >🔒 仅自己可见</span>
      <span
        v-else-if="isMyEntry"
        class="rounded-full bg-accent/15 text-accent text-[10px] px-2 py-0.5 shrink-0 whitespace-nowrap"
      >🌐 公开</span>
      <FavButton :entry-id="entry.id" variant="detail" />
      <ShareButton :entry="entry" />
    </div>

    <!-- full description -->
    <section>
      <h2 class="font-serif text-base text-mist-text mb-2">描述</h2>
      <p class="text-sm text-mist-muted leading-relaxed whitespace-pre-wrap">{{ entry.description }}</p>
    </section>

    <!-- tags: clickable to filter the feed by this tag -->
    <section v-if="Array.isArray(entry.tags) && entry.tags.length">
      <h2 class="font-serif text-base text-mist-text mb-2">标签</h2>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="t in entry.tags"
          :key="t"
          @click="emit('filter-by-tag', t)"
          class="rounded-full px-3 py-1.5 text-xs transition glass text-accent hover:brightness-105"
        >
          #{{ t }}
        </button>
      </div>
    </section>

    <!-- 我也在这打卡过 — other people's records only. Opens the upload sheet
         with this entry's exact coordinates + tags pre-filled, so the new
         record lands at the same spot. -->
    <section v-if="canCheckinHere">
      <button
        @click="checkinHere"
        class="w-full rounded-2xl glass px-4 py-3.5 flex items-center justify-center gap-2 text-sm text-accent font-medium hover:brightness-110 transition active:scale-[0.99]"
      >
        <span>📍</span> 我也在这打卡过
      </button>
    </section>

    <!-- navigation -->
    <section>
      <h2 class="font-serif text-base text-mist-text mb-2">导航到这里</h2>
      <div class="grid grid-cols-2 gap-3">
        <a
          v-for="n in navs"
          :key="n.name"
          :href="n.href"
          target="_blank"
          rel="noopener noreferrer"
          class="glass rounded-2xl px-3 py-3 text-center text-sm text-mist-text hover:brightness-110 hover:text-accent transition"
        >
          {{ n.name }}
        </a>
      </div>
      <p class="mt-2 text-xs text-mist-muted/60 text-center">点击在地图 app 中打开导航（手机会唤起对应 app）</p>
    </section>

    <!-- comments -->
    <section>
      <h2 class="font-serif text-base text-mist-text mb-2">留言 · {{ comments.length }}</h2>

      <!-- existing comments -->
      <div v-if="comments.length" class="space-y-2 mb-3">
        <div
          v-for="c in comments"
          :key="c.id"
          class="glass rounded-2xl p-3"
        >
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="font-serif text-xs text-mist-text">
              {{ c.author || '匿名' }}
              <span v-if="c._local" class="text-amber-300/80">· 同步中</span>
            </span>
            <span class="flex items-center gap-1.5 shrink-0">
              <span class="text-[10px] text-mist-muted/70 font-mono">{{ commentTime(c) }}</span>
              <DeleteButton
                v-if="isMine(c)"
                :entry-id="entry.id"
                :comment-id="c.id"
                variant="comment"
                @deleted="onCommentDeleted"
                @error="onCommentDeleteError"
              />
            </span>
          </div>
          <p class="text-sm text-mist-muted leading-relaxed whitespace-pre-wrap break-all">{{ c.text }}</p>
        </div>
      </div>
      <p v-else class="text-xs text-mist-muted/60 mb-3">还没有留言，来说点什么吧</p>
      <p v-if="delErr" class="-mt-2 mb-3 text-[11px] text-rose-glow">{{ delErr }}</p>

      <!-- comment input -->
      <div v-if="entry._local" class="text-xs text-amber-300/80">
        本条还在同步中，稍后可留言
      </div>
      <div v-else>
        <textarea
          v-model="text"
          :maxlength="config.maxCommentLength"
          rows="2"
          :placeholder="`以「${myName}」的身份留言…（最多 ${config.maxCommentLength} 字）`"
          class="w-full rounded-2xl glass px-3 py-2.5 text-sm text-mist-text placeholder-mist-muted/50 outline-none focus:border-accent/50 resize-none"
        ></textarea>
        <div class="flex items-center justify-between mt-2">
          <span class="text-[11px]" :class="over ? 'text-rose-glow' : 'text-mist-muted/60'">
            {{ text.length }}/{{ config.maxCommentLength }} · 今日剩余 {{ remaining }}/{{ config.maxCommentsPerDay }}
          </span>
          <button
            @click="submitComment"
            :disabled="busy || over || !text.trim() || remaining <= 0"
            class="rounded-xl bg-gradient-to-r from-rose-soft to-rose-glow px-4 py-1.5 text-sm font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-50"
          >
            {{ busy ? '提交中…' : '留言' }}
          </button>
        </div>
        <p v-if="err" class="mt-1.5 text-[11px] text-rose-glow">{{ err }}</p>
      </div>
    </section>

    <!-- full-screen image zoom: arrows step through photos, backdrop closes.
         Tap zones sit on the sides so taps on the image itself do nothing —
         distinguishes "wants to look closer" from "wants to leave", and makes
         room for a future pinch-zoom tap handler. -->
    <Teleport to="body">
      <div
        v-if="lightbox"
        class="fixed inset-0 z-[1300] bg-black/90 flex items-center justify-center fade-in"
        @click.self="closeLightbox"
      >
        <img :src="lightboxSrc" class="max-w-full max-h-full object-contain" />
        <CloseButton aria-label="关闭" variant="dark" class="absolute top-4 right-4" @close="closeLightbox" />
        <template v-if="photos.length > 1">
          <button
            class="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 text-white/90 text-2xl flex items-center justify-center ring-1 ring-white/20 backdrop-blur-sm transition active:scale-90"
            aria-label="上一张"
            @click="stepLightbox(-1)"
          >‹</button>
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/40 text-white/90 text-2xl flex items-center justify-center ring-1 ring-white/20 backdrop-blur-sm transition active:scale-90"
            aria-label="下一张"
            @click="stepLightbox(1)"
          >›</button>
          <span class="absolute bottom-4 inset-x-0 text-center text-white/60 text-xs">
            {{ lightboxIdx + 1 }} / {{ photos.length }}
          </span>
        </template>
      </div>
    </Teleport>
  </div>
</template>
