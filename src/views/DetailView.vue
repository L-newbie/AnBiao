<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getPoeticName, getAvatar, getDeviceId, commentsToday, remainingCommentsToday, recordComment } from '../lib/device.js'
import { addComment } from '../lib/github.js'
import { config } from '../lib/config.js'
import { addPendingComment, pendingCommentsFor, removePendingComment } from '../lib/pendingComments.js'
import { deletedComments, isCommentDeleted, addDeletedComment } from '../lib/deletedComments.js'
import { imageSrc } from '../lib/images.js'
import FavButton from '../components/FavButton.vue'
import DeleteButton from '../components/DeleteButton.vue'

const props = defineProps({
  entry: { type: Object, required: true },
})
const emit = defineEmits(['close', 'filter-by-tag'])

// The hero and the lightbox both show the full-size original, not the list
// thumbnail — this is where the picture is actually meant to be looked at.
const imgSrc = computed(() => imageSrc(props.entry))

const authorName = computed(() => getPoeticName(props.entry.deviceId || ''))
const avatar = computed(() => getAvatar(props.entry.deviceId || ''))

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
  }
}

// Full-screen image zoom.
const lightbox = ref(false)
function openLightbox() {
  if (imgSrc.value) lightbox.value = true
}
function closeLightbox() {
  lightbox.value = false
}

// ---- Comments ----
// Optimistic local comments appended on submit; merged with persisted ones.
// Seeded from pendingCommentsFor so a page refresh / re-open restores the
// commenter's own pending comments (flagged "等待通过"), mirroring how uploads
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
  if (props.entry._local) return (err.value = '本条尚未通过，暂不能留言')
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
  <div class="space-y-5" @keydown="onKey" tabindex="0">
    <!-- back (sticky: stays at top while scrolling) -->
    <div class="sticky top-0 z-20 -mx-4 px-4 py-2 -mt-2 app-gradient">
      <button
        @click="emit('close')"
        class="flex items-center gap-1.5 text-sm text-mist-muted hover:text-mist-text transition"
      >
        <span class="text-lg">‹</span> 返回
      </button>
    </div>

    <!-- hero image (tap to zoom) -->
    <div v-if="imgSrc" class="rounded-3xl overflow-hidden cursor-zoom-in" @click="openLightbox">
      <img :src="imgSrc" class="w-full h-56 sm:h-72 object-cover bg-mist-800/40" />
    </div>

    <!-- location -->
    <header class="space-y-1">
      <h1 class="font-serif text-2xl text-mist-text leading-snug">{{ locText }}</h1>
      <p class="text-xs text-mist-muted/70 font-mono">
        {{ lat.toFixed(5) }}, {{ lng.toFixed(5) }}
      </p>
    </header>

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
        v-if="entry._local"
        class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
      >等待通过</span>
      <FavButton :entry-id="entry.id" variant="detail" />
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
              <span v-if="c._local" class="text-amber-300/80">· 等待通过</span>
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
        本条尚未通过，暂不能留言
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

    <!-- full-screen image zoom -->
    <Teleport to="body">
      <div
        v-if="lightbox"
        class="fixed inset-0 z-[1300] bg-black/90 flex items-center justify-center fade-in"
        @click="closeLightbox"
      >
        <img :src="imgSrc" class="max-w-full max-h-full object-contain" />
        <span class="absolute top-4 right-4 text-white/70 text-2xl">✕</span>
      </div>
    </Teleport>
  </div>
</template>
